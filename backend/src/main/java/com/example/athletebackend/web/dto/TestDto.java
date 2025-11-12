package com.example.athletebackend.web.dto;

import java.time.OffsetDateTime;

public record TestDto(Long id, Long athleteId, String type, OffsetDateTime startedAt,
                      OffsetDateTime completedAt, String notes) { }
