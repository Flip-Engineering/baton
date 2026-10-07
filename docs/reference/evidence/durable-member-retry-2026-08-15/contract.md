# Issue #201 — the durable member retry/session-restore contract: death-cert → retry_pending → resume (v1)

- **Date:** 2026-08-15 · **Status:** v1 CLOSED DESIGN + RED PINS (`impl/test/durable-retry-red.test.mjs`) —
  the three seams below are pinned and implemented minimally; the full re-drive loop is the named
  roadmap, not this rung. Cross-ref #225 (death certs), #228 (omp rpc adapter), #163 (no-clocks law),
  #230 (first-turn-at-spawn), #235 (transport liveness).
- **Scope, one sentence:** when a wave member's provider process dies WITH a death certificate,
  the task never silently fails — it transitions to an evidence-bound `retry_pending` state; when the
  host itself dies, the successor incarnation's replay surfaces every task claimed by a dead
  generation as reclaimable; the re-drive restores the member by `omp --resume <sessionId>` against
  its persisted session file, and the retry budget is a bounded COUNT with typed refusals — never a
  clock.

## Ground truths (measured)

- **GT1 — provider-death class (w-564):** members work ~2h, the provider process dies cause-lessly,
  52min silence, the drive breaks honestly — ALL member work lost; `lifecycle.crashed` carries
  exitCode/signal (`omp-rpc.mjs` `_onClose`) but the fold at `coordinator.mjs:13014` transitions the
  task straight to `failed`. No retry, no session restore.
- **GT2 — host-death class (07:42Z):** the host OOM-killed the resident with 5 dispatched members,
  0 settled. The successor incarnation replayed the ledger but the members stayed `working` under
  claims held by dead generations — orphaned mid-run forever; only manual re-fire with fresh
  idempotency keys recovers. No orphan scan exists (`_terminalizeUnattachedCoordinationTasks` only
  fails claimed-without-spawn tasks, not claimed-by-dead-generation tasks).
- **GT3 — resume is native and cheap:** `omp --resume=<id>` accepts an ID prefix, path, or picker;
  `get_session_stats` (rpc command) returns `{sessionId, sessionFile}` — the resume handle is
  discoverable over the member's own rpc lane one command after ready (measured v17.3.4, this
  session). The member's isolated home persists the session file across process death.
- **GT4 — #163 law:** NO clock decides fate. Every retry/restore decision rides EVIDENCE: the
  process-exit fact, the generation mismatch, the ledger replay state.

## The contract (closed fields)

### D1 — member death (process exit WITH death cert)

`lifecycle.crashed` (phase `process_exit`) is the ONLY retry trigger; silence/stall is not (the
existing #50/#67 law). The death cert payload gains the resume handle when a session was
persisted: `sessionId`, `sessionFile` (both null when the store never answered or the member ran
`--no-session`). The coordinator fold, when the adapter card advertises
`sessions: {resume: 'native'}` AND a member-retry authority is configured, transitions the task
`working → retry_pending` (a new NON-terminal task state) with the evidence digest
`{kind: 'lifecycle.crashed', coordinationSeq, exitCode, signal, sessionId, sessionFile}` —
NOT `failed`. Without retry authority, or on budget exhaustion, the fold refuses typed and the task
settles `failed` exactly as today.

### D2 — the retry budget (a count, never a clock)

`memberRetryAttempts` is a deployment-owned integer ceiling (constructor option, forwarded by
`createDriver`; default 0 = retries off — the #59 opt-in posture). Each admitted re-drive consumes
one count for that task id, durably (the `retry_pending → working` transition event is the count).
No wall window, no backoff timer, no delay — a re-drive is admitted the moment its evidence is
complete. Exhaustion and refusal are TYPED:

| Refusal code | Meaning | Task outcome |
|---|---|---|
| `member_retry_unauthorized` | no member-retry authority configured | `failed` (today's behavior, now typed) |
| `member_retry_budget_exhausted` | attempt count consumed | `failed` with lineage evidence |
| `member_resume_handle_unavailable` | death cert carries no `sessionId`/`sessionFile` | fresh-dispatch path or `failed` — typed, never silent |

### D3 — session-restore for omp

Resume = respawning the member as `omp --mode rpc --resume <sessionId> --session-dir <isolated
home>` (same argv discipline as spawn; the session file lives under the member's profile-isolated
home, so the resume never crosses members). The resume handle is captured ONCE after the ready
frame via a one-shot `get_session_stats` observation (no retry ladder, no timer — an unanswered
observation is honestly `null`), surfaced on `lifecycle.spawned {sessionId, sessionFile}` so the
coordinator's sessionRef fold (already native at `coordinator.mjs:12655`) binds it durably, and
echoed on the death cert (D1). The re-drive's first turn is the SAME rendered brief (the #230
first-turn law rides resume too).

### D4 — successor-incarnation replay (generation mismatch ⇒ reclaim)

A fresh store/incarnation replaying a ledger from a dead host rebuilds claims held by dead
generations. The store exposes `orphans({ liveWorkers })` — a pure read-side scan returning every
task whose status is claimable-nonterminal (`working`, `input_required`, `paused`, `retry_pending`)
AND whose assignee is not among `liveWorkers` (the successor's verified live worker set), each row
carrying `{taskId, workerId, status, processGeneration}` from the durable `worker.generation_bound`
record. The successor's recovery scan admits each orphan through the SAME D1 gate: reclaim =
`retry_pending → working` under the successor's claim, with the generation mismatch as evidence —
never a blind re-fire with a fresh idempotency key.

### D5 — durable vs rebuilt

| DURABLE (survives death) | REBUILT (per incarnation) |
|---|---|
| the member's worktree (unless accepted/reaped) | the omp process + its generation |
| the member's runtime home incl. the session file | the in-memory worker handle |
| the coordination ledger (claims, transitions, retry counts) | board grants (revoked at the generation boundary, #78 D8) |
| the resume handle on sessionRef (once observed) | message read receipts (process-scoped, #105) |

## Roadmap (named, out of this rung)

1. The re-drive executor: respawn-with-resume under D1–D3 (admission → `--resume` spawn →
   first-turn → roster `retrying` field on the settle receipt, per the lch `contract-retry.md` D3).
2. The successor-incarnation wiring: `orphans()` feed into `startupRecoveryCandidates` and the
   resident's restart handoff.
3. Budget accounting beyond the transition event (per-wave rollup on the settle receipt).

## Red pins (RED at HEAD `da16e834`, verified)

- **A1 (adapter):** a crashed session with a persisted session-file carries `sessionId` +
  `sessionFile` in the `lifecycle.crashed` payload — today the death cert carries only
  exitCode/signal.
- **A2 (coordinator):** a task whose worker died WITH a death cert and retry authority transitions
  to `retry_pending` with the evidence digest — today it goes straight to `failed`.
- **A3 (store):** a fresh store replaying the fixture ledger surfaces orphaned claimed tasks
  (claimed by a dead generation) via `orphans()` as reclaimable — today no scan exists and the
  rows are invisible.
