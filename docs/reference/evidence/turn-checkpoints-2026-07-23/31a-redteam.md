# Revision brief: 31-a pause-records contract (v1 → v2)

Every finding MUST be resolved or explicitly rebutted with file:line evidence. SHARED DECISIONS
(pinned by the orchestrator — do not deviate; 31-b is told the same):

- **Key space**: `_pausedTurns` keyed `pause:${task.id}:${terminalEvent.seq}` (31-a's). 31-b
  reuses it unmodified. No `(workerId, taskId, turnEpoch)` reservation key anywhere.
- **story.mjs**: 31-a's `TURN_PAUSED`/`TURN_SETTLED` with worker status `'paused'` WINS, with
  the fold-set fix below (R31a-2). Idle-rendering of a parked worker is dishonest.
- **Attention**: `attentionFrom` maps `'paused'` → `'turn_checkpoint'` in wave.mjs:78-88
  (31-b's). 31-a's red pin `attentionFrom('paused') === null` is SUPERSEDED — say so in the
  contract text and fix the pin.
- **coordination-store.mjs:10630** (non-terminal task status → `'dispatched'`) gains
  `... : status === 'paused' ? 'paused' : 'dispatched'`; sibling :10637 (`task_failed` mapping)
  gets the same treatment. The edit lives in 31-a; 31-b does not duplicate it.

## P1-1 — normalizeIntent strips/rejects driverKind (BLOCKING)

`application.mjs:919-921` enforces a closed intent key set
(`['runId','objective','resultIntent','profile','route','scope','composition']`, throws
`application_intent_invalid`) and :933-941 rebuilds with only those keys — `driverKind` never
reaches the handler. As written, wave.mjs:151's edit makes every member's runs.start throw →
wave-driver-red goes red. FIX: name :919-921 (whitelist) and :933-941 (pass-through) as
required edits; decide explicitly whether `driverKind` joins `intentDigest` (:3703-3708) and
runId derivation (:3722-3729) — and specify the `existingRun !== null` reconcile case (:3731)
(marker admission on an already-existing run).

## P1-2 — story.mjs fold order (vacuous test)

Per-worker log order: `lifecycle.turn_completed` (coordinator.mjs:9896) THEN `turn.paused`.
story.mjs folds TURN_COMPLETED to `'idle'` first (:224, :348-355), so TURN_PAUSED's
`{from: ['working']}` guard skips it and a parked worker renders idle. FIX:
`{from: ['working', 'idle'], to: 'paused'}` (the KILL_CONFIRMED `from: null` precedent :225),
and the red test drives the real three-event sequence, not an isolated event.

## P1-3 — CI6 replay kills the paused task (unnamed)

Restart mid-pause: `lifecycle.turn_completed` sets terminalStatus `'verifying'`
(coordinator.mjs:11033-11048); CI6 then fails ordinary nonterminal tasks with
`session_not_reattached` (:11247-11276) because TERMINAL_TASK_STATUSES excludes both. FIX:
name CI6 (:11250-11276) explicitly, CHOOSE the restart semantics (fail-closed parity with
input_required is defensible — say which), and the replay red test asserts the post-restart
task status and what happens to a reconstructed pending record for a dead task, not just
`_pausedTurns` contents.

## P1-4 — 31-a must not ship the wave.mjs:151 edit

With `driverKind:'wave'` admitted and pausable cards live, a wave member's first
turn_completed mints a pause, hasDriver=true, task parks — with ZERO consumption paths until
31-b (and the watchdog was cleared at :9900 and never re-arms). FIX: DEFER the wave.mjs:151
edit to 31-b (the runs.start whitelist machinery ships in 31-a with no caller, keeping the
degenerate path exercised everywhere); state this ordering explicitly.

## P1-5 — changedPathsDigest throws when baseSha is absent

`task.sessionContext?.baseSha` is optional (coordinator.mjs:634);
`changedPathsAtCommit` validates both SHAs as 40-hex and throws `captured_change_invalid`
(index.mjs:724-727) — inside the turn_completed handler for every no-baseSha MockAdapter task
(the backward-compat path itself). FIX: baseSha absent ⇒ `canonicalDigest([])` (or a named
skip rule); red-test it.

## P2s

- P2-1: single gated dispatch — `_admitPauseRecord` returns `settled`; `if (!settled) break;`
  lets the ONE existing gated dispatch (`_drainState === 'open' && !stopping && !dead`,
  coordinator.mjs:9932) run. Drop "ran unconditionally."
- P2-2: name coordination-store.mjs:10630 AND :10637 (see SHARED DECISIONS above).
- P2-3: the pause mint leaves `handle.status === 'working'` while the task is `paused` —
  state it as deliberate for 31-a (auto-settle is synchronous) with a 31-b note, or add the
  handle-side write mirroring :10038.
- P2-4: one sentence on legacy in-flight runs (no marker → auto-settle → claim semantics).

Verified clean (keep): the seven guard sites, TRANSITIONS/TERMINAL cites, fold surface,
marker scan replay-safety, watchdog :7408, card lint design, the turn_completed emitter
inventory, and the run-suite wiring.
