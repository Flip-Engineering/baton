# Issue #257 — load-flaky rows made deterministic

Author: participant `determinism` (swarm `flaky-257`), 2026-09-14. Worktree
`ws-2c2f7348fe8f5a89dfaeedd6d55366b2` at base `53031f16`. Scope: the six test files named in the
brief, their fixtures, `impl/scripts/expected-red-tests.json`, and this audit. No `impl/src` change.

## Method

The flip condition is a **concurrent full-suite load**: `node impl/scripts/run-suite.mjs` running in
another shell while the same file runs (exactly the condition in the issue). Two suites supplied it
here (`/tmp/baton-load-suite-1.log`, `-2.log`, plus sibling participants' suites; the machine's load
average spent most of the session between 30 and 115). Every row below was re-run both ways:
alone (`cd impl && node scripts/run-suite.mjs test/<file>`) and under that load. The rule applied to
every row: **find the event that actually ends the wait and wait on it** (a durable settlement, a
named deadline detail, a worker/adaptor gate, a retained cleanup promise, an observed refusal
event) — never a wall-clock completion budget, never a bigger constant, never a blind retry.

## Row ledger

| file :: row | what it waited on (before) | what it waits on now |
|---|---|---|
| `phase56-drain-and-close.test.mjs :: DC1/DC5: max+1 refuses before fencing and an exact retry can still close` | the retry drain's 1 s deployment deadline racing real `git worktree` reap + historical reconcile (the drain named `historical_reconciliation_pending`; measured 830–1200 ms **per checkout remove**, >1 s per reconcile at load) | both tasks' **durable settlement** (`coordination.waitAfter` on the ledger's append notification) + a deterministic checkout reap (this row proves capacity-before-fencing and the retry close; DC2-DC7 proves the real reap). Retry closed in 44–123 ms across runs. |
| `... :: DC4/DC5: a hung cleanup is deadline-bounded, stays red, and retains writer authority` | `Date.now() - started < 500` — a stopwatch assertion racing event-loop stalls (the drain's own bound is 40 ms) | the drain's **named deadline**: `error.code === 'coordinator_drain_incomplete'`, `detail.reason === 'deadline'`, `detail.timeoutMs === 40`, and `detail.waitingOn` naming the hung worker. Stronger than the stopwatch: it proves the *policy* bounded the wait. |
| `... :: DC4: drain cannot attest while worktree creation or native spawn remains pending` | the 2 s drain deadline racing real `git worktree add` (~670 ms) + reap (~516 ms) after the gates release | the **gate release** ends the wait: the fixture checkout double materializes/reaps under the gates (legacy create+remove shape, so progress preservation is `unsupported` rather than a second real git effect). Same pending-boundary assertions. |
| `... :: DC4/DC5: a timed-out historical reconciliation remains owned and retries join it` | the retry's 40 ms driver deadline racing the gate release (reported as `driver close exceeded deployment deadline`) | the first attempt keeps a **shrink-to-40 ms** policy (the timeout is what it proves); the retry keeps the deployment policy and waits on the **retained reconcile promise identity** (`_drainHistoricalReconcilePromise` unchanged) plus the drain's engaged state — the gate decides when it converges. |
| `phase51-process-lifecycle.test.mjs :: PL7/PL9: one-shot turn completion does not surrender process-group authority over descendants` | one `adapter.kill()` and then `until(kill.confirmed, 15 s)`. macOS reports **EPERM** while a just-SIGKILLed group drains (`probeProcessGroup` returns `permission_denied` immediately), the latch publishes `lifecycle.process_reap_unconfirmed` and waits for a caller — nobody re-drove it (reproduced 2/10 kills) | the **observed refusal event**: one new bounded attempt per `lifecycle.process_reap_unconfirmed`, ending on `kill.confirmed` (`events.waitFor`). This is the PL7/PL9 latch contract the coordinator itself drives (`_retryProcessReap`), not a flake retry. |
| `... :: PL7/PL9: every native harness retains a natural-close terminal across an unconfirmed first reap > kimi` (and parent) | four `until(..., 3 s)` **event** polls (process start, provider readiness, first reap refusal, retry confirmation) | the events themselves via a promise-returning `events.waitFor` — no budget can expire before the event arrives. |
| `phase8-correctness.test.mjs :: C5 self-committed`, `C7 honest`, `C7 forged` (+ the two same-pattern rows C5 dirty-tree, C7 requireCoverage) | `waitUntil(async () => (await coordinator.result(id)).ready, 1500 ms)` — the whole worktree→adapter→verify→capture→transition pipeline racing 1.5 s | the **durable task settlement**: poll the real terminal projection, woke by `coordination.waitAfter(corpus append notification)` with a 250 ms re-check cadence; no failure budget exists. |
| `phase40-proposed-install-graph.test.mjs :: PG1/PG9: deployment npm supervisor uses fixed isolation and reconciles/reaps owned roots` | one 1 s resolver policy shared by the `slow-pkg` timeout proof **and** the success legs; under load the real child (`sandbox-exec`+node) exceeded 1 s and a success leg failed as `proposal_timeout`. Also a 2 s budget waiting for lease contenders' `ready` files | success legs run under a policy that covers real child startup (15 s); the **timeout proof keeps its own 1 s resolver** (`timeoutRoot`) where the 10 s-sleeping fixture proves `proposal_timeout` with a 10× margin. Contender readiness is now the contenders' own **ready-file/close event**, not a budget. |
| `phase11-concurrent-grok-reap.test.mjs :: CK9: two Grok ACP processes run concurrently, confirm kill, and are fully reaped` | a 1 s `stopDeadlineMs` racing the real stop+reap (measured 1.2–2.3 s at load; one run returned `forced` and left a process alive, another left the task `failed`), then a 5 s poll of OS pids + `git branch` | the deployment-default stop deadline (15 s) so the **transport confirmation cannot be preempted**, and the reap is asserted **directly** because `kill()` resolves only after the stop waiter's cleanup chain (preservation → runtime scope → worktree → branch) — the ack *is* the reap event. |
| `blind-waits-red.test.mjs :: A1-a / A1-b RED` | `timeoutMs: 30` stimulus; the row's claim is `waitCalls() === 0`. **Stale-pass mechanism found**: a loaded machine can spend >30 ms in the first `status()` projection, so the blind loop is never entered and `waitCalls() === 0` becomes true — a false pass, not a fixed feature | stimulus that cannot expire inside one projection (60 s) **and** a doubled `coordinator.wait` that terminalizes the run on the first blind cycle, so the call count is the loop entry the stage names. Rows stay expected-red (verified failing at `terminal-truth-predicate-missing` / `settle-block-durable-stop-missing`). |

### Rows fixed beyond the enumerated list

Same class, same files, observed during the load soaks (a file verdict is all-or-nothing, and every
one of these raced real reap work against a fixed drain budget):

- `phase56 :: DC5/DC6: <identity> retry preserves the durable kill disposition across a later
  timeout` (both cases) — observed once as `Expected values to be strictly equal` (the 100 ms
  attempt budget fired before the live stop landed). Deterministic checkout double; the durable
  disposition remains the proof.
- `phase56 :: DC2/DC4: drain policy-resolves pending interaction and publication authority and
  discards late asks` — observed once as a deployment-deadline failure. Same double; the
  interactions/publication resolutions remain the proof.
- `phase8 :: C5 dirty-tree` and `C7 requireCoverage` — same 1500 ms `waitUntil` as the named rows;
  converted with them.

## Manifest decision (`impl/scripts/expected-red-tests.json`)

**No change.** A1-a and A1-b are not green for a reason: the one stale pass was the load-induced
false pass described above (a slow first status projection, not the missing durable-stop predicate).
Both rows were hardened so the observation cannot invert, and both still fail at their named stages
(`0 stale expectation(s)` in every run). No other expected-red row was touched.

## Verdicts

Each file, alone and under a concurrent full-suite load (all `baton suite verdict: GREEN`, no
unexpected failures, no stale expectations, no hung file):

| file | alone | under load |
|---|---|---|
| phase11-concurrent-grok-reap | GREEN 1/1 | GREEN 1/1 (5× soak) |
| phase40-proposed-install-graph | GREEN 11/11 | GREEN 11/11 (3×) |
| blind-waits-red | GREEN 23 pass + 11 expected red | GREEN 23 + 11 expected red (3×) |
| phase8-correctness | GREEN 17/17 | GREEN 17/17 (2×) |
| phase51-process-lifecycle | GREEN 51 + 24 expected red | GREEN 51 + 24 expected red (4×) |
| phase56-drain-and-close | GREEN 38/38 | GREEN 38/38 (9× soak across the edits) |

## Environmental blocker on the full verdict (not this assignment)

`node impl/scripts/run-suite.mjs` (the deployment verification) is **RED by 22 unexpected failures
outside this assignment**, identically before and after these edits. Final clean run after every
edit landed: **4550 passed, 588 expected red, 22 unexpected failures, 0 stale expectations, 0 hung,
0 stalled lanes, exit 1** — the pristine-base run (before any edit) had the same 22, and none of
them is in the six files above. Every failure is in the phase78/79/80/83/84 + feedback-forge family
and reports `route_credentials_unprojected`: *"No provider credential is projected into the worker
runtime for this route."* (`application-deployment.mjs:1275` — `credentialProjectionResolves` finds
no env/file/tree projection for the route family).

They are deterministic, not load flakes: `test/phase78-concise-deployment-factory.test.mjs` alone at
load ~6 fails 4 rows (DF3, DF6, DF7, DF11). Cause is environmental to this deployment: the worker's
`HOME` is `/private/tmp/baton-master-deployment-20260914/runtime/w-4/home`, which holds `.codex/tmp`
only — no `.claude`, `.grok`, or `.kimi` credential trees, and no credential env, so every route
family that is not adapter-managed resolves to `blocked`. The same failure class is recorded for
this host in `docs/reference/evidence/selfdev-2026-09-12/*-suite-failures.jsonl`. Fixing it needs
credential provisioning or a replay of those rows in an environment that has it — both outside the
path scope of this assignment and outside this worktree's files.

## Honest notes on constants

Three fixture *policies* — not wait budgets — were changed, each with the specific proof keeping its
own tight value, because the constant had been made to serve two roles:

- `phase40` main resolver `timeoutMs` 1000 → 15000 (success legs only; `slow-pkg` keeps 1000).
- `phase11` CK9 `stopDeadlineMs` 1000 → 15000 (the deployment default; the row proves confirmation,
  not deadline enforcement).
- `blind-waits` A1-a/A1-b stimulus `timeoutMs` 30 → 60000 (makes the RED observation load-proof; the
  doubled wait makes the loop exit immediately on entry, so nothing waits 60 s).

No assertion was removed or weakened; two assertions were strengthened (the drain's named deadline;
the durable-disposition wait names its worker), and one new one was added (the `timeoutRoot` reap
check after a timeout).
