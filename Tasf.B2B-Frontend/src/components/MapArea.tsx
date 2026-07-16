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
  vuelosCancelados?: Set<string>;
  mostrarVuelosCancelados?: boolean;
  onToggleCancelados?: () => void;
  canceladoResaltado?: string | null;
  onCanceladoResaltadoClear?: () => void;
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

function VolarACancelado({ clave, posicion }: { clave: string | null | undefined; posicion: [number, number] | null }) {
  const map = useMap();
  const prev = useRef<string | null>(null);
  useEffect(() => {
    if (clave && posicion && clave !== prev.current) {
      prev.current = clave;
      map.flyTo(posicion, Math.max(map.getZoom(), 5), { duration: 1.2 });
    }
    if (!clave) prev.current = null;
  }, [clave, posicion]);
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
  const planePath = "M21,16V14L13,9V3.5A1.5,1.5 0 0,0 11.5,2A1.5,1.5 0 0,0 10,3.5V9L2,14V16L10,13.5V19L8,20.5V22L11.5,21L15,22V20.5L13,19V13.5L21,16Z";
  const glow = isSelected ? `drop-shadow(0 0 6px ${color})` : "";
  const icon = new L.DivIcon({
    html: `<div style="opacity:${opacity};transition:opacity 0.3s ease;">
             <svg viewBox="0 0 24 24" width="${size}px" height="${size}px" style="transform:rotate(${rumbo}deg);filter:${glow};display:block;">
               <path d="${planePath}" fill="${color}"/>
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
  vuelosCancelados,
  mostrarVuelosCancelados = false,
  onToggleCancelados,
  canceladoResaltado,
  onCanceladoResaltadoClear,
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
      let color = "#94a3b8"; // gris = sin maletas
      if (cantidad > 0) {
        color = pct >= 80 ? "#f87171" : pct >= 50 ? "#fbbf24" : "#4ade80";
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

      const opacity = estado === "activo" ? 1.0 : estado === "completado" ? 0.5 : 0.25;
      const weight = estado === "activo" ? 5.0 : estado === "completado" ? 2.0 : 1.5;
      const color = estado === "activo" ? "#38bdf8" : estado === "completado" ? "#64748b" : "#94a3b8";
      const dashArray = estado === "activo" ? undefined : "4 5";

      const elementos: React.ReactElement[] = [];

      // Halo blanco detrás del tramo activo para que destaque más
      if (estado === "activo") {
        elementos.push(
          <Polyline
            key={`envio-halo-${id}`}
            positions={[[vueloVisual.lat1, vueloVisual.lng1], [vueloVisual.lat2, vueloVisual.lng2]]}
            color="white"
            weight={8}
            opacity={0.25}
          />
        );
      }

      elementos.push(
        <Polyline
          key={`envio-route-${id}`}
          positions={[[vueloVisual.lat1, vueloVisual.lng1], [vueloVisual.lat2, vueloVisual.lng2]]}
          color={color}
          weight={weight}
          opacity={opacity}
          dashArray={dashArray}
        />
      );

      return elementos;
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
      const hasRutaSeleccionadaActiva =
        rutaEnvioSeleccionada !== null &&
        rutaEnvioSeleccionada !== undefined &&
        segmentosRutaSeleccionada.idsSegmentos.size > 0;
      const isRouteSegment =
        hasRutaSeleccionadaActiva &&
        segmentosRutaSeleccionada.idsSegmentos.has(vuelo.id);
      const isHighlighted = isSelected || isRouteSegment;
      const filteredOut =
        vuelosFiltrados !== null &&
        vuelosFiltrados !== undefined &&
        !vuelosFiltrados.includes(vuelo.id);
      const isDimmed =
        filteredOut ||
        ((vueloSeleccionado !== null || hasRutaSeleccionadaActiva) &&
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
    const lineasNormales: React.ReactElement[] = [];
    let lineaSeleccionada: React.ReactElement | null = null; // Guardar la seleccionada para pintarla al final (encima de todas)

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

      const tieneSeleccionActiva = vueloSeleccionado !== null || rutaEnvioSeleccionada !== null;

      const opacity = tieneSeleccionActiva ? (esSeleccionado ? 1.0 : 0.25) : 0.75;
      const weight = tieneSeleccionActiva ? (esSeleccionado ? 5.5 : 1.5) : 1.5;
      const dashArray = tieneSeleccionActiva ? (esSeleccionado ? undefined : "3 9") : "5 7";

      const polylineKey = `route-${vuelo.id}-${esSeleccionado ? "selected" : "dimmed"}-${tieneSeleccionActiva ? "active" : "idle"}`;

      const elementoPolyline = (
        <Polyline
          key={polylineKey}
          positions={[inicio, destino]}
          color={vuelo.color}
          weight={weight}
          opacity={opacity}
          dashArray={dashArray}
        />
      );

      // Si es la seleccionada, la apartamos para que se renderice AL FINAL
      if (esSeleccionado) {
        lineaSeleccionada = elementoPolyline;
      } else {
        lineasNormales.push(elementoPolyline);
      }
    });

    // Retornamos todas las líneas normales y, si existe, la seleccionada encima del resto
    return lineaSeleccionada ? [...lineasNormales, lineaSeleccionada] : lineasNormales;
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

  const canceladosActivos = useMemo(() => {
    if (!vuelosCancelados || vuelosCancelados.size === 0) return [];
    const horasLlegadaMap = solucion?.horasLlegada ?? {};
    const minutosActuales = minutosVirtualesTotales ?? horaVirtualMinutos;
    return [...vuelosCancelados].flatMap(clave => {
      const idx = clave.lastIndexOf('_');
      const ruta = idx >= 0 ? clave.substring(0, idx) : clave;
      const fecha = idx >= 0 ? clave.substring(idx + 1) : '';
      const partes = ruta.split('-');
      const origen = partes[0]; const destino = partes[1]; const horaSalida = partes[2] ?? '';
      const horaLlegadaRaw = horasLlegadaMap[ruta] ?? '';
      if (!horaLlegadaRaw) return [];
      const normH = (t: string) => { const p = (t ?? '').split(':'); return `${p[0].padStart(2,'0')}:${(p[1]??'00').padStart(2,'0')}:${(p[2]??'00').padStart(2,'0')}`; };
      const horaLlegada = normH(horaLlegadaRaw);
      const progreso = calcularProgresoTotal(fecha, horaSalida, horaLlegada, fechaInicioSim ?? '', minutosActuales ?? 0);
      if (progreso < 0 || progreso >= 1) return [];
      const coordO = aeropuertosDB[origen]; const coordD = aeropuertosDB[destino];
      if (!coordO || !coordD) return [];
      const rumbo = calcularRumbo(coordO.lat, coordO.lng, coordD.lat, coordD.lng);
      const lat = coordO.lat + (coordD.lat - coordO.lat) * progreso;
      const lng = coordO.lng + (coordD.lng - coordO.lng) * progreso;
      return [{ clave, ruta, origen, destino, horaSalida, horaLlegada, fecha, lat, lng, rumbo, coordO, coordD }];
    });
  }, [vuelosCancelados, solucion, minutosVirtualesTotales, horaVirtualMinutos, fechaInicioSim]);

  const posicionCanceladoResaltado = useMemo<[number, number] | null>(() => {
    if (!canceladoResaltado) return null;
    const v = canceladosActivos.find(c => c.clave === canceladoResaltado);
    return v ? [v.lat, v.lng] : null;
  }, [canceladoResaltado, canceladosActivos]);

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

        {canceladosActivos.length > 0 && onToggleCancelados && (
          <button
            onClick={onToggleCancelados}
            className={`flex items-center gap-1.5 text-[11px] font-bold px-3 py-1.5 rounded-lg shadow-lg border transition-colors w-fit ${mostrarVuelosCancelados ? "bg-slate-600 border-slate-400 text-white" : "bg-slate-900/90 border-slate-600 text-slate-400 hover:text-white hover:border-slate-400"}`}
          >
            <span
              style={{
                display: "inline-block",
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: "#fb923c",
              }}
            />
            {mostrarVuelosCancelados ? "Ocultar cancelados" : "Mostrar cancelados"} ({canceladosActivos.length})
          </button>
        )}
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
         key={modoOscuro ? "oscuro" : "claro"} /* <-- ESTA LÍNEA ES LA CLAVE */
         url="https://mt1.google.com/vt/lyrs=m&hl=es&x={x}&y={y}&z={z}"
         attribution='&copy; Google Maps'
        className={modoOscuro ? "mapa-oscuro" : ""}
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
        <VolarACancelado clave={canceladoResaltado} posicion={posicionCanceladoResaltado} />

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
          const pinW = resaltado ? 32 : 24;
          const pinH = resaltado ? 32 : 24;
          const fillColor =
            pct >= 80 ? "#E32929" : pct >= 50 ? "#FFB800" : "#22c55e";
          const pinDinamico = new L.DivIcon({
            html: `<svg viewBox="0 0 24 24" width="${pinW}" height="${pinH}" xmlns="http://www.w3.org/2000/svg" opacity="${aeroFilteredOut ? 0.15 : 1}" style="filter: drop-shadow(0px 3px 4px rgba(0,0,0,0.6));">
            <path fill="${fillColor}" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <path fill="white" d="M15.5 10.5l-3-2V5.25a.75.75 0 0 0-1.5 0V8.5l-3 2v.75l3-1v2.25l-1 .75v.5l1.75-.5 1.75.5v-.5l-1-.75v-2.25l3 1v-.75z"/>
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
        {mostrarVuelosCancelados && canceladosActivos.map(v => (
          <React.Fragment key={`cancelado-${v.clave}`}>
            <Polyline
              positions={[[v.coordO.lat, v.coordO.lng], [v.coordD.lat, v.coordD.lng]]}
              color="#fb923c" weight={2} opacity={0.5} dashArray="8 6" />
            <Marker
              position={[v.lat, v.lng]}
              icon={getPlaneIcon('#fb923c', false, false, v.rumbo)}
              zIndexOffset={0}>
              <Popup autoPan={false}>
                <div className="text-center min-w-[110px]">
                  <strong className="text-orange-600">✕ Cancelado</strong><br/>
                  <span className="text-xs font-mono">{v.origen} → {v.destino}</span><br/>
                  <span className="text-slate-500 text-xs">{v.horaSalida.substring(0,5)} → {v.horaLlegada.substring(0,5)}</span>
                </div>
              </Popup>
            </Marker>
          </React.Fragment>
        ))}
      </MapContainer>
    </div>
  );
}
