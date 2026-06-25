package com.example.tasfb2b.controller;

import com.example.tasfb2b.service.DataCargaService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.Map;

@RestController
@RequestMapping("/api/datos")
@CrossOrigin(origins = "*")
public class DataCargaController {

    private final DataCargaService dataCargaService;

    public DataCargaController(DataCargaService dataCargaService) {
        this.dataCargaService = dataCargaService;
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
}
