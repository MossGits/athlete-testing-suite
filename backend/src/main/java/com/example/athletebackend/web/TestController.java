package com.example.athletebackend.web;

import com.example.athletebackend.domain.model.TestSession;
import com.example.athletebackend.domain.model.TestType;
import com.example.athletebackend.domain.repo.AthleteProfileRepository;
import com.example.athletebackend.domain.repo.TestSessionRepository;
import com.example.athletebackend.service.TestAccessService;
import com.example.athletebackend.web.dto.CreateTestRequest;
import com.example.athletebackend.web.dto.TestDto;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import java.time.OffsetDateTime;
import java.util.List;

@RestController
@RequestMapping("/api/tests")
@RequiredArgsConstructor
public class TestController {
    private final AthleteProfileRepository athletes;
    private final TestSessionRepository tests;
    private final TestAccessService access;

    @GetMapping("/by-athlete/{athleteId}")
    public List<TestDto> list(@PathVariable Long athleteId) {
        access.assertCanViewAthlete(athleteId);
        return tests.findByAthlete_Id(athleteId).stream()
                .map(t -> new TestDto(t.getId(), t.getAthlete().getId(), t.getType().name(),
                        t.getStartedAt(), t.getCompletedAt(), t.getNotes()))
                .toList();
    }

    @PostMapping("/by-athlete/{athleteId}")
    public TestDto create(@PathVariable Long athleteId, @RequestBody CreateTestRequest req) {
        access.assertCanViewAthlete(athleteId);
        var athlete = athletes.findById(athleteId).orElseThrow();
        var test = tests.save(TestSession.builder()
                .athlete(athlete)
                .type(TestType.valueOf(req.type().toUpperCase()))
                .startedAt(OffsetDateTime.now())
                .notes(req.notes())
                .build());
        return new TestDto(test.getId(), athleteId, test.getType().name(), test.getStartedAt(), test.getCompletedAt(), test.getNotes());
    }

    @PostMapping("/{testId}/complete")
    public TestDto complete(@PathVariable Long testId) {
        var t = tests.findById(testId).orElseThrow();
        access.assertCanViewAthlete(t.getAthlete().getId());
        t.setCompletedAt(OffsetDateTime.now());
        t = tests.save(t);
        return new TestDto(t.getId(), t.getAthlete().getId(), t.getType().name(), t.getStartedAt(), t.getCompletedAt(), t.getNotes());
    }
}
