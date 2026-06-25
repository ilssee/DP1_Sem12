package com.example.tasfb2b.controller;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.PedidoManualDTO;
import com.example.tasfb2b.model.Solucion;
import com.example.tasfb2b.model.Vuelo;
import com.example.tasfb2b.repository.AeropuertoRepository;
import com.example.tasfb2b.repository.PedidoRepository;
import com.example.tasfb2b.repository.VueloRepository;
import com.example.tasfb2b.service.TabuSearchService;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/diario")
@CrossOrigin(origins = "*")
public class OperacionesDiariasController {

    private final PedidoRepository pedidoRepository;
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

    public OperacionesDiariasController(PedidoRepository pedidoRepository,
                                        AeropuertoRepository aeropuertoRepository,
                                        VueloRepository vueloRepository,
                                        TabuSearchService tabuSearchService,
                                        JdbcTemplate jdbc) {
        this.pedidoRepository = pedidoRepository;
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.tabuSearchService = tabuSearchService;
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
        if (!aeropuertoRepository.existsById(origen) || !aeropuertoRepository.existsById(destino)) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Aeropuerto no existe.");
        }

        Pedido p = new Pedido();
        p.setIdPedido("MANUAL-" + UUID.randomUUID().toString().substring(0, 8).toUpperCase());
        p.setOrigen(origen);
        p.setDestino(destino);
        p.setCantidadMaletas(dto.getCantidadMaletas());
        p.setIdCliente(dto.getIdCliente());
        p.setFechaRegistro(LocalDateTime.parse(dto.getFechaHoraVirtual()));

        return pedidoRepository.save(p);
    }

    @GetMapping("/ventana")
    public Solucion ejecutarVentanaDiaria(
            @RequestParam(name = "fechaInicioSimulacion") String fechaInicioSimulacionStr,
            @RequestParam(name = "fechaHoraActual") String fechaHoraActualStr,
            @RequestParam(name = "ventanaMinutos", defaultValue = "5") int ventanaMinutos
    ) {
        LocalDateTime horaActualVirtual = LocalDateTime.parse(fechaHoraActualStr);
        LocalDateTime finVentanaVirtual = horaActualVirtual.plusMinutes(ventanaMinutos);
        LocalDateTime inicioHistorial = horaActualVirtual.minusDays(3);

        List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
        List<Vuelo> vuelos = vueloRepository.findAll();

        List<Pedido> pedidosDelPasadoSurgidosHoy = jdbc.query(
                "SELECT id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente " +
                        "FROM pedidos WHERE fecha_registro >= ? AND fecha_registro < ? ORDER BY fecha_registro",
                PEDIDO_MAPPER, inicioHistorial, horaActualVirtual);

        List<Pedido> pedidosNuevosVentana = jdbc.query(
                "SELECT id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente " +
                        "FROM pedidos WHERE fecha_registro >= ? AND fecha_registro < ? ORDER BY fecha_registro",
                PEDIDO_MAPPER, horaActualVirtual, finVentanaVirtual);

        Solucion solucion;

        // 1. EJECUCIÓN TABÚ
        if (pedidosNuevosVentana.isEmpty()) {
            solucion = tabuSearchService.ejecutarOptimizacion(pedidosDelPasadoSurgidosHoy, List.of(), vuelos, aeropuertos, 0);
        } else {
            solucion = tabuSearchService.ejecutarOptimizacion(pedidosDelPasadoSurgidosHoy, pedidosNuevosVentana, vuelos, aeropuertos, 20);
        }

        // --- EL NUEVO FILTRO LÓGICO DE TIEMPO REAL ---
        LocalTime horaReal = horaActualVirtual.toLocalTime();
        int minActual = horaReal.getHour() * 60 + horaReal.getMinute();

        Map<String, List<Vuelo>> rutasEnVivo = new java.util.HashMap<>();
        Map<String, Integer> ocupacionEnVivo = new java.util.HashMap<>();
        java.util.Set<String> vuelosActivosKey = new java.util.HashSet<>();

        for (Map.Entry<String, List<Vuelo>> entry : solucion.getRutasAsignadas().entrySet()) {
            boolean estaVolando = false;

            for (Vuelo v : entry.getValue()) {
                int minSalida = v.getHoraSalida().getHour() * 60 + v.getHoraSalida().getMinute();
                int minLlegada = v.getHoraLlegada().getHour() * 60 + v.getHoraLlegada().getMinute();
                if (minLlegada < minSalida) minLlegada += 1440;

                int actual = minActual;
                if (actual < minSalida && minLlegada >= 1440) actual += 1440;

                // Margen ampliado para que no desaparezcan justo al aterrizar
                if (actual >= (minSalida - 30) && actual <= (minLlegada + 30)) {
                    estaVolando = true;
                    // Formateamos la hora estrictamente a HH:mm para que haga match con el Tabú
                    String hhmm = String.format("%02d:%02d", v.getHoraSalida().getHour(), v.getHoraSalida().getMinute());
                    String prefijoVuelo = v.getOrigen() + "-" + v.getDestino() + "-" + hhmm;
                    vuelosActivosKey.add(prefijoVuelo);

                    // CORRECCIÓN DEL CERO: Buscamos la llave real que genera el Tabú
                    for (Map.Entry<String, Integer> oc : solucion.getOcupacionVuelos().entrySet()) {
                        if (oc.getKey().startsWith(prefijoVuelo)) {
                            ocupacionEnVivo.put(oc.getKey(), oc.getValue());
                        }
                    }
                }
            }
            if (estaVolando) {
                rutasEnVivo.put(entry.getKey(), entry.getValue());
            }
        }

        solucion.setRutasAsignadas(rutasEnVivo);

        // Capacidades (las guardamos usando el prefijo)
        solucion.setCapacidadesVuelos(solucion.getCapacidadesVuelos().entrySet().stream()
                .filter(e -> vuelosActivosKey.stream().anyMatch(prefijo -> e.getKey().startsWith(prefijo)))
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));

        // 3. Top 10 Ocupación Vuelos (¡Ahora con los valores verdaderos!)
        solucion.setOcupacionVuelos(ocupacionEnVivo.entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .limit(10)
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));

        // 4. Top 10 Cuellos de Botella
        solucion.setOcupacionAeropuertos(solucion.getOcupacionAeropuertos().entrySet().stream()
                .sorted((a, b) -> b.getValue().compareTo(a.getValue()))
                .limit(10)
                .collect(java.util.stream.Collectors.toMap(Map.Entry::getKey, Map.Entry::getValue)));

        return solucion;
    }
}