package com.example.athletebackend.security;

import com.example.athletebackend.domain.model.UserAccount;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.userdetails.UserDetails;

import java.util.Collection;

public class AppUserDetails implements UserDetails {
    private final Long userId;
    private final Long orgId;
    private final String email;
    private final String password;
    private final Collection<? extends GrantedAuthority> authorities;
    private final boolean enabled;

    public AppUserDetails(UserAccount u,
                          Collection<? extends GrantedAuthority> authorities) {
        this.userId = u.getId();
        this.orgId = (u.getOrganization() != null ? u.getOrganization().getId() : null);
        this.email = u.getEmail();
        this.password = u.getPasswordHash();
        this.authorities = authorities;
        this.enabled = true;
    }

    public Long getUserId() { return userId; }
    public Long getOrgId() { return orgId; }

    @Override public Collection<? extends GrantedAuthority> getAuthorities() { return authorities; }
    @Override public String getPassword() { return password; }
    @Override public String getUsername() { return email; }
    @Override public boolean isAccountNonExpired() { return true; }
    @Override public boolean isAccountNonLocked() { return true; }
    @Override public boolean isCredentialsNonExpired() { return true; }
    @Override public boolean isEnabled() { return enabled; }
}
