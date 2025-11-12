package com.example.athletebackend.domain.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.LocalDate;

@Entity
@Table(name = "athlete_profile")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class AthleteProfile {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name="user_id", unique = true)
    private UserAccount user;

    @Column(nullable=false, length=80)
    private String firstName;

    @Column(nullable=false, length=80)
    private String lastName;

    private LocalDate dateOfBirth;
}
