# Phase 12 browser OIDC and operator evidence — 2026-07-11

BO1–BO7 and BU1–BU7 now supply a concrete browser identity and control seam over Baton's existing
authenticated command and resumable SSE authority. Baton remains a relying party and thin client;
it does not become an identity provider or create parallel fleet state.

## Browser OIDC bootstrap

- Authorization Code + PKCE S256 uses bounded cryptographic state, nonce, verifier, and a separate
  HttpOnly SameSite-Lax callback cookie so state is bound to the initiating browser.
- Callback consumes state before provider work and is one-time across wrong-cookie, replay,
  malformed, expired, and provider-refused paths.
- The injected exchange/verifier receives the secret verifier and expected issuer/nonce. Baton
  independently checks exact issuer, bounded audience including its client ID, subject, nonce, and
  claims size before a constrained mapper can choose user/capability/repository/TTL claims.
- Provider and mapper calls are time-bounded and receive cancellation. Ignored cancellation keeps
  one bounded detached-capacity slot rather than allowing unbounded exchange accumulation.
- Successful callback audits before issuing the existing durable cookie session, sets the strict
  session plus readable non-credential CSRF cookies, clears flow state, and redirects 303 to the
  fixed clean `/control` URL. Synchronous delivery failure revokes the exact issued session.

## Minimal operator seat

- `/control`, its script/style, and `/v1/session` require an active HTTPS cookie session with
  `observe` and the served repository scope. Assets are no-store, nosniff, frame-denied, and bound
  by a self-only script/style/connect CSP.
- Session projection returns only user, capabilities, repository scopes, and expiry.
- The dispatch rail carries harness, exact model, and effort independently into the existing
  schema-v1 command envelope with cryptographic command/idempotency IDs.
- Worker controls use observed fences for send/interrupt/kill and existing request IDs for
  approvals. Stream tickets, EventSource, and logout use the existing server routes and CSRF
  contract. Rendered server data uses `textContent`; the event display is bounded.
- The visual treatment is an intentional compact control instrument—route rail, current authority,
  signal ledger—rather than a second dashboard/state model.

## Validation

- OIDC: 9/9 BO tests.
- Operator: 3/3 BU tests.
- Combined Phase 12 browser/edge/session/auth/northbound/stream: 94/94.
- Full canonical suite: 672/672 with zero owned suite roots left in the configured temp parent.
- `git diff --check` passes.
- A real local TLS socket proof passed all eight machine checks: OIDC start, fake-provider PKCE
  redirect, callback/session issuance, authenticated operator page, sanitized session projection,
  command submission, stream-ticket/SSE snapshot, and logout/revocation. The listener shut down
  and its owned `baton-browser-wire-*` state count returned to zero. Raw reusable runner and summary
  are under `docs/reference/evidence/phase12-browser-control-wire-2026-07-11/`.

The in-app browser's required execution bridge was not exposed in this session, so the TLS proof is
not mislabeled as browser automation. Real local browser interaction, a production OIDC provider adapter, optional WebSocket parity,
admitted-command reconciliation, MCP/deeper operator surfaces, and provider-backed adversarial
review remain pending. No homelab integration was added.
