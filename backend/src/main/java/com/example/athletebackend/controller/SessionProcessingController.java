package com.example.athletebackend.controller;

import com.example.athletebackend.repo.TestSessionRepo;
import com.example.athletebackend.service.EegFeatureService;
import com.example.athletebackend.service.MotionFeatureService;
import com.example.athletebackend.service.PpgFeatureService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestController
@RequestMapping("/api/sessions")
public class SessionProcessingController {

    private final TestSessionRepo sessions;
    private final PpgFeatureService ppgFeatureService;
    private final EegFeatureService eegFeatureService;
    private final MotionFeatureService motionFeatureService;

    public SessionProcessingController(
            TestSessionRepo sessions,
            PpgFeatureService ppgFeatureService,
            EegFeatureService eegFeatureService,
            MotionFeatureService motionFeatureService
    ) {
        this.sessions = sessions;
        this.ppgFeatureService = ppgFeatureService;
        this.eegFeatureService = eegFeatureService;
        this.motionFeatureService = motionFeatureService;
    }

    @PostMapping("/{sessionId}/process-features")
    public ResponseEntity<?> processFeatures(@PathVariable UUID sessionId) throws Exception {
        sessions.findById(sessionId)
                .orElseThrow(() -> new IllegalArgumentException("Session not found"));

        Map<String, Object> ppgResult = ppgFeatureService.processAndStore(sessionId);
        Map<String, Object> eegResult = eegFeatureService.processAndStore(sessionId);
        Map<String, Object> motionResult = motionFeatureService.processAndStore(sessionId);

        Map<String, Object> merged = new LinkedHashMap<>();
        merged.put("sessionId", sessionId.toString());
        merged.put("ppgFeatures", ppgResult.get("ppgFeatures"));
        merged.put("eegFeatures", eegResult.get("eegFeatures"));
        merged.put("accFeatures", motionResult.get("accFeatures"));
        merged.put("gyroFeatures", motionResult.get("gyroFeatures"));

        return ResponseEntity.ok(merged);
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

            Map<String, Object> motionResult;
            try {
                motionResult = motionFeatureService.getStored(sessionId);
            } catch (IllegalArgumentException ex) {
                motionResult = Map.of(
                        "accFeatures", Map.of(),
                        "gyroFeatures", Map.of()
                );
            }

            Map<String, Object> merged = new LinkedHashMap<>();
            merged.put("sessionId", sessionId.toString());
            merged.put("ppgFeatures", ppgResult.get("ppgFeatures"));
            merged.put("eegFeatures", eegResult.get("eegFeatures"));
            merged.put("accFeatures", motionResult.get("accFeatures"));
            merged.put("gyroFeatures", motionResult.get("gyroFeatures"));

            return ResponseEntity.ok(merged);
        } catch (IllegalArgumentException ex) {
            return ResponseEntity.status(404).body(Map.of(
                    "status", "not_processed",
                    "message", ex.getMessage()
            ));
        }
    }
}
