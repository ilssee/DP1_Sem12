package com.example.tasfb2b.service;

import com.example.tasfb2b.model.*;
import com.example.tasfb2b.repository.AeropuertoRepository;
import com.example.tasfb2b.repository.VueloRepository;
import com.example.tasfb2b.util.TimeCalculator;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Service
public class AsyncSimulacionService {

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final TabuSearchService tabuSearchService;
    private final JdbcTemplate jdbc;

    private static final RowMapper<Pedido> PEDIDO_MAPPER = (rs, rowNum) -> {
        Pedido p = new Pedido();
        p.setIdPedido(rs.getString("id_pedido"));
        p.setOrigen(rs.getString("origen"));
        p.setDestino(rs.getString("destino"));
        p.setFechaRegistro(rs.getObject("fecha_registro", LocalDateTime.class));
        p.setCantidadMaletas(rs.getInt("cantidad_maletas"));
        p.setIdCliente(rs.getString("id_cliente"));
        return p;
    };

    public AsyncSimulacionService(AeropuertoRepository aeropuertoRepository,
                                  VueloRepository vueloRepository,
                                  TabuSearchService tabuSearchService,
                                  JdbcTemplate jdbc) {
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.tabuSearchService = tabuSearchService;
        this.jdbc = jdbc;
    }

    // Este método corre en un hilo secundario y no bloquea a Nginx
    @Async
    public void procesarSimulacionEnFondo(String jobId, LocalDateTime inicio, int dias, JobEstado job) {
        try {
            job.setEstado("PROCESANDO");

            List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
            List<Vuelo> vuelos = vueloRepository.findAll();

            // 1. PARÁMETROS (Sa, K, Sc)
            int Sa_minutos = 1; // Salto del algoritmo: 1 minuto real por ejecución
            int K;
            if (dias <= 3) K = 72;
            else if (dias <= 5) K = 120;
            else K = 168; // Para 7 días o más

            int Sc = K; // Salto de consumo en minutos virtuales (K × 1 min virtual)
            int totalMinutosVirtuales = dias * 24 * 60;
            int totalPasos = (int) Math.ceil((double) totalMinutosVirtuales / Sc);

            // 2. CONFIGURAR TIEMPO REAL (Sa = 1 minuto real por paso)
            long sleepMillis = Sa_minutos * 60 * 1000L; // 60,000 ms = 1 minuto

            System.out.println("Iniciando Job " + jobId + " | Días: " + dias + " | Pasos: " + totalPasos + " | Sc: " + Sc + "min");

            // Estado acumulado entre pasos: evita recalcular el histórico completo en cada iteración
            Solucion estadoAcumulado = new Solucion();

            // Acumulador de métricas globales (no se reinicia entre pasos, a diferencia de la ocupación)
            MetricasAcumuladas metricas = new MetricasAcumuladas();

            // Tabla de tiempos para resumen final
            long[] tQuery = new long[totalPasos];
            long[] tTabu  = new long[totalPasos];
            long[] tAcum  = new long[totalPasos];
            long[] tEnriq = new long[totalPasos];
            long[] tFilt  = new long[totalPasos];
            long[] tSleep = new long[totalPasos];

            // 3. BUCLE DE CONSUMO POR BLOQUES
            for (int paso = 0; paso < totalPasos; paso++) {
                long inicioPaso = System.currentTimeMillis();
                LocalDateTime ventanaInicio = inicio.plusMinutes((long) paso * Sc);
                LocalDateTime ventanaFin = ventanaInicio.plusMinutes(Sc);

                // B. Query BD
                long t0 = System.currentTimeMillis();
                List<Pedido> pedidosNuevos = jdbc.query(
                        "SELECT id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente " +
                                "FROM pedidos WHERE fecha_registro >= ? AND fecha_registro < ? ORDER BY fecha_registro",
                        PEDIDO_MAPPER, ventanaInicio, ventanaFin);
                tQuery[paso] = System.currentTimeMillis() - t0;

                // C. Ejecutar Algoritmo (Ta)
                t0 = System.currentTimeMillis();
                Solucion solucionParcial;
                if (pedidosNuevos.isEmpty()) {
                    // Sin pedidos nuevos: devolver el estado acumulado tal cual (sin tabu search)
                    solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, List.of(), vuelos, aeropuertos, 0);
                } else {
                    solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, pedidosNuevos, vuelos, aeropuertos, 20);
                }
                tTabu[paso] = System.currentTimeMillis() - t0;

                // Acumular ocupación, rutas y detalles entre bloques
                t0 = System.currentTimeMillis();
                estadoAcumulado.getOcupacionVuelos().putAll(solucionParcial.getOcupacionVuelos());
                estadoAcumulado.getOcupacionAeropuertos().putAll(solucionParcial.getOcupacionAeropuertos());
                estadoAcumulado.getRutasAsignadas().putAll(solucionParcial.getRutasAsignadas());
                tAcum[paso] = System.currentTimeMillis() - t0;

                // D. Enriquecer (con todos los pedidos acumulados para detallesEnvios)
                t0 = System.currentTimeMillis();
                enriquecerSolucion(solucionParcial, vuelos, aeropuertos, pedidosNuevos, metricas, estadoAcumulado);
                tEnriq[paso] = System.currentTimeMillis() - t0;

                // --- FILTROS ---
                t0 = System.currentTimeMillis();
                // Enviar rutas acumuladas completas al frontend
                solucionParcial.setRutasAsignadas(new HashMap<>(estadoAcumulado.getRutasAsignadas()));

                // Agregar vuelos cuya salida cae dentro de la ventana actual con valor 0 si no asignados
                java.time.format.DateTimeFormatter fmtBloque = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
                java.time.LocalDate fechaDesde = ventanaInicio.toLocalDate();
                java.time.LocalDate fechaHasta = ventanaFin.toLocalDate();
                for (java.time.LocalDate fecha = fechaDesde; !fecha.isAfter(fechaHasta); fecha = fecha.plusDays(1)) {
                    for (Vuelo v : vuelos) {
                        if (v.getHoraSalida() == null) continue;
                        java.time.LocalDateTime salidaDT = java.time.LocalDateTime.of(fecha, v.getHoraSalida());
                        if (salidaDT.isBefore(ventanaInicio) || salidaDT.isAfter(ventanaFin.plusHours(24))) continue;
                        String clave = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(fmtBloque) + "_" + fecha;
                        solucionParcial.getOcupacionVuelos().putIfAbsent(clave, 0);
                    }
                }

                // capacidadesVuelos: enviar todos (sin filtrar por asignación)
                // El frontend ya tiene el mapa completo de capacidades por ruta

                // Vuelos con maletas: top 200 por ocupación
                // Vuelos con 0 maletas: todos los del bloque actual (para mostrar en mapa)
                Map<String, Integer> conMaletas = solucionParcial.getOcupacionVuelos().entrySet().stream()
                        .filter(e -> e.getValue() > 0)
                        .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                        .limit(200)
                        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
                Map<String, Integer> sinMaletas = solucionParcial.getOcupacionVuelos().entrySet().stream()
                        .filter(e -> e.getValue() == 0)
                        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue));
                Map<String, Integer> ocupacionFinal = new java.util.LinkedHashMap<>();
                ocupacionFinal.putAll(conMaletas);
                ocupacionFinal.putAll(sinMaletas);
                solucionParcial.setOcupacionVuelos(ocupacionFinal);
                solucionParcial.setOcupacionAeropuertos(solucionParcial.getOcupacionAeropuertos().entrySet().stream()
                        .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                        .limit(100)
                        .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));
                tFilt[paso] = System.currentTimeMillis() - t0;

                // E. Actualizar el estado global del Job
                double progreso = ((paso + 1.0) / totalPasos) * 100.0;
                job.setProgreso(progreso);
                job.setSolucionParcial(solucionParcial);
                job.setVentanaVirtual(
                    ventanaInicio.toLocalDate() + " " + ventanaInicio.toLocalTime().toString().substring(0, 5) +
                    " → " +
                    ventanaFin.toLocalDate() + " " + ventanaFin.toLocalTime().toString().substring(0, 5)
                );

                // F. Sleep descontando TODAS las fases (Query + Tabú + Acum + Enriquecer + Filtros)
                long tiempoNoSleep = tQuery[paso] + tTabu[paso] + tAcum[paso] + tEnriq[paso] + tFilt[paso];
                long sleepReal = Math.max(0, sleepMillis - tiempoNoSleep);
                tSleep[paso] = sleepReal;
                Thread.sleep(sleepReal);
            }

            job.setEstado("COMPLETADO");
            job.setProgreso(100.0);

            // RESUMEN FINAL DE TIEMPOS
            System.out.println("\n========== RESUMEN DE TIEMPOS POR PASO ==========");
            System.out.printf("%-6s | %-8s | %-8s | %-8s | %-8s | %-8s | %-8s | %-8s%n",
                "Paso", "Query", "Tabú", "Acum", "Enriq", "Filtros", "Sleep", "TOTAL");
            System.out.println("-------------------------------------------------------------------------");
            long sumQuery=0, sumTabu=0, sumAcum=0, sumEnriq=0, sumFilt=0, sumSleep=0;
            for (int i = 0; i < totalPasos; i++) {
                long total = tQuery[i] + tTabu[i] + tAcum[i] + tEnriq[i] + tFilt[i] + tSleep[i];
                System.out.printf("%-6d | %6dms | %6dms | %6dms | %6dms | %6dms | %6dms | %6dms%n",
                    i+1, tQuery[i], tTabu[i], tAcum[i], tEnriq[i], tFilt[i], tSleep[i], total);
                sumQuery+=tQuery[i]; sumTabu+=tTabu[i]; sumAcum+=tAcum[i];
                sumEnriq+=tEnriq[i]; sumFilt+=tFilt[i]; sumSleep+=tSleep[i];
            }
            System.out.println("-------------------------------------------------------------------------");
            System.out.printf("PROMEDIO | %6dms | %6dms | %6dms | %6dms | %6dms | %6dms | %6dms%n",
                sumQuery/totalPasos, sumTabu/totalPasos, sumAcum/totalPasos,
                sumEnriq/totalPasos, sumFilt/totalPasos, sumSleep/totalPasos,
                (sumQuery+sumTabu+sumAcum+sumEnriq+sumFilt+sumSleep)/totalPasos);
            System.out.printf("TOTAL REAL: %.1f seg (%.1f min)%n",
                (sumQuery+sumTabu+sumAcum+sumEnriq+sumFilt+sumSleep)/1000.0,
                (sumQuery+sumTabu+sumAcum+sumEnriq+sumFilt+sumSleep)/60000.0);
            System.out.println("==================================================\n");

            System.out.println("Job " + jobId + " COMPLETADO.");

        } catch (Exception e) {
            e.printStackTrace();
            job.setEstado("ERROR");
            job.setMensaje(e.getMessage());
        }
    }

    // Mantiene las sumas y conteos a través de todos los pasos de la simulación
    private static class MetricasAcumuladas {
        double totalMinIntra = 0, totalMinInter = 0;
        int countIntra = 0, countInter = 0, exitosos = 0;
    }

    private void enriquecerSolucion(Solucion solucion, List<Vuelo> vuelos, List<Aeropuerto> aeropuertos,
            List<Pedido> pedidos, MetricasAcumuladas metricas, Solucion estadoAcumulado) {
        java.time.format.DateTimeFormatter FMT = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
        Map<String, Integer> caps = new HashMap<>();
        Map<String, String> llegadas = new HashMap<>();
        for (Vuelo v : vuelos) {
            String clave = v.getOrigen() + "-" + v.getDestino() + "-" + (v.getHoraSalida() != null ? v.getHoraSalida().format(FMT) : "");
            caps.put(clave, v.getCapacidadMax());
            llegadas.put(clave, v.getHoraLlegada() != null ? v.getHoraLlegada().format(FMT) : "");
        }
        solucion.setCapacidadesVuelos(caps);
        solucion.setHorasLlegada(llegadas);

        // Acumular detallesEnvios del bloque actual en estadoAcumulado y enviar el total
        estadoAcumulado.getDetallesEnvios().putAll(solucion.getDetallesEnvios());
        solucion.setDetallesEnvios(new HashMap<>(estadoAcumulado.getDetallesEnvios()));

        Map<String, Integer> capsAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) capsAeros.put(a.getCodigo(), a.getCapacidadMax());
        solucion.setCapacidadesAeropuertos(capsAeros);

        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        Map<String, Pedido> mapaPedidos = new HashMap<>();
        for (Pedido p : pedidos) mapaPedidos.put(p.getIdPedido(), p);

        final long SLA_INTRA = 720, SLA_INTER = 1440;

        // Solo se calculan las métricas del bloque actual (pedidos nuevos), pero se SUMAN al acumulado global
        for (Map.Entry<String, List<Vuelo>> entry : solucion.getRutasAsignadas().entrySet()) {
            List<Vuelo> ruta = entry.getValue();
            if (ruta == null || ruta.isEmpty()) continue;
            Pedido p = mapaPedidos.get(entry.getKey());
            if (p == null) continue;
            Aeropuerto aOrigen  = mapaAeros.get(p.getOrigen());
            Aeropuerto aDestino = mapaAeros.get(p.getDestino());
            if (aOrigen == null || aDestino == null) continue;

            long totalMin = 0;
            for (int i = 0; i < ruta.size(); i++) {
                Vuelo v = ruta.get(i);
                totalMin += TimeCalculator.calcularDuracionVueloMinutos(v, mapaAeros.get(v.getOrigen()), mapaAeros.get(v.getDestino()));
                if (i < ruta.size() - 1) totalMin += TimeCalculator.calcularTiempoEsperaMinutos(v, ruta.get(i + 1));
            }
            totalMin += TimeCalculator.TIEMPO_RECOJO_FINAL;

            if (aOrigen.getContinente().equals(aDestino.getContinente())) {
                metricas.totalMinIntra += totalMin; metricas.countIntra++; if (totalMin <= SLA_INTRA) metricas.exitosos++;
            } else {
                metricas.totalMinInter += totalMin; metricas.countInter++; if (totalMin <= SLA_INTER) metricas.exitosos++;
            }
        }

        int totalAsignados = metricas.countIntra + metricas.countInter;
        solucion.setTotalPedidos(totalAsignados);
        solucion.setTasaExito(totalAsignados > 0 ? (metricas.exitosos * 100.0 / totalAsignados) : 0);
        solucion.setTiempoPromedioIntra(metricas.countIntra > 0 ? (metricas.totalMinIntra / metricas.countIntra / 60.0) : 0);
        solucion.setTiempoPromedioInter(metricas.countInter > 0 ? (metricas.totalMinInter / metricas.countInter / 60.0) : 0);
    }
}