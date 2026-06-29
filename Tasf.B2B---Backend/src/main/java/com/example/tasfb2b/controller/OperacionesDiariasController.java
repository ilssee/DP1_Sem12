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
        LocalDateTime horaActualVirtual = LocalDateTime.parse(fechaHoraActualStr);

        // Margen de seguridad: retrocedemos 1 minuto para capturar pedidos tardíos
        LocalDateTime inicioVentanaNuevos = horaActualVirtual.minusMinutes(1);
        LocalDateTime finVentanaVirtual = horaActualVirtual.plusMinutes(ventanaMinutos);

        List<Aeropuerto> aeropuertos = aeropuertoRepository.findAll();
        List<Vuelo> vuelos = vueloRepository.findAll();
        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        // Recuperar estado acumulado del día
        Solucion estadoAcumulado = estadoDiarioCache.obtener(fechaInicioSimulacionStr);

        // Pedidos nuevos de esta ventana (solo MANUALES)
        List<Pedido> pedidosNuevosVentana = jdbc.query(
                "SELECT id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente " +
                        "FROM pedidos WHERE fecha_registro >= ? AND fecha_registro < ? " +
                        "AND id_pedido LIKE 'MANUAL-%' ORDER BY fecha_registro",
                PEDIDO_MAPPER, inicioVentanaNuevos, finVentanaVirtual);

        // Ejecutar Tabu Search pasando el estado acumulado como base
        Solucion solucionParcial;
        if (pedidosNuevosVentana.isEmpty()) {
            solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, List.of(), vuelos, aeropuertos, 0);
        } else {
            solucionParcial = tabuSearchService.ejecutarOptimizacionConEstado(estadoAcumulado, pedidosNuevosVentana, vuelos, aeropuertos, 20);
        }

        // Acumular rutas, ocupaciones y fechas en el estado del día
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

        // Filtrar rutas activas ahora usando LocalDateTime completo (con fecha real por pedido)
        Map<String, List<Vuelo>> rutasEnVivo = new HashMap<>();
        Map<String, Integer> ocupacionEnVivo = new HashMap<>();
        Set<String> vuelosActivosKey = new HashSet<>();

        for (Map.Entry<String, List<Vuelo>> entry : estadoAcumulado.getRutasAsignadas().entrySet()) {
            String pedidoId = entry.getKey();
            List<Vuelo> ruta = entry.getValue();

            // Reconstruir fechaHora real de cada tramo acumulando desde fechasTramos
            List<String> fechasTramos = estadoAcumulado.getFechasTramos().getOrDefault(pedidoId, List.of());

            boolean hayTramoActivo = false;
            for (int i = 0; i < ruta.size(); i++) {
                Vuelo v = ruta.get(i);
                if (i >= fechasTramos.size()) break;

                // Fecha real de salida de este tramo viene de fechasTramos
                LocalDateTime salidaReal = LocalDateTime.of(
                        java.time.LocalDate.parse(fechasTramos.get(i)), v.getHoraSalida());

                Aeropuerto orig = mapaAeros.get(v.getOrigen());
                Aeropuerto dest = mapaAeros.get(v.getDestino());
                if (orig == null || dest == null) continue;

                long duracionMin = TimeCalculator.calcularDuracionVueloMinutos(v, orig, dest);
                LocalDateTime llegadaReal = salidaReal.plusMinutes(duracionMin);

                // Margen de ±2 min para no perder el avión justo al cambiar de minuto
                if (!horaActualVirtual.isBefore(salidaReal.minusMinutes(2)) &&
                    !horaActualVirtual.isAfter(llegadaReal.plusMinutes(2))) {

                    hayTramoActivo = true;
                    String hhmm = String.format("%02d:%02d:%02d",
                            v.getHoraSalida().getHour(),
                            v.getHoraSalida().getMinute(),
                            v.getHoraSalida().getSecond());
                    String prefijoVuelo = v.getOrigen() + "-" + v.getDestino() + "-" + hhmm;
                    vuelosActivosKey.add(prefijoVuelo);

                    for (Map.Entry<String, Integer> oc : estadoAcumulado.getOcupacionVuelos().entrySet()) {
                        if (oc.getKey().startsWith(v.getOrigen() + "-" + v.getDestino() + "-" + hhmm)) {
                            ocupacionEnVivo.put(oc.getKey(), oc.getValue());
                        }
                    }
                }
            }
            if (hayTramoActivo) {
                rutasEnVivo.put(pedidoId, ruta);
            }
        }

        // Construir solucion de respuesta con estado acumulado completo + filtro en vivo
        Solucion respuesta = new Solucion();
        respuesta.setRutasAsignadas(rutasEnVivo);
        respuesta.setOcupacionVuelos(ocupacionEnVivo);
        respuesta.setOcupacionAeropuertos(new HashMap<>(estadoAcumulado.getOcupacionAeropuertos()));
        respuesta.setDetallesEnvios(new HashMap<>(estadoAcumulado.getDetallesEnvios()));
        respuesta.setFechasTramos(new HashMap<>(estadoAcumulado.getFechasTramos()));
        respuesta.setCapacidadesVuelos(new HashMap<>(estadoAcumulado.getCapacidadesVuelos() != null
                ? estadoAcumulado.getCapacidadesVuelos() : Map.of()));
        respuesta.setCapacidadesAeropuertos(estadoAcumulado.getCapacidadesAeropuertos());

        return respuesta;
    }
}
