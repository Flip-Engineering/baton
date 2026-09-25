# Issue #260 — the dangling awaits: cause, repairs, and verdict

**Date:** 2026-09-13 · **Scope:** the ten files named in the #260 inventory, the expected-red
manifest, and this audit. **Author:** participant `dangling` (swarm `dangling-260`).

Ten test files each contained a test whose awaited operation never settled. Node's test runner
reports that as `cancelledByParent` —

```
Promise resolution is still pending but the event loop has already resolved
```

— and cancels **every later test in the same file**, so 139 manifest rows described tests that
never ran. All ten are settled: **0 cancelled** rows remain in the whole suite. No `impl/src`
behavior was changed.

## The mechanism (one cause, ten instances)

The harness never pins its host's event loop. The coordinator's stop deadline, its reap-retry
timer, the emergency-stop deadline, the recovery timeout, and the LSP pool's detached server are
**deliberately `unref()`'d** (docs/24 G4/C4; `coordinator.mjs` `_beginStop`/`_retryProcessReap`/
`_emergencyKillUnlogged`; `lsp-pool.mjs` "detached group leader: unref so an idle pool never pins
the host's event loop"). In production a real spawned child is the handle that keeps the loop
alive, so those bounded waits always fire.

Every one of these fixtures, however, drives an adapter that owns **no live child handle** — a
`MockAdapter`/`ScriptableAdapter`/emit-only stub, or a fixture whose native child is itself
spawned `detached` *and* `unref`'d. When the only remaining settlement for an awaited operation
is one of those unref'd deadlines, the loop drains, node exits the test context, and the promise
is abandoned. That is a *dangling await*, not a timeout: the process finishes in milliseconds.

The suite already documents the remedy — `test/omp-control-truth.test.mjs:41-44`:

> A real spawned child is a live libuv handle that keeps the event loop alive; the adapter's
> observation timers are unref'd on purpose. Hold the loop for the fixture so the unref'd timers
> still fire, and drop it with the process-exit fact.

So each repair is a **scoped `withLiveLoop(fn)` hold** around exactly the await whose only
settlement is the harness's own deadline, released in `finally`. The hold adds no control: the
deadline still bounds the operation, `until()`-style fixtures still throw at their own bound, and
an operation that genuinely never settles still fails the row at its named stage instead of
cancelling the file. Nothing was fixed by adding a timeout constant, and no test was deleted,
skipped, or weakened.

Two rows needed the opposite direction, and one needed a fixture correction — see the per-file
notes.

## Per file

| File | First dangling row | Repair | Tests that now run |
|---|---|---|---|
| `phase51-process-lifecycle.test.mjs` | PL7 — each observed unconfirmed reap drives a bounded coordinator kill | hold around the in-flight `kill()`/`recover()` awaits (4 sites) + kimi fixture correction | 75 of 75 run, all pass |
| `phase91-semantic-interrupt-preservation-red.test.mjs` | P91-3 — preservation uncertainty never claims an attached session | hold around the unconfirmed `interrupt()` await | 25 of 25 run, all pass |
| `phase11-coordination-store.test.mjs` | ER5 — emergency kill timeout keeps ownership | hold around the emergency `kill()` await | 30 of 30 run: 29 pass, 1 red-first row fails at its named stage |
| `readiness-credentials-red.test.mjs` | RT-3b — the ≤120s probe timeout is ENFORCED | the row's own 5s watchdog was `unref`'d; made it a live handle | 26 of 26 run, all pass |
| `phase11-persistent-sessions.test.mjs` | PS7 — a hung reattachment is bounded | hold around the recovery awaits (5 sites) | 43 of 43 run: 41 pass, 2 red-first rows fail at their named stages |
| `board-workerhalf-red.test.mjs` | BW-12 — restart replay reconstructs grants, claims, reports, and both fences | hold inside `killMember()` | 24 of 24 run, all pass |
| `issue144-lsp-pool-red.test.mjs` | R3 — the server rides the exact lifecycle | hold around the pool readiness/reap awaits (4 sites) | 23 of 23 run, all pass |
| `phase65-run-semantic-review-integration.test.mjs` | SR3/SR10 — approval and adoption reconstruct from durable state | hold around the application's bounded waits (6 sites) | 15 of 15 run, all pass |
| `phase76-recovery-attempt-integration.test.mjs` | RAI4 › timed-out attach with confirmed close | hold around the three recovery awaits | 13 of 13 run, all pass |
| `phase45-session-auto-rejoin.test.mjs` | SR2-SR8 — public startup automatically reattaches one exact native session | hold around `replay.ready` and `closeAsync()` | 7 of 7 run, all pass |

### `phase51-process-lifecycle.test.mjs`

The first dangle was the PL7 coordinator-retry row: the mocked first `reapOwnedProcessGroup`
refuses *after* the fake Codex child is already gone, so the retry that converges the stop rides
`_retryProcessReap`'s unref'd 1–5 ms timer with no live handle left. Six more rows dangled the
same way behind it (the forced-stop/emergency rows settle only through `_stopDeadlineMs`; the
`session_identity_mismatch` recovery row through `_recoveryTimeoutMs`).

One row in this file was a **fixture race, not a drain**: the kimi case of
`PL7/PL9: every native harness retains a natural-close terminal across an unconfirmed first
reap` failed 2 of 6 standalone runs. The kimi fake has no `FAKE:STAY_OPEN` brief form (the codex
and grok fakes do): `session/prompt` replies `end_turn` immediately, so the spawn turn raced the
case's `SIGKILL` — when the reply won, `lifecycle.turn_completed` replaced the natural-close
`lifecycle.crashed` terminal and the assertion failed. The case now runs the fake in
`FAKE_KIMI_MODE=prompt-hang` (its documented chunk-then-hold shape), matching the other three
harnesses' held turns: 0 failures in 12 consecutive runs afterwards.

### `phase91-semantic-interrupt-preservation-red.test.mjs`

P91-3's second half builds `fixture({ confirmInterrupt: false, stopDeadlineMs: 15 })` — the
adapter withholds `control.interrupt_confirmed`, so the awaited `interrupt()` can only settle
through the coordinator's unref'd stop deadline. Held; `preservation_timeout` then lands as the
row expects.

### `phase11-coordination-store.test.mjs`

ER5 poisons the log and installs `adapter.kill = async () => ({ ok: true })`, so nothing ever
confirms. The emergency stop's only remaining settlement is `_emergencyKillUnlogged`'s unref'd
`_stopDeadlineMs` (20 ms). Held; the row's `confirmation_timeout_unlogged` lands. The 22 rows
behind it now run: 21 pass, and
`CK8/CK9: public driver exposes coordination and queued DAG survives restart before dispatch`
fails at its named stage (an adapter-dialect deep-equal) — a pre-existing red-first row, kept in
the manifest.

### `readiness-credentials-red.test.mjs`

RT-3b is the inverse case: the row *is* the enforcement oracle ("a hanging probe is killed and
classified provider_unreachable, never awaited forever"), and its own 5 s race deadline was
created with `timer.unref?.()`. With `#47`'s kill timer absent, the probe stays pending and the
unref'd watchdog lets the loop drain — the row could never observe its own red stage. The
watchdog is now a live handle, so the row fails (or passes, when the tier enforces the bound) at
its named stage. All 26 rows run; all 26 pass at HEAD.

### `phase11-persistent-sessions.test.mjs`

The first dangle was `NR3/NR4: a hung continuation dispatch is bounded` — `prompt` returns a
never-settling promise and `_recoveryTimeoutMs = 20` is the only settlement. Four more recovery
rows dangled behind it (PS7's hung reattachment, the timed-out attach, and the unconfirmed
teardown). After the holds, 41 rows pass and two red-first rows fail at named stages
(`NR1/NR3: recovery attaches without provider work…`, `NR3/NR5: refused recovery continuation…`),
both kept in the manifest.

### `board-workerhalf-red.test.mjs`

BW-12 killed a parked `ScriptableAdapter` member; a parked member takes the *forced* stop path,
so `killMember()`'s await settles only through the driver's unref'd `stopDeadlineMs` (1000 ms).
Holding inside the shared `killMember()` helper settled BW-12 (4.6 s, all assertions green) and
the six later rows that call it. 24 of 24 run, all pass.

### `issue144-lsp-pool-red.test.mjs`

R3 was the file's first dangle: the pool spawns its stub server detached and unref'd by design,
so `pool.ready(...)` (handshake), `assert.rejects(crashPool.ready(...))` (`lsp_startup_failed`),
and the post-slot-clear retry each depended on the pool's own supervision with nothing left to
keep the loop alive. Four scoped holds; the whole R1–R13 red-first suite then runs and passes
(23 of 23) — the pool's implementation is landed at HEAD even though the file header still
describes it as "NOT landed".

### `phase65-run-semantic-review-integration.test.mjs`

SR3/SR10 traced (temporary `console.error` traces, removed before the final diff) to
`run.status` on the *reopened* application: the reconstruction path rides the driver's unref'd
`stopDeadlineMs: 2000` (1255 ms → 3441 ms in the trace). Holds cover the review/wait/adopt/
shutdown/status/integrate awaits. 15 of 15 run, all pass.

### `phase76-recovery-attempt-integration.test.mjs`

RAI4's `timed-out attach with confirmed close` (spawn never settles, `recoveryTimeoutMs: 20`) and
`unconfirmed adapter close` (`stopDeadlineMs: 20`, kill returns `{ok:true}` and never confirms)
both settle only through unref'd deadlines; a third subtest shares the shape. Three holds; all 13
rows run and pass.

### `phase45-session-auto-rejoin.test.mjs`

The file's last row: `replay.ready` (a `SessionRecoverySupervisor` with `timeoutMs: 500`) and
`replay.closeAsync()`, against a fixture whose native children are spawned detached **and
`unref`'d**. Held; the row passes in ~0.9 s. The two dense one-line steps of that row were split
for readability while wrapping them; every assertion is byte-identical.

## Manifest accounting

`impl/scripts/expected-red-tests.json`: **588 → 449 rows (−139)**.

| File | rows listed before | removed | kept |
|---|---|---|---|
| `phase51-process-lifecycle.test.mjs` | 24 | 24 | 0 |
| `phase91-semantic-interrupt-preservation-red.test.mjs` | 23 | 23 | 0 |
| `phase11-coordination-store.test.mjs` | 23 | 22 | 1 |
| `readiness-credentials-red.test.mjs` | 21 | 21 | 0 |
| `phase11-persistent-sessions.test.mjs` | 17 | 15 | 2 |
| `board-workerhalf-red.test.mjs` | 13 | 13 | 0 |
| `issue144-lsp-pool-red.test.mjs` | 11 | 11 | 0 |
| `phase65-run-semantic-review-integration.test.mjs` | 6 | 6 | 0 |
| `phase76-recovery-attempt-integration.test.mjs` | 3 | 3 | 0 |
| `phase45-session-auto-rejoin.test.mjs` | 1 | 1 | 0 |

The three kept rows are the rows that now *fail at a named stage* rather than being cancelled:

- `phase11-coordination-store.test.mjs :: CK8/CK9: public driver exposes coordination and queued DAG survives restart before dispatch` — `testCodeFailure`, strict deep-equal.
- `phase11-persistent-sessions.test.mjs :: NR1/NR3: recovery attaches without provider work, commits its refinement and intent, then prompts` — "coordinator uses the immutable admitted Brief through the adapter dialect hook".
- `phase11-persistent-sessions.test.mjs :: NR3/NR5: refused recovery continuation fails the refinement and kills/reaps the attached transport` — "custom adapters fall back to prompt(worker, admitted brief, turn)".

## Verification

Each file, run alone through the canonical runner after the manifest was final:

```
$ node impl/scripts/run-suite.mjs impl/test/<file>
phase51-process-lifecycle                :: GREEN — 75 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase91-semantic-interrupt-preservation  :: GREEN — 25 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase11-coordination-store               :: GREEN — 29 passed, 1 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
readiness-credentials-red                :: GREEN — 26 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase11-persistent-sessions              :: GREEN — 41 passed, 2 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
board-workerhalf-red                     :: GREEN — 24 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
issue144-lsp-pool-red                    :: GREEN — 23 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase65-run-semantic-review-integration  :: GREEN — 15 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase76-recovery-attempt-integration     :: GREEN — 13 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
phase45-session-auto-rejoin              :: GREEN —  7 passed, 0 expected red, 0 unexpected, 0 stale, 0 hung, 0 stalled
```

The whole suite, twice on the delivered state (the second run an hour later, same tree):

```
$ node impl/scripts/run-suite.mjs
run 1 — RED — 4671 passed, 449 expected red (0 of them cancelled by a dangling await earlier in
        their file), 22 unexpected failure(s), 0 stale expectation(s), 0 hung, 0 stalled lane(s)
run 2 — RED — 4670 passed, 449 expected red (0 cancelled), 23 unexpected failure(s),
        0 stale expectation(s), 0 hung, 0 stalled lane(s)
```

**0 cancelled, 0 stale, 0 hung, 0 stalled in both runs** — the #260 inventory is empty and the
manifest describes the suite that exists. The verdict is still RED because of rows outside this
scope, described next; the one-row delta between the two runs is the ambient load-flake
`worktree-capacity-contention :: WCC8` ("Unexpected end of JSON input") that appeared only in
run 2.

## The residual unexpected failures (outside this scope, unchanged by this work)

Run 1's 22 rows are all deployment-readiness rows in red-first spec files
(`feedback-forge-hardening-red` ×3, `phase78-bound-run-group-red` ×1,
`phase78-concise-deployment-factory` ×4, `phase79-workflow-composition-red` ×6,
`phase80-application-revision-red` ×4, `phase83-context-runtime-red` ×4). Twenty carry the
readiness summary verbatim, two (`DF3`, `DF6`) receive that same refusal where they expected a
different typed code, so their predicate returns false — verified by running that file alone:

```
not ok 5 - DF3: exact route cards are self-described and multi-route start has no effort fallback
    The validation function is expected to return "true". Received false
    Caught error:
    Error: No provider credential is projected into the worker runtime for this route.
```

Cause: `deploymentReadiness()` refuses a route whose credential is not projected
(`impl/src/application-deployment.mjs:1271-1277`, code `route_credentials_unprojected`).
`credentialProjectionResolves()` (ibid. 1143-1152) resolves credentials from
`$HOME/.codex/auth.json`, `$HOME/.grok/auth.json`, `$HOME/.claude/.credentials.json`,
`$HOME/.kimi-code`, the omp tree, or a per-route env/file/tree projection. This seat's HOME holds
only `~/.omp/agent/agent.db`:

```
absent  $HOME/.codex/auth.json          absent  $HOME/.claude/.credentials.json
absent  $HOME/.grok/auth.json           absent  $HOME/.kimi-code
PRESENT $HOME/.omp/agent/agent.db
```

Those rows therefore block every codex/grok/kimi/claude route and fail in a way the manifest does
not list. They are environmental, not regressions: the unexpected-failure set of the final run is
**byte-identical** to the set from the first full run of this campaign (22 rows, compared with the
suite tmp path normalized and with the run-2 flake excluded), which already contained this
worktree's `phase51` repair — i.e. no row appeared or disappeared because of this work.

Two further ambient fragilities were observed during the campaign and are *not* addressed here
(both outside the ten files):

- Flaky rows in other files surfaced only under full-suite load and vanished on a fast run —
  e.g. `blind-waits-red :: A1-a` reported as a *stale expectation* in one run of eight, and
  single-run appearance/disappearance of `phase8-correctness` C5/C7, `phase56-drain-and-close`
  DC1/DC5, `acp-json-rpc-process`, `phase25-atlas-behavior-fingerprint`,
  `phase40-proposed-install-graph`, and `worktree-capacity-contention` WCC2/WCC8
  ("condition never became true within 1500ms", "elapsed 298ms", "Unexpected end of JSON input").
  These are wall-clock-bounded rows reacting to load (issue #77 territory).
- The `baton-rg-*/fixture.mjs :: (file exited 0 without reporting)` rows are an artifact of a test
  that runs the suite runner against a fixture directory; they appear in both the baseline and the
  final run.

## What was not done

- **No `impl/src` change.** No typed refusal was needed anywhere: in every instance the runtime
  *does* answer — the deadline fires and reports its typed outcome — once the host's event loop is
  alive for the bounded wait. The kernel's "never pin the host" posture (docs/24 G4/C4) is the
  documented contract and is unchanged, so the repair belongs in the fixtures that removed the
  host's liveness.
- **No timeouts added to make a hang disappear**, no `test.skip`, no deleted rows beyond the
  manifest rows that now pass, and no assertion relaxed. The one place a bound was touched
  (RT-3b) makes an existing, documented 5 s resource bound *effective*.
- **No fixture file was modified**: the phase51 kimi repair selects the fake's existing
  `prompt-hang` mode through the adapter's `env` option rather than editing
  `test/fixtures/fake-kimi-acp.mjs`.

## Changed files

`impl/test/phase51-process-lifecycle.test.mjs`, `impl/test/phase91-semantic-interrupt-preservation-red.test.mjs`,
`impl/test/phase11-coordination-store.test.mjs`, `impl/test/readiness-credentials-red.test.mjs`,
`impl/test/phase11-persistent-sessions.test.mjs`, `impl/test/board-workerhalf-red.test.mjs`,
`impl/test/issue144-lsp-pool-red.test.mjs`, `impl/test/phase65-run-semantic-review-integration.test.mjs`,
`impl/test/phase76-recovery-attempt-integration.test.mjs`, `impl/test/phase45-session-auto-rejoin.test.mjs`,
`impl/scripts/expected-red-tests.json`, this audit.
