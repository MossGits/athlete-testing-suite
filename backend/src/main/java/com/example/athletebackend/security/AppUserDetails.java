package com.example.athletebackend.security;

import com.example.athletebackend.domain.model.UserAccount;
import org.springframework.security.core.*;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.List;

public class AppUserDetails implements UserDetails {
    private final UserAccount user;

    public AppUserDetails(UserAccount user) { this.user = user; }

    public Long getUserId() { return user.getId(); }
    public Long getOrgId() { return user.getOrganization().getId(); }

    @Override public List<GrantedAuthority> getAuthorities() {
        return List.of(new SimpleGrantedAuthority(user.getRole().name()));
    }
    @Override public String getPassword() { return user.getPasswordHash(); }
    @Override public String getUsername() { return user.getEmail(); }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return true; }
}
