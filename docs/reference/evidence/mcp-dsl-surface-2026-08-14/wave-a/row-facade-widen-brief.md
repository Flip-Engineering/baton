# ROW BRIEF — row-facade-widen: the web-backed facade carries the wire's whole registry

Issue #227 item 1. Deliverable: implementation + red-first pin.

## Anchors (re-verify at YOUR head)

- impl/src/mcp-web-bridge.mjs:22 — ORDINARY_COMMANDS = exactly five run.* verbs.
- :206 — command() refuses anything else: application_unauthorized 'Remote Baton MCP
  command authority is invalid'. MEASURED live (2026-08-14): waves.progress/waves.list
  refused here while the wire admits them (WAVE_WEB_ENTRIES, web-northbound.mjs:37).
- impl/src/application-cli.mjs:16 — CLI_WEB_COMMANDS: the client-side allowlist ALREADY
  includes all waves.* verbs. The facade's allowlist is the only narrow gate.

## Contract (closed)

1. The facade's command allowlist widens to the registry the wire serves: the five run.*
   verbs + waves.attach/start/list/progress/send/stop/run/compile + run.scratchpad.* +
   run.message.* + run.attention.watch (mirror CLI_WEB_COMMANDS minus shutdown).
   application.shutdown stays refused. Capability checks keep their existing seam.
2. Valid-context/idempotency derivation for the widened verbs follows the facade's existing
   mutation-key discipline (MUTATIONS grows for waves_start/waves_run/waves_stop/waves_send).
3. Red-first pin impl/test/mcp-web-bridge-surface-red.test.mjs: through the facade,
   waves.run(specDsl) reaches the wire and returns a waveId (RED at pre-change head:
   application_unauthorized).

## Hard bounds
Additive hunks; no server change; batteries green.
