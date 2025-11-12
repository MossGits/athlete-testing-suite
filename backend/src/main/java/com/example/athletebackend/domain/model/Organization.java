package com.example.athletebackend.domain.model;

import jakarta.persistence.*;
import lombok.*;

@Entity
@Table(name = "organization")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class Organization {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable=false, unique=true, length=128)
    private String name;
}
