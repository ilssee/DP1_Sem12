package com.example.tasfb2b;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableAsync
@EnableScheduling
public class Tasfb2bBackendApplication {

    public static void main(String[] args) {
        SpringApplication.run(Tasfb2bBackendApplication.class, args);
    }

}
