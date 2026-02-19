package com.example.athletebackend.model;

import jakarta.persistence.*;

import java.util.UUID;

@Entity
@Table(name = "test_event")
public class TestEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "session_id", nullable = false)
    private UUID sessionId;

    @Column(name = "t_epoch_ms", nullable = false)
    private Long tEpochMs;

    @Column(nullable = false)
    private String type;

    private String task;
    private Integer trial;

    @Column(columnDefinition = "jsonb")
    private String payload; // store JSON string

    // --- getters/setters ---
    public Long getId() { return id; }

    public UUID getSessionId() { return sessionId; }
    public void setSessionId(UUID sessionId) { this.sessionId = sessionId; }

    public Long getTEpochMs() { return tEpochMs; }
    public void setTEpochMs(Long tEpochMs) { this.tEpochMs = tEpochMs; }

    public String getType() { return type; }
    public void setType(String type) { this.type = type; }

    public String getTask() { return task; }
    public void setTask(String task) { this.task = task; }

    public Integer getTrial() { return trial; }
    public void setTrial(Integer trial) { this.trial = trial; }

    public String getPayload() { return payload; }
    public void setPayload(String payload) { this.payload = payload; }
}
