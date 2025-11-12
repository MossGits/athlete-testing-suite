package com.example.athletebackend.security;

import com.example.athletebackend.domain.repo.UserAccountRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.*;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AppUserDetailsService implements UserDetailsService {
    private final UserAccountRepository users;

    @Override
    public UserDetails loadUserByUsername(String username) throws UsernameNotFoundException {
        var user = users.findByEmail(username)
                .orElseThrow(() -> new UsernameNotFoundException("User not found"));
        return new AppUserDetails(user);
    }
}
