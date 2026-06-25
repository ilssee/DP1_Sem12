package com.example.tasfb2b.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalDateTime;

@Entity
@Table(name = "pedidos")
@Data
@AllArgsConstructor
@NoArgsConstructor
public class Pedido {
    @Id
    private String idPedido;
    private String origen;
    private String destino;
    private LocalDateTime fechaRegistro;
    private int cantidadMaletas;
    private String idCliente;
}
