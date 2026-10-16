# Phase 12 authenticated web northbound — first command vertical — 2026-07-11

## Verdict

PASS for the first authenticated HTTPS command vertical. It is an adapter over the existing
coordinator and durable coordination stream, not a second fleet authority. WN1–WN10 as a whole is
still in progress.

Shipped behavior:

- `WebNorthbound.execute()` authenticates before command admission and derives the audit actor
  from the authenticated user/session; request JSON cannot choose it.
- Exact configured origins, cookie-session CSRF, command capability, and repository allowlists
  fail before coordinator dispatch. Revoked and expired identities fail closed.
- A strict versioned envelope rejects unknown top-level, command, and model-policy fields plus
  credential-bearing fields. Fence-sensitive send/interrupt/kill commands require a fence.
- Spawn carries `harness`, exact `model`, and `modelPolicy` as independent controls. It also gives
  the coordinator a deterministic task/idempotency identity.
- Coordination events durably admit and complete commands. Principal/command/repository-scoped
  idempotency survives restart: an identical retry returns the original outcome and a different
  body conflicts without a coordinator mutation.
- A completion-audit append failure returns no successful result. An admitted command with no
  durable completion replays as pending rather than dispatching twice.
- The built-in HTTP adapter accepts only bounded `application/json`, emits no-store typed JSON,
  and the server constructor refuses missing TLS material or an authenticator.
- `WebSessionStore` issues opaque high-entropy cookie or Bearer credentials exactly once, stores
  only SHA-256 credential/CSRF digests under mode-0700/0600 paths, returns sanitized principals,
  enforces bounded credential syntax and expiry, refuses mixed credential modes and URL tokens,
  and durably revokes a session across restart. Browser cookies are `__Host-`, `Secure`,
  `HttpOnly`, `SameSite=Strict`, path `/`, and bounded by `Max-Age`.
- The session registry is directly proven as the web authenticator: a cookie plus its CSRF value
  admits a scoped command, immediate revocation blocks the next request, and neither secret enters
  coordination events.
- The real coordinator checks externally supplied interrupt/kill fences before calling an
  adapter. A stale stop leaves the worker working; the current fence confirms stop and reaps it.

## Validation

```text
node --test impl/test/phase12-web-auth.test.mjs impl/test/phase12-web-northbound.test.mjs
16/16 passing

cd impl && node --test
542/542 passing
```

The focused suite covers authentication, expiry/revocation, origin, CSRF, capability and repo
scope, exact harness/model forwarding, non-forgeable audit identity, strict schema/model policy,
durable restart replay, idempotency conflict, missing and stale fences, audit append failure,
bounded HTTP/CORS admission, non-leaking dispatch errors, TLS/auth server refusal, and real
coordinator stop/reap behavior. It also covers one-time cookie/Bearer issue, secret-free durable
storage, filesystem modes, expiry, malformed/mixed/URL credential refusal, restart-safe revocation,
and registry-to-command integration.

## Remaining WN gates

- Identity-provider login/bootstrap, refresh/key rotation, and authenticated logout endpoints;
  durable issue/expiry/revocation and restrictive hashed secret storage ship in this slice.
- Rate, size, connection, login, and command-cost quotas with trusted-proxy handling.
- Resumable ordered WebSocket or SSE streaming, cursor expiry, snapshot boundaries, bounded
  buffers, and explicit slow-client gaps.
- Durable command-status recovery/reconciliation for the admitted-before-dispatch crash window.
- Browser login/command/reconnect/approval/emergency-kill/logout automation and CSRF, IDOR,
  replay, WebSocket-hijack, token-leakage, privilege-escalation, and DoS adversarial review.

No homelab integration or dependency is part of this surface.
