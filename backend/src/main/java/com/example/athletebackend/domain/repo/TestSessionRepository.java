package com.example.athletebackend.domain.repo;

import com.example.athletebackend.domain.model.TestSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TestSessionRepository extends JpaRepository<TestSession, Long> {
    List<TestSession> findByAthlete_Id(Long athleteId);
    List<TestSession> findByAthlete_User_Organization_Id(Long orgId);
}
