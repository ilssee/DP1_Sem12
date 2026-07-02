package com.example.tasfb2b.service;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.Solucion;
import com.example.tasfb2b.model.Vuelo;
import com.example.tasfb2b.util.TimeCalculator;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class TabuSearchService {

    private static final int TABU_TENURE = 30;
    private static final int MAX_SIN_MEJORA = 200;
    private static final int MAX_ESPERA_MINUTOS = 18 * 60;

    // Estado Dijkstra: ruta parcial + llegada UTC + minutos totales desde creación del pedido
    private record EstadoBFS(List<Vuelo> ruta, LocalDateTime llegadaUTC, long minutosTotal) {}

    // Descriptor ligero de un movimiento vecino — reemplaza clonar Solucion completa
    private record Movimiento(
            Pedido pedido,
            List<Vuelo> rutaVieja,
            List<Vuelo> rutaNueva,
            double nuevoFitness,
            String atributoTabu
    ) {}

    // Variante que recibe el estado acumulado de pasos anteriores en lugar de recalcular el histórico completo
    public Solucion ejecutarOptimizacionConEstado(Solucion estadoBase, List<Pedido> pedidosSimulacion, List<Vuelo> vuelosTotales, List<Aeropuerto> aeropuertos, int iteracionesMaximas) {
        return ejecutarOptimizacion(List.of(), pedidosSimulacion, vuelosTotales, aeropuertos, iteracionesMaximas, estadoBase);
    }

    public Solucion ejecutarOptimizacion(List<Pedido> pedidosHistoricos, List<Pedido> pedidosSimulacion, List<Vuelo> vuelosTotales, List<Aeropuerto> aeropuertos, int iteracionesMaximas) {
        return ejecutarOptimizacion(pedidosHistoricos, pedidosSimulacion, vuelosTotales, aeropuertos, iteracionesMaximas, null);
    }

    private Solucion ejecutarOptimizacion(List<Pedido> pedidosHistoricos, List<Pedido> pedidosSimulacion, List<Vuelo> vuelosTotales, List<Aeropuerto> aeropuertos, int iteracionesMaximas, Solucion estadoBaseExterno) {
        System.out.println("Iniciando Búsqueda Tabú para " + pedidosSimulacion.size() + " pedidos de simulación...");

        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);
        if (mapaAeros.isEmpty()) {
            System.err.println("CRÍTICO: El mapa de aeropuertos está vacío.");
            return new Solucion();
        }

        Map<String, Vuelo> mapaVuelos = new HashMap<>();
        for (Vuelo v : vuelosTotales)
            mapaVuelos.put(v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida(), v);

        // Pre-computar vuelosPorOrigen UNA sola vez (no reconstruir en cada iteración)
        Map<String, List<Vuelo>> vuelosPorOrigen = new HashMap<>();
        for (Vuelo v : vuelosTotales)
            vuelosPorOrigen.computeIfAbsent(v.getOrigen(), k -> new ArrayList<>()).add(v);

        // 0. WARM-UP HISTÓRICO: Pre-llenar la red con los pedidos del pasado usando solo el algoritmo Voraz
        Solucion estadoBase;
        if (estadoBaseExterno != null) {
            estadoBase = estadoBaseExterno;
        } else {
            estadoBase = new Solucion();
            if (pedidosHistoricos != null && !pedidosHistoricos.isEmpty()) {
                estadoBase = generarSolucionInicialVoraz(pedidosHistoricos, vuelosPorOrigen, mapaAeros);
            }
        }

        // 1. Solución inicial voraz para pedidos de simulación
        Solucion solucionActual = generarSolucionInicialVorazConEstado(pedidosSimulacion, vuelosPorOrigen, mapaAeros, estadoBase);

        solucionActual.getRutasAsignadas().putAll(estadoBase.getRutasAsignadas());
        solucionActual.setFitness(evaluarFitness(solucionActual, pedidosSimulacion, mapaAeros, mapaVuelos));

        // Tracking del mejor global
        double mejorFitnessGlobal = solucionActual.getFitness();
        Map<String, List<Vuelo>> mejorRutasGlobal = new HashMap<>(solucionActual.getRutasAsignadas());

        Map<String, Integer> listaTabu = new HashMap<>();
        int iteracionesSinMejora = 0;

        // 2. Bucle principal
        for (int iter = 0; iter < iteracionesMaximas; iter++) {
            if (iteracionesSinMejora >= MAX_SIN_MEJORA) {
                break;
            }

            // A. Generar movimientos candidatos
            List<Movimiento> movimientos = generarMovimientos(
                    solucionActual, pedidosSimulacion, vuelosPorOrigen, mapaAeros, mapaVuelos);

            // B. Seleccionar mejor movimiento admisible
            Movimiento mejorMovimiento = null;
            for (Movimiento m : movimientos) {
                boolean esTabu = listaTabu.containsKey(m.atributoTabu());
                boolean cumpleAspiracion = m.nuevoFitness() < mejorFitnessGlobal;
                if (!esTabu || cumpleAspiracion) {
                    if (mejorMovimiento == null || m.nuevoFitness() < mejorMovimiento.nuevoFitness()) {
                        mejorMovimiento = m;
                    }
                }
            }

            if (mejorMovimiento == null) break;

            // C. Aplicar el movimiento EN-LUGAR
            registrarImpactoAeropuertos(solucionActual, mejorMovimiento.pedido(), mejorMovimiento.rutaVieja(), -1, mapaAeros);
            registrarImpactoAeropuertos(solucionActual, mejorMovimiento.pedido(), mejorMovimiento.rutaNueva(), +1, mapaAeros);
            solucionActual.getRutasAsignadas().put(mejorMovimiento.pedido().getIdPedido(), mejorMovimiento.rutaNueva());
            solucionActual.setFitness(mejorMovimiento.nuevoFitness());

            // D. Actualizar lista tabú
            actualizarListaTabu(listaTabu);
            listaTabu.put(mejorMovimiento.atributoTabu(), TABU_TENURE);

            // E. Actualizar récord global
            if (solucionActual.getFitness() < mejorFitnessGlobal) {
                mejorFitnessGlobal = solucionActual.getFitness();
                mejorRutasGlobal = new HashMap<>(solucionActual.getRutasAsignadas());
                iteracionesSinMejora = 0;
            } else {
                iteracionesSinMejora++;
            }
        }

        System.out.println("Optimización finalizada.");

        // Reconstruir la solución final con las mejores rutas
        Solucion mejorSolucion = new Solucion();
        mejorSolucion.setFitness(mejorFitnessGlobal);
        mejorSolucion.setRutasAsignadas(mejorRutasGlobal);

        if (estadoBaseExterno != null) {
            mejorSolucion.getOcupacionVuelos().putAll(estadoBaseExterno.getOcupacionVuelos());
            mejorSolucion.getOcupacionAeropuertos().putAll(estadoBaseExterno.getOcupacionAeropuertos());
            mejorSolucion.getFechasTramos().putAll(estadoBaseExterno.getFechasTramos());
        }

        // 1. RECUPERAR EL PESO DE LAS MALETAS HISTÓRICAS
        if (pedidosHistoricos != null) {
            for (Pedido pedido : pedidosHistoricos) {
                List<Vuelo> ruta = mejorRutasGlobal.get(pedido.getIdPedido());
                if (ruta != null && !ruta.isEmpty()) {
                    registrarImpactoAeropuertos(mejorSolucion, pedido, ruta, 1, mapaAeros);
                    mejorSolucion.getDetallesEnvios().put(pedido.getIdPedido(),
                            new Solucion.DetalleEnvio(pedido.getIdCliente(), pedido.getCantidadMaletas(), pedido.getOrigen(), pedido.getDestino()));
                }
            }
        }

        // 2. SUMAR EL PESO DE LAS MALETAS NUEVAS
        if (pedidosSimulacion != null) {
            for (Pedido pedido : pedidosSimulacion) {
                List<Vuelo> ruta = mejorRutasGlobal.get(pedido.getIdPedido());
                if (ruta != null && !ruta.isEmpty()) {
                    registrarImpactoAeropuertos(mejorSolucion, pedido, ruta, 1, mapaAeros);
                    mejorSolucion.getDetallesEnvios().put(pedido.getIdPedido(),
                            new Solucion.DetalleEnvio(pedido.getIdCliente(), pedido.getCantidadMaletas(), pedido.getOrigen(), pedido.getDestino()));
                }
            }
        }

        realizarDiagnosticoColapso(mejorSolucion, pedidosSimulacion, mapaAeros, mapaVuelos);
        return mejorSolucion;
    }

    // ============================
    // FUNCIONES AUXILIARES
    // ============================

    private Solucion generarSolucionInicialVoraz(List<Pedido> pedidos,
                                                 Map<String, List<Vuelo>> vuelosPorOrigen,
                                                 Map<String, Aeropuerto> mapaAeros) {
        Solucion solInicial = new Solucion();
        for (Pedido pedido : pedidos) {
            List<Vuelo> rutaAsignada = buscarRutaBFS(
                    pedido.getOrigen(), pedido.getDestino(),
                    vuelosPorOrigen, pedido.getFechaRegistro(), mapaAeros,
                    solInicial.getOcupacionVuelos(), pedido.getCantidadMaletas());
            if (!rutaAsignada.isEmpty()) {
                solInicial.getRutasAsignadas().put(pedido.getIdPedido(), new ArrayList<>(rutaAsignada));
                registrarImpactoAeropuertos(solInicial, pedido, rutaAsignada, 1, mapaAeros);
            }
        }
        return solInicial;
    }

    private Solucion generarSolucionInicialVorazConEstado(List<Pedido> pedidos,
                                                          Map<String, List<Vuelo>> vuelosPorOrigen,
                                                          Map<String, Aeropuerto> mapaAeros,
                                                          Solucion baseState) {
        Solucion solInicial = new Solucion();
        solInicial.getOcupacionVuelos().putAll(baseState.getOcupacionVuelos());
        solInicial.getOcupacionAeropuertos().putAll(baseState.getOcupacionAeropuertos());
        for (Pedido pedido : pedidos) {
            List<Vuelo> rutaAsignada = buscarRutaBFS(
                    pedido.getOrigen(), pedido.getDestino(),
                    vuelosPorOrigen, pedido.getFechaRegistro(), mapaAeros,
                    solInicial.getOcupacionVuelos(), pedido.getCantidadMaletas());
            if (!rutaAsignada.isEmpty()) {
                solInicial.getRutasAsignadas().put(pedido.getIdPedido(), new ArrayList<>(rutaAsignada));
                registrarImpactoAeropuertos(solInicial, pedido, rutaAsignada, 1, mapaAeros);
            }
        }
        return solInicial;
    }

    private List<Vuelo> buscarRutaBFS(String origen, String destino,
                                      Map<String, List<Vuelo>> vuelosPorOrigen,
                                      LocalDateTime fechaRegistro,
                                      Map<String, Aeropuerto> mapaAeros,
                                      Map<String, Integer> ocupacionVuelos,
                                      int cantidadMaletas) {

        Aeropuerto aeroOrigen = mapaAeros.get(origen);
        if (aeroOrigen == null) return new ArrayList<>();
        LocalDateTime tiempoInicioUTC = fechaRegistro.minusHours(aeroOrigen.getGmt());

        PriorityQueue<EstadoBFS> cola = new PriorityQueue<>(Comparator.comparingLong(EstadoBFS::minutosTotal));
        Set<String> visitados = new HashSet<>();
        visitados.add(origen);

        if (vuelosPorOrigen.containsKey(origen)) {
            for (Vuelo v : vuelosPorOrigen.get(origen)) {
                LocalDateTime salidaUTC = calcularProximaSalidaUTC(tiempoInicioUTC, v, aeroOrigen);
                if (salidaUTC == null) continue;
                long espera = Duration.between(tiempoInicioUTC, salidaUTC).toMinutes();
                if (espera < 0 || espera > MAX_ESPERA_MINUTOS) continue;

                java.time.LocalDate salidaLocal = salidaUTC.plusHours(aeroOrigen.getGmt()).toLocalDate();
                String capKey = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + salidaLocal;

                if (v.getDestino().equals(destino)) {
                    System.out.println("🔎 EVALUANDO VUELO DIRECTO DE RESTICCIÓN: " + v.getOrigen() + " -> " + v.getDestino());
                    System.out.println("   Hora Salida: " + v.getHoraSalida() + " | Cap Key: " + capKey);
                    System.out.println("   Espacio ocupado antes de mis maletas: " + ocupacionVuelos.getOrDefault(capKey, 0));
                    System.out.println("   Mis maletas: " + cantidadMaletas + " | Capacidad Máxima: " + v.getCapacidadMax());
                    System.out.println("   ¿Supera la capacidad?: " + (ocupacionVuelos.getOrDefault(capKey, 0) + cantidadMaletas > v.getCapacidadMax()));
                }
                if (ocupacionVuelos.getOrDefault(capKey, 0) + cantidadMaletas > v.getCapacidadMax()) continue;
                Aeropuerto aeroDest = mapaAeros.get(v.getDestino());
                if (aeroDest == null) continue;
                long duracion = TimeCalculator.calcularDuracionVueloMinutos(v, aeroOrigen, aeroDest);
                cola.add(new EstadoBFS(new ArrayList<>(List.of(v)), salidaUTC.plusMinutes(duracion), espera + duracion));
            }
        }

        while (!cola.isEmpty()) {
            EstadoBFS estado = cola.poll();
            String aeropuertoActual = estado.ruta().get(estado.ruta().size() - 1).getDestino();

            if (visitados.contains(aeropuertoActual)) continue;
            visitados.add(aeropuertoActual);

            if (aeropuertoActual.equals(destino)) return estado.ruta();

            if (!vuelosPorOrigen.containsKey(aeropuertoActual)) continue;
            Aeropuerto aeroActual = mapaAeros.get(aeropuertoActual);
            if (aeroActual == null) continue;

            for (Vuelo conexion : vuelosPorOrigen.get(aeropuertoActual)) {
                if (visitados.contains(conexion.getDestino())) continue;
                LocalDateTime salidaUTC = calcularProximaSalidaUTC(estado.llegadaUTC(), conexion, aeroActual);
                if (salidaUTC == null) continue;

                // =========================================================================
                // CAMBIO CLAVE APLICADO: Medir la espera desde el tramo anterior (estado.llegadaUTC())
                // =========================================================================
                long espera = Duration.between(estado.llegadaUTC(), salidaUTC).toMinutes();
                if (espera < 0 || espera > MAX_ESPERA_MINUTOS) continue;

                java.time.LocalDate salidaLocal = salidaUTC.plusHours(aeroActual.getGmt()).toLocalDate();
                String capKey = conexion.getOrigen() + "-" + conexion.getDestino() + "-" + conexion.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + salidaLocal;
                if (ocupacionVuelos.getOrDefault(capKey, 0) + cantidadMaletas > conexion.getCapacidadMax()) continue;
                Aeropuerto aeroDest = mapaAeros.get(conexion.getDestino());
                if (aeroDest == null) continue;
                long duracion = TimeCalculator.calcularDuracionVueloMinutos(conexion, aeroActual, aeroDest);
                List<Vuelo> nuevaRuta = new ArrayList<>(estado.ruta());
                nuevaRuta.add(conexion);
                cola.add(new EstadoBFS(nuevaRuta, salidaUTC.plusMinutes(duracion),
                        estado.minutosTotal() + espera + duracion));
            }
        }
        return new ArrayList<>();
    }

    private LocalDateTime calcularProximaSalidaUTC(LocalDateTime llegadaUTC, Vuelo vuelo, Aeropuerto aeroPartida) {
        return TimeCalculator.calcularProximaSalidaUTC(llegadaUTC, vuelo, aeroPartida);
    }

    private double evaluarFitness(Solucion solucion, List<Pedido> pedidos,
                                  Map<String, Aeropuerto> mapaAeros, Map<String, Vuelo> mapaVuelos) {
        double costoTotal = 0.0;
        for (Pedido pedido : pedidos) {
            List<Vuelo> ruta = solucion.getRutasAsignadas().get(pedido.getIdPedido());
            if (ruta == null || ruta.isEmpty()) { costoTotal += 999999.0; continue; }

            long tiempoTotal = 0;
            Aeropuerto origenPedido = mapaAeros.get(pedido.getOrigen());
            if (origenPedido != null) {
                LocalDateTime tiempoInicioUTC = pedido.getFechaRegistro().minusHours(origenPedido.getGmt());
                LocalDateTime salidaUTC = TimeCalculator.calcularProximaSalidaUTC(tiempoInicioUTC, ruta.get(0), origenPedido);
                if (salidaUTC != null) {
                    long espInicial = Duration.between(tiempoInicioUTC, salidaUTC).toMinutes();
                    if (espInicial < 0) espInicial += 1440; // Escudo protector de medianoche
                    tiempoTotal += espInicial;
                }
            }
            Aeropuerto destinoPedido = mapaAeros.get(pedido.getDestino());

            if (!ruta.get(ruta.size() - 1).getDestino().equals(pedido.getDestino()))
                costoTotal += 999999.0;

            for (int i = 0; i < ruta.size(); i++) {
                Vuelo va = ruta.get(i);
                Aeropuerto oa = mapaAeros.get(va.getOrigen());
                Aeropuerto da = mapaAeros.get(va.getDestino());
                if (oa == null) throw new IllegalArgumentException("Aeropuerto no encontrado: '" + va.getOrigen() + "'");
                if (da == null) throw new IllegalArgumentException("Aeropuerto no encontrado: '" + va.getDestino() + "'");

                long dur = TimeCalculator.calcularDuracionVueloMinutos(va, oa, da);
                if (dur < 0) dur += 1440;
                tiempoTotal += dur;

                if (i < ruta.size() - 1) {
                    Vuelo vs = ruta.get(i + 1);
                    if (!TimeCalculator.esConexionFisicamentePosible(va, vs)) { costoTotal += 999999.0; break; }

                    // CORRECCIÓN LOGÍSTICA CRÍTICA:
                    long esp = TimeCalculator.calcularTiempoEsperaMinutos(va, vs);
                    if (esp < 0) esp += 1440; // Evita que las escalas resten minutos falsos
                    tiempoTotal += esp;
                }
            }
            tiempoTotal += TimeCalculator.TIEMPO_RECOJO_FINAL;
            costoTotal += tiempoTotal;
            boolean mismoCont = origenPedido.getContinente().equals(destinoPedido.getContinente());
            costoTotal += TimeCalculator.calcularPenalizacionTiempo(tiempoTotal, mismoCont);
        }

        for (Map.Entry<String, Integer> e : solucion.getOcupacionVuelos().entrySet()) {
            Vuelo vr = mapaVuelos.get(e.getKey().split("_")[0]);
            if (vr != null && e.getValue() > vr.getCapacidadMax())
                costoTotal += ((e.getValue() - vr.getCapacidadMax()) * 5000.0);
        }
        for (Map.Entry<String, Integer> e : solucion.getOcupacionAeropuertos().entrySet()) {
            Aeropuerto ar = mapaAeros.get(e.getKey().split("_")[0]);
            if (ar != null && e.getValue() > ar.getCapacidadMax())
                costoTotal += ((e.getValue() - ar.getCapacidadMax()) * 5000.0);
        }
        return costoTotal;
    }

    private List<Movimiento> generarMovimientos(Solucion actual, List<Pedido> pedidos,
                                                Map<String, List<Vuelo>> vuelosPorOrigen,
                                                Map<String, Aeropuerto> mapaAeros, Map<String, Vuelo> mapaVuelos) {
        List<Movimiento> movimientos = new ArrayList<>();
        Random random = new Random();

        Set<String> baseKeysSaturados = new HashSet<>();
        for (Map.Entry<String, Integer> e : actual.getOcupacionVuelos().entrySet()) {
            String baseKey = e.getKey().split("_")[0];
            Vuelo vr = mapaVuelos.get(baseKey);
            if (vr != null && e.getValue() > vr.getCapacidadMax())
                baseKeysSaturados.add(baseKey);
        }

        List<Pedido> muestra = new ArrayList<>(pedidos);
        Collections.shuffle(muestra, random);
        if (muestra.size() > 500) muestra = muestra.subList(0, 500);

        List<Pedido> enSaturados = new ArrayList<>();
        List<Pedido> normales    = new ArrayList<>();
        for (Pedido p : muestra) {
            List<Vuelo> ruta = actual.getRutasAsignadas().get(p.getIdPedido());
            boolean usaSaturado = ruta != null && ruta.stream()
                    .anyMatch(v -> baseKeysSaturados.contains(v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida()));
            if (usaSaturado) enSaturados.add(p);
            else             normales.add(p);
        }

        List<Pedido> candidatos = new ArrayList<>();
        candidatos.addAll(enSaturados.subList(0, Math.min(75, enSaturados.size())));
        candidatos.addAll(normales.subList(0, Math.min(25, normales.size())));
        if (candidatos.size() < 100) {
            int faltantes = 100 - candidatos.size();
            int yaUsados = Math.min(25, normales.size());
            if (yaUsados + faltantes <= normales.size())
                candidatos.addAll(normales.subList(yaUsados, yaUsados + faltantes));
        }

        for (Pedido pedido : candidatos) {
            List<Vuelo> rutaVieja = actual.getRutasAsignadas().get(pedido.getIdPedido());
            if (rutaVieja == null || rutaVieja.isEmpty()) continue;

            List<Vuelo> rutaNueva = buscarRutaAlternativaBFS(
                    pedido.getOrigen(), pedido.getDestino(),
                    vuelosPorOrigen, rutaVieja.get(0),
                    pedido.getFechaRegistro(), mapaAeros, baseKeysSaturados,
                    actual.getOcupacionVuelos(), pedido.getCantidadMaletas());

            if (rutaNueva.isEmpty() || rutaNueva.equals(rutaVieja)) continue;

            double costoViejo = calcularCostoRutaUnica(pedido, rutaVieja, mapaAeros);
            double costoNuevo = calcularCostoRutaUnica(pedido, rutaNueva, mapaAeros);
            double deltaPen   = calcularDeltaPenalizaciones(actual, pedido, rutaVieja, rutaNueva, mapaVuelos, mapaAeros);
            double nuevoFitness = actual.getFitness() - costoViejo + costoNuevo + deltaPen;

            String firmaVieja = rutaVieja.stream()
                    .map(v -> v.getOrigen() + v.getDestino() + v.getHoraSalida())
                    .collect(Collectors.joining("|"));
            movimientos.add(new Movimiento(pedido, rutaVieja, rutaNueva, nuevoFitness,
                    pedido.getIdPedido() + ":" + firmaVieja));
        }
        return movimientos;
    }

    private double calcularDeltaPenalizaciones(Solucion actual, Pedido pedido,
                                               List<Vuelo> rutaAntigua, List<Vuelo> rutaNueva,
                                               Map<String, Vuelo> mapaVuelos, Map<String, Aeropuerto> mapaAeros) {
        double delta = 0.0;
        int cantidad = pedido.getCantidadMaletas();

        LocalDateTime t = pedido.getFechaRegistro();
        for (int i = 0; i < rutaAntigua.size(); i++) {
            Vuelo v = rutaAntigua.get(i);
            String key = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + t.toLocalDate();
            Vuelo vr = mapaVuelos.get(v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida());
            if (vr != null) {
                int ocupAntes = actual.getOcupacionVuelos().getOrDefault(key, 0);
                if (ocupAntes > vr.getCapacidadMax()) {
                    delta -= ((ocupAntes - vr.getCapacidadMax()) - Math.max(0, (ocupAntes - cantidad) - vr.getCapacidadMax())) * 5000.0;
                }
            }
            Aeropuerto orig = mapaAeros.get(v.getOrigen()), dest = mapaAeros.get(v.getDestino());
            if (orig != null && dest != null)
                t = t.plusMinutes(TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest));
            if (i < rutaAntigua.size() - 1)
                t = t.plusMinutes(TimeCalculator.calcularTiempoEsperaMinutos(v, rutaAntigua.get(i + 1)));
        }

        t = pedido.getFechaRegistro();
        for (int i = 0; i < rutaNueva.size(); i++) {
            Vuelo v = rutaNueva.get(i);
            String key = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + t.toLocalDate();
            Vuelo vr = mapaVuelos.get(v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida());
            if (vr != null) {
                int ocupActual  = actual.getOcupacionVuelos().getOrDefault(key, 0);
                int ocupDespues = ocupActual + cantidad;
                if (ocupDespues > vr.getCapacidadMax()) {
                    delta += (ocupDespues - vr.getCapacidadMax() - Math.max(0, ocupActual - vr.getCapacidadMax())) * 5000.0;
                }
            }
            Aeropuerto orig = mapaAeros.get(v.getOrigen()), dest = mapaAeros.get(v.getDestino());
            if (orig != null && dest != null)
                t = t.plusMinutes(TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest));
            if (i < rutaNueva.size() - 1)
                t = t.plusMinutes(TimeCalculator.calcularTiempoEsperaMinutos(v, rutaNueva.get(i + 1)));
        }
        return delta;
    }

    private List<Vuelo> buscarRutaAlternativaBFS(String origen, String destino,
                                                 Map<String, List<Vuelo>> vuelosPorOrigen,
                                                 Vuelo vueloProhibido,
                                                 LocalDateTime fechaRegistro,
                                                 Map<String, Aeropuerto> mapaAeros,
                                                 Set<String> vuelosSaturados,
                                                 Map<String, Integer> ocupacionVuelos,
                                                 int cantidadMaletas) {

        Aeropuerto aeroOrigen = mapaAeros.get(origen);
        if (aeroOrigen == null) return new ArrayList<>();
        LocalDateTime tiempoInicioUTC = fechaRegistro.minusHours(aeroOrigen.getGmt());

        PriorityQueue<EstadoBFS> cola = new PriorityQueue<>(Comparator.comparingLong(EstadoBFS::minutosTotal));
        Set<String> visitados = new HashSet<>();
        visitados.add(origen);

        if (vuelosPorOrigen.containsKey(origen)) {
            for (Vuelo v : vuelosPorOrigen.get(origen)) {
                if (v.equals(vueloProhibido)) continue;
                LocalDateTime salidaUTC = calcularProximaSalidaUTC(tiempoInicioUTC, v, aeroOrigen);
                if (salidaUTC == null) continue;
                long espera = Duration.between(tiempoInicioUTC, salidaUTC).toMinutes();
                if (espera < 0 || espera > MAX_ESPERA_MINUTOS) continue;
                java.time.LocalDate salidaLocal = salidaUTC.plusHours(aeroOrigen.getGmt()).toLocalDate();
                String capKey = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + salidaLocal;
                if (ocupacionVuelos.getOrDefault(capKey, 0) + cantidadMaletas > v.getCapacidadMax()) continue;
                Aeropuerto aeroDest = mapaAeros.get(v.getDestino());
                if (aeroDest == null) continue;
                long dur = TimeCalculator.calcularDuracionVueloMinutos(v, aeroOrigen, aeroDest);
                long pen = vuelosSaturados.contains(v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida()) ? 540L : 0L;
                cola.add(new EstadoBFS(new ArrayList<>(List.of(v)), salidaUTC.plusMinutes(dur), espera + dur + pen));
            }
        }

        while (!cola.isEmpty()) {
            EstadoBFS estado = cola.poll();
            String ap = estado.ruta().get(estado.ruta().size() - 1).getDestino();

            if (visitados.contains(ap)) continue;
            visitados.add(ap);

            if (ap.equals(destino)) return estado.ruta();

            if (!vuelosPorOrigen.containsKey(ap)) continue;
            Aeropuerto aeroAp = mapaAeros.get(ap);
            if (aeroAp == null) continue;

            for (Vuelo c : vuelosPorOrigen.get(ap)) {
                if (visitados.contains(c.getDestino())) continue;
                LocalDateTime salidaUTC = calcularProximaSalidaUTC(estado.llegadaUTC(), c, aeroAp);
                if (salidaUTC == null) continue;

                // =========================================================================
                // CAMBIO CLAVE APLICADO: Medir la espera desde el tramo anterior (estado.llegadaUTC())
                // =========================================================================
                long espera = Duration.between(estado.llegadaUTC(), salidaUTC).toMinutes();
                if (espera < 0 || espera > MAX_ESPERA_MINUTOS) continue;

                java.time.LocalDate salidaLocal = salidaUTC.plusHours(aeroAp.getGmt()).toLocalDate();
                String capKey = c.getOrigen() + "-" + c.getDestino() + "-" + c.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss")) + "_" + salidaLocal;
                if (ocupacionVuelos.getOrDefault(capKey, 0) + cantidadMaletas > c.getCapacidadMax()) continue;
                Aeropuerto aeroDest = mapaAeros.get(c.getDestino());
                if (aeroDest == null) continue;
                long dur = TimeCalculator.calcularDuracionVueloMinutos(c, aeroAp, aeroDest);
                long pen = vuelosSaturados.contains(c.getOrigen() + "-" + c.getDestino() + "-" + c.getHoraSalida()) ? 540L : 0L;
                List<Vuelo> nr = new ArrayList<>(estado.ruta());
                nr.add(c);
                cola.add(new EstadoBFS(nr, salidaUTC.plusMinutes(dur),
                        estado.minutosTotal() + espera + dur + pen));
            }
        }
        return new ArrayList<>();
    }

    private void actualizarListaTabu(Map<String, Integer> listaTabu) {
        listaTabu.replaceAll((k, v) -> v - 1);
        listaTabu.entrySet().removeIf(e -> e.getValue() <= 0);
    }

    private void registrarImpactoAeropuertos(Solucion solucion, Pedido pedido,
                                             List<Vuelo> ruta, int factor, Map<String, Aeropuerto> mapaAeros) {
        if (ruta == null || ruta.isEmpty()) return;
        LocalDateTime t = pedido.getFechaRegistro();
        int cantidad = pedido.getCantidadMaletas() * factor;

        String keyOrigen = ruta.get(0).getOrigen() + "_" + t.toLocalDate() + "_" + t.getHour();
        solucion.getOcupacionAeropuertos().merge(keyOrigen, cantidad, (a, b) -> Math.max(0, a + b));

        List<String> fechas = new ArrayList<>();
        for (int i = 0; i < ruta.size(); i++) {
            Vuelo v = ruta.get(i);
            String idVueloUnico = v.getOrigen() + "-" + v.getDestino() + "-"
                    + v.getHoraSalida().format(java.time.format.DateTimeFormatter.ofPattern("HH:mm:ss"))
                    + "_" + t.toLocalDate();
            solucion.getOcupacionVuelos().merge(idVueloUnico, cantidad, (a, b) -> Math.max(0, a + b));

            if (factor > 0) fechas.add(t.toLocalDate().toString());

            Aeropuerto orig = mapaAeros.get(v.getOrigen()), dest = mapaAeros.get(v.getDestino());
            if (orig != null && dest != null)
                t = t.plusMinutes(TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest));

            String keyDest = v.getDestino() + "_" + t.toLocalDate() + "_" + t.getHour();
            solucion.getOcupacionAeropuertos().merge(keyDest, cantidad, (a, b) -> Math.max(0, a + b));

            if (i < ruta.size() - 1)
                t = t.plusMinutes(TimeCalculator.calcularTiempoEsperaMinutos(v, ruta.get(i + 1)));
        }
        if (factor > 0 && !fechas.isEmpty())
            solucion.getFechasTramos().put(pedido.getIdPedido(), fechas);
    }

    private double calcularCostoRutaUnica(Pedido pedido, List<Vuelo> ruta,
                                          Map<String, Aeropuerto> mapaAeros) {
        if (ruta == null || ruta.isEmpty()) return 999999.0;
        if (!ruta.get(ruta.size() - 1).getDestino().equals(pedido.getDestino())) return 999999.0;

        long tiempo = 0;
        Aeropuerto origenPedido = mapaAeros.get(pedido.getOrigen());
        if (origenPedido != null) {
            LocalDateTime tiempoInicioUTC = pedido.getFechaRegistro().minusHours(origenPedido.getGmt());
            LocalDateTime salidaUTC = TimeCalculator.calcularProximaSalidaUTC(tiempoInicioUTC, ruta.get(0), origenPedido);
            if (salidaUTC != null) {
                long espInicial = Duration.between(tiempoInicioUTC, salidaUTC).toMinutes();
                if (espInicial < 0) espInicial += 1440;
                tiempo += espInicial;
            }
        }
        for (int i = 0; i < ruta.size(); i++) {
            Vuelo va = ruta.get(i);

            long dur = TimeCalculator.calcularDuracionVueloMinutos(va, mapaAeros.get(va.getOrigen()), mapaAeros.get(va.getDestino()));
            if (dur < 0) dur += 1440;
            tiempo += dur;

            if (i < ruta.size() - 1) {
                if (!TimeCalculator.esConexionFisicamentePosible(va, ruta.get(i + 1))) return 999999.0;

                // CORRECCIÓN LOGÍSTICA CRÍTICA:
                long esp = TimeCalculator.calcularTiempoEsperaMinutos(va, ruta.get(i + 1));
                if (esp < 0) esp += 1440; // Evita que las escalas resten minutos falsos
                tiempo += esp;
            }
        }
        tiempo += TimeCalculator.TIEMPO_RECOJO_FINAL;
        boolean mismoCont = mapaAeros.get(pedido.getOrigen()).getContinente()
                .equals(mapaAeros.get(pedido.getDestino()).getContinente());
        return tiempo + TimeCalculator.calcularPenalizacionTiempo(tiempo, mismoCont);
    }

    public void realizarDiagnosticoColapso(Solucion sol, List<Pedido> pedidos,
                                           Map<String, Aeropuerto> mapaAeros, Map<String, Vuelo> mapaVuelos) {
        System.out.println("\n========== DIAGNÓSTICO DE COLAPSO LOGÍSTICO ==========");
        int fallosSLA = 0, fallosVuelo = 0, fallosAero = 0;

        for (Pedido p : pedidos) {
            List<Vuelo> ruta = sol.getRutasAsignadas().get(p.getIdPedido());
            if (ruta == null || ruta.isEmpty()) continue;
            long t = calcularSoloTiempoEnMinutos(p, ruta, mapaAeros);
            Aeropuerto o = mapaAeros.get(p.getOrigen()), d = mapaAeros.get(p.getDestino());
            long lim = o.getContinente().equals(d.getContinente()) ? 1440 : 2880;
            if (t > lim) {
                System.out.printf("[FALLO SLA] Pedido %s: %d min > %d min (retraso %d min)%n",
                        p.getIdPedido(), t, lim, t - lim);
                fallosSLA++;
            }
        }
        for (Map.Entry<String, Integer> e : sol.getOcupacionVuelos().entrySet()) {
            Vuelo v = mapaVuelos.get(e.getKey().split("_")[0]);
            if (v != null && e.getValue() > v.getCapacidadMax()) {
                System.out.printf("[FALLO VUELO] %s: %d > %d%n", e.getKey().split("_")[0], e.getValue(), v.getCapacidadMax());
                fallosVuelo++;
            }
        }
        for (Map.Entry<String, Integer> e : sol.getOcupacionAeropuertos().entrySet()) {
            Aeropuerto a = mapaAeros.get(e.getKey().split("_")[0]);
            if (a != null && e.getValue() > a.getCapacidadMax()) {
                System.out.printf("[FALLO ALMACÉN] %s: %d > %d%n", e.getKey().split("_")[0], e.getValue(), a.getCapacidadMax());
                fallosAero++;
            }
        }
        System.out.println("------------------------------------------------------");
        System.out.println("RESUMEN: SLA: " + fallosSLA + " | Vuelos: " + fallosVuelo + " | Almacenes: " + fallosAero);
        System.out.println("======================================================\n");
    }

    private long calcularSoloTiempoEnMinutos(Pedido p, List<Vuelo> ruta,
                                             Map<String, Aeropuerto> mapaAeros) {
        long m = 0;
        for (int i = 0; i < ruta.size(); i++) {
            Vuelo v = ruta.get(i);
            m += TimeCalculator.calcularDuracionVueloMinutos(
                    v, mapaAeros.get(v.getOrigen()), mapaAeros.get(v.getDestino()));
            if (i < ruta.size() - 1)
                m += TimeCalculator.calcularTiempoEsperaMinutos(v, ruta.get(i + 1));
        }
        return m + TimeCalculator.TIEMPO_RECOJO_FINAL;
    }
}