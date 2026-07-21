# Doc 31 — the Wave surface: first-class orchestration drivers (AX remediation)

*Status: design note, implemented with `impl/src/wave.mjs` and `impl/test/wave-driver-red.test.mjs`.
Addresses the agentic-experience defect that every orchestration wave cost a bespoke ~300-line
driver plus hours of orchestrator-side bugs. Issue-10 AX scope; Program-IR (93B/E) aligned.*

## Problem (receipted, 2026-07-20/21 dogfood)

An orchestrator driving N concurrent workers through `openBaton`/`BatonClient` had to hand-write,
every time: per-member start, explicit approval, pump re-arming, terminal detection, attention
surfacing, result materialization, steering, selective stop, and zero-residue close. The failure
modes were all self-inflicted and all avoidable:

1. **Passive-status stall** — polling `run.status()` never approves a Plan; a wave sat at
   `awaiting_plan_approval` for 90 minutes.
2. **Pump-as-terminal kill** — `run.complete()` returns on RunView quiescence; treating its
   return as terminal made a driver SIGTERM a healthy worker mid-read.
3. **Fail-fast cascade** — `startMany`'s group semantics resolved early on one crashed seat, and
   the bespoke materialize-then-stop order killed two healthy reviewers.
4. **Terminal taxonomy** — `work_completed` (non-terminal resting state) vs `completed` vs
   `selection_required` vs `failed` vs `cancelled` was guessed wrong repeatedly.
5. **Glob-scope misuse** — a bare directory scope matches only itself; the trust gate correctly
   rejected the capture (`inScopeChangedPathCount: 2` of 5).
6. **Pin-fallback ambiguity** — the newest `refs/baton/results/*` pin belonged to a sibling run;
   materialization needed path-existence disambiguation.
7. **`stopMember` dispatch race** — `stoppableRoles` requires `taskId !== null`; a fixed-time
   stop missed the dispatch window twice.
8. **Watchdog skipping outcomes** — a watchdog abort produced zero materialized results even
   though two workers had finished.

## Remediation

One first-class orchestrator-side surface over any Baton command port (embedded `bindBaton`,
resident `bindBatonPort`, or an authenticated web client port), so a wave is *data* — a member
roster plus objectives — and the lifecycle semantics above are baton's own, not the caller's:

```js
const wave = await baton.waves.start({
  members: [{ role, exact?, harness?, model?, effort?, scope, objective }],
  verification?,              // optional deployment verification override
  approve? = true,            // explicit distinct approval, receipted per member
});
wave.runs                     // role -> BatonRun
await wave.send(role, message, { delivery: 'now' });
await wave.progress()         // per-member: phase, attention, elapsed, stoppable
await wave.stopMember(role, { reason, timeoutMs? })   // retry-until-stoppable inside
const outcomes = await wave.settle({ timeoutMs });    // per-member outcome, always produced
const stop = await wave.close({ reason });            // per-member stops, zero-residue summary
const record = wave.evidence();                       // structured wave record
```

Baked semantics (each numbered to its failure mode):

1. Every member is started individually and **explicitly approved** (unless `approve:false`),
   so nothing ever waits on a silent authority gate.
2. The surface never treats `run.complete()`'s return as terminal; settle's terminal predicate
   is `outline.terminal === true` or the closed terminal-phase set
   `{stopped, failed, cancelled, completed}`.
3. Per-member isolation is unconditional: one member's crash, refusal, or terminal failure
   changes nothing about the others' lifecycles.
4. `work_completed` counts as success-terminal for outcome purposes; `selection_required`
   surfaces as attention, never as completion.
5. Scopes are validated as globs at admission: a bare directory path (no glob magic, existing
   directory semantics) fails `wave_scope_invalid` with the corrective form (`dir/**`).
6. `settle` materializes each member's preserved result from the result section first, then
   from `refs/baton/results/*` **only** with git path-existence disambiguation and a start-time
   window, never by newest-pin guessing.
7. `stopMember` retries `application_action_scope_mismatch` /
   `application_workflow_member_stop_unavailable` until the member's attempt is dispatched or a
   bounded deadline, then reports honestly.
8. `settle` always produces an outcome for every member — including after its own timeout —
   and `close` returns a zero-residue summary (or the exact remaining count per member).

## Program-IR alignment (not a second scheduler)

The Wave is deliberately the runtime shadow of the §93.24 93E template lowerings: members ↔
parallel branches/calls, `settle` ↔ join, outcome materialization ↔ collect/select,
`stopMember` ↔ selective member stop, `wave.evidence()` ↔ the Program trace. When Program v1
runtime lands, `baton.waves` becomes a lowering target, not a replacement: it holds no durable
state of its own, no event-log authority, and no scheduling loop beyond per-member pumping.

## Non-goals

- No durability of the Wave itself (orchestrator-side; Program v1 owns durable composition).
- No resident-server-hosted waves yet (the command port is transport-agnostic, so the resident
  path works through `bindBatonPort` without new server code).
- No worker-side access (nested orchestration is issue #12).
- No new event kinds, authority, or ledger writes beyond the ordinary Run commands it composes.
