# 93B contract — wave durability: attach-and-harvest + re-drive-the-failed (v2)

(v2 folds the R93R red-team, verdict SOUND-WITH-FOLDS. The decisive correction: the
'resume' premise is FALSE — replay on host open terminalizes every nonterminal task
(CI6/session_not_reattached, coordinator.mjs:11893-11922, paused included), so post-attach
there are no mid-flight-and-healthy members. The honest scope: attach-and-harvest (reap
outcomes from durable runs) + re-drive the failed members (rule 5). Also folded: R93R-2
wave.started mints pre-loop with per-member binding via steering.registered; R93R-3
driver_detached mints at attach-time with a dedup key; R93R-4 dedup is turn.settled replay
with the not_found/not_paused refusal taxonomy; R93R-5 attach is same-root open under lease
reclaim; R93R-6 startedAt is seeded from wave.started; R93R-7 waves.start takes an
idempotencyKey.)

Ground truth: the campaign's orphan receipts. A wave's workers are durable (checkpoint pins,
recovery terminalizes honestly on next host open), but the DRIVER is a process — when it dies
(SIGKILL, crash, session end), in-flight members become orphans that nothing steers or
settles. `wave.mjs:7` declares the wave "holds no durable state of its own"; the driver's
loop IS the wave's progress. The evidence is thick: redteam waves 1/2 died unharvested with
drivers, the v5b driver hung 4h, multiple TaskStop survivors (bash-zlwdwdry's zombie).

## The question

Should the machinery make in-flight waves attachable/resumable by a fresh driver, or is the
documented re-drive recipe (new wave, checkpoint-pin recovery) the honest answer? This
contract picks attach-and-resume, on evidence that re-drive wastes hours of completed work
when members are mid-flight and healthy.

## Rules

1. **Waves get durable identity.** `waves.start` mints and records a `waveId` (digest of
   `{repoId, idempotencyKey}`) BEFORE the member loop, as a `wave.started` coordination event
   carrying `{waveId, roster (roles), idempotencyKey, startedAt}` — the roster is known
   up-front; bindings are NOT (they land per-member). Each member's binding is recorded as it
   lands by adding `waveId` to the existing `steering.registered` payload written per run at
   creation (application.mjs:4066-4075) — so a driver dying mid-loop leaves already-started
   members attachable. `waves.start` takes an explicit `idempotencyKey`: a client retry of
   one logical start attaches to the same waveId instead of double-starting members (there
   is no run-level start idempotency inside createWave, wave.mjs:189).
2. **`waves.attach(waveId)` is an attach-and-harvest handle over the EXISTING runs — no new
   runs are started, and attach REQUIRES same-root open under lease reclaim** (a different
   root sees nothing; a live predecessor surfaces as `coordination_writer_busy` at open — the
   zombie case is refused at open, never at attach). The handle re-derives member state from
   each run's own status via the existing `runs.open`/`runs.attach` path (verified
   non-restarting, application-client.mjs:1248, :1263-1282): `progress()`, `runs`,
   `settle()`, `close()`, with `startedAt` SEEDED from the `wave.started` record (settle's
   pin fallback windows on it, wave.mjs:291). TRUTH CLAUSE: every member that was in-flight
   at the predecessor's death reads as recovery-terminalized at attach (CI6 — no live
   session survives a restart to honor a pause); those members' outcomes are harvested from
   their checkpoint pins, never 'resumed', and their re-drive belongs to rule 5.
3. **Steering continuity comes from `turn.settled` replay, not driver memory.** The dedup
   source of truth is the durable `turn.settled {basis:'nudge', pauseId}` record
   (coordinator.mjs:2190-2194): replay deletes consumed pause records on any turn.settled
   and seeds only unconsumed ones, so a post-attach nudge on a pre-death-nudged pause
   refuses `not_found` (the record is gone) and on a pre-death-unacted-but-terminalized pause
   refuses `not_paused` after reservation — a double-EFFECTIVE nudge is impossible by
   construction (single-consumer reservation, :2073-2105). The attention item's requestId IS
   the pauseId (application.mjs:7058). Note the tolerated dangling record
   (:12088-12096): replay may seed a pending pause for a terminalized task, surfacing a
   turn_checkpoint attention + an advertised nudge_turn on a dead member — drivers must
   expect and refuse-classify both refusal codes.
4. **Driver death is detected at attach, not minted at close.** `waves.attach` mints
   `wave.driver_detached` (key `wave.driver_detached:${waveId}`) when it observes a
   `wave.started` with no settle evidence (settlement is client-side state.outcomes; the
   durable referent is the absence of member outcomes in the snapshot) — `_append` returns
   the prior event on a duplicate key (coordination-store.mjs:1355-1356), so exactly-once is
   free, and the event exists exactly when the predecessor was SIGKILLed (a courtesy mint at
   close never fires). `waves.attach` on a wave whose members are all terminal returns their
   outcomes and closes cleanly (idempotent settle).
5. **Re-drive is the stated complement, and the ONLY recovery for terminalized members.**
   Attach is additive for harvesting; members that recovery terminalized at predecessor death
   are re-driven by starting a fresh wave for those members (salted objectives; checkpoint
   pins carry their completed work — the established salvage path). Starting a fresh wave
   with the same objectives also stays the supported recovery for any case attach can't
   serve (lost deployment root, or the R93R-7 client-retry case, which attaches instead).

## Red-first tests — `impl/test/wave-attach-red.test.mjs`

1. **W93-1:** a wave whose driver "dies" (host close without settle) is attachable by a fresh
   host: same member runs (same runIds), members read their honest terminal phases
   (recovery-terminalized, never 'continued'), and settle harvests outcomes from the
   checkpoint pins with startedAt seeded from wave.started.
2. **W93-2:** a pre-death-nudged pause refuses `not_found` post-attach (its record was
   consumed); a pre-death-unacted-and-terminalized pause refuses `not_paused` after
   reservation — both pinned by exact refusal code, and no double-effective nudge occurs.
3. **W93-3:** attach on an all-terminal wave is an idempotent settle (outcomes returned, close
   clean, no replay of recovery's terminalization).
4. **W93-4:** `waves.start` still mints distinct waveIds per attempt (salt discipline); attach
   with an unknown waveId refuses with a typed error, never a silent new wave.
5. **W93-5:** `wave.driver_detached` is recorded exactly once (key-deduped) across repeated
   attaches of the same waveId, and exists when the predecessor was SIGKILLed (no courtesy
   mint required at close).

Deterministic; MockAdapter/pausable-card fixtures; fixed clocks; no live providers.

## Verification

```text
node --test impl/test/wave-attach-red.test.mjs
```

then the canonical suite fully green.
