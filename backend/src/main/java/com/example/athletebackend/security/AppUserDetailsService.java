package com.example.athletebackend.security;

import com.example.athletebackend.domain.model.UserAccount;
import com.example.athletebackend.domain.repo.UserAccountRepository;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class AppUserDetailsService implements UserDetailsService {

    private final UserAccountRepository users;

    public AppUserDetailsService(UserAccountRepository users) {
        this.users = users;
    }

    // src/main/java/com/example/athletebackend/security/AppUserDetailsService.java
    @Override
    public UserDetails loadUserByUsername(String email) {
        var u = users.findByEmail(email).orElseThrow(() -> new UsernameNotFoundException(email));

        // normalize: accept either TRAINER/ATHLETE or ROLE_TRAINER/ROLE_ATHLETE from DB
        String raw = u.getRole().name();                      // if role is an enum
        String roleNoPrefix = raw.startsWith("ROLE_") ? raw.substring(5) : raw;

        var auths = List.of(new SimpleGrantedAuthority("ROLE_" + roleNoPrefix));
        return new AppUserDetails(u, auths);
    }
}
