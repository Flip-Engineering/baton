# Trust-gate steering epic contract (v0.9, pre-red-team)

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
