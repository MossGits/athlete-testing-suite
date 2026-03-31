package com.example.athletebackend.controller;

import com.example.athletebackend.repo.TestSessionRepo;
import com.example.athletebackend.service.PpgFeatureService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
public class SessionProcessingController {

    private final TestSessionRepo sessions;
    private final PpgFeatureService ppgFeatureService;

    public SessionProcessingController(TestSessionRepo sessions, PpgFeatureService ppgFeatureService) {
        this.sessions = sessions;
        this.ppgFeatureService = ppgFeatureService;
    }

    @PostMapping("/{sessionId}/process-features")
    public ResponseEntity<?> processFeatures(@PathVariable UUID sessionId) throws Exception {
        sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));

        Map<String, Object> result = ppgFeatureService.processAndStore(sessionId);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/{sessionId}/processed-features")
    public ResponseEntity<?> getProcessedFeatures(@PathVariable UUID sessionId) throws Exception {
        sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));

        try {
            Map<String, Object> result = ppgFeatureService.getStored(sessionId);
            return ResponseEntity.ok(result);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.status(404).body(Map.of(
                    "status", "not_processed",
                    "message", ex.getMessage()
            ));
        }
    }
}
