export interface Vuelo {
  origen: string;
  destino: string;
  horaSalida: string;
  horaLlegada: string;
  capacidadMax: number;
}

export interface DetalleEnvio {
  idCliente: string;
  cantidadMaletas: number;
  origen: string;
  destino: string;
}

export interface Solucion {
  rutasAsignadas: Record<string, Vuelo[]>;
  ocupacionVuelos: Record<string, number>;
  capacidadesVuelos: Record<string, number>;
  horasLlegada: Record<string, string>;
  ocupacionAeropuertos: Record<string, number>;
  capacidadesAeropuertos: Record<string, number>;
  detallesEnvios: Record<string, DetalleEnvio>;
  fechasTramos: Record<string, string[]>;
  rutasPlanificadas: Record<string, Vuelo[]>;

  // Métricas para el panel inferior
  totalPedidos: number;
  tasaExito: number;
  tiempoPromedioIntra: number;
  tiempoPromedioInter: number;

  fitness: number;
}

export interface PedidoManualDTO {
  origen: string;
  destino: string;
  cantidadMaletas: number;
  idCliente: string;
  fechaHoraVirtual: string;
}