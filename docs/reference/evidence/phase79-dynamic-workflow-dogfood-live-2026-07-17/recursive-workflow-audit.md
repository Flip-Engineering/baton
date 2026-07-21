# Phase 80 recursive workflow audit (current snapshot)

## Verified current capability

Phase 79 implements one closed production strategy, `parallel_attempts`: 2–16 exact-routed roles,
`workspace: isolated`, `operator_selected`, immutable mechanically verified Candidates, typed feedback,
selection, member/Run stop, replay, adoption, and explicit apply. The accepted grammar is literal in
`impl/src/application.mjs:560-581`; Wave/result/stop evidence is in
`impl/test/phase79-workflow-composition-red.test.mjs:72-240,320-481`. The other spec strategies,
leased lineage, and composed overlays are proposals, not accepted by that normalizer.

Phase 80 implements exactly one bounded correction round. `revise_candidate` derives a closed
immutable envelope from the selected Candidate and recorded feedback, proposes one successor Plan,
requires distinct approval, and dispatches one fresh task based on the retained result ref.
Normalization/content addressing is in `impl/src/workflow-revision.mjs:82-181`; dedicated atomic
dispatch/task admission is in `impl/src/coordination-store.mjs:4691-4831`; retained-ref resolution
and private dispatch are in `impl/src/coordinator.mjs:2135-2161,2524-2556`. The application test
proves proposal-before-provider, restart while awaiting approval, one post-approval provider call,
and a distinct result (`impl/test/phase80-application-revision-red.test.mjs:75-162`). Store tests
prove exact atomic admission, early ref mismatch refusal, reconciliation, and ledger rehydration
(`impl/test/phase80-plan-revision-store.test.mjs:282-365`).

This is **not unbounded recursion or a bounded multi-round loop**. The application admits revision
only from the root Plan (`impl/src/application.mjs:4368-4371,4617-4620`), writes `round: 2`
(`:4389-4391`), requires history length 2 (`:4300-4308`), and budgets from one prior Plan with a
fixed two-round divisor (`:651-673`). The next production capability is a policy-bounded v3
transition plus recovery and exact cleanup under failure; later rounds remain append-only acyclic
Plan versions, never an agent-authored loop.

## Shared-writer safety

The supported path does not share a mutable checkout: Phase 79 rejects non-isolated workspace,
and revision dispatch resolves the exact retained ref before reserving/creating a new task worktree.
Keep that boundary. Unsafe shortcuts are `startMany()` on one checkout, resuming the predecessor
worker/worktree, allowing a critic to edit the Candidate tree, falling back to HEAD/a mutable role
branch, or treating Scratch/CAS as a writer lock. Same-UID workers can reach peer paths, so private
worktrees provide cooperative attribution/lifecycle—not hostile containment—as WF14 and the Phase
80 Security boundary state.

## Dependency-ordered red tests for the next vertical

1. First extend `impl/test/phase80-application-revision-red.test.mjs` with recovery failures for the
   existing v2 edge: restart after approval-before-dispatch, atomic task append, worktree creation,
   provider start, and result capture. Inject a lost response at each boundary; assert one durable
   task/provider generation, the same Plan/revision digest and route, no duplicate feedback, and the
   retained v1 Candidate/packet. This closes the gap left by the proposal-only restart at lines
   147-157 and exercises `_reconcileApprovedRuns()` (`impl/src/application.mjs:2140-2163`).
2. Add revision-specific selective-stop and whole-Run-stop tests while the v2 provider is live.
   Inject interrupt/kill timeout, worktree-remove failure, and restart between stop admission and
   completion; require a non-success stopping/attention state until reconciliation, then zero live
   workers/runtimes/capacity reservations/non-retained worktrees, while retained result refs and
   packets survive. The current line 162 merely stops fixture cleanup; Phase 79's successful stop
   tests at lines 320-364 and 409-481 do not prove revision descendants or failure recovery.
3. Only after 1–2, complete v2, select its verified Candidate, record feedback against it, and call
   `revise_candidate`; require v3/round 3, immediate predecessor v2, exact parent Candidate/ref/tree/
   artifacts and packet event sequence, zero provider calls before approval, and a distinct private
   worktree based on v2. Restart at v3 proposal, approval, dispatch, and result boundaries and assert
   byte-stable three-round evidence with at most one physical writer.
4. In `impl/test/phase80-plan-revision-store.test.mjs`, construct v3 from v2 authority and mutate one
   coordinate at a time: predecessor, parent Candidate/ref/tree/artifacts, packet/event sequence,
   revision digest, route, effort, or round. Each substitution must fail before capacity, ledger,
   worktree, or provider effects; exact replay must remain idempotent.
5. Add application eligibility cases for cumulative Plan-version/topology/provider/token/USD/wall/
   turn exhaustion, stopped Run, identical Candidate+packet, no verified delta, failed verification,
   and contradictory feedback. Status/actions, proposal, and recovery must agree on one typed
   non-success attention reason and must expose neither `completed` nor `revise_candidate`.
6. Last, add direct/CLI/authenticated Web/browser/MCP v3 schema/digest parity and a unified Baton Run
   dogfood with exact requested/resolved/provider-observed route and cleanup truth.

## Exact source changes after those reds

- In `impl/src/application.mjs`, replace `workflowRevisionBudget()` with a conservative cumulative
  calculator over the complete predecessor chain. Add one server-owned
  `workflowRevisionEligibility(current)` returning `{allowed, nextRound, history, reason}`; use it
  from `reviseWorkflowCandidate()`, `_validateWorkflowRevisionPlan()`, status/action rendering, and
  `_reconcileApprovedRuns()`. Derive `nextRound = history.length + 1`; never accept a caller round.
- Generalize `_validateWorkflowRevisionPlan()` to require an acyclic, monotonic full chain, validate
  the current envelope against `history.at(-2)`'s selected verified Candidate and feedback events,
  and verify every stored predecessor digest back to the root. Remove root-only/history-exactly-two
  predicates, but retain one node and one newly approved Plan per admitted round.
- Keep `impl/src/workflow-revision.mjs` the sole closed envelope normalizer. Add a policy/progress
  decision digest only if test 5 requires durable inputs; include it in `revisionDigest` rather than
  adding caller-controlled loop or workspace coordinates.
- In `impl/src/coordination-store.mjs`, make `previewPlanRevision()`/revision admission derive parent
  authority from the immediate predecessor Plan's verified selection, Candidate, artifacts, packet
  events, and retained ref. Preserve `createPlanGatedRevisionTask()` as the only atomic admission and
  keep generic spawn/review/resume paths closed.
- In `impl/src/coordinator.mjs`, reuse `spawnPlanRevision()` each round: resolve the exact retained
  ref, reserve that SHA, atomically append dispatch/task, create and postcheck a distinct task
  worktree, then launch. Extend recovery/Run-stop descendant enumeration and compensation only where
  tests 1–2 expose omissions; retries must reuse durable task/generation identity and cleanup must
  never delete retained result refs.

Acceptance is the v2 adverse-state matrix plus one policy-admitted v3 transition and typed refusal
states—not shared mutable worktrees and not a claim of unbounded recursion.
