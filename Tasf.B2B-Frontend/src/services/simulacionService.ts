import type { PedidoManualDTO, Solucion } from "../types";
import axios from "axios";

const API_BASE_URL = '/api';

// ── NUEVAS INTERFACES PARA EL TRABAJO ASÍNCRONO ──
export interface IniciarJobResponse {
  jobId: string;
  mensaje: string;
}

export interface JobEstado {
  id: string;
  estado: string; // "INICIADO", "PROCESANDO", "COMPLETADO", "ERROR"
  progreso: number;
  solucionParcial: Solucion | null;
  mensaje: string;
  ventanaVirtual: string | null;
}

// 1. INICIA EL HILO EN SEGUNDO PLANO Y DEVUELVE EL TICKET (JOB ID)
export const iniciarSimulacionPeriodo = async (
  fechaInicio: string,
  dias: number,
  velocidad: number = 60,
): Promise<IniciarJobResponse> => {
  try {
    const response = await axios.post<IniciarJobResponse>(
      `${API_BASE_URL}/simulacion/iniciar`,
      null,
      {
        params: { fechaInicio, dias, velocidad },
      }
    );
    return response.data;
  } catch (error) {
    console.error("Error al iniciar la simulación por periodo:", error);
    throw error;
  }
};

// 2. CONSULTA EL ESTADO ACTUAL DE ESE TICKET
export const obtenerEstadoSimulacion = async (
  jobId: string,
): Promise<JobEstado> => {
  try {
    const response = await axios.get<JobEstado>(
      `${API_BASE_URL}/simulacion/estado/${jobId}`
    );
    return response.data;
  } catch (error) {
    console.error("Error al consultar el estado de la simulación:", error);
    throw error;
  }
};

// 3. DETENER UNA SIMULACIÓN (usado por colapso)
export const detenerSimulacion = async (jobId: string): Promise<void> => {
  await axios.post(`${API_BASE_URL}/simulacion/${jobId}/detener`);
};

// 4. CANCELAR UN VUELO EN TIEMPO REAL
export const cancelarVuelo = async (jobId: string, claveVuelo: string, horaVirtualActual: string): Promise<{ clave: string; fecha: string }> => {
  const response = await axios.post<{ cancelado: string; fecha: string }>(`${API_BASE_URL}/simulacion/${jobId}/cancelar-vuelo`, null, {
    params: { claveVuelo, horaVirtualActual },
  });
  return { clave: response.data.cancelado, fecha: response.data.fecha };
};

// ── MÉTODOS DEL DÍA A DÍA ──

export const registrarPedidoManual = async (
  pedido: PedidoManualDTO,
): Promise<any> => {
  try {
    const response = await axios.post(
      `${API_BASE_URL}/diario/pedido-manual`,
      pedido,
    );
    return response.data;
  } catch (error) {
    console.error("Error al registrar pedido manual:", error);
    throw error;
  }
};

export const cancelarVueloDiario = async (claveVuelo: string, horaActual?: string): Promise<{ cancelado: string; fecha: string; mensaje: string }> => {
  const params: Record<string, string> = { claveVuelo };
  if (horaActual) params.horaActual = horaActual;
  const response = await axios.post<{ cancelado: string; fecha: string; mensaje: string }>(
    `${API_BASE_URL}/diario/cancelar-vuelo`, null, { params }
  );
  return response.data;
};

export const limpiarEstadoDiario = async (fecha: string): Promise<void> => {
  try {
    await axios.delete(`${API_BASE_URL}/diario/limpiar`, {
      params: { fecha },
    });
  } catch (error) {
    console.error("Error al limpiar el estado diario:", error);
    throw error;
  }
};

export const simularVentanaDiaria = async (
  fechaInicioSimulacion: string,
  fechaHoraActual: string,
  ventanaMinutos: number = 5,
): Promise<Solucion> => {
  try {
    const response = await axios.get<Solucion>(
      `${API_BASE_URL}/diario/ventana`,
      {
        params: {
          fechaInicioSimulacion,
          fechaHoraActual,
          ventanaMinutos,
        },
      },
    );
    return response.data;
  } catch (error) {
    console.error("Error en la simulación de ventana:", error);
    throw error;
  }
};