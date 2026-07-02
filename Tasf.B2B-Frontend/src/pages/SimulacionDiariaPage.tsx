import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, PlusCircle } from "lucide-react";
import MapArea from "../components/MapArea";
import {
  registrarPedidoManual,
  simularVentanaDiaria,
} from "../services/simulacionService";
import type { PedidoManualDTO, Solucion } from "../types";

interface PedidoLocal extends PedidoManualDTO {
  idPedido: string;
  fechaRegistro: string;
}

const obtenerIsoLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(
    date.getSeconds(),
  )}`;
};

const obtenerIsoFechaLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
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

const clasificarTramo = (
  horaSalida: string,
  horaLlegada: string,
  minutosHoy: number,
) => {
  const salida = parseHoraAMinutos(horaSalida);
  let llegada = parseHoraAMinutos(horaLlegada);
  if (llegada <= salida) llegada += 1440;
  if (minutosHoy < salida) return "pendiente";
  if (minutosHoy >= llegada) return "completado";
  return "vuelo";
};

export default function SimulacionDiariaPage({
  modoOscuro = true,
  onRegistrar,
}: {
  modoOscuro?: boolean;
  onRegistrar?: () => void;
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

  // 1. INICIALIZACIÓN Y PERSISTENCIA DE PEDIDOS CON LOCALSTORAGE
  const [pedidosManuales, setPedidosManuales] = useState<PedidoLocal[]>(() => {
    const saved = localStorage.getItem("tasf_pedidos_manuales");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PedidoLocal[];
        // Limpieza de seguridad: borrar pedidos con más de 12 horas reales
        const doceHorasMs = 12 * 60 * 60 * 1000;
        const ahora = new Date().getTime();
        return parsed.filter(
          (p) => ahora - new Date(p.fechaRegistro).getTime() < doceHorasMs,
        );
      } catch (e) {
        return [];
      }
    }
    return [];
  });

  const ultimoBloqueSolicitado = useRef(-1);
  const windowSizeMinutes = 1;

  // 1. Regresar el cálculo de minutos al horario local de la laptop
  const minutosHoy = useMemo(
    () => fechaActual.getHours() * 60 + fechaActual.getMinutes(),
    [fechaActual],
  );

  // 2. Regresar la fecha al formato local de la laptop
  const fechaHoy = useMemo(
    () => obtenerIsoFechaLocal(fechaActual),
    [fechaActual],
  );

  // 3. Dentro de la función 'procesarVentana', vuelve a enviar la hora local limpia
  const procesarVentana = async (fechaHora: Date) => {
    setIsProcessingWindow(true);
    try {
      const timestampAEnviar = obtenerIsoLocal(fechaHora); // Envía los dígitos locales (ej: 23:06:00)
      const nuevaSolucion = await simularVentanaDiaria(
        `${obtenerIsoFechaLocal(fechaHora)}T00:00:00`,
        timestampAEnviar,
        windowSizeMinutes,
      );
      console.log("Respuesta cruda del Backend:", nuevaSolucion);
      setResultadoBackend(nuevaSolucion);
    } catch (error) {
      console.error("Error al traer nueva ventana:", error);
    } finally {
      setIsProcessingWindow(false);
    }
  };

  // REEMPLAZAR POR ESTE BLOQUE:
  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => {
      setFechaActual(new Date());

      // Sincroniza los pedidos del localStorage cada segundo de forma segura
      const saved = localStorage.getItem("tasf_pedidos_manuales");
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as PedidoLocal[];
          const doceHorasMs = 12 * 60 * 60 * 1000;
          const ahora = new Date().getTime();
          const filtrados = parsed.filter(
            (p) => ahora - new Date(p.fechaRegistro).getTime() < doceHorasMs,
          );
          setPedidosManuales(filtrados);
        } catch (e) {}
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [isPlaying]);

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

    const prefijosVuelos = new Set<string>();
    Object.values(rutasAsignadas)
      .flat()
      .forEach((ruta) => {
        const prefijo = `${ruta.origen}-${ruta.destino}-${ruta.horaSalida.slice(0, 5)}`;
        prefijosVuelos.add(prefijo);
      });

    const ocupacionVuelos = Object.fromEntries(
      Object.entries(resultadoBackend.ocupacionVuelos ?? {}).filter(([key]) =>
        Array.from(prefijosVuelos).some((prefijo) => key.startsWith(prefijo)),
      ),
    );

    const capacidadesVuelos = Object.fromEntries(
      Object.entries(resultadoBackend.capacidadesVuelos ?? {}).filter(([key]) =>
        Array.from(prefijosVuelos).some((prefijo) => key.startsWith(prefijo)),
      ),
    );

    const aeropuertosVisibles = new Set<string>();
    Object.values(rutasAsignadas)
      .flat()
      .forEach((ruta) => {
        aeropuertosVisibles.add(ruta.origen);
        aeropuertosVisibles.add(ruta.destino);
      });

    const ocupacionAeropuertos = Object.fromEntries(
      Object.entries(resultadoBackend.ocupacionAeropuertos ?? {}).filter(
        ([key]) => aeropuertosVisibles.has(key.split("_")[0]),
      ),
    );

    return {
      ...resultadoBackend,
      rutasAsignadas,
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
      // 1. Si existe en fechasTramos, significa que el algoritmo ya le planificó una ruta con éxito
      const tieneRutaPlanificada =
        !!solucionOperativa?.fechasTramos?.[pedido.idPedido];

      // 2. Si existe en rutasAsignadas, significa que el backend confirmó que está en el aire ahora mismo
      const rutasActivas =
        solucionOperativa?.rutasAsignadas?.[pedido.idPedido] ?? [];
      const tieneRutaActiva = rutasActivas.length > 0;

      let estado = "pendiente";

      if (tieneRutaActiva) {
        estado = "en-vuelo";
      } else if (tieneRutaPlanificada) {
        estado = "asignado"; // Esperando pacientemente su hora de salida en el almacén
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
    const saved = localStorage.getItem("tasf_pedidos_manuales");
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as PedidoLocal[];
        const doceHorasMs = 12 * 60 * 60 * 1000;
        const ahora = new Date().getTime();
        const filtrados = parsed.filter(
          (p) => ahora - new Date(p.fechaRegistro).getTime() < doceHorasMs,
        );
        setPedidosManuales(filtrados);
      } catch (e) {
        console.error(e);
      }
    }
  }, [resultadoBackend]); // Se sincronizará cada vez que llegue una nueva ventana del backend

  return (
    // 3. CAMBIO DE CLASES RAÍZ: Se reemplaza h-screen por h-full flex-1 para evitar el desbordamiento
    <div className="h-full flex-1 min-h-0 flex flex-col relative font-sans bg-slate-950">
      // 2. CORRECCIÓN Z-INDEX: absolute/relative con z-[1000] para sobreponerse
      al mapa
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 shadow-sm relative z-[1000]">
        <div className="flex items-center gap-3">
          <Calendar className="text-tasf-green" size={22} />
          <div>
            <h2 className="text-lg font-bold text-white">
              Operaciones Día a Día
            </h2>
            <p className="text-sm text-slate-400">
              Registro en vivo de envíos manuales y monitoreo logístico.
            </p>
          </div>
        </div>
      </div>
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
          />
        </section>

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
                      {[...pedidos].reverse().map((pedido) => (
                        <div
                          key={pedido.idPedido}
                          className="rounded-lg bg-slate-900 border border-slate-700 px-2.5 py-2"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <span className="font-mono text-[10px] text-slate-500 truncate">
                              {pedido.idPedido}
                            </span>
                            <span className="text-[10px] font-semibold text-slate-300 shrink-0">
                              {pedido.cantidadMaletas} mal.
                            </span>
                          </div>
                          <p className="text-xs font-semibold text-white mt-0.5">
                            {pedido.origen} → {pedido.destino}
                          </p>
                        </div>
                      ))}
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
