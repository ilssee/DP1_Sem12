package com.example.tasfb2b.model;

import lombok.Data;

@Data
public class PedidoManualDTO {
    private String origen;
    private String destino;
    private int cantidadMaletas;
    private String idCliente;
    private String fechaHoraVirtual; // La hora que marca el reloj de la simulación en React
}