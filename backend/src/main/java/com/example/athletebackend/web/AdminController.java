package com.example.athletebackend.web;

import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.domain.repo.UserAccountRepository;
import com.example.athletebackend.security.AppUserDetails;
import com.example.athletebackend.web.dto.AccountDto;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final UserAccountRepository users;
    private final AthleteProfileRepository athletes;

    @GetMapping("/accounts")
    @Transactional(readOnly = true)
    public List<AccountDto> listAccounts(Authentication auth) {
        var d = asUser(auth);

        boolean isTrainer = d.getAuthorities().stream()
                .anyMatch(a -> "ROLE_TRAINER".equals(a.getAuthority()));
        boolean isAthlete = d.getAuthorities().stream()
                .anyMatch(a -> "ROLE_ATHLETE".equals(a.getAuthority()));

        if (isTrainer) {
            var list = users.findByOrganization_Id(d.getOrgId());
            return list.stream().map(u -> {
                var ap = athletes.findByUser_Id(u.getId()).orElse(null);
                return new AccountDto(
                        u.getId(),
                        u.getEmail(),
                        u.getRole().name(),
                        u.getOrganization().getId(),
                        u.getOrganization().getName(),
                        ap == null ? null : ap.getId(),
                        ap == null ? null : ap.getFirstName(),
                        ap == null ? null : ap.getLastName()
                );
            }).toList();
        }

        if (isAthlete) {
            var u = users.findById(d.getUserId()).orElseThrow();
            var ap = athletes.findByUser_Id(u.getId()).orElse(null);
            return List.of(new AccountDto(
                    u.getId(),
                    u.getEmail(),
                    u.getRole().name(),
                    u.getOrganization().getId(),
                    u.getOrganization().getName(),
                    ap == null ? null : ap.getId(),
                    ap == null ? null : ap.getFirstName(),
                    ap == null ? null : ap.getLastName()
            ));
        }

        throw new AccessDeniedException("Unsupported role");
    }

    private AppUserDetails asUser(Authentication auth) {
        if (auth == null || !(auth.getPrincipal() instanceof AppUserDetails d)) {
            throw new AccessDeniedException("Not authenticated");
        }
        return d;
    }
}
