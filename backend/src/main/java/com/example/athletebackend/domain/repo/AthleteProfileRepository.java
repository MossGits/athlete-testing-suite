package com.example.athletebackend.domain.repo;

import com.example.athletebackend.domain.model.AthleteProfile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AthleteProfileRepository extends JpaRepository<AthleteProfile, Long> {
    Optional<AthleteProfile> findByUser_Id(Long userId);
    List<AthleteProfile> findByUser_Organization_Id(Long orgId);
}
