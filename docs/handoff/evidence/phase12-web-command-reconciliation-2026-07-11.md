# Phase 12 durable web command reconciliation evidence — 2026-07-11

RC1–RC6 closes the admitted-command ambiguity without replaying effects or exposing an ID oracle.

- Web admission now persists server-derived user, session, and credential ownership alongside the
  existing command/repository/fence/scope/request digests. Request JSON cannot choose ownership.
- `GET /v1/commands/{commandId}` requires HTTPS, active auth, `observe`, repository scope, and the
  same stable user. Credential/session rotation for that user retains access after restart.
- Unknown, malformed, legacy-unowned, and other-user commands share `404 not_found`; missing
  capability/scope is a pre-lookup 403. Required audit failure returns 503, not status data.
- Responses omit ownership IDs, raw origin, idempotency/scope/request digests, credentials, and
  audit actors. They expose only command/resource/fence/status/times and the already-sanitized HTTP
  outcome.
- Reads call no coordinator method and do not complete/fail/mutate an admitted command.
- New command and idempotency identifiers are bounded URL-safe values. The operator polls only the
  original command ID for a bounded interval after `202 admitted`; it never invents a replacement
  key or retries the effect automatically.

Validation:

- RC status tests: 6/6.
- Focused status + operator + existing northbound tests: 22/22.
- Combined Phase 12 suite: 100/100.
- Full canonical suite: 678/678 with zero owned suite roots left in the configured temp parent.
- `git diff --check` passes.

Provider-backed review remains pending the Codex quota reset or Grok reauthentication. Optional
WebSocket parity, MCP/deeper operator surfaces, and the in-app browser interaction gate remain
explicit. No homelab integration was added.
