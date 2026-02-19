package com.example.athletebackend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
public class TestSessionController {

    @PostMapping
    public ResponseEntity<Map<String, Object>> createSession(
            @RequestBody Map<String, Object> body,
            Authentication auth
    ) {
        // Minimal v1: generate an ID and return it.
        UUID sessionId = UUID.randomUUID();

        Object athleteId = body.get("athleteId");
        Object mode = body.getOrDefault("mode", "UNKNOWN"); // "BASELINE" or "ACTIVE"

        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId.toString(),
                "mode", mode,
                "athleteId", athleteId,
                "createdAt", OffsetDateTime.now().toString(),
                "createdBy", (auth != null ? auth.getName() : null)
        ));
    }
}
