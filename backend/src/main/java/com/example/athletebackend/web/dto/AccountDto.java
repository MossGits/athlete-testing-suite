package com.example.athletebackend.web.dto;

public record AccountDto(
        Long userId,
        String email,
        String role,
        Long organizationId,
        String organizationName,
        Long athleteProfileId,
        String firstName,
        String lastName
) {}
