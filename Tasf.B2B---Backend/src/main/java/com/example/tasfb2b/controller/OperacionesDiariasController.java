package com.example.tasfb2b.controller;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.PedidoManualDTO;
import com.example.tasfb2b.model.Solucion;
import com.example.tasfb2b.model.Vuelo;
import com.example.tasfb2b.repository.AeropuertoRepository;
import com.example.tasfb2b.repository.PedidoRepository;
import com.example.tasfb2b.repository.VueloRepository;
import com.example.tasfb2b.service.EstadoDiarioCache;
import com.example.tasfb2b.service.TabuSearchService;
import com.example.tasfb2b.util.TimeCalculator;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/diario")
@CrossOrigin(origins = "*")
public class OperacionesDiariasController {

    private final PedidoRepository pedidoRepository;
    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final TabuSearchService tabuSearchService;
    private final EstadoDiarioCache estadoDiarioCache;
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

    public OperacionesDiariasController(PedidoRepository pedidoRepository,
                                        AeropuertoRepository aeropuertoRepository,
                                        VueloRepository vueloRepository,
                                        TabuSearchService tabuSearchService,
                                        EstadoDiarioCache estadoDiarioCache,
                                        JdbcTemplate jdbc) {
        this.pedidoRepository = pedidoRepository;
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.tabuSearchService = tabuSearchService;
        this.estadoDiarioCache = estadoDiarioCache;
        this.jdbc = jdbc;
    }

    @PostMapping("/pedido-manual")
    public Pedido registrarPedidoManual(@RequestBody PedidoManualDTO dto) {
        String origen = dto.getOrigen() != null ? dto.getOrigen().trim().toUpperCase() : "";
        String destino = dto.getDestino() != null ? dto.getDestino().trim().toUpperCase() : "";

        if (origen.length() != 4 || destino.length() != 4) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Los códigos deben tener 4 caracteres.");
        }
        if (origen.equals(destino)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Origen y destino no pueden ser iguales.");
        }

        Aeropuerto aeroOrigen = aeropuertoRepository.findById(origen)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aeropuerto origen no existe."));

        if (!aeropuertoRepository.existsById(destino)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aeropuerto destino no existe.");
        }

        java.time.ZonedDateTime ahoraUtc = java.time.ZonedDateTime.now(java.time.ZoneId.of("UTC"));
        LocalDateTime fechaHoraHusoOrigen = ahoraUtc.plusHours(aeroOrigen.getGmt()).toLocalDateTime();

        Pedido p = new Pedido();
        p.setIdPedido("MANUAL-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        p.setOrigen(origen);
        p.setDestino(destino);
        p.setCantidadMaletas(dto.getCantidadMaletas());
        p.setIdCliente(dto.getIdCliente());
        p.setFechaRegistro(fechaHoraHusoOrigen);

        jdbc.update(
                "INSERT INTO pedidos_diario (id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente) VALUES (?,?,?,?,?,?)",
                p.getIdPedido(),
                p.getOrigen(),
                p.getDestino(),
                p.getFechaRegistro(),
                p.getCantidadMaletas(),
                p.getIdCliente()
        );

        return p;
    }

    @DeleteMapping("/limpiar")
    public void limpiarEstado(@RequestParam(name = "fecha") String fecha) {
        estadoDiarioCache.limpiar(fecha);
        estadoDiarioCache.limpiarCancelados();
    }

    @PostMapping("/cancelar-vuelo")
    public Map<String, Object> cancelarVuelo(
            @RequestParam(name = "claveVuelo") String claveVuelo,
            @RequestParam(name = "horaActual", required = false) String horaActual) {
        // Misma lógica que SimulacionController: si hora actual > horaSalida - 60min → cancela mañana
        java.time.LocalDate fechaCancelacion;
        try {
            String[] partes = claveVuelo.split("-");
            java.time.LocalTime horaSalida = java.time.LocalTime.parse(partes[2],
                    java.time.format.DateTimeFormatter.ofPattern("HH:mm"));
            java.time.LocalTime ahora = horaActual != null
                    ? java.time.LocalTime.parse(horaActual.substring(11, 16))
                    : java.time.LocalTime.now();
            java.time.LocalTime corte = horaSalida.minusMinutes(60);
            fechaCancelacion = !ahora.isAfter(corte)
                    ? java.time.LocalDate.now()
                    : java.time.LocalDate.now().plusDays(1);
        } catch (Exception e) {
            fechaCancelacion = java.time.LocalDate.now().plusDays(1);
        }
        String claveConFecha = claveVuelo + "_" + fechaCancelacion;
        estadoDiarioCache.cancelarVuelo(claveConFecha);
        return Map.of("cancelado", claveConFecha, "fecha", fechaCancelacion.toString(),
                "mensaje", "Vuelo cancelado para " + fechaCancelacion);
    }

    @GetMapping("/ventana")
    public Solucion ejecutarVentanaDiaria(
            @RequestParam(name = "fechaInicioSimulacion") String fechaInicioSimulacionStr,
            @RequestParam(name = "fechaHoraActual") String fechaHoraActualStr,
            @RequestParam(name = "ventanaMinutos", defaultValue = "1") int ventanaMinutos
    ) {
        // La hora recibida viene en tiempo de Lima (ej: 00:41:00)
        LocalDateTime horaActualVirtual = LocalDateTime.parse(fechaHoraActualStr);
        LocalDateTime horaActualVirtualUtc = horaActualVirtual.plusHours(5);

        LocalDateTime inicioVentanaNuevos = horaActualVirtualUtc.minusMinutes(1);
        LocalDateTime finVentanaVirtual = horaActualVirtualUtc.plusMinutes(ventanaMinutos);

        List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        // 1. CARGA DE VUELOS PURA: Sin alteraciones artificiales de horas, excluyendo cancelados
        Set<String> cancelados = estadoDiarioCache.getVuelosCancelados();
        java.time.LocalDate fechaHoy = horaActualVirtual.toLocalDate();
        // Extraer claves sin fecha para comparar (ORIG-DEST-HH:MM)
        Set<String> clavesCanceladasHoy = cancelados.stream()
                .filter(c -> c.endsWith("_" + fechaHoy))
                .map(c -> c.substring(0, c.lastIndexOf('_')))
                .collect(Collectors.toSet());
        List<Vuelo> vuelos = vueloRepository.findAll().stream()
                .filter(v -> {
                    // Convertir hora local del aeropuerto a Lima (igual que el frontend) para comparar con claves canceladas
                    Aeropuerto orig = mapaAeros.get(v.getOrigen());
                    int gmt = orig != null ? orig.getGmt() : 0;
                    java.time.LocalTime horaSalidaLima = v.getHoraSalida().minusHours(gmt).minusHours(5);
                    String clave = v.getOrigen() + "-" + v.getDestino() + "-"
                            + String.format("%02d:%02d", horaSalidaLima.getHour(), horaSalidaLima.getMinute());
                    return !clavesCanceladasHoy.contains(clave);
                })
                .collect(java.util.stream.Collectors.toList());

        Solucion estadoAcumulado = estadoDiarioCache.obtener(fechaInicioSimulacionStr);

        // Guardar rutas previas para detectar replanificaciones tras cancelación
        Map<String, List<Vuelo>> rutasPrevias = new HashMap<>(estadoAcumulado.getRutasAsignadas());

        estadoAcumulado.getOcupacionVuelos().clear();
        estadoAcumulado.getOcupacionAeropuertos().clear();

        List<Pedido> pedidosManualesTotales = jdbc.query(
                "SELECT p.id_pedido, p.origen, p.destino, p.fecha_registro, p.cantidad_maletas, p.id_cliente " +
                        "FROM pedidos_diario p WHERE p.fecha_registro >= ? ORDER BY p.fecha_registro",
                PEDIDO_MAPPER,
                horaActualVirtual.minusHours(24));

        Solucion solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, pedidosManualesTotales, vuelos, aeropuertos, 20);

        // Detectar pedidos replanificados: cualquier pedido cuya ruta previa usaba un vuelo cancelado hoy
        Set<String> replanificados = new HashSet<>();
        if (!clavesCanceladasHoy.isEmpty()) {
            // Buscar en rutas previas (caché acumulado antes de esta optimización)
            for (Map.Entry<String, List<Vuelo>> e : rutasPrevias.entrySet()) {
                String pid = e.getKey();
                boolean usabaCancelado = e.getValue().stream().anyMatch(v -> {
                    Aeropuerto orig = mapaAeros.get(v.getOrigen());
                    int gmt = orig != null ? orig.getGmt() : 0;
                    java.time.LocalTime horaSalidaLima = v.getHoraSalida().minusHours(gmt).minusHours(5);
                    String cv = v.getOrigen() + "-" + v.getDestino() + "-"
                            + String.format("%02d:%02d", horaSalidaLima.getHour(), horaSalidaLima.getMinute());
                    return clavesCanceladasHoy.contains(cv);
                });
                if (usabaCancelado) replanificados.add(pid);
            }
            // También buscar en la nueva solución del optimizador
            for (Map.Entry<String, List<Vuelo>> e : solucionParcial.getRutasAsignadas().entrySet()) {
                String pid = e.getKey();
                if (replanificados.contains(pid)) continue;
                List<Vuelo> rutaAnterior = rutasPrevias.get(pid);
                if (rutaAnterior == null) continue;
                boolean anteriorUsabaCancelado = rutaAnterior.stream().anyMatch(v -> {
                    Aeropuerto orig = mapaAeros.get(v.getOrigen());
                    int gmt = orig != null ? orig.getGmt() : 0;
                    java.time.LocalTime horaSalidaLima = v.getHoraSalida().minusHours(gmt).minusHours(5);
                    String cv = v.getOrigen() + "-" + v.getDestino() + "-"
                            + String.format("%02d:%02d", horaSalidaLima.getHour(), horaSalidaLima.getMinute());
                    return clavesCanceladasHoy.contains(cv);
                });
                if (anteriorUsabaCancelado) replanificados.add(pid);
            }
        }
        solucionParcial.setPedidosReplanificados(replanificados);

        estadoAcumulado.getOcupacionVuelos().putAll(solucionParcial.getOcupacionVuelos());
        estadoAcumulado.getOcupacionAeropuertos().putAll(solucionParcial.getOcupacionAeropuertos());
        estadoAcumulado.getRutasAsignadas().putAll(solucionParcial.getRutasAsignadas());
        estadoAcumulado.getFechasTramos().putAll(solucionParcial.getFechasTramos());
        if (solucionParcial.getDetallesEnvios() != null)
            estadoAcumulado.getDetallesEnvios().putAll(solucionParcial.getDetallesEnvios());
        if (solucionParcial.getCapacidadesVuelos() != null)
            estadoAcumulado.getCapacidadesVuelos().putAll(solucionParcial.getCapacidadesVuelos());
        if (solucionParcial.getCapacidadesAeropuertos() != null)
            estadoAcumulado.setCapacidadesAeropuertos(solucionParcial.getCapacidadesAeropuertos());
        if (solucionParcial.getHorasLlegada() != null)
            estadoAcumulado.getHorasLlegada().putAll(solucionParcial.getHorasLlegada());

        Map<String, List<Vuelo>> rutasEnVivo = new HashMap<>();
        Map<String, List<Vuelo>> rutasPlanificadas = new HashMap<>();
        Map<String, Integer> ocupacionEnVivo = new HashMap<>();
        Map<String, Integer> capacidadesEnVivo = new HashMap<>();
        Map<String, String> horasLlegadaEnVivo = new HashMap<>();

        String normalForm = "%02d:%02d:%02d";

        for (Map.Entry<String, List<Vuelo>> entry : estadoAcumulado.getRutasAsignadas().entrySet()) {
            String pedidoId = entry.getKey();
            List<Vuelo> ruta = entry.getValue();
            List<String> fechasTramos = estadoAcumulado.getFechasTramos().getOrDefault(pedidoId, List.of());

            boolean hayTramoActivo = false;
            List<Vuelo> rutaParaFrontend = new ArrayList<>();

            for (int i = 0; i < ruta.size(); i++) {
                Vuelo v = ruta.get(i); // Uso directo del vuelo puro de la BD
                if (i >= fechasTramos.size()) break;

                Aeropuerto orig = mapaAeros.get(v.getOrigen());
                Aeropuerto dest = mapaAeros.get(v.getDestino());
                if (orig == null || dest == null) continue;

                long duracionMin = TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest);

                // 2. TRADUCCIÓN HORARIA AL RELOJ DE LIMA PARA EL MAPA (MapArea.tsx)
                java.time.LocalDate fechaOriginal = java.time.LocalDate.parse(fechasTramos.get(i));
                LocalDateTime salidaOriginalDateTime = LocalDateTime.of(fechaOriginal, v.getHoraSalida());

                LocalDateTime salidaLimaDateTime = salidaOriginalDateTime.minusHours(orig.getGmt()).minusHours(5);
                java.time.LocalTime horaSalidaLima = salidaLimaDateTime.toLocalTime();
                java.time.LocalDate fechaSalidaLima = salidaLimaDateTime.toLocalDate();

                LocalDateTime llegadaLimaDateTime = salidaOriginalDateTime.plusMinutes(duracionMin).minusHours(orig.getGmt()).minusHours(5);
                java.time.LocalTime horaLlegadaLima = llegadaLimaDateTime.toLocalTime();

                Vuelo vFrontend = new Vuelo();
                vFrontend.setId(v.getId());
                vFrontend.setOrigen(v.getOrigen());
                vFrontend.setDestino(v.getDestino());
                vFrontend.setCapacidadMax(v.getCapacidadMax());
                vFrontend.setHoraSalida(horaSalidaLima);
                vFrontend.setHoraLlegada(horaLlegadaLima);
                rutaParaFrontend.add(vFrontend);

                // 3. EVALUACIÓN DE RANGO EN EL SERVIDOR (Usando el huso horario del aeropuerto origen)
                LocalDateTime horaActualEnOrigen = horaActualVirtual.plusHours(5).plusHours(orig.getGmt());
                LocalDateTime salidaReal = LocalDateTime.of(fechaOriginal, v.getHoraSalida());
                LocalDateTime llegadaReal = salidaReal.plusMinutes(duracionMin);

                boolean enRango = !horaActualEnOrigen.isBefore(salidaReal.minusMinutes(2)) && !horaActualEnOrigen.isAfter(llegadaReal.plusMinutes(2));

                System.out.println("====== TRACKING EN VIVO (VUELOS REALES) ======");
                System.out.println("ID Pedido: " + pedidoId);
                System.out.println("Ruta: " + v.getOrigen() + " -> " + v.getDestino());
                System.out.println("Reloj Local en Origen: " + horaActualEnOrigen);
                System.out.println("Despegue Real en Origen: " + salidaReal);
                System.out.println("¿Entra en rango de vuelo?: " + enRango);
                System.out.println("==============================================");

                String hhmmOriginal = String.format(normalForm, v.getHoraSalida().getHour(), v.getHoraSalida().getMinute(), v.getHoraSalida().getSecond());
                String cacheKeyPrefix = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmOriginal + "_" + fechasTramos.get(i);
                String claveRutaOriginal = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmOriginal;

                String hhmmLima = String.format(normalForm, horaSalidaLima.getHour(), horaSalidaLima.getMinute(), horaSalidaLima.getSecond());
                String frontendKey = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmLima + "_" + fechaSalidaLima.toString();
                String claveRutaLima = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmLima;

                Integer value = estadoAcumulado.getOcupacionVuelos().get(cacheKeyPrefix);
                if (value == null) {
                    value = estadoAcumulado.getOcupacionVuelos().getOrDefault(claveRutaOriginal, 0);
                }
                Integer cap = v.getCapacidadMax();
                if (estadoAcumulado.getCapacidadesVuelos() != null && estadoAcumulado.getCapacidadesVuelos().containsKey(claveRutaOriginal)) {
                    cap = estadoAcumulado.getCapacidadesVuelos().get(claveRutaOriginal);
                }
                String horaLlegadaLimaStr = String.format(normalForm, horaLlegadaLima.getHour(), horaLlegadaLima.getMinute(), horaLlegadaLima.getSecond());

                // Siempre registrar ocupación, capacidad y hora llegada (en vivo Y en espera)
                ocupacionEnVivo.merge(frontendKey, value, Integer::sum);
                capacidadesEnVivo.put(claveRutaLima, cap);
                horasLlegadaEnVivo.put(claveRutaLima, horaLlegadaLimaStr);

                if (enRango) {
                    hayTramoActivo = true;
                }
            }

            rutasPlanificadas.put(pedidoId, rutaParaFrontend);
            if (hayTramoActivo) {
                rutasEnVivo.put(pedidoId, rutaParaFrontend);
            }
        }

        Solucion respuesta = new Solucion();
        respuesta.setRutasAsignadas(rutasEnVivo);
        respuesta.setOcupacionVuelos(ocupacionEnVivo);
        respuesta.setCapacidadesVuelos(capacidadesEnVivo);
        respuesta.setHorasLlegada(horasLlegadaEnVivo);

        respuesta.setRutasPlanificadas(rutasPlanificadas);
        // Normalizar claves de ocupacionAeropuertos: tomar solo el código (antes del primer '_')
        Map<String, Integer> ocupacionAeropuertosNorm = new HashMap<>();
        for (Map.Entry<String, Integer> e : estadoAcumulado.getOcupacionAeropuertos().entrySet()) {
            String codigoRaw = e.getKey();
            String codigo = codigoRaw.contains("_") ? codigoRaw.substring(0, codigoRaw.indexOf('_')) : codigoRaw;
            ocupacionAeropuertosNorm.merge(codigo, e.getValue(), Integer::sum);
        }
        respuesta.setOcupacionAeropuertos(ocupacionAeropuertosNorm);
        respuesta.setDetallesEnvios(new HashMap<>(estadoAcumulado.getDetallesEnvios()));
        respuesta.setFechasTramos(new HashMap<>(estadoAcumulado.getFechasTramos()));
        respuesta.setCapacidadesAeropuertos(estadoAcumulado.getCapacidadesAeropuertos());
        respuesta.setPedidosReplanificados(replanificados);
        respuesta.getOcupacionVuelos().put("__cancelados__", cancelados.size()); // señal al frontend

        return respuesta;
    }
}