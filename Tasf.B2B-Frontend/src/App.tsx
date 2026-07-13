import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  Plane,
  Loader2,
  Upload,
  Activity,
  FileText,
  Calendar,
  OctagonAlert,
} from "lucide-react";
import MapArea from "./components/MapArea";
import { aeropuertosDB, aeropuertoContinente } from "./data/coordenadas";
import {
  iniciarSimulacionPeriodo,
  obtenerEstadoSimulacion,
  cancelarVuelo,
  detenerSimulacion,
} from "./services/simulacionService";
import {
  cargarAeropuertos,
  cargarVuelos,
  cargarEnvios,
} from "./services/dataCargaService";
import type { Solucion, Vuelo } from "./types";
import SimulacionDiariaPage from "./pages/SimulacionDiariaPage";
import RegistroPedidoPage from "./pages/RegistroPedidoPage";

type Vista = "dia-a-dia" | "mapa" | "cargar" | "registro-pedido" | "colapso";

interface EstadoCarga {
  cargando: boolean;
  mensaje: string;
  error: boolean;
}

const estadoInicial: EstadoCarga = {
  cargando: false,
  mensaje: "",
  error: false,
};

const formatearDuracion = (ms: number): string => {
  const totalSegundos = Math.max(0, Math.floor(ms / 1000));
  const horas = Math.floor(totalSegundos / 3600);
  const minutos = Math.floor((totalSegundos % 3600) / 60);
  const segundos = totalSegundos % 60;
  return [horas, minutos, segundos]
    .map((n) => String(n).padStart(2, "0"))
    .join(":");
};

function parseHoraAMin(h: string) { const [hh, mm] = h.split(":").map(Number); return hh * 60 + mm; }

function minLlegadaDesdeInicio(fechaSalidaStr: string, horaSalida: string, horaLlegada: string, fechaInicioSim: string): number {
  const [fy, fm, fd] = fechaInicioSim.split("-").map(Number);
  const [vy, vm, vd] = fechaSalidaStr.split("-").map(Number);
  if (isNaN(fy) || isNaN(vy)) return Infinity;
  const dias = Math.floor((new Date(vy, vm-1, vd).getTime() - new Date(fy, fm-1, fd).getTime()) / 86400000);
  const minSalida = dias * 1440 + parseHoraAMin(horaSalida);
  let minLlegada = dias * 1440 + parseHoraAMin(horaLlegada);
  if (minLlegada <= minSalida) minLlegada += 1440;
  return minLlegada;
}

function clasificarVuelo(fechaSalidaStr: string, horaSalida: string, horaLlegada: string, fechaInicioSim: string, minutosActuales: number) {
  if (!fechaSalidaStr || !horaSalida || !fechaInicioSim) return 'espera';
  const [fy, fm, fd] = fechaInicioSim.split("-").map(Number);
  const [vy, vm, vd] = fechaSalidaStr.split("-").map(Number);
  if (isNaN(fy) || isNaN(vy)) return 'espera';
  const dias = Math.floor((new Date(vy, vm-1, vd).getTime() - new Date(fy, fm-1, fd).getTime()) / 86400000);
  const minSalida = dias * 1440 + parseHoraAMin(horaSalida);
  if (!horaLlegada) return minutosActuales < minSalida ? 'espera' : 'vuelo';
  let minLlegada = dias * 1440 + parseHoraAMin(horaLlegada);
  if (minLlegada <= minSalida) minLlegada += 1440;
  if (minutosActuales < minSalida) return 'espera';
  if (minutosActuales < minLlegada) return 'vuelo';
  return 'completado';
}

function WidgetTiempos({ horaRealActual, tiempoTranscurrido, tiempoSimuladoTranscurrido, minutosVirtualesTotales, horaInicio }: {
  horaRealActual: string; tiempoTranscurrido: string; tiempoSimuladoTranscurrido: string; minutosVirtualesTotales: number; horaInicio: string;
}) {
  const [abierto, setAbierto] = React.useState(true);
  return (
    <div className="absolute top-3 left-12 z-[1000] w-80 rounded-2xl shadow-2xl bg-slate-900 border border-slate-700 overflow-hidden">
      {/* MOMENTO PRESENTE */}
      <button onClick={() => setAbierto(v => !v)} className="w-full px-4 pt-3 pb-2 flex items-center justify-between hover:bg-slate-800 transition-colors">
        <p className="text-[10px] font-bold text-slate-300 uppercase tracking-widest flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-400" /> MOMENTO PRESENTE
        </p>
        <span className="text-slate-500 text-xs">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && <>
        <div className="px-4 pb-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 flex items-center gap-1 mb-1">📅 Fecha y hora real</p>
              <p className="text-sm font-bold text-white font-mono leading-tight">{horaRealActual ? horaRealActual.split(" ")[0] : "—"}</p>
              <p className="text-sm text-slate-300 font-mono leading-tight">{horaRealActual ? horaRealActual.split(" ")[1] : ""}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 flex items-center gap-1 mb-1">⏱ Tiempo transcurrido</p>
              <p className="text-xl font-bold text-white font-mono leading-tight">{tiempoTranscurrido || "—"}</p>
              <p className="text-[9px] text-slate-500 mt-0.5">minutos desde inicio</p>
            </div>
          </div>
        </div>
        {/* MOMENTO SIMULADO */}
        <div className="border-t border-slate-700 px-4 pt-3 pb-4">
          <p className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-1.5 mb-2">
            <span className="w-2 h-2 rounded-full bg-emerald-400" /> MOMENTO SIMULADO
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-800 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 flex items-center gap-1 mb-1">📅 Fecha y hora simulada</p>
              <p className="text-sm font-bold text-emerald-300 font-mono leading-tight">{tiempoSimuladoTranscurrido ? tiempoSimuladoTranscurrido.split(" ")[0] : "—"}</p>
              <p className="text-sm text-emerald-300 font-mono leading-tight">{tiempoSimuladoTranscurrido ? tiempoSimuladoTranscurrido.split(" ")[1] : ""}</p>
            </div>
            <div className="bg-slate-800 rounded-xl p-3">
              <p className="text-[9px] text-slate-400 flex items-center gap-1 mb-1">⏱ Tiempo simulado transcurrido</p>
              {(() => {
                const [hh, mm] = horaInicio.split(":").map(Number);
                const offset = ((hh || 0) * 60 + (mm || 0));
                const elapsed = Math.max(0, minutosVirtualesTotales - offset);
                if (!elapsed && !minutosVirtualesTotales) return <p className="text-xl font-bold text-emerald-300 font-mono leading-tight">—</p>;
                const d = Math.floor(elapsed / 1440);
                const h = Math.floor((elapsed % 1440) / 60);
                return <p className="text-xl font-bold text-emerald-300 font-mono leading-tight">{d}d {String(h).padStart(2,"0")}h</p>;
              })()}
              <p className="text-[9px] text-slate-500 mt-0.5">desde inicio simulado</p>
            </div>
          </div>
        </div>
      </>}
    </div>
  );
}

function AeroSelect({ value, onChange, opciones, placeholder }: {
  value: string; onChange: (v: string) => void; opciones: string[]; placeholder: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setAbierto(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtradas = opciones.filter(cod =>
    cod.toLowerCase().includes(busqueda.toLowerCase()) ||
    (aeropuertosDB[cod]?.nombre ?? '').toLowerCase().includes(busqueda.toLowerCase())
  );

  const nombre = value ? aeropuertosDB[value]?.nombre : null;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => { setAbierto(v => !v); setBusqueda(''); }}
        className={`w-full text-left bg-slate-700 hover:bg-slate-600 rounded px-2 py-1.5 text-[11px] flex items-center justify-between gap-1 transition-colors ${abierto ? 'ring-1 ring-tasf-green' : ''}`}
      >
        <span className="truncate">
          {value ? (
            <><span className="font-bold text-white">{value}</span>
            {nombre && <span className="text-slate-400 ml-1">{nombre}</span>}</>
          ) : <span className="text-slate-500">{placeholder}</span>}
        </span>
        <span className="text-slate-400 shrink-0">{abierto ? '▲' : '▼'}</span>
      </button>
      {abierto && (
        <div className="absolute top-full left-0 right-0 z-50 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-xl overflow-hidden">
          <div className="p-1.5 border-b border-slate-700">
            <input
              autoFocus
              value={busqueda}
              onChange={e => setBusqueda(e.target.value)}
              placeholder="Buscar..."
              className="w-full bg-slate-700 text-white text-[11px] rounded px-2 py-1 outline-none placeholder-slate-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            <button
              onClick={() => { onChange(''); setAbierto(false); }}
              className={`w-full text-left px-3 py-2 text-[11px] hover:bg-slate-700 transition-colors ${!value ? 'bg-tasf-green/10 text-tasf-green' : 'text-slate-400'}`}
            >
              Todos
            </button>
            {filtradas.map(cod => (
              <button
                key={cod}
                onClick={() => { onChange(cod); setAbierto(false); }}
                className={`w-full text-left px-3 py-2 text-[11px] hover:bg-slate-700 transition-colors flex items-center gap-2 ${value === cod ? 'bg-tasf-green/10' : ''}`}
              >
                <span className={`font-bold font-mono w-10 shrink-0 ${value === cod ? 'text-tasf-green' : 'text-white'}`}>{cod}</span>
                <span className="text-slate-400 truncate">{aeropuertosDB[cod]?.nombre ?? ''}</span>
              </button>
            ))}
            {filtradas.length === 0 && <p className="text-slate-500 text-[11px] px-3 py-2 italic">Sin resultados</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function DrawerVuelos({ resultado, minutosVirtualesTotales, fechaInicio, onSeleccionar, onCerrar, vueloExpandir, onFiltrados, vuelosCancelados, onCancelarVuelo }: {
  resultado: any; minutosVirtualesTotales: number; fechaInicio: string;
  onSeleccionar: (key: string) => void; onCerrar: () => void;
  vueloExpandir?: string | null;
  onFiltrados?: (keys: string[] | null) => void;
  vuelosCancelados?: Set<string>;
  onCancelarVuelo?: (claveVuelo: string) => void;
}) {
  const [orden, setOrden] = useState<{ col: 'cant'|'cap'|'pct'|'envios'|'minSalida'|'minLlegada'|'origen'|'destino'; dir: 1|-1 }>({ col: 'minSalida', dir: 1 });
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [filtroSemaforoV, setFiltroSemaforoV] = useState<''|'verde'|'amarillo'|'rojo'|'vacio'>('');
  const filaRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!vueloExpandir) return;
    setExpandido(vueloExpandir);
    setFiltroOrigen('');
    setFiltroDestino('');
    setTimeout(() => {
      const row = filaRefs.current.get(vueloExpandir);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [vueloExpandir]);

  const normH = (t: string) => { const p = (t??"").split(":"); return `${p[0].padStart(2,"0")}:${(p[1]??"00").padStart(2,"0")}:${(p[2]??"00").padStart(2,"0")}`; };

  const vuelosActivos = useMemo(() => {
    if (!resultado) return [];
    // Contar envíos por vuelo
    const enviosPorVuelo = new Map<string, number>();
    Object.entries(resultado.rutasAsignadas ?? {}).forEach(([, tramos]: any) => {
      tramos.forEach((v: any) => {
        const k = `${v.origen}-${v.destino}-${normH(v.horaSalida??"")}`;
        enviosPorVuelo.set(k, (enviosPorVuelo.get(k) ?? 0) + 1);
      });
    });

    const horasLlegadaMap = resultado.horasLlegada ?? {};

    return Object.entries(resultado.ocupacionVuelos ?? {})
      .map(([key, cant]) => {
        const idx = key.lastIndexOf("_");
        if (idx < 0) return null;
        const sinFecha = key.substring(0, idx);
        const fecha = key.substring(idx + 1);
        const partes = sinFecha.split("-");
        if (partes.length < 3 || !fecha) return null;
        const origen = partes[0], destino = partes[1], horaSalida = normH(partes.slice(2).join(":"));
        // Buscar horaLlegada desde el mapa dedicado (clave sin fecha)
        const claveRuta = `${origen}-${destino}-${horaSalida}`;
        let horaLlegada = normH(horasLlegadaMap[claveRuta] ?? horasLlegadaMap[sinFecha] ?? "");
        // Fallback: buscar horaLlegada directamente en las rutas asignadas
        if (!horaLlegada || horaLlegada === "00:00:00") {
          for (const ruta of Object.values(resultado.rutasAsignadas ?? {}) as any[][]) {
            const v = ruta.find((r: any) => r.origen === origen && r.destino === destino && normH(r.horaSalida ?? "") === horaSalida);
            if (v?.horaLlegada) { horaLlegada = normH(v.horaLlegada); break; }
          }
        }
        if (!horaLlegada || horaLlegada === "00:00:00") return null; // vuelo sin datos de llegada
        const [fy, fm, fd] = fechaInicio.split("-").map(Number);
        const [vy, vm, vd] = fecha.split("-").map(Number);
        const dias = Math.floor((new Date(vy,vm-1,vd).getTime() - new Date(fy,fm-1,fd).getTime()) / 86400000);
        const minSalida = dias * 1440 + parseHoraAMin(horaSalida);
        let minLlegada = dias * 1440 + parseHoraAMin(horaLlegada);
        if (minLlegada <= minSalida) minLlegada += 1440;
        if (minutosVirtualesTotales < minSalida || minutosVirtualesTotales >= minLlegada) return null;
        const envios = enviosPorVuelo.get(`${origen}-${destino}-${horaSalida}`) ?? 0;
        const cap = (resultado.capacidadesVuelos ?? {})[claveRuta] ?? 350;
        const pct = cap > 0 ? Math.round(((cant as number) / cap) * 100) : 0;
        return { key, origen, destino, horaSalida, horaLlegada, fecha, cant: cant as number, envios, minSalida, minLlegada, pct, cap };
      })
      .filter(Boolean) as any[];
  }, [resultado, minutosVirtualesTotales, fechaInicio]);

  const ordenado = useMemo(() => {
    const fo = filtroOrigen.trim().toUpperCase();
    const fd = filtroDestino.trim().toUpperCase();
    return [...vuelosActivos]
      .filter(v => {
        if (filtroSemaforoV !== 'vacio' && v.cant === 0) return false; // ocultar vacíos salvo que se filtren explícitamente
        if (fo && !v.origen.toUpperCase().includes(fo)) return false;
        if (fd && !v.destino.toUpperCase().includes(fd)) return false;
        if (filtroSemaforoV === 'vacio' && v.cant !== 0) return false;
        if (filtroSemaforoV === 'verde' && !(v.cant > 0 && v.pct < 50)) return false;
        if (filtroSemaforoV === 'amarillo' && !(v.pct >= 50 && v.pct < 80)) return false;
        if (filtroSemaforoV === 'rojo' && v.pct < 80) return false;
        return true;
      })
      .sort((a, b) => {
        if (orden.col === 'origen' || orden.col === 'destino')
          return a[orden.col].localeCompare(b[orden.col]) * orden.dir;
        return ((a[orden.col] ?? 0) - (b[orden.col] ?? 0)) * orden.dir;
      });
  }, [vuelosActivos, orden, filtroOrigen, filtroDestino, filtroSemaforoV]);

  const hayFiltroActivoV = !!(filtroOrigen || filtroDestino || filtroSemaforoV);
  useEffect(() => {
    if (!onFiltrados) return;
    onFiltrados(hayFiltroActivoV ? ordenado.map(v => v.key) : null);
  }, [ordenado, hayFiltroActivoV]);

  const [expandido, setExpandido] = useState<string | null>(null);

  const enviosPorVueloKey = useMemo(() => {
    const map: Record<string, any[]> = {};
    if (!resultado) return map;
    const detalles = resultado.detallesEnvios ?? {};
    const fechasTramos = resultado.fechasTramos ?? {};
    Object.entries(resultado.rutasAsignadas ?? {}).forEach(([id, tramos]: any) => {
      const fechas: string[] = fechasTramos[id] ?? [];
      tramos.forEach((v: any, i: number) => {
        const fecha = fechas[i];
        const k = `${v.origen}-${v.destino}-${normH(v.horaSalida??'')}`;
        const key = fecha ? `${k}_${fecha}` : k;
        if (!map[key]) map[key] = [];
        map[key].push({ id, ...detalles[id] });
      });
    });
    return map;
  }, [resultado]);

  const thClass = (col: typeof orden.col) =>
    `px-2 py-2 text-left cursor-pointer select-none hover:text-white transition-colors ${orden.col === col ? 'text-tasf-green' : 'text-slate-400'}`;
  const indicator = (col: typeof orden.col) => orden.col === col ? (orden.dir === 1 ? ' ↑' : ' ↓') : ' ↕';
  const toggleOrden = (col: typeof orden.col) =>
    setOrden(o => o.col === col ? { col, dir: o.dir === 1 ? -1 : 1 } : { col, dir: 1 });

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
        <h3 className="text-white font-bold text-sm">✈ En el aire ahora ({ordenado.length}{ordenado.length !== vuelosActivos.length ? `/${vuelosActivos.length}` : ''})</h3>
        <div className="flex items-center gap-2">
          {/* Semáforo vuelos */}
          {(['vacio','verde','amarillo','rojo'] as const).map(s => (
            <button key={s} onClick={() => setFiltroSemaforoV(f => f === s ? '' : s)}
              title={s === 'vacio' ? 'Sin maletas' : s.charAt(0).toUpperCase() + s.slice(1)}
              className={`w-4 h-4 rounded-full border-2 transition-all ${filtroSemaforoV === s ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'} ${s === 'vacio' ? 'bg-slate-500' : s === 'verde' ? 'bg-green-500' : s === 'amarillo' ? 'bg-yellow-400' : 'bg-red-500'}`} />
          ))}
          <div className="w-px h-4 bg-slate-600" />
          <button onClick={() => setFiltrosAbiertos(v => !v)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${filtrosAbiertos || filtroOrigen || filtroDestino ? 'border-tasf-green bg-tasf-green/20 text-tasf-green' : 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-400'}`}>
            ⚙ {filtrosAbiertos ? '▲' : '▼'}{(filtroOrigen || filtroDestino) ? ' •' : ''}
          </button>
          <button onClick={onCerrar} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>
      </div>
      {/* Panel de filtros desplegable */}
      {filtrosAbiertos && <div className="border-b border-slate-700 bg-slate-900">
        <div className="flex gap-2 px-4 py-2">
          <div className="flex-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-wider block mb-1">Origen</label>
            <AeroSelect
              value={filtroOrigen}
              onChange={setFiltroOrigen}
              opciones={[...new Set(vuelosActivos.map((v: any) => v.origen))].sort() as string[]}
              placeholder="Todos los orígenes"
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-wider block mb-1">Destino</label>
            <AeroSelect
              value={filtroDestino}
              onChange={setFiltroDestino}
              opciones={[...new Set(vuelosActivos.map((v: any) => v.destino))].sort() as string[]}
              placeholder="Todos los destinos"
            />
          </div>
          {(filtroOrigen || filtroDestino) && (
            <button onClick={() => { setFiltroOrigen(''); setFiltroDestino(''); }}
              className="self-end text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors mb-0.5">
              ✕
            </button>
          )}
        </div>
      </div>}
      <div className="px-3 py-1 border-b border-slate-700 shrink-0">
        <p className="text-[9px] text-slate-500 italic">👆 Haz clic en una fila para ver los envíos consolidados</p>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-[11px] text-white min-w-[780px]">
          <thead className="sticky top-0 bg-slate-800 text-[9px] uppercase tracking-wider z-10">
            <tr>
              <th className="px-2 py-2 text-left text-slate-400 w-6"></th>
              <th className="px-2 py-2 text-left text-slate-400 whitespace-nowrap">ID Vuelo</th>
              <th className={thClass('origen')} onClick={() => toggleOrden('origen')}>Orig{indicator('origen')}</th>
              <th className={thClass('destino')} onClick={() => toggleOrden('destino')}>Dest{indicator('destino')}</th>
              <th className={thClass('cant')} onClick={() => toggleOrden('cant')}>Ocup.{indicator('cant')}</th>
              <th className={thClass('cap')} onClick={() => toggleOrden('cap')}>Cap.{indicator('cap')}</th>
              <th className={thClass('pct')} onClick={() => toggleOrden('pct')}>% Ocup{indicator('pct')}</th>
              <th className={thClass('minSalida')} onClick={() => toggleOrden('minSalida')}>Salida{indicator('minSalida')}</th>
              <th className={thClass('minLlegada')} onClick={() => toggleOrden('minLlegada')}>Llegada{indicator('minLlegada')}</th>
              {onCancelarVuelo && <th className="px-2 py-2 text-left text-slate-400">Acción</th>}
            </tr>
          </thead>
          <tbody>
            {ordenado.length === 0 ? (
              <tr><td colSpan={9} className="text-center text-slate-500 py-8 italic">Sin vuelos activos</td></tr>
            ) : ordenado.map((v: any) => {
              const abierto = expandido === v.key;
              const enviosDelVuelo = enviosPorVueloKey[v.key] ?? [];
              const semaforoClass = v.cant === 0 ? 'bg-slate-500/20 text-slate-400 border border-slate-500/40' : v.pct >= 80 ? 'bg-red-500/20 text-red-400 border border-red-500/40' : v.pct >= 50 ? 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40' : 'bg-green-500/20 text-green-400 border border-green-500/40';
              return (
                <React.Fragment key={v.key}>
                  <tr
                    ref={(el) => { if (el) filaRefs.current.set(v.key, el); else filaRefs.current.delete(v.key); }}
                    onClick={() => { setExpandido(abierto ? null : v.key); onSeleccionar(v.key); }}
                    className={`border-b border-slate-800 cursor-pointer transition-colors ${abierto ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                    <td className="px-3 py-2 text-slate-400 text-center">{abierto ? '▼' : '▶'}</td>
                    <td className="px-3 py-2 font-mono text-[10px] text-slate-200 font-bold">
                      {v.origen}-{v.destino}-{v.horaSalida}<br/>
                      <span className="text-slate-500 text-[9px] font-normal">{v.fecha}</span>
                    </td>
                    <td className="px-2 py-2 font-bold">{v.origen}</td>
                    <td className="px-2 py-2 font-bold">{v.destino}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${semaforoClass}`}>{v.cant} mal.</span>
                    </td>
                    <td className="px-2 py-2 text-slate-300 font-mono text-center">{v.cap}</td>
                    <td className="px-2 py-2 text-center">
                      <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${semaforoClass}`}>{v.pct}%</span>
                    </td>
                    <td className="px-2 py-2 text-tasf-green font-mono">{v.horaSalida}</td>
                    <td className="px-2 py-2 font-mono text-slate-300">{v.horaLlegada}</td>
                    {onCancelarVuelo && (() => {
                      const claveRuta = `${v.origen}-${v.destino}-${v.horaSalida}`;
                      const cancelado = vuelosCancelados?.has(claveRuta);
                      return (
                        <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                          {cancelado ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">
                              ✕ Cancelado
                            </span>
                          ) : (
                            <button
                              onClick={() => onCancelarVuelo(claveRuta)}
                              className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-700 hover:bg-red-500/20 text-slate-400 hover:text-red-400 border border-slate-600 hover:border-red-500/40 transition-colors"
                            >
                              Cancelar
                            </button>
                          )}
                        </td>
                      );
                    })()}
                  </tr>
                  {abierto && (
                    <tr className="border-b border-slate-700">
                      <td colSpan={9} className="bg-slate-900 px-0 py-0">
                        <div className="px-4 py-3">
                          <p className="text-[10px] font-bold text-tasf-green mb-2">
                            📦 Envíos consolidados en la UT: {v.origen}-{v.destino}-{v.horaSalida}
                          </p>
                          {enviosDelVuelo.length === 0 ? (
                            <p className="text-slate-500 italic text-[10px]">Sin envíos asignados</p>
                          ) : (
                            <table className="w-full text-[10px] text-white">
                              <thead>
                                <tr className="text-[9px] uppercase text-slate-500 border-b border-slate-700">
                                  <th className="pb-1 text-left">ID Envío</th>
                                  <th className="pb-1 text-left">ID Cliente</th>
                                  <th className="pb-1 text-left">Cant. Maletas</th>
                                  <th className="pb-1 text-left">Origen</th>
                                  <th className="pb-1 text-left">Destino</th>
                                </tr>
                              </thead>
                              <tbody>
                                {enviosDelVuelo.map((e: any) => (
                                  <tr key={e.id} className="border-b border-slate-800">
                                    <td className="py-1 font-mono text-tasf-green">{e.id}</td>
                                    <td className="py-1 font-mono text-slate-300">{e.idCliente}</td>
                                    <td className="py-1">
                                      <span className={`font-bold px-1.5 py-0.5 rounded ${e.cantidadMaletas >= 10 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-tasf-green/20 text-tasf-green'}`}>
                                        {e.cantidadMaletas} mal.
                                      </span>
                                    </td>
                                    <td className="py-1 font-bold">{e.origen}</td>
                                    <td className="py-1 font-bold">{e.destino}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DrawerAlmacenes({ resultado, minutosVirtualesTotales, fechaInicioSim, onCerrar, onSeleccionarAeropuerto, ocupacionAeropuertosRT, aeropuertoExpandir, onFiltrados }: {
  resultado: any; minutosVirtualesTotales: number; fechaInicioSim: string; onCerrar: () => void;
  onSeleccionarAeropuerto: (codigo: string) => void;
  ocupacionAeropuertosRT: Record<string, number>;
  aeropuertoExpandir?: string | null;
  onFiltrados?: (codigos: string[] | null) => void;
}) {
  type Col = 'codigo'|'ocupacion'|'capacidad'|'pct'|'enviosEnAlmacen'|'maletasEnAlmacen'|'enviosEnCamino'|'maletasEnCamino';
  const [orden, setOrden] = useState<{ col: Col; dir: 1|-1 }>({ col: 'pct', dir: -1 });
  const [expandido, setExpandido] = useState<string | null>(null);
  const [filtroContinente, setFiltroContinente] = useState('');
  const [filtroAeropuerto, setFiltroAeropuerto] = useState('');
  const [filtroSemaforo, setFiltroSemaforo] = useState<''|'verde'|'amarillo'|'rojo'|'vacio'>('');
  const filaRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    if (!aeropuertoExpandir) return;
    setExpandido(aeropuertoExpandir);
    setFiltroContinente('');
    setFiltroAeropuerto('');
    setTimeout(() => {
      const row = filaRefs.current.get(aeropuertoExpandir);
      row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [aeropuertoExpandir]);

  const normH = (t: string) => { const p = (t ?? '').split(':'); return `${p[0].padStart(2,'0')}:${(p[1]??'00').padStart(2,'0')}:${(p[2]??'00').padStart(2,'0')}`; };

  const almacenes = useMemo<{ filas: any[] }>(() => {
    if (!resultado) {
        return {
            filas: [],
            enviosPorAero: {},
        };
    }
    const capacidadesAero = resultado.capacidadesAeropuertos ?? {};
    const detalles = resultado.detallesEnvios ?? {};
    const rutasAsignadas = resultado.rutasAsignadas ?? {};

    const ocupPorAero: Record<string, number> = ocupacionAeropuertosRT;

    const fechasTramos = (resultado as any).fechasTramos ?? {};

    type ItemEnvio = { id: string; idCliente: string; maletas: number; origen: string; destino: string; tipo: 'transito' | 'final' };
    const enviosPorAero: Record<string, { enAlmacen: ItemEnvio[]; enCamino: ItemEnvio[] }> = {};
    const asegurar = (cod: string) => {
      if (!enviosPorAero[cod]) enviosPorAero[cod] = { enAlmacen: [], enCamino: [] };
    };

    Object.entries(detalles as Record<string, any>).forEach(([id, detalle]) => {
      const tramos: any[] = rutasAsignadas[id] ?? [];
      const fechas: string[] = fechasTramos[id] ?? [];
      const mal = detalle.cantidadMaletas;

      tramos.forEach((v: any, i: number) => {
        const fechaSalida = fechas[i];
        if (!fechaSalida) return;
        const estado = clasificarVuelo(fechaSalida, normH(v.horaSalida??''), normH(v.horaLlegada??''), fechaInicioSim, minutosVirtualesTotales);

        const esUltimoTramo = i === tramos.length - 1;
        const tramoAnteriorOk = i === 0 || (() => {
          const fa = fechas[i - 1];
          if (!fa) return false;
          return clasificarVuelo(fa, normH(tramos[i-1].horaSalida??''), normH(tramos[i-1].horaLlegada??''), fechaInicioSim, minutosVirtualesTotales) === 'completado';
        })();

        // En tránsito aéreo → en camino al destino (v.destino)
        if (estado === 'vuelo') {
          asegurar(v.destino);
          enviosPorAero[v.destino].enCamino.push({ id, idCliente: detalle.idCliente, maletas: mal, origen: detalle.origen, destino: detalle.destino, tipo: 'transito' });
        }

        // En espera con tramo anterior completado → físicamente en el almacén (tránsito)
        if (estado === 'espera' && tramoAnteriorOk) {
          asegurar(v.origen);
          enviosPorAero[v.origen].enAlmacen.push({ id, idCliente: detalle.idCliente, maletas: mal, origen: detalle.origen, destino: detalle.destino, tipo: 'transito' });
        }

        // Último tramo completado → destino final, solo si el cliente aún no recogió (< 15 min desde llegada)
        if (estado === 'completado' && esUltimoTramo) {
          const minLlegada = minLlegadaDesdeInicio(fechaSalida, normH(v.horaSalida??''), normH(v.horaLlegada??''), fechaInicioSim);
          if (minutosVirtualesTotales < minLlegada + 15) {
            asegurar(v.destino);
            enviosPorAero[v.destino].enAlmacen.push({ id, idCliente: detalle.idCliente, maletas: mal, origen: detalle.origen, destino: detalle.destino, tipo: 'final' });
          }
        }
      });
    });

    // Construir filas
    const codigos = new Set([
      ...Object.keys(ocupPorAero),
      ...Object.keys(capacidadesAero),
      ...Object.keys(enviosPorAero),
    ]);

    const filas = Array.from(codigos).map(codigo => {
      const ocupacion = ocupPorAero[codigo] ?? 0;
      const capacidad = capacidadesAero[codigo] ?? 0;
      const pct = capacidad > 0 ? Math.round((ocupacion / capacidad) * 100) : 0;
      const flujo = enviosPorAero[codigo] ?? { enAlmacen: [], enCamino: [] };
      return {
        codigo,
        ocupacion,
        capacidad,
        pct,
        enviosEnAlmacen: flujo.enAlmacen.length,
        maletasEnAlmacen: flujo.enAlmacen.reduce((s, e) => s + e.maletas, 0),
        enviosEnCamino: flujo.enCamino.length,
        maletasEnCamino: flujo.enCamino.reduce((s, e) => s + e.maletas, 0),
        detalleAlmacen: flujo.enAlmacen,
        detalleCamino: flujo.enCamino,
      };
    });
    return { filas, enviosPorAero };
  }, [resultado, minutosVirtualesTotales, fechaInicioSim]);

  const ordenados = useMemo(() => {
    let filas = [...almacenes.filas];
    if (filtroContinente) filas = filas.filter(a => (aeropuertoContinente[a.codigo] ?? '') === filtroContinente);
    if (filtroAeropuerto) filas = filas.filter(a => a.codigo === filtroAeropuerto);
    if (filtroSemaforo === 'vacio') filas = filas.filter(a => a.ocupacion === 0);
    else if (filtroSemaforo === 'verde') filas = filas.filter(a => a.ocupacion > 0 && a.pct < 50);
    else if (filtroSemaforo === 'amarillo') filas = filas.filter(a => a.pct >= 50 && a.pct < 80);
    else if (filtroSemaforo === 'rojo') filas = filas.filter(a => a.pct >= 80);
    return filas.sort((a, b) => {
      if (orden.col === 'codigo') return a.codigo.localeCompare(b.codigo) * orden.dir;
      return ((a[orden.col] as number) - (b[orden.col] as number)) * orden.dir;
    });
  }, [almacenes, orden, filtroContinente, filtroAeropuerto, filtroSemaforo]);

  const hayFiltroActivo = !!(filtroContinente || filtroAeropuerto || filtroSemaforo);
  useEffect(() => {
    if (!onFiltrados) return;
    onFiltrados(hayFiltroActivo ? ordenados.map(a => a.codigo) : null);
  }, [ordenados, hayFiltroActivo]);

  const thC = (col: Col) =>
    `px-3 py-2 text-left cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${orden.col === col ? 'text-tasf-green' : 'text-slate-400'}`;
  const ind = (col: Col) => orden.col === col ? (orden.dir === 1 ? ' ↑' : ' ↓') : ' ↕';
  const tog = (col: Col) => setOrden(o => o.col === col ? { col, dir: o.dir === 1 ? -1 : 1 } : { col, dir: -1 });

  const semaforo = (pct: number) => {
    if (pct >= 80) return 'bg-red-500/20 text-red-400 border border-red-500/40';
    if (pct >= 50) return 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/40';
    return 'bg-tasf-green/20 text-tasf-green border border-tasf-green/40';
  };

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
        <h3 className="text-white font-bold text-sm">🏭 Almacenes ({ordenados.length}{filtroContinente ? `/${almacenes.filas.length}` : ''})</h3>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {/* Semáforo */}
          {(['vacio','verde','amarillo','rojo'] as const).map(s => (
            <button key={s} onClick={() => setFiltroSemaforo(f => f === s ? '' : s)}
              title={s === 'vacio' ? 'Sin maletas' : s.charAt(0).toUpperCase() + s.slice(1)}
              className={`w-5 h-5 rounded-full border-2 transition-all ${filtroSemaforo === s ? 'border-white scale-110' : 'border-transparent opacity-60 hover:opacity-100'} ${s === 'vacio' ? 'bg-slate-500' : s === 'verde' ? 'bg-green-500' : s === 'amarillo' ? 'bg-yellow-400' : 'bg-red-500'}`} />
          ))}
          <div className="w-px h-5 bg-slate-600" />
          <select
            value={filtroContinente}
            onChange={e => { setFiltroContinente(e.target.value); setFiltroAeropuerto(''); setExpandido(null); }}
            className="bg-slate-700 text-white text-[11px] rounded px-2 py-1 outline-none border border-slate-600 focus:border-tasf-green cursor-pointer"
          >
            <option value="">Todos los continentes</option>
            <option value="América del Sur">América del Sur</option>
            <option value="Europa">Europa</option>
            <option value="Asia">Asia</option>
          </select>
          <div className="w-44">
            <AeroSelect
              value={filtroAeropuerto}
              onChange={v => { setFiltroAeropuerto(v); setExpandido(null); }}
              opciones={almacenes.filas
                .filter(a => !filtroContinente || (aeropuertoContinente[a.codigo] ?? '') === filtroContinente)
                .map(a => a.codigo)
                .sort()}
              placeholder="Todos los aeropuertos"
            />
          </div>
          {hayFiltroActivo && (
            <button onClick={() => { setFiltroContinente(''); setFiltroAeropuerto(''); setFiltroSemaforo(''); setExpandido(null); }}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors">✕</button>
          )}
          <button onClick={onCerrar} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>
      </div>
      <div className="px-3 py-1.5 border-b border-slate-700 shrink-0">
        <p className="text-[9px] text-slate-500 italic">👆 Haz clic en una fila para ver envíos y navegar al aeropuerto en el mapa</p>
      </div>
      <div className="overflow-auto flex-1">
        <table className="w-full text-[11px] text-white min-w-[700px]">
          <thead className="sticky top-0 bg-slate-800 text-[9px] uppercase tracking-wider z-10">
            <tr>
              <th className="px-2 py-2 w-6 text-slate-400"></th>
              <th className={thC('codigo')} onClick={() => tog('codigo')}>Aeropuerto{ind('codigo')}</th>
              <th className={thC('ocupacion')} onClick={() => tog('ocupacion')}>Ocup. Actual{ind('ocupacion')}</th>
              <th className={thC('capacidad')} onClick={() => tog('capacidad')}>Cap. Máx{ind('capacidad')}</th>
              <th className={thC('pct')} onClick={() => tog('pct')}>% Ocup{ind('pct')}</th>
              <th className={thC('enviosEnAlmacen')} onClick={() => tog('enviosEnAlmacen')}>Envíos en Almacén{ind('enviosEnAlmacen')}</th>
              <th className={thC('enviosEnCamino')} onClick={() => tog('enviosEnCamino')}>Envíos en Camino{ind('enviosEnCamino')}</th>
              <th className={thC('maletasEnCamino')} onClick={() => tog('maletasEnCamino')}>Mal. en Camino{ind('maletasEnCamino')}</th>
            </tr>
          </thead>
          <tbody>
            {ordenados.length === 0 ? (
              <tr><td colSpan={8} className="text-center text-slate-500 py-8 italic">Sin datos</td></tr>
            ) : ordenados.map((a: any) => {
              const abierto = expandido === a.codigo;
              return (
                <React.Fragment key={a.codigo}>
                  <tr
                    ref={(el) => { if (el) filaRefs.current.set(a.codigo, el); else filaRefs.current.delete(a.codigo); }}
                    onClick={() => { setExpandido(abierto ? null : a.codigo); onSeleccionarAeropuerto(a.codigo); }}
                    className={`border-b border-slate-800 cursor-pointer transition-colors ${abierto ? 'bg-slate-800' : 'hover:bg-slate-800/60'}`}>
                    <td className="px-2 py-2 text-slate-400 text-center">{abierto ? '▼' : '▶'}</td>
                    <td className="px-3 py-2 font-bold text-white font-mono text-sm">{a.codigo}</td>
                    <td className="px-3 py-2">
                      <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${semaforo(a.pct)}`}>{a.ocupacion} mal.</span>
                    </td>
                    <td className="px-3 py-2 text-slate-300 font-mono">{a.capacidad}</td>
                    <td className="px-3 py-2">
                      <span className={`font-bold px-2 py-0.5 rounded text-[10px] ${semaforo(a.pct)}`}>{a.pct}%</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="bg-slate-700 text-slate-200 font-bold px-2 py-0.5 rounded text-[10px]">{a.enviosEnAlmacen} envíos</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="bg-slate-700 text-slate-200 font-bold px-2 py-0.5 rounded text-[10px]">{a.enviosEnCamino} envíos</span>
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className="bg-slate-700 text-slate-200 font-bold px-2 py-0.5 rounded text-[10px]">{a.maletasEnCamino} mal.</span>
                    </td>
                  </tr>
                  {abierto && (
                    <tr className="border-b border-slate-700">
                      <td colSpan={8} className="bg-slate-900 px-0 py-0">
                        <div className="px-4 py-3 flex gap-6">
                          {/* En el almacén */}
                          <div className="flex-1">
                            <p className="text-[10px] font-bold text-blue-300 mb-2">🏭 En el almacén ({a.detalleAlmacen.length})</p>
                            {a.detalleAlmacen.length === 0 ? <p className="text-slate-500 text-[10px] italic">Sin envíos</p> : (
                              <table className="w-full text-[10px]">
                                <thead><tr className="text-[9px] text-slate-500 border-b border-slate-700">
                                  <th className="pb-1 text-left">ID Envío</th>
                                  <th className="pb-1 text-left">Cliente</th>
                                  <th className="pb-1 text-left">Mal.</th>
                                  <th className="pb-1 text-left">Origen</th>
                                  <th className="pb-1 text-left">Destino</th>
                                  <th className="pb-1 text-left">Tipo</th>
                                </tr></thead>
                                <tbody>
                                  {a.detalleAlmacen.map((e: any, i: number) => (
                                    <tr key={i} className="border-b border-slate-800 text-white">
                                      <td className="py-1 font-mono text-tasf-green">{e.id}</td>
                                      <td className="py-1 text-slate-300">{e.idCliente}</td>
                                      <td className="py-1"><span className={`font-bold px-1 rounded ${e.maletas >= 10 ? 'text-yellow-400' : 'text-tasf-green'}`}>{e.maletas}</span></td>
                                      <td className="py-1 font-bold">{e.origen}</td>
                                      <td className="py-1 font-bold">{e.destino}</td>
                                      <td className="py-1">{e.tipo === 'final' ? <span className="text-tasf-green text-[9px] font-bold">DESTINO FINAL</span> : <span className="text-yellow-400 text-[9px] font-bold">TRÁNSITO</span>}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                          <div className="w-px bg-slate-700" />
                          {/* En camino */}
                          <div className="flex-1">
                            <p className="text-[10px] font-bold text-slate-400 mb-2">✈️ En camino ({a.detalleCamino.length})</p>
                            {a.detalleCamino.length === 0 ? <p className="text-slate-500 text-[10px] italic">Sin envíos</p> : (
                              <table className="w-full text-[10px]">
                                <thead><tr className="text-[9px] text-slate-500 border-b border-slate-700">
                                  <th className="pb-1 text-left">ID Envío</th>
                                  <th className="pb-1 text-left">Cliente</th>
                                  <th className="pb-1 text-left">Mal.</th>
                                  <th className="pb-1 text-left">Origen</th>
                                  <th className="pb-1 text-left">Destino</th>
                                </tr></thead>
                                <tbody>
                                  {a.detalleCamino.map((e: any, i: number) => (
                                    <tr key={i} className="border-b border-slate-800 text-white">
                                      <td className="py-1 font-mono text-tasf-green">{e.id}</td>
                                      <td className="py-1 text-slate-300">{e.idCliente}</td>
                                      <td className="py-1"><span className={`font-bold px-1 rounded ${e.maletas >= 10 ? 'text-yellow-400' : 'text-tasf-green'}`}>{e.maletas}</span></td>
                                      <td className="py-1 font-bold">{e.origen}</td>
                                      <td className="py-1 font-bold">{e.destino}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DrawerEnvios({ resultado, minutosVirtualesTotales, fechaInicioSim, onCerrar, onVerVuelo, onVerAlmacen, onEnfocarVuelo, onEnfocarAlmacen, onVerRutaEnvio }: {
  resultado: any; minutosVirtualesTotales: number; fechaInicioSim: string; onCerrar: () => void;
  onVerVuelo?: (key: string) => void;
  onVerAlmacen?: (codigo: string) => void;
  onEnfocarVuelo?: (key: string) => void;
  onEnfocarAlmacen?: (codigo: string) => void;
  onVerRutaEnvio?: (id: string) => void;
}) {
  type Col = 'id'|'idCliente'|'vuelo'|'maletas'|'origen'|'destino';
  type Tab = 'vuelo'|'espera'|'completado'|'replanificado';
  const [tab, setTab] = useState<Tab>('vuelo');
  const [orden, setOrden] = useState<{ col: Col; dir: 1|-1 }>({ col: 'id', dir: 1 });
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false);
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  // Completados: input horas + estado aplicado
  const [horasInput, setHorasInput] = useState('4');
  const [horasAplicadas, setHorasAplicadas] = useState<number | null>(null);

  const normH = (t: string) => { const p = (t ?? '').split(':'); return `${p[0].padStart(2,'0')}:${(p[1]??'00').padStart(2,'0')}:${(p[2]??'00').padStart(2,'0')}`; };

  // Datos base por envío — solo se recalcula cuando llega un nuevo bloque del backend
  const datosBase = useMemo(() => {
    const detalles = resultado?.detallesEnvios ?? {};
    const rutasAsignadas = resultado?.rutasAsignadas ?? {};
    const fechasTramos = (resultado as any)?.fechasTramos ?? {};
    return Object.entries(detalles as Record<string, any>).map(([id, detalle]) => {
      const tramos: any[] = rutasAsignadas[id] ?? [];
      const fechas: string[] = fechasTramos[id] ?? [];
      const vuelo = tramos.map(v => `${v.origen}-${v.destino}-${normH(v.horaSalida??'')}`).join(' → ') || '—';
      return { id, idCliente: detalle.idCliente, vuelo, maletas: detalle.cantidadMaletas, origen: detalle.origen, destino: detalle.destino, tramos, fechas };
    });
  }, [resultado]);

  // "En vuelo": sacar envíos directamente de los vuelos activos en este momento
  const enviosEnVuelo = useMemo(() => {
    const detalles = resultado?.detallesEnvios ?? {};
    const rutasAsignadas = resultado?.rutasAsignadas ?? {};
    const horasLlegadaMap = resultado?.horasLlegada ?? {};
    const vistos = new Set<string>();
    const lista: any[] = [];

    Object.entries(resultado?.ocupacionVuelos ?? {}).forEach(([key]) => {
      const idx = key.lastIndexOf('_');
      if (idx < 0) return;
      const sinFecha = key.substring(0, idx);
      const fecha = key.substring(idx + 1);
      const partes = sinFecha.split('-');
      if (partes.length < 3) return;
      const origen = partes[0], destino = partes[1];
      const horaSalida = normH(partes.slice(2).join(':'));
      const claveRuta = `${origen}-${destino}-${horaSalida}`;

      let horaLlegada = normH((horasLlegadaMap as any)[claveRuta] ?? '');
      if (!horaLlegada || horaLlegada === '00:00:00') {
        for (const ruta of Object.values(rutasAsignadas) as any[][]) {
          const v = ruta.find((r: any) => r.origen === origen && r.destino === destino && normH(r.horaSalida ?? '') === horaSalida);
          if (v?.horaLlegada) { horaLlegada = normH(v.horaLlegada); break; }
        }
      }
      if (!horaLlegada || horaLlegada === '00:00:00') return;
      if (clasificarVuelo(fecha, horaSalida, horaLlegada, fechaInicioSim, minutosVirtualesTotales) !== 'vuelo') return;

      // Recopilar pedidos que tienen este tramo
      Object.entries(rutasAsignadas).forEach(([id, tramos]: [string, any]) => {
        if (vistos.has(id)) return;
        const tieneTramo = (tramos as any[]).some((v: any) =>
          v.origen === origen && v.destino === destino && normH(v.horaSalida ?? '') === horaSalida
        );
        if (!tieneTramo) return;
        vistos.add(id);
        const d = (detalles as any)[id];
        if (!d) return;
        lista.push({
          id,
          idCliente: d.idCliente,
          maletas: d.cantidadMaletas,
          origen: d.origen,
          destino: d.destino,
          vuelo: claveRuta,
          vueloKey: key,
          aeropuerto: origen,
          minLlegadaFinal: 0,
        });
      });
    });
    return lista;
  }, [resultado, minutosVirtualesTotales, fechaInicioSim]);

  const idsReplanificados: Set<string> = useMemo(() =>
    new Set((resultado?.pedidosReplanificados as string[] | undefined) ?? []),
  [resultado]);

  // Espera y completados siguen usando clasificación por fecha
  const grupos = useMemo(() => {
    const result: Record<Tab, any[]> = { vuelo: enviosEnVuelo, espera: [], completado: [], replanificado: [] };
    const idsEnVuelo = new Set(enviosEnVuelo.map((e: any) => e.id));
    datosBase.forEach(({ tramos, fechas, ...item }) => {
      if (idsEnVuelo.has(item.id)) return; // ya está en vuelo
      let minLlegadaFinal = 0;
      let aeropuerto: string | null = null;
      let todosCompletos = tramos.length > 0;
      for (let i = 0; i < tramos.length; i++) {
        const v = tramos[i];
        const fechaSalida = fechas[i];
        if (!fechaSalida) { todosCompletos = false; continue; }
        const e = clasificarVuelo(fechaSalida, normH(v.horaSalida), normH(v.horaLlegada), fechaInicioSim, minutosVirtualesTotales);
        const mLleg = minLlegadaDesdeInicio(fechaSalida, normH(v.horaSalida??''), normH(v.horaLlegada??''), fechaInicioSim);
        if (mLleg > minLlegadaFinal) minLlegadaFinal = mLleg;
        if (e === 'espera') { todosCompletos = false; if (!aeropuerto) aeropuerto = v.origen; break; }
      }
      if (!aeropuerto && todosCompletos) aeropuerto = tramos[tramos.length - 1]?.destino ?? null;
      const estado: Tab = todosCompletos ? 'completado' : 'espera';
      result[estado].push({ ...item, minLlegadaFinal, vueloKey: null, aeropuerto });
    });
    // Tab replanificados: cualquier pedido (de cualquier estado) que fue afectado
    const todosEnvios = [...result.vuelo, ...result.espera, ...result.completado];
    const idsYa = new Set<string>();
    todosEnvios.forEach(e => {
      if (idsReplanificados.has(e.id) && !idsYa.has(e.id)) {
        idsYa.add(e.id);
        result.replanificado.push(e);
      }
    });
    return result;
  }, [enviosEnVuelo, datosBase, minutosVirtualesTotales, fechaInicioSim, idsReplanificados]);

  const [pagina, setPagina] = useState(0);
  const PAGE_SIZE = 50;

  const filasTotales = useMemo(() => {
    const fo = filtroOrigen.trim().toUpperCase();
    const fd = filtroDestino.trim().toUpperCase();
    let base = grupos[tab];
    if (tab === 'completado' && horasAplicadas !== null) {
      const minCorte = minutosVirtualesTotales - horasAplicadas * 60;
      base = base.filter(e => e.minLlegadaFinal >= minCorte);
    }
    return base
      .filter(e => (!fo || e.origen.toUpperCase().includes(fo)) && (!fd || e.destino.toUpperCase().includes(fd)))
      .sort((a, b) => {
        if (orden.col === 'maletas') return (a.maletas - b.maletas) * orden.dir;
        return String(a[orden.col]).localeCompare(String(b[orden.col])) * orden.dir;
      });
  }, [grupos, tab, orden, filtroOrigen, filtroDestino, horasAplicadas, minutosVirtualesTotales]);

  // Reset página al cambiar tab o filtros
  React.useEffect(() => { setPagina(0); }, [tab, filtroOrigen, filtroDestino]);

  const filasFiltradas = filasTotales.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const totalPaginas = Math.ceil(filasTotales.length / PAGE_SIZE);

  const thC = (col: Col) =>
    `px-2 py-2 text-left cursor-pointer select-none hover:text-white transition-colors whitespace-nowrap ${orden.col === col ? 'text-tasf-green' : 'text-slate-400'}`;
  const ind = (col: Col) => orden.col === col ? (orden.dir === 1 ? ' ↑' : ' ↓') : ' ↕';
  const tog = (col: Col) => setOrden(o => o.col === col ? { col, dir: o.dir === 1 ? -1 : 1 } : { col, dir: 1 });
  const hayFiltros = !!(filtroOrigen || filtroDestino);

  const tabs: { key: Tab; label: string; color: string }[] = [
    { key: 'vuelo', label: 'En vuelo', color: 'text-tasf-green' },
    { key: 'espera', label: 'En espera', color: 'text-yellow-400' },
    { key: 'completado', label: 'Completados', color: 'text-slate-400' },
    { key: 'replanificado', label: '↺ Replan.', color: 'text-orange-400' },
  ];

  return (
    <>
      <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
        <h3 className="text-white font-bold text-sm">📦 Envíos</h3>
        <div className="flex items-center gap-2">
          <button onClick={() => setFiltrosAbiertos(v => !v)}
            className={`text-[10px] px-2 py-0.5 rounded border transition-colors ${filtrosAbiertos || hayFiltros ? 'border-tasf-green bg-tasf-green/20 text-tasf-green' : 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-400'}`}>
            ⚙ {filtrosAbiertos ? '▲' : '▼'}{hayFiltros ? ' •' : ''}
          </button>
          <button onClick={onCerrar} className="text-slate-400 hover:text-white text-lg leading-none">✕</button>
        </div>
      </div>

      {/* Filtros desplegables */}
      {filtrosAbiertos && <div className="border-b border-slate-700 bg-slate-900">
        <div className="flex gap-2 px-4 pt-2 pb-2">
          <div className="flex-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-wider block mb-1">Origen</label>
            <AeroSelect
              value={filtroOrigen}
              onChange={setFiltroOrigen}
              opciones={[...new Set(Object.values(resultado?.detallesEnvios ?? {}).map((d: any) => d.origen))].sort() as string[]}
              placeholder="Todos los orígenes"
            />
          </div>
          <div className="flex-1">
            <label className="text-[9px] text-slate-500 uppercase tracking-wider block mb-1">Destino</label>
            <AeroSelect
              value={filtroDestino}
              onChange={setFiltroDestino}
              opciones={[...new Set(Object.values(resultado?.detallesEnvios ?? {}).map((d: any) => d.destino))].sort() as string[]}
              placeholder="Todos los destinos"
            />
          </div>
          {hayFiltros && (
            <button onClick={() => { setFiltroOrigen(''); setFiltroDestino(''); }}
              className="self-end text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors mb-0.5">✕</button>
          )}
        </div>
      </div>}

      {/* Tabs */}
      <div className="flex border-b border-slate-700 shrink-0">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key as Tab); if (t.key !== 'completado') setHorasAplicadas(null); }}
            className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-colors ${tab === t.key ? `${t.color} border-b-2 border-current` : 'text-slate-500 hover:text-slate-300'}`}>
            {t.label} ({grupos[t.key].length})
          </button>
        ))}
      </div>

      {/* Banner explicativo para tab replanificados */}
      {tab === 'replanificado' && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-orange-800/40 bg-orange-950/20 shrink-0">
          <span className="text-orange-400 text-[10px]">↺</span>
          <span className="text-[10px] text-orange-300">Pedidos cuyo vuelo fue cancelado y fueron re-planificados.</span>
        </div>
      )}

      {/* Panel de filtro por horas (solo Completados) */}
      {tab === 'completado' && (
        <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-700 bg-slate-900 shrink-0">
          <span className="text-[10px] text-slate-400">Últimas</span>
          <input type="number" min="1" max="999" value={horasInput} onChange={e => setHorasInput(e.target.value)}
            className="w-14 bg-slate-700 text-white text-[11px] rounded px-2 py-1 outline-none focus:ring-1 focus:ring-tasf-green text-center" />
          <span className="text-[10px] text-slate-400">horas</span>
          <button onClick={() => setHorasAplicadas(Number(horasInput) || 4)}
            className="ml-auto bg-tasf-green hover:bg-green-600 text-white text-[10px] font-bold px-3 py-1 rounded transition-colors">
            Filtrar
          </button>
          {horasAplicadas !== null && (
            <button onClick={() => setHorasAplicadas(null)}
              className="text-[10px] text-slate-400 hover:text-white px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 transition-colors">✕</button>
          )}
        </div>
      )}

      <div className="overflow-y-auto flex-1">
        {tab === 'completado' && horasAplicadas === null ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-6">
            <p className="text-slate-400 text-xs mb-1">Ingresa un rango de horas y presiona</p>
            <p className="text-tasf-green font-bold text-xs">Filtrar</p>
            <p className="text-slate-500 text-[10px] mt-2">para ver los envíos completados</p>
          </div>
        ) : (
        <table className="w-full text-[11px] text-white">
          <thead className="sticky top-0 bg-slate-800 text-[9px] uppercase tracking-wider">
            <tr>
              <th className={thC('id')} onClick={() => tog('id')}>ID Envío{ind('id')}</th>
              <th className={thC('idCliente')} onClick={() => tog('idCliente')}>ID Cliente{ind('idCliente')}</th>
              <th className={thC('vuelo')} onClick={() => tog('vuelo')}>UT (Vuelo){ind('vuelo')}</th>
              <th className={thC('maletas')} onClick={() => tog('maletas')}>Maletas{ind('maletas')}</th>
              <th className={thC('origen')} onClick={() => tog('origen')}>Origen{ind('origen')}</th>
              <th className={thC('destino')} onClick={() => tog('destino')}>Destino{ind('destino')}</th>
              <th className="px-2 py-2 text-slate-400 w-6"></th>
            </tr>
          </thead>
          <tbody>
            {filasFiltradas.length === 0 ? (
              <tr><td colSpan={7} className="text-center text-slate-500 py-8 italic">Sin envíos</td></tr>
            ) : filasFiltradas.map(e => (
              <tr key={e.id} className={`border-b border-slate-800 hover:bg-slate-800 transition-colors ${idsReplanificados.has(e.id) ? 'bg-orange-950/30' : ''}`}>
                <td className="px-2 py-2 font-mono text-[10px] text-slate-200">
                  {e.id}
                  {idsReplanificados.has(e.id) && (
                    <span className="ml-1 text-orange-400 font-bold text-[9px] bg-orange-400/10 px-1 py-0.5 rounded">↺</span>
                  )}
                </td>
                <td className="px-2 py-2 font-mono text-[10px] text-slate-300">{e.idCliente}</td>
                <td className="px-2 py-2 font-mono text-[10px] text-slate-300 max-w-[160px] truncate" title={e.vuelo}>{e.vuelo}</td>
                <td className="px-2 py-2 text-center">
                  <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] ${e.maletas >= 10 ? 'bg-yellow-500/20 text-yellow-400' : 'bg-tasf-green/20 text-tasf-green'}`}>{e.maletas} mal.</span>
                </td>
                <td className="px-2 py-2 font-bold">{e.origen}</td>
                <td className="px-2 py-2 font-bold">{e.destino}</td>
                <td className="px-2 py-2 text-center">
                  {onVerRutaEnvio && (
                    <button onClick={(event) => { event.stopPropagation(); onVerRutaEnvio(e.id); }}
                      title="Ver ruta completa del envío con escalas"
                      className="text-cyan-400 hover:text-cyan-300 text-[11px] px-1.5 py-0.5 rounded bg-cyan-400/10 hover:bg-cyan-400/20 transition-colors mr-1">
                      🧭 Ruta
                    </button>
                  )}
                  {tab === 'vuelo' && e.vueloKey && onVerVuelo && (
                    <button onClick={(event) => { event.stopPropagation(); onVerVuelo(e.vueloKey!); }}
                      title="Ver vuelo en mapa y panel"
                      className="text-tasf-green hover:text-green-400 text-[11px] px-1.5 py-0.5 rounded bg-tasf-green/10 hover:bg-tasf-green/20 transition-colors">
                      ✈ Ver
                    </button>
                  )}
                  {(tab === 'espera' || tab === 'completado') && e.aeropuerto && onVerAlmacen && (
                    <button onClick={(event) => { event.stopPropagation(); onVerAlmacen(e.aeropuerto!); }}
                      title="Ver almacén en mapa y panel"
                      className="text-blue-400 hover:text-blue-300 text-[11px] px-1.5 py-0.5 rounded bg-blue-400/10 hover:bg-blue-400/20 transition-colors">
                      🏭 Ver
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
        {totalPaginas > 1 && (
          <div className="flex items-center justify-center gap-3 py-2 border-t border-slate-700">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600">← Ant</button>
            <span className="text-[10px] text-slate-400">
              {pagina + 1} / {totalPaginas} — {filasTotales.length} envíos
            </span>
            <button onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))} disabled={pagina === totalPaginas - 1}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600">Sig →</button>
          </div>
        )}
      </div>
    </>
  );
}

function EnviosPanel({ resultado, minutosVirtualesTotales, fechaInicioSim, vueloResaltado, onLimpiarRuta }: {
  resultado: any; minutosVirtualesTotales: number; fechaInicioSim: string;
  vueloResaltado: string | null; onLimpiarRuta: () => void;
}) {
  const [tab, setTab] = useState<'vuelo'|'espera'|'completado'>('vuelo');
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const normH = (t: string) => { const p = (t ?? "").split(":"); return `${p[0].padStart(2,"0")}:${(p[1]??"00").padStart(2,"0")}:${(p[2]??"00").padStart(2,"0")}`; };

  const { todos, grupos } = useMemo(() => {
    const detalles = resultado?.detallesEnvios ?? {};
    const rutasAsignadas = resultado?.rutasAsignadas ?? {};
    let entradas = Object.entries(detalles) as [string, any][];

    // Filtrar por ruta seleccionada
    if (vueloResaltado) {
      const sinFecha = vueloResaltado.split("_")[0];
      const partes = sinFecha.split("-");
      const origenR = partes[0], destinoR = partes[1], horaR = normH(partes[2] ?? "");
      const ids = new Set(
        Object.entries(rutasAsignadas)
          .filter(([, vuelos]: any) => vuelos.some((v: any) =>
            v.origen === origenR && v.destino === destinoR && normH(v.horaSalida ?? "") === horaR))
          .map(([id]) => id)
      );
      entradas = entradas.filter(([id]) => ids.has(id));
    }

    // Filtrar por origen/destino
    if (filtroOrigen.trim()) {
      const fo = filtroOrigen.trim().toUpperCase();
      entradas = entradas.filter(([, d]) => (d.origen ?? '').toUpperCase().includes(fo));
    }
    if (filtroDestino.trim()) {
      const fd = filtroDestino.trim().toUpperCase();
      entradas = entradas.filter(([, d]) => (d.destino ?? '').toUpperCase().includes(fd));
    }

    // Clasificar cada envío según el estado de su último tramo activo
    const grupos: Record<string, any[]> = { vuelo: [], espera: [], completado: [] };
    entradas.forEach(([id, detalle]) => {
      const tramos: any[] = rutasAsignadas[id] ?? [];
      if (tramos.length === 0) { grupos.espera.push({ id, detalle }); return; }
      // Determinar estado: si algún tramo está en vuelo → vuelo; si todos completados → completado; si no → espera
      let estado = 'completado';
      for (const v of tramos) {
        const fechaSalida = Object.keys(resultado.ocupacionVuelos ?? {})
          .find((k: string) => { const sf = k.split("_")[0]; const p = sf.split("-"); return p[0]===v.origen && p[1]===v.destino && normH(p[2])===normH(v.horaSalida??''); })
          ?.split("_")[1];
        if (!fechaSalida) { estado = 'espera'; break; }
        const e = clasificarVuelo(fechaSalida, normH(v.horaSalida), normH(v.horaLlegada), fechaInicioSim, minutosVirtualesTotales);
        if (e === 'vuelo') { estado = 'vuelo'; break; }
        if (e === 'espera') { estado = 'espera'; }
      }
      grupos[estado].push({ id, detalle });
    });
    return { todos: entradas, grupos };
  }, [resultado, vueloResaltado, minutosVirtualesTotales, fechaInicioSim, filtroOrigen, filtroDestino]);

  const tabs = [
    { key: 'vuelo' as const, label: 'En vuelo', color: 'text-tasf-green' },
    { key: 'espera' as const, label: 'En espera', color: 'text-yellow-400' },
    { key: 'completado' as const, label: 'Completados', color: 'text-slate-400' },
  ];

  return (
    <div className="flex-[1.5] min-w-[260px] bg-tasf-dark rounded-xl shadow-lg border border-slate-700 flex flex-col text-white overflow-hidden">
      <div className="flex justify-between items-center px-3 pt-3 pb-1">
        <h3 className="text-[10px] uppercase font-bold text-slate-400 tracking-widest">
          Envíos ({todos.length}{vueloResaltado ? " en ruta" : ""})
        </h3>
        {vueloResaltado && (
          <button onClick={onLimpiarRuta}
            className="text-[9px] text-slate-400 hover:text-white bg-slate-700 hover:bg-slate-600 px-1.5 py-0.5 rounded transition-colors">
            ✕ limpiar
          </button>
        )}
      </div>
      <div className="flex gap-1 px-2 pb-1.5">
        <input value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)} placeholder="Origen…"
          className="flex-1 bg-slate-700 text-white text-[10px] rounded px-2 py-1 placeholder-slate-500 outline-none focus:ring-1 focus:ring-tasf-green" />
        <input value={filtroDestino} onChange={e => setFiltroDestino(e.target.value)} placeholder="Destino…"
          className="flex-1 bg-slate-700 text-white text-[10px] rounded px-2 py-1 placeholder-slate-500 outline-none focus:ring-1 focus:ring-tasf-green" />
      </div>
      <div className="flex border-b border-slate-700">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-1.5 text-[9px] font-bold uppercase tracking-wider transition-colors ${tab === t.key ? `${t.color} border-b-2 border-current` : 'text-slate-500 hover:text-slate-300'}`}>
            {t.label} ({grupos[t.key].length})
          </button>
        ))}
      </div>
      <div className="overflow-y-auto flex-1 p-2 space-y-1.5">
        {!resultado ? (
          <p className="text-slate-500 italic text-xs mt-4 text-center">Esperando datos...</p>
        ) : grupos[tab].length === 0 ? (
          <p className="text-slate-500 italic text-xs mt-4 text-center">Sin envíos</p>
        ) : grupos[tab].map(({ id, detalle }) => (
          <div key={id} className="bg-slate-800 rounded-lg px-2 py-1.5 text-[10px]">
            <div className="flex justify-between items-center mb-0.5">
              <span className="font-bold text-white font-mono truncate max-w-[120px]" title={id}>{id}</span>
              <span className="text-tasf-green font-bold">{detalle.cantidadMaletas} mal.</span>
            </div>
            <div className="flex justify-between text-slate-400">
              <span>{detalle.origen} → {detalle.destino}</span>
              <span className="truncate max-w-[80px] text-right" title={detalle.idCliente}>{detalle.idCliente}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function RutasPanel({ resultado, minutosVirtualesTotales, fechaInicioSim, vueloResaltado, onSeleccionarRuta }: {
  resultado: any; minutosVirtualesTotales: number; fechaInicioSim: string;
  vueloResaltado: string | null; onSeleccionarRuta: (uid: string | null) => void;
}) {
  const [tab, setTab] = useState<'vuelo'|'espera'|'completado'>('vuelo');
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');

  const rutas = useMemo(() => {
    if (!resultado?.ocupacionVuelos) return { vuelo: [] as any[], espera: [] as any[], completado: [] as any[] };
    const grupos: Record<string, any[]> = { vuelo: [], espera: [], completado: [] };
    const vistas = new Set<string>();
    Object.entries(resultado.ocupacionVuelos as Record<string, number>).forEach(([key, cantidad]) => {
      if (cantidad === 0) return;
      // key: "ORIG-DEST-HH:MM:SS_YYYY-MM-DD"
      const [sinFecha, fechaSalida] = key.split("_");
      if (!fechaSalida) return;
      const partes = sinFecha.split("-");
      if (partes.length < 3) return;
      const uid = `${partes[0]}-${partes[1]}-${partes[2]}_${fechaSalida}`;
      if (vistas.has(uid)) return;
      vistas.add(uid);
      const normHora = (t: string) => { const p = t.split(":"); return `${p[0].padStart(2,"0")}:${(p[1]??"00").padStart(2,"0")}`; };
      const horaSalida = normHora(partes[2]);
      // Buscar horaLlegada desde rutasAsignadas normalizando horas para comparar
      let horaLlegada = "??:??";
      if (resultado.rutasAsignadas) {
        for (const ruta of Object.values(resultado.rutasAsignadas) as any[][]) {
          const v = ruta.find((r: any) => r.origen === partes[0] && r.destino === partes[1] && normHora(r.horaSalida ?? "") === horaSalida);
          if (v) { horaLlegada = normHora(v.horaLlegada ?? "??:??"); break; }
        }
      }
      const estado = clasificarVuelo(fechaSalida, horaSalida, horaLlegada, fechaInicioSim, minutosVirtualesTotales);
      grupos[estado].push({ uid, origen: partes[0], destino: partes[1], horaSalida, horaLlegada, fechaSalida, cantidad });
    });
    // Filtrar por origen/destino
    const fo = filtroOrigen.trim().toUpperCase();
    const fd = filtroDestino.trim().toUpperCase();
    if (fo || fd) {
      for (const key of Object.keys(grupos)) {
        grupos[key] = grupos[key].filter((v: any) =>
          (!fo || v.origen.toUpperCase().includes(fo)) &&
          (!fd || v.destino.toUpperCase().includes(fd))
        );
      }
    }
    return grupos;
  }, [resultado, minutosVirtualesTotales, fechaInicioSim, filtroOrigen, filtroDestino]);

  const tabs = [
    { key: 'vuelo' as const, label: 'En vuelo', color: 'text-tasf-green' },
    { key: 'espera' as const, label: 'En espera', color: 'text-yellow-400' },
    { key: 'completado' as const, label: 'Completados', color: 'text-slate-400' },
  ];

  return (
    <div className="flex-[1.5] min-w-[250px] bg-tasf-dark rounded-xl shadow-lg border border-slate-700 flex flex-col text-white overflow-hidden">
      {/* Filtros */}
      <div className="flex gap-1 px-2 pt-2 pb-1.5">
        <input value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)} placeholder="Origen…"
          className="flex-1 bg-slate-700 text-white text-[10px] rounded px-2 py-1 placeholder-slate-500 outline-none focus:ring-1 focus:ring-tasf-green" />
        <input value={filtroDestino} onChange={e => setFiltroDestino(e.target.value)} placeholder="Destino…"
          className="flex-1 bg-slate-700 text-white text-[10px] rounded px-2 py-1 placeholder-slate-500 outline-none focus:ring-1 focus:ring-tasf-green" />
      </div>
      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex-1 py-2 text-[9px] font-bold uppercase tracking-wider transition-colors ${tab === t.key ? `${t.color} border-b-2 border-current` : 'text-slate-500 hover:text-slate-300'}`}>
            {t.label} ({rutas[t.key].length})
          </button>
        ))}
      </div>
      {/* Lista */}
      <div className="overflow-y-auto flex-1 p-2 space-y-1">
        {rutas[tab].length === 0 ? (
          <p className="text-slate-500 italic text-xs text-center mt-4">Sin rutas</p>
        ) : rutas[tab].map(v => {
          const seleccionado = vueloResaltado === v.uid;
          return (
            <div key={v.uid}
              onClick={() => onSeleccionarRuta(seleccionado ? null : v.uid)}
              className={`flex justify-between items-center text-xs px-2 py-1 rounded cursor-pointer transition-colors ${seleccionado ? 'bg-tasf-green/20 border-l-2 border-tasf-green' : 'hover:bg-slate-800'}`}>
              <span className={`font-bold ${seleccionado ? 'text-tasf-green' : 'text-white'}`}>{v.origen} → {v.destino}</span>
              <span className="text-slate-400 font-mono text-[10px]">{v.horaSalida}–{v.horaLlegada}</span>
              <span className="text-tasf-green font-bold text-[10px]">{v.cantidad} mal.</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ReportePeriodo({ resultado, fechaInicio, dias, onCerrar }: {
  resultado: Solucion; fechaInicio: string; dias: number; onCerrar: () => void;
}) {
  const [pagina, setPagina] = useState(0);
  const [filtroOrigen, setFiltroOrigen] = useState('');
  const [filtroDestino, setFiltroDestino] = useState('');
  const [filtroTipo, setFiltroTipo] = useState<'' | 'directo' | 'escalas' | 'sin-ruta'>('');
  const PAGE_SIZE = 20;

  const envios = useMemo(() => {
    const detalles = resultado.detallesEnvios ?? {};
    const rutasAsignadas = resultado.rutasAsignadas ?? {};
    return Object.entries(detalles).map(([id, detalle]) => {
      const tramos: Vuelo[] = rutasAsignadas[id] ?? [];
      const tieneRuta = tramos.length > 0;
      const paradas = tieneRuta ? [tramos[0].origen, ...tramos.map(v => v.destino)] : [];
      const esDirecto = paradas.length === 2;
      const escalas = Math.max(0, paradas.length - 2);
      return { id, idCliente: detalle.idCliente, origen: detalle.origen, destino: detalle.destino, maletas: detalle.cantidadMaletas, tieneRuta, esDirecto, escalas, rutaStr: tieneRuta ? paradas.join(' → ') : '—' };
    });
  }, [resultado]);

  const kpis = useMemo(() => {
    const total = envios.length;
    const conRuta = envios.filter(e => e.tieneRuta).length;
    const sinRuta = total - conRuta;
    const directos = envios.filter(e => e.tieneRuta && e.esDirecto).length;
    const conEscalas = conRuta - directos;
    const totalMaletas = envios.reduce((s, e) => s + e.maletas, 0);
    const capVuelos = resultado.capacidadesVuelos ?? {};
    let sumPct = 0, countV = 0;
    Object.entries(resultado.ocupacionVuelos ?? {}).forEach(([key, cant]) => {
      if (!cant) return;
      const sf = key.substring(0, key.lastIndexOf('_'));
      const p = sf.split('-');
      const clave = `${p[0]}-${p[1]}-${p.slice(2).join(':')}`;
      const cap = (capVuelos as any)[clave] ?? 350;
      sumPct += (cant / cap) * 100; countV++;
    });
    const pctVuelos = countV > 0 ? Math.round(sumPct / countV) : 0;
    const capAeros = resultado.capacidadesAeropuertos ?? {};
    const ocAeros = resultado.ocupacionAeropuertos ?? {};
    let sumPctA = 0, countA = 0;
    Object.entries(ocAeros).forEach(([cod, oc]) => {
      const cap = capAeros[cod]; if (!cap) return;
      sumPctA += (oc / cap) * 100; countA++;
    });
    const pctAeros = countA > 0 ? Math.round(sumPctA / countA) : 0;
    return { total, conRuta, sinRuta, directos, conEscalas, totalMaletas, pctVuelos, pctAeros };
  }, [envios, resultado]);

  const filtrados = useMemo(() => {
    return envios.filter(e => {
      if (filtroOrigen && !e.origen.toUpperCase().includes(filtroOrigen.toUpperCase())) return false;
      if (filtroDestino && !e.destino.toUpperCase().includes(filtroDestino.toUpperCase())) return false;
      if (filtroTipo === 'directo' && !(e.tieneRuta && e.esDirecto)) return false;
      if (filtroTipo === 'escalas' && !(e.tieneRuta && !e.esDirecto)) return false;
      if (filtroTipo === 'sin-ruta' && e.tieneRuta) return false;
      return true;
    });
  }, [envios, filtroOrigen, filtroDestino, filtroTipo]);

  useEffect(() => { setPagina(0); }, [filtroOrigen, filtroDestino, filtroTipo]);

  const paginaActual = filtrados.slice(pagina * PAGE_SIZE, (pagina + 1) * PAGE_SIZE);
  const totalPaginas = Math.ceil(filtrados.length / PAGE_SIZE);

  const kpiCards: { label: string; value: string | number; color: string }[] = [
    { label: 'Total envíos', value: kpis.total, color: 'text-white' },
    { label: 'Con ruta asignada', value: `${kpis.conRuta} (${kpis.total > 0 ? Math.round(kpis.conRuta / kpis.total * 100) : 0}%)`, color: 'text-tasf-green' },
    { label: 'Sin ruta (no atendidos)', value: kpis.sinRuta, color: kpis.sinRuta > 0 ? 'text-red-400' : 'text-slate-400' },
    { label: 'Total maletas', value: kpis.totalMaletas.toLocaleString(), color: 'text-blue-300' },
    { label: 'Vuelos directos', value: kpis.directos, color: 'text-tasf-green' },
    { label: 'Con escalas', value: kpis.conEscalas, color: 'text-yellow-400' },
    { label: '% Ocupación vuelos (prom.)', value: `${kpis.pctVuelos}%`, color: 'text-slate-300' },
    { label: '% Ocupación almacenes (prom.)', value: `${kpis.pctAeros}%`, color: 'text-slate-300' },
  ];

  return (
    <div className="fixed inset-0 z-[3000] bg-slate-900 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-slate-800 border-b border-slate-700 px-6 py-4 flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-white font-bold text-lg">📊 Reporte — Simulación por Periodo</h1>
          <p className="text-slate-400 text-xs mt-0.5">{dias} días · Inicio: {fechaInicio}</p>
        </div>
        <button onClick={onCerrar} className="text-slate-400 hover:text-white text-2xl leading-none px-2">✕</button>
      </div>

      {/* KPIs */}
      <div className="px-6 py-4 grid grid-cols-4 gap-3 border-b border-slate-700 shrink-0">
        {kpiCards.map(k => (
          <div key={k.label} className="bg-slate-800 rounded-xl p-4 border border-slate-700">
            <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1">{k.label}</p>
            <p className={`text-2xl font-bold font-mono ${k.color}`}>{k.value}</p>
          </div>
        ))}
      </div>

      {/* Filtros + tabla */}
      <div className="flex-1 flex flex-col overflow-hidden px-6 pt-4">
        <div className="flex items-center gap-3 mb-3 shrink-0 flex-wrap">
          <input
            value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}
            placeholder="Origen…"
            className="bg-slate-800 border border-slate-600 text-white text-xs rounded px-3 py-1.5 outline-none focus:border-tasf-green w-28"
          />
          <input
            value={filtroDestino} onChange={e => setFiltroDestino(e.target.value)}
            placeholder="Destino…"
            className="bg-slate-800 border border-slate-600 text-white text-xs rounded px-3 py-1.5 outline-none focus:border-tasf-green w-28"
          />
          {(['', 'directo', 'escalas', 'sin-ruta'] as const).map(t => (
            <button key={t} onClick={() => setFiltroTipo(t)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${filtroTipo === t ? 'bg-tasf-green border-tasf-green text-white' : 'border-slate-600 text-slate-400 hover:text-white hover:border-slate-400'}`}>
              {t === '' ? 'Todos' : t === 'directo' ? '✈ Directo' : t === 'escalas' ? '↗ Escalas' : '✕ Sin ruta'}
            </button>
          ))}
          <span className="text-slate-500 text-xs ml-auto">{filtrados.length} envíos</span>
        </div>

        <div className="flex-1 overflow-auto rounded-xl border border-slate-700">
          <table className="w-full text-xs text-white min-w-[900px]">
            <thead className="sticky top-0 bg-slate-800 text-[10px] uppercase tracking-wider z-10">
              <tr>
                <th className="px-3 py-2.5 text-left text-slate-400">ID Pedido</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Cliente</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Origen</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Destino</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Ruta tomada</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Tipo</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Maletas</th>
                <th className="px-3 py-2.5 text-left text-slate-400">Estado</th>
              </tr>
            </thead>
            <tbody>
              {paginaActual.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-slate-500 py-10 italic">Sin resultados</td></tr>
              ) : paginaActual.map(e => (
                <tr key={e.id} className="border-b border-slate-800 hover:bg-slate-800 transition-colors">
                  <td className="px-3 py-2 font-mono text-[11px] text-tasf-green">{e.id}</td>
                  <td className="px-3 py-2 text-slate-300 font-mono text-[11px]">{e.idCliente}</td>
                  <td className="px-3 py-2 font-bold">{e.origen}</td>
                  <td className="px-3 py-2 font-bold">{e.destino}</td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-200 max-w-[280px] truncate" title={e.rutaStr}>{e.rutaStr}</td>
                  <td className="px-3 py-2">
                    {!e.tieneRuta ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-500/20 text-red-400">Sin ruta</span>
                    ) : e.esDirecto ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-tasf-green/20 text-tasf-green">Directo</span>
                    ) : (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400">{e.escalas} escala{e.escalas !== 1 ? 's' : ''}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`font-bold text-[11px] px-1.5 py-0.5 rounded ${e.maletas >= 100 ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700 text-slate-200'}`}>{e.maletas}</span>
                  </td>
                  <td className="px-3 py-2">
                    {e.tieneRuta
                      ? <span className="text-[10px] text-tasf-green">✓ Asignado</span>
                      : <span className="text-[10px] text-red-400">✕ No atendido</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {totalPaginas > 1 && (
          <div className="flex items-center justify-center gap-3 py-3 shrink-0">
            <button onClick={() => setPagina(p => Math.max(0, p - 1))} disabled={pagina === 0}
              className="text-xs px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600">← Anterior</button>
            <span className="text-xs text-slate-400">{pagina + 1} / {totalPaginas} — {filtrados.length} envíos</span>
            <button onClick={() => setPagina(p => Math.min(totalPaginas - 1, p + 1))} disabled={pagina === totalPaginas - 1}
              className="text-xs px-3 py-1 rounded bg-slate-700 text-slate-300 disabled:opacity-30 hover:bg-slate-600">Siguiente →</button>
          </div>
        )}
      </div>
    </div>
  );
}

function App() {
  const [vistaActiva, setVistaActiva] = useState<Vista>("dia-a-dia");

  const [fechaInicio, setFechaInicio] = useState("2026-01-05");
  const [horaInicio, setHoraInicio] = useState("00:00");
  const [dias, setDias] = useState(5);
  const [fechaFin, setFechaFin] = useState("");
  const [cargando, setCargando] = useState(false);
  const [resultado, setResultado] = useState<Solucion | null>(null);
  const [simulandoEnVivo, setSimulandoEnVivo] = useState(false);
  const [procesandoPrimerBloque, setProcesandoPrimerBloque] = useState(false);
  const [porcentajeSimulacion, setPorcentajeSimulacion] = useState(0);
  const [tiempoTranscurrido, setTiempoTranscurrido] = useState("00:00:00");
  const [ventanaVirtual, setVentanaVirtual] = useState<string | null>(null);
  const [horaVirtualMinutos, setHoraVirtualMinutos] = useState(0);
  const [minutosVirtualesTotales, setMinutosVirtualesTotales] = useState(0);
  const [vueloResaltado, setVueloResaltado] = useState<string | null>(null);
  const [rutaEnvioSeleccionada, setRutaEnvioSeleccionada] = useState<string | null>(null);
  const horaVirtualBaseRef = useRef<{ minutos: number; realMs: number } | null>(null);
  const ultimaVentanaRef = useRef<string | null>(null);
  const ultimoPollRef = useRef<{ minutosTotales: number; realMs: number } | null>(null);
  const fechaInicioRef = useRef(fechaInicio);
  const horaInicioRef = useRef(horaInicio);
  const diasRef = useRef(dias);
  const [horaRealActual, setHoraRealActual] = useState("");
  const [tiempoSimuladoTranscurrido, setTiempoSimuladoTranscurrido] = useState("");
  const [sidebarAbierto, setSidebarAbierto] = useState(true);
  const [panelVuelosAbierto, setPanelVuelosAbierto] = useState(false);
  const [panelEnviosAbierto, setPanelEnviosAbierto] = useState(false);
  const [panelAlmacenesAbierto, setPanelAlmacenesAbierto] = useState(false);
  const [aeropuertoResaltado, setAeropuertoResaltado] = useState<string | null>(null);
  const [aeropuertosFiltrados, setAeropuertosFiltrados] = useState<string[] | null>(null);
  const [vuelosFiltrados, setVuelosFiltrados] = useState<string[] | null>(null);
  const [modoOscuro, setModoOscuro] = useState(true);
  const [mostrarReporte, setMostrarReporte] = useState(false);
  const [vuelosCancelados, setVuelosCancelados] = useState<Set<string>>(new Set());
  const jobIdActivoRef = useRef<string | null>(null);
  const [reporteGuardado, setReporteGuardado] = useState<{ resultado: Solucion; fechaInicio: string; dias: number } | null>(() => {
    try {
      const raw = localStorage.getItem('tasfb2b_ultimo_reporte');
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  });
  const inicioRealRef = useRef<number | null>(null);

  // ── ESTADOS COLAPSO ──
  const [colapsoDetectado, setColapsoDetectado] = useState(false);
  const [motivoColapso, setMotivoColapso] = useState("");
  const [momentoColapso, setMomentoColapso] = useState<string | null>(null);
  const [fechaInicioColapso, setFechaInicioColapso] = useState("2026-01-05");
  const [horaInicioColapso, setHoraInicioColapso] = useState("00:00");
  const jobIdColapsoRef = useRef<string | null>(null);
  const intervalColapsoRef = useRef<number | null>(null);

  // Resultado filtrado: excluye vuelos cancelados del mapa y drawers
  const resultadoFiltrado = useMemo(() => {
    if (!resultado || vuelosCancelados.size === 0) return resultado;
    const ocupacionFiltrada = Object.fromEntries(
      Object.entries(resultado.ocupacionVuelos ?? {}).filter(([key]) => {
        const sinFecha = key.substring(0, key.lastIndexOf('_'));
        const partes = sinFecha.split('-');
        if (partes.length < 3) return true;
        const claveRuta = `${partes[0]}-${partes[1]}-${partes.slice(2).join(':')}`;
        return !vuelosCancelados.has(claveRuta);
      })
    );
    return { ...resultado, ocupacionVuelos: ocupacionFiltrada };
  }, [resultado, vuelosCancelados]);

  // Ocupación en tiempo real por aeropuerto — compartido entre MapArea y DrawerAlmacenes
  const ocupacionAeropuertosRT = useMemo(() => {
    const result: Record<string, number> = {};
    const fechaBase = fechaInicio;
    if (!resultado?.detallesEnvios || !resultado?.rutasAsignadas || !fechaBase) return result;
    const fechasTramos = (resultado as any).fechasTramos ?? {};
    const normH = (t: string) => { const p=(t??"").split(":"); return `${p[0].padStart(2,"0")}:${(p[1]??"00").padStart(2,"0")}:${(p[2]??"00").padStart(2,"0")}`; };
    Object.entries(resultado.detallesEnvios).forEach(([id, detalle]: [string, any]) => {
      const tramos: any[] = resultado.rutasAsignadas[id] ?? [];
      const fechas: string[] = fechasTramos[id] ?? [];
      tramos.forEach((v: any, i: number) => {
        const fechaSalida = fechas[i];
        if (!fechaSalida) return;
        const estado = clasificarVuelo(fechaSalida, normH(v.horaSalida??''), normH(v.horaLlegada??''), fechaBase, minutosVirtualesTotales);
        const esUltimo = i === tramos.length - 1;

        // Tránsito: en espera y tramo anterior ya completó → maletas en v.origen
        if (estado === 'espera') {
          const tramoAnteriorOk = i === 0 || (() => {
            const fa = fechas[i - 1];
            if (!fa) return false;
            return clasificarVuelo(fa, normH(tramos[i-1].horaSalida??''), normH(tramos[i-1].horaLlegada??''), fechaBase, minutosVirtualesTotales) === 'completado';
          })();
          if (tramoAnteriorOk) {
            result[v.origen] = (result[v.origen] ?? 0) + detalle.cantidadMaletas;
          }
        }

        // Destino final: último tramo completado, cliente aún no recogió (< 15 min desde llegada)
        if (estado === 'completado' && esUltimo) {
          const minLleg = minLlegadaDesdeInicio(fechaSalida, normH(v.horaSalida??''), normH(v.horaLlegada??''), fechaInicio);
          if (minutosVirtualesTotales < minLleg + 15) {
            result[v.destino] = (result[v.destino] ?? 0) + detalle.cantidadMaletas;
          }
        }

      });
    });
    return result;
  }, [resultado, minutosVirtualesTotales, fechaInicio]);

  const [archivoAero, setArchivoAero] = useState<File | null>(null);
  const [archivoVuelos, setArchivoVuelos] = useState<File | null>(null);
  const [archivosEnvios, setArchivosEnvios] = useState<File[]>([]);
  const [estadoAero, setEstadoAero] = useState<EstadoCarga>(estadoInicial);
  const [estadoVuelos, setEstadoVuelos] = useState<EstadoCarga>(estadoInicial);
  const [estadoEnvios, setEstadoEnvios] = useState<EstadoCarga>(estadoInicial);

  const inputAeroRef = useRef<HTMLInputElement>(null);
  const inputVuelosRef = useRef<HTMLInputElement>(null);
  const inputEnviosRef = useRef<HTMLInputElement>(null);

  const iniciarPolling = (jobId: string, fechaInicioSim: string) => {
    const intervalo = setInterval(async () => {
      try {
        const estadoJob = await obtenerEstadoSimulacion(jobId);

        setPorcentajeSimulacion(estadoJob.progreso);
        if (estadoJob.ventanaVirtual) {
          setVentanaVirtual(estadoJob.ventanaVirtual);
          const ahora = Date.now();
          if (estadoJob.ventanaVirtual !== ultimaVentanaRef.current) {
            // Nueva ventana: recalcular minutos base desde inicio de simulación
            ultimaVentanaRef.current = estadoJob.ventanaVirtual;
            const partes = estadoJob.ventanaVirtual.split(" → ")[0].split(" ");
            const [h, m] = partes[1].split(":").map(Number);
            const [vy, vm, vd] = partes[0].split("-").map(Number);
            const [iy, im, id] = fechaInicioSim.split("-").map(Number);
            const fechaVentana = new Date(vy, vm - 1, vd);
            const fechaSimInicio = new Date(iy, im - 1, id);
            const diasTranscurridos = Math.floor((fechaVentana.getTime() - fechaSimInicio.getTime()) / (1000 * 60 * 60 * 24));
            const minutosTotales = diasTranscurridos * 1440 + h * 60 + m;
            ultimoPollRef.current = { minutosTotales, realMs: ahora };
          } else if (ultimoPollRef.current) {
            // Misma ventana: solo actualizar realMs para que segsDesdeUltimoPoll no crezca
            ultimoPollRef.current = { ...ultimoPollRef.current, realMs: ahora };
          }
        }

        if (estadoJob.solucionParcial) {
          setProcesandoPrimerBloque(false);
          setResultado((prev) => {
            const nueva = estadoJob.solucionParcial!;
            // Preservar rutas/ocupaciones del paso anterior si el nuevo bloque llega vacío
            return {
              ...nueva,
              rutasAsignadas: { ...(prev?.rutasAsignadas ?? {}), ...(nueva.rutasAsignadas ?? {}) },
              detallesEnvios: { ...(prev?.detallesEnvios ?? {}), ...(nueva.detallesEnvios ?? {}) },
              fechasTramos: { ...(prev?.fechasTramos ?? {}), ...(nueva.fechasTramos ?? {}) },
              ocupacionVuelos: Object.keys(nueva.ocupacionVuelos ?? {}).length > 0
                ? nueva.ocupacionVuelos
                : (prev?.ocupacionVuelos ?? {}),
              ocupacionAeropuertos: Object.keys(nueva.ocupacionAeropuertos ?? {}).length > 0
                ? nueva.ocupacionAeropuertos
                : (prev?.ocupacionAeropuertos ?? {}),
            };
          });
        }

        if (estadoJob.estado === "COMPLETADO" || estadoJob.estado === "ERROR") {
          clearInterval(intervalo);
          setSimulandoEnVivo(false);
          localStorage.removeItem("jobIdActivo");

          if (estadoJob.estado === "COMPLETADO") {
            setResultado(prev => {
              if (prev) {
                const entrada = { resultado: prev, fechaInicio: fechaInicioRef.current, dias: diasRef.current };
                try { localStorage.setItem('tasfb2b_ultimo_reporte', JSON.stringify(entrada)); } catch {}
                setReporteGuardado(entrada);
              }
              return prev;
            });
          }

          if (estadoJob.estado === "ERROR") {
            alert("Error en la simulación: " + estadoJob.mensaje);
          }
        }
      } catch (err) {
        console.error("Error al consultar el estado del Job:", err);
        clearInterval(intervalo);
        setSimulandoEnVivo(false);
        localStorage.removeItem("jobIdActivo");
        localStorage.removeItem("inicioSimulacionTimestamp");
      }
    }, 15000);
  };

  // Cronómetro local: avanza cada segundo mientras la simulación está en curso
  useEffect(() => {
    if (!simulandoEnVivo) return;

    // Reloj virtual: actualiza cada 250ms → posiciones de aviones fluidas
    const esColapso = vistaActiva === "colapso";
    const intervaloVirtual = setInterval(() => {
      const ahora = Date.now();
      let minVirtuales: number;
      if (esColapso && ultimoPollRef.current) {
        // En colapso: avanzar desde el último bloque recibido
        const segsDesdeUltimoPoll = (ahora - ultimoPollRef.current.realMs) / 1000;
        minVirtuales = ultimoPollRef.current.minutosTotales + segsDesdeUltimoPoll * 2;
      } else {
        if (!inicioRealRef.current) return;
        const segsDesdeInicio = (ahora - inicioRealRef.current) / 1000;
        const [hh, mm] = horaInicioRef.current.split(":").map(Number);
        const offsetHora = (hh || 0) * 60 + (mm || 0);
        minVirtuales = offsetHora + Math.min(segsDesdeInicio * 2, diasRef.current * 1440);
      }
      setMinutosVirtualesTotales(minVirtuales);
      setHoraVirtualMinutos(minVirtuales % 1440);

      const fechaBase = esColapso ? fechaInicioColapso : fechaInicioRef.current;
      const [fy, fm, fd] = fechaBase.split("-").map(Number);
      const fechaSimVirtual = new Date(fy, fm - 1, fd);
      fechaSimVirtual.setMinutes(fechaSimVirtual.getMinutes() + minVirtuales);
      setTiempoSimuladoTranscurrido(
        `${fechaSimVirtual.getFullYear()}-${String(fechaSimVirtual.getMonth()+1).padStart(2,"0")}-${String(fechaSimVirtual.getDate()).padStart(2,"0")} ` +
        `${String(fechaSimVirtual.getHours()).padStart(2,"0")}:${String(fechaSimVirtual.getMinutes()).padStart(2,"0")}:${String(fechaSimVirtual.getSeconds()).padStart(2,"0")}`
      );
    }, 250);

    // Reloj real: actualiza cada segundo (menos crítico)
    const intervaloReal = setInterval(() => {
      const ahora = Date.now();
      if (inicioRealRef.current) {
        setTiempoTranscurrido(formatearDuracion(ahora - inicioRealRef.current));
      }
      const now = new Date();
      setHoraRealActual(
        `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")} ` +
        `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}:${String(now.getSeconds()).padStart(2,"0")}`
      );
    }, 1000);

    return () => { clearInterval(intervaloVirtual); clearInterval(intervaloReal); };
  }, [simulandoEnVivo, vistaActiva, fechaInicioColapso]);

  useEffect(() => { fechaInicioRef.current = fechaInicio; }, [fechaInicio]);
  useEffect(() => { horaInicioRef.current = horaInicio; }, [horaInicio]);
  useEffect(() => { diasRef.current = dias; }, [dias]);

  useEffect(() => {
    if (vistaActiva === "mapa" || vistaActiva === "dia-a-dia" || vistaActiva === "colapso") {
      const timer = setTimeout(() => {
        window.dispatchEvent(new Event("resize"));
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [vistaActiva]);

  useEffect(() => {
    if (fechaInicio && horaInicio) {
      const inicio = new Date(`${fechaInicio}T${horaInicio}`);
      const fin = new Date(inicio.getTime());
      fin.setDate(fin.getDate() + dias);
      const fechaParte = `${fin.getFullYear()}-${String(fin.getMonth()+1).padStart(2,"0")}-${String(fin.getDate()).padStart(2,"0")}`;
      const horaParte = `${String(fin.getHours()).padStart(2,"0")}:${String(fin.getMinutes()).padStart(2,"0")}`;
      setFechaFin(`${fechaParte} ${horaParte}`);
    }
  }, [fechaInicio, horaInicio, dias]);

  useEffect(() => {
    const jobGuardado = localStorage.getItem("jobIdActivo");
    if (jobGuardado) {
      const f = localStorage.getItem("fechaActiva");
      const h = localStorage.getItem("horaActiva");
      const d = localStorage.getItem("diasActivos");
      const inicioGuardado = localStorage.getItem("inicioSimulacionTimestamp");
      if (f) setFechaInicio(f);
      if (h) setHoraInicio(h);
      if (d) setDias(Number(d));

      inicioRealRef.current = inicioGuardado ? Number(inicioGuardado) : Date.now();
      setSimulandoEnVivo(true);
      iniciarPolling(jobGuardado, f ?? fechaInicio);
    }
  }, []);

  const detectarColapso = (sol: Solucion | null): { colapsado: boolean; motivo: string } => {
    if (!sol) return { colapsado: false, motivo: "" };
    for (const [cod, ocup] of Object.entries(sol.ocupacionAeropuertos ?? {})) {
      const cap = sol.capacidadesAeropuertos?.[cod];
      if (cap && ocup > cap) return { colapsado: true, motivo: `Capacidad superada en aeropuerto ${cod}` };
    }
    for (const [ruta, ocup] of Object.entries(sol.ocupacionVuelos ?? {})) {
      const cap = sol.capacidadesVuelos?.[ruta];
      if (cap && ocup > cap) return { colapsado: true, motivo: `Capacidad superada en vuelo ${ruta}` };
    }
    if (typeof sol.tasaExito === "number" && sol.tasaExito < 5)
      return { colapsado: true, motivo: `Tasa de éxito cayó a ${sol.tasaExito.toFixed(1)}% (umbral: 5%)` };
    return { colapsado: false, motivo: "" };
  };

  const handleSimularColapso = async () => {
    if (intervalColapsoRef.current !== null) { clearInterval(intervalColapsoRef.current); intervalColapsoRef.current = null; }
    setResultado(null);
    setSimulandoEnVivo(false);
    setPorcentajeSimulacion(0);
    setVentanaVirtual(null);
    setMinutosVirtualesTotales(0);
    setHoraVirtualMinutos(0);
    setTiempoSimuladoTranscurrido("");
    setColapsoDetectado(false);
    setMotivoColapso("");
    setMomentoColapso(null);
    horaVirtualBaseRef.current = null;
    ultimoPollRef.current = null;
    ultimaVentanaRef.current = null;
    setCargando(true);

    try {
      const fechaInicioSimStr = `${fechaInicioColapso}T${horaInicioColapso}:00`;
      const { jobId } = await iniciarSimulacionPeriodo(fechaInicioSimStr, 365);
      jobIdColapsoRef.current = jobId;
      inicioRealRef.current = Date.now();
      setCargando(false);
      setSimulandoEnVivo(true);
      setProcesandoPrimerBloque(true);

      const fechaInicioSimDate = new Date(fechaInicioSimStr);
      let completado = false;

      const consultar = async () => {
        if (completado) return;
        try {
          const estadoJob = await obtenerEstadoSimulacion(jobId);
          setPorcentajeSimulacion(estadoJob.progreso);

          // Actualizar reloj virtual desde ventanaVirtual
          if (estadoJob.ventanaVirtual && estadoJob.ventanaVirtual !== ultimaVentanaRef.current) {
            ultimaVentanaRef.current = estadoJob.ventanaVirtual;
            const fin = estadoJob.ventanaVirtual.split(" → ")[1]?.trim();
            if (fin) {
              const [fechaFin, horaFin] = fin.split(" ");
              const [vy, vm, vd] = fechaFin.split("-").map(Number);
              const [hh, mm] = horaFin.split(":").map(Number);
              const diasOff = Math.floor((new Date(vy, vm-1, vd).getTime() - new Date(fechaInicioColapso).getTime()) / 86400000);
              const min = diasOff * 1440 + hh * 60 + mm;
              ultimoPollRef.current = { minutosTotales: min, realMs: Date.now() };
            }
          }

          if (estadoJob.solucionParcial) {
            setProcesandoPrimerBloque(false);
            setResultado(prev => {
              const nueva = estadoJob.solucionParcial!;
              const merged = {
                ...nueva,
                rutasAsignadas: { ...(prev?.rutasAsignadas ?? {}), ...(nueva.rutasAsignadas ?? {}) },
                detallesEnvios: { ...(prev?.detallesEnvios ?? {}), ...(nueva.detallesEnvios ?? {}) },
                fechasTramos: { ...(prev?.fechasTramos ?? {}), ...(nueva.fechasTramos ?? {}) },
                ocupacionVuelos: Object.keys(nueva.ocupacionVuelos ?? {}).length > 0 ? nueva.ocupacionVuelos : (prev?.ocupacionVuelos ?? {}),
                ocupacionAeropuertos: Object.keys(nueva.ocupacionAeropuertos ?? {}).length > 0 ? nueva.ocupacionAeropuertos : (prev?.ocupacionAeropuertos ?? {}),
              };
              // Detectar colapso
              const deteccion = detectarColapso(merged);
              if (deteccion.colapsado && !completado) {
                completado = true;
                clearInterval(intervalColapsoRef.current!);
                intervalColapsoRef.current = null;
                setColapsoDetectado(true);
                setMotivoColapso(deteccion.motivo);
                const minSim = ultimoPollRef.current?.minutosTotales ?? 0;
                const fechaColapsoReal = new Date(fechaInicioSimDate.getTime() + minSim * 60000);
                const fmt = (d: Date) => d.toLocaleDateString("es-PE", { day:"2-digit", month:"2-digit", year:"numeric" })
                  + " " + d.toLocaleTimeString("es-PE", { hour12:false, hour:"2-digit", minute:"2-digit" });
                setMomentoColapso(fmt(fechaColapsoReal));
                setSimulandoEnVivo(false);
                detenerSimulacion(jobId).catch(() => {});
              }
              return merged;
            });
          }

          if (!completado && (estadoJob.estado === "COMPLETADO" || estadoJob.estado === "ERROR")) {
            completado = true;
            clearInterval(intervalColapsoRef.current!);
            intervalColapsoRef.current = null;
            setSimulandoEnVivo(false);
          }
        } catch { completado = true; clearInterval(intervalColapsoRef.current!); intervalColapsoRef.current = null; setSimulandoEnVivo(false); }
      };

      await consultar();
      intervalColapsoRef.current = window.setInterval(consultar, 1500);
    } catch (error: any) {
      alert(`Error: ${error?.message ?? "No se pudo iniciar."}`);
      setCargando(false);
    }
  };

  const handleSimular = async () => {
    setCargando(true);
    setResultado(null);
    setSimulandoEnVivo(false);
    setPorcentajeSimulacion(0);
    setTiempoTranscurrido("00:00:00");
    setVentanaVirtual(null);
    setMinutosVirtualesTotales(0);
    setHoraVirtualMinutos(0);
    setTiempoSimuladoTranscurrido("");
    horaVirtualBaseRef.current = null;
    ultimoPollRef.current = null;
    ultimaVentanaRef.current = null;

    try {
      const { jobId } = await iniciarSimulacionPeriodo(
        `${fechaInicio}T${horaInicio}:00`,
        dias,
      );

      const inicioReal = Date.now();
      inicioRealRef.current = inicioReal;

      localStorage.setItem("jobIdActivo", jobId);
      localStorage.setItem("fechaActiva", fechaInicio);
      localStorage.setItem("horaActiva", horaInicio);
      localStorage.setItem("diasActivos", dias.toString());
      localStorage.setItem("inicioSimulacionTimestamp", inicioReal.toString());

      jobIdActivoRef.current = jobId;
      setVuelosCancelados(new Set());
      setCargando(false);
      setSimulandoEnVivo(true);
      setProcesandoPrimerBloque(true);

      iniciarPolling(jobId, fechaInicio);
    } catch (error: any) {
      const msg =
        error?.response?.data?.message ??
        error?.response?.data ??
        error?.message ??
        "No se pudo iniciar la simulación.";
      alert(`Error: ${msg}`);
      setCargando(false);
    }
  };

  const handleCargarAero = async () => {
    if (!archivoAero) return;
    setEstadoAero({ cargando: true, mensaje: "", error: false });
    try {
      const res = await cargarAeropuertos(archivoAero);
      setEstadoAero({
        cargando: false,
        mensaje: `${res.registros} aeropuertos cargados`,
        error: false,
      });
    } catch {
      setEstadoAero({
        cargando: false,
        mensaje: "Error al cargar el archivo",
        error: true,
      });
    }
  };

  const handleCargarVuelos = async () => {
    if (!archivoVuelos) return;
    setEstadoVuelos({ cargando: true, mensaje: "", error: false });
    try {
      const res = await cargarVuelos(archivoVuelos);
      setEstadoVuelos({
        cargando: false,
        mensaje: `${res.registros} vuelos cargados`,
        error: false,
      });
    } catch {
      setEstadoVuelos({
        cargando: false,
        mensaje: "Error al cargar el archivo",
        error: true,
      });
    }
  };

  const handleCargarEnvios = async () => {
    if (archivosEnvios.length === 0) return;
    setEstadoEnvios({ cargando: true, mensaje: "", error: false });
    try {
      const res = await cargarEnvios(archivosEnvios);
      setEstadoEnvios({
        cargando: false,
        mensaje: `${res.registros} pedidos cargados`,
        error: false,
      });
    } catch {
      setEstadoEnvios({
        cargando: false,
        mensaje: "Error al cargar los archivos",
        error: true,
      });
    }
  };

  const nombreArchivos = (files: File[]) => {
    if (files.length === 0) return "No se eligió ningún archivo";
    if (files.length === 1) return files[0].name;
    return `${files.length} archivos seleccionados`;
  };

  // Función de apoyo para embellecer los vuelos
  const formatearVuelo = (idVuelo: string) => {
    const baseId = idVuelo.split("_")[0];
    const partes = baseId.split("-");
    if (partes.length >= 3) {
      return (
        <div className="flex flex-col">
          <span className="font-bold text-tasf-dark tracking-wide text-xs">
            {partes[0]} <span className="text-tasf-green px-1">✈️</span>{" "}
            {partes[1]}
          </span>
          <span className="text-[9px] text-slate-400 font-medium">
            SALIDA: {partes[2]}
          </span>
        </div>
      );
    }
    return <span className="font-mono text-slate-600 text-xs">{baseId}</span>;
  };

  return (
    <div className="flex flex-col h-screen w-full bg-tasf-gray overflow-hidden font-sans">
      {/* ── BARRA DE NAVEGACIÓN SUPERIOR (TOP NAVBAR) ── */}
      <header className="bg-tasf-dark text-white flex items-center justify-between px-6 py-4 shadow-md z-40">
        <div className="flex items-center gap-3">
          <Plane className="text-tasf-green" size={28} />
          <h1 className="text-xl font-bold tracking-wider">Tasf.B2B</h1>
        </div>

        <nav className="flex gap-2 items-center">
          <button
            onClick={() => setVistaActiva("dia-a-dia")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${vistaActiva === "dia-a-dia" ? "bg-tasf-green text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <Activity size={18} /> Monitoreo en Vivo
          </button>
          <button
            onClick={() => setVistaActiva("mapa")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${vistaActiva === "mapa" ? "bg-tasf-green text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <Calendar size={18} /> Simulación por periodo
          </button>
          <button
            onClick={() => setVistaActiva("colapso")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${vistaActiva === "colapso" ? "bg-tasf-green text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <OctagonAlert size={18}/> Simulación hasta colapso
          </button>
          <button
            onClick={() => setVistaActiva("cargar")}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${vistaActiva === "cargar" ? "bg-tasf-green text-white" : "text-slate-400 hover:bg-slate-800 hover:text-white"}`}
          >
            <FileText size={18} /> Carga de Datos
          </button>
          {reporteGuardado && (
            <button
              onClick={() => setMostrarReporte(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors text-slate-400 hover:bg-slate-800 hover:text-white"
              title="Ver último reporte guardado"
            >
              <FileText size={18} /> Último reporte
            </button>
          )}
          <button
            onClick={() => setModoOscuro(!modoOscuro)}
            className="ml-2 px-3 py-2 rounded-lg text-sm transition-colors text-slate-400 hover:bg-slate-800 hover:text-white"
            title={modoOscuro ? "Cambiar a mapa claro" : "Cambiar a mapa oscuro"}
          >
            {modoOscuro ? "☀️" : "🌙"}
          </button>
        </nav>
      </header>

      {/* ── ÁREA PRINCIPAL ── */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* VISTA 1: Simulación Día a Día */}
        <div
          className={`w-full h-full ${vistaActiva === "dia-a-dia" ? "block" : "hidden"}`}
        >
          <SimulacionDiariaPage modoOscuro={modoOscuro} onRegistrar={() => setVistaActiva("registro-pedido")} />
        </div>

        {/* VISTA: Registro de Pedido */}
        {vistaActiva === "registro-pedido" && (
          <div className="w-full h-full overflow-auto">
            <RegistroPedidoPage onVolver={() => setVistaActiva("dia-a-dia")} />
          </div>
        )}

        {/* VISTA 2: Análisis Predictivo */}
        <div
          className={`w-full h-full flex ${vistaActiva === "mapa" ? "flex" : "hidden"}`}
        >
          <aside className={`relative ${sidebarAbierto ? "w-80" : "w-0"} bg-slate-900 text-white flex flex-col shadow-xl z-30 transition-all duration-300 overflow-visible`}>
            {/* Pestaña en el borde derecho */}
            <button
              onClick={() => setSidebarAbierto(!sidebarAbierto)}
              className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-14 bg-slate-800 border border-slate-600 border-l-0 rounded-r-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors z-40 shadow-md"
              title={sidebarAbierto ? "Colapsar panel" : "Expandir panel"}
            >
              <span className="text-[10px]">{sidebarAbierto ? "◀" : "▶"}</span>
            </button>
            <div className={`p-6 flex-1 overflow-y-auto ${sidebarAbierto ? "block" : "hidden"}`}>
              <h2 className="text-xs uppercase text-slate-400 font-semibold mb-6 tracking-widest">
                Parámetros de Simulación
              </h2>

              <div className="space-y-6">
                <div className="flex flex-col">
                  <label className="text-sm text-slate-300 mb-2">
                    1. ESCENARIO
                  </label>
                  <select
                    className="bg-white text-tasf-dark p-2 rounded focus:ring-2 focus:ring-tasf-green outline-none"
                    value={dias}
                    onChange={(e) => setDias(Number(e.target.value))}
                    disabled={cargando || simulandoEnVivo}
                  >
                    <option value={3}>Periodo: 3 días</option>
                    <option value={5}>Periodo: 5 días</option>
                    <option value={7}>Periodo: 7 días</option>
                  </select>
                </div>

                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-slate-300">
                    2. FECHA Y HORA DE INICIO
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="date"
                      className="flex-1 bg-white text-tasf-dark p-2 rounded text-sm outline-none"
                      value={fechaInicio}
                      onChange={(e) => setFechaInicio(e.target.value)}
                      disabled={cargando || simulandoEnVivo}
                    />
                    <input
                      type="time"
                      className="w-24 bg-white text-tasf-dark p-2 rounded text-sm outline-none"
                      value={horaInicio}
                      onChange={(e) => setHoraInicio(e.target.value)}
                      disabled={cargando || simulandoEnVivo}
                    />
                  </div>
                </div>

                <div className="flex flex-col">
                  <label className="text-sm text-slate-300 mb-2">
                    3. FECHA Y HORA FIN
                  </label>
                  <div className="bg-slate-800 text-tasf-green p-3 rounded text-center font-mono font-bold border border-slate-700">
                    {fechaFin || "Calculando..."}
                  </div>
                </div>

                <button
                  onClick={handleSimular}
                  disabled={cargando || simulandoEnVivo}
                  className="w-full bg-tasf-green hover:bg-green-600 disabled:bg-slate-600 text-white font-bold py-3 rounded transition-colors mt-4 shadow-lg flex justify-center items-center gap-2"
                >
                  {cargando ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />{" "}
                      CALCULANDO...
                    </>
                  ) : simulandoEnVivo ? (
                    <>
                      <Loader2 className="animate-spin" size={20} />{" "}
                      SIMULANDO...
                    </>
                  ) : (
                    "INICIAR SIMULACIÓN"
                  )}
                </button>


              </div>
            </div>
          </aside>

          <main className="flex-1 flex flex-col relative z-10 overflow-hidden">
            {/* Barra superior de paneles */}
            {(resultado || (porcentajeSimulacion > 0 && porcentajeSimulacion <= 100)) && (
              <div className="bg-slate-900 border-b border-slate-700 px-3 py-1.5 flex gap-2 items-center shrink-0 z-[1000]">
                <button
                  onClick={() => { setPanelAlmacenesAbierto(v => !v); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelAlmacenesAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}
                >
                  🏭 Almacenes {panelAlmacenesAbierto ? '▶' : '◀'}
                </button>
                <button
                  onClick={() => { setPanelEnviosAbierto(v => !v); setPanelVuelosAbierto(false); setPanelAlmacenesAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelEnviosAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}
                >
                  📦 Envíos {panelEnviosAbierto ? '▶' : '◀'}
                </button>
                <button
                  onClick={() => { setPanelVuelosAbierto(v => !v); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelVuelosAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}
                >
                  ✈ Vuelos activos {panelVuelosAbierto ? '▶' : '◀'}
                </button>

                {(simulandoEnVivo || (!simulandoEnVivo && porcentajeSimulacion > 0 && porcentajeSimulacion <= 100)) && (() => {
                  const pct = Math.min(100, Math.round(porcentajeSimulacion));
                  const completado = pct >= 100;
                  return (
                    <div className="ml-auto flex items-center gap-2 min-w-[160px]">
                      <span className="text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${completado ? 'bg-tasf-green' : 'bg-tasf-green animate-pulse'}`} />
                        Progreso
                      </span>
                      <div className="flex-1 bg-slate-700 rounded-full h-2 overflow-hidden">
                        <div className="h-2 rounded-full bg-tasf-green transition-all duration-700 ease-out" style={{ width: `${pct}%` }} />
                      </div>
                      <span className={`text-xs font-bold font-mono w-9 text-right ${completado ? 'text-tasf-green' : 'text-white'}`}>{pct}%</span>
                    </div>
                  );
                })()}
              </div>
            )}
            <div className="flex-1 bg-slate-200 relative">
              {/* Widget flotante de tiempos */}
              {simulandoEnVivo && (
                <WidgetTiempos
                  horaRealActual={horaRealActual}
                  tiempoTranscurrido={tiempoTranscurrido}
                  tiempoSimuladoTranscurrido={tiempoSimuladoTranscurrido}
                  minutosVirtualesTotales={minutosVirtualesTotales}
                  horaInicio={horaInicio}
                />
              )}
              <MapArea solucion={resultadoFiltrado} progreso={porcentajeSimulacion} modoOscuro={modoOscuro} horaVirtualMinutos={horaVirtualMinutos} minutosVirtualesTotales={minutosVirtualesTotales} fechaInicioSim={fechaInicio} vueloResaltado={vistaActiva === "mapa" ? vueloResaltado : null} onVueloResaltadoClear={() => setVueloResaltado(null)} aeropuertoResaltado={vistaActiva === "mapa" ? aeropuertoResaltado : null} ocupacionAeropuertosRT={ocupacionAeropuertosRT} onAeropuertoClick={(cod) => { setAeropuertoResaltado(cod); setPanelAlmacenesAbierto(true); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }}
                onVueloClick={(key) => { setVueloResaltado(key); setPanelVuelosAbierto(true); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                aeropuertosFiltrados={vistaActiva === "mapa" && panelAlmacenesAbierto ? aeropuertosFiltrados : null}
                vuelosFiltrados={vistaActiva === "mapa" && panelVuelosAbierto ? vuelosFiltrados : null} />


              {/* Overlay procesando primer bloque */}
              {procesandoPrimerBloque && (
                <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center backdrop-blur-sm bg-slate-900/70">
                  <div className="bg-slate-800 border border-slate-600 rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
                    <div className="w-10 h-10 border-4 border-tasf-green border-t-transparent rounded-full animate-spin" />
                    <p className="text-white font-bold text-lg">Procesando simulación</p>
                    <p className="text-slate-400 text-sm">Ejecutando Tabu Search del primer bloque...</p>
                    <p className="text-slate-500 text-xs">Esto puede tomar unos segundos</p>
                  </div>
                </div>
              )}


              {/* Drawer lateral de almacenes */}
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelAlmacenesAbierto ? 'w-[780px]' : 'w-0 overflow-hidden'}`}>
                {panelAlmacenesAbierto && vistaActiva === "mapa" && (
                  <DrawerAlmacenes
                    resultado={resultadoFiltrado}
                    minutosVirtualesTotales={minutosVirtualesTotales}
                    fechaInicioSim={fechaInicio}
                    onCerrar={() => { setPanelAlmacenesAbierto(false); setAeropuertosFiltrados(null); }}
                    onSeleccionarAeropuerto={setAeropuertoResaltado}
                    ocupacionAeropuertosRT={ocupacionAeropuertosRT}
                    aeropuertoExpandir={aeropuertoResaltado}
                    onFiltrados={setAeropuertosFiltrados}
                  />
                )}
              </div>

              {/* Drawer lateral de envíos */}
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelEnviosAbierto ? 'w-[620px]' : 'w-0 overflow-hidden'}`}>
                {panelEnviosAbierto && vistaActiva === "mapa" && (
                  <DrawerEnvios
                    resultado={resultadoFiltrado}
                    minutosVirtualesTotales={minutosVirtualesTotales}
                    fechaInicioSim={fechaInicio}
                    onCerrar={() => setPanelEnviosAbierto(false)}
                    onEnfocarVuelo={(key) => { setVueloResaltado(key); }}
                    onEnfocarAlmacen={(cod) => { setAeropuertoResaltado(cod); }}
                    onVerVuelo={(key) => { setRutaEnvioSeleccionada(null); setVueloResaltado(key); setPanelVuelosAbierto(true); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                    onVerAlmacen={(cod) => { setAeropuertoResaltado(cod); setPanelAlmacenesAbierto(true); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }}
                  />
                )}
              </div>

              {/* Drawer lateral de vuelos activos */}
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelVuelosAbierto ? "w-[820px]" : "w-0 overflow-hidden"}`}>
                {panelVuelosAbierto && vistaActiva === "mapa" && (
                  <DrawerVuelos
                    resultado={resultadoFiltrado}
                    minutosVirtualesTotales={minutosVirtualesTotales}
                    fechaInicio={fechaInicio}
                    onSeleccionar={(key) => { setVueloResaltado(key); }}
                    onCerrar={() => { setPanelVuelosAbierto(false); setVuelosFiltrados(null); }}
                    vueloExpandir={vueloResaltado}
                    onFiltrados={setVuelosFiltrados}
                    vuelosCancelados={vuelosCancelados}
                    onCancelarVuelo={simulandoEnVivo && jobIdActivoRef.current ? async (claveVuelo) => {
                      if (!confirm(`¿Cancelar vuelo ${claveVuelo}? Los pedidos asignados a este vuelo serán reprogramados en el siguiente bloque.`)) return;
                      try {
                        await cancelarVuelo(jobIdActivoRef.current!, claveVuelo);
                        setVuelosCancelados(prev => new Set([...prev, claveVuelo]));
                      } catch {
                        alert('No se pudo cancelar el vuelo.');
                      }
                    } : undefined}
                  />
                )}
              </div>
            </div>

            {!simulandoEnVivo && porcentajeSimulacion === 100 && (
              <div className="w-full bg-tasf-green text-white flex items-center justify-center gap-4 py-2 shadow-md z-20">
                <span className="font-bold tracking-widest uppercase text-sm">SIMULACIÓN TERMINADA</span>
                {resultado && (
                  <button
                    onClick={() => setMostrarReporte(true)}
                    className="bg-white text-tasf-green font-bold text-xs px-4 py-1 rounded-lg hover:bg-green-50 transition-colors"
                  >
                    📊 Ver Reporte
                  </button>
                )}
              </div>
            )}

          </main>
        </div>

        {/* VISTA 3: Simulación hasta colapso */}
        <div className={`w-full h-full flex ${vistaActiva === "colapso" ? "flex" : "hidden"}`}>
          {/* Sidebar colapso */}
          <aside className={`relative ${sidebarAbierto ? "w-80" : "w-0"} bg-slate-900 text-white flex flex-col shadow-xl z-30 transition-all duration-300 overflow-visible`}>
            <button onClick={() => setSidebarAbierto(!sidebarAbierto)}
              className="absolute -right-6 top-1/2 -translate-y-1/2 w-6 h-14 bg-slate-800 border border-slate-600 border-l-0 rounded-r-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700 transition-colors z-40 shadow-md">
              <span className="text-[10px]">{sidebarAbierto ? "◀" : "▶"}</span>
            </button>
            <div className={`p-6 flex-1 overflow-y-auto ${sidebarAbierto ? "block" : "hidden"}`}>
              <div className="flex items-center gap-2 mb-6">
                <OctagonAlert className="text-orange-400" size={18} />
                <h2 className="text-xs uppercase text-orange-400 font-semibold tracking-widest">Hasta el Colapso</h2>
              </div>
              <div className="space-y-6">
                <div className="flex flex-col space-y-2">
                  <label className="text-sm text-slate-300">FECHA Y HORA DE INICIO</label>
                  <div className="flex gap-2">
                    <input type="date" className="flex-1 bg-white text-tasf-dark p-2 rounded text-sm outline-none"
                      value={fechaInicioColapso} onChange={e => setFechaInicioColapso(e.target.value)}
                      disabled={cargando || simulandoEnVivo} />
                    <input type="time" className="w-24 bg-white text-tasf-dark p-2 rounded text-sm outline-none"
                      value={horaInicioColapso} onChange={e => setHoraInicioColapso(e.target.value)}
                      disabled={cargando || simulandoEnVivo} />
                  </div>
                </div>
                <div className="rounded-lg border border-orange-500/30 bg-orange-500/10 p-3 text-xs text-orange-200">
                  Sin fecha fin — la simulación corre hasta detectar colapso logístico.
                </div>
                <button onClick={handleSimularColapso} disabled={cargando || simulandoEnVivo}
                  className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-slate-600 text-white font-bold py-3 rounded transition-colors mt-2 shadow-lg flex justify-center items-center gap-2">
                  {cargando ? <><Loader2 className="animate-spin" size={20}/> CALCULANDO...</>
                    : simulandoEnVivo ? <><Loader2 className="animate-spin" size={20}/> SIMULANDO...</>
                    : "INICIAR HASTA COLAPSO"}
                </button>
                {/* Estado colapso */}
                {colapsoDetectado && (
                  <div className="rounded-xl border border-orange-500 bg-orange-950/40 p-4 space-y-2">
                    <p className="text-orange-400 font-bold text-sm flex items-center gap-2">
                      <OctagonAlert size={16}/> Colapso detectado
                    </p>
                    <p className="text-orange-200 text-xs">{motivoColapso}</p>
                    {momentoColapso && <p className="text-slate-400 text-xs">Momento: <span className="text-white font-mono">{momentoColapso}</span></p>}
                  </div>
                )}
                {simulandoEnVivo && !colapsoDetectado && (
                  <div className="rounded-lg border border-slate-700 bg-slate-800 p-3 space-y-2">
                    <p className="text-xs text-slate-400 uppercase tracking-widest">Estado</p>
                    <p className="text-xs text-slate-200">{ventanaVirtual ?? "Procesando..."}</p>
                    <div className="flex items-center gap-2 text-xs text-slate-400">
                      <Loader2 className="animate-spin" size={12}/>
                      <span>{Math.floor(minutosVirtualesTotales / 1440)} días simulados</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>

          {/* Mismo main que período */}
          <main className="flex-1 flex flex-col relative z-10 overflow-hidden">
            {(resultado || (porcentajeSimulacion > 0)) && (
              <div className="bg-slate-900 border-b border-slate-700 px-3 py-1.5 flex gap-2 items-center shrink-0 z-[1000]">
                <button onClick={() => { setPanelAlmacenesAbierto(v => !v); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelAlmacenesAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}>
                  🏭 Almacenes {panelAlmacenesAbierto ? '▶' : '◀'}
                </button>
                <button onClick={() => { setPanelEnviosAbierto(v => !v); setPanelVuelosAbierto(false); setPanelAlmacenesAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelEnviosAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}>
                  📦 Envíos {panelEnviosAbierto ? '▶' : '◀'}
                </button>
                <button onClick={() => { setPanelVuelosAbierto(v => !v); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                  className={`text-xs font-bold px-3 py-1.5 rounded-lg border flex items-center gap-2 transition-colors ${panelVuelosAbierto ? 'bg-slate-700 border-slate-500 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-600'}`}>
                  ✈ Vuelos activos {panelVuelosAbierto ? '▶' : '◀'}
                </button>
                {simulandoEnVivo && (
                  <div className="ml-auto flex items-center gap-2 text-xs text-slate-400">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
                    <span>{Math.floor(minutosVirtualesTotales / 1440)} días simulados</span>
                  </div>
                )}
              </div>
            )}
            <div className="flex-1 bg-slate-200 relative">
              {simulandoEnVivo && (
                <WidgetTiempos horaRealActual={horaRealActual} tiempoTranscurrido={tiempoTranscurrido}
                  tiempoSimuladoTranscurrido={tiempoSimuladoTranscurrido}
                  minutosVirtualesTotales={minutosVirtualesTotales} horaInicio={horaInicioColapso} />
              )}
              <MapArea solucion={resultadoFiltrado} progreso={porcentajeSimulacion} modoOscuro={modoOscuro}
                horaVirtualMinutos={horaVirtualMinutos} minutosVirtualesTotales={minutosVirtualesTotales}
                fechaInicioSim={fechaInicioColapso} vueloResaltado={vistaActiva === "colapso" ? vueloResaltado : null}
                onVueloResaltadoClear={() => setVueloResaltado(null)}
                aeropuertoResaltado={vistaActiva === "colapso" ? aeropuertoResaltado : null} ocupacionAeropuertosRT={ocupacionAeropuertosRT}
                onAeropuertoClick={cod => { setAeropuertoResaltado(cod); setPanelAlmacenesAbierto(true); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }}
                onVueloClick={key => { setVueloResaltado(key); setPanelVuelosAbierto(true); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                aeropuertosFiltrados={vistaActiva === "colapso" && panelAlmacenesAbierto ? aeropuertosFiltrados : null}
                vuelosFiltrados={vistaActiva === "colapso" && panelVuelosAbierto ? vuelosFiltrados : null} />
              {procesandoPrimerBloque && (
                <div className="absolute inset-0 z-[2000] flex flex-col items-center justify-center backdrop-blur-sm bg-slate-900/70">
                  <div className="bg-slate-800 border border-slate-600 rounded-2xl px-10 py-8 flex flex-col items-center gap-4 shadow-2xl">
                    <div className="w-10 h-10 border-4 border-orange-400 border-t-transparent rounded-full animate-spin" />
                    <p className="text-white font-bold text-lg">Procesando simulación</p>
                    <p className="text-slate-400 text-sm">Ejecutando Tabu Search del primer bloque...</p>
                  </div>
                </div>
              )}
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelAlmacenesAbierto ? 'w-[780px]' : 'w-0 overflow-hidden'}`}>
                {panelAlmacenesAbierto && vistaActiva === "colapso" && <DrawerAlmacenes resultado={resultadoFiltrado} minutosVirtualesTotales={minutosVirtualesTotales}
                  fechaInicioSim={fechaInicioColapso} onCerrar={() => { setPanelAlmacenesAbierto(false); setAeropuertosFiltrados(null); }}
                  onSeleccionarAeropuerto={setAeropuertoResaltado} ocupacionAeropuertosRT={ocupacionAeropuertosRT}
                  aeropuertoExpandir={aeropuertoResaltado} onFiltrados={setAeropuertosFiltrados} />}
              </div>
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelEnviosAbierto ? 'w-[620px]' : 'w-0 overflow-hidden'}`}>
                {panelEnviosAbierto && vistaActiva === "colapso" && <DrawerEnvios resultado={resultadoFiltrado} minutosVirtualesTotales={minutosVirtualesTotales}
                  fechaInicioSim={fechaInicioColapso} onCerrar={() => setPanelEnviosAbierto(false)}
                  onEnfocarVuelo={key => setVueloResaltado(key)} onEnfocarAlmacen={cod => setAeropuertoResaltado(cod)}
                  onVerVuelo={key => { setVueloResaltado(key); setPanelVuelosAbierto(true); setPanelEnviosAbierto(false); setPanelAlmacenesAbierto(false); }}
                  onVerAlmacen={cod => { setAeropuertoResaltado(cod); setPanelAlmacenesAbierto(true); setPanelEnviosAbierto(false); setPanelVuelosAbierto(false); }} />}
              </div>
              <div className={`absolute top-0 right-0 h-full z-[999] bg-slate-900 border-l border-slate-700 shadow-2xl flex flex-col transition-all duration-300 ${panelVuelosAbierto ? "w-[820px]" : "w-0 overflow-hidden"}`}>
                {panelVuelosAbierto && vistaActiva === "colapso" && <DrawerVuelos resultado={resultadoFiltrado} minutosVirtualesTotales={minutosVirtualesTotales}
                  fechaInicio={fechaInicioColapso} onSeleccionar={key => setVueloResaltado(key)}
                  onCerrar={() => { setPanelVuelosAbierto(false); setVuelosFiltrados(null); }}
                  vueloExpandir={vueloResaltado} onFiltrados={setVuelosFiltrados}
                  vuelosCancelados={vuelosCancelados} onCancelarVuelo={undefined} />}
              </div>
            </div>
            {colapsoDetectado && (
              <div className="w-full bg-orange-500 text-white flex items-center justify-center gap-3 py-2 shadow-md z-20">
                <OctagonAlert size={16}/>
                <span className="font-bold tracking-widest uppercase text-sm">COLAPSO LOGÍSTICO DETECTADO</span>
                {momentoColapso && <span className="text-orange-100 text-sm font-mono">— {momentoColapso}</span>}
              </div>
            )}
          </main>
        </div>

        {/* VISTA 3: Cargar Datos */}
        <div
          className={`w-full h-full overflow-y-auto bg-slate-100 p-10 ${vistaActiva === "cargar" ? "block" : "hidden"}`}
        >
          <div className="max-w-2xl mx-auto">
            <h1 className="text-3xl font-bold text-tasf-dark text-center mb-2">
              Cargar Datos
            </h1>
            <p className="text-slate-500 text-center mb-8">
              Sube los archivos .txt para poblar la base de datos
            </p>

            <div className="bg-white rounded-2xl shadow p-6 mb-4">
              <p className="font-bold text-tasf-dark text-lg mb-1">
                Aeropuertos
              </p>
              <p className="text-slate-400 text-sm mb-4">
                Archivo: aeropuertos.txt
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => inputAeroRef.current?.click()}
                  className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Elegir archivo
                </button>
                <input
                  ref={inputAeroRef}
                  type="file"
                  accept=".txt"
                  className="hidden"
                  onChange={(e) => {
                    setArchivoAero(e.target.files?.[0] ?? null);
                    setEstadoAero(estadoInicial);
                  }}
                />
                <span className="text-slate-400 text-sm flex-1 truncate">
                  {archivoAero
                    ? archivoAero.name
                    : "No se eligió ningún archivo"}
                </span>
                <button
                  onClick={handleCargarAero}
                  disabled={!archivoAero || estadoAero.cargando}
                  className="flex items-center gap-2 bg-tasf-green hover:bg-green-600 disabled:bg-slate-300 text-white font-semibold px-5 py-2 rounded transition-colors whitespace-nowrap"
                >
                  {estadoAero.cargando ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Cargando...
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> Cargar
                    </>
                  )}
                </button>
              </div>
              {estadoAero.mensaje && (
                <p
                  className={`mt-3 text-sm font-medium ${estadoAero.error ? "text-red-500" : "text-tasf-green"}`}
                >
                  {estadoAero.mensaje}
                </p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow p-6 mb-4">
              <p className="font-bold text-tasf-dark text-lg mb-1">
                Planes de Vuelo
              </p>
              <p className="text-slate-400 text-sm mb-4">
                Archivo: planesVuelos.txt
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => inputVuelosRef.current?.click()}
                  className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Elegir archivo
                </button>
                <input
                  ref={inputVuelosRef}
                  type="file"
                  accept=".txt"
                  className="hidden"
                  onChange={(e) => {
                    setArchivoVuelos(e.target.files?.[0] ?? null);
                    setEstadoVuelos(estadoInicial);
                  }}
                />
                <span className="text-slate-400 text-sm flex-1 truncate">
                  {archivoVuelos
                    ? archivoVuelos.name
                    : "No se eligió ningún archivo"}
                </span>
                <button
                  onClick={handleCargarVuelos}
                  disabled={!archivoVuelos || estadoVuelos.cargando}
                  className="flex items-center gap-2 bg-tasf-green hover:bg-green-600 disabled:bg-slate-300 text-white font-semibold px-5 py-2 rounded transition-colors whitespace-nowrap"
                >
                  {estadoVuelos.cargando ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Cargando...
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> Cargar
                    </>
                  )}
                </button>
              </div>
              {estadoVuelos.mensaje && (
                <p
                  className={`mt-3 text-sm font-medium ${estadoVuelos.error ? "text-red-500" : "text-tasf-green"}`}
                >
                  {estadoVuelos.mensaje}
                </p>
              )}
            </div>

            <div className="bg-white rounded-2xl shadow p-6">
              <p className="font-bold text-tasf-dark text-lg mb-1">Envíos</p>
              <p className="text-slate-400 text-sm mb-4">
                Archivos: _envios_XXXX_.txt (puedes seleccionar varios a la vez)
              </p>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => inputEnviosRef.current?.click()}
                  className="px-4 py-2 border border-slate-300 rounded text-sm text-slate-600 hover:bg-slate-50 transition-colors whitespace-nowrap"
                >
                  Elegir archivos
                </button>
                <input
                  ref={inputEnviosRef}
                  type="file"
                  accept=".txt"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setArchivosEnvios(
                      e.target.files ? Array.from(e.target.files) : [],
                    );
                    setEstadoEnvios(estadoInicial);
                  }}
                />
                <span className="text-slate-400 text-sm flex-1 truncate">
                  {nombreArchivos(archivosEnvios)}
                </span>
                <button
                  onClick={handleCargarEnvios}
                  disabled={
                    archivosEnvios.length === 0 || estadoEnvios.cargando
                  }
                  className="flex items-center gap-2 bg-tasf-green hover:bg-green-600 disabled:bg-slate-300 text-white font-semibold px-5 py-2 rounded transition-colors whitespace-nowrap"
                >
                  {estadoEnvios.cargando ? (
                    <>
                      <Loader2 size={16} className="animate-spin" /> Cargando...
                    </>
                  ) : (
                    <>
                      <Upload size={16} /> Cargar
                    </>
                  )}
                </button>
              </div>
              {estadoEnvios.mensaje && (
                <p
                  className={`mt-3 text-sm font-medium ${estadoEnvios.error ? "text-red-500" : "text-tasf-green"}`}
                >
                  {estadoEnvios.mensaje}
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reporte periodo */}
      {mostrarReporte && (resultado || reporteGuardado) && (
        <ReportePeriodo
          resultado={resultado ?? reporteGuardado!.resultado}
          fechaInicio={resultado ? fechaInicio : reporteGuardado!.fechaInicio}
          dias={resultado ? dias : reporteGuardado!.dias}
          onCerrar={() => setMostrarReporte(false)}
        />
      )}
    </div>
  );
}

export default App;
