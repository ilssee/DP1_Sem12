package com.example.tasfb2b.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import java.time.LocalTime;

@Entity
@Table(name = "vuelos")
@Data
@AllArgsConstructor
@NoArgsConstructor
public class Vuelo {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String origen;
    private String destino;
    private LocalTime horaSalida;
    private LocalTime horaLlegada;
    private int capacidadMax;
}
