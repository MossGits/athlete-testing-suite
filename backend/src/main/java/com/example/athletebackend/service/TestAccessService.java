package com.example.athletebackend.service;

import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.domain.repo.TestSessionRepository;
import com.example.athletebackend.security.Authz;
import lombok.RequiredArgsConstructor;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class TestAccessService {
    private final TestSessionRepository tests;
    private final AthleteProfileRepository athletes;

    public void assertCanViewAthlete(Long athleteId) {
        var me = Authz.current();
        if (me == null) throw new AccessDeniedException("Not authenticated");
        var authority = me.getAuthorities().iterator().next().getAuthority();

        if ("ROLE_ATHLETE".equals(authority)) {
            var myAthlete = athletes.findByUser_Id(me.getUserId())
                    .orElseThrow(() -> new AccessDeniedException("No athlete profile"));
            if (!myAthlete.getId().equals(athleteId)) {
                throw new AccessDeniedException("Athletes can only view their own data");
            }
        } else if ("ROLE_TRAINER".equals(authority)) {
            var athlete = athletes.findById(athleteId)
                    .orElseThrow(() -> new AccessDeniedException("Athlete not found"));
            if (!athlete.getUser().getOrganization().getId().equals(me.getOrgId())) {
                throw new AccessDeniedException("Cross-org access denied");
            }
        }
    }
}
