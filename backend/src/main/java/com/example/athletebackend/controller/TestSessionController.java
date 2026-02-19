package com.example.athletebackend.controller;

import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
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
        UUID sessionId = UUID.randomUUID();

        Object athleteId = body.get("athleteId");
        Object mode = body.getOrDefault("mode", "UNKNOWN");

        Map<String, Object> resp = new LinkedHashMap<>();
        resp.put("sessionId", sessionId.toString());
        resp.put("mode", mode);
        resp.put("athleteId", athleteId);
        resp.put("createdAt", OffsetDateTime.now().toString());
        resp.put("createdBy", auth != null ? auth.getName() : null); // null allowed

        return ResponseEntity.ok(resp);
    }
}
