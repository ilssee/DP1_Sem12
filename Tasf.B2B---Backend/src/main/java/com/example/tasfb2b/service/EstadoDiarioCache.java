package com.example.tasfb2b.service;

import com.example.tasfb2b.model.Solucion;
import org.springframework.stereotype.Component;

import java.util.concurrent.ConcurrentHashMap;

/**
 * Cache en memoria del estado acumulado por día para operaciones día a día.
 * Clave: fechaInicioSimulacion (ej. "2026-06-29")
 * Se reinicia automáticamente si se detecta un día distinto al guardado.
 */
@Component
public class EstadoDiarioCache {

    private final ConcurrentHashMap<String, Solucion> cache = new ConcurrentHashMap<>();

    public Solucion obtener(String fecha) {
        return cache.computeIfAbsent(fecha, k -> new Solucion());
    }

    public void limpiar(String fecha) {
        cache.remove(fecha);
    }

    public void limpiarTodo() {
        cache.clear();
    }
}
