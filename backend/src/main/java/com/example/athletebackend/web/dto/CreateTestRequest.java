package com.example.athletebackend.web.dto;

public record CreateTestRequest(String type, String notes) { } // type = BASELINE or ACTIVE
