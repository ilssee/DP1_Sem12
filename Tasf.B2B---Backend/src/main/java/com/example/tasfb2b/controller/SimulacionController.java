package com.example.tasfb2b.controller;

import com.example.tasfb2b.model.JobEstado;
import com.example.tasfb2b.service.AsyncSimulacionService;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.scheduling.annotation.Scheduled;

import java.time.LocalDateTime;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

@RestController
@RequestMapping("/api")
@CrossOrigin(origins = "*")
public class SimulacionController {

    private final AsyncSimulacionService asyncService;

    // Aquí guardamos el estado de las simulaciones activas
    private final ConcurrentHashMap<String, JobEstado> jobsActivos = new ConcurrentHashMap<>();

    public SimulacionController(AsyncSimulacionService asyncService) {
        this.asyncService = asyncService;
    }

    // 1. ENDPOINT PARA INICIAR (Responde en milisegundos)
    @PostMapping("/simulacion/iniciar")
    public Map<String, String> iniciarSimulacion(
            @RequestParam(name = "fechaInicio") String fechaInicio,
            @RequestParam(name = "dias") int dias
    ) {
        LocalDateTime inicio = LocalDateTime.parse(fechaInicio);
        String jobId = UUID.randomUUID().toString();

        JobEstado nuevoJob = new JobEstado(jobId, "INICIADO");
        jobsActivos.put(jobId, nuevoJob);

        // Dispara el hilo asíncrono y libera a Nginx inmediatamente
        asyncService.procesarSimulacionEnFondo(jobId, inicio, dias, nuevoJob);

        return Map.of("jobId", jobId, "mensaje", "Simulación iniciada en segundo plano");
    }

    // 2. ENDPOINT DE POLLING PARA REACT (Consulta recurrente)
    @GetMapping("/simulacion/estado/{jobId}")
    public JobEstado obtenerEstadoSimulacion(@PathVariable String jobId) {
        JobEstado job = jobsActivos.get(jobId);
        if (job == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "El Job ID no existe.");
        }
        return job;
    }

    // 3. ENDPOINT PARA CANCELAR UN VUELO EN TIEMPO REAL
    @PostMapping("/simulacion/{jobId}/cancelar-vuelo")
    public Map<String, Object> cancelarVuelo(
            @PathVariable String jobId,
            @RequestParam String claveVuelo
    ) {
        JobEstado job = jobsActivos.get(jobId);
        if (job == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Job no encontrado");
        job.cancelarVuelo(claveVuelo);
        System.out.println("✈ Vuelo cancelado en job " + jobId + ": " + claveVuelo);
        return Map.of("cancelado", claveVuelo, "totalCancelados", job.getVuelosCancelados().size());
    }

    // 4. ENDPOINT PARA DETENER LA SIMULACIÓN (usado por colapso)
    @PostMapping("/simulacion/{jobId}/detener")
    public Map<String, Object> detenerSimulacion(@PathVariable String jobId) {
        JobEstado job = jobsActivos.get(jobId);
        if (job == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Job no encontrado");
        job.detener();
        System.out.println("🛑 Simulación detenida por colapso: " + jobId);
        return Map.of("detenido", true);
    }

    // 5. ENDPOINT PARA VER VUELOS CANCELADOS DE UN JOB
    @GetMapping("/simulacion/{jobId}/vuelos-cancelados")
    public Set<String> vuelosCancelados(@PathVariable String jobId) {
        JobEstado job = jobsActivos.get(jobId);
        if (job == null) throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Job no encontrado");
        return job.getVuelosCancelados();
    }

    // LIMPIEZA AUTOMÁTICA DE MEMORIA ---
    // fixedRate = 7200000 milisegundos (Se ejecuta en automático cada 2 horas)
    @Scheduled(fixedRate = 7200000)
    public void limpiarSimulacionesTerminadas() {
        int tamañoAntes = jobsActivos.size();

        // Elimina del mapa cualquier Job que ya esté COMPLETADO o en ERROR
        jobsActivos.entrySet().removeIf(entry ->
                "COMPLETADO".equals(entry.getValue().getEstado()) ||
                        "ERROR".equals(entry.getValue().getEstado())
        );

        int eliminados = tamañoAntes - jobsActivos.size();
        if (eliminados > 0) {
            System.out.println("🧹 Limpieza automática: Se liberaron " + eliminados + " simulaciones antiguas de la RAM.");
        }
    }
}