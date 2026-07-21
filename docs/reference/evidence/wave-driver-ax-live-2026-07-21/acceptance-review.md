# Wave driver surface (docs/31) — acceptance re-review, 2026-07-21 (post-vacuity remediation)

Scope: `docs/31-wave-driver-ax.md`, `impl/src/wave.mjs`, `impl/test/wave-driver-red.test.mjs`,
the `baton.waves` getter and the `runs.*` client contracts in `impl/src/application-client.mjs`
(`runs.start`, `run.approve`/`act('approve_plan')`, `run.send`, `run.stop`, `act('stop_member')`,
`run.inspect`/`run.status`). This round re-audits the surface **after** the prior acceptance review
(which conditionally accepted with two P1 vacuities) and its remediation commits (`aefb275` close
findings, `880c283` re-pin vacuities). Deployment verification — the pinned execution contract —
was run in this worktree:

```
node --test impl/test/wave-driver-red.test.mjs   →   tests 10, pass 10, fail 0, EXIT 0
```

(`node`, argv `["--test","impl/test/wave-driver-red.test.mjs"]`, cwd `.`, expected exit `0` — met.)

## Verdict

**Accept.** The two P1 vacuities the prior round raised are genuinely closed, and every one of the
eight receipted failure modes is now pinned by a non-vacuous W row. I re-derived each docs/31 baked
semantic against the code and the RunView shapes it consumes; each is enforced, not merely claimed.

- **#1 passive-status stall / explicit approval.** `createWave` starts each member individually and
  calls `entry.run.approve()` unless `approve:false` (`wave.mjs:145-157`). W1 pins both sides: no
  member parks at `awaiting_plan_approval`, and a control member with `approve:false` *does* park
  (`test:157-163`). Not silent — the parked phase is surfaced through `progress()`.
- **#2 pump-as-terminal.** The surface never treats `run.complete()`'s resolution as terminal; it is
  only a drive pump (`armPump`, `wave.mjs:182-189`). settle's terminal predicate is `terminalFrom`
  = `outline.terminal===true ∪ {stopped,failed,cancelled,completed}` (`wave.mjs:74-76`). I confirmed
  `run.status` returns the **flat** RunView (`application.mjs:6650-6722`, no top-level `terminal`),
  so `terminalFrom` correctly rests on the phase set; `work_completed` is deliberately excluded and
  is handled as success-resting separately (`wave.mjs:263`).
- **#3 fail-fast cascade.** The wave deliberately does **not** use `runs.startMany` (whose group
  semantics reap admitted siblings on one crash, `application-client.mjs:1296-1337`); it starts each
  member in an isolated `try/catch` (`wave.mjs:145-157`). W2 pins that a crashed `beta` leaves
  `alpha` completing and preserving its own result with a zero-residue close (`test:166-183`).
- **#4 terminal taxonomy.** `work_completed` counts as settled-for-outcome (`wave.mjs:263`) with
  `terminal:false` honestly recorded; W1 asserts the disjunction `terminal===true || phase===
  'work_completed'` (`test:151-154`). Blocked interaction surfaces via `attentionFrom` (W4).
- **#5 glob-scope misuse.** Bare directories are rejected at admission with the corrective `dir/**`
  form; with `repoRoot` the filesystem decides, else the basename-dot heuristic, and a non-existent
  dotless path is treated as an intended directory (`wave.mjs:35-56`). W5 pins all three corners —
  dotless reject, existing-dotted-dir reject via `statSync`, non-existent-dotless reject
  (`test:226-240`).
- **#6 pin-fallback ambiguity — the previously-vacuous mode, now positively pinned.** The prior
  round found that the P1-A section-path fix made W7 stop exercising the `refs/baton/results/*`
  fallback. This is remediated by the new **W10** (`test:326-355`), a direct pin of the exported
  `resolveResultPin` (`wave.mjs:95-116`): it seeds an **older** pin whose tree carries
  `reports/alpha.md` and a **newer** sibling pin with the path removed, and asserts resolution
  returns the older path-carrying pin, `null` under used-sha exclusion, and `null` outside the
  start-time window. All three disambiguators (path existence via `git cat-file -e <sha>:<report>`,
  exclusion, window) are load-bearing. The materialize wiring that feeds it
  (`state.startedAt`, `excludeShas` from already-materialized outcomes, `wave.mjs:246-251`) is
  simple and visible.
- **#7 stopMember dispatch race — over-claim removed.** `stopMember` tries `act('stop_member', …)`
  and falls back to `run.stop` on `application_action_unavailable` (`wave.mjs:214-233`). Plain runs
  advertise no `stop_member` action, so the client throws that code on the first attempt
  (`application-client.mjs:1077`) and the plain-run branch runs; W6 pins it honestly (`stopped===true`,
  `admitted!==true`, `test:256-258`). The workflow-member retry-until-stoppable loop is inert for
  plain runs — and docs/31 #7 now **states this plainly**: "currently **unpinned**: no wave row can
  build a workflow member yet (nested orchestration is issue #12), and docs/31 does not claim
  coverage the surface cannot reach" (`docs/31:79-82`). The doc no longer over-claims; the prior P1
  is closed by scoping, which is the sanctioned option the prior review offered.
- **#8 watchdog-skipped outcomes / residue truth / pump lifetime.** settle always produces an
  outcome for every member, including after its own timeout (`wave.mjs:273-291`); W3 pins a
  never-finishing member getting `{terminal:false, resultSha:null}` alongside a completed sibling
  (`test:194-200`). `close` reads residue from the RunView `resources` block, coalesces a missing
  block to `+1` (never `0`) and flags `residueUnknown` (`wave.mjs:308-321`); W8 asserts the block is
  present and `ownedCount` is a real integer with `residueUnknown===false` (`test:299-305`). Pumps
  are drained with a bounded grace before both settle and close return (`drainPumps`,
  `wave.mjs:194-202`; called `wave.mjs:292,298`); W3 asserts `wave.pumpQuiescent===true` after a
  timed-out settle (`test:201`).

The `baton.waves` getter is sound (`application-client.mjs:1484-1486`): the arrow captures the
getter's `this` (the frozen `BatonClient`, whose `runs.start` is a function), so a destructured
`const { start } = client.waves` cannot lose its binding, and the returned object is frozen; W9
exercises it end-to-end (`test:312-324`). The suite banner (`test:1-5`) now matches what the rows
hold ("pin-fallback ambiguity (positively, via synthetic sibling pins)", "selective member stop"),
resolving the prior non-blocking correction.

No P0 (nothing crashes, loses data, or fails the contract) and no P1 (no receipted failure mode is
left vacuous). The residual items below are non-blocking observations recorded for honesty, not
acceptance blockers.

## P0-P1 findings

None. Both prior-round P1 vacuities (#6 W7-uncovered fallback, #7 doc over-claim) are closed — #6 by
the new positive W10 pin, #7 by narrowing docs/31 #7 to acknowledge the unpinned workflow-member
retry. All eight failure modes are pinned by non-vacuous rows.

Non-blocking observations (none rise to P0/P1; recorded so a future round does not re-litigate them):

- **#6 is pinned at the unit, not the integration, seam.** W10 pins `resolveResultPin` directly (the
  code comment at `wave.mjs:94` says as much: "Exported so the disambiguation is directly pinnable
  (W10)"). No W row drives `materialize`→`settle` into the fallback with a real member (every
  integration member's result section succeeds, so `wave.mjs:243` returns before the fallback). The
  disambiguation *logic* is fully pinned; only the trivial three-argument wiring
  (`repoRoot`/`report`/`startedAtMs`/`excludeShas`, `wave.mjs:246-251`) is unpinned. Acceptable, but
  a single integration row would make the whole path regression-proof.
- **Hardcoded git binary.** `resolveResultPin` invokes `/usr/bin/git` (`wave.mjs:101,111`) while the
  test harness uses `git` on `PATH` (`test:23-24`). Both resolve on this darwin host (W10 green), but
  the absolute path is non-portable (e.g. a Homebrew-only `/opt/homebrew/bin/git`); a `git`-on-PATH
  invocation would match the rest of the codebase and the tests.
- **Dead attention synthesis.** `attentionFrom` returns `null` for an empty `attention` array
  *before* reaching the phase-based synthesis branches (`wave.mjs:80` short-circuits `wave.mjs:84-86`).
  Real RunViews always supply an array (`application.mjs:4687,6673`), so the synthesized
  `blocked_interaction:*` strings for `awaiting_plan_approval`/`selection_required`/`input_required`
  are unreachable. Semantic #4 still holds via the non-empty-array path (W4), and #1's parked case
  surfaces through the phase, so this is cosmetic dead code, not a broken claim.
- **Concurrent `settle` self-race.** The task asked about concurrent settle/progress/stopMember. The
  final outcome loop guards on `state.outcomes.some(role)` but has `await`s between the guard and the
  push (`wave.mjs:273-291`), so two *concurrent* `settle()` calls could double-push an outcome. This
  needs caller misuse of a surface docs/31 defines as a single orchestrator-side driver ("holds no
  durable state of its own"), and no row triggers it; low severity. `progress`/`stopMember` mutate
  disjoint arrays and are safe to interleave.
- **`drainPumps` grace timer is not cleared.** The losing `setTimeout` in the `Promise.race`
  (`wave.mjs:199`) is never cleared, so a fast drain leaves a timer pending up to the 2 s grace.
  Harmless under `node --test`; a `clearTimeout` on the winning branch would be tidier.

## Required corrections

None required for acceptance. The pinned contract passes (exit 0) and every receipted failure mode
is non-vacuously held.

Optional hardening, in priority order, if a future round wants zero residual seams:

1. Add one integration W row that forces `materialize` into the `refs/baton/results/*` fallback with
   a real member (empty result section + a newer pathless sibling pin) and asserts the older
   path-carrying `resultSha`, so the `materialize`→`resolveResultPin` wiring — not just the exported
   function — is regression-proof.
2. Replace `/usr/bin/git` with a `git`-on-PATH invocation in `resolveResultPin` to match the harness
   and remain portable off darwin.
3. Either delete the unreachable phase-synthesis branch in `attentionFrom` or reorder it before the
   empty-array short-circuit so a parked member surfaces `blocked_interaction:approve_plan` — then
   pin it — instead of shipping it as dead code.

Re-run `node --test impl/test/wave-driver-red.test.mjs` (expect exit 0) after any of the above and
confirm the new assertions fail if the corresponding path regresses.
