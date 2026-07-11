# Phase 11.0 — control integrity and model selection

These contracts repair the core defects found by the 2026-07-11 audit and add model as a control
axis independent of harness. They are the safety gate before recursive live dogfooding resumes.

## CI1 — delegation contract is snapshotted at admission

`Coordinator.spawn()` MUST validate and deep-snapshot the brief at the public boundary. Later
caller mutation cannot alter the goal, constraints, scope, budget, or pinned verification. The
snapshot preserves optional verification timeout, coverage command, and future extension fields.
Invalid raw briefs fail before task/worker allocation or logging.

## CI2 — response state commits only after delivery acceptance

`respond()` MUST NOT mark a question/approval resolved, log an answered/resolved event, or unblock
the task until the adapter returns `Ack{ok:true}`. `Ack{ok:false}` leaves the item pending and is
returned honestly. A thrown delivery restores the pending state and returns/throws without a false
resolution. Exactly one concurrent accepted response wins.

## CI3 — stop is idempotent after any terminal child outcome

`kill()` and `interrupt()` against a child that already exited/crashed/timed out MUST settle
boundedly as `already_dead`/`already_stopped`; they may not wait for a confirmation event that can
never occur. A wall-time crash followed by policy cleanup reaps the PID, task worktree, metadata,
and any non-evidence branch according to lifecycle policy. No unref timer may be the only future
settler of an awaited public promise.

## CI4 — provenance is semantic, not positional

Worker-authored content/result prose MUST be emitted in digest `prose` with
`provenance:'model-authored', untrusted:true`. Hub-observed lifecycle/control/verification facts
MUST be `hub-computed`, `untrusted:false`. The coordinator MUST use the canonical message/digest
constructors; no worker payload becomes a trusted fact merely because it passed through the hub.

## CI5 — lifecycle identity is monotonic in the story

A later adapter `lifecycle.spawned` event that carries a wire session/thread id but no task/brief
MUST enrich, never erase, the coordinator’s task identity. One real turn increments `turnCount`
once even when both dispatch intent and wire acceptance are recorded. Requested/observed harness
and model remain visible.

## CI6 — replay restores collision-free identity

Construction replay MUST advance task/worker ID allocators beyond every replayed auto ID and MUST
never overwrite a replayed handle. It restores or explicitly terminalizes state that cannot be
reattached; no reconstructed `working` handle may pretend it is controllable without an adapter
session. Until native reattachment ships, a nonterminal replay is durably failed with
`control.recovery_terminalized` and the handle is `orphaned`; control commands return
`session_not_attached` and never target a fresh adapter instance. Pending interactions, fences,
budgets, story, router, process identity, and worktree ownership receive numbered follow-on
contracts rather than being implied by task-status replay.

## MS1 — harness and model are independent task fields

`spawn(vendor, brief, {model})` accepts an optional exact model identifier separately from vendor.
Task and public handle expose `vendor`, `modelRequested`, and `modelObserved`. Omitting model means
“use the card’s declared default”, not “model identity is irrelevant”. An invalid model is a typed,
visible refusal and never a silent fallback.

## MS2 — exact model reaches the native wire

- Claude/GLM: per-worker `--model` (and GLM mapping env where required).
- Codex: `thread/start.model` and/or the documented sticky `turn/start.model`.
- Grok: per-worker `--model` and observed ACP model state/usage metadata.

Adapter constructor defaults are fallback configuration only; a task-level exact model wins.

## MS3 — cards publish model-selection capability

Harness cards declare model selection mode, configured default, known available models when the
wire exposes them, reasoning/service controls, and freshness/provenance. `available:null` means
the adapter accepts a provider-valid identifier but cannot prevalidate it; it does not mean every
identifier is valid.

## MS4 — automatic routing honors model constraints

For `vendor:'auto'`, an exact model or model policy filters candidates before adaptive scoring.
The router key is `(harness, harnessVersion, model, modelFamily, taskType)`, never merely
`harness@version`. Preference, allow, and deny policies are deterministic and observable. If no
candidate can honor the policy, the task remains/refuses visibly rather than choosing a default.

## MS5 — model attribution survives every boundary

Requested, resolved, observed, and rerouted model identifiers are recorded in spawn/turn/resource/
terminal/verification events, public results, replay, routing statistics, run scorecards, and
snapshot commit trailers. A model change is a first-class event, not an overwritten string.

## Safety gate

CI1–CI6 and MS1–MS5 require zero-quota fake-backed driver tests. CI3 additionally requires a real
post-timeout cleanup smoke before recursive multi-vendor dogfooding resumes. Native model mapping
for each authenticated vendor receives a probe-sized live smoke after the fake is corrected.

## Registered follow-on — authenticated web northbound

The northbound phase MUST specify one authorization path from a human web client to the
orchestrator/coordinator. It reuses the eight commands and their fences rather than inventing web
mutations. Required contracts include authenticated actor identity, per-repo/run authorization,
TLS, session/token expiry and revocation, CSRF/origin defense, command idempotency and replay
protection, resumable event cursors, backpressure, reconnect/disconnect behavior, rate limits, and
an audit edge from every accepted/rejected web command to its user/session. Harness and exact model
selection are available over this surface. No browser endpoint can bypass approval, sandbox,
budget, verification, or irreversible-action gates.
