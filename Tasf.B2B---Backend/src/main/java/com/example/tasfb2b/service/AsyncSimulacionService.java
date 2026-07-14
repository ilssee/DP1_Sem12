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
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;
import java.util.Set;

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
    public void procesarSimulacionEnFondo(String jobId, LocalDateTime inicio, int dias, int saSegundos, JobEstado job) {
        try {
            job.setEstado("PROCESANDO");

            List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
            List<Vuelo> vuelos = vueloRepository.findAll();

            // 1. PARÁMETROS (Sa, K, Sc)
            int Sa_minutos = 1; // referencia de escala (no usado directamente)
            int K;
            if (dias <= 3) K = 72;
            else if (dias <= 5) K = 120;
            else K = 168; // Para 7 días o más

            int Sc = K; // Salto de consumo en minutos virtuales (K × 1 min virtual)
            int totalMinutosVirtuales = dias * 24 * 60;
            int totalPasos = (int) Math.ceil((double) totalMinutosVirtuales / Sc);

            // 2. CONFIGURAR TIEMPO REAL
            long sleepMillis = saSegundos * 1000L;

            System.out.println("Iniciando Job " + jobId + " | Días: " + dias + " | Pasos: " + totalPasos + " | Sc: " + Sc + "min");

            // Estado acumulado entre pasos: evita recalcular el histórico completo en cada iteración
            Solucion estadoAcumulado = new Solucion();

            // Mapa de todos los pedidos procesados: idPedido → Pedido (para poder re-optimizarlos)
            Map<String, Pedido> todosPedidosProcesados = new HashMap<>();

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
                if (job.isDetenido()) {
                    System.out.println("🛑 Job " + jobId + " detenido en paso " + paso + " por señal de colapso.");
                    break;
                }
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

                // Registrar pedidos nuevos para poder re-optimizarlos después si se cancela su vuelo
                for (Pedido p : pedidosNuevos) todosPedidosProcesados.put(p.getIdPedido(), p);

                // Filtrar vuelos cancelados para este bloque
                Set<String> cancelados = job.getVuelosCancelados();
                java.time.format.DateTimeFormatter fmtClave = java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss");
                String fechaBloque = ventanaInicio.toLocalDate().toString();
                List<Vuelo> vuelosEfectivos = cancelados.isEmpty()
                    ? vuelos
                    : vuelos.stream()
                        .filter(v -> {
                            String claveConFecha = v.getOrigen() + "-" + v.getDestino() + "-" + (v.getHoraSalida() != null ? v.getHoraSalida().format(fmtClave) : "") + "_" + fechaBloque;
                            return !cancelados.contains(claveConFecha);
                        })
                        .collect(java.util.stream.Collectors.toList());

                // Precomputar prefijos sin fecha de todos los vuelos cancelados para matching independiente de fecha
                Set<String> canceladosSinFecha = cancelados.stream()
                    .map(c -> { int idx = c.lastIndexOf('_'); return idx >= 0 ? c.substring(0, idx) : c; })
                    .collect(java.util.stream.Collectors.toSet());

                // Detectar pedidos ya asignados que usan un vuelo cancelado → re-planificar
                List<Pedido> pedidosAfectados = new ArrayList<>();
                if (!cancelados.isEmpty()) {
                    Iterator<Map.Entry<String, List<Vuelo>>> it =
                        estadoAcumulado.getRutasAsignadas().entrySet().iterator();
                    while (it.hasNext()) {
                        Map.Entry<String, List<Vuelo>> entry = it.next();
                        boolean usaCancelado = entry.getValue().stream().anyMatch(v -> {
                            String claveSinFecha = v.getOrigen() + "-" + v.getDestino() + "-" + (v.getHoraSalida() != null ? v.getHoraSalida().format(fmtClave) : "");
                            return canceladosSinFecha.contains(claveSinFecha);
                        });
                        if (usaCancelado) {
                            Pedido pedidoOriginal = todosPedidosProcesados.get(entry.getKey());
                            if (pedidoOriginal != null) {
                                // Clonar con fechaRegistro = ahora para que Tabu Search solo use vuelos futuros
                                Pedido pedidoReplan = new Pedido(
                                    pedidoOriginal.getIdPedido(),
                                    pedidoOriginal.getOrigen(),
                                    pedidoOriginal.getDestino(),
                                    ventanaInicio,
                                    pedidoOriginal.getCantidadMaletas(),
                                    pedidoOriginal.getIdCliente()
                                );
                                pedidosAfectados.add(pedidoReplan);
                                estadoAcumulado.getPedidosReplanificados().add(entry.getKey());
                                it.remove(); // quitar ruta cancelada del estado acumulado
                                System.out.println("  ⚠ Re-planificando pedido " + entry.getKey() +
                                    " (" + pedidoOriginal.getOrigen() + "→" + pedidoOriginal.getDestino() + ")");
                            }
                        }
                    }
                    if (!pedidosAfectados.isEmpty()) {
                        System.out.println("  ✈ Vuelos cancelados (" + cancelados.size() + "): " + cancelados);
                        System.out.println("  ↺ Total pedidos a re-planificar: " + pedidosAfectados.size());
                    }
                }

                // Combinar afectados + nuevos para optimizar juntos
                List<Pedido> pedidosAOptimizar = new ArrayList<>(pedidosAfectados);
                pedidosAOptimizar.addAll(pedidosNuevos);

                Solucion solucionParcial;
                if (pedidosAOptimizar.isEmpty()) {
                    solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, List.of(), vuelosEfectivos, aeropuertos, 0);
                } else {
                    solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, pedidosAOptimizar, vuelosEfectivos, aeropuertos, 20);
                }

                // Log resultado de re-planificación
                if (!pedidosAfectados.isEmpty()) {
                    for (Pedido p : pedidosAfectados) {
                        List<Vuelo> nuevaRuta = solucionParcial.getRutasAsignadas().get(p.getIdPedido());
                        if (nuevaRuta != null && !nuevaRuta.isEmpty()) {
                            String rutaStr = nuevaRuta.stream()
                                .map(v -> v.getOrigen() + "→" + v.getDestino())
                                .collect(java.util.stream.Collectors.joining(", "));
                            System.out.println("  ✓ " + p.getIdPedido() + " re-planificado: " + rutaStr);
                        } else {
                            System.out.println("  ✗ " + p.getIdPedido() + " SIN RUTA ALTERNATIVA");
                        }
                    }
                }
                tTabu[paso] = System.currentTimeMillis() - t0;

                // Acumular ocupación, rutas y detalles entre bloques
                t0 = System.currentTimeMillis();
                estadoAcumulado.getOcupacionVuelos().putAll(solucionParcial.getOcupacionVuelos());
                estadoAcumulado.getOcupacionAeropuertos().putAll(solucionParcial.getOcupacionAeropuertos());
                estadoAcumulado.getRutasAsignadas().putAll(solucionParcial.getRutasAsignadas());
                // Siempre propagar el acumulado completo a solucionParcial para que el frontend no vea datos vacíos
                solucionParcial.setOcupacionVuelos(new java.util.LinkedHashMap<>(estadoAcumulado.getOcupacionVuelos()));
                solucionParcial.setOcupacionAeropuertos(new HashMap<>(estadoAcumulado.getOcupacionAeropuertos()));
                // pedidosReplanificados ya se acumula en estadoAcumulado directamente
                tAcum[paso] = System.currentTimeMillis() - t0;

                // D. Enriquecer (con todos los pedidos acumulados para detallesEnvios)
                t0 = System.currentTimeMillis();
                enriquecerSolucion(solucionParcial, vuelos, aeropuertos, pedidosNuevos, metricas, estadoAcumulado);
                tEnriq[paso] = System.currentTimeMillis() - t0;

                // --- FILTROS ---
                t0 = System.currentTimeMillis();
                // Enviar rutas acumuladas completas al frontend
                solucionParcial.setRutasAsignadas(new HashMap<>(estadoAcumulado.getRutasAsignadas()));
                solucionParcial.setPedidosReplanificados(new java.util.HashSet<>(estadoAcumulado.getPedidosReplanificados()));

                // Agregar vuelos cuya salida cae dentro de la ventana actual con valor 0 si no asignados
                java.time.LocalDate fechaDesde = ventanaInicio.toLocalDate();
                java.time.LocalDate fechaHasta = ventanaFin.toLocalDate();
                for (java.time.LocalDate fecha = fechaDesde; !fecha.isAfter(fechaHasta); fecha = fecha.plusDays(1)) {
                    for (Vuelo v : vuelos) {
                        if (v.getHoraSalida() == null) continue;
                        java.time.LocalDateTime salidaDT = java.time.LocalDateTime.of(fecha, v.getHoraSalida());
                        if (salidaDT.isBefore(ventanaInicio) || salidaDT.isAfter(ventanaFin.plusHours(24))) continue;
                        String clave = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(fmtClave) + "_" + fecha;
                        solucionParcial.getOcupacionVuelos().putIfAbsent(clave, 0);
                        // Capacidad por ruta (clave sin fecha)
                        String claveRuta = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(fmtClave);
                        solucionParcial.getCapacidadesVuelos().putIfAbsent(claveRuta, v.getCapacidadMax());
                    }
                }

                // capacidadesVuelos ya poblado en el loop anterior

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