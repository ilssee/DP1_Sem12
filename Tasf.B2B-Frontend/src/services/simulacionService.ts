import type { PedidoManualDTO, Solucion } from "../types";
import axios from "axios";

const API_BASE_URL = 'http://localhost:8080/api';

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
): Promise<IniciarJobResponse> => {
  try {
    // Nota: El backend espera un POST para iniciar
    const response = await axios.post<IniciarJobResponse>(
      `${API_BASE_URL}/simulacion/iniciar`,
      null, // No hay body, los datos van por params
      {
        params: {
          fechaInicio: fechaInicio,
          dias: dias,
        },
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