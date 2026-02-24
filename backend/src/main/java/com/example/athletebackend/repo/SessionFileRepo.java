package com.example.athletebackend.repo;

import com.example.athletebackend.model.SessionFile;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface SessionFileRepo extends JpaRepository<SessionFile, Long> {
    List<SessionFile> findAllBySessionId(UUID sessionId);
    Optional<SessionFile> findBySessionIdAndKind(UUID sessionId, String kind);
}
