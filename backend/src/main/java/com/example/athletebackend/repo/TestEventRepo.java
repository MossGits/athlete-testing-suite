package com.example.athletebackend.repo;

import com.example.athletebackend.model.TestEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface TestEventRepo extends JpaRepository<TestEvent, Long> {}
