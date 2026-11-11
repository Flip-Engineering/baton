# Phase 16 — MCP northbound

Status: executable contract, 2026-07-11. The target is the stable MCP `2025-11-25`
revision. This phase exposes Baton's existing coordinator; it does not create a second
fleet state machine.

Phase 64 supersedes its ordinary northbound UX without deleting the kernel contract. An
application-backed server now defaults to nine `fleet_run_*` tools generated from the shared Run
command registry. The Phase 16 fleet vocabulary remains an explicit advanced compatibility and
emergency surface; `combined` must be requested deliberately.

## MN1 — Stable protocol surface

The server implements JSON-RPC 2.0 `initialize`, `notifications/initialized`, `ping`,
`tools/list`, and `tools/call`. It advertises MCP `2025-11-25`, tool-list stability, and
no experimental task execution. Batches and unknown methods fail with protocol errors.

## MN2 — Standard stdio transport

`serveMcpStdio` accepts one UTF-8 JSON-RPC message per line, processes messages in input
order, writes only JSON-RPC frames to stdout, and keeps diagnostics on stderr. The input
line ceiling is injected from the embedding host's frame/memory budget; invalid UTF-8,
over-ceiling, or malformed input receives a parse error and
cannot reach the coordinator.

## MN3 — Injected authority

The stdio host injects one authenticated principal. Tool arguments cannot select a user,
session, credential, capability, or repository outside that principal. Every call
rechecks expiry/revocation, capability, and the server/principal repository intersection.
MCP stdio receives credentials from its host environment or embedding program, never
from tool arguments. The embedding host must also inject a quota authority derived from
its deployment budget; Baton does not invent an arbitrary universal request ceiling.

## MN4 — Closed surface-selected vocabulary

The ordinary application surface is exactly `fleet_run_start`, `fleet_run_status`,
`fleet_run_approve`, `fleet_run_wait`, `fleet_run_answer`, `fleet_run_steer`, `fleet_run_stop`,
`fleet_run_evidence`, and `fleet_run_adopt`. Status, wait, and evidence are fresh reads; start,
approve, answer, steer, stop, and adopt use the durable MCP call ledger. Steer is admitted
before delivery and is not redispatched after an ambiguous completion boundary. The advanced surface retains the
historically accumulated nineteen `fleet_*` kernel tools. Only explicit `combined` mode advertises
all twenty-eight. Schemas are closed, capability action shapes are mutually exclusive, and
credential-shaped fields are recursively rejected. `application.shutdown`, `run.close`, and
fleet-wide drain are never in the nine-tool application surface. Run-scoped stop is.

## MN5 — Exact route tuple

`fleet_spawn` independently accepts `harness`, `model`, and `effort`, preserving them as
separate coordinator inputs. It never encodes model or effort in the harness name and
never substitutes an unrequested route.

## MN6 — Capability, scope, and fences

`spawn`, `send`, and `interrupt` require `control`; `respond` requires `approve`; `kill`
requires `emergency_stop`; reads require `observe`. Every tool names `repoId`. Send,
interrupt, and kill require an integer `expectedFence`.

## MN7 — Durable effect idempotency

Every state-changing call requires a URL-safe idempotency key. Before dispatch, Baton
durably admits a call keyed by stable user, tool, repository, and a digest of that key.
The ledger stores no raw key. Identical terminal replay returns the recorded outcome;
same-key/different-arguments is a conflict; replay of an admitted-but-nonterminal call
returns `call_admitted` and never repeats the effect. Completion must be durable before a
successful result is returned. A generic state-command exception is reported as
`command_outcome_unknown`, not as a false claim that no effect occurred; typed stale-fence and
precondition failures retain their narrower result.

## MN8 — Bounded wait and result vocabulary

`fleet_wait` is a bounded poll, not an unbounded MCP call. Its configurable ceiling
defaults to 25 seconds because it must remain below common host MCP timeouts. Tool
results return both `structuredContent` and an equivalent text fallback. Coordinator
failures are tool results with `isError: true`; malformed protocol requests remain
JSON-RPC errors.

Validated refusals and read outcomes are written to the coordination audit stream;
state-changing outcomes already live in the durable MCP call ledger. An unavailable
quota or audit authority fails closed.

## MN9 — Restart and transport truth

The MCP call ledger folds from the same append-only coordination stream on restart.
Stdio EOF drains already accepted messages and then invokes host-only `application.shutdown` with an
injected closed principal. The packaged process maps `SIGINT`/`SIGTERM` to the same memoized,
retry-visible finalizer; it does not expose shutdown as a tool. Output backpressure is awaited;
transport failure cannot be reported as a successful tool result.

## MN10 — Honest boundary

This slice does not claim Streamable HTTP authorization, WebSocket parity, MCP Tasks, progress
heartbeats, or a durable Run-scoped stop. The stdio application host must finalize its owned
deployment on EOF/signals. Advanced `fleet_drain` reaps workers while retaining transport and
writer authority; it is never presented as host shutdown. The surface remains production-shaped:
standard framing, fixed authority, exact route selection, durable replay safety, and one real
application/coordinator authority path.
