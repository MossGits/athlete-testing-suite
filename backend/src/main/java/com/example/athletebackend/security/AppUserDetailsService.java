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

    @Override
    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        UserAccount u = users.findByEmail(email)
                .orElseThrow(() -> new UsernameNotFoundException("No user: " + email));

        // Expecting enum roles like ROLE_ATHLETE / ROLE_TRAINER via prefix below
        var auths = List.of(new SimpleGrantedAuthority("ROLE_" + u.getRole().name()));
        return new AppUserDetails(u, auths);
    }
}
