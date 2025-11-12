package com.example.athletebackend.security;

import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;

public class Authz {
    public static AppUserDetails current() {
        Authentication a = SecurityContextHolder.getContext().getAuthentication();
        if (a == null || !(a.getPrincipal() instanceof AppUserDetails d)) return null;
        return d;
    }
}
