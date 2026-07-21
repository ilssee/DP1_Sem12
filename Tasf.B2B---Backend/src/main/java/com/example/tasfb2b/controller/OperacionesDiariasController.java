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
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
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
    private final SimpMessagingTemplate messagingTemplate; // <-- EL MEGÁFONO WEBSOCKET

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
                                        JdbcTemplate jdbc,
                                        SimpMessagingTemplate messagingTemplate) {
        this.pedidoRepository = pedidoRepository;
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.tabuSearchService = tabuSearchService;
        this.estadoDiarioCache = estadoDiarioCache;
        this.jdbc = jdbc;
        this.messagingTemplate = messagingTemplate;
    }

    // NUEVO ENDPOINT: Devuelve los pedidos del día para la barra lateral del mapa
    @GetMapping("/pedidos-hoy")
    public List<Pedido> obtenerPedidosHoy(@RequestParam(name = "fechaHoraActual") String fechaHoraActualStr) {
        LocalDateTime horaActualVirtual = LocalDateTime.parse(fechaHoraActualStr);
        return jdbc.query(
                "SELECT p.id_pedido, p.origen, p.destino, p.fecha_registro, p.cantidad_maletas, p.id_cliente " +
                        "FROM pedidos_diario p WHERE p.fecha_registro >= ? ORDER BY p.fecha_registro DESC",
                PEDIDO_MAPPER,
                horaActualVirtual.minusHours(24)
        );
    }

    @PostMapping("/pedido-manual")
    public Pedido registrarPedidoManual(@RequestBody PedidoManualDTO dto) {
        String origen = dto.getOrigen() != null ? dto.getOrigen().trim().toUpperCase() : "";
        String destino = dto.getDestino() != null ? dto.getDestino().trim().toUpperCase() : "";

        if (origen.length() != 4 || destino.length() != 4) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Los códigos deben tener 4 caracteres.");
        if (origen.equals(destino)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Origen y destino no pueden ser iguales.");

        Aeropuerto aeroOrigen = aeropuertoRepository.findById(origen).orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aeropuerto origen no existe."));
        if (!aeropuertoRepository.existsById(destino)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aeropuerto destino no existe.");

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
                p.getIdPedido(), p.getOrigen(), p.getDestino(), p.getFechaRegistro(), p.getCantidadMaletas(), p.getIdCliente()
        );

        // AVISO WEBSOCKET: Actualiza todos los navegadores conectados
        messagingTemplate.convertAndSend("/topic/operaciones-diarias", "ACTUALIZAR");

        return p;
    }

    @PostMapping("/pedidos-archivo")
    public ResponseEntity<Map<String, Object>> cargarPedidosDiariosPorArchivo(
            @RequestParam("archivo") MultipartFile archivo,
            @RequestParam("origen") String origen,
            @RequestParam(value = "fechaBase", required = false) String fechaBaseString) {

        try {
            LocalDate fechaBase = (fechaBaseString != null && !fechaBaseString.isEmpty())
                    ? LocalDate.parse(fechaBaseString) : LocalDate.now();
            String diaString = String.format("%02d", fechaBase.getDayOfMonth());

            List<Object[]> batchArgs = new ArrayList<>();

            try (BufferedReader br = new BufferedReader(new InputStreamReader(archivo.getInputStream(), StandardCharsets.UTF_8))) {
                String linea;
                while ((linea = br.readLine()) != null) {
                    linea = linea.trim();
                    if (linea.isEmpty()) continue;

                    String[] partes = linea.split("-");
                    if (partes.length < 7) continue;

                    String idPedido = partes[0].trim();
                    String fechaTexto = partes[1].trim();
                    String horaTexto = partes[2].trim();
                    String minutoTexto = partes[3].trim();
                    String destino = partes[4].trim().toUpperCase();
                    int cantidadMaletas = Integer.parseInt(partes[5].trim());
                    String idCliente = partes[6].trim();

                    if (fechaTexto.contains("##")) {
                        fechaTexto = fechaTexto.replace("##", diaString);
                    }

                    String fechaRegistroStr = fechaTexto + " " + horaTexto + ":" + minutoTexto + ":00";
                    DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyyMMdd HH:mm:ss");
                    LocalDateTime fechaRegistro = LocalDateTime.parse(fechaRegistroStr, formatter);

                    batchArgs.add(new Object[]{ idPedido, origen, destino, fechaRegistro, cantidadMaletas, idCliente });
                }
            }

            String sql = "INSERT IGNORE INTO pedidos_diario (id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente) VALUES (?, ?, ?, ?, ?, ?)";
            jdbc.batchUpdate(sql, batchArgs);

            // AVISO WEBSOCKET: Actualiza todos los mapas instantáneamente
            messagingTemplate.convertAndSend("/topic/operaciones-diarias", "ACTUALIZAR");

            return ResponseEntity.ok(Map.of("mensaje", "Envíos cargados correctamente", "registros", batchArgs.size()));

        } catch (Exception e) {
            e.printStackTrace();
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("mensaje", "Error al procesar el archivo: " + e.getMessage(), "registros", 0));
        }
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
        java.time.LocalDate fechaCancelacion;
        try {
            String[] partes = claveVuelo.split("-");
            java.time.LocalTime horaSalida = java.time.LocalTime.parse(partes[2], java.time.format.DateTimeFormatter.ofPattern("HH:mm"));
            java.time.LocalTime ahora = horaActual != null ? java.time.LocalTime.parse(horaActual.substring(11, 16)) : java.time.LocalTime.now();
            java.time.LocalTime corte = horaSalida.minusMinutes(60);
            fechaCancelacion = !ahora.isAfter(corte) ? java.time.LocalDate.now() : java.time.LocalDate.now().plusDays(1);
        } catch (Exception e) {
            fechaCancelacion = java.time.LocalDate.now().plusDays(1);
        }
        String claveConFecha = claveVuelo + "_" + fechaCancelacion;
        estadoDiarioCache.cancelarVuelo(claveConFecha);

        // AVISO WEBSOCKET: Actualiza todos los navegadores
        messagingTemplate.convertAndSend("/topic/operaciones-diarias", "ACTUALIZAR");

        return Map.of("cancelado", claveConFecha, "fecha", fechaCancelacion.toString(), "mensaje", "Vuelo cancelado para " + fechaCancelacion);
    }

    @GetMapping("/ventana")
    public Solucion ejecutarVentanaDiaria(
            @RequestParam(name = "fechaInicioSimulacion") String fechaInicioSimulacionStr,
            @RequestParam(name = "fechaHoraActual") String fechaHoraActualStr,
            @RequestParam(name = "ventanaMinutos", defaultValue = "1") int ventanaMinutos
    ) {
        LocalDateTime horaActualVirtual = LocalDateTime.parse(fechaHoraActualStr);
        LocalDateTime horaActualVirtualUtc = horaActualVirtual.plusHours(5);

        List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        Set<String> cancelados = estadoDiarioCache.getVuelosCancelados();
        java.time.LocalDate fechaHoy = horaActualVirtual.toLocalDate();
        Set<String> clavesCanceladasHoy = cancelados.stream()
                .filter(c -> c.endsWith("_" + fechaHoy))
                .map(c -> c.substring(0, c.lastIndexOf('_')))
                .collect(Collectors.toSet());
        List<Vuelo> vuelos = vueloRepository.findAll().stream()
                .filter(v -> {
                    Aeropuerto orig = mapaAeros.get(v.getOrigen());
                    int gmt = orig != null ? orig.getGmt() : 0;
                    java.time.LocalTime horaSalidaLima = v.getHoraSalida().minusHours(gmt).minusHours(5);
                    String clave = v.getOrigen() + "-" + v.getDestino() + "-"
                            + String.format("%02d:%02d", horaSalidaLima.getHour(), horaSalidaLima.getMinute());
                    return !clavesCanceladasHoy.contains(clave);
                })
                .collect(java.util.stream.Collectors.toList());

        Solucion estadoAcumulado = estadoDiarioCache.obtener(fechaInicioSimulacionStr);

        List<Pedido> pedidosManualesTotales = jdbc.query(
                "SELECT p.id_pedido, p.origen, p.destino, p.fecha_registro, p.cantidad_maletas, p.id_cliente " +
                        "FROM pedidos_diario p WHERE p.fecha_registro >= ? ORDER BY p.fecha_registro",
                PEDIDO_MAPPER,
                horaActualVirtual.minusHours(24));

        Map<String, Pedido> pedidoMap = pedidosManualesTotales.stream()
                .collect(Collectors.toMap(Pedido::getIdPedido, p -> p, (a, b) -> a));

        // Pedidos cuya ruta actual usa un vuelo cancelado → hay que re-enrutarlos
        Set<String> idsAfectados = new HashSet<>();
        if (!clavesCanceladasHoy.isEmpty()) {
            for (Map.Entry<String, List<Vuelo>> e : estadoAcumulado.getRutasAsignadas().entrySet()) {
                boolean usaCancelado = e.getValue().stream().anyMatch(v -> {
                    Aeropuerto orig = mapaAeros.get(v.getOrigen());
                    int gmt = orig != null ? orig.getGmt() : 0;
                    java.time.LocalTime hl = v.getHoraSalida().minusHours(gmt).minusHours(5);
                    String cv = v.getOrigen() + "-" + v.getDestino() + "-" + String.format("%02d:%02d", hl.getHour(), hl.getMinute());
                    return clavesCanceladasHoy.contains(cv);
                });
                if (usaCancelado) idsAfectados.add(e.getKey());
            }
        }

        // Pedidos que aún no tienen ruta asignada
        List<Pedido> pedidosNuevos = pedidosManualesTotales.stream()
                .filter(p -> !estadoAcumulado.getRutasAsignadas().containsKey(p.getIdPedido()))
                .collect(Collectors.toList());

        // Reconstruir ocupacionVuelos desde las rutas existentes (sin los afectados),
        // para que el BFS vea la capacidad real antes de enrutar los pedidos nuevos.
        estadoAcumulado.getOcupacionVuelos().clear();
        estadoAcumulado.getOcupacionAeropuertos().clear();
        String fmtKey = "%02d:%02d:%02d";
        for (Map.Entry<String, List<Vuelo>> entry : estadoAcumulado.getRutasAsignadas().entrySet()) {
            String pid = entry.getKey();
            if (idsAfectados.contains(pid)) continue;
            Pedido p = pedidoMap.get(pid);
            if (p == null) continue;
            List<String> fechas = estadoAcumulado.getFechasTramos().getOrDefault(pid, List.of());
            List<Vuelo> ruta = entry.getValue();
            for (int i = 0; i < ruta.size() && i < fechas.size(); i++) {
                Vuelo v = ruta.get(i);
                String key = v.getOrigen() + "-" + v.getDestino() + "-"
                        + String.format(fmtKey, v.getHoraSalida().getHour(), v.getHoraSalida().getMinute(), v.getHoraSalida().getSecond())
                        + "_" + fechas.get(i);
                estadoAcumulado.getOcupacionVuelos().merge(key, p.getCantidadMaletas(), Integer::sum);
            }
        }

        // Ejecutar Tabu SOLO sobre pedidos nuevos + afectados por cancelación
        List<Pedido> pedidosParaTabu = new ArrayList<>(pedidosNuevos);
        for (String id : idsAfectados) {
            Pedido p = pedidoMap.get(id);
            if (p != null) pedidosParaTabu.add(p);
        }

        Set<String> replanificados = new HashSet<>(idsAfectados);
        Solucion solucionParcial;
        if (!pedidosParaTabu.isEmpty()) {
            solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(
                    estadoAcumulado, pedidosParaTabu, vuelos, aeropuertos, 20);
        } else {
            solucionParcial = new Solucion();
        }
        solucionParcial.setPedidosReplanificados(replanificados);

        estadoAcumulado.getOcupacionVuelos().putAll(solucionParcial.getOcupacionVuelos());
        estadoAcumulado.getOcupacionAeropuertos().putAll(solucionParcial.getOcupacionAeropuertos());
        estadoAcumulado.getRutasAsignadas().putAll(solucionParcial.getRutasAsignadas());
        estadoAcumulado.getFechasTramos().putAll(solucionParcial.getFechasTramos());
        if (solucionParcial.getDetallesEnvios() != null) estadoAcumulado.getDetallesEnvios().putAll(solucionParcial.getDetallesEnvios());
        if (solucionParcial.getCapacidadesVuelos() != null) estadoAcumulado.getCapacidadesVuelos().putAll(solucionParcial.getCapacidadesVuelos());
        if (solucionParcial.getHorasLlegada() != null) estadoAcumulado.getHorasLlegada().putAll(solucionParcial.getHorasLlegada());

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
                Vuelo v = ruta.get(i);
                if (i >= fechasTramos.size()) break;

                Aeropuerto orig = mapaAeros.get(v.getOrigen());
                Aeropuerto dest = mapaAeros.get(v.getDestino());
                if (orig == null || dest == null) continue;

                long duracionMin = TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest);
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

                LocalDateTime horaActualEnOrigen = horaActualVirtual.plusHours(5).plusHours(orig.getGmt());
                LocalDateTime salidaReal = LocalDateTime.of(fechaOriginal, v.getHoraSalida());
                LocalDateTime llegadaReal = salidaReal.plusMinutes(duracionMin);

                boolean enRango = !horaActualEnOrigen.isBefore(salidaReal.minusMinutes(2)) && !horaActualEnOrigen.isAfter(llegadaReal.plusMinutes(2));

                String hhmmOriginal = String.format(normalForm, v.getHoraSalida().getHour(), v.getHoraSalida().getMinute(), v.getHoraSalida().getSecond());
                String cacheKeyPrefix = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmOriginal + "_" + fechasTramos.get(i);
                String claveRutaOriginal = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmOriginal;

                String hhmmLima = String.format(normalForm, horaSalidaLima.getHour(), horaSalidaLima.getMinute(), horaSalidaLima.getSecond());
                String frontendKey = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmLima + "_" + fechaSalidaLima.toString();
                String claveRutaLima = v.getOrigen() + "-" + v.getDestino() + "-" + hhmmLima;

                Integer value = estadoAcumulado.getOcupacionVuelos().get(cacheKeyPrefix);
                if (value == null) value = estadoAcumulado.getOcupacionVuelos().getOrDefault(claveRutaOriginal, 0);

                Integer cap = v.getCapacidadMax();
                if (estadoAcumulado.getCapacidadesVuelos() != null && estadoAcumulado.getCapacidadesVuelos().containsKey(claveRutaOriginal)) {
                    cap = estadoAcumulado.getCapacidadesVuelos().get(claveRutaOriginal);
                }
                String horaLlegadaLimaStr = String.format(normalForm, horaLlegadaLima.getHour(), horaLlegadaLima.getMinute(), horaLlegadaLima.getSecond());

                // El valor del cache ya es el total del vuelo (acumulado por todos los pedidos).
                // Usar put en lugar de merge para evitar sumar el total N veces
                // (una por cada pedido que usa el vuelo), lo que triplicaría el conteo.
                ocupacionEnVivo.put(frontendKey, value);
                capacidadesEnVivo.put(claveRutaLima, cap);
                horasLlegadaEnVivo.put(claveRutaLima, horaLlegadaLimaStr);

                if (enRango) hayTramoActivo = true;
            }

            rutasPlanificadas.put(pedidoId, rutaParaFrontend);
            if (hayTramoActivo) rutasEnVivo.put(pedidoId, rutaParaFrontend);
        }

        Solucion respuesta = new Solucion();
        respuesta.setRutasAsignadas(rutasEnVivo);
        respuesta.setOcupacionVuelos(ocupacionEnVivo);
        respuesta.setCapacidadesVuelos(capacidadesEnVivo);
        respuesta.setHorasLlegada(horasLlegadaEnVivo);
        respuesta.setRutasPlanificadas(rutasPlanificadas);

        // Ocupación real de aeropuertos: dónde están físicamente las maletas en este instante virtual.
        // Para cada pedido, recorre su ruta en UTC y determina si está esperando en un aeropuerto
        // (antes de salir, o en escala) o en tránsito (en vuelo). Solo los que esperan se contabilizan.
        Map<String, Integer> ocupacionAeropuertosRT = new HashMap<>();
        for (Map.Entry<String, List<Vuelo>> entry : estadoAcumulado.getRutasAsignadas().entrySet()) {
            String pedidoId = entry.getKey();
            List<Vuelo> ruta = entry.getValue();
            List<String> fechas = estadoAcumulado.getFechasTramos().getOrDefault(pedidoId, List.of());
            Pedido pedido = pedidoMap.get(pedidoId);
            if (pedido == null || ruta.isEmpty() || fechas.isEmpty()) continue;

            int maletas = pedido.getCantidadMaletas();
            String ubicacionActual = ruta.get(0).getOrigen(); // por defecto: en origen, aún no salió
            boolean enTransito = false;

            for (int i = 0; i < ruta.size() && i < fechas.size(); i++) {
                Vuelo v = ruta.get(i);
                Aeropuerto orig = mapaAeros.get(v.getOrigen());
                Aeropuerto dest = mapaAeros.get(v.getDestino());
                if (orig == null || dest == null) break;

                long duracion = TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest);
                LocalDateTime salidaUTC = LocalDateTime.of(java.time.LocalDate.parse(fechas.get(i)), v.getHoraSalida())
                        .minusHours(orig.getGmt());
                LocalDateTime llegadaUTC = salidaUTC.plusMinutes(duracion);

                if (horaActualVirtualUtc.isBefore(salidaUTC)) {
                    // Aún no ha salido en este tramo — las maletas siguen en ubicacionActual
                    enTransito = false;
                    break;
                } else if (horaActualVirtualUtc.isBefore(llegadaUTC)) {
                    // En vuelo en este tramo
                    ubicacionActual = null;
                    enTransito = true;
                    break;
                } else {
                    // Ya aterrizó en el destino de este tramo
                    ubicacionActual = v.getDestino();
                    enTransito = false;
                }
            }

            if (!enTransito && ubicacionActual != null) {
                ocupacionAeropuertosRT.merge(ubicacionActual, maletas, Integer::sum);
            }
        }
        respuesta.setOcupacionAeropuertos(ocupacionAeropuertosRT);
        respuesta.setDetallesEnvios(new HashMap<>(estadoAcumulado.getDetallesEnvios()));
        respuesta.setFechasTramos(new HashMap<>(estadoAcumulado.getFechasTramos()));

        // Llenar capacidadesAeropuertos desde los datos reales de BD (mapaAeros.capacidadMax)
        Map<String, Integer> capacidadesAeroMap = new HashMap<>();
        for (Map.Entry<String, Aeropuerto> ae : mapaAeros.entrySet()) {
            capacidadesAeroMap.put(ae.getKey(), ae.getValue().getCapacidadMax());
        }
        respuesta.setCapacidadesAeropuertos(capacidadesAeroMap);
        respuesta.setPedidosReplanificados(replanificados);
        respuesta.getOcupacionVuelos().put("__cancelados__", cancelados.size());

        return respuesta;
    }
}