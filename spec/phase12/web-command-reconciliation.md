# Phase 12.5 — durable web command reconciliation

An HTTPS request can disconnect after durable command admission or before its completion response
arrives. The client must recover from coordinator truth without replaying an effect under a new
idempotency key or gaining a command-enumeration oracle.

## RC1 — durable admission owns authenticated user identity

`web.command_admitted` stores the server-derived user ID, session ID, credential ID, repository,
command, idempotency scope digest, request digest, expected fence, and admission time. Clients
cannot choose any ownership field. Restart replays the same ownership and status.

## RC2 — status read is sanitized and scoped

`GET /v1/commands/{commandId}` requires canonical HTTPS, active authentication, `observe`, and the
command repository scope. Only the same stable user may read a command; session/credential rotation
for that user does not orphan it. Unknown, malformed, legacy-unowned, and other-user IDs share one
bounded `404 not_found` posture.

The response includes only command ID/type, repository/run, expected fence, admitted/completed
times, status (`admitted`, `completed`, or `failed`), and the already-sanitized HTTP outcome when
terminal. It never returns ownership IDs, scope/request digests, idempotency keys, raw origin,
audit actors, credentials, or provider data.

## RC3 — reads never mutate fleet or command truth

Status reads call no coordinator method, append no completion/failure, and do not change an
admitted command. They append only a bounded authorized/refused audit event. Audit failure returns
no status success.

## RC4 — command identifiers are routable and bounded

New command IDs are limited to a 1–128 character URL-safe identifier; idempotency keys are bounded
to 256 characters. Slashes, controls, percent ambiguity, and oversized IDs are rejected before
admission. The status route accepts one canonical path segment only.

## RC5 — browser reconciliation reuses the original command ID

If a command response is `202 admitted`, the operator page polls only the status read under that
same command ID for a bounded interval. It never creates a replacement command or new idempotency
key automatically. A still-admitted result remains visible and operator-controlled.

## RC6 — acceptance and remaining ambiguity

Tests cover admitted/completed/failed status, restart, credential rotation, cross-user/repo/
capability refusal, malformed IDs, sanitization, audit failure, zero coordinator calls, and static
client reuse of the original ID. Reconciliation cannot infer whether an arbitrary external side
effect occurred outside coordinator authority; such effects remain approval/integration adapters'
own intent/commit recovery problem.
