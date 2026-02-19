package com.example.athletebackend.controller;

import com.example.athletebackend.model.TestEvent;
import com.example.athletebackend.model.TestSession;
import com.example.athletebackend.repo.TestEventRepo;
import com.example.athletebackend.repo.TestSessionRepo;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/sessions")
public class TestSessionController {

    private final TestSessionRepo sessions;
    private final TestEventRepo events;
    private final ObjectMapper objectMapper;

    public TestSessionController(TestSessionRepo sessions, TestEventRepo events, ObjectMapper objectMapper) {
        this.sessions = sessions;
        this.events = events;
        this.objectMapper = objectMapper;
    }

    // DTOs
    public record CreateSessionRequest(String athleteId, String mode) {}
    public record CreateSessionResponse(String sessionId, String athleteId, String mode, String status, String createdAt) {}

    public record EventDto(Long tEpochMs, String type, String task, Integer trial, Map<String, Object> payload) {}

    @PostMapping
    public ResponseEntity<CreateSessionResponse> createSession(@RequestBody CreateSessionRequest body, Authentication auth) {
        UUID id = UUID.randomUUID();

        TestSession s = new TestSession();
        s.setId(id);
        s.setAthleteRef(body.athleteId());
        s.setMode(body.mode() != null ? body.mode() : "UNKNOWN");
        s.setStatus("CREATED");
        s.setCreatedBy(auth != null ? auth.getName() : null);
        s.setCreatedAt(OffsetDateTime.now());

        sessions.save(s);

        return ResponseEntity.ok(new CreateSessionResponse(
                id.toString(),
                s.getAthleteRef(),
                s.getMode(),
                s.getStatus(),
                s.getCreatedAt().toString()
        ));
    }

    @PostMapping("/{sessionId}/start")
    public ResponseEntity<?> start(@PathVariable UUID sessionId) {
        TestSession s = sessions.findById(sessionId).orElseThrow();
        if (!"RUNNING".equals(s.getStatus())) {
            s.setStatus("RUNNING");
            s.setStartedAt(OffsetDateTime.now());
            sessions.save(s);
        }
        return ResponseEntity.ok(Map.of("status", s.getStatus()));
    }

    @PostMapping("/{sessionId}/events")
    public ResponseEntity<?> addEvents(@PathVariable UUID sessionId, @RequestBody List<EventDto> batch) {
        // ensure session exists
        sessions.findById(sessionId).orElseThrow();

        List<TestEvent> toSave = new ArrayList<>(batch.size());
        for (EventDto e : batch) {
            if (e == null) continue;
            if (e.tEpochMs == null || e.type == null) continue;

            TestEvent te = new TestEvent();
            te.setSessionId(sessionId);
            te.setTEpochMs(e.tEpochMs);
            te.setType(e.type);
            te.setTask(e.task);
            te.setTrial(e.trial);

            // payload map -> json string (or null)
            try {
                te.setPayload(e.payload != null ? objectMapper.writeValueAsString(e.payload) : null);
            } catch (Exception ex) {
                // if payload serialization fails, still save event without payload
                te.setPayload(null);
            }

            toSave.add(te);
        }

        events.saveAll(toSave);
        return ResponseEntity.ok(Map.of("saved", toSave.size()));
    }

    @PostMapping("/{sessionId}/complete")
    public ResponseEntity<?> complete(@PathVariable UUID sessionId) {
        TestSession s = sessions.findById(sessionId).orElseThrow();
        s.setStatus("COMPLETE");
        if (s.getStartedAt() == null) s.setStartedAt(OffsetDateTime.now());
        s.setEndedAt(OffsetDateTime.now());
        sessions.save(s);
        return ResponseEntity.ok(Map.of("status", s.getStatus(), "endedAt", s.getEndedAt().toString()));
    }

    @GetMapping("/{sessionId}")
    public ResponseEntity<?> get(@PathVariable UUID sessionId) {
        TestSession s = sessions.findById(sessionId).orElseThrow();
        return ResponseEntity.ok(Map.of(
                "sessionId", s.getId().toString(),
                "athleteId", s.getAthleteRef(),
                "mode", s.getMode(),
                "status", s.getStatus(),
                "createdAt", s.getCreatedAt().toString(),
                "startedAt", s.getStartedAt() != null ? s.getStartedAt().toString() : null,
                "endedAt", s.getEndedAt() != null ? s.getEndedAt().toString() : null
        ));
    }
}
