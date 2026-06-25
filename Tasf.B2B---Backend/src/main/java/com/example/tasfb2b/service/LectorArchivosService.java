package com.example.tasfb2b.service;

import com.example.tasfb2b.model.Aeropuerto;
import com.example.tasfb2b.model.Pedido;
import com.example.tasfb2b.model.Vuelo;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.List;

@Service
public class LectorArchivosService {

    // 1. LECTURA DE AEROPUERTOS (Con Memoria de Continente)
    public List<Aeropuerto> leerAeropuertos(String rutaArchivo) {
        List<Aeropuerto> aeropuertos = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new FileReader(rutaArchivo))) {
            String linea;
            String continenteActual = "DESCONOCIDO";

            while ((linea = br.readLine()) != null) {
                // Eliminamos los bytes nulos fantasmas antes de hacer cualquier otra cosa
                linea = linea.replace("\0", "");

                String lineaTrim = linea.trim();

                // 1. Saltar líneas vacías o cabeceras
                if (lineaTrim.isEmpty() || lineaTrim.startsWith("*") || lineaTrim.startsWith("PDDS") || lineaTrim.startsWith("GMT")) {
                    continue;
                }

                // 2. Detectar Continente
                String min = lineaTrim.toLowerCase();
                if (min.contains("america")) { continenteActual = "AMERICA_DEL_SUR"; continue; }
                if (min.contains("europa")) { continenteActual = "EUROPA"; continue; }
                if (min.contains("asia")) { continenteActual = "ASIA"; continue; }

                // 3. Parsear datos dividiendo por espacios reales
                String[] partes = lineaTrim.split("\\s+");

                // Solo procesar si parece una línea válida
                if (partes.length >= 7 && Character.isDigit(partes[0].charAt(0))) {
                    try {
                        Aeropuerto aero = new Aeropuerto();
                        aero.setContinente(continenteActual);
                        aero.setCodigo(partes[1]); // Ej: SKBO

                        // EL TRUCO DEL ANCLA: Buscar el índice del GMT (empieza con + o -)
                        int indiceTimezone = -1;
                        for (int i = 2; i < partes.length; i++) {
                            if (partes[i].startsWith("+") || partes[i].startsWith("-")) {
                                try {
                                    Integer.parseInt(partes[i]);
                                    indiceTimezone = i;
                                    break;
                                } catch (NumberFormatException e) {
                                    // Falsa alarma, seguimos
                                }
                            }
                        }

                        if (indiceTimezone == -1) {
                            System.err.println("⚠ Saltando línea sin GMT: " + lineaTrim);
                            continue;
                        }

                        // Extraer GMT y Capacidad
                        String gmtStr = partes[indiceTimezone].replace("+", "");
                        aero.setGmt(Integer.parseInt(gmtStr));
                        aero.setCapacidadMax(Integer.parseInt(partes[indiceTimezone + 1]));

                        // Extraer País
                        aero.setPais(partes[indiceTimezone - 2]);

                        // Extraer Ciudad (uniendo palabras)
                        StringBuilder ciudadBuilder = new StringBuilder();
                        for (int i = 2; i < indiceTimezone - 2; i++) {
                            ciudadBuilder.append(partes[i]).append(" ");
                        }
                        aero.setNombre(ciudadBuilder.toString().trim());
                        extraerCoordenadas(partes, indiceTimezone, aero);

                        aeropuertos.add(aero);

                    } catch (Exception e) {
                        System.err.println("❌ Error estructurando aeropuerto: " + lineaTrim + " - " + e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Error crítico en el lector de aeropuertos: " + e.getMessage());
        }
        return aeropuertos;
    }

    // 1b. LECTURA DE AEROPUERTOS DESDE STREAM (para archivos subidos vía web)
    public List<Aeropuerto> leerAeropuertosDesdeStream(InputStream is) {
        List<Aeropuerto> aeropuertos = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
            String linea;
            String continenteActual = "DESCONOCIDO";

            while ((linea = br.readLine()) != null) {
                linea = linea.replace("\0", "");
                String lineaTrim = linea.trim();

                if (lineaTrim.isEmpty() || lineaTrim.startsWith("*") || lineaTrim.startsWith("PDDS") || lineaTrim.startsWith("GMT")) {
                    continue;
                }

                String min = lineaTrim.toLowerCase();
                if (min.contains("america")) { continenteActual = "AMERICA_DEL_SUR"; continue; }
                if (min.contains("europa")) { continenteActual = "EUROPA"; continue; }
                if (min.contains("asia")) { continenteActual = "ASIA"; continue; }

                String[] partes = lineaTrim.split("\\s+");

                if (partes.length >= 7 && Character.isDigit(partes[0].charAt(0))) {
                    try {
                        Aeropuerto aero = new Aeropuerto();
                        aero.setContinente(continenteActual);
                        aero.setCodigo(partes[1]);

                        int indiceTimezone = -1;
                        for (int i = 2; i < partes.length; i++) {
                            if (partes[i].startsWith("+") || partes[i].startsWith("-")) {
                                try {
                                    Integer.parseInt(partes[i]);
                                    indiceTimezone = i;
                                    break;
                                } catch (NumberFormatException e) {
                                    // falsa alarma
                                }
                            }
                        }

                        if (indiceTimezone == -1) {
                            System.err.println("⚠ Saltando línea sin GMT: " + lineaTrim);
                            continue;
                        }

                        String gmtStr = partes[indiceTimezone].replace("+", "");
                        aero.setGmt(Integer.parseInt(gmtStr));
                        aero.setCapacidadMax(Integer.parseInt(partes[indiceTimezone + 1]));
                        aero.setPais(partes[indiceTimezone - 2]);

                        StringBuilder ciudadBuilder = new StringBuilder();
                        for (int i = 2; i < indiceTimezone - 2; i++) {
                            ciudadBuilder.append(partes[i]).append(" ");
                        }
                        aero.setNombre(ciudadBuilder.toString().trim());
                        extraerCoordenadas(partes, indiceTimezone, aero);

                        aeropuertos.add(aero);
                    } catch (Exception e) {
                        System.err.println("❌ Error estructurando aeropuerto: " + lineaTrim + " - " + e.getMessage());
                    }
                }
            }
        } catch (Exception e) {
            System.err.println("Error crítico en el lector de aeropuertos (stream): " + e.getMessage());
        }
        return aeropuertos;
    }

    // 2. LECTURA DE VUELOS
    public List<Vuelo> leerVuelos(String rutaArchivo) {
        List<Vuelo> vuelos = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new FileReader(rutaArchivo))) {
            String linea;
            while ((linea = br.readLine()) != null) {
                String[] partes = linea.trim().split("-");
                if (partes.length == 5) {
                    Vuelo vuelo = new Vuelo();

                    // Limpieza a los códigos
                    vuelo.setOrigen(partes[0].replaceAll("[^A-Za-z]", "").toUpperCase());
                    vuelo.setDestino(partes[1].replaceAll("[^A-Za-z]", "").toUpperCase());

                    vuelo.setHoraSalida(LocalTime.parse(partes[2]));
                    vuelo.setHoraLlegada(LocalTime.parse(partes[3]));
                    vuelo.setCapacidadMax(Integer.parseInt(partes[4]));

                    vuelos.add(vuelo);
                }
            }
        } catch (Exception e) {
            System.err.println("Error leyendo vuelos: " + e.getMessage());
        }
        return vuelos;
    }

    // 2b. LECTURA DE VUELOS DESDE STREAM
    public List<Vuelo> leerVuelosDesdeStream(InputStream is) {
        List<Vuelo> vuelos = new ArrayList<>();
        try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
            String linea;
            while ((linea = br.readLine()) != null) {
                String[] partes = linea.trim().split("-");
                if (partes.length == 5) {
                    Vuelo vuelo = new Vuelo();
                    vuelo.setOrigen(partes[0].replaceAll("[^A-Za-z]", "").toUpperCase());
                    vuelo.setDestino(partes[1].replaceAll("[^A-Za-z]", "").toUpperCase());
                    vuelo.setHoraSalida(LocalTime.parse(partes[2]));
                    vuelo.setHoraLlegada(LocalTime.parse(partes[3]));
                    vuelo.setCapacidadMax(Integer.parseInt(partes[4]));
                    vuelos.add(vuelo);
                }
            }
        } catch (Exception e) {
            System.err.println("Error leyendo vuelos (stream): " + e.getMessage());
        }
        return vuelos;
    }

    // 3. LECTURA DE ENVÍOS (Ajustado para evitar duplicados)
    public List<Pedido> leerEnvios(String rutaArchivo) {
        List<Pedido> pedidos = new ArrayList<>();
        DateTimeFormatter formatoFechaHora = DateTimeFormatter.ofPattern("yyyyMMdd-HH-mm");

        try (BufferedReader br = new BufferedReader(new FileReader(rutaArchivo))) {
            String linea;
            String nombreArchivo = new File(rutaArchivo).getName();

            // Extraemos el origen del nombre del archivo (ej: _envios_SKBO_.txt)
            String origen = nombreArchivo.split("_")[2].replaceAll("[^A-Za-z]", "").toUpperCase();

            while ((linea = br.readLine()) != null) {
                String[] partes = linea.trim().split("-");
                if (partes.length == 7) {
                    Pedido pedido = new Pedido();

                    // Concatenamos el origen con el número para que sea único en todo el sistema
                    pedido.setIdPedido(origen + "-" + partes[0]);
                    // ----------------------------

                    pedido.setOrigen(origen);
                    pedido.setDestino(partes[4].replaceAll("[^A-Za-z]", "").toUpperCase());

                    String cadenaFechaHora = partes[1] + "-" + partes[2] + "-" + partes[3];
                    pedido.setFechaRegistro(LocalDateTime.parse(cadenaFechaHora, formatoFechaHora));

                    pedido.setCantidadMaletas(Integer.parseInt(partes[5]));
                    pedido.setIdCliente(partes[6]);

                    pedidos.add(pedido);
                }
            }
        } catch (Exception e) {
            System.err.println("Error leyendo pedidos en " + rutaArchivo + ": " + e.getMessage());
        }
        return pedidos;
    }

    // Convierte coordenadas DMS del archivo a decimal y las asigna al aeropuerto.
    // Formato esperado tras indiceTimezone+1 (capacidad):
    //   [+2] "Latitude:"  [+3] "04°"  [+4] "42'"  [+5] "05""  [+6] "N"
    //   [+7] "Longitude:" [+8] "74°"  [+9] "08'"  [+10] "49"" [+11] "W"
    private void extraerCoordenadas(String[] partes, int indiceTimezone, Aeropuerto aero) {
        if (partes.length < indiceTimezone + 12) return;
        try {
            int latG = Integer.parseInt(partes[indiceTimezone + 3].replaceAll("[^0-9]", ""));
            int latM = Integer.parseInt(partes[indiceTimezone + 4].replaceAll("[^0-9]", ""));
            int latS = Integer.parseInt(partes[indiceTimezone + 5].replaceAll("[^0-9]", ""));
            char latDir = Character.toUpperCase(partes[indiceTimezone + 6].charAt(0));
            double lat = latG + latM / 60.0 + latS / 3600.0;
            if (latDir == 'S') lat = -lat;
            aero.setLatitud(lat);

            int lonG = Integer.parseInt(partes[indiceTimezone + 8].replaceAll("[^0-9]", ""));
            int lonM = Integer.parseInt(partes[indiceTimezone + 9].replaceAll("[^0-9]", ""));
            int lonS = Integer.parseInt(partes[indiceTimezone + 10].replaceAll("[^0-9]", ""));
            char lonDir = Character.toUpperCase(partes[indiceTimezone + 11].charAt(0));
            double lon = lonG + lonM / 60.0 + lonS / 3600.0;
            if (lonDir == 'W') lon = -lon;
            aero.setLongitud(lon);
        } catch (Exception ignorado) {
            // Si el archivo no trae coordenadas, quedan en 0
        }
    }

    // 3b. LECTURA DE ENVÍOS DESDE STREAM
    public List<Pedido> leerEnviosDesdeStream(InputStream is, String nombreArchivo) {
        List<Pedido> pedidos = new ArrayList<>();
        DateTimeFormatter formatoFechaHora = DateTimeFormatter.ofPattern("yyyyMMdd-HH-mm");

        try (BufferedReader br = new BufferedReader(new InputStreamReader(is))) {
            String linea;
            String origen = nombreArchivo.split("_")[2].replaceAll("[^A-Za-z]", "").toUpperCase();

            while ((linea = br.readLine()) != null) {
                String[] partes = linea.trim().split("-");
                if (partes.length == 7) {
                    Pedido pedido = new Pedido();
                    pedido.setIdPedido(origen + "-" + partes[0]);
                    pedido.setOrigen(origen);
                    pedido.setDestino(partes[4].replaceAll("[^A-Za-z]", "").toUpperCase());

                    String cadenaFechaHora = partes[1] + "-" + partes[2] + "-" + partes[3];
                    pedido.setFechaRegistro(LocalDateTime.parse(cadenaFechaHora, formatoFechaHora));

                    pedido.setCantidadMaletas(Integer.parseInt(partes[5]));
                    pedido.setIdCliente(partes[6].trim());

                    pedidos.add(pedido);
                }
            }
        } catch (Exception e) {
            System.err.println("Error leyendo pedidos (stream) de " + nombreArchivo + ": " + e.getMessage());
        }
        return pedidos;
    }
}