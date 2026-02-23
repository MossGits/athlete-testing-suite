package com.example.athletebackend.web;

import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.security.AppUserDetails;
import com.example.athletebackend.web.dto.AthleteDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/trainer")
@RequiredArgsConstructor
public class TrainerController {

    private final AthleteProfileRepository athletes;

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

    private AppUserDetails toUser(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof AppUserDetails d)) {
            throw new AccessDeniedException("Not authenticated");
        }
        return d;
    }
}
