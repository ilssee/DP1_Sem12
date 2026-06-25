package com.example.tasfb2b.repository;

import com.example.tasfb2b.model.Aeropuerto;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface AeropuertoRepository extends JpaRepository<Aeropuerto, String> {
}
