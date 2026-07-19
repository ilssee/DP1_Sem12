-- Crear tabla pedidos_diario (aislada de pedidos históricos)
CREATE TABLE IF NOT EXISTS pedidos_diario (
    id_pedido        VARCHAR(50)  PRIMARY KEY,
    origen           VARCHAR(4)   NOT NULL,
    destino          VARCHAR(4)   NOT NULL,
    fecha_registro   DATETIME     NOT NULL,
    cantidad_maletas INT          NOT NULL DEFAULT 1,
    id_cliente       VARCHAR(20)  NOT NULL
);
