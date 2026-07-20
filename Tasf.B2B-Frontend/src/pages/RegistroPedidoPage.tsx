import React, { useState } from "react";
import { aeropuertosDB } from "../data/coordenadas";
import {
  cargarPedidosDiariosPorArchivo,
  registrarPedidoManual,
} from "../services/simulacionService";

const obtenerIsoLocal = (date: Date) => {
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};

const obtenerFechaBaseLima = (date: Date) => {
  const lima = new Date(
    date.toLocaleString("en-US", { timeZone: "America/Lima" }),
  );
  const pad = (v: number) => String(v).padStart(2, "0");
  return `${lima.getFullYear()}-${pad(lima.getMonth() + 1)}-${pad(lima.getDate())}`;
};

const ZONA_A_AEROPUERTO: Record<string, string> = {
  "America/Lima": "SPIM",
  "America/Bogota": "SPIM",
  "America/Argentina/Buenos_Aires": "SABE",
  "America/Buenos_Aires": "SABE",
  "Europe/Copenhagen": "EKCH",
  "Europe/Paris": "EKCH",
  "Europe/Berlin": "EKCH",
  "Europe/Madrid": "EKCH",
  "Europe/Brussels": "EKCH",
  "Europe/Amsterdam": "EKCH",
  "Europe/Rome": "EKCH",
  "Europe/Stockholm": "EKCH",
  "Europe/Oslo": "EKCH",
  "Asia/Kolkata": "VIDP",
  "Asia/Calcutta": "VIDP",
};

const detectarAeropuertoOrigen = (): { codigo: string; zona: string } => {
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const codigo = ZONA_A_AEROPUERTO[zona] ?? null;
  return { codigo: codigo ?? "", zona };
};

const aeropuertosOpciones = Object.entries(aeropuertosDB)
  .map(([codigo, info]) => ({ codigo, label: `${codigo} — ${info.nombre}` }))
  .sort((a, b) => a.label.localeCompare(b.label));

interface PedidoRegistrado {
  idPedido: string;
  origen: string;
  destino: string;
  cantidadMaletas: number;
  idCliente: string;
  fechaRegistro: string;
  fechaHoraVirtual?: string;
}

const parsearArchivoPedidos = (
  contenido: string,
  origen: string,
): PedidoRegistrado[] => {
  const lineas = contenido
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean);
  return lineas.map((linea) => {
    const partes = linea.split("-");
    if (partes.length < 7) {
      throw new Error(`Línea inválida: ${linea}`);
    }

    const idPedido = partes[0].trim();
    const fechaTexto = partes[1].trim();
    const horaTexto = partes[2].trim();
    const minutoTexto = partes[3].trim();
    const destino = partes[4].trim().toUpperCase();
    const cantidadMaletas = Number(partes[5].trim());
    const idCliente = partes[6].trim();

    if (!idPedido || !destino || Number.isNaN(cantidadMaletas) || !idCliente) {
      throw new Error(`Línea inválida: ${linea}`);
    }

    const fechaBase = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Lima",
    }); // "YYYY-MM-DD"

    const fechaParseada = fechaTexto.includes("##")
      ? fechaTexto.replace("##", fechaBase.slice(8, 10))
      : fechaTexto;

    const fechaRegistro = `${fechaParseada.slice(0, 4)}-${fechaParseada.slice(4, 6)}-${fechaParseada.slice(6, 8)}T${horaTexto.padStart(2, "0")}:${minutoTexto.padStart(2, "0")}:00`;

    return {
      idPedido,
      origen,
      destino,
      cantidadMaletas,
      idCliente,
      fechaRegistro,
      fechaHoraVirtual: fechaRegistro,
    };
  });
};

export default function RegistroPedidoPage({
  onVolver,
}: {
  onVolver: () => void;
}) {
  const { codigo: origenDetectado, zona: zonaDetectada } =
    detectarAeropuertoOrigen();
  const origen = origenDetectado;
  const [destino, setDestino] = useState("");
  const [cantidad, setCantidad] = useState(1);
  const [idCliente, setIdCliente] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exito, setExito] = useState(false);
  const [archivoCarga, setArchivoCarga] = useState<File | null>(null);
  const [cargandoArchivo, setCargandoArchivo] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  const [mensajeCarga, setMensajeCarga] = useState<string | null>(null);
  // 1. Reemplaza el useState de 'registrados' por este:
  const [registrados, setRegistrados] = useState<PedidoRegistrado[]>(() => {
    try {
      const saved = sessionStorage.getItem("tasf_pedidos_sesion");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setExito(false);
    if (!origen) {
      setError(
        "No se pudo detectar el aeropuerto de origen. Configura la zona horaria de Windows correctamente.",
      );
      return;
    }
    if (!destino || !idCliente) {
      setError("Completa todos los campos.");
      return;
    }
    if (origen === destino) {
      setError("El origen y destino no pueden ser iguales.");
      return;
    }
    setLoading(true);
    try {
      const fechaHoraVirtual = obtenerIsoLocal(new Date());
      const pedido = await registrarPedidoManual({
        origen,
        destino,
        cantidadMaletas: cantidad,
        idCliente: idCliente.trim(),
        fechaHoraVirtual,
      });

      const nuevo: PedidoRegistrado = {
        idPedido: pedido.idPedido,
        origen,
        destino,
        cantidadMaletas: cantidad,
        idCliente: idCliente.trim(),
        fechaRegistro: pedido.fechaRegistro ?? fechaHoraVirtual,
        fechaHoraVirtual,
      };

      const actualizados = [...registrados, nuevo];
      sessionStorage.setItem("tasf_pedidos_sesion", JSON.stringify(actualizados));
      setRegistrados(actualizados);

      setDestino("");
      setCantidad(1);
      setIdCliente("");
      setExito(true);
      setTimeout(() => setExito(false), 3000);
    } catch (err: any) {
      setError(err?.response?.data ?? err?.message ?? "Error al registrar.");
    } finally {
      setLoading(false);
    }
  };

  const handleCargarArchivo = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorCarga(null);
    setMensajeCarga(null);

    if (!archivoCarga) {
      setErrorCarga("Selecciona un archivo de texto con los envíos.");
      return;
    }
    if (!origen) {
      setErrorCarga("No se pudo detectar el aeropuerto de origen.");
      return;
    }

    setCargandoArchivo(true);
    try {
      const contenido = await archivoCarga.text();
      const pedidosDelArchivo = parsearArchivoPedidos(contenido, origen);
      const fechaBase = obtenerFechaBaseLima(new Date());
      const respuesta = await cargarPedidosDiariosPorArchivo(
        archivoCarga,
        origen,
        fechaBase,
      );

      const actualizados = [...registrados, ...pedidosDelArchivo];
      sessionStorage.setItem("tasf_pedidos_sesion", JSON.stringify(actualizados));
      setRegistrados(actualizados);
      setMensajeCarga(`${respuesta.registros} envíos cargados correctamente.`);
      setArchivoCarga(null);
      setExito(true);
      setTimeout(() => setExito(false), 3000);
    } catch (err: any) {
      setErrorCarga(
        err?.response?.data?.mensaje ??
          err?.message ??
          "No se pudo cargar el archivo.",
      );
    } finally {
      setCargandoArchivo(false);
    }
  };

  return (
    <div className="min-h-full bg-slate-950 text-white flex flex-col">
      {/* Header */}
      <div className="bg-slate-900 border-b border-slate-800 px-6 py-4 flex items-center gap-4">
        <button
          onClick={onVolver}
          className="flex items-center gap-2 text-slate-400 hover:text-white transition-colors text-sm font-semibold"
        >
          ← Volver
        </button>
        <div className="w-px h-5 bg-slate-700" />
        <div>
          <h2 className="text-lg font-bold text-white">Registro de Envíos</h2>
          <p className="text-xs text-slate-400">
            Operaciones día a día — Empleado registrador
          </p>
        </div>
      </div>

      <div className="flex-1 p-6 flex gap-6 overflow-hidden">
        {/* Formulario */}
        <div className="w-[420px] shrink-0">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl p-6 shadow-xl">
            <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-5">
              Nuevo envío de maletas
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Origen — detectado automáticamente por zona horaria */}
              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1.5">
                  Aeropuerto Origen (detectado automáticamente)
                </label>
                {origen ? (
                  <div className="w-full bg-slate-800/50 border border-tasf-green/40 rounded-xl px-3 py-2.5 flex items-center justify-between">
                    <span className="text-sm font-bold text-tasf-green">
                      {origen}
                    </span>
                    <span className="text-xs text-slate-500 font-mono">
                      {zonaDetectada}
                    </span>
                  </div>
                ) : (
                  <div className="w-full bg-red-900/30 border border-red-500/40 rounded-xl px-3 py-2.5">
                    <span className="text-xs text-red-400">
                      Zona horaria no reconocida: {zonaDetectada}
                    </span>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Configura la zona horaria correcta en Windows.
                    </p>
                  </div>
                )}
              </div>

              {/* Destino */}
              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1.5">
                  Aeropuerto Destino
                </label>
                <select
                  value={destino}
                  onChange={(e) => setDestino(e.target.value)}
                  required
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-tasf-green transition-colors cursor-pointer"
                >
                  <option value="">— Selecciona destino —</option>
                  {aeropuertosOpciones
                    .filter((a) => a.codigo !== origen)
                    .map((a) => (
                      <option key={a.codigo} value={a.codigo}>
                        {a.label}
                      </option>
                    ))}
                </select>
              </div>

              {/* Cantidad con flechas */}
              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1.5">
                  Cantidad de Maletas
                </label>
                <div className="flex items-center gap-0 border border-slate-600 rounded-xl overflow-hidden bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                    className="px-4 py-2.5 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-lg font-bold select-none"
                  >
                    −
                  </button>
                  <input
                    type="number"
                    value={cantidad}
                    onChange={(e) =>
                      setCantidad(
                        Math.max(1, Math.min(999, Number(e.target.value) || 1)),
                      )
                    }
                    min={1}
                    max={999}
                    className="flex-1 bg-transparent text-center text-white text-sm font-bold outline-none py-2.5 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                  />
                  <button
                    type="button"
                    onClick={() => setCantidad((c) => Math.min(999, c + 1))}
                    className="px-4 py-2.5 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors text-lg font-bold select-none"
                  >
                    +
                  </button>
                </div>
              </div>

              {/* ID Cliente */}
              <div>
                <label className="block text-xs text-slate-400 uppercase tracking-wider mb-1.5">
                  ID Cliente
                </label>
                <input
                  type="text"
                  value={idCliente}
                  onChange={(e) => setIdCliente(e.target.value)}
                  required
                  placeholder="Ej: CLI-001"
                  className="w-full bg-slate-800 border border-slate-600 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-tasf-green transition-colors"
                />
              </div>

              {/* Hora de registro */}
              <div className="bg-slate-800/60 rounded-xl px-3 py-2.5 text-xs text-slate-400 flex justify-between">
                <span>Fecha/hora de registro</span>
                <span className="font-mono text-slate-300">
                  {obtenerIsoLocal(new Date()).replace("T", " ")}
                </span>
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}
              {exito && (
                <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2 text-xs text-green-400">
                  ✓ Envío registrado correctamente.
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-tasf-green hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl py-3 text-sm transition-colors"
              >
                {loading ? "Registrando..." : "Registrar Envío"}
              </button>
            </form>

            <form
              onSubmit={handleCargarArchivo}
              className="mt-5 border border-slate-700 rounded-2xl p-4 bg-slate-800/50"
            >
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-widest mb-3">
                Carga masiva por archivo
              </h4>
              <label className="block text-xs text-slate-400 uppercase tracking-wider mb-2">
                Archivo de envíos (.txt)
              </label>
              <input
                type="file"
                accept=".txt,.csv"
                onChange={(e) => setArchivoCarga(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-slate-300 file:mr-3 file:py-2 file:px-3 file:rounded-xl file:border-0 file:bg-tasf-green/20 file:text-tasf-green hover:file:bg-tasf-green/30"
              />
              <p className="text-[11px] text-slate-500 mt-2">
                Se tomará el origen detectado automáticamente por la zona
                horaria:{" "}
                <span className="font-semibold text-slate-300">
                  {origen || "—"}
                </span>
              </p>
              {errorCarga && (
                <div className="mt-3 bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-400">
                  {errorCarga}
                </div>
              )}
              {mensajeCarga && (
                <div className="mt-3 bg-green-500/10 border border-green-500/30 rounded-xl px-3 py-2 text-xs text-green-400">
                  {mensajeCarga}
                </div>
              )}
              <button
                type="submit"
                disabled={cargandoArchivo}
                className="mt-3 w-full bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold rounded-xl py-2.5 text-sm transition-colors"
              >
                {cargandoArchivo ? "Cargando..." : "Cargar envíos"}
              </button>
            </form>
          </div>
        </div>

        {/* Lista de registrados */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <h3 className="text-sm font-bold text-slate-300 uppercase tracking-widest mb-4">
            Envíos registrados esta sesión ({registrados.length})
          </h3>
          {registrados.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-slate-600 text-sm">
              Aún no hay envíos registrados.
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {[...registrados].reverse().map((p) => (
                <div
                  key={p.idPedido}
                  className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-slate-500">
                      {p.idPedido}
                    </span>
                    <span className="text-white font-bold text-sm">
                      {p.origen}
                    </span>
                    <span className="text-slate-500 text-xs">→</span>
                    <span className="text-white font-bold text-sm">
                      {p.destino}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="bg-tasf-green/20 text-tasf-green text-xs font-bold px-2 py-0.5 rounded-full">
                      {p.cantidadMaletas} mal.
                    </span>
                    <span className="text-slate-500 text-xs">
                      {p.idCliente}
                    </span>
                    <span className="text-slate-600 text-xs font-mono">
                      {p.fechaRegistro?.replace("T", " ").substring(0, 16)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
