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

        // 1. CARGA DE VUELOS PURA: Sin alteraciones artificiales de horas
        List<Vuelo> vuelos = vueloRepository.findAll();

        Solucion estadoAcumulado = estadoDiarioCache.obtener(fechaInicioSimulacionStr);

        estadoAcumulado.getOcupacionVuelos().clear();
        estadoAcumulado.getOcupacionAeropuertos().clear();

        List<Pedido> pedidosManualesTotales = jdbc.query(
                "SELECT p.id_pedido, p.origen, p.destino, p.fecha_registro, p.cantidad_maletas, p.id_cliente " +
                        "FROM pedidos_diario p WHERE p.fecha_registro >= ? ORDER BY p.fecha_registro",
                PEDIDO_MAPPER,
                horaActualVirtual.minusHours(24));

        Solucion solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, pedidosManualesTotales, vuelos, aeropuertos, 20);

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

                if (enRango) {
                    hayTramoActivo = true;

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
                    ocupacionEnVivo.put(frontendKey, value);

                    Integer cap = v.getCapacidadMax();
                    if (estadoAcumulado.getCapacidadesVuelos() != null && estadoAcumulado.getCapacidadesVuelos().containsKey(claveRutaOriginal)) {
                        cap = estadoAcumulado.getCapacidadesVuelos().get(claveRutaOriginal);
                    }
                    capacidadesEnVivo.put(claveRutaLima, cap);

                    String horaLlegadaLimaStr = String.format(normalForm, horaLlegadaLima.getHour(), horaLlegadaLima.getMinute(), horaLlegadaLima.getSecond());
                    horasLlegadaEnVivo.put(claveRutaLima, horaLlegadaLimaStr);
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
        respuesta.setOcupacionAeropuertos(new HashMap<>(estadoAcumulado.getOcupacionAeropuertos()));
        respuesta.setDetallesEnvios(new HashMap<>(estadoAcumulado.getDetallesEnvios()));
        respuesta.setFechasTramos(new HashMap<>(estadoAcumulado.getFechasTramos()));
        respuesta.setCapacidadesAeropuertos(estadoAcumulado.getCapacidadesAeropuertos());

        return respuesta;
    }
}