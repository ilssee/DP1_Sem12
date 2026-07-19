package com.example.tasfb2b.service;

import com.example.tasfb2b.model.Solucion;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class EstadoDiarioCache {

    private final ConcurrentHashMap<String, Solucion> cache = new ConcurrentHashMap<>();
    private final Set<String> vuelosCancelados = Collections.newSetFromMap(new ConcurrentHashMap<>());

    public Solucion obtener(String fecha) {
        return cache.computeIfAbsent(fecha, k -> new Solucion());
    }

    public void limpiar(String fecha) {
        cache.remove(fecha);
    }

    public void limpiarTodo() {
        cache.clear();
        vuelosCancelados.clear();
    }

    public void cancelarVuelo(String claveVuelo) {
        vuelosCancelados.add(claveVuelo);
    }

    public Set<String> getVuelosCancelados() {
        return Collections.unmodifiableSet(vuelosCancelados);
    }

    public void limpiarCancelados() {
        vuelosCancelados.clear();
    }
}
