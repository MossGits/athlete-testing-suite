package com.example.athletebackend.domain.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.OffsetDateTime;

@Entity
@Table(name = "test_session")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class TestSession {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false, fetch = FetchType.LAZY)
    @JoinColumn(name="athlete_id")
    private AthleteProfile athlete;

    @Enumerated(EnumType.STRING)
    @Column(nullable=false, length=16)
    private TestType type; // BASELINE or ACTIVE

    @Column(nullable=false)
    private OffsetDateTime startedAt;

    private OffsetDateTime completedAt;

    @Column(columnDefinition = "text")
    private String notes;

    @PrePersist
    void onCreate() { if (startedAt == null) startedAt = OffsetDateTime.now(); }
}
