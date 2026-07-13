import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  Polyline,
  useMapEvents,
  useMap,
} from "react-leaflet";
import L from "leaflet";
import type { Solucion } from "../types";
import { aeropuertosDB } from "../data/coordenadas";

interface MapAreaProps {
  solucion: Solucion | null;
  progreso: number;
  modoOscuro?: boolean;
  horaVirtualMinutos?: number;
  minutosVirtualesTotales?: number;
  fechaInicioSim?: string;
  vueloResaltado?: string | null;
  onVueloResaltadoClear?: () => void;
  aeropuertoResaltado?: string | null;
  ocupacionAeropuertosRT?: Record<string, number>;
  onAeropuertoClick?: (codigo: string) => void;
  onVueloClick?: (key: string) => void;
  aeropuertosFiltrados?: string[] | null;
  vuelosFiltrados?: string[] | null;
  rutaEnvioSeleccionada?: string | null;
  onRutaEnvioSeleccionadaClear?: () => void;
}

function EventosMapa({ alHacerClic }: { alHacerClic: () => void }) {
  useMapEvents({ click: () => alHacerClic() });
  return null;
}

function RedibujarMapa() {
  const map = useMap();

  useEffect(() => {
    const refrescar = () => {
      window.requestAnimationFrame(() => map.invalidateSize());
    };

    refrescar();
    const timer = window.setTimeout(refrescar, 180);
    window.addEventListener("resize", refrescar);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", refrescar);
    };
  }, [map]);

  return null;
}

function VolarAAeropuerto({ codigo }: { codigo: string | null | undefined }) {
  const map = useMap();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (codigo && codigo !== prev.current) {
      prev.current = codigo;
      const coord = aeropuertosDB[codigo];
      if (coord)
        map.flyTo([coord.lat, coord.lng], Math.max(map.getZoom(), 6), {
          duration: 1.2,
        });
    }
    if (!codigo) prev.current = null;
  }, [codigo]);
  return null;
}

// Vuela al avión una sola vez cuando cambia el id seleccionado
function VolarAAvion({
  posicion,
  vueloId,
}: {
  posicion: [number, number] | null;
  vueloId: string | null;
}) {
  const map = useMap();
  const prevId = useRef<string | null>(null);
  useEffect(() => {
    if (posicion && vueloId && vueloId !== prevId.current) {
      prevId.current = vueloId;
      map.flyTo(posicion, Math.max(map.getZoom(), 5), { duration: 1.2 });
    }
    if (!vueloId) prevId.current = null;
  }, [vueloId, posicion]);
  return null;
}

const calcularRumbo = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const rlat1 = toRad(lat1);
  const rlat2 = toRad(lat2);
  const x = Math.sin(dLng) * Math.cos(rlat2);
  const y =
    Math.cos(rlat1) * Math.sin(rlat2) -
    Math.sin(rlat1) * Math.cos(rlat2) * Math.cos(dLng);
  return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
};

const cacheIconos: Record<string, L.DivIcon> = {};

const getPlaneIcon = (
  color: string,
  isSelected: boolean,
  isDimmed: boolean,
  rumbo: number,
) => {
  const key = `${color}-${isSelected}-${isDimmed}-${Math.round(rumbo)}`;
  if (cacheIconos[key]) return cacheIconos[key];
  const size = isSelected ? 36 : 24;
  const opacity = isDimmed ? 0.2 : 1;
  const shadow = isSelected
    ? `drop-shadow(0px 0px 10px ${color})`
    : "drop-shadow(0px 0px 2px rgba(0,0,0,0.8))";
  const icon = new L.DivIcon({
    html: `<div style="opacity: ${opacity}; transition: opacity 0.3s ease;">
             <svg viewBox="0 0 24 24" fill="${color}" width="${size}" height="${size}" style="transform: rotate(${rumbo}deg); filter: ${shadow};">
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

const parseHoraAMinutos = (horaStr: string): number => {
  const [h, m] = horaStr.split(":").map(Number);
  return h * 60 + m;
};

// Calcula progreso usando minutos totales desde inicio de simulación y fecha del vuelo
const calcularProgresoTotal = (
  fechaSalidaStr: string,
  horaSalida: string,
  horaLlegada: string,
  fechaInicioSim: string,
  minutosActuales: number,
) => {
  if (!fechaSalidaStr || !horaSalida || !horaLlegada || !fechaInicioSim)
    return -1;
  const [fy, fm, fd] = fechaInicioSim.split("-").map(Number);
  const [vy, vm, vd] = fechaSalidaStr.split("-").map(Number);
  if (isNaN(fy) || isNaN(vy)) return -1;
  const inicioSim = new Date(fy, fm - 1, fd);
  const fechaVuelo = new Date(vy, vm - 1, vd);
  const diasOffset = Math.floor(
    (fechaVuelo.getTime() - inicioSim.getTime()) / 86400000,
  );
  const minSalida = diasOffset * 1440 + parseHoraAMinutos(horaSalida);
  let minLlegada = diasOffset * 1440 + parseHoraAMinutos(horaLlegada);
  if (isNaN(minSalida) || isNaN(minLlegada)) return -1;
  if (minLlegada <= minSalida) minLlegada += 1440; // vuelo nocturno
  if (minutosActuales < minSalida) return -1;
  if (minutosActuales >= minLlegada) return 2;
  return (minutosActuales - minSalida) / (minLlegada - minSalida);
};

export default function MapArea({
  solucion,
  progreso,
  modoOscuro = true,
  horaVirtualMinutos = 0,
  minutosVirtualesTotales,
  fechaInicioSim = "2026-01-05",
  vueloResaltado,
  onVueloResaltadoClear,
  aeropuertoResaltado,
  ocupacionAeropuertosRT = {},
  onAeropuertoClick,
  onVueloClick,
  aeropuertosFiltrados,
  vuelosFiltrados,
  rutaEnvioSeleccionada,
  onRutaEnvioSeleccionadaClear,
}: MapAreaProps) {
  const [vueloSeleccionado, setVueloSeleccionado] = useState<string | null>(
    null,
  );
  const [mostrarVacíos, setMostrarVacíos] = useState(false);
  const [mostrarRutas, setMostrarRutas] = useState(true);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const aeroMarkerRefs = useRef<Map<string, L.Marker>>(new Map());

  // 1. Sincronizar selección desde panel lateral
  useEffect(() => {
    setVueloSeleccionado(vueloResaltado ?? null);
  }, [vueloResaltado]);

  // 2. Abrir popup DESPUÉS de que React re-renderice el marker con isSelected=true
  useEffect(() => {
    if (!vueloSeleccionado) return;
    const timer = setTimeout(() => {
      const marker = markerRefs.current.get(vueloSeleccionado);
      if (marker) marker.openPopup();
    }, 200);
    return () => clearTimeout(timer);
  }, [vueloSeleccionado]);

  // 3. Abrir popup del aeropuerto cuando se selecciona desde el drawer
  useEffect(() => {
    if (!aeropuertoResaltado) return;
    const timer = setTimeout(() => {
      const marker = aeroMarkerRefs.current.get(aeropuertoResaltado);
      if (marker) marker.openPopup();
    }, 300);
    return () => clearTimeout(timer);
  }, [aeropuertoResaltado]);

  // Construir vuelos desde ocupacionVuelos (incluye vuelos con 0 maletas desde el backend)
  const rutasVisuales = useMemo(() => {
    if (!solucion?.ocupacionVuelos) return [];

    const normalizarHora = (t: string) => {
      const parts = t.split(":");
      return `${parts[0].padStart(2, "0")}:${(parts[1] ?? "00").padStart(2, "0")}:${(parts[2] ?? "00").padStart(2, "0")}`;
    };

    // Recoger conteo de envíos desde rutasAsignadas + fechasTramos (clave con fecha para no mezclar días)
    const enviosPorVuelo = new Map<string, number>();
    const fechasTramos = (solucion as any).fechasTramos ?? {};
    Object.entries(solucion.rutasAsignadas ?? {}).forEach(
      ([id, ruta]: [string, any]) => {
        const fechas: string[] = fechasTramos[id] ?? [];
        ruta.forEach((vuelo: any, i: number) => {
          const fecha = fechas[i];
          if (!fecha) return;
          const k = `${vuelo.origen}-${vuelo.destino}-${normalizarHora(vuelo.horaSalida)}_${fecha}`;
          enviosPorVuelo.set(k, (enviosPorVuelo.get(k) ?? 0) + 1);
        });
      },
    );
    const horasLlegada = solucion.horasLlegada ?? {};

    const resultado: any[] = [];
    Object.entries(solucion.ocupacionVuelos).forEach(([llave, cantidad]) => {
      const idx = llave.lastIndexOf("_");
      if (idx < 0) return;
      const sinFecha = llave.substring(0, idx);
      const fechaSalida = llave.substring(idx + 1);
      const partes = sinFecha.split("-");
      if (partes.length < 3) return;
      const origen = partes[0];
      const destino = partes[1];
      const horaSalidaRaw = partes.slice(2).join(":");

      const coordOrigen = aeropuertosDB[origen];
      const coordDestino = aeropuertosDB[destino];
      if (!coordOrigen || !coordDestino) return;

      const claveRuta = `${origen}-${destino}-${normalizarHora(horaSalidaRaw)}`;
      const claveConFecha = `${claveRuta}_${fechaSalida}`;
      const horaLlegada = horasLlegada[claveRuta] ?? "";
      if (!horaLlegada) return; // sin datos de llegada: no renderizar
      const cap = solucion.capacidadesVuelos?.[claveRuta] ?? 350;
      const pct = cap > 0 ? (cantidad / cap) * 100 : 0;
      let color = "#64748b"; // gris = sin maletas
      if (cantidad > 0) {
        color = pct >= 80 ? "#E32929" : pct >= 50 ? "#FFB800" : "#178D47";
      }

      resultado.push({
        id: llave,
        origen,
        destino,
        horaSalida: horaSalidaRaw,
        horaLlegada,
        fechaSalida,
        cantidad,
        capMax: cap,
        pct,
        color,
        numEnvios: enviosPorVuelo.get(claveConFecha) ?? 0,
        lat1: coordOrigen.lat,
        lng1: coordOrigen.lng,
        lat2: coordDestino.lat,
        lng2: coordDestino.lng,
      });
    });

    return resultado;
  }, [solucion]);

  // Indicadores globales
  const indicadores = useMemo(() => {
    const minutosActuales = minutosVirtualesTotales ?? horaVirtualMinutos;
    let totalMaletasFlota = 0,
      totalCapFlota = 0;
    rutasVisuales.forEach((vuelo) => {
      if (vuelo.cantidad === 0) return;
      const p = vuelo.fechaSalida
        ? calcularProgresoTotal(
            vuelo.fechaSalida,
            vuelo.horaSalida,
            vuelo.horaLlegada,
            fechaInicioSim,
            minutosActuales,
          )
        : -1;
      if (p < 0 || p >= 1) return;
      totalMaletasFlota += vuelo.cantidad;
      totalCapFlota += vuelo.capMax;
    });
    const pctFlota =
      totalCapFlota > 0
        ? Math.round((totalMaletasFlota / totalCapFlota) * 100)
        : 0;

    let totalMaletasAero = 0,
      totalCapAero = 0;
    Object.entries(aeropuertosDB).forEach(([codigo]) => {
      const cap = solucion?.capacidadesAeropuertos?.[codigo] ?? 0;
      if (cap <= 0) return;
      totalMaletasAero += ocupacionAeropuertosRT[codigo] ?? 0;
      totalCapAero += cap;
    });
    const pctAero =
      totalCapAero > 0
        ? Math.round((totalMaletasAero / totalCapAero) * 100)
        : 0;

    return {
      pctFlota,
      totalMaletasFlota,
      totalCapFlota,
      pctAero,
      totalMaletasAero,
      totalCapAero,
    };
  }, [
    rutasVisuales,
    minutosVirtualesTotales,
    horaVirtualMinutos,
    fechaInicioSim,
    ocupacionAeropuertosRT,
    solucion,
  ]);

  const colorSemaforo = (pct: number) =>
    pct >= 80 ? "#E32929" : pct >= 50 ? "#FFB800" : "#178D47";

  const segmentosRutaSeleccionada = useMemo(() => {
    if (!rutaEnvioSeleccionada) {
      return { lineas: [] as React.ReactElement[], idsSegmentos: new Set<string>(), vueloActivoId: null as string | null };
    }

    const normalizarHora = (t: string) => {
      const parts = t.split(":");
      return `${parts[0].padStart(2, "0")}:${(parts[1] ?? "00").padStart(2, "0")}:${(parts[2] ?? "00").padStart(2, "0")}`;
    };

    const minutosActuales = minutosVirtualesTotales ?? horaVirtualMinutos;
    const tramos = (solucion as any)?.rutasAsignadas?.[rutaEnvioSeleccionada] ?? [];
    const fechas = (solucion as any)?.fechasTramos?.[rutaEnvioSeleccionada] ?? [];
    const idsSegmentos = new Set<string>();
    let vueloActivoId: string | null = null;
    const lineas = tramos.flatMap((tramo: any, index: number) => {
      const fecha = fechas[index];
      const id = fecha
        ? `${tramo.origen}-${tramo.destino}-${normalizarHora(tramo.horaSalida ?? "")}_${fecha}`
        : `${tramo.origen}-${tramo.destino}-${normalizarHora(tramo.horaSalida ?? "")}`;
      const vueloVisual = rutasVisuales.find((v) => v.id === id);
      if (!vueloVisual) return [];

      idsSegmentos.add(vueloVisual.id);
      const p = calcularProgresoTotal(
        vueloVisual.fechaSalida,
        vueloVisual.horaSalida,
        vueloVisual.horaLlegada,
        fechaInicioSim,
        minutosActuales,
      );
      const estado = p < 0 ? "pendiente" : p >= 1 ? "completado" : "activo";
      if (!vueloActivoId && estado === "activo") vueloActivoId = vueloVisual.id;

      const opacity = estado === "activo" ? 0.95 : estado === "completado" ? 0.65 : 0.28;
      const weight = estado === "activo" ? 2.7 : estado === "completado" ? 2.2 : 1.6;

      return [
        <Polyline
          key={`envio-route-${id}`}
          positions={[[vueloVisual.lat1, vueloVisual.lng1], [vueloVisual.lat2, vueloVisual.lng2]]}
          color="#38bdf8"
          weight={weight}
          opacity={opacity}
          dashArray={estado === "activo" ? "6 5" : "4 4"}
        />,
      ];
    });

    return { lineas, idsSegmentos, vueloActivoId };
  }, [rutaEnvioSeleccionada, rutasVisuales, solucion, minutosVirtualesTotales, horaVirtualMinutos, fechaInicioSim]);

  const elementosMapa = useMemo(() => {
    const avionesEnPantalla: React.ReactElement[] = [];
    let posicionResaltado: [number, number] | null = null;
    let idVueloEnfocado: string | null = null;

    const minutosActuales = minutosVirtualesTotales ?? horaVirtualMinutos;
    rutasVisuales.forEach((vuelo) => {
      if (!mostrarVacíos && vuelo.cantidad === 0) return;
      const progresoReal =
        vuelo.fechaSalida && minutosVirtualesTotales !== undefined
          ? calcularProgresoTotal(
              vuelo.fechaSalida,
              vuelo.horaSalida,
              vuelo.horaLlegada,
              fechaInicioSim,
              minutosActuales,
            )
          : -1;
      if (progresoReal < 0 || progresoReal >= 1) return;

      const lat = vuelo.lat1 + (vuelo.lat2 - vuelo.lat1) * progresoReal;
      const lng = vuelo.lng1 + (vuelo.lng2 - vuelo.lng1) * progresoReal;
      const rumbo = calcularRumbo(
        vuelo.lat1,
        vuelo.lng1,
        vuelo.lat2,
        vuelo.lng2,
      );

      const isSelected = vueloSeleccionado === vuelo.id;
      const isRouteSegment =
        rutaEnvioSeleccionada !== null &&
        rutaEnvioSeleccionada !== undefined &&
        segmentosRutaSeleccionada.idsSegmentos.has(vuelo.id);
      const isHighlighted = isSelected || isRouteSegment;
      const filteredOut =
        vuelosFiltrados !== null &&
        vuelosFiltrados !== undefined &&
        !vuelosFiltrados.includes(vuelo.id);
      const isDimmed =
        filteredOut ||
        ((vueloSeleccionado !== null || rutaEnvioSeleccionada !== null) &&
          !isHighlighted);

      if (isSelected) {
        posicionResaltado = [lat, lng];
        idVueloEnfocado = vuelo.id;
      } else if (
        !vueloSeleccionado &&
        rutaEnvioSeleccionada &&
        segmentosRutaSeleccionada.vueloActivoId === vuelo.id
      ) {
        posicionResaltado = [lat, lng];
        idVueloEnfocado = vuelo.id;
      }

      avionesEnPantalla.push(
        <Marker
          key={`plane-${vuelo.id}`}
          position={[lat, lng]}
          icon={getPlaneIcon(vuelo.color, isHighlighted, isDimmed, rumbo)}
          zIndexOffset={isHighlighted ? 1000 : 0}
          ref={(ref) => {
            if (ref) markerRefs.current.set(vuelo.id, ref);
          }}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              if (onRutaEnvioSeleccionadaClear) onRutaEnvioSeleccionadaClear();
              setVueloSeleccionado(isSelected ? null : vuelo.id);
              if (isSelected && onVueloResaltadoClear) onVueloResaltadoClear();
              else onVueloClick?.(vuelo.id);
            },
          }}
        >
          <Popup autoPan={false}>
            <div style={{ minWidth: 165 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 6 }}>
                {vuelo.origen} ➔ {vuelo.destino}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "4px 12px",
                  fontSize: 11,
                }}
              >
                <span style={{ color: "#64748b" }}>Salida</span>
                <span style={{ fontWeight: 600 }}>{vuelo.horaSalida}</span>
                <span style={{ color: "#64748b" }}>Llegada</span>
                <span style={{ fontWeight: 600 }}>{vuelo.horaLlegada}</span>
                <span style={{ color: "#64748b" }}>Maletas</span>
                <span style={{ fontWeight: 600 }}>
                  {vuelo.cantidad} / {vuelo.capMax}
                </span>
                <span style={{ color: "#64748b" }}>Ocupación</span>
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      vuelo.pct >= 90
                        ? "#E32929"
                        : vuelo.pct >= 70
                          ? "#FFB800"
                          : "#178D47",
                  }}
                >
                  {vuelo.pct.toFixed(1)}%
                </span>
                <span style={{ color: "#64748b" }}>Envíos</span>
                <span style={{ fontWeight: 600 }}>{vuelo.numEnvios}</span>
              </div>
              {vuelo.pct >= 90 && (
                <div
                  style={{
                    marginTop: 6,
                    background: "#fee2e2",
                    color: "#E32929",
                    fontSize: 10,
                    fontWeight: 700,
                    padding: "2px 6px",
                    borderRadius: 4,
                    textAlign: "center",
                  }}
                >
                  ALERTA SLA
                </div>
              )}
            </div>
          </Popup>
        </Marker>,
      );
    });

    return { avionesEnPantalla, posicionResaltado, idVueloEnfocado };
  }, [
    rutasVisuales,
    minutosVirtualesTotales ?? 0,
    vueloSeleccionado,
    mostrarVacíos,
    vuelosFiltrados,
    rutaEnvioSeleccionada,
    segmentosRutaSeleccionada.idsSegmentos,
    segmentosRutaSeleccionada.vueloActivoId,
  ]);

  // Línea de ruta visible para todos los vuelos o para el vuelo seleccionado
  const lineasRutas = useMemo(() => {
    if (rutaEnvioSeleccionada) return [];
    if (!mostrarRutas && !vueloSeleccionado) return [];

    const minutosActuales = minutosVirtualesTotales ?? horaVirtualMinutos;
    const lineas: React.ReactElement[] = [];

    rutasVisuales.forEach((vuelo) => {
      if (!mostrarVacíos && vuelo.cantidad === 0) return;

      const p =
        vuelo.fechaSalida && minutosVirtualesTotales !== undefined
          ? calcularProgresoTotal(
              vuelo.fechaSalida,
              vuelo.horaSalida,
              vuelo.horaLlegada,
              fechaInicioSim,
              minutosActuales,
            )
          : -1;

      if (p < 0 || p >= 1) return;

      const inicio: [number, number] = [vuelo.lat1, vuelo.lng1];
      const destino: [number, number] = [vuelo.lat2, vuelo.lng2];

      const esSeleccionado = vueloSeleccionado === vuelo.id;
      if (!mostrarRutas && !esSeleccionado) return;

      lineas.push(
        <Polyline
          key={`route-${vuelo.id}`}
          positions={[inicio, destino]}
          color={vuelo.color}
          weight={esSeleccionado ? 2 : 1.4}
          opacity={esSeleccionado ? 0.75 : 0.35}
          dashArray={esSeleccionado ? "6 4" : "4 6"}
        />,
      );
    });

    return lineas;
  }, [
    mostrarRutas,
    mostrarVacíos,
    rutasVisuales,
    minutosVirtualesTotales,
    horaVirtualMinutos,
    fechaInicioSim,
    vueloSeleccionado,
    rutaEnvioSeleccionada,
  ]);

  return (
    <div style={{ position: "relative", height: "100%", width: "100%" }}>
      {/* Panel Flotante Unificado (Evita que los elementos se encimen) */}
      <div
        style={{
          position: "absolute",
          bottom: 24,
          left: 12,
          zIndex: 1000,
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {/* Flota */}
        <div
          style={{
            background: "rgba(15,23,42,0.92)",
            border: "1px solid rgba(100,116,139,0.4)",
            borderRadius: 10,
            padding: "8px 12px",
            minWidth: 150,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            Ocupación Flota
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: colorSemaforo(indicadores.pctFlota),
                flexShrink: 0,
                boxShadow: `0 0 6px ${colorSemaforo(indicadores.pctFlota)}`,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colorSemaforo(indicadores.pctFlota),
                  lineHeight: 1,
                }}
              >
                {indicadores.pctFlota}%
              </div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                {indicadores.totalMaletasFlota} / {indicadores.totalCapFlota}{" "}
                mal.
              </div>
            </div>
          </div>
          {/* Barra de progreso */}
          <div
            style={{
              marginTop: 6,
              height: 4,
              background: "rgba(100,116,139,0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(indicadores.pctFlota, 100)}%`,
                background: colorSemaforo(indicadores.pctFlota),
                borderRadius: 2,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>

        {/* Almacenes */}
        <div
          style={{
            background: "rgba(15,23,42,0.92)",
            border: "1px solid rgba(100,116,139,0.4)",
            borderRadius: 10,
            padding: "8px 12px",
            minWidth: 150,
            backdropFilter: "blur(6px)",
          }}
        >
          <div
            style={{
              fontSize: 9,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 4,
            }}
          >
            Ocupación Almacenes
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                background: colorSemaforo(indicadores.pctAero),
                flexShrink: 0,
                boxShadow: `0 0 6px ${colorSemaforo(indicadores.pctAero)}`,
              }}
            />
            <div style={{ flex: 1 }}>
              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: colorSemaforo(indicadores.pctAero),
                  lineHeight: 1,
                }}
              >
                {indicadores.pctAero}%
              </div>
              <div style={{ fontSize: 9, color: "#64748b", marginTop: 2 }}>
                {indicadores.totalMaletasAero} / {indicadores.totalCapAero} mal.
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 6,
              height: 4,
              background: "rgba(100,116,139,0.2)",
              borderRadius: 2,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                height: "100%",
                width: `${Math.min(indicadores.pctAero, 100)}%`,
                background: colorSemaforo(indicadores.pctAero),
                borderRadius: 2,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>

        {/* Botones de control del mapa */}
        <button
          onClick={() => setMostrarRutas((v) => !v)}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg border transition-colors w-fit ${mostrarRutas ? "bg-emerald-600/90 border-emerald-400 text-white" : "bg-slate-900/90 border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"}`}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: mostrarRutas ? "#34d399" : "#64748b",
            }}
          />
          {mostrarRutas ? "Ocultar rutas" : "Mostrar rutas"}
        </button>

        <button
          onClick={() => setMostrarVacíos((v) => !v)}
          className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg border transition-colors w-fit ${mostrarVacíos ? "bg-slate-600 border-slate-400 text-white" : "bg-slate-900/90 border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"}`}
        >
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#64748b",
            }}
          />
          {mostrarVacíos ? "Ocultar vuelos vacíos" : "Mostrar vuelos vacíos"}
        </button>
      </div>

      {/* Mapa Base */}
      <MapContainer
        preferCanvas={true}
        center={[30, 0]}
        zoom={3}
        minZoom={2}
        maxZoom={10}
        maxBounds={[
          [-90, -180],
          [90, 180],
        ]}
        maxBoundsViscosity={1.0}
        worldCopyJump={false}
        style={{ height: "100%", width: "100%", zIndex: 10 }}
      >
        <RedibujarMapa />
        <TileLayer
          url={
            modoOscuro
              ? "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
              : "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          }
          attribution='&copy; <a href="https://carto.com/">CartoDB</a>'
        />
        <EventosMapa
          alHacerClic={() => {
            setVueloSeleccionado(null);
            if (onVueloResaltadoClear) onVueloResaltadoClear();
            if (onRutaEnvioSeleccionadaClear) onRutaEnvioSeleccionadaClear();
          }}
        />
        <VolarAAvion
          posicion={elementosMapa.posicionResaltado}
          vueloId={vueloSeleccionado ?? elementosMapa.idVueloEnfocado}
        />
        <VolarAAeropuerto codigo={aeropuertoResaltado} />

        {/* Pins de aeropuertos con ocupación en tiempo real */}
        {Object.entries(aeropuertosDB).map(([codigo, coord]) => {
          const ocupacion = ocupacionAeropuertosRT[codigo] ?? 0;
          const capMax = solucion?.capacidadesAeropuertos?.[codigo] ?? 0;
          const pct = capMax > 0 ? (ocupacion / capMax) * 100 : 0;
          const color =
            pct >= 80
              ? "#E32929"
              : pct >= 50
                ? "#FFB800"
                : modoOscuro
                  ? "white"
                  : "#1e293b";
          const resaltado = aeropuertoResaltado === codigo;
          const aeroFilteredOut =
            aeropuertosFiltrados !== null &&
            aeropuertosFiltrados !== undefined &&
            !aeropuertosFiltrados.includes(codigo);
          const pinW = resaltado ? 26 : 18;
          const pinH = resaltado ? 36 : 26;
          const fillColor =
            pct >= 80 ? "#E32929" : pct >= 50 ? "#FFB800" : "#22c55e";
          const pinDinamico = new L.DivIcon({
            html: `<svg viewBox="0 0 28 24" width="${pinW}" height="${pinH}" xmlns="http://www.w3.org/2000/svg" opacity="${aeroFilteredOut ? 0.15 : 1}">
          <rect x="1" y="9" width="26" height="14" rx="1" fill="${fillColor}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
          <rect x="1" y="7" width="26" height="3" rx="0.5" fill="${fillColor}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
          <rect x="8" y="4" width="12" height="4" rx="0.5" fill="${fillColor}" stroke="rgba(0,0,0,0.5)" stroke-width="0.8"/>
          <rect x="3" y="14" width="7" height="9" rx="0.3" fill="rgba(0,0,0,0.3)"/>
          <line x1="3" y1="16" x2="10" y2="16" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
          <line x1="3" y1="18" x2="10" y2="18" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
          <line x1="3" y1="20" x2="10" y2="20" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
          <rect x="13" y="14" width="7" height="9" rx="0.3" fill="rgba(0,0,0,0.3)"/>
          <line x1="13" y1="16" x2="20" y2="16" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
          <line x1="13" y1="18" x2="20" y2="18" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
          <line x1="13" y1="20" x2="20" y2="20" stroke="rgba(255,255,255,0.3)" stroke-width="0.5"/>
        </svg>`,
            className: "bg-transparent border-none",
            iconSize: [pinW, pinH],
            iconAnchor: [pinW / 2, pinH],
            popupAnchor: [0, -pinH],
          });
          return (
            <Marker
              key={`aero-${codigo}`}
              position={[coord.lat, coord.lng]}
              icon={pinDinamico}
              ref={(ref) => {
                if (ref) aeroMarkerRefs.current.set(codigo, ref);
                else aeroMarkerRefs.current.delete(codigo);
              }}
              eventHandlers={{ click: () => onAeropuertoClick?.(codigo) }}
            >
              <Popup autoPan={false}>
                <div className="text-center min-w-[120px]">
                  <strong className="text-tasf-dark font-bold">{codigo}</strong>
                  <br />
                  <span className="text-slate-500 text-xs">{coord.nombre}</span>
                  <br />
                  {capMax > 0 && (
                    <span
                      className={`text-xs font-bold px-2 py-1 rounded mt-1 inline-block ${pct >= 80 ? "bg-red-100 text-red-600" : pct >= 50 ? "bg-yellow-100 text-yellow-600" : "bg-green-100 text-green-600"}`}
                    >
                      {ocupacion} / {capMax} maletas
                    </span>
                  )}
                </div>
              </Popup>
            </Marker>
          );
        })}

        {segmentosRutaSeleccionada.lineas}
        {lineasRutas}
        {elementosMapa.avionesEnPantalla}
      </MapContainer>
    </div>
  );
}
