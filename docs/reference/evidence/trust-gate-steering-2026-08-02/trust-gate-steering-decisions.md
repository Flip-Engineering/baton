# Trust-gate steering epic contract (v1.0, post-red-team fold)

(Red-teamed by two adversarial reviewers against the codebase: `redteam-semantics.md`
(5 CONFIRMED-HOLEs, 3 NEEDS-AMENDMENT) and `redteam-authority.md` (3 CONFIRMED-HOLEs, 5
NEEDS-AMENDMENT, 1 DEFENDED). v0.9's TG1/TG2/TG3 naive shapes did not survive contact with
the machinery — this v1.0 is a redesign, not an edit. The v0.9 seed is preserved at the end
for traceability.)

## What the red teams proved (and the redesign each forces)

1. **The gate has TWO progress judgments, not one** (semantics A1): `required_effect`
   (:11160-11175) and the referee/accept phase (:11234-11247) both judge progress, and
   skipping `required_effect` alone yields ACCEPTANCE of an edit-free turn on a green base.
   → The fold splits phases into **violation verdicts** (forbidden_effect, path_scope —
   immediate terminal failure is always correct) and **progress verdicts** (required_effect
   + referee/coverage — deferred at checkpoints, full strength at finals), and the deferral
   is **non-dispatch**, never a gate run with phases skipped.
2. **No finality marker exists for un-driven runs** (semantics A2; all four production
   adapters are pausable). → The taxonomy: a `turn_completed` that mints a pending pause
   record is a CHECKPOINT (defer); one that doesn't is a FINAL (evaluate, today exactly).
   Drivers' `claim_turn` remains the drivered final. TG3's exhausted steering window is the
   new un-driven final trigger.
3. **Every gate path ends terminal — there is no third outcome** (semantics A9). →
   Deferral is non-dispatch: the task stays `paused`/`working`, no gate event, no verdict.
   No new task state is minted.
4. **nudge_turn cannot deliver at the auto_no_driver verdict point** (semantics A6: the
   pause record is resolved BEFORE the gate runs) and is pause-keyed with no mid-turn lane
   (authority 6c: claimTurn bypasses any cycle). → The steering cycle moves to the
   pause-admission seam (`_admitPauseRecord`, the one place the record is guaranteed
   pending), once per pause record, and claim counts as its answer.
5. **Progress evidence must be farm-proof** (semantics A4/A10, authority 6a/6b): 128
   one-char notes buy the full 8h wall budget today; non-blocking `question.asked` is
   unlimited; a blocking question parks outside the watchdog with `deadlineAt: null`. →
   TG2's evidence class is distinct-content-digest-bounded and resolution-gated.
6. **The stall watchdog is not a liveness bound** (semantics A7, authority TG1/6b:
   production stallMs = wallMin, any-event re-arm, blocked-status escape). → Filed as
   issue #67; this contract bounds its own steering window and never cites the watchdog
   as a bound.
7. **Verdict delivery must not ride run.feedback** (authority TG4: caller-authored
   {gate, detail} = forged-verdict surface). → TG4 uses the planner-owned revision/next-
   brief channel only.
8. **The analysis exemption already exists by omitting requiredEffects** (authority TG5:
   machinery DEFENDED). → TG5 makes the node field the SOLE legitimate omission path.
9. **The coaching is actively harmful** (authority TG6: digest churn breaks digest-keyed
   steering bounds). → Retired at this epic's acceptance, not deferred.

## v1.0 decisions

### TG1 — Checkpoint/final taxonomy; deferral is non-dispatch

In the `turn_completed` dispatch (coordinator.mjs:10791-10806): when `_admitPauseRecord`
mints (or pends) a pause record for the completion, the turn is a CHECKPOINT — the trust
gate does not dispatch, no gate event is written, the task stays `paused` pending steering
(TG3) or a driver claim. A `turn_completed` with no pause record is a FINAL — the gate
runs exactly as today (all phases, including required_effect and the referee). A gate run
therefore always evaluates a genuinely final answer: violation verdicts
(forbidden_effect, path_scope) keep their every-run immediacy at finals, and progress
verdicts (required_effect, referee/coverage) exist only at finals. `claim_turn`'s re-run
(:2281-2314) is unchanged — it is the drivered final, and it runs the FULL gate (a driver
claiming a checkpoint accepts the final-evaluation risk, as today).

The auto_no_driver path changes exactly one behavior: instead of settle-`working` + gate
dispatch, it holds the pause pending and arms TG3's steering cycle. The un-driven final is:
(a) a later `turn_completed` with no pause record, (b) the TG3 window expiring unanswered,
or (c) run termination (today's `lifecycle.exited` semantics unchanged — no gate there).

Red-team residue accepted: mid-workflow violation writes (out-of-scope at a checkpoint)
are caught at the next gate run (final or claim), not at the checkpoint — the same
exposure drivered runs already carry by design.

### TG2 — Farm-proof coordination progress evidence

Liveness evidence (used ONLY by TG3's steering cycle and the no_progress determination —
never by acceptance) gains a coordination-work class: hub-receipted events on the worker's
own stream — `scratchpad.write_result {ok:true}`, board mutations, and RESOLVED
interactions — counted with two bounds:

- **Distinct-content dedup:** receipts dedupe by content digest within the window. One
  distinct valid receipt answers the cycle; ten identical one-char notes count once. There
  is NO content floor — the cycle is a liveness check, and farming buys nothing beyond
  one answered cycle per pause record (the window is bounded at 5 minutes, the cycle is
  once-per-record, and the FINAL evaluation still demands the real diff — the farm bound
  lives at the final, not the window).
- **Resolution-gated interactions:** `question.asked`/`decision.requested`/
  `approval.requested` earn progress only when resolved (answered/settled) inside the
  window. A pending interaction buys nothing; a blocking interaction older than its
  deadline (or a bounded deployment default when `deadlineAt` is null, #67's sibling) does
  not re-arm.

Acceptance is untouched: at FINAL, `required_effect` still demands a real in-scope diff;
coordination work is liveness, never deliverable.

### TG3 — One bounded steering cycle at the pause-admission seam

When `_admitPauseRecord` would auto-settle (no registered driver), it instead performs
exactly one steering cycle for that pause record:

1. Deliver a policy nudge through the worker's control lane: hub-marked provenance text
   (a fixed `baton-progress-check:` prefix; sanitized through the same 6-pattern
   SECRET_SHAPED + NFKC + bounded pipeline messages.mjs owns), asking for progress and
   remaining plan. Policy-actor only — no principal-addressable command in v1.
2. Arm a bounded continuation window (deployment policy `progressNudgeWindowMs`, default
   5 minutes — NOT stallTimeoutMs; the layer confusion in v0.9 is corrected). Any of
   {diff capture, TG2-class receipt, resumed turn} answers the cycle: the pause settles
   `working`, no verdict, no gate dispatch.
3. On expiry unanswered: the pause settles and the gate dispatches as today's auto-settle
   would — the full final evaluation, with the steering receipt
   (`steered: {nudgeId, answered: false}`) durable on the verdict.

Once per pause record, keyed on the record's own epoch — micro-progress cannot re-arm it
(the record is consumed by the cycle). `claim_turn` on a cycle-armed record counts as its
answer (6c closed). Worst-case added latency for a genuinely dead worker: one bounded
window (5 min default), replacing today's immediate-but-wrong verdict.

### TG4 — Verdict reaches the worker through the revision channel

A gate failure verdict — the sanitized {gate, detail} shape DIAG DG-1 minted (digests+
counts for scope, sanitized tails for red_green/coverage, NEVER path strings, and
baseSha/sha digests hub-side — authority TG4's evidence-shape amendment) — is delivered to
the worker through the planner-owned revision/next-brief channel when the task is
re-driven, and is readable by the worker's harness in its next brief. `run.feedback` is
NOT the lane (caller-authored forgery surface, authority TG4; its hardening is a separate
issue, out of v1). `required_effect_absent` names itself in the worker-visible verdict —
today's degradation to `'unknown'` is fixed.

Scope clarification (blue-team, v1.0.1): the recovery-refinement brief is byte-identical
to the prior task's brief by the store's digest pin (coordination-store.mjs:2880) — the
refinement brief is therefore NOT a verdict channel. v1's testable core: (a) the projected
terminal cause names the gate (`policy_failure` + the exact code, never 'unknown'), and
(b) the refusal is projected as sanitized {gate, detail} on the DG-1 run.debug surface.
The planner-composed next-brief delivery is the v1.1 half (named follow-up).

### TG5 — `analysis: true` is a plan-node field, the sole omission path

`analysis: true` is a closed boolean field on the plan NODE (planner-set at proposal,
digest-bound through plan+approval digests — authority confirmed post-approval flips are
unrepresentable). A node's requiredEffects may omit `repository_edit` ONLY when the field
is present; any other omission is a plan-validation error. `contextEffectNodeBinding`
(coordination-store.mjs:6813-6845) binds the field identically for context-program nodes
(6d closed). Final evaluation of an analysis node skips required_effect and runs every
other phase.

### TG6 — The coaching retires at THIS epic's acceptance

Shipped constraint/coaching text that trains writing for the gate's benefit is reworded to
steering-compatible form at acceptance (recipes' analogues at recipes.mjs:529-536 and the
objective boilerplate family): the guidance becomes "produce your deliverable; progress
verdicts evaluate finals, and one progress nudge precedes any verdict" — no skeleton-first,
no write-early-to-survive. Acceptance includes a source-scan: no shipped constraint line
references beating the gate.

### TG7 — named follow-ups (out of v1)

Issue #67 (the stall watchdog: inert-by-config, any-event re-arm, blocked-status escape).
run.feedback hardening (forgery surface, authority TG4 — its own issue at acceptance).
Objective boilerplate from live truth (#61 opus P0-2). Per-profile gate tuning.

## v1.0 acceptance (red-first)

- A worker whose first turn is reads + scratchpad writes with NO diff stays alive: one
  policy nudge delivered (provenance-marked), the window arms, the admitted writes answer
  it (distinct receipts), the pause settles working, ZERO gate events dispatched.
- A worker that never answers inside the window gets today's full final evaluation WITH
  the steering receipt attached; an edit-free final on a required-edit plan still fails
  required_effect_absent exactly as today (anti-gaming preserved); an edit-free final on
  a green-base tree is accepted exactly as today (no regression).
- A farmer (128 duplicate one-char notes; or a chain of unanswered trivial questions) does
  NOT answer the cycle: dedup counts them once; unresolved interactions count never.
- A drivered run is byte-identical to today (claim re-runs the full gate; no policy cycle
  when a driver is registered).
- The verdict reaches the re-driven worker's brief in the sanitized shape; run.feedback
  accepts no new caller shape.
- An analysis node's edit-free final passes required_effect; a non-analysis node's
  edit-free final fails it; a plan node cannot self-declare analysis post-approval.
- Every pre-existing gate phase behaves byte-identically at finals.

---

## v0.9 seed (preserved for traceability)

(Seed: issue #64 + #61 and the operator's standing directive — "use programmatic steering to
nudge or check on progress, never turn-based gating; turn-based limits make smart systems
shallow and brittle. If there are actions you don't want an agent to take during specific
workflows, restrict the tool surface instead, then reap the agent at the end. Large models
with familiar harness toolsets can generally be trusted to act logically." Live receipts:
demo v3b retry 4 (a healthy glm surveyor killed mid-workflow: reads + three admitted
SCRATCHPAD_WRITEs, then turn_completed → auto_no_driver settle → trust gate →
required_effect_absent → interrupt/kill → worktree.progress_unchanged no_progress) and the
"insane" skeleton-first coaching pattern every objective now carries to survive the gate.)

## Ground truth (all code-verified 2026-08-02)

1. **The gate evaluates every turn completion as if it were final.** `_admitPauseRecord`
   (coordinator.mjs:2003-2063) auto-settles a `turn_completed` pause when no
   `steering.registered` driver exists for the run, and `true` from that path dispatches
   `_runTrustGate` immediately (:10802). The gate's `required_effect` phase
   (:11160-11175) fails any task whose approved plan requires `repository_edit` when the
   capture shows no in-scope diff — even though the worker is mid-workflow and its NEXT
   turn would have produced the diff. With a registered driver the pause pends for
   `claim_turn` instead (:2281-2314), so wave-driven workers survive by the driver's
   claim cadence, not by any property of their work.
2. **Coordination work is invisible as progress.** The gate reads worktree diffs only.
   Scratchpad writes (`scratchpad.write_result ok:true`), board mutations, decision/
   question interactions — all hub-receipted in the same operational log the gate's
   evidence already draws from — count for nothing. A worker doing a full turn of
   knowledge-layer work is `no_progress`.
3. **The escalation is verdict-first, steer-never.** Between "no diff" and "failed/killed"
   there is no programmatic check: no nudge, no progress query, no bounded continuation
   window. The wave driver's L6 pattern (nudge-on-checkpoint with an unproductive-nudge
   budget, claim-on-stall finalization) already proves the steer-first shape at the DRIVER
   layer — the gate itself has none of it.
4. **The worker never learns why (#61, glm P1-3).** The gate's verdict reaches the
   orchestrator (refusal code, DIAG-2's run.debug {gate, detail}) but the judged worker
   sees at most a bare code — it cannot correct against a verdict it cannot read.
5. **requiredEffects is plan-global.** Profiles force `repository_edit` on every node
   (application-deployment.mjs:884), so survey/review/audit tasks — whose deliverable is
   analysis — must either fake an edit or die. Today's workaround is the skeleton-first
   coaching pattern: prompt-side mitigation of a machinery behavior, exactly the class the
   operator banned.

## The question

Does the gate become a steering instrument — evaluating at final completion, counting
coordination work, steering before it fails anyone, and explaining itself to the worker it
judges — while keeping every byte of its anti-gaming strength? Or does it stay a
turn-based turnstile that trains workers to write early garbage?

## Decisions (draft, to be red-teamed)

### TG1 — Gate evaluation is final-only

The `required_effect` phase evaluates ONLY at a task's terminal completion (final turn),
never at an intermediate `turn_completed` checkpoint pause. Intermediate pauses settle as
`working` WITHOUT a gate verdict — the gate runs at the run's actual completion or the
driver's final `claim_turn`, exactly as today. The other phases (capture, forbidden_effect,
path_scope, environment, coverage) keep evaluating at every turn completion: those are
safety properties (a worker must never touch forbidden/out-of-scope paths EVER), not
progress judgments, and they are diff-present by construction (they only fire when a diff
exists). `required_effect` is the lone progress judgment and the lone mover.

Red-team targets: does deferring required_effect to final-only let a worker run the clock
with no diff forever (the watchdog/stall path is the bound — is it sufficient)? Does the
auto_no_driver path now let un-driven runs skip the gate entirely (it must still evaluate
at THEIR final — where is that)?

### TG2 — Coordination work counts as progress evidence

The `no_progress` / stall evaluations gain a coordination-work evidence class: hub-receipted
events on the worker's own stream — `scratchpad.write_result {ok:true}`, board mutations,
`decision.requested`/`question.asked`/`approval.requested` and their resolutions — count
as progress with the same authority as a worktree diff for the purpose of "is this worker
doing anything". The evidence is the hub's own receipts (policy-actor, never worker text),
so it is unspoofable by the worker. The required_effect phase itself still requires a
real in-scope diff AT FINAL (coordination work is progress, not deliverable) — TG2 changes
liveness judgments, not acceptance.

Red-team targets: can a worker farm scratchpad writes to stay alive indefinitely (the
stall window + TG3's steering cycle is the bound — is the loop tight enough)? Does counting
decision requests reward stalling-by-question (the BD-A one-pending-decision admission
already caps live decisions at one)?

### TG3 — Steer-before-fail: one bounded steering cycle precedes any progress verdict

Before a progress-class failure (`required_effect_absent` at final, `no_progress`
preservation, stall escalation), the run layer performs ONE bounded steering cycle: a
`nudge_turn` carrying a progress query ("report your progress and remaining plan"),
followed by a bounded continuation window (deployment policy, default one
`stallTimeoutMs`). Only if the worker does not produce progress (diff OR coordination
work) inside that window does the verdict land. The verdict receipt names the steering
cycle (`steered: {nudgeId, answered: false}`) so "we asked and it didn't answer" is
durable evidence, never an assumption. This is the wave driver's L6 pattern productized
into the run layer, as the operator directed.

Red-team targets: nudge delivery to a mid-turn worker (is the steering lane reliable at
every pause state, or only checkpoint pauses)? Does the extra window double worst-case
turn latency for genuinely dead workers (bounded by stallTimeoutMs — acceptable)?

### TG4 — The worker sees the verdict (#61, glm P1-3)

A gate failure verdict is delivered to the judged worker through the same sanitized
{gate, detail} shape DIAG DG-1 gave run.debug — scope failures as digests+counts (never
path strings), red_green/coverage as sanitized tails — via `run.feedback` when the run is
still live, and into the worker's next-turn brief when it is re-driven (the revision
channel). The worker learns WHICH gate, WHAT it checked, and the sanitized evidence class —
never orchestrator prose.

Red-team targets: injection through verdict text (wrapProse/sanitization already exists —
verify reuse); does telling the worker the gate's exact checks hand a gaming manual to a
hostile worker (the checks are already discoverable in the shipped source — obscurity is
not the defense, the gate's live re-run is)?

### TG5 — Brief-declared analysis tasks (`analysis: true`)

A task brief may declare `analysis: true` (bounded, hub-validated): the node's approved
plan then documents `repository_edit` as NOT required for that node, and required_effect
does not apply at its final evaluation. The planner sets it for survey/review/audit-shaped
nodes; a plan node may not declare it for itself after dispatch (no worker self-exemption).
Profiles' plan-global requiredEffects stays the default for everything else.

Red-team targets: is a brief-level flag enough, or must the plan node's own digest carry
it (a plan amendment could strip it post-approval — the approval digest must bind it)?
Does analysis:true weaken the effect-audit story (the node's captured diff is still
scope-checked — forbidden/path_scope phases still apply)?

### TG6 — named follow-ups (out of v1)

Objective boilerplate generated from live truth (#61, opus P0-2); the skeleton-first
coaching pattern's retirement from recipes' constraint lines once TG1/TG3 make it
unnecessary (evaluate at acceptance); per-profile gate tuning.

## Acceptance (red-first)

A worker that completes a first turn of reads + scratchpad writes with NO worktree diff is
alive and `working` afterward (TG1+TG2), having received exactly one progress nudge (TG3);
when it completes with a real diff, no steering cycle is spent. A worker that never
answers the nudge inside the window receives the failure verdict WITH the steering
evidence attached (TG3) and the verdict reaches the worker in the sanitized shape (TG4).
A plan requiring repository_edit fails an EDIT-FREE final answer exactly as today
(anti-gaming preserved). An analysis-declared node completes with zero diff (TG5); a
non-declared node cannot self-declare. Every pre-existing gate phase (forbidden_effect,
path_scope, environment, coverage) behaves byte-identically.
