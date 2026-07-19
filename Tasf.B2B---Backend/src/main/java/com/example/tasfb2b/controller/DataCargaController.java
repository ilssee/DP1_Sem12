package com.example.tasfb2b.controller;

import com.example.tasfb2b.service.DataCargaService;
import com.example.tasfb2b.repository.AeropuertoRepository;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/datos")
@CrossOrigin(origins = "*")
public class DataCargaController {

    private final DataCargaService dataCargaService;
    private final AeropuertoRepository aeropuertoRepository;

    public DataCargaController(DataCargaService dataCargaService, AeropuertoRepository aeropuertoRepository) {
        this.dataCargaService = dataCargaService;
        this.aeropuertoRepository = aeropuertoRepository;
    }

    @PostMapping("/aeropuertos")
    public ResponseEntity<Map<String, Object>> cargarAeropuertos(
            @RequestParam("archivo") MultipartFile archivo) {
        try {
            int count = dataCargaService.cargarAeropuertos(archivo);
            return ResponseEntity.ok(Map.of("mensaje", "Aeropuertos cargados correctamente", "registros", count));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("mensaje", "Error al cargar aeropuertos: " + e.getMessage(), "registros", 0));
        }
    }

    @PostMapping("/vuelos")
    public ResponseEntity<Map<String, Object>> cargarVuelos(
            @RequestParam("archivo") MultipartFile archivo) {
        try {
            int count = dataCargaService.cargarVuelos(archivo);
            return ResponseEntity.ok(Map.of("mensaje", "Vuelos cargados correctamente", "registros", count));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("mensaje", "Error al cargar vuelos: " + e.getMessage(), "registros", 0));
        }
    }

    @PostMapping("/envios")
    public ResponseEntity<Map<String, Object>> cargarEnvios(
            @RequestParam("archivos") MultipartFile[] archivos) {
        try {
            int count = dataCargaService.cargarEnvios(archivos);
            return ResponseEntity.ok(Map.of("mensaje", "Envíos cargados correctamente", "registros", count));
        } catch (Exception e) {
            return ResponseEntity.internalServerError()
                    .body(Map.of("mensaje", "Error al cargar envíos: " + e.getMessage(), "registros", 0));
        }
    }

    @GetMapping("/aeropuertos/todos")
    public ResponseEntity<List<Map<String, Object>>> listarAeropuertos() {
        List<Map<String, Object>> lista = aeropuertoRepository.findAll().stream()
                .map(a -> Map.<String, Object>of(
                        "codigo", a.getCodigo(),
                        "nombre", a.getNombre() != null ? a.getNombre() : "",
                        "pais", a.getPais() != null ? a.getPais() : "",
                        "gmt", a.getGmt(),
                        "capacidadMax", a.getCapacidadMax()
                ))
                .sorted((a, b) -> ((String) a.get("codigo")).compareTo((String) b.get("codigo")))
                .toList();
        return ResponseEntity.ok(lista);
    }

    @PutMapping("/aeropuertos/{codigo}/capacidad")
    public ResponseEntity<Map<String, Object>> actualizarCapacidad(
            @PathVariable String codigo,
            @RequestBody Map<String, Integer> body) {
        Integer nuevaCapacidad = body.get("capacidadMax");
        if (nuevaCapacidad == null || nuevaCapacidad < 0) {
            return ResponseEntity.badRequest().body(Map.of("mensaje", "Capacidad inválida"));
        }
        return aeropuertoRepository.findById(codigo.toUpperCase())
                .map(a -> {
                    a.setCapacidadMax(nuevaCapacidad);
                    aeropuertoRepository.save(a);
                    return ResponseEntity.ok(Map.<String, Object>of("codigo", codigo, "capacidadMax", nuevaCapacidad));
                })
                .orElse(ResponseEntity.notFound().<Map<String, Object>>build());
    }
}
