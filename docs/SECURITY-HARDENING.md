# Security Hardening

This document summarizes hardening controls added to `a2a-verification-network`.

## Threat model

Primary risks:

- Unauthorized access to verification mutations.
- Replay and session abuse on token lifecycle endpoints.
- Cross-site request forgery against browser-based operator panels.
- Input-based payload injection in validator/job metadata.

## Controls

### Authentication and authorization

- JWT access token validation via `JwtStrategy` + `JwtAuthGuard`.
- Role checks via `RolesGuard` and `@Roles(...)` metadata.
- Public endpoint bypass via `@Public()`.

### Token lifecycle

- `RefreshTokenService` issues access/refresh pairs.
- Refresh token rotation revokes the previous token.
- In-memory revocation list blocks replay after rotation/revoke.

### Credential handling

- `PasswordService` hashes with `scrypt` (`N=16384`, `r=8`, `p=1`).
- Verification uses constant-time `timingSafeEqual`.
- Helper includes basic password strength checks.

### Request protection

- `SecurityHeadersMiddleware` sets defensive browser headers:
  - `X-Content-Type-Options`
  - `X-Frame-Options`
  - `Content-Security-Policy`
  - `Strict-Transport-Security`
- `CsrfMiddleware` enforces signed double-submit tokens on mutating requests.
- `SanitizePipe` strips HTML/script-style payload content.

### Rate and abuse limits

- Dual-tier throttling via `@nestjs/throttler`.
- Health/readiness remain exempt where operationally required.

## Operational recommendations

- Rotate JWT/CSRF secrets per environment.
- Persist refresh token revocation for multi-instance deployment.
- Wire audit logs to centralized SIEM and alert on role/CSRF violations.
