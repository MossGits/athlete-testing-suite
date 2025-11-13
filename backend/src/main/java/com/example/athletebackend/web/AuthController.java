package com.example.athletebackend.web;

import com.example.athletebackend.domain.model.*;
import com.example.athletebackend.domain.repo.*;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private final UserAccountRepository users;
    private final OrganizationRepository orgs;
    private final AthleteProfileRepository athletes;
    private final BCryptPasswordEncoder encoder;

    public record RegisterRequest(String email, String password, String role, String organization,
                                  String firstName, String lastName) { }
    public record MeResponse(Long userId, String email, String role, Long organizationId) { }

    @PostMapping("/register")
    public MeResponse register(@Valid @RequestBody RegisterRequest req) {
        var org = orgs.findByName(req.organization())
                .orElseGet(() -> orgs.save(Organization.builder().name(req.organization()).build()));

        var role = switch (req.role().toUpperCase()) {
            case "ATHLETE" -> UserRole.ATHLETE;
            case "TRAINER" -> UserRole.TRAINER;
            default -> throw new IllegalArgumentException("Invalid role (use ATHLETE or TRAINER)");
        };

        users.findByEmail(req.email()).ifPresent(u -> { throw new IllegalArgumentException("Email already registered"); });

        var user = users.save(UserAccount.builder()
                .email(req.email())
                .passwordHash(encoder.encode(req.password()))
                .role(role)
                .organization(org)
                .build());

        // Auto-create athlete profile for ATHLETE accounts
        if (role == UserRole.ATHLETE) {
            var first = (req.firstName() == null || req.firstName().isBlank()) ? "Athlete" : req.firstName().trim();
            var last  = (req.lastName()  == null || req.lastName().isBlank())  ? "User"    : req.lastName().trim();
            athletes.save(AthleteProfile.builder()
                    .user(user)
                    .firstName(first)
                    .lastName(last)
                    .build());
        }

        return new MeResponse(user.getId(), user.getEmail(), user.getRole().name(), org.getId());
    }

    @GetMapping("/me")
    public MeResponse me(Authentication auth) {
        if (auth == null) return null;
        var principal = (com.example.athletebackend.security.AppUserDetails) auth.getPrincipal();
        return new MeResponse(principal.getUserId(), principal.getUsername(),
                principal.getAuthorities().iterator().next().getAuthority(),
                principal.getOrgId());
    }
}
