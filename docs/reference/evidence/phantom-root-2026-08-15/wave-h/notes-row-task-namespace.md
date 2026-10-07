[attempt: 8acdcc3d-17ab-471c-9525-0cce86606e3d row-task-namespace]
# row-task-namespace — implementation + verification notes (#200 / D2.1)

Contract source: issue #200 reconstructed from the repo's own contract record
(`docs/reference/evidence/lifecycle-contracts-2026-08-14/redrive3/contract-members.md` —
row A2 `task-id-not-wave-namespaced`, decision D2.1) — `gh` is unauthenticated in this
worktree, so the issue text itself was read from the landed contract evidence instead.

## What the contract requires (closed)

- D2.1: when a run is minted with a wave binding (`intent.waveId` present), the member runId
  digest folds in the wave instance. Two distinct logical waves (different `idempotencyKey`)
  with BYTE-IDENTICAL member objectives resolve to DISTINCT member tasks. Ordinary non-wave
  runs are byte-unchanged. The deliberate-exclusion comment (`application.mjs` normalizeIntent)
  is amended for wave-driven runs. Attach is unaffected (matches by objective TEXT + the
  steering-registered binding proof; it never recomputes a runId). The ritual re-drive path
  (`saltObjectives:false` re-attach via runId dedupe) keeps its semantics: same-key +
  same-objective derives the same (waveId, objective) pair → same runId.
- Anti-shallow (A2): a test that changes the runId by salting the objective is NOT green —
  the pin drives `saltObjectives:false` (raw byte-identical member objectives), so the
  DERIVATION itself must carry the namespace. A prior attempt at this row
  (git 9076cc10, `waveAttemptSalt` minted onto every member objective) is exactly that
  anti-shallow and was rejected; the re-drive exists because of it.

## Change (additive, one hunk + one comment amendment)

`impl/src/application.mjs` `BatonApplication.start()` — the member runId derivation:

```js
const runId = requestedIntent.runId ?? `run-${digest({
  objective: requestedIntent.objective,
  ...explicitResultIntentIdentity(requestedIntent),
  profileDigest: profile.digest,
  route: requestedIntent.route,
  composition: requestedIntent.composition,
  scope,
  ownerPrincipalId: owner.principalId,
  ...(requestedIntent.waveId ? { waveId: requestedIntent.waveId } : {}),
}).slice(0, 32)}`;
```

Plus the D2.1 amendment to the deliberate-exclusion comment in `normalizeIntent`
(waveRole/waveStart stay excluded; waveId is EXCEPTED for wave-driven runs).

- No new event kinds; no store schema changes; no surface changes.
- The member task id (`baton-<24hex>-<role>` dispatch taskId) derives from the member runId,
  so distinct runIds yield distinct task ids (the wave namespace flows through).
- `wave.mjs`/`workflow-interpreter.mjs` unchanged: the interpreter already mints the wave key
  (idempotencyKey → waveId) at admission; the derivation now consumes it.

## Red-first pin (new, never edited an existing suite)

`impl/test/wave-task-namespace-red.test.mjs` (deterministic; MockAdapter; no live providers):

1. **Distinct keys, byte-identical briefs** (the A2 pin): two waves, keys `wave-key-A`/`wave-key-B`,
   the SAME member object. The first member's spawn dies (`deadFirstAdapter`); the second drive
   must spawn FRESH — a fresh member task, a fresh run, `result_ready` over its own work product,
   exactly two tasks/runs/spawns total.
2. **Back-compat**: an ordinary non-wave `run.start` over the same objective resolves the same
   runId twice (byte-unchanged derivation); a wave-driven member run over the SAME objective is
   namespaced (distinct from the ordinary run); a same-key + same-objective re-drive over a live
   wave RE-ATTACHES the same member run — one task, one run, one spawn (ritual resume preserved).

RED at pre-change head (verified before the change):
- test 1 failed: `freshTasks.length` 0 !== 1 — the second drive re-bound the prior run, no fresh
  task, no spawn (the exact `baton-0b77f5031f85e9b33edbad4d-work` bind shape).
- test 2 failed: the wave member runId EQUALLED the ordinary run's runId
  (`run-a97d7b3f…` for both) — the digest excluded the wave namespace.

GREEN after the change (both tests pass; also via the official runner `node scripts/run-suite.mjs`,
which additionally runs the fixture-clock-lint and surface-conformance gates clean).

## Verification / batteries

- Pin suite: `node scripts/run-suite.mjs test/wave-task-namespace-red.test.mjs` → 2/2 pass.
- Wave-coupled batteries (vs pristine HEAD, via `git stash` comparison):
  - 9 wave suites (wave-attach, wave-driver, wave-driver-policy, wave-observability,
    waves-list-scaling, waves-run-detach, wave-grammar, wave-settle-error-surfacing, + pin):
    67 pass / 1 fail — the 1 failure is the pre-existing `A1-6 F7` red row
    (card dot-spelling derivation, web-northbound.mjs; fails identically at pristine HEAD).
  - 8 workflow/kg suites (workflow-dsl, workflow-surface, workflow-as-data, workflow-dsl-package,
    phase84-context-map-wave, kg-settlement, redrive-continuity, recipes): 152 pass / 35 fail —
    byte-identical result at pristine HEAD (all 35 are staged `(RED)` rows for other features).
  - 11 adjacent suites (frame-economics, harvest-accessor, cli-wave-fidelity, mcp-packaging,
    bidirectional-driver, blind-waits, kg-activation, kg12-decisions, doubt-review,
    worker-orchestrated-swarm, transport-liveness-235): failure SET byte-identical to pristine
    HEAD (77 names, timings stripped); the only pass/fail wobble across runs is the pre-existing
    flaky `MP15` npm-pack install smoke (environment/timeout-dependent, touches no wave code).
- Zero regressions: every suite's pass/fail set matches pristine HEAD except the intended
  red→green flip of the new pin.

## Judgment calls (recorded per the frame's law)

1. **Fix site is `application.mjs` start(), not wave.mjs.** The row anchors name wave.mjs /
   workflow-interpreter.mjs as where the issue manifests, but the contract (D2.1) pins the
   derivation at the member runId digest (`application.mjs` start()), and the anchors' salt
   reference (`saltObjectives`) is the driver policy that makes cross-wave sharing observable.
   The derivation, not the salt, carries the namespace.
2. **Same-key re-drive leg asserts store truth, not the member handle.** A same-key re-drive
   over a live, already-approved run re-attaches the SAME run; the re-attached member entry then
   fails at `run.approve` with `application_action_unavailable` (the run is past `approve_plan`).
   That refusal is pre-existing re-attach behavior (identical with or without the fold), so the
   pin asserts the idempotent dedupe the contract cares about: one task, one run, one spawn.
3. **`A1-6 F7` / `MP15` accepted as pre-existing.** Proven identical at pristine HEAD via
   `git stash` comparison; neither touches the runId derivation.

## Deliverables

- `impl/src/application.mjs` — runId digest folds `waveId` when present (+ comment amendment).
- `impl/test/wave-task-namespace-red.test.mjs` — red-first pin suite (new).
- `docs/reference/evidence/phantom-root-2026-08-15/wave-h/row-task-namespace-brief.md` — brief.
- This notes file.
