# Phase 12 authenticated web session lifecycle evidence — 2026-07-11

IL1–IL8 now ship injected-provider HTTPS login, cookie and Bearer issuance, atomic refresh/token
rotation, logout/revocation, and live stream invalidation without fleet-control side effects.

- 44 focused Phase 12 lifecycle/auth/command/stream contracts pass.
- The full implementation suite passes 619/619.
- Session issue/rotate/revoke records are hashed-at-rest, append-only, fsynced before in-memory
  apply and response, restart-validated, and stored with restrictive permissions.
- Rotation is one durable event that revokes the predecessor and installs a claim-identical
  successor. Old credentials fail immediately and after restart.
- Coordination authorization audit precedes session mutation, so an audit outage consumes no
  credential. Session-store failure returns no success or new credential.
- Login claims come only from the injected provider and are revalidated by the session store;
  request JSON cannot select user, capability, repository, or TTL authority.
- Exact HTTPS Origin, bounded JSON, cookie CSRF, strict host-only cookies, credentialed CORS, and
  no-store responses are covered. Raw tokens/CSRF/provider credentials do not enter URLs, durable
  events, audits, errors, or SSE frames.
- Rotate/logout invalidates established SSE liveness but never interrupts or kills workers.
- Recursive Baton used exact `CodexAppServerCli` + `gpt-5.6-sol` + `low`, fresh-verified,
  integrated, confirmed kill, and removed process/worktree/runtime/branch on every run. The first
  review found durability, post-audit mutation, and provider-validation defects; the correction
  review found no actionable IL1–IL8 defect.

Raw build/review ledgers and reports are under
`docs/reference/evidence/phase12-web-session-lifecycle-codex-{build,review}-2026-07-11/`.

OIDC redirect/callback specifics, login throttling, per-IP/principal quotas, trusted proxy
configuration, optional WebSocket parity, and real browser automation remain explicit WN5/WN8/WN9
scope. No homelab integration was added.
