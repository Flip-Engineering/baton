# PM-DAG — pm's DAG engine vs baton's waves/plan structures

[attempt: 43ea3f5f-c961-47f2-92d6-2d565dab76b4 row-pm-dag]

Row lane: **execution planning, dependency structure, and progress governance.** Read first:
`foundry-brief.md` (shared laws), `row-pm-dag.md` (this row brief), `pm-digest/README.md`
(the `.rs` files are truth, prose docs stale-risk). pm side grounded in `src_dag_mod.rs`
(the DAG engine), `TASKS.md` (phase/task decomposition), `DESIGN.md` layers 2+6 (impact
propagation, multi-project orchestration). Baton side grounded in `workflow-interpreter.mjs`
(the drive loop + steering lanes), `wave.mjs`/`wave-driver.mjs` (the wave registry),
`task-topology.mjs` (the landed typed-relation dependency structure), the folded #161 plan
object (`orchestrator-plan-object-contract.md` v2.0), the landed #67 stall watchdog
(`stall-watchdog-contract.md`, `REARM_KINDS` at `coordinator.mjs:71-76`), the #163
quiescence contract (`contract-foundry-2026-08-13/contract-163.md`, DRAFT v2 — not landed),
and the campaign's own evidence-gate methodology (spec-driven foundries with red/blue stages).

**Verdicts per candidate: ADOPT / ADAPT / REJECT / ALREADY-HAVE with the landing zone.
Every pm time-based mechanism is ADAPT-to-event-derived or REJECT per the standing veto.**
Judgment calls are recorded inline; authority-class ambiguity is flagged DECISION_REQUEST.

---

## 1. Ground truth — what pm's DAG engine actually is (landed vs intent)

The `.rs` code is the truth; the prose overstates. `src_dag_mod.rs` lands exactly four things:

| pm mechanism | Landed reality in `src_dag_mod.rs` | Intent-only (prose/TASKS) |
|---|---|---|
| **Topological sort** | `topological_sort` — DFS over `phase.depends_on`, deps-before-dependents (`:18-45`) | — |
| **Next-phase selection** | `next_phases` — actionable = deps all `Complete`, excludes `Complete`/`Deprioritized`, sorted by `impact` **descending** (`:49-67`) | — |
| **Impact propagation** | NOT in the engine. `next_phases` sorts by the phase's own scalar `impact` (`create_phase(pid,"A",10,&[])` — a bare operator number). | `DESIGN.md:18` — `effective_impact = own + weighted downstream blocked phases`; `TASKS.md` P2.2 "impact propagation through graph" is a TDD item, **not landed** |
| **Stagnation detection** | `stagnation_check(threshold)` — counts **consecutive** `Fail`/`Inconclusive` experiments most-recent-first; a `Pass` breaks the streak (`:70-96`); the unit is an evidence count, not a clock | — |
| **Auto-transition** | NOT in the engine file. | `DESIGN.md:19` "phase completes when all experiments are non-pending"; `TASKS.md` P2.4 is a TDD item |
| **Review gates** | NOT in the engine file. | `DESIGN.md:21` "blocks experiments after K experiments **or T hours** without review"; `TASKS.md` P2.6 TDD item |
| **Time-boxed budgets** | NOT in the engine. | `DESIGN.md:43` "experiments have budgets, auto-terminate if exceeded"; `TASKS.md` P6.4 |
| **Multi-project orchestration** | NOT in the engine. | `DESIGN.md` layer 6 — priority classes (active/background/paused/archived), cross-project impact dashboard, opportunity-cost tracking, portfolio stagnation |

So pm's *landed* DAG engine is small: a topological sort, an impact-ordered next-action
selector, and a consecutive-failure counter. The ambitious machinery (propagation,
auto-transition, review gates, budgets, portfolio views) is design intent + MCP-tool
surface (`pm_dashboard`, `pm_review`, `pm_next` in `src_mcp_tools.rs`) riding a SQLite
store — the enforcement is mostly "the operator asks a tool and reads the answer."

## 2. Ground truth — baton's wave/plan/steering/liveness machinery

- **Waves are parallel, flat per wave.** `wave.mjs` starts every member concurrently
  (`createWave` loops `baton.runs.start`, `wave.mjs:193-212`); there is no blocked-by
  between wave members at start. The only cross-member semantic is the interpreter's
  `signalOnMembersDone` (a *message* to remaining members when named roles are terminal,
  `workflow-interpreter.mjs:740-751`) and the stuck-decision early-break (`:753-757`).
- **The drive loop is the governance engine.** `driveLane` polls each member and fires the
  steering lanes: `approveOnAdvertisedPlan` (receipts the advertised plan digest),
  `nudgeOnCheckpoint`/`claimOnStall` (turn-checkpoint steering, nudge-then-claim),
  `messageOnSpawn`, `elevateWhenNotes` (scratchpad elevation), `answerDecisions`
  (policy-answered decisions), `signalOnMembersDone` (`workflow-interpreter.mjs:679-761`).
  These are **event-derived steering, not gates** — each fires once per member and receipts
  an evidence line; none blocks progress on a counter.
- **Typed dependency structure is landed.** `task-topology.mjs` owns the closed six
  `TASK_TOPOLOGY_RELATIONS = ['follow_up','oracle','preserved_resume','recovery','review','revision']`
  with a closed bounded deployment policy (`maxDepth`, `maxChildrenByRelation`,
  `maxTasksPerRun`) and `_validateTaskTopology` refusing dangling/self/cross-run/cyclic
  refinement (`coordination-store.mjs:1621-1667`).
- **The #161 plan object carries the campaign-todo DAG** (folded v2.0, RED at HEAD — no
  `plan.*` events land in the store; the `_plans`/`_planHeads` maps at
  `coordination-store.mjs:1205` are the goal-plan's `plan:<hex64>` projections, not the
  plan object). Its shape: tasks with closed-three `status`, a `blockedBy` DAG edge list
  (`plan_topology_invalid` on self/dangling/cycle), `ownedBy {wave,run,role}`, `evidence`,
  `focusTaskIds` (bounded focus window), per-wave-subtree exactly-one-in-progress, and the
  `plan_blocked` refusal on a `→ done` whose `blockedBy` are not all `done`.
- **#67 stall watchdog is landed and evidence-derived.** `REARM_KINDS` is the closed four
  (`coordinator.mjs:71-76`); `_observeWatchdogEvent` treats everything else as silence
  (`:9245`, `:9695`); the stall basis is `'no_progress_evidence'` (`:9122,9159,9171`); the
  loop detector `loopThreshold` (default 3) with `loopAction: 'interrupt'` (`:1089-1092,
  9646-9655`) is the landed repeated-failure bound.
- **#163 quiescence is a DRAFT contract, not landed.** The drive loop still uses
  `hardCapMs` (`workflow-interpreter.mjs:414,420,736`); `PRODUCTION_WORKFLOW_DRIVER` still
  ships the 3h clock (`application.mjs:117-119`). The quiescence law (roster-derived window,
  `WAVE-QUIESCED` verdict, totality rule) is the *planned* de-clocking, not the reality.
- **The campaign's own governance is the evidence-gate methodology.** Every contract lands
  via RED-first acceptance pins (RED = fails at HEAD), a red-team review, a blind-QA, and a
  red-first test suite. That is the review gate baton actually has; pm's formal "K/T hours"
  review gate must be judged against it.

---

## 3. Candidate verdicts

| # | Candidate (pm mechanism) | Verdict | Landing zone / note |
|---|---|---|---|
| C1 | Dependency-typed task structure (phases blocked-by phases) | **ALREADY-HAVE** (task-topology) + the #161 plan object's `blockedBy` is the same idea folded at contract level | `task-topology.mjs` (landed, typed closed six) + #161 D1 `blockedBy` DAG (RED at HEAD, the plan-object rung) |
| C2 | Impact propagation for prioritization | **ADAPT** — read-side advisory only, structurally derived, never a focus-window driver | #161 plan object read projection / a `waves.list`-style dashboard; downstream-blocked-count is structural (event-derived), pm's operator-assigned `impact` scalar is not |
| C3 | Auto-transition on child completion | **ADAPT** (unblock half is ALREADY-HAVE; derive-completion half is REJECT) | Unblock: #161 `plan_blocked` gate (a blocked task's member is `dispatch_pending`, not claimable). Derive-done-from-children: REJECT — conflicts with #161 D4 immediate-completion-marking (status is asserted with evidence, never derived) |
| C4 | Stagnation detection (N consecutive failures → forced review) | **ADAPT** — evidence-count detection yes; auto-forced review no | Detection → a read-side `pm_review`-style warning (evidence count, veto-compliant). Forced review → the campaign's evidence-gate methodology is the gate; the landed `loopThreshold` interrupt (`coordinator.mjs:9646-9655`) is the liveness bound |
| C5 | REVIEW GATES (K experiments or T hours → block) | **REJECT** (T hours = wall clock, per veto) / the K auto-block is wrong for baton | The campaign's foundry method (RED pins + red-team + blind-QA) is the gate; a silent counter that freezes progress is a machine-channel control, an infrastructure-law violation. No landing zone |
| C6 | Opportunity-cost / portfolio view across parallel workstreams | **ADAPT** — read-side portfolio projection, evidence-derived | A read aggregation over `waves.list` + plan object (the `pm_dashboard` analog); priority classes (active/background/paused/archived) are additive statuses, but baton is single-repo today — the honest shape is a wave/plan focus-rank projection, not a multi-project board |
| C7 | Topological sort / execution ordering | **REJECT** (mechanism) — baton's wave model is parallel | The DAG-validity half is ALREADY-HAVE (#161 `plan_topology_invalid`, goal-plan `assertDag`); an execution order is meaningless for a concurrent wave roster |
| C8 | Time-boxed evaluation budgets (auto-terminate on wall time) | **REJECT** per veto | The wall budget (`DEFAULT_BUDGET.wallMin`, an operator-pinned node bound) is the coarse backstop; #67 evidence-derived stall is the liveness bound. No auto-terminate-by-clock workflow control |
| C9 | Idle detection / auto-scaffold on phase completion (MCP layer 4) | **REJECT** (auto-scaffold) / **ADAPT** (idle detection to event-derived) | Auto-injection into the agent runtime is the machine-channel violation (#67 G9's sterile-surface law). Event-cadence-derived idle *detection* (not auto-action) is the #163-style shape |

---

## 4. Detailed evaluation

### C1 — Dependency-typed task structure (phases blocked-by phases)

pm's `depends_on` (`src_dag_mod.rs`) is a bare edge list between phases — the edge has no
type and no payload. Baton has **two** richer structures already:

1. **`task-topology.mjs` (landed)** — the closed six `refines` relations
   (`follow_up`, `oracle`, `preserved_resume`, `recovery`, `review`, `revision`). This is
   strictly more expressive than pm: the edge type is a closed enum with per-relation
   fanout bounds, and `_validateTaskTopology` refuses dangling/self/cross-run/cyclic
   refinement. **ALREADY-HAVE.**
2. **#161 plan object (contract, folded v2.0)** — `blockedBy` is the campaign-todo DAG
   edge list, validated as a DAG (`plan_topology_invalid`), mirroring the goal-plan `deps`
   discipline. This is pm's `depends_on` at the campaign-todo level. **ALREADY-HAVE at the
   contract level** — the rung to land is #161 itself (RED at HEAD; the `_plans` map in
   the store is the goal-plan's, `coordination-store.mjs:1205`).

What pm has that baton deliberately does not: the *execution-order* meaning of the DAG.
pm runs phases sequentially (topological order → next phase). Baton runs waves in parallel
and gates at the task level. That is a design difference, not a gap — see C7.

### C2 — Impact propagation for prioritization

pm's intent: `effective_impact = own + weighted downstream blocked phases` (`DESIGN.md:18`)
→ `next_phases` returns the highest-impact actionable phase. The landed code is weaker: it
sorts by the operator-assigned scalar `impact` (`src_dag_mod.rs:65`); the propagation
formula exists only as a TDD item (`TASKS.md` P2.2).

The idea worth keeping: **when several tasks are actionable, rank by structural
consequence.** Baton's plan object already has the structural raw material — the `blockedBy`
DAG. The number of tasks transitively blocked by a task is an **event/evidence-derived
quantity** (it falls out of the DAG, no clock, no operator number), so a veto-compliant
impact proxy exists.

**ADAPT.** Two constraints shape it:

- **Read-side only.** #161 DR-3 pins the focus window as *orchestrator-maintained*
  (`focusTaskIds` mutated via `plan.focus_upserted`, "never derived" — `orchestrator-plan-object-contract.md` D1/DR-3). So impact ranking must be an advisory projection (a
  dashboard "what's next" list), not an automatic focus-window driver. Auto-deriving focus
  from a score would break the authority law (D2: the orchestrator decides what is in
  focus).
- **No operator-assigned impact scalars.** pm's `impact` is a lie-able number (honesty
  veto). The baton shape is *structural consequence* — downstream-blocked count, or the
  closed top-logical depth — computed from the `blockedBy` DAG, never entered by hand.

**Landing zone:** the #161 plan-object read projection (a `plan.read`-adjacent view that
ranks actionable tasks by downstream-blocked count for the `plan:*` seat), or a
`waves.list`-style portfolio projection (C6). Sized honestly: this is a small read-side
computation over an existing projection — a genuine candidate for the #161 implementation
rung, not a new subsystem.

### C3 — Auto-transition on child completion

pm has two halves here:
- **Unblock:** a phase becomes actionable when its deps are `Complete`
  (`src_dag_mod.rs:57-59`, the `next_phases_unblocks_when_dep_completes` test). Baton's
  #161 has exactly this: the `plan_blocked` refusal on a `→ done` whose `blockedBy` edges
  are not all done, and the interpreter gate that renders a blocked task's member honestly
  `waitingOn: dispatch_pending` (D3 wire 2). **ALREADY-HAVE** (contract-level, #161).
- **Derive-completion:** "phase completes when all experiments are non-pending"
  (`DESIGN.md:19`, `TASKS.md` P2.4). This is the half to **REJECT.** #161 D4's law is the
  opposite: immediate completion marking — "a verified-complete task is marked `done` at
  once, never batched or lazy; `plan.read` never re-derives status from anything else; the
  plan object's status IS the truth" (D4, OQ3/P4). Deriving `done` from a child-status
  count is exactly the kind of surface that can lie (a task whose children are all
  non-pending but whose evidence is missing would read done). Honesty veto wins.

**Verdict: ADAPT** — keep the unblock half (already in #161), reject the derive-done half.
The landing zone is the #161 rung.

### C4 — Stagnation detection (N consecutive failures → forced review)

pm's `stagnation_check` (`src_dag_mod.rs:70-96`) is a well-shaped *detector*: it counts
**consecutive** `Fail`/`Inconclusive` experiments, most-recent-first, and a `Pass` breaks
the streak. It is an evidence count — veto-compliant as a detection.

Baton has two neighboring things:
- **Landed:** the `loopThreshold` loop detector (`coordinator.mjs:1089-1092, 9646-9655`) —
  repeated failed actions → `interrupt` at the liveness layer. It is a *liveness* bound,
  not a workflow gate, exactly per #67's control law.
- **Campaign:** the review-before-landing methodology (red-team + blind-QA + RED pins).
  "Forced review" is already how progress is governed — a contract cannot land without it.

**ADAPT.** Split the pm mechanism:
- **Detection → ADOPT the shape as a read-side warning** (the `pm_review`/`pm_next`
  "stagnation warning" surface): a projection that counts consecutive failing outcomes per
  wave/task and names it. Landing zone: a read view over the run ledger / #161 evidence
  links. This is veto-compliant (evidence-count) and honest.
- **Forced review → do NOT auto-block.** pm's "detect N failures → force review" would
  make a counter freeze progress. Baton's governance principle (machine channels sterile,
  methodology chain governs impl) says a review is a *decision* by the orchestrator/review
  seat, not a silent counter action. The landed loop detector already interrupts on
  repeated failure at the liveness layer; escalating that to a *gate* is the #149-shaped
  review-gate question (C5).

### C5 — REVIEW GATES (K experiments or T hours → block)

pm: "Mandatory review gates: blocks experiments after K experiments **or T hours** without
review" (`DESIGN.md:21`; `TASKS.md` P2.6). This is the crux the row brief calls out.

- **The T-hours half is an automatic REJECT** per the standing veto — a wall-clock control.
  No amount of honest intent makes "T hours without review blocks progress" veto-compliant.
- **The K-experiments half is also REJECT** as an auto-block, for a distinct reason: baton
  already has a *stronger* review gate — the campaign's evidence-gate methodology. Every
  contract lands via RED-first acceptance pins (RED = fails at HEAD), a red-team review,
  a blind-QA, and a red-first suite. That is a review gate on **evidence** (does the
  proposal's RED pin actually fail at HEAD? do the pins survive the suite?), not on a
  counter. A K-counter that freezes experiments would *weaken* the campaign's gate by
  replacing "does the evidence hold" with "have K things happened since the last check."

The #149 "gate digest" the row brief names is the campaign-side reference for exactly this:
the review gate digests evidence (RED/GREEN pins, red-team verdicts) before a landing is
admitted. No durable #149 contract file is present in this worktree (searched
`docs/reference/evidence/**`; the only hits are this row brief) — recorded honestly. The
campaign's *behavior* is unambiguous and is what the comparison is judged against.

**Verdict: REJECT** (both halves). No landing zone; the campaign's foundry method
**ALREADY-HAVE** the gate, and it is evidence-derived where pm's is counter/clock-derived.

### C6 — Opportunity-cost / portfolio view across parallel workstreams

pm layer 6 (`DESIGN.md`): priority classes (active/background/paused/archived), a
cross-project impact-weighted dashboard (`pm_dashboard`), opportunity-cost tracking
("what is deferred when working on project A"), and portfolio stagnation.

Baton's honest state: **single-repo, parallel waves.** The wave registry (`waves.list`,
the `_waveRegistry` fold) and the #161 plan object are the queryable surfaces; there is no
cross-project priority model and no opportunity-cost projection. The campaign runs one
campaign in one repo with concurrent foundry waves — the "portfolio" is the wave roster.

**ADAPT.** What survives contact with the vetoes:

- **The read-side dashboard idea is right.** An aggregation that answers "across the live
  waves and the plan's actionable tasks, what is the highest-consequence next action for
  the orchestrator?" is genuinely useful and veto-compliant — it is a read over
  `waves.list` + the plan object's blockedBy DAG (C2's structural impact), with no clock
  and no new authority.
- **The priority classes are additive statuses, not clocks** — `active/background/paused/
  archived` could ride a project/plan state field without touching a closed vocabulary
  (additive-only). But baton is single-repo; the honest landing is a *wave/plan focus-rank*
  projection, not a multi-project board. The opportunity-cost phrasing ("what is deferred")
  is the same question asked about the wave roster: when the orchestrator focuses a bounded
  `focusTaskIds` window (#161 DR-3), the deferred set is the complement — a derivable read,
  not a clock.

**Landing zone:** a read-side portfolio projection (the `pm_dashboard` analog) composed
over `waves.list` + the plan object; sized as a surface-read over existing projections.
This is the strongest genuine ADAPT in the lane — the idea is right, the shape must drop
the operator-assigned impact scores and the multi-project fiction.

### C7 — Topological sort / execution ordering

pm's topological sort is the engine's core (`src_dag_mod.rs:18-45`) because pm executes
phases sequentially. Baton executes waves in parallel and gates members at the task level
(#161 `dispatch_pending`; `signalOnMembersDone` as the only cross-member wire). A
topological *execution order* would be machinery with no consumer.

**REJECT** the ordering mechanism. The DAG-validity half (no self-edge/dangling/cycle) is
**ALREADY-HAVE** in #161 (`plan_topology_invalid`) and the goal-plan `assertDag`. If a
future rung ever needs sequential wave execution, the topological sort is trivial to
derive from the plan object's `blockedBy` — no new pm import needed.

### C8 — Time-boxed evaluation budgets

pm: "experiments have budgets, auto-terminate if exceeded" (`DESIGN.md:43`, `TASKS.md`
P6.4). Pure wall-time auto-termination → **REJECT** per the veto. Baton's real bounds:
- the node wall budget (`DEFAULT_BUDGET.wallMin`, an operator-pinned backstop) — kept as-is,
  a coarse outer bound, not a workflow control;
- #67's evidence-derived stall (`basis: 'no_progress_evidence'`, closed `REARM_KINDS`) —
  the liveness bound that says "no evidence of progress," never "too slow" (#67 §5 control
  law: "no bound fires on elapsed time without an evidence check").
No auto-terminate-by-clock workflow control lands.

### C9 — Idle detection / auto-scaffold (pm MCP layer 4)

pm's agent-runtime integration: idle detection that injects a dashboard when idle, and
auto-scaffold that creates next-phase tasks when a phase completes (`DESIGN.md:36-40`).
The **auto-injection into the agent runtime is a machine-channel violation** (the sterile-surface
law #67 G9 and the "a surface that can lie" veto): an idle-triggered dashboard injection is
the coordinator talking over a machine channel. The **auto-scaffold** is the derive-next-step
counterpart of C3's derive-done — rejected for the same reason (status/task creation must be
an orchestrator decision with evidence, not a hook). Idle *detection* re-expressed as
event-cadence (the #163 roster-derived window shape) is the only veto-compliant fragment —
and baton already has that shape in #163's design.

---

## 5. Time-mechanism census (every pm clock → ADAPT-to-event-derived or REJECT)

Per the standing veto, no wall-clock control lands anywhere. Complete census of the pm
time-based mechanisms in this lane:

| pm mechanism | Source | Verdict |
|---|---|---|
| Review gate "**or T hours**" | `DESIGN.md:21` | **REJECT** — wall clock |
| Time-boxed evaluation budgets (auto-terminate) | `DESIGN.md:43`, `TASKS.md` P6.4 | **REJECT** — wall clock |
| Idle detection threshold (tool-call frequency) | `TASKS.md` P5.3 | **ADAPT-to-event-derived** — event-cadence detection only, never an auto-action (C9) |
| Auto-scaffold trigger on phase completion | `TASKS.md` P5.4 | **REJECT** — derived-completion (C3) + machine-channel injection (C9) |
| Review-gate injection on K experiments | `TASKS.md` P5.5 | **REJECT** — the campaign's evidence-gate methodology is the gate (C5); a counter-block is wrong |
| `expires_at` on constraints | `src_mcp_tools.rs` (`pm_constraint_add`) | **REJECT** — wall-date expiry; a constraint is retired by evidence (superseded/refuted), never by a date |
| Stagnation N-consecutive-failures | `src_dag_mod.rs:70-96` | **ADAPT** — evidence count, fine as a read-side warning (C4); never an auto-forced review |

Baton's landed time-adjacent surfaces that stay: the node wall budget (operator-pinned
backstop), #67's `stallMs`/`blockingInteractionTimeoutMs` (liveness windows whose *basis*
is always `no_progress_evidence` and which re-arm on evidence, never on bare elapsed time),
and #163's planned roster-derived quiescence window (an evidence-cadence bound, not a
constant).

---

## 6. The governance comparison (pm's formal gates vs the campaign's foundry method)

The row brief asks the sharpest question here: pm has *formal* gates (K/T review gates,
auto-transition, stagnation→review) layered on a store; the campaign's method (spec-driven
foundries with red/blue stages) is the de-facto governance layer. Honest comparison:

- **pm's gate is a counter; the campaign's gate is an evidence test.** pm: "K experiments
  without review → block." The campaign: "a proposal lands only when its RED-first pins
  actually fail at HEAD, its red-team blockers are folded, and its suite passes." The
  campaign's gate can be *checked* (re-run the suite, re-read the RED pin); pm's K/T gate
  is opaque to the thing it governs (the counter says nothing about whether the next
  experiment is well-formed).
- **pm's auto-transition is derived truth; the campaign's completion is asserted truth.**
  pm derives "phase complete" from child status; the campaign (and #161 D4) require
  immediate, evidence-linked completion marking. The derived surface is the lie-able one.
- **pm's stagnation detector is a good detector.** Its shape (consecutive evidence-class
  failures) is exactly the evidence-count the campaign could expose as a read-side warning
  without importing a gate (C4).
- **What pm genuinely does better (say it plainly):** the *portfolio read* — an operator
  asking "across everything live, what is the highest-consequence thing to do next?" gets a
  ranked answer from pm (`pm_dashboard`, `pm_next`). Baton's orchestrator must compose
  `waves.list` + the (unlanded) plan object by hand today. A read-side focus-rank
  projection (C2+C6) is the one ADAPT in this lane that would be a *visible* improvement,
  and it is veto-compliant.

---

## 7. Judgment calls and DECISION_REQUEST items

- **C2/C6 ADAPTs are the one-place judgment call.** I folded "impact propagation" and
  "portfolio view" into a single read-side structural-consequence projection because both
  reduce to "rank actionable tasks by downstream-blocked count over the plan object's
  `blockedBy`." If the coordinator prefers them split (a pure plan-object ranking vs a
  waves+plan dashboard), the split is cheap. Not authority-class — a shape choice.
- **#149 "gate digest" has no durable contract in this worktree.** I searched
  `docs/reference/evidence/**`; only this row brief references it. I evaluated the campaign's
  *behavior* (the foundry method) as the gate and said so. If a #149 contract exists
  elsewhere, its landing must be re-checked against C5's REJECT. Recorded, not assumed.
- **DECISION_REQUEST — does the campaign want a landed read-side "next-action" projection?**
  C2/C6 are the only ADAPTs that would *add code* (a read projection over `waves.list` +
  plan). That is an infrastructure addition with an authority gate (a `plan:*`-seat read).
  Options: (a) fold it into the #161 implementation rung (the plan object's read projection
  gains the ranking); (b) defer to a follow-on (the #161 rung stays read/write minimal);
  (c) leave it as a coordinator-documented advisory shape, no code. My lean: (a) — the
  ranking is a small pure function over an existing projection and makes the plan object
  immediately useful to the orchestrator.

---

## 8. Shared-scratchpad publish — recorded refusal

The foundry frame requires publishing this report to the `shared` scratchpad partition
(`foundry-brief.md:27-28`; the #158 publish path). **Attempted and refused at HEAD:**
the agent-facing facade and CLI admit only `run.scratchpad.read` / `run.scratchpad.elevate`
(`application-cli.mjs:30,1476-1508`); there is no `run.scratchpad.append` and no `shared`
write verb on any surfaced channel (verified by grep over `impl/src/application.mjs`,
`application-cli.mjs`, `mcp-northbound.mjs`). The internal `writeScratchpad`
(`coordination-store.mjs:14064`) requires a live worker run handle + fence this worktree
does not possess. This is the same RED gap #163 OQ1 and the #158 drafting record — the
surface write verb is itself the thing #158 is specifying. The durable file is the runtime
handoff. Recorded as campaign evidence per #158.

---

## 9. Verification / deliverable boundary

- Deliverable: `docs/reference/evidence/pm-comparison-2026-08-13/pm-dag.md` (this file).
  Work confined to `docs/reference/evidence/pm-comparison-2026-08-13/**`. No source files
  modified.
- Deployment verification (Baton contract): executable `true`, args `[]`, cwd `.`, expected
  exit code `0`.
- Citations: pm side — `src_dag_mod.rs`, `DESIGN.md`, `TASKS.md`, `src_mcp_tools.rs`
  (digest `.rs` files authoritative). Baton side — `workflow-interpreter.mjs`,
  `wave.mjs`, `task-topology.mjs`, `coordinator.mjs`, `coordination-store.mjs`,
  `application-cli.mjs`, `orchestrator-plan-object-contract.md` (#161 v2.0),
  `stall-watchdog-contract.md` (#67), `contract-163.md` (#163 DRAFT v2). Anchors re-verified
  at the current worktree HEAD (`e371f70`) with grep/sed.
