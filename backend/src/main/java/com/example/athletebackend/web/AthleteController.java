package com.example.athletebackend.web;

import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.security.AppUserDetails;
import com.example.athletebackend.service.TestAccessService;
import com.example.athletebackend.web.dto.AthleteDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/athletes")
@RequiredArgsConstructor
public class AthleteController {
    private final AthleteProfileRepository athletes;
    private final TestAccessService access;

    // Existing: fetch a specific athlete by id, with access checks
    @GetMapping("/{athleteId}")
    public AthleteDto getAthlete(@PathVariable Long athleteId) {
        access.assertCanViewAthlete(athleteId);
        var a = athletes.findById(athleteId).orElseThrow();
        return new AthleteDto(
                a.getId(),
                a.getFirstName(),
                a.getLastName(),
                a.getUser().getId(),
                a.getUser().getOrganization().getId()
        );
    }

    // NEW: Athlete fetches THEIR OWN athlete profile (returns athleteId, names, userId, orgId)
    @GetMapping("/me")
    public AthleteDto me(Authentication auth) {
        var d = toUser(auth);
        // Only athlete accounts have an AthleteProfile; trainers will get 403 here
        var a = athletes.findByUser_Id(d.getUserId())
                .orElseThrow(() -> new AccessDeniedException("No athlete profile for this account"));
        return new AthleteDto(
                a.getId(),
                a.getFirstName(),
                a.getLastName(),
                a.getUser().getId(),
                a.getUser().getOrganization().getId()
        );
    }

    // NEW: Trainer lists all athletes in their organization
    @GetMapping("/in-org")
    public List<AthleteDto> inOrg(Authentication auth) {
        var d = toUser(auth);
        var role = d.getAuthorities().iterator().next().getAuthority();
        if (!"ROLE_TRAINER".equals(role)) {
            throw new AccessDeniedException("Only trainers can list athletes in org");
        }
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

    private AppUserDetails toUser(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof AppUserDetails d)) {
            throw new AccessDeniedException("Not authenticated");
        }
        return d;
    }
}
