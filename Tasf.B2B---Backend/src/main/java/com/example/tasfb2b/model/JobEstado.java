package com.example.tasfb2b.model;

public class JobEstado {
    private String id;
    private String estado; // "INICIADO", "PROCESANDO", "COMPLETADO", "ERROR"
    private double progreso;
    private Solucion solucionParcial;
    private String mensaje;
    private String ventanaVirtual;

    public JobEstado(String id, String estado) {
        this.id = id;
        this.estado = estado;
        this.progreso = 0.0;
    }

    // Getters y Setters
    public String getId() { return id; }
    public void setId(String id) { this.id = id; }
    public String getEstado() { return estado; }
    public void setEstado(String estado) { this.estado = estado; }
    public double getProgreso() { return progreso; }
    public void setProgreso(double progreso) { this.progreso = progreso; }
    public Solucion getSolucionParcial() { return solucionParcial; }
    public void setSolucionParcial(Solucion solucionParcial) { this.solucionParcial = solucionParcial; }
    public String getMensaje() { return mensaje; }
    public void setMensaje(String mensaje) { this.mensaje = mensaje; }
    public String getVentanaVirtual() { return ventanaVirtual; }
    public void setVentanaVirtual(String ventanaVirtual) { this.ventanaVirtual = ventanaVirtual; }
}