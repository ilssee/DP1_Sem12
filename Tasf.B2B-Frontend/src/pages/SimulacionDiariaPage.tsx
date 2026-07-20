import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, PlusCircle } from "lucide-react";
import MapArea from "../components/MapArea";
import {
  registrarPedidoManual,
  simularVentanaDiaria,
} from "../services/simulacionService";
import type { PedidoManualDTO, Solucion } from "../types";
import { Client } from "@stomp/stompjs";
import SockJS from "sockjs-client";
import { obtenerPedidosHoy } from "../services/simulacionService";

interface PedidoLocal extends PedidoManualDTO {
  idPedido: string;
  fechaRegistro: string;
}

// Siempre usar hora Lima (UTC-5) independientemente del timezone del sistema
const toLima = (date: Date): Date =>
  new Date(date.toLocaleString("en-US", { timeZone: "America/Lima" }));

const obtenerIsoLocal = (date: Date) => {
  const lima = toLima(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${lima.getFullYear()}-${pad(lima.getMonth() + 1)}-${pad(
    lima.getDate(),
  )}T${pad(lima.getHours())}:${pad(lima.getMinutes())}:${pad(
    lima.getSeconds(),
  )}`;
};

const obtenerIsoFechaLocal = (date: Date) => {
  const lima = toLima(date);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${lima.getFullYear()}-${pad(lima.getMonth() + 1)}-${pad(lima.getDate())}`;
};

const formatearFecha = (date: Date) =>
  date.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

const formatearHora = (date: Date) =>
  date.toLocaleTimeString("es-PE", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

const parseHoraAMinutos = (hora: string) => {
  const [h = "0", m = "0"] = hora.split(":");
  return Number(h) * 60 + Number(m);
};

export default function SimulacionDiariaPage({
  modoOscuro = true,
  onRegistrar,
  onSolucionUpdate,
  rutaEnvioSeleccionada: rutaEnvioExterna,
  onRutaEnvioSeleccionadaClear: onRutaEnvioExternaClear,
  cancelacionTrigger,
  toastCancelacionExterno,
  onToastCancelacionExternoClear,
}: {
  modoOscuro?: boolean;
  onRegistrar?: () => void;
  onSolucionUpdate?: (sol: any, minutos: number, fecha: string) => void;
  rutaEnvioSeleccionada?: string | null;
  onRutaEnvioSeleccionadaClear?: () => void;
  cancelacionTrigger?: number;
  toastCancelacionExterno?: string | null;
  onToastCancelacionExternoClear?: () => void;
}) {
  const [fechaActual, setFechaActual] = useState<Date>(() => new Date());
  const [isPlaying, setIsPlaying] = useState(true);
  const [isProcessingWindow, setIsProcessingWindow] = useState(false);
  const [resultadoBackend, setResultadoBackend] = useState<Solucion | null>(
    null,
  );
  const [showForm, setShowForm] = useState(false);
  const [panelColapsado, setPanelColapsado] = useState(false);
  const [formOrigen, setFormOrigen] = useState("SPIM");
  const [formDestino, setFormDestino] = useState("");
  const [formCantidad, setFormCantidad] = useState<number | "">("");
  const [formCliente, setFormCliente] = useState("0032535");
  const [formLoading, setFormLoading] = useState(false);
  const [rutaEnvioSeleccionada, setRutaEnvioSeleccionada] = useState<
    string | null
  >(null);
  const [toastCancelacion, setToastCancelacion] = useState<string | null>(null);

  const [pedidosManuales, setPedidosManuales] = useState<PedidoLocal[]>([]);

  const ultimoBloqueSolicitado = useRef(-1);
  const windowSizeMinutes = 1;

  // Siempre en hora Lima para clasificar vuelos correctamente
  const minutosHoy = useMemo(() => {
    const lima = toLima(fechaActual);
    return lima.getHours() * 60 + lima.getMinutes();
  }, [fechaActual]);

  const fechaHoy = useMemo(
    () => obtenerIsoFechaLocal(fechaActual),
    [fechaActual],
  );

  const procesarVentana = async (fechaHora: Date) => {
    setIsProcessingWindow(true);
    try {
      const timestampAEnviar = obtenerIsoLocal(fechaHora);
      const nuevaSolucion = await simularVentanaDiaria(
        `${obtenerIsoFechaLocal(fechaHora)}T00:00:00`,
        timestampAEnviar,
        windowSizeMinutes,
      );
      setResultadoBackend(nuevaSolucion);
    } catch (error) {
      console.error("Error al traer nueva ventana:", error);
    } finally {
      setIsProcessingWindow(false);
    }
  };

  const cargarPedidosDesdeBD = async (fecha: Date) => {
    try {
      const data = await obtenerPedidosHoy(obtenerIsoLocal(fecha));
      setPedidosManuales(
        data.map((p) => ({
          idPedido: p.idPedido,
          origen: p.origen,
          destino: p.destino,
          cantidadMaletas: p.cantidadMaletas,
          idCliente: p.idCliente,
          fechaRegistro: p.fechaRegistro,
          fechaHoraVirtual: p.fechaRegistro,
        })),
      );
    } catch (e) {
      console.error("Error cargando pedidos", e);
    }
  };

  // ÚNICO useEffect PARA EL RELOJ Y WEBSOCKET (Los antiguos de localStorage fueron borrados)
  useEffect(() => {
    cargarPedidosDesdeBD(new Date());

    const client = new Client({
      webSocketFactory: () => new SockJS("http://localhost:8080/ws-tasf"), // Asegúrate que el puerto coincida con tu backend
      onConnect: () => {
        console.log("Conectado a la Orquesta WebSocket 🟢");
        client.subscribe("/topic/operaciones-diarias", () => {
          cargarPedidosDesdeBD(new Date());
          procesarVentana(new Date());
        });
      },
    });
    client.activate();

    const interval = setInterval(() => setFechaActual(new Date()), 1000);

    return () => {
      clearInterval(interval);
      client.deactivate();
    };
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const bloqueActual = Math.floor(minutosHoy / windowSizeMinutes);
    if (bloqueActual > ultimoBloqueSolicitado.current) {
      ultimoBloqueSolicitado.current = bloqueActual;
      procesarVentana(new Date());
    }
  }, [minutosHoy, isPlaying]);

  const solucionOperativa = useMemo(() => {
    if (!resultadoBackend || pedidosManuales.length === 0) return null;

    const manualIds = new Set(pedidosManuales.map((pedido) => pedido.idPedido));
    const rutasAsignadas = Object.fromEntries(
      Object.entries(resultadoBackend.rutasAsignadas ?? {}).filter(([id]) =>
        manualIds.has(id),
      ),
    );

    const rutasPlanificadas = Object.fromEntries(
      Object.entries((resultadoBackend as any).rutasPlanificadas ?? {}).filter(
        ([id]) => manualIds.has(id),
      ),
    );

    const paresRuta = new Set<string>();
    const agregarPares = (rutas: Record<string, any[]>) =>
      Object.values(rutas)
        .flat()
        .forEach((ruta: any) => {
          paresRuta.add(`${ruta.origen}-${ruta.destino}`);
        });
    agregarPares(rutasAsignadas);
    agregarPares(rutasPlanificadas);

    const partesDeClave = (key: string) => {
      const partes = key.split("-");
      return partes.length >= 2 ? `${partes[0]}-${partes[1]}` : key;
    };

    const ocupacionVuelos = Object.fromEntries(
      Object.entries(resultadoBackend.ocupacionVuelos ?? {}).filter(([key]) =>
        paresRuta.has(partesDeClave(key)),
      ),
    );

    const capacidadesVuelos = Object.fromEntries(
      Object.entries(resultadoBackend.capacidadesVuelos ?? {}).filter(([key]) =>
        paresRuta.has(partesDeClave(key)),
      ),
    );

    const aeropuertosVisibles = new Set<string>();
    const agregarAeropuertos = (rutas: Record<string, any[]>) =>
      Object.values(rutas)
        .flat()
        .forEach((ruta: any) => {
          aeropuertosVisibles.add(ruta.origen);
          aeropuertosVisibles.add(ruta.destino);
        });
    agregarAeropuertos(rutasAsignadas);
    agregarAeropuertos(rutasPlanificadas);

    const ocupacionAeropuertos = Object.fromEntries(
      Object.entries(resultadoBackend.ocupacionAeropuertos ?? {}).filter(
        ([key]) => aeropuertosVisibles.has(key.split("_")[0]),
      ),
    );

    return {
      ...resultadoBackend,
      rutasAsignadas,
      rutasPlanificadas,
      ocupacionVuelos,
      capacidadesVuelos,
      ocupacionAeropuertos,
      detallesEnvios: Object.fromEntries(
        Object.entries(resultadoBackend.detallesEnvios ?? {}).filter(([id]) =>
          manualIds.has(id),
        ),
      ),
      fechasTramos: Object.fromEntries(
        Object.entries(resultadoBackend.fechasTramos ?? {}).filter(([id]) =>
          manualIds.has(id),
        ),
      ),
      pedidosReplanificados: resultadoBackend.pedidosReplanificados ?? [],
    } as Solucion;
  }, [resultadoBackend, pedidosManuales]);

  const pedidosConEstado = useMemo(() => {
    const porEstado: Record<string, PedidoLocal[]> = {
      procesando: [],
      pendiente: [],
      asignado: [],
      "en-vuelo": [],
      completado: [],
      error: [],
    };

    pedidosManuales.forEach((pedido) => {
      const tieneRutaPlanificada =
        !!solucionOperativa?.fechasTramos?.[pedido.idPedido];

      const rutasActivas =
        solucionOperativa?.rutasAsignadas?.[pedido.idPedido] ?? [];
      const tieneRutaActiva = rutasActivas.length > 0;

      let estado = "pendiente";

      if (tieneRutaActiva) {
        estado = "en-vuelo";
      } else if (tieneRutaPlanificada) {
        estado = "asignado";
      } else {
        estado = isProcessingWindow ? "procesando" : "pendiente";
      }

      porEstado[estado] = [...porEstado[estado], pedido];
    });

    return porEstado;
  }, [pedidosManuales, solucionOperativa, minutosHoy, isProcessingWindow]);

  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();

    const origen = formOrigen.trim().toUpperCase();
    const destino = formDestino.trim().toUpperCase();

    if (origen.length !== 4 || destino.length !== 4) {
      alert(
        "Los códigos de aeropuerto deben ser de exactamente 4 caracteres (Ej: SPIM).",
      );
      return;
    }

    if (!destino || !formCantidad) return;

    setFormLoading(true);
    try {
      const pedido = await registrarPedidoManual({
        origen,
        destino,
        cantidadMaletas: Number(formCantidad),
        idCliente: formCliente.trim(),
        fechaHoraVirtual: obtenerIsoLocal(fechaActual),
      });

      // Actualización visual instantánea (el WebSocket refrescará todo de todos modos)
      setPedidosManuales((prev) => [
        ...prev,
        {
          idPedido: pedido.idPedido,
          origen,
          destino,
          cantidadMaletas: Number(formCantidad),
          idCliente: formCliente.trim(),
          fechaRegistro: pedido.fechaRegistro ?? obtenerIsoLocal(fechaActual),
          fechaHoraVirtual:
            pedido.fechaHoraVirtual ?? obtenerIsoLocal(fechaActual),
        },
      ]);

      setShowForm(false);
      setFormDestino("");
      setFormCantidad("");
      setFormCliente(formCliente.trim());
      procesarVentana(new Date());
    } catch (error: any) {
      alert(
        "Error al registrar pedido: " + (error?.message ?? "Error inesperado"),
      );
    } finally {
      setFormLoading(false);
    }
  };

  const totalPedidos = pedidosManuales.length;
  const estadoActual = formLoading
    ? "Guardando pedido..."
    : isProcessingWindow
      ? "Actualizando ventana..."
      : "Último estado sincronizado";

  useEffect(() => {
    onSolucionUpdate?.(solucionOperativa, minutosHoy, fechaHoy);
  }, [solucionOperativa, minutosHoy, fechaHoy]);

  useEffect(() => {
    if (cancelacionTrigger && cancelacionTrigger > 0) {
      procesarVentana(new Date());
    }
  }, [cancelacionTrigger]);

  return (
    <div className="h-full flex-1 min-h-0 flex flex-col relative font-sans bg-slate-950">
      <div className="flex-1 overflow-hidden min-h-0 flex gap-0">
        {/* Mapa */}
        <section className="relative flex-1 min-w-0 overflow-hidden">
          <div className="absolute top-4 left-12 z-20 w-[260px] rounded-2xl bg-slate-950/95 border border-slate-700 px-4 py-3 text-white shadow-lg">
            <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">
              Hora real
            </p>
            <p className="font-mono text-xl font-bold text-white">
              {formatearHora(fechaActual)}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {formatearFecha(fechaActual)} • {estadoActual}
            </p>
          </div>
          <MapArea
            solucion={solucionOperativa}
            progreso={0}
            modoOscuro={modoOscuro}
            horaVirtualMinutos={minutosHoy}
            minutosVirtualesTotales={minutosHoy}
            fechaInicioSim={fechaHoy}
            rutaEnvioSeleccionada={rutaEnvioExterna ?? rutaEnvioSeleccionada}
            onRutaEnvioSeleccionadaClear={() => {
              setRutaEnvioSeleccionada(null);
              onRutaEnvioExternaClear?.();
            }}
          />
        </section>

        {/* Toast cancelación */}
        {(toastCancelacion || toastCancelacionExterno) && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[500] flex items-center gap-3 bg-slate-800 border border-orange-400/60 text-white rounded-xl px-5 py-3 shadow-2xl">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-400 shrink-0" />
            <span className="text-sm font-semibold">
              {toastCancelacionExterno ?? toastCancelacion}
            </span>
            <button
              onClick={() => {
                setToastCancelacion(null);
                onToastCancelacionExternoClear?.();
              }}
              className="ml-2 text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          </div>
        )}

        {/* Botón colapsar/expandir panel */}
        <button
          onClick={() => setPanelColapsado((v) => !v)}
          className="self-center z-10 w-5 h-14 bg-slate-800 border border-slate-600 flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors shadow-md shrink-0"
          title={panelColapsado ? "Expandir panel" : "Colapsar panel"}
        >
          <span className="text-[10px]">{panelColapsado ? "◀" : "▶"}</span>
        </button>

        {/* Panel lateral */}
        <aside
          className={`${panelColapsado ? "w-0 overflow-hidden" : "w-80"} transition-all duration-300 flex flex-col gap-3 p-3 bg-slate-950 shrink-0 overflow-y-auto`}
        >
          {/* Botón Registrar */}
          <button
            type="button"
            onClick={() => onRegistrar?.()}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-tasf-green w-full py-2.5 text-sm font-semibold text-white shadow-md hover:bg-green-600 transition"
          >
            <PlusCircle size={16} /> Registrar Pedido
          </button>

          {/* Estado del flujo */}
          <div className="rounded-2xl bg-slate-900 border border-slate-700 p-4 text-white flex flex-col flex-1 min-h-0">
            <div className="flex items-center justify-between gap-2 mb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400 font-semibold">
                  Estado del flujo
                </p>
                <h3 className="text-xl font-bold text-white mt-1">
                  {totalPedidos} registros
                </h3>
              </div>
              <span className="rounded-full bg-slate-800 px-2 py-1 text-[10px] font-semibold text-slate-300">
                {isProcessingWindow ? "Sincronizando" : "En vivo"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 mb-3">
              {[
                {
                  label: "Procesando",
                  value: pedidosConEstado.procesando.length,
                },
                { label: "Asignados", value: pedidosConEstado.asignado.length },
                {
                  label: "En vuelo",
                  value: pedidosConEstado["en-vuelo"].length,
                },
                {
                  label: "Completados",
                  value: pedidosConEstado.completado.length,
                },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-xl border border-slate-700 bg-slate-950 p-2.5"
                >
                  <p className="text-[10px] uppercase tracking-widest text-slate-400">
                    {item.label}
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">
                    {item.value}
                  </p>
                </div>
              ))}
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
              {Object.entries(pedidosConEstado).map(([estado, pedidos]) => (
                <div
                  key={estado}
                  className="rounded-xl bg-slate-950 border border-slate-700 p-2.5"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-[10px] uppercase tracking-widest text-slate-400 font-semibold">
                      {estado === "en-vuelo"
                        ? "En vuelo"
                        : estado === "procesando"
                          ? "Procesando"
                          : estado === "pendiente"
                            ? "Pendientes"
                            : estado === "asignado"
                              ? "Asignados"
                              : estado === "completado"
                                ? "Completados"
                                : estado}
                    </p>
                    <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[9px] font-semibold text-slate-300">
                      {pedidos.length}
                    </span>
                  </div>
                  {pedidos.length === 0 ? (
                    <p className="text-xs text-slate-600">Sin envíos</p>
                  ) : (
                    <div className="space-y-1.5">
                      {[...pedidos].reverse().map((pedido) => {
                        const ruta =
                          resultadoBackend?.rutasPlanificadas?.[
                            pedido.idPedido
                          ];
                        const paradas = ruta
                          ? [ruta[0].origen, ...ruta.map((v) => v.destino)]
                          : [pedido.origen, pedido.destino];
                        const esDirecto = paradas.length === 2;
                        const replanificado =
                          !!(
                            resultadoBackend?.pedidosReplanificados as any
                          )?.has?.(pedido.idPedido) ||
                          !!(
                            resultadoBackend?.pedidosReplanificados as any
                          )?.includes?.(pedido.idPedido);
                        const seleccionado =
                          rutaEnvioSeleccionada === pedido.idPedido;
                        return (
                          <div
                            key={pedido.idPedido}
                            onClick={() =>
                              setRutaEnvioSeleccionada((prev) =>
                                prev === pedido.idPedido
                                  ? null
                                  : pedido.idPedido,
                              )
                            }
                            className={`rounded-lg border px-2.5 py-2 cursor-pointer transition-colors
                              ${
                                seleccionado
                                  ? "bg-cyan-900/30 border-cyan-500/40"
                                  : replanificado
                                    ? "bg-orange-950/40 border-orange-500/30"
                                    : "bg-slate-900 border-slate-700 hover:bg-slate-800"
                              }`}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-mono text-[10px] text-slate-500 truncate">
                                {pedido.idPedido}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                {replanificado && (
                                  <span className="text-orange-400 font-bold text-[9px] bg-orange-400/10 px-1 py-0.5 rounded">
                                    ↺ Replanificado
                                  </span>
                                )}
                                <span className="text-[10px] font-semibold text-slate-300">
                                  {pedido.cantidadMaletas} mal.
                                </span>
                              </div>
                            </div>
                            <p className="text-xs font-semibold text-white mt-0.5">
                              {paradas.join(" → ")}
                            </p>
                            <p className="text-[10px] mt-0.5 text-slate-500">
                              {esDirecto
                                ? "✈ Directo"
                                : `✈ ${paradas.length - 2} escala${paradas.length - 2 > 1 ? "s" : ""}`}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
