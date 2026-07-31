# 93B contract — wave durability: attach-and-resume for in-flight waves (v1)

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
   `{repoId, memberRoleDigests, salt}`), recorded as a `wave.started` coordination event with
   the member role→runId bindings. Identity survives host restarts.
2. **`waves.attach(waveId)` returns a live handle over the EXISTING runs** — no new runs are
   started. The handle re-derives member state from each run's own status (the same reads the
   start handle does): `progress()`, `runs` (the live run handles via the existing
   `runs.open`/`runs.attach` path — verify it re-attaches, never re-starts), `settle()`,
   `close()`. Terminal-or-orphan-terminalized members read as their honest terminal phases
   (recovery's work is respected, never replayed).
3. **Steering continuity is re-derived, not remembered.** Nudge dedup resumes from the
   durable pause records (`pause:${taskId}:${seq}` — a nudge requestId is stable per pause),
   so a re-attached driver never double-nudges a pause its predecessor already acted on (the
   nudge's own settled record is the dedup source of truth, not driver memory).
4. **Driver death is an event, not a corruption.** A `wave.driver_detached` record is minted
   when the host that started a wave closes without settling it (best-effort, never a gate).
   `waves.attach` on a wave whose members are all terminal returns their outcomes and closes
   cleanly (idempotent settle).
5. **Re-drive remains valid.** Attach is additive; starting a fresh wave with the same
   objectives (salted) stays the supported recovery for any case attach can't serve (e.g.,
   lost deployment root).

## Red-first tests — `impl/test/wave-attach-red.test.mjs`

1. **W93-1:** a wave whose driver "dies" (host close without settle) is attachable by a fresh
   host: same member runs (same runIds), progress reads live, settle produces outcomes.
2. **W93-2:** a paused member nudged pre-death is not double-nudged post-attach (dedup derived
   from the settled nudge record, not memory).
3. **W93-3:** attach on an all-terminal wave is an idempotent settle (outcomes returned, close
   clean, no replay of recovery's terminalization).
4. **W93-4:** `waves.start` still mints distinct waveIds per attempt (salt discipline); attach
   with an unknown waveId refuses with a typed error, never a silent new wave.
5. **W93-5:** `wave.driver_detached` is recorded exactly once per detach (idempotent on
   repeated host closes).

Deterministic; MockAdapter/pausable-card fixtures; fixed clocks; no live providers.

## Verification

```text
node --test impl/test/wave-attach-red.test.mjs
```

then the canonical suite fully green.
