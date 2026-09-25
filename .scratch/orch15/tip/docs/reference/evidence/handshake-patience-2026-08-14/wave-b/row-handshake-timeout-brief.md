# ROW BRIEF — row-handshake-timeout: no silent cap on readiness GETs (#226)

Deliverable: implementation + red-first pin suite. Issue #226 is the contract.

## Anchors (re-verify at YOUR head)

- impl/src/application-cli.mjs:2003 — `this.requestTimeoutMs = Math.min(options.commandTimeoutMs,
  DEFAULT_APPLICATION_WAIT_MS + WEB_WAIT_TRANSPORT_SLACK_MS)` — the ~45s floor applied to
  EVERY GET incl. doctor()/session() at open.
- `_requestTimeoutForCommand` (:2138) — the per-command override path (run.follow/wait/inspect
  already exceed the floor); readiness GETs have NO such path.

## Contract (closed)

1. An explicit client option (`handshakeTimeoutMs` or extending the existing exact-key config)
   sets the readiness-GET ceiling WITHOUT the silent min() — closed-field validation per the
   existing constructor discipline (exactKeys), default unchanged for back-compat.
2. `_json` uses the explicit ceiling for doctor/session readiness when configured; command
   POSTs keep their existing behavior (the per-command path already handles them).
3. Red-first pin impl/test/web-client-handshake-timeout-red.test.mjs: a slow (fake) fetch
   answering at 60s with handshakeTimeoutMs=90s SUCCEEDS where the old floor aborts at ~45s
   (RED at pre-change head: cli_transport_failed at 45s despite the 90s ask).

## Hard bounds

Additive; no server change; no new commands; batteries green (cli-adapters 24/24).
