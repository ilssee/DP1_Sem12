package com.example.tasfb2b.model;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Data
public class Solucion {
    private Map<String, List<Vuelo>> rutasAsignadas;
    private Map<String, Integer> ocupacionVuelos;
    private Map<String, Integer> ocupacionAeropuertos;
    private Map<String, DetalleEnvio> detallesEnvios = new HashMap<>();
    // pedidoId → lista de fechas (una por tramo), e.g. ["2026-08-16", "2026-08-17"]
    private Map<String, List<String>> fechasTramos = new HashMap<>();
    // Todas las rutas planificadas en hora Lima (activas o en espera), para visualización
    private Map<String, List<Vuelo>> rutasPlanificadas = new HashMap<>();

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class DetalleEnvio {
        private String idCliente;
        private int cantidadMaletas;
        private String origen;
        private String destino;
    }

    // Campos que necesita el frontend para renderizar aviones y métricas
    private Map<String, Integer> capacidadesVuelos;      // "LIM-BOG-08:00" → capacidadMax
    private Map<String, String>  horasLlegada = new HashMap<>(); // "LIM-BOG-08:00" → horaLlegada
    private Map<String, Integer> capacidadesAeropuertos; // "SPIM" → capacidadMax
    private int totalPedidos;
    private double tasaExito;
    private double tiempoPromedioIntra;
    private double tiempoPromedioInter;

    private double fitness;

    // IDs de pedidos que fueron re-planificados por cancelación de vuelo
    private Set<String> pedidosReplanificados = new HashSet<>();

    public Solucion() {
        this.rutasAsignadas = new HashMap<>();
        this.ocupacionVuelos = new HashMap<>();
        this.ocupacionAeropuertos = new HashMap<>();
        this.capacidadesVuelos = new HashMap<>();
        this.capacidadesAeropuertos = new HashMap<>();
        this.pedidosReplanificados = new HashSet<>();
        this.fitness = Double.MAX_VALUE;
    }

    public Solucion clonar() {
        Solucion copia = new Solucion();
        copia.setFitness(this.fitness);
        copia.setRutasAsignadas(new HashMap<>(this.rutasAsignadas));
        copia.setOcupacionVuelos(new HashMap<>(this.ocupacionVuelos));
        copia.setOcupacionAeropuertos(new HashMap<>(this.ocupacionAeropuertos));
        copia.setFechasTramos(new HashMap<>(this.fechasTramos));
        copia.setPedidosReplanificados(new HashSet<>(this.pedidosReplanificados));
        return copia;
    }
}