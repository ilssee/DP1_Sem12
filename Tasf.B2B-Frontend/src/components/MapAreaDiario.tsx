import React, { useState, useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import type { Solucion } from "../types";
import { aeropuertosDB } from "../data/coordenadas";

interface MapAreaProps {
  solucion: Solucion | null;
  horaVirtualMinutos: number; // Ej: 14:30 = (14 * 60) + 30 = 870 minutos
  modoOscuro?: boolean;
}

function EventosMapa({ alHacerClic }: { alHacerClic: () => void }) {
  useMapEvents({ click: () => alHacerClic() });
  return null;
}

// Pin dinámico según modo
const crearPinAeropuerto = (oscuro: boolean) => new L.DivIcon({
  html: `<svg viewBox="0 0 24 24" width="18" height="26" xmlns="http://www.w3.org/2000/svg">
    <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"
      fill="${oscuro ? "white" : "#1e293b"}" stroke="${oscuro ? "rgba(0,0,0,0.4)" : "rgba(255,255,255,0.8)"}" stroke-width="0.5"/>
  </svg>`,
  className: "bg-transparent border-none",
  iconSize: [18, 26],
  iconAnchor: [9, 26],
  popupAnchor: [0, -28],
});

// Memoria caché para que React no destruya los aviones al moverse
const cacheIconos: Record<string, L.DivIcon> = {};

// ==========================================
// MATEMÁTICAS DE TIEMPO REAL
// ==========================================
const parseHoraAMinutos = (horaStr: string): number => {
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
};

const calcularProgresoReal = (
  horaSalida: string,
  horaLlegada: string,
  horaActual: number,
) => {
  const minSalida = parseHoraAMinutos(horaSalida);
  let minLlegada = parseHoraAMinutos(horaLlegada);
  let minActual = horaActual;

  // Manejo de vuelos que cruzan la medianoche
  if (minLlegada < minSalida) {
    minLlegada += 1440; // Le sumamos 24h a la llegada
    if (minActual < minSalida) minActual += 1440; // Si estamos en la madrugada de ese vuelo
  }

  if (minActual < minSalida) return -1; // Aún no despega
  if (minActual >= minLlegada) return 2; // Ya aterrizó

  // Retorna un valor entre 0.0 y 1.0 (Porcentaje exacto de la ruta cubierta)
  return (minActual - minSalida) / (minLlegada - minSalida);
};

const getPlaneIcon = (
  color: string,
  isSelected: boolean,
  isDimmed: boolean,
) => {
  const key = `${color}-${isSelected}-${isDimmed}`;
  if (cacheIconos[key]) return cacheIconos[key];

  const size = isSelected ? 36 : 24;
  const opacity = isDimmed ? 0.2 : 1;
  const shadow = isSelected
    ? `drop-shadow(0px 0px 10px ${color})`
    : "drop-shadow(0px 0px 2px rgba(0,0,0,0.8))";

  const icon = new L.DivIcon({
    html: `<div style="opacity: ${opacity}; transition: opacity 0.3s ease;">
             <svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}" style="transform: rotate(45deg); filter: ${shadow};">
               <path d="M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z" />
             </svg>
           </div>`,
    className: "bg-transparent border-none",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });

  cacheIconos[key] = icon;
  return icon;
};

export default function MapArea({
  solucion,
  horaVirtualMinutos,
  modoOscuro = true,
}: MapAreaProps) {
  const pinAeropuerto = crearPinAeropuerto(modoOscuro);
  const [vueloSeleccionado, setVueloSeleccionado] = useState<string | null>(
    null,
  );
  const [rutasVisuales, setRutasVisuales] = useState<any[]>([]);

  useEffect(() => {
    if (solucion && solucion.rutasAsignadas && solucion.capacidadesVuelos) {
      const mapaVuelosUnicos = new Map<string, any>();

      // Función auxiliar para tomar solo los primeros 5 caracteres de la hora ("HH:mm")
      const normalizarHora = (timeStr: string) => {
        if (!timeStr) return "";
        const parts = timeStr.split(":");
        // Asegura que horas y minutos siempre tengan 2 dígitos (ej. "8" -> "08")
        return `${parts[0].padStart(2, "0")}:${parts[1].padStart(2, "0")}`;
      };

      Object.values(solucion.rutasAsignadas).forEach((ruta) => {
        ruta.forEach((vuelo) => {
          const llaveVuelo = `${vuelo.origen}-${vuelo.destino}-${vuelo.horaSalida}`;

          if (!mapaVuelosUnicos.has(llaveVuelo)) {
            const coordOrigen = aeropuertosDB[vuelo.origen];
            const coordDestino = aeropuertosDB[vuelo.destino];

            if (coordOrigen && coordDestino) {
              // ── ENCONTRAR CARGA DE FORMA ROBUSTA ──
              const llaveOcupacionReal = Object.keys(
                solucion.ocupacionVuelos,
              ).find((key) => {
                const partes = key.split("_")[0].split("-"); // Separa ["ORÍGEN", "DESTINO", "HORA"]
                if (partes.length < 3) return false;
                return (
                  partes[0] === vuelo.origen &&
                  partes[1] === vuelo.destino &&
                  normalizarHora(partes[2]) === normalizarHora(vuelo.horaSalida)
                );
              });

              const cantidad = llaveOcupacionReal
                ? solucion.ocupacionVuelos[llaveOcupacionReal]
                : 0;
                
              // --- EL FILTRO VISUAL DEFINITIVO ---
              // Si el avión no lleva ninguna maleta nuestra, no lo dibujamos.
              if (cantidad === 0) return;

              const capMax =
                solucion.capacidadesVuelos[llaveVuelo] ||
                vuelo.capacidadMax ||
                350;
              const pct = (cantidad / capMax) * 100;

              let color = "#178D47";
              if (pct >= 90) color = "#E32929";
              else if (pct >= 70) color = "#FFB800";

              mapaVuelosUnicos.set(llaveVuelo, {
                id: llaveVuelo,
                origen: vuelo.origen,
                destino: vuelo.destino,
                horaSalida: vuelo.horaSalida,
                horaLlegada: vuelo.horaLlegada,
                cantidad,
                capMax,
                pct,
                color,
                lat1: coordOrigen.lat,
                lng1: coordOrigen.lng,
                lat2: coordDestino.lat,
                lng2: coordDestino.lng,
              });
            }
          }
        });
      });

      setRutasVisuales(Array.from(mapaVuelosUnicos.values()));
    } else {
      setRutasVisuales([]);
    }
  }, [solucion]);

  const elementosMapa = useMemo(() => {
    const avionesEnPantalla: React.ReactElement[] = [];
    let lineaRutaSeleccionada: React.ReactElement | null = null;

    rutasVisuales.forEach((vuelo) => {
      // 1. Calculamos dónde debería estar el avión a la hora exacta
      const progresoReal = calcularProgresoReal(
        vuelo.horaSalida,
        vuelo.horaLlegada,
        horaVirtualMinutos,
      );

      // 2. Si el valor es negativo (no despega) o mayor/igual a 1 (ya llegó), no lo dibujamos
      if (progresoReal < 0 || progresoReal >= 1) return;

      // 3. Si está volando, interpolamos su posición matemática exacta en el mapa
      const lat = vuelo.lat1 + (vuelo.lat2 - vuelo.lat1) * progresoReal;
      const lng = vuelo.lng1 + (vuelo.lng2 - vuelo.lng1) * progresoReal;

      const isSelected = vueloSeleccionado === vuelo.id;
      const isDimmed = vueloSeleccionado !== null && !isSelected;

      if (isSelected) {
        lineaRutaSeleccionada = (
          <Polyline
            key={`line-${vuelo.id}`}
            positions={[
              [vuelo.lat1, vuelo.lng1],
              [vuelo.lat2, vuelo.lng2],
            ]}
            color={vuelo.color}
            weight={3}
            opacity={0.8}
            dashArray="8"
          />
        );
      }

      avionesEnPantalla.push(
        <Marker
          key={`plane-${vuelo.id}`}
          position={[lat, lng]}
          icon={getPlaneIcon(vuelo.color, isSelected, isDimmed)}
          zIndexOffset={isSelected ? 1000 : 0}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              setVueloSeleccionado(isSelected ? null : vuelo.id);
            },
          }}
        >
          <Popup autoPan={false}>
            <div className="text-center min-w-[120px]">
              <strong className="text-tasf-dark font-bold text-lg">
                {vuelo.origen} ➔ {vuelo.destino}
              </strong>
              <br />
              <span className="text-slate-500">
                Ocupación: {vuelo.cantidad} / {vuelo.capMax}
              </span>
              <br />
              <span
                className={`font-bold text-xs px-2 py-1 rounded mt-2 inline-block ${
                  vuelo.pct >= 90
                    ? "bg-red-100 text-tasf-red"
                    : "bg-slate-100 text-tasf-dark"
                }`}
              >
                {vuelo.pct >= 90 ? "ALERTA SLA" : "EN TRÁNSITO"}
              </span>
            </div>
          </Popup>
        </Marker>,
      );
    });

    return { avionesEnPantalla, lineaRutaSeleccionada };
  }, [rutasVisuales, horaVirtualMinutos, vueloSeleccionado]);

  return (
    <MapContainer
      preferCanvas={true} // <-- CAMBIO 3: Renderizado por GPU para proteger la RAM
      center={[30, 0]}
      zoom={3}
      style={{ height: "100%", width: "100%", zIndex: 10 }}
    >
      <TileLayer
        url={modoOscuro
          ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
          : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"}
        attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
      />
      <EventosMapa alHacerClic={() => setVueloSeleccionado(null)} />

      {/* Pins de aeropuertos */}
      {Object.entries(aeropuertosDB).map(([codigo, coord]) => (
        <Marker
          key={`aero-${codigo}`}
          position={[coord.lat, coord.lng]}
          icon={pinAeropuerto}
        >
          <Popup autoPan={false}>
            <div className="text-center min-w-[100px]">
              <strong className="text-tasf-dark font-bold">{codigo}</strong>
              <br />
              <span className="text-slate-500 text-xs">{coord.nombre}</span>
            </div>
          </Popup>
        </Marker>
      ))}

      {elementosMapa.lineaRutaSeleccionada}
      {elementosMapa.avionesEnPantalla}
    </MapContainer>
  );
}
