import React, { useState, useEffect, useRef } from "react";
import { Play, Pause, Loader2, Calendar, PlusCircle } from "lucide-react";
import MapAreaDiario from "../components/MapAreaDiario";
import {
  simularVentanaDiaria,
  registrarPedidoManual,
} from "../services/simulacionService";
import type { Solucion } from "../types";

export default function SimulacionDiariaPage({ modoOscuro = true }: { modoOscuro?: boolean }) {
  // ── ESTADOS DE TIEMPO Y UI ──
  const [fecha, setFecha] = useState(
    () => new Date().toISOString().split("T")[0],
  );

  const [horaInicio, setHoraInicio] = useState(() => {
    const now = new Date();
    return `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}`;
  });

  // Inicializamos el reloj virtual calculando los minutos de la hora actual
  const [relojVirtual, setRelojVirtual] = useState(() => {
    const now = new Date();
    // Agregamos (now.getSeconds() / 60) para tener la fracción de minuto exacta
    return now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  });

  // Por defecto, la simulación arranca automáticamente al entrar a la página
  const [isPlaying, setIsPlaying] = useState(true);
  const [isProcessingWindow, setIsProcessingWindow] = useState(false);
  const [velocidad, setVelocidad] = useState(1); // 1x por defecto

  // ── ESTADOS DE DATOS ──
  const [resultadoGlobal, setResultadoGlobal] = useState<Solucion | null>(null);
  const windowSizeMinutes = 5; // Salto de consumo (Sc)

  // ── ESTADOS DEL FORMULARIO MANUAL ──
  const [showForm, setShowForm] = useState(false);
  const [formOrigen, setFormOrigen] = useState("SPIM");
  const [formDestino, setFormDestino] = useState("");
  const [formCantidad, setFormCantidad] = useState<number | "">("");
  const [formCliente, setFormCliente] = useState("0032535");
  const [formLoading, setFormLoading] = useState(false);

  // Cálculos de fecha y hora exacta
  const fechaBase = new Date(`${fecha}T00:00:00`);
  const fechaVirtualActual = new Date(
    fechaBase.getTime() + relojVirtual * 60 * 1000,
  );

  const fechaFormateada = fechaVirtualActual.toLocaleDateString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  const horasStr = fechaVirtualActual.getHours().toString().padStart(2, "0");
  const minutosStr = fechaVirtualActual
    .getMinutes()
    .toString()
    .padStart(2, "0");
  const segundosStr = fechaVirtualActual
    .getSeconds()
    .toString()
    .padStart(2, "0");

  // Formato ISO local para mandar al backend (Ej: 2026-06-01T08:05:00)
  const getIsoVirtualTime = () => {
    const y = fechaVirtualActual.getFullYear();
    const m = (fechaVirtualActual.getMonth() + 1).toString().padStart(2, "0");
    const d = fechaVirtualActual.getDate().toString().padStart(2, "0");
    return `${y}-${m}-${d}T${horasStr}:${minutosStr}:00`;
  };

  const getIsoStartTime = () => {
    return `${fecha}T${horaInicio.padStart(5, "0")}:00`;
  };

  // ── EL BUCLE DE LA SIMULACIÓN ──
  // Referencia para saber qué bloque ya pedimos y no repetir llamadas al backend
  const ultimoBloqueSolicitado = useRef(-1);

  // 1. RELOJ
  const lastTickRef = useRef<number>(Date.now());

  useEffect(() => {
    if (!isPlaying) return;

    // Sincronizamos el tiempo exacto al momento de darle Play o volver a la pestaña
    lastTickRef.current = Date.now();

    const interval = setInterval(() => {
      const now = Date.now();
      const deltaMs = now - lastTickRef.current; // Milisegundos reales transcurridos
      lastTickRef.current = now;

      setRelojVirtual((prev) => {
        // Convertimos los milisegundos reales a minutos virtuales exactos
        return prev + velocidad * (deltaMs / 60000);
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isPlaying, velocidad]);

  // ── CATCH-UP: Saltar al tiempo real al reanudar la simulación ──
  useEffect(() => {
    if (isPlaying) {
      const now = new Date();
      setRelojVirtual(
        now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60,
      );
    }
  }, [isPlaying]);

  // 2. EL OBSERVADOR DE VENTANAS (Llama al backend solo cuando cruzamos un límite de 5 min)
  useEffect(() => {
    if (!isPlaying) return;

    // Calculamos en qué bloque de 5 minutos estamos (Ej: minuto 12.4 -> bloque 2)
    const bloqueActual = Math.floor(relojVirtual / windowSizeMinutes);

    if (bloqueActual > ultimoBloqueSolicitado.current) {
      ultimoBloqueSolicitado.current = bloqueActual;

      const procesarVentana = async () => {
        setIsProcessingWindow(true);
        try {
          const timestampAEnviar = getIsoVirtualTime();
          const nuevaSolucion = await simularVentanaDiaria(
            getIsoStartTime(),
            timestampAEnviar,
            windowSizeMinutes,
          );

          console.log("=== DATOS DEL BACKEND ===");
          console.log("Ocupación Vuelos:", nuevaSolucion.ocupacionVuelos);
          console.log("Rutas Asignadas:", nuevaSolucion.rutasAsignadas);

          setResultadoGlobal((prev) => {
            if (!prev) return nuevaSolucion;

            // Limitamos el historial visual de rutas a 100 para no ahogar la RAM de React
            const rutasCombinadas = {
              ...prev.rutasAsignadas,
              ...nuevaSolucion.rutasAsignadas,
            };
            const rutasAcotadas = Object.fromEntries(
              Object.entries(rutasCombinadas).slice(-100),
            );

            return {
              ...prev,
              rutasAsignadas: rutasAcotadas, // <-- Tope de 100 rutas en memoria
              ocupacionVuelos: nuevaSolucion.ocupacionVuelos,
              ocupacionAeropuertos: nuevaSolucion.ocupacionAeropuertos,
              capacidadesVuelos: {
                ...prev.capacidadesVuelos,
                ...nuevaSolucion.capacidadesVuelos,
              },
              totalPedidos:
                nuevaSolucion.totalPedidos > 0
                  ? nuevaSolucion.totalPedidos
                  : prev.totalPedidos,
            };
          });
        } catch (error) {
          console.error("Error al traer nueva ventana:", error);
        } finally {
          setIsProcessingWindow(false);
        }
      };

      procesarVentana();
    }
  }, [relojVirtual, isPlaying]);

  // ── REGISTRO MANUAL DE PEDIDOS ──
  const handleSubmitManual = async (e: React.FormEvent) => {
    e.preventDefault();

    if (formOrigen.length !== 4 || formDestino.length !== 4) {
      alert(
        "Los códigos de aeropuerto deben ser de exactamente 4 caracteres (Ej: SPIM).",
      );
      return;
    }

    if (!formDestino || !formCantidad) return;
    setFormLoading(true);

    try {
      await registrarPedidoManual({
        origen: formOrigen,
        destino: formDestino,
        cantidadMaletas: Number(formCantidad),
        idCliente: formCliente,
        fechaHoraVirtual: getIsoVirtualTime(), // Se ancla a la hora en pantalla
      });
      alert(
        `Pedido hacia ${formDestino} registrado. Se procesará en el siguiente salto del reloj.`,
      );
      setShowForm(false);
      setFormDestino("");
      setFormCantidad("");
    } catch (error: any) {
      alert("Error al registrar pedido: " + error.message);
    } finally {
      setFormLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full relative font-sans">
      {/* BARRA SUPERIOR */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 flex justify-between shadow-sm z-20">
        <div className="flex items-center gap-3">
          <Calendar className="text-tasf-green" size={22} />
          <h2 className="text-lg font-bold text-tasf-dark">
            Monitoreo Día a Día
          </h2>
        </div>
      </div>

      {/* ÁREA CENTRAL */}
      <div className="flex-1 relative bg-slate-100">
        {/* Usamos el módulo (%) 1440 para que al pasar la medianoche, el mapa vuelva a empezar desde 0 */}
        <MapAreaDiario
          solucion={resultadoGlobal}
          horaVirtualMinutos={relojVirtual % 1440}
          modoOscuro={modoOscuro}
        />

        {/* BOTÓN REGISTRAR PEDIDO FLOTANTE */}
        <div className="absolute top-6 right-6 z-[1000]">
          <button
            onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 bg-tasf-green text-white px-4 py-2 rounded-lg font-bold shadow-lg hover:bg-green-600 transition"
          >
            <PlusCircle size={18} /> Registrar Pedido Manual
          </button>
        </div>

        {/* PANEL DE FORMULARIO MANUAL - Movido a la derecha */}
        {showForm && (
          <div className="absolute top-20 right-6 z-[1000] bg-white p-4 rounded-xl shadow-xl border border-slate-200 w-72">
            <h3 className="font-bold text-tasf-dark text-sm mb-3">
              Nuevo Envío
            </h3>
            <form onSubmit={handleSubmitManual} className="flex flex-col gap-2">
              <input
                value={formOrigen}
                onChange={(e) => setFormOrigen(e.target.value)}
                placeholder="Origen (Ej: LIM)"
                className="border border-slate-300 p-2 rounded text-sm uppercase"
                maxLength={4}
                required
              />
              <input
                value={formDestino}
                onChange={(e) => setFormDestino(e.target.value)}
                placeholder="Destino (Ej: MAD)"
                className="border border-slate-300 p-2 rounded text-sm uppercase"
                maxLength={4}
                required
              />
              <input
                type="number"
                value={formCantidad}
                onChange={(e) =>
                  setFormCantidad(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                placeholder="N° Maletas"
                className="border border-slate-300 p-2 rounded text-sm"
                min={1}
                required
              />
              <input
                value={formCliente}
                onChange={(e) => setFormCliente(e.target.value)}
                placeholder="ID Cliente"
                className="border border-slate-300 p-2 rounded text-sm"
                required
              />

              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 text-slate-500 text-sm font-semibold p-2"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={formLoading}
                  className="flex-1 bg-tasf-dark text-white rounded font-semibold text-sm p-2"
                >
                  {formLoading ? "Guardando..." : "Guardar"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* PANEL DE TELEMETRÍA EN TIEMPO REAL */}
        {resultadoGlobal && (
          <div className="absolute top-24 left-6 z-[900] w-64 flex flex-col gap-3">
            {/* Tarjeta: Estado de Aeropuertos */}
            <div className="bg-tasf-dark/90 backdrop-blur text-white p-4 rounded-xl shadow-lg border border-slate-700">
              <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-2">
                Almacenes Más Llenos
              </h3>
              <div className="space-y-2">
                {Object.entries(resultadoGlobal.ocupacionAeropuertos || {})
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 3)
                  .map(([aero, cant]) => (
                    <div
                      key={aero}
                      className="flex justify-between items-center text-xs"
                    >
                      <span className="font-mono">{aero.split("_")[0]}</span>
                      <span className="bg-slate-700 px-2 py-1 rounded text-tasf-amber font-bold">
                        {cant} maletas
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Tarjeta: Vuelos Críticos */}
            <div className="bg-tasf-dark/90 backdrop-blur text-white p-4 rounded-xl shadow-lg border border-slate-700">
              <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-2">
                Vuelos con Mayor Carga
              </h3>
              <div className="space-y-2">
                {Object.entries(resultadoGlobal.ocupacionVuelos || {})
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .slice(0, 5) // <-- CAMBIADO A 5
                  .map(([vuelo, cant]) => (
                    <div
                      key={vuelo}
                      className="flex justify-between items-center text-xs"
                    >
                      <span
                        className="font-mono truncate w-36"
                        title={vuelo.split("_")[0]}
                      >
                        {vuelo.split("_")[0]}
                      </span>
                      <span className="bg-tasf-green/20 text-tasf-green px-2 py-1 rounded font-bold">
                        {cant} un.
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* Tarjeta: Pedidos Procesados */}
            {/* <div className="bg-tasf-dark/90 backdrop-blur text-white p-4 rounded-xl shadow-lg border border-slate-700">
              <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-1">
                Volumen Procesado
              </h3>
              <div className="text-2xl font-bold text-white">
                {resultadoGlobal.totalPedidos.toLocaleString()}{" "}
                <span className="text-xs font-normal text-slate-400">
                  pedidos
                </span>
              </div>
            </div> */}

            {/* Tarjeta: Últimos Pedidos Asignados */}
            <div className="bg-tasf-dark/90 backdrop-blur text-white p-4 rounded-xl shadow-lg border border-slate-700">
              <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest mb-2">
                Rutas Asignadas (En Vivo)
              </h3>
              <div className="space-y-2 overflow-y-auto max-h-32 pr-1">
                {!resultadoGlobal.rutasAsignadas ||
                Object.keys(resultadoGlobal.rutasAsignadas).length === 0 ? (
                  <p className="text-xs text-slate-500 italic">
                    Esperando rutas...
                  </p>
                ) : (
                  // Tomamos los últimos 5 pedidos registrados para mostrarlos arriba
                  Object.keys(resultadoGlobal.rutasAsignadas)
                    .slice(-5)
                    .reverse()
                    .map((id) => (
                      <div
                        key={id}
                        className="flex justify-between items-center text-xs"
                      >
                        <span
                          className="font-mono text-slate-300 truncate w-24"
                          title={id}
                        >
                          {id}
                        </span>
                        <span className="bg-tasf-green/20 text-tasf-green px-2 py-1 rounded font-bold text-[10px]">
                          EN RUTA
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* REPRODUCTOR FLOTANTE INFERIOR */}
        <div className="absolute bottom-10 left-1/2 transform -translate-x-1/2 z-[1000] bg-white shadow-2xl border border-slate-200 rounded-2xl px-8 py-4 flex items-center gap-8">
          <div className="text-center">
            <div className="text-[10px] uppercase font-bold text-tasf-green tracking-widest">
              {fechaFormateada}
            </div>
            <div className="text-3xl font-mono font-bold text-tasf-dark">
              {horasStr}:{minutosStr}:{segundosStr}
            </div>
          </div>
          <div className="w-px h-12 bg-slate-200"></div>
          <div className="flex items-center gap-4">
            <button
              onClick={() => setIsPlaying(!isPlaying)}
              className={`p-4 rounded-full transition-transform shadow-md hover:scale-105 ${isPlaying ? "bg-tasf-amber text-white" : "bg-tasf-green text-white"}`}
            >
              {isPlaying ? (
                <Pause size={24} fill="currentColor" />
              ) : (
                <Play size={24} fill="currentColor" />
              )}
            </button>
            {isProcessingWindow && (
              <Loader2 size={20} className="text-slate-400 animate-spin" />
            )}
            <div className="w-px h-12 bg-slate-200 mx-4"></div>
            <div className="flex flex-col items-center min-w-[100px]">
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">
                Velocidad: {velocidad}x
              </span>
              <input
                type="range"
                min="1"
                max="60"
                value={velocidad}
                onChange={(e) => setVelocidad(Number(e.target.value))}
                className="w-full accent-tasf-green cursor-pointer"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
