/*
package com.example.tasfb2b;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.Solucion;
import com.example.tasfb2b.model.Vuelo;
import com.example.tasfb2b.service.LectorArchivosService;
import com.example.tasfb2b.service.TabuSearchService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import com.example.tasfb2b.util.TimeCalculator;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileWriter;
import java.io.PrintWriter;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Component
public class SimulacionRunner implements CommandLineRunner {

    private final LectorArchivosService lectorService;
    private final TabuSearchService tabuSearchService;

    @Autowired
    public SimulacionRunner(LectorArchivosService lectorService, TabuSearchService tabuSearchService) {
        this.lectorService = lectorService;
        this.tabuSearchService = tabuSearchService;
    }

    // --- DEFINICIÓN DE LOS 3 ESCENARIOS ---
    public enum TipoEscenario {
        ESCENARIO_1_PRUEBA_RAPIDA,
        ESCENARIO_2_PERIODO_REGULAR,
        ESCENARIO_3_COLAPSO_TOTAL
    }

    @Override
    public void run(String... args) throws Exception {
        System.out.println("==============================================");
        System.out.println("   INICIANDO SISTEMA DE TRASLADO TASF.B2B     ");
        System.out.println("==============================================");

        // =========================================================================
        // 🛠️ PANEL DE CONTROL: CAMBIA ESTA VARIABLE PARA ELEGIR QUÉ ESCENARIO SIMULAR 🛠️
        // =========================================================================
        TipoEscenario escenarioActual = TipoEscenario.ESCENARIO_2_PERIODO_REGULAR;
        // =========================================================================

        // 1. Definir rutas de archivos
        String rutaAeros = "src/main/resources/data/aeropuertos.txt";
        String rutaVuelos = "src/main/resources/data/planesVuelos.txt";
        File carpetaEnvios = new File("src/main/resources/data/envios");

        // 2. Cargar el entorno virtual
        System.out.println("-> Cargando base de datos de aeropuertos...");
        List<Aeropuerto> aeropuertos = lectorService.leerAeropuertos(rutaAeros);

        // --- VERIFICACIÓN DE AEROPUERTOS ---
        System.out.println("\n--- AUDITORÍA COMPLETA DE AEROPUERTOS ---");
        System.out.printf("%-6s | %-20s | %-15s | %-18s | %-4s | %s%n",
                "CÓDIGO", "CIUDAD", "PAÍS", "CONTINENTE", "GMT", "CAPACIDAD");
        System.out.println("-----------------------------------------------------------------------------------------");

        for (Aeropuerto a : aeropuertos) {
            System.out.printf("%-6s | %-20s | %-15s | %-18s | %3d  | %4d%n",
                    a.getCodigo(),
                    a.getNombre(),
                    a.getPais(),
                    a.getContinente(),
                    a.getGmt(),
                    a.getCapacidadMax());
        }
        System.out.println("-----------------------------------------------------------------------------------------\n");

        System.out.println("-> Cargando planes de vuelo...");
        List<Vuelo> vuelos = lectorService.leerVuelos(rutaVuelos);

        System.out.println("-> Cargando demanda de maletas...");
        List<Pedido> pedidosTotales = new ArrayList<>();
        if (carpetaEnvios.exists() && carpetaEnvios.isDirectory()) {
            for (File archivo : carpetaEnvios.listFiles()) {
                if (archivo.getName().endsWith(".txt")) {
                    pedidosTotales.addAll(lectorService.leerEnvios(archivo.getAbsolutePath()));
                }
            }
        } else {
            System.err.println("❌ No se encontró la carpeta de envíos.");
            return;
        }

        System.out.println("-> Ordenando pedidos cronológicamente por fecha de registro...");
        pedidosTotales.sort(java.util.Comparator.comparing(Pedido::getFechaRegistro));

        // 3. APLICAR FILTROS SEGÚN EL ESCENARIO ELEGIDO
        List<Pedido> pedidosAProcesar = new ArrayList<>();
        System.out.println("\n--- CONFIGURANDO " + escenarioActual + " ---");
        LocalDateTime fechaInicio_1 = null;
        LocalDateTime fechaFin_1 = null;

        switch (escenarioActual) {
            case ESCENARIO_1_PRUEBA_RAPIDA:
                // Toma solo los primeros X pedidos
                int limite = Math.min(100000 , pedidosTotales.size());
                pedidosAProcesar = pedidosTotales.subList(0, limite);
                System.out.println("Filtro: Se procesarán únicamente " + limite + " pedidos.");
                break;

            case ESCENARIO_2_PERIODO_REGULAR:
                // Filtra por fechas:
                LocalDateTime fechaInicio = LocalDateTime.of(2026, 5, 3, 0, 0);
                LocalDateTime fechaFin = LocalDateTime.of(2026, 5, 10, 0, 0);
                fechaFin_1 = fechaFin;
                fechaInicio_1 = fechaInicio;

                pedidosAProcesar = pedidosTotales.stream()
                        .filter(p -> !p.getFechaRegistro().isBefore(fechaInicio) && p.getFechaRegistro().isBefore(fechaFin))
                        .toList();
                System.out.println("Filtro: Pedidos entre " + fechaInicio.toLocalDate() + " y " + fechaFin.toLocalDate());
                break;

            case ESCENARIO_3_COLAPSO_TOTAL:
                // Sin filtros
                pedidosAProcesar = pedidosTotales;
                System.out.println("Filtro: NINGUNO. Advertencia, alto consumo de RAM y tiempo de CPU.");
                break;
        }

        System.out.println("Total de pedidos a procesar en este escenario: " + pedidosAProcesar.size());
        System.out.println("==============================================\n");

        // 4. Disparar la metaheurística
        if (!pedidosAProcesar.isEmpty() && !vuelos.isEmpty() && !aeropuertos.isEmpty()) {

            // --- INICIO DEL CONTADOR DIARIO ---
            System.out.println("\n--- DENSIDAD DE CARGA DIARIA ---");
            if (!pedidosAProcesar.isEmpty()) {
                java.time.LocalDate diaActualTracker = pedidosAProcesar.get(0).getFechaRegistro().toLocalDate();
                int pedidosDelDia = 0;
                int maletasDelDia = 0;

                for (Pedido p : pedidosAProcesar) {
                    java.time.LocalDate diaPedido = p.getFechaRegistro().toLocalDate();
                    if (diaPedido.equals(diaActualTracker)) {
                        pedidosDelDia++;
                        maletasDelDia += p.getCantidadMaletas();
                    } else {
                        System.out.println("Día " + diaActualTracker + " -> Procesando " + pedidosDelDia + " pedidos (" + maletasDelDia + " maletas totales).");
                        diaActualTracker = diaPedido;
                        pedidosDelDia = 1;
                        maletasDelDia = p.getCantidadMaletas();
                    }
                }
                // Imprimir el último día
                System.out.println("Día " + diaActualTracker + " -> Procesando " + pedidosDelDia + " pedidos (" + maletasDelDia + " maletas totales).");
            }
            System.out.println("--------------------------------\n");
            // --- FIN DEL CONTADOR DIARIO ---

            long tiempoInicio = System.currentTimeMillis();

            Solucion mejorSolucion = tabuSearchService.ejecutarOptimizacion(new ArrayList<>(), pedidosAProcesar, vuelos, aeropuertos);

            long tiempoFin = System.currentTimeMillis();

            System.out.println("\n==============================================");
            System.out.println("            RESULTADOS DE LA SIMULACIÓN       ");
            System.out.println("==============================================");
            System.out.println("Costo Final (Fitness): " + mejorSolucion.getFitness());
            System.out.println("Tiempo de procesamiento: " + (tiempoFin - tiempoInicio) + " ms");
            imprimirMetricasSLA(mejorSolucion, aeropuertos, pedidosAProcesar);

            // 5. Exportación JSON
            exportarAsignacionesJSON(mejorSolucion, pedidosAProcesar, aeropuertos,
                escenarioActual, tiempoFin, tiempoInicio);

        } else {
            System.err.println("❌ Error: No hay datos para procesar con los filtros actuales.");
        }
    }

    // --- EXPORTACIÓN JSON ---

    private static final DateTimeFormatter FMT_UTC =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss'Z'");

    private void exportarAsignacionesJSON(Solucion mejorSolucion, List<Pedido> pedidosAProcesar,
            List<Aeropuerto> aeropuertos, TipoEscenario escenario,
            long tiempoFin, long tiempoInicio) {

        Map<String, Pedido> mapaPedidos = new HashMap<>();
        for (Pedido p : pedidosAProcesar) mapaPedidos.put(p.getIdPedido(), p);
        Map<String, Aeropuerto> mapaAeros = new HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        List<Map.Entry<String, List<Vuelo>>> entries = new ArrayList<>(
            mejorSolucion.getRutasAsignadas().entrySet());
        entries.sort(Map.Entry.comparingByKey());

        String rutaSalida = "resultados_" + escenario.name() + ".txt";
        System.out.println("\nExportando el reporte de rutas a: " + rutaSalida + " ...");

        try (PrintWriter w = new PrintWriter(new BufferedWriter(new FileWriter(rutaSalida)))) {
            w.println("{");
            w.println("  \"escenario\": \"" + escenario.name() + "\",");
            w.println("  \"fitness\": " + mejorSolucion.getFitness() + ",");
            w.println("  \"tiempoMs\": " + (tiempoFin - tiempoInicio) + ",");
            w.println("  \"totalPedidos\": " + pedidosAProcesar.size() + ",");
            w.println("  \"asignaciones\": [");

            boolean primeraPedido = true;
            for (Map.Entry<String, List<Vuelo>> entry : entries) {
                Pedido pedido = mapaPedidos.get(entry.getKey());
                if (pedido == null) continue;
                List<Vuelo> ruta = entry.getValue();

                Aeropuerto aeroOrigen  = mapaAeros.get(pedido.getOrigen());
                Aeropuerto aeroDestino = mapaAeros.get(pedido.getDestino());
                if (aeroOrigen == null || aeroDestino == null) continue;

                // fechaRegistro está en hora local del aeropuerto origen → convertir a UTC
                LocalDateTime creacionUTC = pedido.getFechaRegistro().minusHours(aeroOrigen.getGmt());
                boolean mismoCont = aeroOrigen.getContinente().equals(aeroDestino.getContinente());
                LocalDateTime deadlineUTC = creacionUTC.plusHours(mismoCont ? 24 : 48);
                LocalDate creacionLocalDate = pedido.getFechaRegistro().toLocalDate();

                if (!primeraPedido) w.println(",");
                primeraPedido = false;

                w.println("    {");
                w.println("      \"pedidoId\": \"" + pedido.getIdPedido() + "\",");
                w.println("      \"origen\": \"" + pedido.getOrigen() + "\",");
                w.println("      \"destino\": \"" + pedido.getDestino() + "\",");
                w.println("      \"creacion\": \"" + creacionUTC.format(FMT_UTC) + "\",");
                w.println("      \"deadline\": \"" + deadlineUTC.format(FMT_UTC) + "\",");
                w.println("      \"paquetes\": " + pedido.getCantidadMaletas() + ",");
                w.println("      \"ruta\": [");

                LocalDateTime tiempoActualUTC = creacionUTC;
                boolean primerVuelo = true;

                for (int i = 0; i < ruta.size(); i++) {
                    Vuelo v = ruta.get(i);
                    Aeropuerto aOrig = mapaAeros.get(v.getOrigen());
                    Aeropuerto aDest = mapaAeros.get(v.getDestino());
                    if (aOrig == null || aDest == null) continue;

                    LocalDateTime salidaUTC  = TimeCalculator.calcularProximaSalidaUTC(tiempoActualUTC, v, aOrig);
                    long duracion            = TimeCalculator.calcularDuracionVueloMinutos(v, aOrig, aDest);
                    LocalDateTime llegadaUTC = salidaUTC.plusMinutes(duracion);

                    // dN = offset en días entre la fecha local de creación y la fecha local de salida
                    LocalDate salidaLocalDate = salidaUTC.plusHours(aOrig.getGmt()).toLocalDate();
                    long dayOffset = ChronoUnit.DAYS.between(creacionLocalDate, salidaLocalDate);
                    String dN = "d" + (dayOffset + 1);

                    String vueloId = v.getOrigen() + "-" + v.getDestino() + "-"
                        + v.getHoraSalida().format(DateTimeFormatter.ofPattern("HH:mm")) + "-" + dN;

                    if (!primerVuelo) w.println(",");
                    primerVuelo = false;

                    w.println("        {");
                    w.println("          \"vueloId\": \"" + vueloId + "\",");
                    w.println("          \"origen\": \"" + v.getOrigen() + "\",");
                    w.println("          \"destino\": \"" + v.getDestino() + "\",");
                    w.println("          \"salida\": \"" + salidaUTC.format(FMT_UTC) + "\",");
                    w.print(  "          \"llegada\": \"" + llegadaUTC.format(FMT_UTC) + "\"");
                    w.println();
                    w.print(  "        }");

                    tiempoActualUTC = llegadaUTC;
                    if (i < ruta.size() - 1)
                        tiempoActualUTC = tiempoActualUTC.plusMinutes(
                            TimeCalculator.calcularTiempoEsperaMinutos(v, ruta.get(i + 1)));
                }

                w.println();
                w.println("      ]");
                w.print(  "    }");
            }

            w.println();
            w.println("  ]");
            w.println("}");

            System.out.println("¡Exportación completada! " + entries.size() + " asignaciones.");
        } catch (Exception e) {
            System.err.println("Error al exportar: " + e.getMessage());
        }
    }

    // --- MÉTODO PARA EXPERIMENTACIÓN NUMÉRICA ---
    private void imprimirMetricasSLA(Solucion solucion, List<Aeropuerto> aeropuertos, List<Pedido> pedidosAProcesar) {
        int pedidosLegales = 0;
        int totalPedidos = solucion.getRutasAsignadas().size();
        Integer primerPedidoColapsado = null;

        if (totalPedidos == 0) return;

        // OPTIMIZACIÓN: Mapas de búsqueda rápida
        Map<String, Pedido> mapaPedidos = new java.util.HashMap<>();
        for (Pedido p : pedidosAProcesar) mapaPedidos.put(p.getIdPedido(), p);

        Map<String, Aeropuerto> mapaAeros = new java.util.HashMap<>();
        for (Aeropuerto a : aeropuertos) mapaAeros.put(a.getCodigo(), a);

        // Contadores para el diagnóstico
        int fallasSLA = 0;
        int fallasVuelo = 0;
        int fallasAlmacen = 0;
        Map<String, Integer> cuellosBotella = new java.util.HashMap<>();

        int contadorGlobal = 0;

        for (Map.Entry<String, List<Vuelo>> entry : solucion.getRutasAsignadas().entrySet()) {
            contadorGlobal++;
            String idPedido = entry.getKey();
            List<Vuelo> ruta = entry.getValue();
            if (ruta.isEmpty()) continue;

            Pedido pedidoReal = mapaPedidos.get(idPedido);
            java.time.LocalDateTime tiempoActual = pedidoReal.getFechaRegistro();

            long tiempoRutaMinutos = 0;
            boolean capacidadVuelosOk = true;
            boolean capacidadAlmacenesOk = true;

            for (int i = 0; i < ruta.size(); i++) {
                Vuelo v = ruta.get(i);

                String idVueloUnico = v.getOrigen() + "-" + v.getDestino() + "-" + v.getHoraSalida()
                    + "_" + tiempoActual.toLocalDate();
                int maletasEnEsteVuelo = solucion.getOcupacionVuelos().getOrDefault(idVueloUnico, 0);

                if (maletasEnEsteVuelo > v.getCapacidadMax()) {
                    capacidadVuelosOk = false;
                    fallasVuelo++;
                }

                Aeropuerto origen = mapaAeros.get(v.getOrigen());
                Aeropuerto destino = mapaAeros.get(v.getDestino());

                if (origen != null && destino != null) {
                    long duracionVuelo = com.example.tasfb2b.util.TimeCalculator.calcularDuracionVueloMinutos(v, origen, destino);
                    tiempoRutaMinutos += duracionVuelo;
                    tiempoActual = tiempoActual.plusMinutes(duracionVuelo);

                    String diaDestino = tiempoActual.toLocalDate().toString();
                    String keyDestino = destino.getCodigo() + "_" + diaDestino;
                    int maletasEseDia = solucion.getOcupacionAeropuertos().getOrDefault(keyDestino, 0);

                    if (maletasEseDia > destino.getCapacidadMax()) {
                        capacidadAlmacenesOk = false;
                        cuellosBotella.put(destino.getCodigo(), cuellosBotella.getOrDefault(destino.getCodigo(), 0) + 1);
                    }
                }

                if (i < ruta.size() - 1) {
                    long espera = com.example.tasfb2b.util.TimeCalculator.calcularTiempoEsperaMinutos(v, ruta.get(i+1));
                    tiempoRutaMinutos += espera;
                    tiempoActual = tiempoActual.plusMinutes(espera);
                }
            }

            tiempoRutaMinutos += com.example.tasfb2b.util.TimeCalculator.TIEMPO_RECOJO_FINAL;

            Aeropuerto aeroOrigenFinal = mapaAeros.get(ruta.get(0).getOrigen());
            Aeropuerto aeroDestinoFinal = mapaAeros.get(ruta.get(ruta.size() - 1).getDestino());

            boolean cumpleSLA = false;
            if (aeroOrigenFinal != null && aeroDestinoFinal != null) {
                boolean mismoContinente = aeroOrigenFinal.getContinente().equals(aeroDestinoFinal.getContinente());
                long limiteSlaMinutos = mismoContinente ? (24 * 60) : (48 * 60);
                cumpleSLA = tiempoRutaMinutos <= limiteSlaMinutos;
                if (!cumpleSLA) fallasSLA++;
            }

            if (cumpleSLA && capacidadVuelosOk && capacidadAlmacenesOk) {
                pedidosLegales++;
            } else if (primerPedidoColapsado == null) {
                primerPedidoColapsado = contadorGlobal;
            }
        }

        double porcentaje = ((double) pedidosLegales / totalPedidos) * 100.0;
        double porcentajeReal = Math.floor(porcentaje * 100) / 100.0;

        System.out.println("-> Entregas LEGALES (SLA + Capacidades): " + pedidosLegales + " de " + totalPedidos + " (" + String.format(java.util.Locale.US, "%.2f", porcentajeReal) + "%)");
        System.out.println("-> Entregas fallidas/colapsadas: " + (totalPedidos - pedidosLegales));

        if (primerPedidoColapsado != null) {
            System.out.println("-> [ALERTA] Punto de colapso detectado en el pedido número: " + primerPedidoColapsado);
            System.out.println("\n--- DIAGNÓSTICO DE FALLAS ---");
            if (fallasSLA > 0) System.out.println("  * Por SLA (Tiempo excedido): " + fallasSLA);
            if (fallasVuelo > 0) System.out.println("  * Por Vuelos llenos: " + fallasVuelo);
            if (!cuellosBotella.isEmpty()) {
                System.out.println("  * Por Almacenes llenos:");
                cuellosBotella.forEach((k, v) -> System.out.println("    - " + k + ": " + v + " veces."));
            }
        } else {
            System.out.println("-> ¡Excelente! Todos los pedidos cumplieron las reglas.");
        }
    }
}
*/
