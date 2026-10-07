# Diagnostics epic contract v1 — adversarial red-team

**Verdict: UNSOUND**

Direction is right (projection-only diagnostics over authority the hub already mints; #28
deferral home; #53 whitelist discipline; no Vantage). v1 is not one implementable contract.
Two competent implementers can both claim compliance while shipping incompatible gate
diagnoses, incompatible progress taxonomies, and incompatible failure shapes — and several
rules contradict shipped machinery (`pathScopeEvidence` digests-only, `revise_candidate`
inputs, `context eval` CLI parse-refusal, #53 closed `failure` object). These are
divergent-behavior defects, not merely missing test detail.

---

## R-DG-1 — P0 — `offendingPaths` cannot be projected from existing authority

**Grounding:**

- Rule 1 (`diagnostics-decisions.md:48-53`): projection-only over records the hub already
  mints; no new event kinds except DIAG-4's capture artifact; whitelist-only.
- DIAG-2 (`diagnostics-decisions.md:61-65`) and red row DG-1b (`:93-96`): a scope-refusal
  carries `{gate:'scope', offendingPaths}` naming **exactly** the out-of-scope paths against
  Brief scope.
- Live mint (`coordinator.mjs:10860-10872`): on `worker_path_scope_violation`, durable
  `pathScopeEvidence` carries only counts + digests
  (`changedPathsDigest`, `inScopeChangedPathsDigest`, `outOfScopeChangedPathsDigest`) —
  never the path strings.
- Intentional omission is tested: `impl/test/phase73-required-effects.test.mjs:316-321`
  asserts `JSON.stringify(pathScopeEvidence)` does **not** include the out-of-scope path
  name (`outside-plan.txt`).
- Error event payload (`coordinator.mjs:11135-11146`) re-emits that same digest-only
  evidence. Verify worktrees are cleaned in the trust-gate `finally`
  (`coordinator.mjs:11170+`), so post-hoc re-diff is not durable authority either.
- Shipped `run.debug` member projection (`application.mjs:10524-10550`) reads worker stream
  kinds `content.message`, `scratchpad.write_result`, `authority.rejected`,
  `lifecycle.crashed` only — it never projects `error` / trust-gate payloads at all today.

**Failure:**

DIAG-2's centerpiece ("which paths violated scope") is not present in durable authority.
Rule 1 forbids inventing it. One implementer will (a) project digests and call that
`offendingPaths` (fails DG-1b literal), (b) re-extend the trust-gate error payload with
path arrays (violates projection-only / reopens the deliberate digests-only design), or
(c) re-capture from a live worktree that no longer exists after cleanup. All three can
claim the contract; none is uniquely licensed. DG-1b ships green only if the fixture
injects path strings the production gate never mints.

**Minimal repair:**

Either (preferred for v1): change DIAG-2 to
`{gate:'scope', outOfScopeChangedPathCount, outOfScopeChangedPathsDigest, …}` projected
from the existing `pathScopeEvidence` whitelist, and rewrite DG-1b accordingly; **or**
open an explicit authority amendment (new whitelist fields on the trust-gate `error`
payload + red rows that path names are bounded/sanitized) and drop the "projection-only /
no new kinds except DIAG-4" claim for that field. Do not leave both rules standing.

---

## R-DG-2 — P0 — DIAG-1 state machine is not a function of named signals

**Grounding:**

- DIAG-1 (`diagnostics-decisions.md:54-60`): member state ∈
  `progressing|parked|parked_done|stalled|claimable|crashed` derived from "checkpoint
  cadence, `changedPathsDigest` change across polls, scratchpad/write receipts, and the
  bidirectional claim-bit." Basis always carried.
- No thresholds, windows, or priority order are pinned. Wave-driver liveness today is a
  **wave-level** cursor-stripped status digest + per-member unproductive-nudge budget
  (`wave-driver.mjs:11-19,124-128,223-227,316-342`; defaults
  `stallTimeoutMs: 20*60_000`, `unproductiveNudgeBudget: 1` at `:35-39`) — not a published
  per-member progress classifier on `run.debug` / `wave.progress()`.
- `wave.progress()` member rows today (`wave.mjs:300-318`) are
  `{role, phase, terminal, attention, scratchpad, elapsedMs}` — no `state`/`basis`.
- Bidirectional v2 claim (`bidirectional-decisions.md:19-28`): every live
  `turn_checkpoint` is a completed-result claim candidate; `claim: {status:'completed',
  summary}` when durable `origin` is present; "parked-working" does **not** exist.
  `claimTurn` re-runs the live trust gate (claim is gate input, never proof).
- DIAG-1 invents **two** claim-bit states (`parked_done` and `claimable`) without defining
  the discriminating predicate. Red row DG-2 (`diagnostics-decisions.md:97-99`) only says
  both read from a completed-claim fixture and both fall back to `parked` without it.

**Failure:**

Two implementers can both claim compliance while disagreeing on every boundary:

| Ambiguity | Implementer A | Implementer B |
|---|---|---|
| `stalled` vs `parked` | unchanged digest after 1 nudge | unchanged digest after `stallTimeoutMs` wall time |
| `progressing` | any `changedPathsDigest` delta | message activity without path delta |
| `parked_done` vs `claimable` | claim present ⇒ `claimable` | claim present ⇒ `parked_done`; `claimable` only after operator marks |
| crash vs stalled | `lifecycle.crashed` only | also trust-gate kill / process_closed |
| where classified | only inside wave-driver policy | pure `run.debug` projection over stream |

Nothing in the contract forces one table. DG-2 can go green on scripted fixtures while
production classifiers fork across orchestrators — the exact failure ground-truth #1
names.

**Minimal repair:**

Publish a closed decision table: ordered predicates over **named, durable fields** (e.g.
attention `turn_checkpoint` presence, `claim` presence/absence per bidirectional v2,
last `changedPathsDigest` in the checkpoint, `lifecycle.crashed` / policy terminal cause)
with explicit "else" fallthrough. Collapse `parked_done`/`claimable` to one claim-bearing
state (bidirectional honest taxonomy) or pin the single bit that distinguishes them (e.g.
`claimable` = claim present and claim_turn not yet attempted this pause;
`parked_done` deleted). State whether classification reuses wave-driver policy constants or
is independent. Red rows for: claim present, claim absent/pre-v2, digest-unchanged after N,
crash, working-no-checkpoint, trust-gate kill.

---

## R-DG-3 — P1 — DIAG-2 gate enum does not match the live trust-gate code set

**Grounding:**

- DIAG-2 closed enum (`diagnostics-decisions.md:62-64`):
  `red-green|coverage|scope|route_mismatch|forbidden_effect`.
- Live trust-gate throw codes (`coordinator.mjs:10853-10894`, catch path
  `:11128-11165`): at least
  `forbidden_effect_observed`, `worker_path_scope_violation`, `required_effect_absent`,
  `verification_environment_mismatch`, plus generic `trust_gate_failed`.
- Closed verifier diagnostic codes already projected
  (`application.mjs:84-88` / `VERIFIER_DIAGNOSTIC_CODES`):
  `verification_red_green_failed`, `verification_coverage_failed`,
  `verification_claim_diverged`, `verification_mutation_failed`,
  `verification_exit_mismatch`, timeouts/spawn failures, etc.
- Route mismatches live on dispatch/recovery paths
  (`coordinator.mjs:3822 plan_route_mismatch`, `:4978-4979 recovery_route_mismatch`) —
  not as a trust-gate `trustPhase` sibling of scope/forbidden_effect.
- Red row DG-1b only covers `scope` and `red-green`.

**Failure:**

The mapping from live codes → DIAG-2 enum is unspecified and incomplete.
`required_effect_absent` and environment/mutation/timeout classes have no bucket;
`route_mismatch` is not a trust-gate peer of the others; `scope`/`forbidden_effect` rename
live `worker_path_scope_violation`/`forbidden_effect_observed` without a normative
translation table. Implementer A projects live codes verbatim; implementer B invents a
lossy collapse; both pass DG-1b. Workers and orchestrators cannot key automation on `gate`.

**Minimal repair:**

Either project the **live** closed code set (trust-gate `code` +
`verdict.diagnosticCode` + `trustPhase`) with no renaming, **or** publish an exhaustive
translation table from every live code to the DIAG-2 enum (including an `other`/`unknown`
bucket) and red-row each live code. Add rows for `required_effect_absent`, coverage,
environment mismatch, and a non-trust-gate route mismatch (or drop `route_mismatch` from
v1).

---

## R-DG-4 — P1 — DIAG-2/3 extend `run.debug` past the #53 closed failure/receipt shapes

**Grounding:**

- Issue #53 v2 rule 1–3 (`issue53-decisions.md:19-47`): exactly three questions; failure
  shape is `{kind, code, message}|null` from `lifecycle.crashed` or policy terminal;
  receipts are exactly `{kind, result, code, at}`; read source is per-worker stream;
  whitelist not blacklist; O(stream) output-bounded.
- Shipped implementation (`application.mjs:10503-10550`, `_debugReceipt` `:10556-10564`):
  failure = last `lifecycle.crashed` only; writeReceipts filter
  `scratchpad.write_result|authority.rejected` only. Trust-gate `error` events
  (`coordinator.mjs:11131-11146`, `kind:'error', phase:'trust_gate'`) and
  `wire.frame_degraded` (`claude-session.mjs:768-772`) are **not** projected.
- Control-surface v2 CS-3 (`control-surface-decisions.md:32-33,96-97`): this epic may
  extend **payload**, never registration — but payload still inherits #53's closed member
  object unless schemaVersion/discipline is restated.
- DIAG-2 puts `{gate, offendingPaths?, tail?}` on the "failure leg"; DIAG-3 puts
  degradation summaries on "failure/writeReceipts legs" as counts + last-code
  (`diagnostics-decisions.md:61-68`).
- Seed discipline cite `issue53-decisions.md:44-46` is the O(stream) read-source paragraph
  — it does **not** authorize open-ended field growth.

**Failure:**

Two compliant extensions diverge:

1. Replace `failure` with the DIAG-2 object (breaks every #53 consumer and R53 shape
   tests).
2. Nest gate diagnosis under `message` as prose (violates "prose-free enums" / structured
   cause).
3. Add parallel fields (`gateDiagnosis`, `degradations`) without bumping
   `schemaVersion` or updating #53.
4. Stuff `wire.frame_degraded` into `writeReceipts` with a non-`{kind,result,code,at}`
   shape, or with unbounded history (violates counts+last-code **and** O(stream) if every
   frame is listed).

DG-1a/DG-1b can pass while production clients cannot parse `run.debug` stably. The epic
claims to "extend PAYLOAD, never registration" without pinning the new member schema.

**Minimal repair:**

Publish the full post-epic member object as a closed schema (field set, types, bounds,
schemaVersion bump if any field is added or `failure` is widened). Prefer additive
optional fields (`failure` remains #53-shaped; `gateRefusal` and `degradation` are sibling
whitelists). Pin: max one gate refusal (last), degradation = `{count, lastCode,
lastAt}` only, source event kinds, and that raw frames never appear. Update
`issue53-run-debug-red.test.mjs` compatibility expectations in the same red suite.

---

## R-DG-5 — P1 — DIAG-5's `context.eval` CLI path contradicts control-surface and live CLI

**Grounding:**

- DIAG-5 (`diagnostics-decisions.md:74-78`) and DG-4 red row (`:102-104`): fleet diagnostic
  programs invocable through the existing **`context.eval` CLI verb** and MCP tool;
  results citable as `cell:` bindings.
- Live CLI (`application-cli.mjs:1288-1294`): `baton context eval` **throws at parse** with
  `cli_command_host_local` — corrective names embedded `BatonRun.context().evaluate(...)`
  or MCP `baton_context_eval`.
- Control-surface v2 rule 2 (`control-surface-decisions.md:88-93`): `context eval` is
  required to be either that parse-time refusal **or** a host-local dispatch if one is
  already wired — pinned either way by test. Landed choice is the refusal.
- `application.contextEval` (`application.mjs:8871+`, comment block `:8831-8869`) is a
  deliberate non-`APPLICATION_COMMAND_DEFINITIONS` direct port; Web/MCP/generic
  `application.command('application.context_eval', …)` remain documented gaps in that
  same comment. Ground-truth cite `application.mjs:8821` is mid-workflow `context_eval`
  action plumbing, **not** the `contextEval` method (method starts `:8871`).

**Failure:**

DIAG-5 asserts a CLI verb the control-surface epic just locked as non-dispatching and the
live CLI refuses. Implementer A "fixes" CLI to dispatch (forks control-surface CS-2);
implementer B only wires MCP/embedded (fails DIAG-5's literal CLI claim); implementer C
shells out to a new fake verb. DG-4 can still go green on an in-process `contextEval`
call while operators cannot run the documented CLI.

**Minimal repair:**

Drop "CLI verb" from DIAG-5 v1; pin invocable surfaces to the ones that actually exist
(embedded `application.contextEval` / MCP `baton_context_eval` if advertised) and align
with control-surface's parse-refusal. If CLI dispatch is required, it is a
**control-surface** amendment with its own red rows — not a silent assumption here. Fix
the `application.mjs:8821` citation to `:8871` (method) / `:8831-8869` (port rationale).

---

## R-DG-6 — P1 — "Revision channel to the worker" is not a specified seam

**Grounding:**

- DIAG-2 (`diagnostics-decisions.md:61-65`): structured cause rides `run.debug` **AND the
  revision channel to the worker**.
- Rule 1 (`:51-52`): "no worker-visible new channel."
- Live revise path: CLI `baton run revise RUN --reason REASON` → semantic action
  `revise_candidate` with inputs `{reason}` only
  (`application-cli.mjs:1559-1563`; `application-semantics.mjs:574-589,844-845`).
  `send_feedback` is free-text `{role, feedback}` (`:1551-1556`).
- Neither action accepts `{gate, offendingPaths, tail}`. Gate kills today set
  `handle.terminalCause` and stop the worker (`coordinator.mjs:11165-11178`) — they do not
  auto-enqueue a structured revision turn.

**Failure:**

"Revision channel" can mean: (a) operator free-text `reason` that happens to include a
diagnosis, (b) auto-injected structured fields on `revise_candidate`, (c)
`send_feedback` prose, (d) a new grammar line (forbidden). Two implementers pick different
channels; workers cannot rely on structured fields. Auto-injection also collides with
non-goals ("diagnosis, never adjudication" — `:118-119`) if it changes when/whether a
revision turn is admitted.

**Minimal repair:**

For v1, **cut worker-facing structured delivery** from DIAG-2; keep operator-visible
diagnosis on `run.debug` (and optional capture digest). If worker delivery is required,
pin one existing action, its exact input schema extension, who triggers it (operator vs
auto-on-refusal), authorization, and a red row that secrets/sandbox roots never reach the
worker brief. Do not call free-text `--reason` "structured."

---

## R-DG-7 — P1 — DIAG-5 fleet roll-ups over a "run set" are outside `contextEval` authority

**Grounding:**

- Ground truth #5 / DIAG-5 (`diagnostics-decisions.md:32-35,74-78`): stalled-member
  roll-up, refusal-kind histogram, degradation count over run authority; computed by
  deployment-pinned pure `context_eval` programs; DG-4 scripts a "run set."
- `contextEval` authority model (`application.mjs:8831-8869,8871+`): evaluates a pure
  program against an **existing durably-admitted ContextManifest session** (run- or
  manifest-addressed). It does not admit new manifests, does not open fleet-global
  sessions, and refuses plain runs with no prior Workflow/context admission path.
- Context programs are pure over the session's declared sources — not an arbitrary
  multi-run coordination scan unless those sources already expose the needed projections.

**Failure:**

"Fleet-level" and "scripted run set" imply cross-run aggregation. `contextEval` is
per-admitted-session. Implementer A writes a host script that calls `run.debug` N times
and folds in process (not a `context_eval` program); implementer B tries to stuff
multi-run reads into a pure program and hits missing sources; implementer C invents a new
fleet command family (forbidden by DIAG-5). DG-4 can pass on a single-run fixture while
the ground-truth fleet question stays unanswered.

**Minimal repair:**

Narrow DIAG-5 v1 to **single-run** (or single-wave) diagnostic programs over sources the
context manifest already admits, **or** name the concrete source ops/bindings that expose
per-member progress/refusal/degradation projections and red-row a multi-member single-run
histogram only. Defer true cross-run fleet roll-up until a fleet read model exists.
Retitle "wave-health" honestly if it is wave-scoped.

---

## R-DG-8 — P1 — Red rows can ship green while the live diagnostic path stays broken

**Grounding (gaps vs live machinery):**

| What can go green | What stays broken in production |
|---|---|
| DG-1b `gate:'scope'` + `offendingPaths` (R-DG-1) | Durable evidence is digests-only; path names never leave the gate |
| DG-1a stream death as whitelisted summary | `run.debug` failure only reads `lifecycle.crashed`; trust-gate `error` / process_closed / #49–#50 classes unmapped |
| DG-1b sanitized tail | Live `_debugMember` never attaches verifier tails; tails live on verdict `failureCapsule` (`referee.mjs:390-395`, projected via `_closedVerdictProjection` `application.mjs:9705-9731`) — a different surface |
| DG-3 capture digest on `run.evidence`/`run.debug` | No rule pins reuse vs fork of existing `failureCapsule` / `verify.reverified` payload |
| DG-4 via `context.eval` | CLI refused (R-DG-5); fleet authority missing (R-DG-7) |
| DG-2 claim states | Bidirectional claim-bit may not be landed; partial taxonomy fork (R-DG-2, R-DG-9) |

**Failure:**

The red suite can certify the epic while operators still cannot answer ground-truth
questions #1–#4 on a live gated worker. Fixtures that mint path arrays or pre-shaped
failure objects do not constrain production projections.

**Minimal repair:**

Add red rows that inject **only** events/payloads the live coordinator mints (digest-only
`pathScopeEvidence`, `kind:'error'` trust-gate, `wire.frame_degraded`,
`verify.reverified` with `failureCapsule`, `lifecycle.crashed`). Assert projections from
those shapes. Negative rows: no sandbox root, no secret, no raw frame, no unbounded
receipt list. Require `issue53-run-debug-red.test.mjs` to remain green on the closed
base shape (additive fields only).

---

## R-DG-9 — P2 — Rung decomposition leaves a DIAG-1 fork between DG-1 and DG-2

**Grounding:**

- Rungs (`diagnostics-decisions.md:80-87`): DG-1 = DIAG-3 + DIAG-2 (independent of
  bidirectional); DG-2 = DIAG-1 after claim-bit, with note that
  `parked|stalled|progressing|crashed` **may land earlier**.
- DG-2 red row tests claim states; DG-1 red rows do not test progress classification.
- Bidirectional is **v2** (`bidirectional-decisions.md:1-4`); diagnostics seed still says
  "bidirectional v1" (`diagnostics-decisions.md:9-10`).

**Failure:**

Implementer A ships partial DIAG-1 inside DG-1 (progress states without claim); implementer
B ships zero progress classification until DG-2. Both match the rung prose. Consumers
cannot know whether `run.debug` members have `state` after DG-1. Sibling version mislabel
invites reading the pre-fold bidirectional contract.

**Minimal repair:**

Pin DG-1 as **excluding** all DIAG-1 fields, **or** make partial DIAG-1 a named DG-1
deliverable with its own red rows and a frozen four-state enum. Label the sibling
**bidirectional v2**. State that claim states are additive optional fields only after
bidirectional rule 1 lands.

---

## R-DG-10 — P2 — DIAG-4 under-specifies capture vs existing `failureCapsule`

**Grounding:**

- DIAG-4 (`diagnostics-decisions.md:69-73`): on trust-gate rejection, pin hub I7 re-run
  output as content-addressed artifact citable from `run.evidence` and `run.debug`;
  verification-failure captures only; not Vantage.
- Shipped: referee already builds `verifierFailureCapsule` (8 KiB, secret patterns,
  sandbox-root strip — `verifier-diagnostics.mjs:3-64`, used at `referee.mjs:390-395`);
  application closed projection normalizes it onto the verdict
  (`application.mjs:9705-9731`). `run.evidence` is a separate command
  (`application.mjs:4428+`, registry `:165`).
- "Scorecard pattern" is invoked without a file:line for the pin/store API this epic must
  call.
- I7 is the hub re-execution doctrine (e.g. `docs/10-interaction-model.md:61`); the
  "re-run" is the trust-gate's own `_referee` call inside `_runTrustGate`
  (`coordinator.mjs:10818+`), not a second spontaneous capture job.

**Failure:**

Implementer A cites existing `failureCapsule` digests from the verdict projection and
calls DIAG-4 done; implementer B adds a parallel content-addressed blob store; implementer
C only links `run.debug` to `verify.reverified` event payloads. Citation surfaces
(`run.evidence` vs verdict vs debug) diverge. Risk of double-storing the same tail under
two digests.

**Minimal repair:**

Normative v1: DIAG-4 **is** the existing capsule pipeline — project
`failureCapsule.textDigest` (and bounds/redacted flags) from the closed verdict into
`run.debug` / `run.evidence` citation fields; no second store. If a separate artifact
registry entry is required, name the exact admit API, digest formula, retention, and
dedup-against-capsule rule. Red row: capsule present on `candidate_failed`, absent on
pass, byte-bounded, secret-redacted.

---

## R-DG-11 — P2 — Overreach: pack DG-4 (fleet programs) and worker revision into later rungs

**Grounding:**

- Non-goals already cut Vantage / new worker channels / trust-gate verdict changes
  (`diagnostics-decisions.md:116-120`).
- Still in v1: DIAG-5 fleet programs (R-DG-5, R-DG-7), DIAG-2 worker revision delivery
  (R-DG-6), DIAG-1 six-state classifier (R-DG-2), path-naming diagnosis (R-DG-1).
- Highest-value, lowest-ambiguity slice is already named by the #28 deferral + issue #30
  receipt class: degradation visibility + operator-visible gate cause from **existing**
  digests/codes/capsules (DG-1 as DIAG-3 + a digest-honest DIAG-2).

**Failure:**

v1 tries to answer all five ground-truth questions in one contract and inherits every
unresolved authority gap. That invites partial green implementations that do not close
the campaign loops.

**Minimal repair:**

Cut or explicitly defer from v1: worker-facing structured revision, fleet multi-run
`context_eval` programs, and exact `offendingPaths` path lists. Land DG-1 as
degradation summaries + live-code gate diagnosis + capsule digest citation only. Move
DIAG-1 progress classification behind bidirectional v2 + a pinned decision table. Move
DIAG-5 behind a single-run (or single-wave) pure-program design with real sources.

---

## Surviving sections

These can stand after folds (with the repairs above applied in-place):

| Section | Status |
|---|---|
| Seed intent (operator diagnostic surface; parents #51/#30/#28; no Vantage) | **Survives** — fix sibling label to bidirectional **v2**; fix `contextEval` line cite |
| Ground truth #1–#4 (done-vs-stuck, gate cause, wire degrade, evaporating evidence) | **Survives** as problem statement |
| Ground truth #5 (fleet roll-ups) | **Survives as aspiration** — not a v1 hard requirement until R-DG-7 is fixed |
| The question (projections vs JSONL archaeology) | **Survives** |
| Rule 1 projection-only / whitelist / `verifier-diagnostics` sanitization | **Survives** — enforce against DIAG-2 path lists; cite `verifier-diagnostics.mjs:3` (8 KiB), `:5-12` (secrets), `:26-64` (sanitize+paths) |
| DIAG-3 degradation visibility (#28 deferral landed) | **Survives** with R-DG-4 schema pin |
| DIAG-2 operator-visible gate cause (digest-honest) | **Survives after R-DG-1/R-DG-3** — not path-naming, not worker revision |
| DIAG-4 as capsule citation (not new Vantage) | **Survives after R-DG-10** reuse pin |
| DIAG-1 progress classification | **Does not survive as written** — needs R-DG-2 table; park behind bidirectional v2 |
| DIAG-5 fleet `context_eval` programs | **Does not survive as written** — needs R-DG-5/R-DG-7 narrow or defer |
| Rungs DG-1…DG-4 | **Survives only if** DIAG-1 partial landing and DIAG-5 scope are pinned (R-DG-9/R-DG-11) |
| Red-first tests file path + deterministic/MockAdapter | **Survives** — contents need R-DG-8 rewrite |
| Verification commands | **Survive** |
| Explicit non-goals | **Survive** — strengthen with worker structured-revision cut and path-list cut if chosen |

---

## Citation verification log (live, 2026-07-31)

| Contract cite | Live check |
|---|---|
| `application.mjs:10433-10503` (brief: run.debug) | `async debug` at **10503**; `_debugMember` at **10524** — brief range is the preamble through method entry |
| `application.mjs:8821` (contextEval) | **Wrong**; method at **8871**, port comment **8831–8869** |
| `verifier-diagnostics.mjs:5-39` / `:26` / `:33-39` / 8 KiB | Secrets **5–12**; `sanitizeVerifierDiagnosticText` **26+**; sandbox roots **33–40**; 8 KiB constant **line 3** |
| `wave-driver.mjs:15-19` (liveness) | **Holds** (L5/L6 commentary + unproductive budget / `changedPathsDigest`) |
| `issue28-decisions.md:50-52` (deferral) | **Holds** — `wire.frame_degraded` operational-log home; timeline/`run.debug` projection deferred to #53 |
| `issue53-decisions.md:19-46` (debug contract + bounds) | **Holds** for closed three-question shape and O(stream) read source |
| `coordinator.mjs:10818+` (trust gate) | **`_runTrustGate` at 10818**; pathScopeEvidence digests-only **10865–10872** |
| `application-cli.mjs:1577-1590` (revise/feedback) | Feedback/revise actually **1551–1563**; nearby range is stop-member/retry — brief lines drifted |
| `reviews/baton-24h-report.html:182` (repl1 scope) | **Holds** — scope violation row; trust-gate evidence named the file |
| `docs/capabilities/debug-interp.md:17,25,53-108` | **Holds** — symptom/no-cause; I7 should record for free; Vantage program non-goal |
| control-surface v2 owns `run.debug` registration | **Holds** (CS-3 direct port `application.mjs:11152–11155`) |
| bidirectional claim-bit | **v2**, not v1 as seed claims |

---

*Red-team method: every finding grounded in bounded `grep`/`sed` of live sources; large
NUL-bearing files never read whole. No production code modified.*
