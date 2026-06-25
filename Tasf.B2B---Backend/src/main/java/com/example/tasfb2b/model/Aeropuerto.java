package com.example.tasfb2b.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "aeropuertos")
@Data
@AllArgsConstructor
@NoArgsConstructor
public class Aeropuerto {
    @Id
    private String codigo;
    private String nombre;
    private String pais;
    private String continente;
    private int gmt;
    private int capacidadMax;
    private double latitud;
    private double longitud;

    @Transient
    private int maletasActuales = 0;
}
