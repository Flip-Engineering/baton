# Bend2 law application plan, 2026-09-25

The obligations of law revisions 11 and 12 are encoded as checked models on `bend2-rewrite` at
`c238cece`. This record names the lanes that apply those obligations to `impl/` on `master` and the
runtime site each lane owns. A slice lands when its own real run works: the lane's changed-path run,
and `swarm integrate`'s comparison of the change's failures against the target's.

## Route

Work lands on `master` from the tip `67b16568`. Each lane cuts its branch from `origin/master`
after a fetch, commits in its own worktree, publishes the standard contribution contract, and the
orchestrator lands the accepted contribution with `swarm integrate` naming `master` as the target.

A lane verifies its own change with `node impl/scripts/run-suite.mjs --changed <its changed
paths>`. The canonical suite is red on `master` because red-first suites remain in the tree, and
`swarm integrate` compares the change's failures against the target's, so a lane reads the
selected failures rather than a suite total.

A lane edits only the files it owns. A file another lane owns is out of scope even when the change
looks small.

## Open obligations and their application sites

| Obligation | What the law requires of the runtime | Application site | Lane |
|---|---|---|---|
| Revision 11, [laws-no-ledger.bend](examples/laws-no-ledger.bend) | A gate decides from observed runs: failure identity defined by file, test where available, failure kind and a stable semantic code; an unjudged target supplies no matching failure and is reported as unjudged; an unjudged change cannot authorize a landing; every selected invocation is accounted for; the judged verdict is the run the gate started | `defaultIntegrationGates` and `runGateFiles` in `impl/src/swarm-runtime.mjs`; `failureIdentity`, `rowKey`, `FILE_LEVEL_FAILURE_TYPES`, `computeVerdict` and `verdictDocument` in `impl/scripts/suite-verdict.mjs`; `selectAffectedTests` and `selectFromRepository` in `impl/src/verification-selection.mjs` | A |
| G1, [laws-annotation-independence.bend](examples/laws-annotation-independence.bend) | Changing administrative annotations about work cannot change selected checks, derived decision inputs, admission, refusal, management permissions, required prerequisites or continuation transitions for the same validated request, authority, observed resources and events | The decision sites that take a record argument, established by the lane's own scan before it edits | B |
| G2, [laws-prerequisite-enabling.bend](examples/laws-prerequisite-enabling.bend) | No administrative declaration is a prerequisite for admission or continued execution; a blocked continuation names the actual missing resource, authority, semantic input or explicit decision; each prerequisite names its enabling effect; the runtime wakes the responsible party | `resumeDecisionPending` and `SWARM_RESUME_CONTINUATION_MODES` in `impl/src/swarm-state.mjs`; the `resume_decision_required` attention rows and the seat resume request path in `impl/src/swarm-runtime.mjs` | B |
| 12c, [laws-orchestrator-authority.bend](examples/laws-orchestrator-authority.bend) | The delegation scope derives from authenticated current authority and is enforced at dispatch and at effect; a stale grant confers no authority; the caller cannot supply the relation; no second permission follows a lawful grant; a seat stops itself | The permission and action-target machinery in `impl/src/swarm-runtime.mjs`, `impl/src/swarm-contract.mjs` and `impl/src/swarm-refusals.mjs` | C |
| 12a, [laws-no-ceiling.bend](examples/laws-no-ceiling.bend) | Admission derives from measured resources; terminal transitions bind to actual events; an attempt is modelled apart from the durable work request; disposition survives ticks and attempt timeouts | The capacity and admission derivation, and the coordination work rows | D, queued |
| 12b, [laws-derived-catalog.bend](examples/laws-derived-catalog.bend) | The served route set equals the observed harness and credential catalog after the operator's policy; failed discovery is reported | `DEFAULT_ROUTES`, `normalizeRoutes` and `routeReadinessContract` in `impl/src/application-deployment.mjs` | D, queued |

## Lane A: the landing gate (revision 11)

Seat `bend2-appgate19`. Owns `impl/src/swarm-runtime.mjs` (the landing-gate functions),
`impl/scripts/suite-verdict.mjs`, `impl/src/verification-selection.mjs`, and its own test file
under `impl/test/`.

Each of these holds in the runtime with a test that fails without the change:

1. Failure identity is the file, the test name where available, the failure kind and a stable
   semantic code. A change failure whose kind differs from the target failure of the same file and
   test does not match it.
2. An unjudged target is reported as unjudged and supplies no matching failure, so every change
   failure blocks.
3. An unjudged change cannot authorize a landing.
4. Every selected file is accounted for. A selected file with no reported row is named and blocks,
   and is never dropped from the comparison.
5. The selection the gate judges is the change's selected set, the one the gate derived from the
   changed paths it was given.
6. The judged verdict is the run the gate started. A caller-supplied, stale or foreign verdict
   document cannot authorize a landing.

## Lane B: record independence and prerequisite enabling (G1, G2)

Seat `bend2-appindep19`. Owns the decision and continuation sites it names in its first report,
which cover `impl/src/swarm-runtime.mjs`, `impl/src/swarm-state.mjs`,
`impl/src/verification-selection.mjs`, `impl/src/host-capacity.mjs` and `impl/src/goal-plan.mjs`,
plus its own test file under `impl/test/`.

For every decision in G1's list, a test changes an administrative annotation about the work — a
status declaration, a census, an expected-failure allowance, a convergence declaration — and shows
the decision unchanged. For G2, a test shows that a blocked continuation names the actual missing
resource, authority, semantic input or explicit decision, that no administrative declaration
satisfies a prerequisite, and that the runtime wakes the party the prerequisite names.

## Lane C: orchestrator authority (revision 12c)

Seat `bend2-appauth19`. Owns the swarm authority machinery in `impl/src/swarm-runtime.mjs`,
`impl/src/swarm-contract.mjs` and `impl/src/swarm-refusals.mjs`, plus its own test file under
`impl/test/`.

A test each for: the delegation scope derives from authenticated current authority and the caller
cannot supply the relation; a stale grant confers no authority; the effect rechecks the current
authority; one lawful grant confers no second permission; a current delegation holds every
management act over its scope, taking recruit, guide, stop, review, integrate and resume as the
set; a seat stops itself. The lane reports which of the management-action universe and the
prospective-recruit scope it could derive from the runtime and which it left open.

## Queued

Lane D applies revisions 12a and 12b after lanes A, B and C land.

## Boundaries

`#592`: the attention and wake code is wake-astra592b's. Lane B's G2 wake rule touches attention
rows, and lane D's 12a transitions touch the same area. Until wake-astra592b answers the boundary
question, no lane edits `impl/src/wake-stream.mjs` and no lane adds an attention row kind.
