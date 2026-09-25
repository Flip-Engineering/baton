# Phase 57 — truthful provider budget and call governance

Phase 57 closes the gap exposed by recursive Phase 54–56 runs: post-hoc terminal telemetry cannot
be described as pre-effect budget containment, and a terminal result must not enter verification
before its authoritative usage status is sealed.

## PG1 — closed exact-route deployment policy

`providerGovernance` is validated before log/store construction. It fixes one wire-frame ceiling,
one provider-call ceiling, one logical tool-call ceiling, and exact harness/model/effort route rows.
Each row declares a token/USD terminal reserve and `strict` or `observe` mode. Unknown fields,
unconfigured harnesses, missing harness rows, duplicate tuples, malformed identifiers, non-finite
money, unsafe integers, and every deployment maximum refuse before authority or filesystem effect.
The public identity is immutable, path-free, secret-free, and digest-bound.
Every admission carries self-contained route coordinates plus policy and route digests. Replay
validates historical policy-A evidence independently from the current policy-B deployment.

## PG2 — cards describe mechanics, not aspirations

Adapter cards state native/unavailable/not-applicable usage dimensions, token metric identity,
terminal sealing, provider-call observation/enforcement, tool-call observation/enforcement, and
the configured wire-frame ceiling. `strict` admission requires native usage for each reserved
dimension and pre-effect enforcement for provider/tool ceilings. `observe` may run an unsupported
route, but it must label the result observation-only and cannot claim that already-incurred spend or
effects were prevented.

## PG3 — reserve before every provider turn

Initial spawn, follow-up, and native recovery reserve headroom before calling an adapter. A reserve
is authorization, never usage: it is logged separately and is not added to `budgetUsed`. If the
remaining declared brief budget cannot contain the exact route reserve, Baton refuses before
provider submission. Reported use settles only from authoritative adapter telemetry. Exceeding the
reserve is a sticky provider-contract failure and cannot yield an accepted artifact.
Every admission ends exactly once: with a valid terminal seal, or with a policy-authored release on
runtime, worktree, spawn, or refinement refusal. Replay binds the release to its admission sequence.

## PG4 — usage seal precedes terminal verification

Every adapter terminal carries a separate `usageSeal`. Any native `resource.tokens` event is
emitted synchronously first. The seal declares each dimension reported, unavailable, or
not-applicable plus counter and metric identity; worker result prose is never usage authority.
Missing, malformed, negative, non-finite, unknown-accounting, regressing-counter, late, duplicate,
or contradictory telemetry fails closed. The coordinator validates and records the seal before
marking the turn terminal or starting the trust gate.
Numeric coercion is forbidden on governed routes. Each counter records token and USD observation
independently, and token evidence binds the card metric, usage-event metric, and seal metric. A seal
cannot report an omitted dimension or hide an observed one. Late telemetry or a duplicate terminal
after acceptance atomically fails the task, revokes every accepted artifact, and invalidates live
shared-knowledge representations derived from them.

## PG5 — exact provider and tool calls

Adapters emit one logical `resource.provider_call` per observable provider call/response and one
logical `content.tool_call` per provider tool ID with an explicit phase. Updates for the same ID are
deduplicated. Every attempt counts regardless of command, success, exit code, or semantic purpose.
Crossing a configured ceiling is sticky and triggers the route's honest enforcement posture; the
existing repeated-failing-command watchdog remains an independent heuristic.
IDs are non-empty, NUL-free, and byte-bounded. Phases are the closed
`requested|progress|completed|failed|cancelled` set. Response-only completed-first observations are
valid; repeated requested phases and malformed identity/phase evidence fail closed without gaining
a free call slot.

## PG6 — bounded wire input and replay

Session adapters cap an incomplete NDJSON/JSON-RPC frame before parsing or logging it. Oversized or
unterminated frames terminate and enter ordinary exact process reap with a fixed non-leaking code.
Replay restores reservations, native counter identities, usage, logical call/tool counts, terminal
seals, and sticky governance failures without reissuing effects.
The adapter callback is itself a southbound trust boundary: callbacks are worker observations only.
Adapter-supplied policy/orchestrator actor claims and harness attribution are refused; only the
coordinator mints those authorities from deployment-owned state.

## Truth boundary

Only a native pre-effect provider/tool limit can establish strict never-cross containment. Reserve
headroom and post-hoc telemetry can refuse a new turn, stop future calls, and reject an artifact;
they cannot undo spend or a tool effect that already occurred. Baton records that distinction and
does not weaken credential or runtime isolation to obtain a greener provider matrix.

## Gate

Zero-provider tests cover closed-policy construction, reserve admission/refusal, usage sealing,
malformed telemetry, terminal ordering, logical call deduplication, strict capability refusal,
observation-only enforcement, replay, bounded frames, and exact stop/reap. Recursive live proof may
run only after these deterministic contracts are green, and it must retain provider failures
separately from lifecycle/cleanup truth.
