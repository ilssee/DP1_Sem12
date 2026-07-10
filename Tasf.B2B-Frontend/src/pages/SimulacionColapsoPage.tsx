import React, { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, Loader2, OctagonAlert } from "lucide-react";
import MapArea from "../components/MapArea";
import { iniciarSimulacionPeriodo, obtenerEstadoSimulacion, detenerSimulacion } from "../services/simulacionService";
import type { Solucion } from "../types";

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

const formatearFechaHoraLocal = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:00`;
};

// Horizonte largo para que el backend nunca termine solo — el frontend lo detiene al detectar colapso.
const HORIZONTE_DIAS_CONFIGURABLE = 365;

const calcularBloqueBackend = (dias: number) => {
  let K = 168;
  if (dias <= 3) K = 72;
  else if (dias <= 5) K = 120;
  const totalMinutosVirtuales = dias * 24 * 60;
  const totalPasos = Math.ceil(totalMinutosVirtuales / K);
  return { K, totalPasos };
};

const fusionarSolucion = (prev: Solucion | null, siguiente: Solucion | null): Solucion | null => {
  if (!siguiente) return prev;
  if (!prev) return siguiente;

  return {
    ...siguiente,
    rutasAsignadas: { ...(prev.rutasAsignadas ?? {}), ...(siguiente.rutasAsignadas ?? {}) },
    detallesEnvios: { ...(prev.detallesEnvios ?? {}), ...(siguiente.detallesEnvios ?? {}) },
    fechasTramos: { ...(prev.fechasTramos ?? {}), ...(siguiente.fechasTramos ?? {}) },
    ocupacionVuelos: Object.keys(siguiente.ocupacionVuelos ?? {}).length > 0
      ? siguiente.ocupacionVuelos
      : (prev.ocupacionVuelos ?? {}),
    ocupacionAeropuertos: Object.keys(siguiente.ocupacionAeropuertos ?? {}).length > 0
      ? siguiente.ocupacionAeropuertos
      : (prev.ocupacionAeropuertos ?? {}),
    capacidadesVuelos: Object.keys(siguiente.capacidadesVuelos ?? {}).length > 0
      ? siguiente.capacidadesVuelos
      : (prev.capacidadesVuelos ?? {}),
    capacidadesAeropuertos: Object.keys(siguiente.capacidadesAeropuertos ?? {}).length > 0
      ? siguiente.capacidadesAeropuertos
      : (prev.capacidadesAeropuertos ?? {}),
    horasLlegada: { ...(prev.horasLlegada ?? {}), ...(siguiente.horasLlegada ?? {}) },
    rutasPlanificadas: { ...(prev.rutasPlanificadas ?? {}), ...(siguiente.rutasPlanificadas ?? {}) },
    totalPedidos: siguiente.totalPedidos ?? prev.totalPedidos ?? 0,
    tasaExito: siguiente.tasaExito ?? prev.tasaExito ?? 0,
    tiempoPromedioIntra: siguiente.tiempoPromedioIntra ?? prev.tiempoPromedioIntra ?? 0,
    tiempoPromedioInter: siguiente.tiempoPromedioInter ?? prev.tiempoPromedioInter ?? 0,
    fitness: siguiente.fitness ?? prev.fitness ?? 0,
  };
};

const detectarColapsoLogistico = (solucion: Solucion | null) => {
  if (!solucion) return { colapsado: false, motivo: "" };

  for (const [codigo, ocupacion] of Object.entries(solucion.ocupacionAeropuertos ?? {})) {
    const capacidad = solucion.capacidadesAeropuertos?.[codigo];
    if (capacidad && ocupacion > capacidad) {
      return { colapsado: true, motivo: `Capacidad superada en ${codigo}` };
    }
  }

  for (const [ruta, ocupacion] of Object.entries(solucion.ocupacionVuelos ?? {})) {
    const capacidad = solucion.capacidadesVuelos?.[ruta];
    if (capacidad && ocupacion > capacidad) {
      return { colapsado: true, motivo: `Capacidad superada en vuelo ${ruta}` };
    }
  }

  if (typeof solucion.tasaExito === "number" && solucion.tasaExito < 5) {
    return { colapsado: true, motivo: `La tasa de éxito cayó a ${solucion.tasaExito.toFixed(1)}% (umbral: 5%)` };
  }

  return { colapsado: false, motivo: "" };
};

export default function SimulacionColapsoPage({ modoOscuro = true }: { modoOscuro?: boolean }) {
  const [fechaInicio, setFechaInicio] = useState("2026-01-05");
  const [horaInicio, setHoraInicio] = useState("00:00");
  const diasHorizon = HORIZONTE_DIAS_CONFIGURABLE;
  const [resultado, setResultado] = useState<Solucion | null>(null);
  const [simulando, setSimulando] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [mensaje, setMensaje] = useState("");
  const [colapsoDetectado, setColapsoDetectado] = useState(false);
  const [motivoColapso, setMotivoColapso] = useState("");
  const [momentoColapso, setMomentoColapso] = useState<string | null>(null);
  const [minutosVirtualesTotales, setMinutosVirtualesTotales] = useState(0);
  const [horaVirtualMinutos, setHoraVirtualMinutos] = useState(0);
  const intervalRef = useRef<number | null>(null);
  const relojRef = useRef<number | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const inicioRealRef = useRef<number | null>(null);
  const minutosBaseRef = useRef<number>(0);

  const bloqueBackend = useMemo(() => calcularBloqueBackend(diasHorizon), [diasHorizon]);

  useEffect(() => {
    return () => {
      if (intervalRef.current !== null) window.clearInterval(intervalRef.current);
      if (relojRef.current !== null) window.clearInterval(relojRef.current);
    };
  }, []);

  const handleSimular = async () => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    setResultado(null);
    setSimulando(true);
    setProgreso(0);
    setColapsoDetectado(false);
    setMotivoColapso("");
    setMomentoColapso(null);
    setMinutosVirtualesTotales(0);
    setHoraVirtualMinutos(0);
    setMensaje("Iniciando simulación por bloques del backend...");

    const fechaInicioSimDate = new Date(`${fechaInicio}T${horaInicio}:00`);
    const fechaInicioSim = formatearFechaHoraLocal(fechaInicioSimDate);

    const finalizar = () => {
      if (intervalRef.current !== null) { window.clearInterval(intervalRef.current); intervalRef.current = null; }
      if (relojRef.current !== null) { window.clearInterval(relojRef.current); relojRef.current = null; }
      setSimulando(false);
    };

    try {
      const { jobId } = await iniciarSimulacionPeriodo(fechaInicioSim, diasHorizon);
      jobIdRef.current = jobId;
      let acumulado: Solucion | null = null;
      let completado = false;
      const totalMinutosVirtuales = diasHorizon * 24 * 60;

      const consultarEstado = async () => {
        if (completado) return;

        const estadoJob: any = await obtenerEstadoSimulacion(jobId);
        const progresoActual = Math.round(Math.min(100, estadoJob.progreso ?? 0));
        setProgreso(progresoActual);

        // Calcular minutos virtuales desde la ventana del backend (más preciso que usar progreso%)
        let minutosSimulados = Math.round((progresoActual / 100) * totalMinutosVirtuales);
        if (estadoJob.ventanaVirtual) {
          // formato: "2026-01-05 02:48 → 2026-01-07 20:00"
          const partes = estadoJob.ventanaVirtual.split(" → ");
          if (partes.length === 2) {
            const [fechaFin, horaFin] = partes[1].trim().split(" ");
            if (fechaFin && horaFin) {
              const [fy, fm, fd] = fechaInicio.split("-").map(Number);
              const [vy, vm, vd] = fechaFin.split("-").map(Number);
              const [hh, mm] = horaFin.split(":").map(Number);
              const inicioDate = new Date(fy, fm - 1, fd);
              const finDate = new Date(vy, vm - 1, vd);
              const diasOffset = Math.floor((finDate.getTime() - inicioDate.getTime()) / 86400000);
              minutosSimulados = diasOffset * 1440 + hh * 60 + mm;
            }
          }
        }
        minutosBaseRef.current = minutosSimulados;
        setMinutosVirtualesTotales(minutosSimulados);
        setHoraVirtualMinutos(minutosSimulados % 1440);

        if (estadoJob.solucionParcial) {
          acumulado = fusionarSolucion(acumulado, estadoJob.solucionParcial);
          setResultado(acumulado);

          const deteccion = detectarColapsoLogistico(acumulado);
          if (deteccion.colapsado) {
            completado = true;
            setColapsoDetectado(true);
            setMotivoColapso(deteccion.motivo);
            const fechaColapsoReal = new Date(fechaInicioSimDate.getTime() + minutosSimulados * 60 * 1000);
            setMomentoColapso(`${formatearFecha(fechaColapsoReal)} ${formatearHora(fechaColapsoReal)}`);
            setMensaje(`Colapso detectado en ${formatearFecha(fechaColapsoReal)} ${formatearHora(fechaColapsoReal)}`);
            if (jobIdRef.current) detenerSimulacion(jobIdRef.current).catch(() => {});
            finalizar();
            return;
          }
        }

        if (estadoJob.ventanaVirtual) {
          setMensaje(`Bloque ${progresoActual}% • ${estadoJob.ventanaVirtual}`);
        } else {
          setMensaje(`Procesando avance ${progresoActual}% del horizonte de ${diasHorizon} días`);
        }

        if (estadoJob.estado === "COMPLETADO") {
          completado = true;
          setMensaje("Simulación completada sin colapso dentro del horizonte analizado.");
          finalizar();
          return;
        }

        if (estadoJob.estado === "ERROR") {
          completado = true;
          throw new Error(estadoJob.mensaje || "Error en la simulación del backend.");
        }
      };

      inicioRealRef.current = Date.now();
      minutosBaseRef.current = 0;

      // Reloj animado: mueve aviones suavemente entre polls (2 min virtuales por segundo real)
      relojRef.current = window.setInterval(() => {
        if (!inicioRealRef.current) return;
        const segsTranscurridos = (Date.now() - inicioRealRef.current) / 1000;
        const min = minutosBaseRef.current + segsTranscurridos * 2;
        setMinutosVirtualesTotales(min);
        setHoraVirtualMinutos(min % 1440);
      }, 250);

      await consultarEstado();
      intervalRef.current = window.setInterval(() => {
        void consultarEstado();
      }, 1500);

    } catch (error: any) {
      const msg = error?.response?.data?.message ?? error?.message ?? "No se pudo completar la simulación.";
      alert(`Error: ${msg}`);
      setMensaje("La simulación no pudo completarse.");
      finalizar();
    }
  };

  return (
    <div className="w-full h-full flex bg-slate-950 text-white">
      <aside className="w-80 bg-slate-900 border-r border-slate-800 p-6 flex flex-col gap-6">
        <div className="flex items-center gap-3">
          <OctagonAlert className="text-orange-400" size={22} />
          <div>
            <h2 className="text-lg font-bold">Simulación hasta colapso</h2>
            <p className="text-sm text-slate-400">Se simula hasta llegar al colapso logístico.</p>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm text-slate-300">Fecha y hora de inicio</label>
            <div className="flex gap-2">
              <input
                type="date"
                className="flex-1 bg-slate-800 text-white rounded px-3 py-2 outline-none"
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                disabled={simulando}
              />
              <input
                type="time"
                className="w-24 bg-slate-800 text-white rounded px-3 py-2 outline-none"
                value={horaInicio}
                onChange={(e) => setHoraInicio(e.target.value)}
                disabled={simulando}
              />
            </div>
          </div>

          {/*<div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-sm text-orange-200">
            El horizonte se fija internamente en {diasHorizon} días para esta simulación. Si se desea cambiarlo, basta con ajustar la constante en el código.
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-800/70 p-3 text-sm text-slate-300">
            Con este horizonte, el backend usa ventanas internas de {bloqueBackend.K} minutos ({bloqueBackend.totalPasos} pasos por simulación).
          </div>*/}

          <button
            onClick={handleSimular}
            disabled={simulando}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-3 rounded transition-colors flex justify-center items-center gap-2"
          >
            {simulando ? <><Loader2 className="animate-spin" size={18} /> Ejecutando...</> : "Iniciar hasta colapso"}
          </button>
        </div>

        <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 space-y-3">
          <p className="text-xs uppercase tracking-widest text-slate-400">Estado</p>
          <p className="text-sm text-slate-200">{mensaje || "Esperando inicio"}</p>
          {simulando && !colapsoDetectado && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Loader2 className="animate-spin" size={12} />
              <span>{Math.floor(minutosVirtualesTotales / 1440)} días simulados</span>
            </div>
          )}
          {colapsoDetectado && (
            <div className="space-y-1 text-sm text-orange-200">
              <p className="font-semibold">Colapso detectado</p>
              <p>{motivoColapso}</p>
              <p className="text-slate-400">Momento: {momentoColapso}</p>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 min-h-0 flex flex-col relative overflow-hidden">
        <div className="absolute top-4 left-4 z-[1000] rounded-2xl bg-slate-950/95 border border-slate-700 px-4 py-3 text-white shadow-lg">
          <p className="text-[10px] uppercase tracking-widest text-slate-400">Hora simulada</p>
          <p className="font-mono text-xl font-bold">{formatearFecha(new Date())}</p>
          <p className="text-[10px] text-slate-400 mt-1">{minutosVirtualesTotales > 0 ? `${minutosVirtualesTotales} minutos simulados` : "Esperando ejecución"}</p>
        </div>
        <MapArea
          solucion={resultado}
          progreso={progreso}
          modoOscuro={modoOscuro}
          horaVirtualMinutos={horaVirtualMinutos}
          minutosVirtualesTotales={minutosVirtualesTotales}
          fechaInicioSim={fechaInicio}
        />
      </main>
    </div>
  );
}
