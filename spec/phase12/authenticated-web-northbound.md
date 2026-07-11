# Phase 12 — authenticated web northbound

This specification adds a secure human user ↔ orchestrator connection without introducing a
second fleet state machine. It implements goal catalog J and uses the durable coordination stream
from CK1–CK9. It has no homelab or deployment-specific runtime dependency.

## Implementation status — first command vertical

The first WN1–WN5/WN7/WN8 command and authentication vertical is executable in
`impl/src/web-northbound.mjs` and `impl/src/web-auth.mjs`. It provides the TLS-only server assembly,
bounded JSON HTTP adapter, durable one-time cookie/Bearer credential issuance, hashed-at-rest
credentials, expiry and restart-safe revocation, strict host-only browser cookies, exact
origin/CSRF and capability/repository authorization, strict command schemas, independent
harness/exact-model forwarding, fence-required worker control, durable restart-safe command
admission/completion/idempotency, derived audit actors, and fail-closed audit writes. Focused evidence is in
`docs/handoff/evidence/phase12-web-northbound-2026-07-11.md`.

The WN6 SSE fallback is also executable. It uses authenticated, origin/session/repository-bound,
single-use connection tickets; emits a snapshot boundary and stable coordination cursors; resumes
at-least-once delivery from `Last-Event-ID`; rejects expired cursors; bounds replay and pending
bytes; and disconnects without fleet-control side effects. Its recursive Baton build evidence is
in `docs/reference/evidence/phase12-web-stream-codex-build-2026-07-11/`.

The IL1–IL8 injected-provider login, refresh/credential rotation, and logout lifecycle now ships.
This is not WN1–WN10 completion. OIDC redirect/callback details, login throttling, complete
request/connection quotas, optional resumable WebSocket parity, trusted-proxy configuration,
command-status reconciliation for
admitted-but-incomplete commands, browser UI automation, and the full adversarial gate remain
active scope.

The shipped lifecycle contracts are IL1–IL8 in
`spec/phase12/authenticated-web-session-lifecycle.md`. Rate/proxy/browser gates remain explicit.

## WN1 — one authority, two web transports

The web tier is an adapter over the existing coordinator and coordination store. HTTPS accepts
commands; a resumable WebSocket (with an authenticated SSE fallback permitted) delivers events,
attention items, command outcomes, and story updates. Neither transport owns task, worker, goal,
approval, budget, or fence state.

Every state-changing request maps to one existing coordinator/goal operation. The minimum command
set covers spawn (independent `harness`, exact `model`, and `modelPolicy`), send/turn/nudge/steer,
respond to approval/question, interrupt, kill/emergency-stop, result/list/wait, task/goal control,
budget changes allowed by policy, and publication/integration approvals. Unsupported operations
fail typed; the web layer never emulates authority by editing projections.

## WN2 — authenticated identity and session lifecycle

Production requests require TLS. Authentication resolves a stable user identity, session ID,
authentication method, issue/expiry times, and credential ID. Browser sessions use
`Secure`, `HttpOnly`, host-only, `SameSite=Strict` cookies; non-browser clients use short-lived
Bearer credentials. Credentials never appear in URLs, logs, events, error text, or WebSocket
subprotocol values.

Login/bootstrap, refresh, logout, expiry, key rotation, and immediate revocation are explicit.
Revocation terminates future commands and stream reconnects but does not implicitly cancel fleet
work. A session re-authenticates or fails closed; it never silently becomes anonymous.
Credential expiry also terminates an already-open event stream before any later event is read.
Authenticators backed by a live session registry expose a fail-closed liveness check so explicit
revocation terminates established streams as well as future requests; custom identity providers
must supply the equivalent hook if they promise live revocation.

## WN3 — authorization is command- and resource-scoped

Authorization evaluates `{user, session, command, repoId, runId, taskId, workerId, effect}` before
dispatch. Roles/capabilities distinguish observation, ordinary control, approvals, budget changes,
integration/publication, credential administration, and emergency stop. Repository/run scopes are
allowlists. Object identifiers are resolved inside the authorized scope to prevent IDOR access.

Emergency stop remains available to an authorized operator even when ordinary budgets or task
policy block work. No role may bypass sandbox confinement, secret projection, trust-gate
verification, publication approval, or human-over-policy fences.

## WN4 — authenticated command envelope and idempotency

Every command carries:

```text
schemaVersion, commandId, idempotencyKey, command, args,
repoId, runId?, expectedFence?, origin, clientObservedCursor?
```

The server adds the authenticated `actor:{userId,sessionId,credentialId}` and received time; clients
cannot choose audit identity. JSON schemas reject unknown privileged fields, oversized bodies,
ambiguous unions, invalid model policies, credential-bearing remote URLs, and path escape before
calling the coordinator.

`idempotencyKey` is scoped to authenticated principal + command + resource and persisted before a
success response. Identical retries return the original outcome; same key with a different digest
is a conflict. Fence-sensitive commands require `expectedFence`; stale commands report current
authority without being applied. HTTP disconnect after admission does not create an ambiguous
retry because command lookup by `commandId` is durable.

## WN5 — browser-origin, CSRF, replay, and abuse defenses

Browser command requests require an exact configured `Origin`, a non-simple content type, and a
session-bound CSRF token. CORS defaults deny all other origins and never combines wildcard origin
with credentials. WebSocket upgrade validates Origin, authentication, authorization, protocol
version, and a single-use short-lived connection nonce. Compression is disabled for secret-bearing
frames unless separately proven safe.

Request timestamps/nonces, idempotency records, body digests, bounded clock skew, per-principal and
per-IP rate limits, login throttling, maximum body/frame sizes, command-cost quotas, and connection
ceilings resist replay and resource exhaustion. Proxy trust is an explicit allowlist; forwarded
identity/address headers from untrusted peers are ignored.

## WN6 — resumable ordered delivery and backpressure

The stream begins with an authenticated snapshot boundary and then emits globally ordered
coordination events plus addressed operational/story records. Each frame contains schema version,
stream ID, monotonic cursor, event ID, provenance/trust label, and resource scope. A client acks a
cursor; reconnect supplies the last durable cursor and receives at-least-once delivery. Duplicate
event IDs are harmless. Cursor expiry returns a typed `snapshot_required`, never a fabricated gap.

Slow clients receive bounded buffers and explicit lag/gap notifications before disconnection.
Attention and terminal/control events are not silently dropped to preserve prose. Browser loss,
tab suspension, stream timeout, or reconnect never interrupts or kills workers. A separate,
authenticated command is required for that effect.

An event-stream instance is bound to exactly one repository coordination authority. It may not
relabel one unpartitioned snapshot or event log under several repository IDs. Multi-repository
control requires an explicit repository-to-authority router, not a broader allowlist over one
store.

Connection tickets are non-credential, single-purpose nonces: session credentials remain in the
authenticated cookie/Bearer channel and never enter the URL. Ticket state is hashed, short-lived,
single-use, bounded, and expired entries are pruned. Ticket refusal/issuance and stream refusal,
snapshot-required, connection, lag, and disconnect outcomes are audited. A ticket is not made live
until its issuance audit commits, and no success headers or snapshot bytes are sent until the
connection audit commits.

The initial snapshot and every subsequent frame are subject to explicit byte ceilings. If a
snapshot cannot fit, the server returns a typed bounded failure before starting SSE; it never writes
an unbounded initial frame. Lag metadata has a separately fixed small control-frame ceiling so the
notification itself cannot turn a full data buffer into unbounded growth. Ticket and active
connection counts also have explicit ceilings. Each poll reads a bounded event count and rechecks
live authorization before every event is emitted, so a large replay suffix cannot extend access
past credential expiry within one synchronous batch.

Trust labels distinguish the authoritative occurrence/order of a coordination event from the
grounding of its content. Scratch claims and claimed/derived knowledge may never be relabeled as
authoritative merely because the coordination store transported them; snapshot frames declare
mixed content trust.

## WN7 — responses, errors, and audit provenance

Synchronous responses state only admission/refusal and known durable outcome. Long operations
return `202` plus a command/task reference and complete through the stream or command-status read.
Errors are typed (`unauthenticated`, `forbidden`, `stale_fence`, `idempotency_conflict`,
`rate_limited`, `invalid_command`, `not_found`, `temporarily_unavailable`) without leaking resource
existence across scopes or internal stack/credential data.

Every authentication event, authorization decision, accepted/refused command, replay, connection,
revocation, and administrative policy change is append-only audited with actor, resource, digest,
origin class, result, and causal coordination references. Sensitive values and worker untrusted
prose are redacted or separately framed; audit records are never authorization inputs merely
because they contain a claim.

## WN8 — deployment and secret boundaries

The one-machine production posture binds loopback or a configured private interface and supports
direct TLS or an explicitly trusted reverse proxy. TLS keys, OIDC/client secrets, session-signing
keys, and provider credentials are separate capabilities. Web authentication never exposes or
reuses worker-provider tokens. Session state and signing material have restrictive filesystem
permissions and rotation procedures.

Health endpoints reveal no fleet data. Readiness fails when coordination/log integrity,
authentication verification, revocation state, or command idempotency storage is unavailable.
Graceful shutdown stops admission, drains responses, closes streams with reconnect metadata, and
does not claim worker death without the ordinary confirmed-stop lifecycle.

## WN9 — zero-quota and adversarial acceptance gate

Before any internet-exposed proof, deterministic tests must establish:

1. unauthenticated, expired, revoked, wrong-origin, missing-CSRF, and unauthorized-scope requests
   cannot call a coordinator method or distinguish hidden object existence;
2. spawn forwards harness and exact model independently and rejects silent model fallback;
3. duplicate requests execute once, while same-key/different-body conflicts append no mutation;
4. stale fences, raced human commands, and single-consumer approval responses preserve existing
   coordinator authority;
5. WebSocket authentication/origin/nonce checks fail before upgrade and credentials never enter
   URLs, subprotocols, logs, or frames;
6. reconnect from a cursor is ordered and at-least-once; expired cursors require a snapshot;
7. backpressure cannot drop attention/terminal facts or exhaust unbounded memory;
8. browser disconnect leaves workers running; explicit interrupt/kill confirms and reaps them;
9. rate/size/connection limits and malformed/unknown fields fail typed and bounded;
10. audit actor comes from authenticated context, includes idempotency/fence/origin, and cannot be
    forged by request JSON;
11. auth/revocation/idempotency/coordination append failures return no successful command result;
12. TLS/proxy configuration rejects insecure production defaults and untrusted forwarded headers;
13. a real local browser automation pass covers login, command, stream reconnect, approval,
    emergency kill, logout/revocation, and no-zombie cleanup; and
14. an adversarial review explicitly probes CSRF, IDOR, replay, confused deputy, WebSocket hijack,
    token leakage, privilege escalation, and denial-of-service seams.

## WN10 — sequencing and non-goals

Implementation starts only after CK8/CK9 establishes one durable coordinator authority. The first
vertical is API/stream/security behavior with a minimal test client; a dashboard is not required.
MCP and web northbounds share command schemas and policy adapters where useful, but neither is a
privileged backdoor. Federation, public multi-tenant hosting, and homelab integration are outside
this phase. They remain ordinary future deployment decisions and may not weaken this boundary.
