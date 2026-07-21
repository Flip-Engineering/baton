# Wave driver surface (docs/31) — acceptance review

Scope: `docs/31-wave-driver-ax.md`, `impl/src/wave.mjs`, `impl/test/wave-driver-red.test.mjs`,
the `baton.waves` getter and `runs.*` contracts in `impl/src/application-client.mjs`.
Deployment verification (pinned suite) executed:

```
node --test impl/test/wave-driver-red.test.mjs   →   exit 0  (9/9 pass)
```

The contract is GREEN. This review nonetheless rejects acceptance: two of the eight baked
semantics (docs/31 #6 materialization, docs/31 #8 residue truth) are enforced only *vacuously* —
the code reads response fields that the Baton command port never emits, so the guarantee silently
degrades and the W rows that claim to pin it pass without exercising the real behavior. The
task's own done-condition — "Baton preserves exact route, result, and cleanup truth" — is exactly
what fails: **result truth and cleanup truth are both unenforced.**

## Verdict

REJECT (green suite, non-genuine pins). Route/approval/isolation/attention semantics (#1–#5, #7
for the plain-run path) are genuinely enforced and genuinely pinned. But:

- **docs/31 #6 "materializes from the result section first" is dead code.** `materialize`
  (`wave.mjs:184-186`) reads `results?.view?.section?.items?.[0]?.value`, but the core
  `run.inspect{depth:'section'}` response has `section` at the **top level** with no `.view`
  wrapper (`application.mjs:9381-9388`; the CLI mirror confirms `result.section`, not
  `result.view.section`, at `application-cli.mjs:927`). `results.view` is always `undefined`, so
  the primary path always yields `undefined`, `RESULT_SHA.test('')` is false, and **every**
  materialization silently falls through to the `refs/baton/results/*` git fallback. The correct
  address is `results?.section?.items?.[0]?.value.sha` (the result item's `value` is
  `clone(view.result) = { sha, ref }`, `application.mjs:8931/8944`), so this is a one-token
  (`.view.`) regression that disables the documented "result section first" behavior entirely.

- **docs/31 #8 "the exact remaining count per member" is structurally always 0.** `close`
  (`wave.mjs:262`) computes `stop.ownership?.remainingCount ?? 0`. The `run.stop` RunView carries
  residue at `stop.stop.receipt.remainingCount` (proven by `application.mjs:4666`
  `runStop?.receipt?.remainingCount`, `application.mjs:1373`, and `web-operator.mjs:145`
  `view.stop.receipt.remainingCount`). The view's `ownership` field is
  `{ workers, workerIds, closed }` / `{ runAuthorityReleased }` (`application.mjs:4695`,
  `3948`, `10296`) and has **no** `remainingCount`. So `stop.ownership?.remainingCount` is
  perpetually `undefined → 0`. `close.remainingCount` is hardcoded-to-zero for every successful
  stop; the genuine residue signal (which `close` even *stores* as `stop: stopped.stop`) is never
  read. Cleanup truth is not surfaced.

Because of these two field-path defects, the following W-row assertions are **vacuous** (they pass
regardless of the behavior they name):

- `remainingCount === 0` in **W2, W3, W6, W8** — always 0 by construction; would pass even with
  live residue. W8's title claims "ownership receipts" but never asserts any stop record carries
  one.
- **W7** genuinely pins the pin-disambiguation fallback (path-probing + used-sha exclusion), but
  it exercises only the fallback; the documented **"result section first"** path is never
  covered by any row (it is dead), so failure mode #6's *primary* remedy is unpinned.
- **W6**'s `stop.admitted === true || stop.stopped === true` masks that waves only ever create
  plain runs (`baton.runs.start`), which never advertise a `stop_member` action; `act('stop_member')`
  always throws `application_action_unavailable`, so the retry-on-`application_action_scope_mismatch` /
  `application_workflow_member_stop_unavailable` loop and the `admitted:true` branch
  (`wave.mjs:163-178`) are **unreachable** in the wave surface. docs/31 #7's dispatch-race retry is
  claimed but inert; W6 only ever proves the `run.stop` fallback.

## P0-P1 findings

**P1-A — Result materialization never uses the result section (docs/31 #6 claimed, not enforced).**
`wave.mjs:185` `results?.view?.section` reads a non-existent wrapper; `run.inspect{depth:'section'}`
returns `section` at top level (`application.mjs:9381-9388`). The primary "result section first"
path is dead; materialization silently relies on the git-pin fallback, which needs two
**undocumented** inputs absent from the docs/31 public surface: the wave-level `repoRoot`
(`wave.mjs:88`) and the member-level `report` (`wave.mjs:181-206`). Under the *documented* API
(`baton.waves.start({ members:[{role,exact?,harness?,model?,effort?,scope,objective}], verification?,
approve? })`) neither exists, so `settle` returns `resultSha: null` for every member — no result is
ever materialized. The whole suite only materializes because the test `member()` helper injects
`report:` and every `createWave` call injects `repoRoot:`. Result truth is not preserved through
the advertised surface.

**P1-B — Zero-residue close reads the wrong receipt; remaining count is always 0 (docs/31 #8
claimed, not enforced).** `wave.mjs:262` reads `stop.ownership?.remainingCount`; residue lives at
`stop.stop.receipt.remainingCount`. `close.remainingCount` cannot ever report a non-zero residue
for a successful stop, so "the exact remaining count per member" is never honest, and a stop that
leaves owned workers behind is reported as zero-residue. Missing/partial ownership receipts are
also swallowed by the same `?? 0`. Cleanup truth is not preserved.

**P1-C — docs/31 #7 stopMember retry path is inert for waves.** Waves compose only plain runs, so
the scope-mismatch retry loop and the `admitted` branch never execute; only the
`application_action_unavailable → run.stop` fallback (`wave.mjs:169-172`) runs. The receipted
failure mode (workflow-member dispatch race, `stoppableRoles` requiring `taskId !== null`) is not
reachable or exercised here. Either wire waves to real workflow members, or scope docs/31 #7 to the
plain-run `run.stop` fallback it actually delivers, so the claim matches the surface.

**P2-D — Glob admission does not enforce "existing directory semantics" (docs/31 #5).**
`validateMember` (`wave.mjs:33-44`) distinguishes file from directory by a basename `.`-heuristic,
never touching the filesystem. A dotted directory name (`assets/v1.2`) passes even as a bare
directory; a non-existent path (`nowhere`) is rejected as if it existed. W5 only probes `reports`
(no dot), so the heuristic's false-accept/false-reject corners are unpinned. Behavior is
conservative, but the doc's "existing directory semantics" wording is not what the code does.

**P2-E — Pump leak on settle timeout.** `armPump` (`wave.mjs:142-149`) fires
`run.complete()` fire-and-forget and only clears its `pumps` flag on resolution. When `settle`
returns on its own timeout (W3: beta `delayMs 60_000`, timeout 2_000), the in-flight
`run.complete()` keeps driving the run in the background after `settle` has returned, and races the
subsequent `close`→`run.stop`. Rejections are absorbed (no unhandled rejection), so it is not
fatal, but the "no scheduling loop beyond per-member pumping / holds no durable state" claim is
weakened by orphaned pumps that outlive the wave call that armed them. No row asserts pump
quiescence.

Notes that are NOT defects: the `baton.waves` getter (`application-client.mjs:1484-1486`) is
sound — the arrow captures the getter's `this` (the frozen `BatonClient`), so destructuring
`const { start } = client.waves` keeps the binding; the returned object is frozen. Per-member
isolation (#3), explicit approval (#1, with W1's `approve:false` parked control proving the gate),
`work_completed`/`selection_required` taxonomy (#4 via `attentionFrom`/settle), and the
`{stopped,failed,cancelled,completed}` terminal set (#2, `run.complete()`'s return is correctly
discarded) are genuinely enforced. `settle` always producing an outcome (#8 first clause) is
genuine and genuinely pinned by W3.

## Required corrections

1. **P1-A:** Fix `wave.mjs:185` to `results?.section?.items?.[0]?.value` (drop the `.view.`
   wrapper) so "result section first" actually runs; then add a W row that asserts a member's
   `resultSha` is produced from the result section **without** `repoRoot`/`report` (i.e. the
   documented surface). Either document `repoRoot`/`report`/`verification` in docs/31's API block
   and wire `verification` (currently accepted in the doc signature but never read by `createWave`),
   or remove them from the doc so the surface and the claim agree.

2. **P1-B:** Fix `wave.mjs:262` to read `stop.stop?.receipt?.remainingCount` (with an explicit
   unknown/attention path when the receipt is absent, rather than coalescing missing receipts to
   0). Add a W row that drives a non-zero residue (or a stop whose receipt is missing) and asserts
   `close.remainingCount` reflects it and that each `stops[i]` carries an ownership/receipt — so
   the W2/W3/W6/W8 `remainingCount === 0` assertions stop being vacuous.

3. **P1-C:** Reconcile docs/31 #7 with reality: either exercise a workflow-member wave so the
   `stop_member` retry/`admitted` branch is reachable and pin it, or narrow the doc to the
   plain-run `run.stop` fallback the wave actually performs, and change W6 to assert the specific
   branch taken instead of `admitted || stopped`.

4. **P2-D:** Either perform a real filesystem existing-directory check in `validateMember`, or
   reword docs/31 #5 to describe the glob-magic + basename heuristic that is actually implemented;
   add W-row coverage for a dotted-directory and a non-existent path.

5. **P2-E:** Track and drain pumps on `settle` return/timeout (await or abort the outstanding
   `run.complete()` promises before returning), and assert pump quiescence in the timeout row.

6. Re-run the pinned suite after corrections; the contract
   (`node --test impl/test/wave-driver-red.test.mjs`, exit 0) must stay green **and** the newly
   added assertions must be non-vacuous (fail if the field-path bugs are reintroduced).
