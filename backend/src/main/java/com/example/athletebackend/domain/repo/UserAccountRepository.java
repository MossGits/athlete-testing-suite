package com.example.athletebackend.domain.repo;

import com.example.athletebackend.domain.model.UserAccount;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface UserAccountRepository extends JpaRepository<UserAccount, Long> {
    Optional<UserAccount> findByEmail(String email);
    List<UserAccount> findByOrganization_Id(Long organizationId);
}
