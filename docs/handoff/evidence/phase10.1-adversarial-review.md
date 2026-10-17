# Phase 10.1 adversarial review

Date: 2026-07-10

Scope: all changes from `f966e66` implementing SC12–SC19

Gate: SC20, before any real-vendor recursive dogfooding

## Method

The review re-read the changed coordinator and three session adapters as state machines rather
than trusting green tests. It attacked five dimensions:

1. process ownership before and after every asynchronous boundary;
2. stop/refusal ordering and terminal-state monotonicity;
3. queued-delivery authority after interrupt and kill;
4. runtime versus append-log replay equivalence;
5. timer cleanup and story truth after terminal events.

The review then extended the regression suite for every surviving issue and re-ran bare
`node --test` from `impl/`.

## Original finding closure

| Findings | Closure evidence |
|---|---|
| U-1/U-6 | SC12 pending-spawn reservations; kill and interrupt tests cover Claude, Codex, and Grok; readiness after stop creates no child |
| U-2/U-11 | SC13 makes cancellation terminal and refusal state-aware; runtime plus replay race test stays cancelled with no fabricated crash |
| U-3 | SC14 slot-time worker/task guards; both interrupt and kill queue races prevent B from reaching the adapter |
| U-4 | SC15 normalizes rejected spawn through durable `_onSpawnRefused`; test observes failed plus exactly one spawn-phase crash |
| U-5 | synchronous per-worker reservation in all three adapters; duplicate test produces one success and one child |
| U-7 | Codex first-turn failure now kills and deletes the session; PID-level test proves the child is gone before refusal is accepted |
| U-8 | story carries a crash fact; crash never counts/renders as done and unrelated warnings do not suppress a clean exit |
| U-9 | `TURN_STARTED` clears `lastVerdict`; a later crash cannot inherit an earlier done count |
| U-10 | all session adapters enforce `timeoutMs`, emit one timeout-phase crash, reap, and clear the timer on confirmed interrupt |
| C-1 | SC1d asserts the durable spawn-phase crash event |
| C-2 | SC8 pins exact maps for ClaudeSessionCli, CodexAppServerCli, and GrokAcpCli |

## New adversarial findings

### R-1 — major — late-created worktree survived an early stop

The first stop reap could run before `worktreeReady` finished. Child creation was prevented, but
the completed checkout would then remain. Fixed by reaping again in the readiness continuation
when the handle is stopping/dead or the task is terminal. The regression records whether removal
ran after creation, not merely whether `remove()` was called.

### R-2 — major — runtime terminal monotonicity was not replay monotonicity

Late events no longer revived runtime tasks, but `_replay()` still applied later
`turn_started`, verification, crash, stop, and input events unconditionally. A restart could thus
change a completed/cancelled result. Fixed by applying terminal monotonicity to every replay row and
to runtime question/approval state. The regression appends late turn/input/crash/kill facts and
proves both live and reconstructed results stay completed.

### R-3 — minor — accepted work could mask a later process crash in the story

The first SC17 fix excluded crashed exits but its `lastVerdict.accept` OR-branch could still count a
crashed worker as done. Fixed by making `!crashed` cover both clean-exit and accepted-verdict paths.

### R-4 — major — an interrupted reusable session retained its wall timer

Kill/close cleared the new timer, but native interrupt deliberately preserves the session and did
not. The timer could later emit a false timeout crash for a cancelled worker. Each wire's confirmed
interrupt path now clears it; the three-adapter regression waits beyond the former deadline and
proves no timeout event appears.

All four findings were fixed and test-locked during this review. No critical or major finding
remains unresolved.

## Deliberate boundaries, not hidden debt in this gate

- The legacy one-shot CLI tier is still explicitly fire-and-forget and is not used by the phase-10
  capstone. SC12 applies to the full-session product adapters named by the goal.
- Token/USD enforcement and story-driven watchdog action remain the separately documented
  phase-11 governance plane. SC18 closes only the lost session wall-time bound.
- Coordinator restart reattachment to live vendor sessions remains a named phase-11/non-goal; SC13
  guarantees replayed task truth, not process reattachment.

## Gate result

`git diff --check` is clean. Bare `node --test` is **427/427 passing**. SC12–SC19 have direct
effect-level coverage, including PID reaping and restart replay. SC20's zero-quota safety gate is
therefore **PASS**: recursive Baton-on-Baton dogfooding may begin using the session adapters through
`createDriver()`.
