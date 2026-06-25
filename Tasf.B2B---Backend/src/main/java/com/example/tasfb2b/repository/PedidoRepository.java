package com.example.tasfb2b.repository;

import com.example.tasfb2b.model.Pedido;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface PedidoRepository extends JpaRepository<Pedido, String> {
}
