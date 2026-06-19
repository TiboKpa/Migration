# Security

This document describes the security model of the Migration application, the controls that are implemented, and the hardening steps required before any production deployment.

---

## Authentication

- Passwords are hashed with **bcrypt** at a cost factor of 12.
- JWT tokens are signed with `JWT_SECRET` (HS256) and expire after **8 hours**.
- The JWT payload contains only the user `id`. Email and name are never stored in the token.
- On every authenticated request the middleware fetches the user record from the database, so revoked or deleted accounts are rejected immediately.
- Login uses a constant-time bcrypt comparison even when the email does not exist, preventing user enumeration through response timing.

## Authorization

- All API routes except `/api/auth/login` and `/api/auth/register` require a valid `Bearer` token.
- Every project sub-resource route (`/api/projects/:projectId/*`) enforces membership via the `requireMember` middleware. A user who is not a member of the project receives `403 Forbidden`, regardless of their token validity.
- Write operations (POST, PUT, DELETE) on sub-resources are further restricted to members with the `owner` or `editor` role.
- The destructive `DELETE /api/projects/:id/role-matrix` is restricted to `owner` only.

## Input Validation

- All request bodies are validated with **zod** schemas before reaching the database layer.
- Each field has explicit type, format, and maximum-length constraints.
- Bulk import endpoints are capped: 5000 users per import, 10000 role-matrix entries per import.
- File uploads (templates) are limited to **2 MB** and restricted to HTML files only (by MIME type and extension).

## Transport and Headers

- **helmet** is applied globally, injecting the following headers on every response:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: SAMEORIGIN`
  - `Strict-Transport-Security` (when behind HTTPS)
  - `Content-Security-Policy` (default helmet policy)
  - `X-XSS-Protection`
- **CORS** is restricted to the single origin defined in `ALLOWED_ORIGIN`. Wildcard origins are not permitted.

## Rate Limiting

- Auth endpoints are limited to **20 requests per 15-minute window** per IP using `express-rate-limit`.
- Responses include `RateLimit-*` standard headers.

## Secret Management

- The server performs a startup check and calls `process.exit(1)` if `JWT_SECRET` or `DB_PASSWORD` match any known placeholder value (`change_me`, `REPLACE_WITH_STRONG_SECRET`, `REPLACE_WITH_STRONG_PASSWORD`, or empty string).
- `JWT_SECRET` must be at least 32 random characters. Recommended generation: `openssl rand -hex 32`.
- `.env` is listed in `.gitignore` and must never be committed.

## Logging

- All HTTP requests are logged in Apache Combined Log Format via **morgan**.
- Internal errors (stack traces, DB messages) are written to `stderr` via `console.error` only. API responses always return the generic string `"Internal server error"` for 500-class errors.

## Database

- All queries use parameterized statements (pg `$1, $2, ...` placeholders). No string concatenation is used in SQL.
- The PostgreSQL container is on an isolated Docker bridge network (`migration_net`) and does not expose port 5432 externally.
- Database credentials are injected via environment variables, never hardcoded.

---

## Production Deployment Checklist

Before going live, verify every item below.

### Required

- [ ] `JWT_SECRET` is set to a unique random value of at least 32 characters (`openssl rand -hex 32`)
- [ ] `DB_PASSWORD` is set to a strong unique password
- [ ] `ALLOWED_ORIGIN` is set to the exact HTTPS URL of the frontend (e.g. `https://app.example.com`)
- [ ] `VITE_API_URL` points to the HTTPS backend URL
- [ ] A TLS-terminating reverse proxy (nginx, Caddy, or equivalent) is placed in front of both services
- [ ] Port 5432 is blocked at the firewall level
- [ ] Default seed credentials in `backend/db/init.sql` have been changed or removed

### Recommended

- [ ] Set up log aggregation (ship morgan logs to a SIEM or log management service)
- [ ] Enable automatic dependency vulnerability scanning (GitHub Dependabot or equivalent)
- [ ] Rotate `JWT_SECRET` on a scheduled basis and invalidate all active sessions when doing so
- [ ] Add a short-lived access token / refresh token pair to replace the 8-hour JWT if stricter session control is needed
- [ ] Place a WAF (Web Application Firewall) in front of the backend for additional rate limiting and payload inspection
- [ ] Document and test the disaster recovery procedure for the PostgreSQL volume

---

## Known Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| No JWT revocation / blacklist | Stolen tokens valid up to 8 h after theft | Rotate `JWT_SECRET` to invalidate all tokens immediately |
| Single `ALLOWED_ORIGIN` | Cannot serve multiple domains without code change | Update CORS config to accept an array from env |
| No HTTPS enforcement in-app | Relies entirely on reverse proxy | Document and enforce via deployment checklist |
| morgan logs to stdout only | No persistent audit trail by default | Ship container logs to a log management service |

---

## Reporting a Vulnerability

If you discover a security issue, please open a **private** GitHub issue or contact the repository owner directly. Do not disclose vulnerabilities publicly before they are resolved.
