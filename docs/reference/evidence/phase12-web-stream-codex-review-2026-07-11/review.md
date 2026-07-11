# WN6 authenticated SSE adversarial review — 2026-07-11

## Result

Two actionable WN6 availability/cleanup findings remain. I found no demonstrated CSRF, IDOR, cross-repository confused-deputy, credential replay, token disclosure, privilege-escalation, fleet-control-on-disconnect, cursor-gap fabrication, or trust-elevation defect in the reviewed vertical. This is an independent review turn on the same Codex model family, not an independent-vendor review.

## Findings

### Medium — coordination snapshot failure escapes typed handling after consuming the one-time ticket

**Source:** `impl/src/web-stream.mjs:112-126`; HTTP propagation at `impl/src/web-northbound.mjs:256-265`.

`open()` consumes and deletes a valid ticket before enforcing the connection ceiling and before calling `coordination.snapshot()`. The snapshot call is outside the setup `try` at lines 204-235. If the coordination authority throws (unavailable/corrupt adapter, injected failure, or unexpected snapshot serialization/projection failure), the exception rejects/escapes the HTTP handler instead of producing the promised bounded `temporarily_unavailable` response or a refusal audit. The ticket is already gone, so a client cannot retry the transient setup with the issued nonce. This is a bounded per-ticket failure, but repeated authenticated requests can turn a coordination fault into noisy unhandled HTTP failures and needless ticket churn.

**Failure sequence:** authenticate and issue an audited ticket; call `GET /v1/events`; `consume()` deletes it at line 108; `snapshot()` throws at line 126; no `stream_refused`/`stream_setup_failed` audit is written and no typed response is returned; retry with the same ticket is forbidden.

**Missing regression:** a coordination double whose `snapshot()` throws, asserting a typed 503, refusal/setup-failure audit ordering, no SSE headers, zero active connections, and an explicitly chosen ticket-consumption policy. Existing setup-failure coverage (`impl/test/phase12-web-stream.test.mjs:144`) exercises response setup, not snapshot acquisition.

### Medium — post-connect poll/write exceptions can escape the interval and strand connection accounting

**Source:** `impl/src/web-stream.mjs:148-177,195-203,204-235`.

The outer `try` protects only listener/header setup, the initial write, and the synchronous first `pump()`. The interval later invokes `pump` directly. `coordination.events(next)`, event/frame JSON serialization, `res.write()`, and `res.end()` in `send()` are not guarded. A throw on a later poll therefore bypasses `disconnect()`: the interval is not cleared, `activeConnections` is not decremented, and no setup/disconnect audit is attempted. In Node, an exception thrown from an interval can also become an uncaught exception and terminate the process. A failing coordination adapter is sufficient; a response implementation/socket edge that throws on a later write is another trigger. This is a remotely observable availability seam once an authenticated stream is established, although the reviewed concrete `CoordinationStore.events()` is in-memory and normally non-throwing.

**Failure sequence:** establish and audit a stream; schedule the interval; make a later `events()` or `write()` throw; exception exits the timer callback; connection authority remains counted and the timer remains live; repeated occurrences can exhaust connection capacity or crash the process.

**Missing regression:** throw from `events()` and separately from a write after initial connection, asserting no uncaught exception, response closure, timer cancellation, `activeConnections === 0`, and a best-effort `stream_setup_failed`/disconnect audit. Existing tests cover `writeHead` setup failure and boolean `write(false)`, not thrown post-connect failures.

## Seam disposition

- **HTTP auth, CORS, CSRF, and tickets:** exact origin, TLS, cookie CSRF, repository membership, and `observe` capability are checked before issue; tickets are random, hashed in memory, short-lived, session/credential/origin/repository-bound, single-use, and issuance is made live only after its audit commits (`web-northbound.mjs:224-265`; `web-stream.mjs:43-110`). The URL contains only the non-credential ticket, not the session credential. A stolen ticket alone is unusable without the bound live credential and exact origin.
- **Cursor, snapshot, reconnect, and retention:** the snapshot boundary is `lastSeq`; a fresh stream begins after it, while reconnect begins at `Last-Event-ID + 1`, giving ordered at-least-once behavior. Future, malformed, and older-than-window cursors return audited `snapshot_required` rather than a fabricated gap (`web-stream.mjs:126-138,180-193,195-203`). `Last-Event-ID` takes precedence over the legacy query cursor at `web-northbound.mjs:261-264`. The numeric replay window is an explicit WN6 retention policy over the durable coordination log.
- **Audit ordering:** ticket state is inserted only after issuance audit; connection audit commits before headers/snapshot; audit failure returns no success (`web-stream.mjs:85-88,187-215`). Invalid-ticket audit occurs after failed consumption and leaks no ticket/repository detail. The two exception paths above are the remaining ordering holes.
- **Repository scope / IDOR / confused deputy:** construction rejects more than one repository for one authority, and both principal and configured scope must match. Frames derive their repository label from the consumed grant, never client payload (`web-stream.mjs:24-27,50-56,81-109,141-146`; `web-northbound.mjs:90-101`). No cross-repository relabeling path was found.
- **Trust/provenance:** frames correctly separate authoritative occurrence/order from content grounding. Snapshots are `mixed`; scratch claims are `claimed`; scratch facts and knowledge use their grounding; transport provenance does not promote payload claims (`web-stream.mjs:141-145,239-245`). This review does not treat event occurrence authority as proof of payload truth.
- **Backpressure and size bounds:** data, snapshot, pending-byte, control-frame, ticket, and connection ceilings are explicit. Boolean backpressure emits a bounded lag frame best-effort and disconnects without worker control (`web-stream.mjs:29-36,120-124,155-191,215-227`). Thrown asynchronous failures remain finding two.
- **Authorization lifetime and cleanup:** expiry and live registry revocation are checked before each poll and terminate before reading later events; close/error paths clear the timer and release the connection (`web-stream.mjs:59-64,148-153,195-207`). `WebSessionStore.authenticator()` supplies the live hook and verifies immutable session identity/scope (`web-auth.mjs:119-160`). Custom authenticators without a liveness hook cannot promise immediate revocation, as the specification already states.
- **Coordination-store interaction:** snapshots and events are clones/frozen projections with stable sequence order; web admission/completion/audit append through the same durable store. No authorization decision is derived from audit claims. Coordination append tests cover durable failure and replay, but not the SSE read exceptions identified above (`coordination-store.mjs:217-259`).

## False-positive checks

- Consuming a valid ticket before returning `connection_limit` or `snapshot_required` is not itself a replay/security defect: single-use-at-attempt is conservative. It becomes actionable only where an uncaught setup fault prevents a typed/audited result.
- Audit events appearing on the same coordination stream do not make their embedded claims authoritative; their frame `contentTrust` is `observed`.
- A query-string ticket is not a session credential and is bound to the current credential and origin. Referrer/log exposure would at most disclose a short-lived unusable-without-session nonce; no credential leakage exploit was established from current code.
- `activeConnections` is incremented only after the connection audit, so audited refusal paths before that point do not require decrementing.

## Residual Phase 12 scope, not WN6 defects

- **WN2:** identity-provider login/bootstrap, refresh, key rotation, logout HTTP route, and equivalent live-revocation hooks for custom identity providers.
- **WN5:** full per-principal/per-IP quotas, login throttling, command-cost quotas, proxy-trust policy, and optional WebSocket nonce/origin/auth parity.
- **WN8:** production readiness and graceful shutdown/drain behavior, TLS/proxy deployment configuration, secret rotation, and health boundaries.
- **WN9:** real-browser login/command/reconnect/approval/emergency-stop/logout coverage, complete abuse/connection quota gates, and the remaining full adversarial acceptance matrix. Homelab/deployment integration is intentionally excluded.
