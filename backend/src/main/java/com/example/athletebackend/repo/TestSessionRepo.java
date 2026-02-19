package com.example.athletebackend.repo;

import com.example.athletebackend.model.TestSession;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface TestSessionRepo extends JpaRepository<TestSession, UUID> {}
