import React, { useEffect, useState } from "react";
import axios from "axios";

interface AeropuertoRow {
  codigo: string;
  nombre: string;
  pais: string;
  gmt: number;
  capacidadMax: number;
  capacidadEditada: number;
  original: number;        // valor al cargar la página
  modificado: boolean;
  guardando: boolean;
  guardado: boolean;
}

const DEFAULTS_PRUEBA: Record<string, number> = {
  SPIM: 440,
  SABE: 460,
  EKCH: 480,
  VIDP: 480,
};

export default function ConfigAeropuertosPage({ onVolver }: { onVolver: () => void }) {
  const [filas, setFilas] = useState<AeropuertoRow[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState("");
  const [preparando, setPreparando] = useState(false);
  const [revirtiendo, setRevirtiendo] = useState(false);

  useEffect(() => {
    cargarAeropuertos();
  }, []);

  const cargarAeropuertos = async () => {
    setCargando(true);
    setError(null);
    try {
      const { data } = await axios.get<AeropuertoRow[]>("/api/datos/aeropuertos/todos");
      setFilas(data.map(a => ({
        ...a,
        capacidadEditada: a.capacidadMax,
        original: a.capacidadMax,
        modificado: false,
        guardando: false,
        guardado: false,
      })));
    } catch {
      setError("No se pudo cargar la lista de aeropuertos.");
    } finally {
      setCargando(false);
    }
  };

  const actualizarCapacidad = (codigo: string, valor: number) => {
    setFilas(prev => prev.map(f =>
      f.codigo === codigo
        ? { ...f, capacidadEditada: valor, modificado: valor !== f.original, guardado: false }
        : f
    ));
  };

  const guardarUno = async (fila: AeropuertoRow) => {
    setFilas(prev => prev.map(f => f.codigo === fila.codigo ? { ...f, guardando: true } : f));
    try {
      await axios.put(`/api/datos/aeropuertos/${fila.codigo}/capacidad`, { capacidadMax: fila.capacidadEditada });
      setFilas(prev => prev.map(f =>
        f.codigo === fila.codigo
          ? { ...f, guardando: false, guardado: true, capacidadMax: f.capacidadEditada, original: f.capacidadEditada, modificado: false }
          : f
      ));
    } catch {
      setFilas(prev => prev.map(f => f.codigo === fila.codigo ? { ...f, guardando: false } : f));
      alert(`Error al guardar ${fila.codigo}`);
    }
  };

  const prepararPrueba = async () => {
    setPreparando(true);
    const codigos = ["SPIM", "SABE", "EKCH", "VIDP"];
    for (const cod of codigos) {
      const fila = filas.find(f => f.codigo === cod);
      if (!fila) continue;
      try {
        await axios.put(`/api/datos/aeropuertos/${cod}/capacidad`, { capacidadMax: 999 });
        setFilas(prev => prev.map(f =>
          f.codigo === cod
            ? { ...f, capacidadEditada: 999, capacidadMax: 999, modificado: true, guardado: true }
            : f
        ));
      } catch { /* continuar con los demás */ }
    }
    setPreparando(false);
  };

  const revertirModificados = async () => {
    setRevirtiendo(true);
    const modificados = filas.filter(f => f.capacidadMax !== f.original || f.modificado);
    for (const fila of modificados) {
      const valorOriginal = fila.original;
      try {
        await axios.put(`/api/datos/aeropuertos/${fila.codigo}/capacidad`, { capacidadMax: valorOriginal });
        setFilas(prev => prev.map(f =>
          f.codigo === fila.codigo
            ? { ...f, capacidadEditada: valorOriginal, capacidadMax: valorOriginal, modificado: false, guardado: false }
            : f
        ));
      } catch { /* continuar */ }
    }
    setRevirtiendo(false);
  };

  const filasFiltradas = filas.filter(f =>
    f.codigo.toLowerCase().includes(filtro.toLowerCase()) ||
    f.nombre.toLowerCase().includes(filtro.toLowerCase()) ||
    f.pais.toLowerCase().includes(filtro.toLowerCase())
  );

  const cantModificados = filas.filter(f => f.modificado || f.capacidadMax !== f.original).length;

  return (
    <div className="min-h-full bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <button onClick={onVolver} className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-semibold">
          ← Volver
        </button>
        <div className="w-px h-5 bg-slate-700" />
        <div className="flex-1">
          <h2 className="text-lg font-bold text-white">Configuración de Aeropuertos</h2>
          <p className="text-xs text-slate-400">Administración de capacidades — Modo día a día</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={prepararPrueba}
            disabled={preparando || revirtiendo}
            title="Cambia SPIM, SABE, EKCH y VIDP a capacidad 999"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 border border-amber-500/30 text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            {preparando ? "Preparando..." : "⚡ Preparar prueba (→999)"}
          </button>
          <button
            onClick={revertirModificados}
            disabled={revirtiendo || preparando || cantModificados === 0}
            title="Revierte solo los aeropuertos que fueron modificados a su valor original"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 border border-blue-500/30 text-sm font-semibold disabled:opacity-40 transition-colors"
          >
            {revirtiendo ? "Revirtiendo..." : `↩ Revertir modificados${cantModificados > 0 ? ` (${cantModificados})` : ""}`}
          </button>
        </div>
      </div>

      {/* Valores de referencia prueba */}
      <div className="px-6 py-3 bg-slate-900/50 border-b border-slate-800 flex items-center gap-6 text-xs text-slate-500">
        <span className="font-semibold text-slate-400">Valores originales prueba:</span>
        {Object.entries(DEFAULTS_PRUEBA).map(([cod, cap]) => (
          <span key={cod}><span className="text-white font-bold">{cod}</span>: {cap}</span>
        ))}
      </div>

      <div className="flex-1 p-6 overflow-auto">
        {/* Buscador */}
        <div className="mb-4">
          <input
            type="text"
            placeholder="Buscar por código, nombre o país..."
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            className="w-full max-w-sm bg-slate-800 border border-slate-600 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-tasf-green transition-colors"
          />
        </div>

        {error && (
          <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-sm text-red-400">{error}</div>
        )}

        {cargando ? (
          <div className="flex items-center justify-center py-20 text-slate-500">Cargando aeropuertos...</div>
        ) : (
          <div className="bg-slate-900 border border-slate-700 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-[11px] uppercase text-slate-500">
                  <th className="px-4 py-3 text-left">Código</th>
                  <th className="px-4 py-3 text-left">Nombre</th>
                  <th className="px-4 py-3 text-left">País</th>
                  <th className="px-4 py-3 text-center">GMT</th>
                  <th className="px-4 py-3 text-center">Capacidad actual</th>
                  <th className="px-4 py-3 text-center">Nueva capacidad</th>
                  <th className="px-4 py-3 text-center">Acción</th>
                </tr>
              </thead>
              <tbody>
                {filasFiltradas.map(f => (
                  <tr key={f.codigo} className={`border-b border-slate-800 transition-colors ${f.modificado ? "bg-amber-900/10" : "hover:bg-slate-800/40"}`}>
                    <td className="px-4 py-2.5 font-mono font-bold text-white">
                      {f.codigo}
                      {Object.keys(DEFAULTS_PRUEBA).includes(f.codigo) && (
                        <span className="ml-1.5 text-[9px] bg-amber-500/20 text-amber-400 px-1 py-0.5 rounded">prueba</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-slate-300 text-xs max-w-[200px] truncate">{f.nombre}</td>
                    <td className="px-4 py-2.5 text-slate-400 text-xs">{f.pais}</td>
                    <td className="px-4 py-2.5 text-center font-mono text-slate-400 text-xs">
                      {f.gmt >= 0 ? `+${f.gmt}` : f.gmt}
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <span className={`font-mono font-bold text-sm ${f.capacidadMax === 999 ? "text-amber-400" : "text-slate-200"}`}>
                        {f.capacidadMax}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      <input
                        type="number"
                        min={1}
                        max={9999}
                        value={f.capacidadEditada}
                        onChange={e => actualizarCapacidad(f.codigo, Math.max(1, Number(e.target.value) || 1))}
                        className="w-24 bg-slate-800 border border-slate-600 rounded-lg px-2 py-1 text-center text-sm font-mono text-white outline-none focus:border-tasf-green transition-colors"
                      />
                    </td>
                    <td className="px-4 py-2.5 text-center">
                      {f.guardado ? (
                        <span className="text-tasf-green text-xs">✓ Guardado</span>
                      ) : (
                        <button
                          onClick={() => guardarUno(f)}
                          disabled={f.guardando || !f.modificado}
                          className="px-3 py-1 rounded-lg bg-tasf-green/20 text-tasf-green hover:bg-tasf-green/30 border border-tasf-green/30 text-xs font-semibold disabled:opacity-30 transition-colors"
                        >
                          {f.guardando ? "..." : "Guardar"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
