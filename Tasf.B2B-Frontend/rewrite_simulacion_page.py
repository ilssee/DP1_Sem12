from pathlib import Path

new_content = '''import React, { useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause, Loader2, Calendar, PlusCircle } from "lucide-react";
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
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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
}: {
  modoOscuro?: boolean;
}) {
  const [fechaActual, setFechaActual] = useState<Date>(() => new Date());
  const [isPlaying, setIsPlaying] = useState(true);
  const [isProcessingWindow, setIsProcessingWindow] = useState(false);
  const [resultadoBackend, setResultadoBackend] = useState<Solucion | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formOrigen, setFormOrigen] = useState("SPIM");
  const [formDestino, setFormDestino] = useState("");
  const [formCantidad, setFormCantidad] = useState<number | "">("");
  const [formCliente, setFormCliente] = useState("0032535");
  const [formLoading, setFormLoading] = useState(false);
  const [pedidosManuales, setPedidosManuales] = useState<PedidoLocal[]>([]);

  const ultimoBloqueSolicitado = useRef(-1);
  const windowSizeMinutes = 5;

  const minutosHoy = useMemo(
    () => fechaActual.getHours() * 60 + fechaActual.getMinutes(),
    [fechaActual],
  );

  const fechaHoy = useMemo(() => obtenerIsoFechaLocal(fechaActual), [fechaActual]);

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

  useEffect(() => {
    if (!isPlaying) return;
    const interval = setInterval(() => setFechaActual(new Date()), 1000);
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
    Object.values(rutasAsignadas).flat().forEach((ruta) => {
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
    Object.values(rutasAsignadas).flat().forEach((ruta) => {
      aeropuertosVisibles.add(ruta.origen);
      aeropuertosVisibles.add(ruta.destino);
    });

    const ocupacionAeropuertos = Object.fromEntries(
      Object.entries(resultadoBackend.ocupacionAeropuertos ?? {}).filter(([key]) =>
        aeropuertosVisibles.has(key.split("_")[0]),
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
      const rutas = solucionOperativa?.rutasAsignadas?.[pedido.idPedido] ?? [];
      const tieneRuta = rutas.length > 0;
      let estado = "pendiente";

      if (!tieneRuta) {
        estado = isProcessingWindow ? "procesando" : "pendiente";
      } else {
        const tramos = rutas.map((ruta) =>
          clasificarTramo(ruta.horaSalida, ruta.horaLlegada, minutosHoy),
        );

        if (tramos.includes("vuelo")) {
          estado = "en-vuelo";
        } else if (tramos.every((valor) => valor === "completado")) {
          estado = "completado";
        } else {
          estado = "asignado";
        }
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
      alert("Los códigos de aeropuerto deben ser de exactamente 4 caracteres (Ej: SPIM)." );
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
        },
      ]);

      setShowForm(false);
      setFormDestino("");
      setFormCantidad("");
      setFormCliente(formCliente.trim());
      procesarVentana(new Date());
    } catch (error: any) {
      alert("Error al registrar pedido: " + (error?.message ?? "Error inesperado"));
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

  return (
    <div className="flex-1 flex flex-col h-full relative font-sans bg-slate-100">
      <div className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm z-20">
        <div className="flex items-center gap-3">
          <Calendar className="text-tasf-green" size={22} />
          <div>
            <h2 className="text-lg font-bold text-tasf-dark">Operaciones Día a Día</h2>
            <p className="text-sm text-slate-500">Registro en vivo de envíos manuales y monitoreo logístico.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-hidden">
        <div className="grid grid-cols-[1.5fr_0.9fr] gap-6 h-full">
          <section className="relative rounded-3xl overflow-hidden bg-slate-900 shadow-xl">
            <div className="absolute top-4 left-4 z-20 rounded-2xl bg-slate-950/90 border border-slate-700 px-4 py-3 text-white shadow-lg">
              <p className="text-[10px] uppercase tracking-widest text-slate-400 mb-1">Hora real</p>
              <p className="font-mono text-xl font-bold text-white">{formatearHora(fechaActual)}</p>
              <p className="text-[10px] text-slate-400 mt-1">{formatearFecha(fechaActual)} • {estadoActual}</p>
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

          <aside className="flex flex-col gap-6 h-full">
            <div className="rounded-3xl bg-white shadow-xl border border-slate-200 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">Registro de pedidos</p>
                  <h3 className="mt-3 text-2xl font-bold text-slate-900">{totalPedidos} pedidos</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowForm((value) => !value)}
                  className="inline-flex items-center gap-2 rounded-full bg-tasf-green px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-green-600 transition">
                  <PlusCircle size={16} /> Registrar
                </button>
              </div>

              {showForm && (
                <form onSubmit={handleSubmitManual} className="mt-5 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={formOrigen}
                      onChange={(e) => setFormOrigen(e.target.value.toUpperCase())}
                      placeholder="Origen"
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm uppercase outline-none focus:border-tasf-green"
                      maxLength={4}
                      required
                    />
                    <input
                      value={formDestino}
                      onChange={(e) => setFormDestino(e.target.value.toUpperCase())}
                      placeholder="Destino"
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm uppercase outline-none focus:border-tasf-green"
                      maxLength={4}
                      required
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="number"
                      value={formCantidad}
                      onChange={(e) => setFormCantidad(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="N° maletas"
                      min={1}
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-tasf-green"
                      required
                    />
                    <input
                      value={formCliente}
                      onChange={(e) => setFormCliente(e.target.value)}
                      placeholder="ID cliente"
                      className="w-full rounded-xl border border-slate-300 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-tasf-green"
                      required
                    />
                  </div>
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setShowForm(false)}
                      className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      disabled={formLoading}
                      className="flex-1 rounded-xl bg-tasf-dark px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 transition"
                    >
                      {formLoading ? "Guardando..." : "Enviar"}
                    </button>
                  </div>
                </form>
              )}

              {!showForm && (
                <div className="mt-5 rounded-3xl bg-slate-50 p-4 border border-slate-200">
                  <p className="text-sm font-semibold text-slate-900">Último pedido</p>
                  {pedidosManuales.length === 0 ? (
                    <p className="mt-3 text-sm text-slate-500">La tabla está limpia. Registra el primer pedido manual.</p>
                  ) : (
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <p><span className="font-semibold">Origen:</span> {pedidosManuales[pedidosManuales.length - 1].origen}</p>
                      <p><span className="font-semibold">Destino:</span> {pedidosManuales[pedidosManuales.length - 1].destino}</p>
                      <p><span className="font-semibold">Maletas:</span> {pedidosManuales[pedidosManuales.length - 1].cantidadMaletas}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="rounded-3xl bg-white shadow-xl border border-slate-200 p-5 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">Estado del flujo</p>
                  <h3 className="mt-3 text-2xl font-bold text-slate-900">{totalPedidos} registros</h3>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {isProcessingWindow ? "Sincronizando" : "En vivo"}
                </span>
              </div>

              <div className="mt-5 grid grid-cols-2 gap-3">
                {[
                  { label: "Procesando", value: pedidosConEstado.procesando.length },
                  { label: "Asignados", value: pedidosConEstado.asignado.length },
                  { label: "En vuelo", value: pedidosConEstado["en-vuelo"].length },
                  { label: "Completados", value: pedidosConEstado.completado.length },
                ].map((item) => (
                  <div key={item.label} className="rounded-3xl border border-slate-200 bg-slate-50 p-3">
                    <p className="text-[11px] uppercase tracking-[0.2em] text-slate-500">{item.label}</p>
                    <p className="mt-2 text-3xl font-bold text-slate-900">{item.value}</p>
                  </div>
                ))}
              </div>

              <div className="mt-5 overflow-y-auto max-h-[320px] space-y-3">
                {Object.entries(pedidosConEstado).map(([estado, pedidos]) => (
                  <div key={estado} className="rounded-3xl bg-slate-50 border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs uppercase tracking-[0.2em] text-slate-500 font-semibold">
                        {estado === "en-vuelo" ? "En vuelo" : estado === "procesando" ? "Procesando" : estado === "pendiente" ? "Pendientes" : estado === "asignado" ? "Asignados" : estado === "completado" ? "Completados" : estado}
                      </p>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">
                        {pedidos.length}
                      </span>
                    </div>
                    {pedidos.length === 0 ? (
                      <p className="mt-3 text-sm text-slate-500">Sin envíos</p>
                    ) : (
                      <div className="mt-3 space-y-2">
                        {pedidos.slice(-3).reverse().map((pedido) => (
                          <div key={pedido.idPedido} className="rounded-2xl bg-white border border-slate-200 p-3">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs text-slate-500 truncate">{pedido.idPedido}</span>
                              <span className="text-[11px] font-semibold text-slate-600">{pedido.cantidadMaletas} mal.</span>
                            </div>
                            <p className="mt-2 text-sm font-semibold text-slate-900">{pedido.origen} → {pedido.destino}</p>
                            <p className="mt-1 text-[11px] text-slate-500">Cliente {pedido.idCliente}</p>
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
    </div>
  );
}
'''

Path('src/pages/SimulacionDiariaPage.tsx').write_text(new_content, encoding='utf-8')
print('wrote', Path('src/pages/SimulacionDiariaPage.tsx').stat().st_size)
