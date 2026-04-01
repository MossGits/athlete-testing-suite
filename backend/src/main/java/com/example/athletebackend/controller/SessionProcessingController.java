package com.example.athletebackend.controller;

import com.example.athletebackend.repo.TestSessionRepo;
import com.example.athletebackend.service.EegFeatureService;
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
    private final EegFeatureService eegFeatureService;

    public SessionProcessingController(
            TestSessionRepo sessions,
            PpgFeatureService ppgFeatureService,
            EegFeatureService eegFeatureService
    ) {
        this.sessions = sessions;
        this.ppgFeatureService = ppgFeatureService;
        this.eegFeatureService = eegFeatureService;
    }

    @PostMapping("/{sessionId}/process-features")
    public ResponseEntity<?> processFeatures(@PathVariable UUID sessionId) throws Exception {
        sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));

        Map<String, Object> ppgResult = ppgFeatureService.processAndStore(sessionId);
        Map<String, Object> eegResult = eegFeatureService.processAndStore(sessionId);

        return ResponseEntity.ok(Map.of(
                "sessionId", sessionId.toString(),
                "ppgFeatures", ppgResult.get("ppgFeatures"),
                "eegFeatures", eegResult.get("eegFeatures")
        ));
    }

    @GetMapping("/{sessionId}/processed-features")
    public ResponseEntity<?> getProcessedFeatures(@PathVariable UUID sessionId) throws Exception {
        sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));

        try {
            Map<String, Object> ppgResult = ppgFeatureService.getStored(sessionId);

            Map<String, Object> eegResult;
            try {
                eegResult = eegFeatureService.getStored(sessionId);
            } catch (IllegalArgumentException ex) {
                eegResult = Map.of("eegFeatures", Map.of());
            }

            return ResponseEntity.ok(Map.of(
                    "sessionId", sessionId.toString(),
                    "ppgFeatures", ppgResult.get("ppgFeatures"),
                    "eegFeatures", eegResult.get("eegFeatures")
            ));
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.status(404).body(Map.of(
                    "status", "not_processed",
                    "message", ex.getMessage()
            ));
        }
    }
}
