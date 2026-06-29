import axios from 'axios';

const API_BASE_URL = 'http://localhost:8080/api/datos';

interface RespuestaCarga {
  mensaje: string;
  registros: number;
}

export const cargarAeropuertos = async (file: File): Promise<RespuestaCarga> => {
  const formData = new FormData();
  formData.append('archivo', file);
  const response = await axios.post<RespuestaCarga>(`${API_BASE_URL}/aeropuertos`, formData);
  return response.data;
};

export const cargarVuelos = async (file: File): Promise<RespuestaCarga> => {
  const formData = new FormData();
  formData.append('archivo', file);
  const response = await axios.post<RespuestaCarga>(`${API_BASE_URL}/vuelos`, formData);
  return response.data;
};

export const cargarEnvios = async (files: File[]): Promise<RespuestaCarga> => {
  const formData = new FormData();
  files.forEach((file) => formData.append('archivos', file));
  const response = await axios.post<RespuestaCarga>(`${API_BASE_URL}/envios`, formData);
  return response.data;
};
