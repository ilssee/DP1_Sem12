package com.example.tasfb2b.service;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.Vuelo;
import com.example.tasfb2b.repository.AeropuertoRepository;
import com.example.tasfb2b.repository.PedidoRepository;
import com.example.tasfb2b.repository.VueloRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.util.List;

@Service
public class DataCargaService {

    private static final int BATCH_SIZE = 500;

    private final AeropuertoRepository aeropuertoRepository;
    private final VueloRepository vueloRepository;
    private final PedidoRepository pedidoRepository;
    private final LectorArchivosService lector;
    private final JdbcTemplate jdbc;

    public DataCargaService(AeropuertoRepository aeropuertoRepository,
                            VueloRepository vueloRepository,
                            PedidoRepository pedidoRepository,
                            LectorArchivosService lector,
                            JdbcTemplate jdbc) {
        this.aeropuertoRepository = aeropuertoRepository;
        this.vueloRepository = vueloRepository;
        this.pedidoRepository = pedidoRepository;
        this.lector = lector;
        this.jdbc = jdbc;
    }

    @Transactional
    public int cargarAeropuertos(MultipartFile archivo) throws IOException {
        List<Aeropuerto> aeropuertos = lector.leerAeropuertosDesdeStream(archivo.getInputStream());
        aeropuertoRepository.deleteAllInBatch();
        jdbc.batchUpdate(
            "INSERT INTO aeropuertos (codigo, nombre, pais, continente, gmt, capacidad_max, latitud, longitud) VALUES (?,?,?,?,?,?,?,?)",
            aeropuertos,
            BATCH_SIZE,
            (ps, a) -> {
                ps.setString(1, a.getCodigo());
                ps.setString(2, a.getNombre());
                ps.setString(3, a.getPais());
                ps.setString(4, a.getContinente());
                ps.setInt(5, a.getGmt());
                ps.setInt(6, a.getCapacidadMax());
                ps.setDouble(7, a.getLatitud());
                ps.setDouble(8, a.getLongitud());
            }
        );
        return aeropuertos.size();
    }

    @Transactional
    public int cargarVuelos(MultipartFile archivo) throws IOException {
        List<Vuelo> vuelos = lector.leerVuelosDesdeStream(archivo.getInputStream());
        vueloRepository.deleteAllInBatch();
        jdbc.batchUpdate(
            "INSERT INTO vuelos (origen, destino, hora_salida, hora_llegada, capacidad_max) VALUES (?,?,?,?,?)",
            vuelos,
            BATCH_SIZE,
            (ps, v) -> {
                ps.setString(1, v.getOrigen());
                ps.setString(2, v.getDestino());
                ps.setObject(3, v.getHoraSalida());
                ps.setObject(4, v.getHoraLlegada());
                ps.setInt(5, v.getCapacidadMax());
            }
        );
        return vuelos.size();
    }

    @Transactional
    public int cargarEnvios(MultipartFile[] archivos) throws IOException {
        int total = 0;
        for (MultipartFile archivo : archivos) {
            List<Pedido> pedidos = lector.leerEnviosDesdeStream(
                    archivo.getInputStream(),
                    archivo.getOriginalFilename()
            );
            jdbc.batchUpdate(
                "INSERT IGNORE INTO pedidos (id_pedido, origen, destino, fecha_registro, cantidad_maletas, id_cliente) VALUES (?,?,?,?,?,?)",
                pedidos,
                BATCH_SIZE,
                (ps, p) -> {
                    ps.setString(1, p.getIdPedido());
                    ps.setString(2, p.getOrigen());
                    ps.setString(3, p.getDestino());
                    ps.setObject(4, p.getFechaRegistro());
                    ps.setInt(5, p.getCantidadMaletas());
                    ps.setString(6, p.getIdCliente());
                }
            );
            total += pedidos.size();
        }
        return total;
    }
}
