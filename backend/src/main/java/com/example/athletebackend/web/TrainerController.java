package com.example.athletebackend.web;

import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.repo.TestSessionRepo;
import com.example.athletebackend.security.AppUserDetails;
import com.example.athletebackend.web.dto.AthleteDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/trainer")
@RequiredArgsConstructor
public class TrainerController {

    private final AthleteProfileRepository athletes;
    private final TestSessionRepo sessions;

    @GetMapping("/athletes")
    public List<AthleteDto> listAthletes(Authentication auth) {
        var d = toUser(auth);

        boolean isTrainer = d.getAuthorities().stream()
                .anyMatch(a -> "ROLE_TRAINER".equals(a.getAuthority()));
        if (!isTrainer) throw new AccessDeniedException("Only trainers can list athletes");

        return athletes.findByUser_Organization_Id(d.getOrgId()).stream()
                .map(a -> new AthleteDto(
                        a.getId(),
                        a.getFirstName(),
                        a.getLastName(),
                        a.getUser().getId(),
                        a.getUser().getOrganization().getId()
                ))
                .toList();
    }

    /**
     * List diagnostic sessions for a given athleteRef (this is what you store into test_session.athlete_ref).
     * Frontend calls: GET /api/trainer/athletes/{athleteRef}/tests
     */
    @GetMapping("/athletes/{athleteRef}/tests")
    public List<Map<String, Object>> listAthleteTests(
            @PathVariable String athleteRef,
            Authentication auth
    ) {
        var d = toUser(auth);

        boolean isTrainer = d.getAuthorities().stream()
                .anyMatch(a -> "ROLE_TRAINER".equals(a.getAuthority()));
        if (!isTrainer) throw new AccessDeniedException("Only trainers can view tests");

        // IMPORTANT: athleteRef must match what you stored when creating sessions (selectedAthlete.athleteProfileId)
        return sessions.findAllByAthleteRefOrderByCreatedAtDesc(athleteRef).stream()
                .map(s -> Map.<String, Object>of(
                        "sessionId", s.getId().toString(),
                        "athleteRef", s.getAthleteRef(),
                        "mode", s.getMode(),
                        "status", s.getStatus(),
                        "createdAt", s.getCreatedAt() != null ? s.getCreatedAt().toString() : null,
                        "startedAt", s.getStartedAt() != null ? s.getStartedAt().toString() : null,
                        "endedAt", s.getEndedAt() != null ? s.getEndedAt().toString() : null
                ))
                .toList();
    }

    private AppUserDetails toUser(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof AppUserDetails d)) {
            throw new AccessDeniedException("Not authenticated");
        }
        return d;
    }
}
