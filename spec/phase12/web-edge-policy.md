# Phase 12.2 — web edge policy, quotas, readiness, and shutdown

This vertical completes the direct-TLS/trusted-proxy and bounded-request portions of WN5, WN7,
WN8, and WN9. It wraps the existing command, session-lifecycle, and SSE authority; it does not
introduce another fleet state machine and has no homelab integration.

## EP1 — canonical client address has one trust boundary

Direct requests use the socket peer address. Forwarded address headers are ignored unless the
immediate peer exactly matches an explicitly configured trusted-proxy allowlist. Trusted requests
accept one bounded, strictly parsed forwarding chain and select the configured hop; malformed,
overlong, ambiguous, or mixed forwarding headers fail typed before authentication/provider/body
work. Audit records retain only a presence/classification and a keyed address digest, never the raw
address. Empty proxy trust means direct mode.

## EP2 — deterministic bounded quota authority

A dependency-free quota authority enforces fixed-window limits with an injected clock, bounded key
cardinality, deterministic expiry, and no randomness. Separate policies cover unauthenticated login
attempts per canonical address, all HTTP requests per address, authenticated commands per
credential, weighted command cost, stream-ticket issuance, and concurrent connections. Limit
configuration rejects zero, negative, non-integer, unbounded, or internally inconsistent values.

## EP3 — refusal precedes expensive or privileged work

The address quota runs before body parsing, identity-provider execution, session mutation, or
coordinator dispatch. Login throttling therefore bounds provider calls. Principal/cost quota runs
after authentication but before durable command admission or dispatch. Refusal returns bounded
`429 rate_limited` plus `Retry-After`, is audited fail closed, and mutates no session, command,
worker, or stream state. Client-supplied IDs cannot choose a quota bucket.

## EP4 — trusted-proxy and TLS modes are explicit

Direct production mode requires TLS on the accepted socket. Proxy mode may accept a cleartext
backend socket only when the immediate peer is trusted and an exact configured forwarding signal
proves the original request was HTTPS. Untrusted `Forwarded`/`X-Forwarded-*` headers never upgrade
transport, alter address quotas, or enter audit identity. The server refuses proxy mode without a
nonempty peer allowlist and refuses direct mode without TLS key/certificate material.

## EP5 — health and readiness reveal no fleet state

`GET /healthz` reports only process liveness. `GET /readyz` reports a single ready/not-ready bit and
fails when operational log/coordination authority, session ledger/liveness verification, command
idempotency storage, or admission state is unavailable. Neither endpoint returns worker, task,
repository, credential, provider, path, error, or dependency detail. Readiness probes are
independently quota-bounded.

## EP6 — graceful shutdown changes admission, not worker truth

Shutdown atomically stops new login, refresh, command, ticket, and stream admission; readiness
turns false; accepted HTTP responses receive a bounded drain interval; open streams receive a
bounded reconnect/shutdown control frame and close; the HTTPS listener closes. Shutdown never
interrupts/kills workers and never claims worker death. Repeated shutdown is idempotent and
bounded, including broken sockets and audit failures.

## EP7 — durable audit and restart posture

Quota refusal, proxy refusal, readiness transition, shutdown start, and shutdown completion are
append-only audited without raw addresses or credentials. Quota counters are operational abuse
state and may reset on process restart; command/session/idempotency truth remains durable and is not
derived from them. Audit failure returns no admission success.

## EP8 — deterministic and recursive acceptance

Tests cover direct/untrusted/trusted proxy address resolution, spoof and malformed chains,
forwarded HTTPS handling, login/provider throttling, address/principal/cost separation, expiry and
bounded cardinality, `Retry-After`, no-mutation refusal, health/readiness non-disclosure, shutdown
drain/idempotency/no-fleet-effects, and configuration refusal. The complete Phase 12 suite and full
suite pass. Recursive Baton build and detached adversarial review use exact harness/model/effort,
fresh verification, integration, confirmed kill, and complete reap.

## EP9 — remaining browser and transport scope

OIDC redirect/callback details, optional WebSocket parity, MCP/operator UI, and the real browser
automation sequence remain subsequent WN9 scope. They consume this edge policy; they are not
silently claimed by it.
