package com.example.athletebackend.domain.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.OffsetDateTime;

@Entity
@Table(name = "user_account")
@Getter @Setter @NoArgsConstructor @AllArgsConstructor @Builder
public class UserAccount {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable=false, unique=true, length=255)
    private String email;

    @Column(name="password_hash", nullable=false, length=255)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable=false)
    private UserRole role;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name="organization_id")
    private Organization organization;

    @Column(nullable=false)
    private OffsetDateTime createdAt;

    @Column(nullable=false)
    private OffsetDateTime updatedAt;

    @PrePersist
    void onCreate() {
        var now = OffsetDateTime.now();
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = OffsetDateTime.now();
    }
}
