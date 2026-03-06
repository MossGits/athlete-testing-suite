package com.example.athletebackend.controller;

import com.example.athletebackend.repo.TestSessionRepo;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/trainer")
public class TrainerTestsController {

    private final TestSessionRepo sessions;

    public TrainerTestsController(TestSessionRepo sessions) {
        this.sessions = sessions;
    }

    @GetMapping("/athletes/{athleteRef}/tests")
    public ResponseEntity<?> listAthleteTests(@PathVariable String athleteRef) {
        var list = sessions.findAllByAthleteRefOrderByCreatedAtDesc(athleteRef);

        var out = list.stream().map(s -> Map.of(
                "sessionId", s.getId().toString(),
                "athleteId", s.getAthleteRef(),
                "mode", s.getMode(),
                "status", s.getStatus(),
                "createdAt", s.getCreatedAt() != null ? s.getCreatedAt().toString() : null,
                "startedAt", s.getStartedAt() != null ? s.getStartedAt().toString() : null,
                "endedAt", s.getEndedAt() != null ? s.getEndedAt().toString() : null
        )).toList();

        return ResponseEntity.ok(out);
    }
}
