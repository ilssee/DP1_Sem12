package com.example.tasfb2b.util;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Vuelo;
import java.time.Duration;
import java.time.LocalDateTime;
import java.time.LocalTime;

public class TimeCalculator {

    // --- REGLAS DE NEGOCIO (Según respuestas del profesor) ---
    public static final int TIEMPO_MINIMO_ESCALA = 10;
    public static final int TIEMPO_RECOJO_FINAL = 10;
    public static final int TIEMPO_MANIPULACION = 0;
    // ---------------------------------------------------------

    public static long calcularDuracionVueloMinutos(Vuelo vuelo, Aeropuerto origen, Aeropuerto destino) {
        LocalTime salida = vuelo.getHoraSalida();
        LocalTime llegada = vuelo.getHoraLlegada();

        // 1. Calculamos la diferencia bruta de horas
        long minutos = Duration.between(salida, llegada).toMinutes();

        // 2. PRIMERO hacemos el ajuste por zonas horarias (GMT)
        int difGmt = destino.getGmt() - origen.getGmt();
        minutos -= (difGmt * 60);

        // 3. DESPUÉS verificamos si cruzó la medianoche
        // (Si después de igualar las zonas horarias sigue siendo negativo, entonces sí es un cruce de día real)
        if (minutos < 0) {
            minutos += 24 * 60;
        }

        return minutos;
    }

    public static long calcularTiempoEsperaMinutos(Vuelo vueloActual, Vuelo vueloSiguiente) {
        LocalTime llegadaActual = vueloActual.getHoraLlegada();
        LocalTime salidaSiguiente = vueloSiguiente.getHoraSalida();

        long espera = Duration.between(llegadaActual, salidaSiguiente).toMinutes();

        // Si la espera cruza la medianoche
        if (espera < 0) {
            espera += 24 * 60;
        }

        // Regla 7: El tiempo de manipulación (bajar del avión al almacén) es 0.
        espera += TIEMPO_MANIPULACION;

        return espera;
    }

    // NUEVO: Validador estricto de escalas (Regla 6 y 8)
    public static boolean esConexionFisicamentePosible(Vuelo vueloActual, Vuelo vueloSiguiente) {
        long espera = calcularTiempoEsperaMinutos(vueloActual, vueloSiguiente);
        // Regla 6: El tiempo mínimo de escala de la maleta es 10 minutos.
        return espera >= TIEMPO_MINIMO_ESCALA;
    }

    public static LocalDateTime calcularProximaSalidaUTC(LocalDateTime referenciaUTC, Vuelo vuelo, Aeropuerto aeroPartida) {
        LocalDateTime referenciaLocal = referenciaUTC.plusHours(aeroPartida.getGmt());
        LocalDateTime minSalidaLocal  = referenciaLocal.plusMinutes(TIEMPO_MINIMO_ESCALA);
        LocalDateTime salidaLocal     = LocalDateTime.of(minSalidaLocal.toLocalDate(), vuelo.getHoraSalida());
        if (salidaLocal.isBefore(minSalidaLocal)) salidaLocal = salidaLocal.plusDays(1);
        return salidaLocal.minusHours(aeroPartida.getGmt());
    }

    // Calcula el castigo si el paquete llega tarde según el SLA
    public static double calcularPenalizacionTiempo(long tiempoTotalRutaMinutos, boolean esMismoContinente) {
        // 1 día = 1440 minutos, 2 días = 2880 minutos
        long limiteSlaMinutos = esMismoContinente ? (24 * 60) : (48 * 60);

        if (tiempoTotalRutaMinutos > limiteSlaMinutos) {
            // Si excede el tiempo, aplicamos un castigo severo al Fitness
            return 5000.0;
        }

        return 0.0; // Llegó a tiempo, costo cero
    }
}