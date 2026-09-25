# Phase 12 authenticated web SSE WN6 — 2026-07-11

## Verdict

PASS for WN6's authenticated resumable SSE vertical. This does not declare WN1–WN10 or Baton
complete. Identity bootstrap/refresh/logout/rotation, per-principal and per-IP quotas, trusted
proxy handling, command reconciliation, optional WebSocket parity, browser automation, MCP, and
the full Phase 12 adversarial matrix remain explicit scope. There is no homelab integration.

## Shipped behavior

- HTTPS authentication plus a short-lived, single-use, hashed nonce binds exact user session,
  credential, origin, one repository authority, and `observe` capability. Session credentials do
  not enter URLs, frames, errors, or audits.
- A fresh connection emits a bounded mixed-trust snapshot boundary. Reconnect uses stable numeric
  coordination cursors and at-least-once event IDs; malformed, future, and expired cursors return
  audited `snapshot_required` rather than a fabricated gap.
- Data frames, initial snapshots, lag control frames, replay count, pending bytes, tickets, and
  active connections are explicitly bounded and configuration values fail closed.
- Ticket issuance and connection success are not made live before their audits commit. Snapshot,
  later coordination-read, socket-write, response-setup, authorization, and audit failures return
  typed refusal or idempotently close, clear timers, and release connection capacity.
- Event occurrence/order remains authoritative while payload content is separately labeled
  mixed, claimed, observed, derived, or grounded. Transport never promotes Scratch/KG claims.
- Credential expiry and `WebSessionStore` durable revocation terminate established streams before
  reading later events. Authorization is rechecked before every event in a bounded replay batch.
- Browser close/error, lag, expiry, revocation, and stream faults never call coordinator
  interrupt/kill. Fleet control still requires a separate authenticated fenced command.
- Worker and detached verifier sandboxes can receive separately configured copied dependencies;
  neither links to or mutates the main checkout's installed dependency tree.

## Recursive Baton evidence

- `3510af8`: exact `CodexAppServerCli` + `gpt-5.6-sol` + low implementation, fresh verified,
  integrated, killed, and fully reaped.
- `428f4d4`: exact-model hardening turn, followed by owner corrections and 589/589 full tests.
- First report attempt was correctly rejected at the hard token budget after exposing the missing
  worker-dependency copy path; no report was integrated and cleanup remained complete.
- `929bb69` and `1a4ae2f`: accepted report-only turns found authorization-lifetime,
  snapshot/read/write cleanup, and per-batch check-to-use seams. Each correction received focused
  and full tests before the next turn.
- `17c4abe`: final report-only turn passed worker and detached verification, integrated through
  Baton, and found no actionable WN6 defect. It explicitly does not claim cross-vendor
  independence; Grok reauthentication remains required for that gate.

Every successful runner summary records exact requested/resolved/observed model identity,
`verify.reverified`, fast-forward integration intent, `kill.confirmed`, native PID death, and
worktree/runtime/branch reap. Raw ledgers and summaries are under
`docs/reference/evidence/phase12-web-stream-{codex-build,hardening-codex,codex-review}-2026-07-11/`.

## Validation

```text
node --test impl/test/phase12-web-stream.test.mjs \
  impl/test/phase12-web-northbound.test.mjs \
  impl/test/phase12-web-auth.test.mjs \
  impl/test/phase11-coordination-store.test.mjs
62/62 passing

cd impl && node --test
598/598 passing
```

The final defense-in-depth additions cover HTTP cookie-ticket CSRF before issue,
`Last-Event-ID` precedence, malformed/future cursors, durable revocation during a synchronous
multi-event replay, close+error idempotence, no post-close polling, and deliberate failed-open
nonce burn.
