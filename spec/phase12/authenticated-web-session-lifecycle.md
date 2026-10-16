# Phase 12.1 — authenticated web session lifecycle

This vertical completes the missing WN2 login/bootstrap, refresh/credential rotation, and logout
HTTP lifecycle without making Baton an identity provider. It extends the opaque, hashed-at-rest
`WebSessionStore`, uses the existing web authority, and has no homelab integration.

## IL1 — identity is injected, never self-asserted

`POST /v1/auth/login` delegates the bounded credential body to a configured identity-provider
callback. Only that callback may return `userId`, capabilities, repository scopes, and TTL policy.
Request JSON cannot directly choose those claims. Missing/throwing/refusing providers fail with the
same bounded `unauthenticated` response and no session issuance.

## IL2 — durable one-time credential rotation

Refresh creates a new random credential and CSRF value where applicable while preserving the
authenticated session's user, method, capabilities, and repository scopes. One durable
`session.rotated` append atomically installs the successor and revokes the predecessor before any
new token/cookie is returned. Restart preserves both facts; reuse of the old credential fails.
Rotation never accepts claim/TTL expansion from request JSON.

## IL3 — explicit HTTPS routes and browser defenses

`POST /v1/auth/login`, `/v1/auth/refresh`, and `/v1/auth/logout` require HTTPS, exact configured
Origin, JSON, bounded bodies, and `Cache-Control: no-store`. Refresh/logout require current
authentication; cookie sessions additionally require the session-bound CSRF header. Login does not
use CSRF because no session exists yet, but remains exact-origin and non-simple. CORS never uses a
wildcard with credentials.

## IL4 — cookie and bearer response posture

Browser login/rotation returns only a strict host-only `Secure; HttpOnly; SameSite=Strict` cookie,
the CSRF value, stable sanitized identity, and expiry. Logout returns the strict clearing cookie.
Bearer lifecycle returns the one-time token only in the JSON response. No credential appears in a
URL, audit/event record, error, or provider callback metadata.

## IL5 — fail-closed audit and mutation ordering

Login refusal, issuance, refresh refusal, rotation, logout, and revocation are append-only audited.
Session-store append failure returns no new credential or success. Required coordination audit
failure also returns no success; where a session mutation already committed, the response is
`temporarily_unavailable` and retry/re-authentication reconciles from durable session truth rather
than undoing or duplicating the credential.

## IL6 — revocation reaches open streams without fleet control

Rotation/logout makes the old principal inactive immediately. Existing SSE streams close at their
next liveness check and future commands/tickets/reconnects fail. No lifecycle route interrupts,
kills, or otherwise changes worker state.

## IL7 — deterministic acceptance gate

Tests prove injected-provider-only claims; exact Origin/TLS/content type/body bounds; cookie CSRF;
atomic rotate/restart/old-token refusal; logout/clear-cookie/idempotent hidden existence; bearer and
cookie paths; append/audit failures; no credential leakage; open-stream revocation; and zero
coordinator fleet calls from auth lifecycle routes. A recursive Baton build and detached review
must fresh-verify and completely reap.

## IL8 — deferred boundaries stay visible

OIDC redirect/callback details, login throttling, per-IP/principal command quotas, trusted-proxy
address resolution, optional WebSocket parity, and browser automation remain WN5/WN8/WN9 work.
This vertical supplies the lifecycle seam they will exercise; it does not claim those gates.
