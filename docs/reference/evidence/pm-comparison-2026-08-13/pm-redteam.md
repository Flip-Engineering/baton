# PM-REDTEAM — what pm knows that baton must refuse to learn

[attempt: 43ea3f5f-c961-47f2-92d6-2d565dab76b4 row-pm-redteam]
[role: row-pm-redteam — the scope-creep red-team]
[wave: pm-comparison-2026-08-13 wave-a, idempotencyKey `pm-comparison-2026-08-13-wave-a`]

---

## 0. Role, sourcing, and the standing vetoes

This row answers the second half of the wave question: *what must baton refuse to learn from
pm?* The first half — what baton should adopt — is the other rows' job (pm-dag, pm-kg); this
row is the rejection gate their proposals and mine must survive. It operationalizes the
standing vetoes from `foundry-brief.md` into a **rejection rubric of eight questions**, then
pre-computes the **trap list** (the pm mechanisms that are traps for baton's architecture,
cited to the authoritative `.rs`/scope digest), then **pre-registers rejections** for the
proposals the rows were expected to make, and finally **applies the rubric to the on-disk
reports** (pm-dag.md, pm-kg.md) per the #174 on-disk law.

Sourcing hierarchy (per `pm-digest/README.md` and the spawn brief): the `.rs` files are
authoritative; the prose docs (DESIGN.md, TASKS.md) are stale-risk and are only used to
confirm *intent*, never to source a mechanism. The `v6-cognitive-augmentation-scope.md` file
is a self-aware inventory and is the authority on the ambient-injection and tool-surface
claims. Baton-side law is cited to `spec/phase11/coordination-knowledge.md` (CK1-CK8), the
`#147` control-surface audit, the `blind-waits` contract, and `docs/08-shared-memory-and-pm.md`.

**The standing vetoes this rubric enforces** (foundry-brief.md, "Baton's standing vetoes"):

1. **No wall-clock controls anywhere** — gates are event/evidence-derived only.
2. **Honesty over comfort** — a surface that can lie is worse than none.
3. **Machine channels stay sterile** — no ambient injection into the worker runtime.
4. **Additive-only on closed vocabularies** — never mutate a closed set in place.
5. **No per-worker heaviness** — shared machinery is hub-managed, never per-worker ceremony.
6. **The methodology chain governs impl** — a proposal lands via contract (RED-first pins),
   not via enthusiasm.

---

## 1. The rejection rubric (eight questions)

Every proposal from a comparison row must survive all eight. Any single **veto** question
answers the proposal outright; the non-veto questions may still **REJECT** it on their own
terms. Verdict scale: **ADOPT / ADAPT / REJECT / ALREADY-HAVE / OUT-OF-SCOPE**, each with a
landing zone (a named baton mechanism or a named refusal).

| # | Question | Veto? | Fail = |
|---|----------|-------|--------|
| Q1 | **Does it need a wall clock?** Any `now()`, `is_stale(ts, days)`, `expires_at` read by a reader clock, idle-timer, time-boxed budget, or "after T hours" review gate — as a *control* (decision input) rather than a labeled read projection? | **veto** | REJECT outright. Baton's gates are event/evidence-derived (CK4 "no reader-clock expiry"; CK1 "replay at different wall times is identical"; blind-waits: "No clocks. The fail-loud law is a per-cycle re-check, never a wall-clock decision."). |
| Q2 | **Does it add a per-worker process/resource cost instead of hub-shared?** A session ceremony, per-worker briefing build, per-worker polling loop, per-worker index? | **veto** | REJECT outright (veto 5). The hub owns shared machinery (CK1 hub-only writes, CK8). |
| Q3 | **Can its surface lie to the orchestrator?** A stored mutable belief/confidence scalar, an auto-derived status that ignores evidence, a heuristic score hiding its reasons, a "fade" that silently deletes? | **veto** | REJECT unless honesty-pinned (hub-derived grounding, candidate-only, labeled projection). |
| Q4 | **Does it mutate a closed vocabulary?** New statuses/beliefs/edge kinds inserted into an existing closed set, or a heuristic writing edges/statuses the operator can't audit? | **veto** | REJECT unless strictly additive, and even additive must clear Q3. |
| Q5 | **Does it duplicate machinery baton already has?** | no | **ALREADY-HAVE** — name the existing mechanism, don't import the pm twin. |
| Q6 | **Does it serve the orchestrator's actual recurring costs — observed in *this* campaign's evidence dirs — or an imagined one?** | no | **REJECT** (imagined). The research-narrative cost is pm's problem, not the fleet's. |
| Q7 | **Is it a methodology bypass** — code-before-contract, a mechanism landing outside the RED-first pin / foundry-gate chain? | no | REJECT pending a contract; the methodology chain governs impl (veto 6). |
| Q8 | **Is it pm-shaped because pm did it that way, with no baton-native reason?** (the "imported ornament" test) | no | REJECT. A pm mechanism imported for its own sake is ornament. If there is a baton-native reason, say what it is and let the rubric's other questions adjudicate. |

The rubric is deliberately **loaded**: three vetoes fire on pm's most distinctive machinery,
because pm is *built* on wall-clock recency, per-curator ceremony, and mutable scalar belief.
The three non-veto questions are the ones that let genuinely useful things through (Q5 names
ALREADY-HAVE, Q6 is the honest-cost gate, Q8 is the ornament filter).

---

## 2. The trap list, pre-computed (cited)

Ten traps. Each names the pm mechanism (cited to the digest), the veto it violates, and the
honest evaluation — where pm was right for *its* problem and why the mechanism is wrong (or
right-but-shaped-differently) for baton.

### T1 — Every time-based gate (the master trap)

- **pm**: `is_stale(ts, days)` wall-clock recency (`src_mcp_dashboard.rs:14-18` — `let now =
  Utc::now().naive_utc(); diff.num_days() >= days`); stale-hypothesis filters at
  `proposed > 7 days` (`:414`, `:908`); constraint `expires_at` "YYYY-MM-DD — pm_review flags
  expired constraints" (`src_mcp_tools.rs:127`); review gates "blocks experiments after K
  experiments **or T hours** without review" (DESIGN.md, intent-confirmed); time-boxed
  evaluation budgets (DESIGN.md, intent); idle detection on tool-call frequency (TASKS.md
  P5.3); `pm_since` ISO-date delta (`src_mcp_dashboard.rs:662-740`); DB timestamps stamped
  `datetime('now')` (`src_store_migrations.rs:72,:270,:281`); the 30s cache + `last-nudge.ts`
  gate on the ambient hook (`v6-cognitive-augmentation-scope.md:118,:168`).
- **Veto**: Q1. Every one of these is a wall-clock *control*. Baton's gates are
  event/evidence-derived: claim expiry is a hub-emitted event slaved to lease/terminal state
  (CK4:142), #67's no-progress-evidence stall is the liveness bound, #161's `blockedBy`/
  `plan_blocked` are structural, and the campaign's foundry method (RED pins + red-team +
  blind-QA) is the review gate.
- **Honest evaluation**: staleness is a legitimate *read* concept — as a labeled projection
  over event-seq age (how long since the last coordination event for this node), not as a
  control, and not `Utc::now()` at read time. A constraint *expiry* is a legitimate domain
  fact, but it must be an explicit `expires_at` **event** appended at write time (the
  `scratch.fact_expired` shape, CK4:139), never a reader clock comparing against the wall.
  pm was right that recency matters; it was wrong that the wall clock is the substrate.
  **Baton-native answer: event-seq age, always.**
- **Pre-computed rejection**: any proposal whose *control* path reads a clock → REJECT. Any
  proposal whose *read* path labels staleness as event-derived → ADAPT with the substrate
  pinned.

### T2 — Per-session heaviness

- **pm**: 5 of 37 tools are session lifecycle (`pm_session_start/init/context/
  set_experiment/end` — `src_mcp_tools.rs:53,:58,:203,:208,:213`). `tool_session_init`
  builds TaskCreate-ready items + stale-hypothesis list + orphaned findings + a knowledge
  briefing per active project (`src_mcp_dashboard.rs:349-479`).
- **Veto**: Q2. A session is a per-curator ceremony for a single long-horizon writer. Baton's
  workers are throwaway and fleet-concurrent; a per-worker session ceremony is per-worker
  heaviness. Baton's downward context is "**push, addressed, minimal**... not a query into a
  shared brain" (docs/08 §3); the "what should run now" primitive is hub-side dispatch
  readiness — "a task is dispatchable iff all `deps` are `completed`" (docs/08 §3), realized
  as `claimTask` CAS + deps-ready (CK2, #161).
- **Honest evaluation**: the *session boundary* is a real concept — a run boundary → Run
  scorecard (CK6:203) — but it is a hub-emitted coordination event, not a worker-invoked
  ceremony.
- **Pre-computed rejection**: any worker-side session ceremony → REJECT (Q2) or ALREADY-HAVE
  (hub-side run boundary).

### T3 — SQLite-local as source of truth vs content-addressed/git-anchored store

- **pm**: SQLite is the truth: `schema_version` + live migrations, `datetime('now')` stamps,
  `modified_at` on every node table, FTS5 tables (`src_store_migrations.rs:72,:260-299`).
  Single-host, live-mutated, single-writer-ish.
- **Veto**: Q3 (a live-mutated DB is a surface the fleet can't replay or merge) and the
  second-store clause of Q5.
- **Honest evaluation — where each is right**: SQLite-as-truth is *right for pm's problem*: a
  single human/agent curating a research narrative over months wants live SQL, no concurrent
  writers, no replay requirement. It is *wrong for baton*: a concurrent multi-writer fleet
  needs hub-single-writer authority (CK1, CK8), replay determinism, crash recovery, and a
  merge story — which is exactly why baton's truth is the append-only `events.jsonl` with
  gap-free global `seq` (CK1:14-18) and content-addressed/git-anchored artifact manifests
  (CK3), with a SQLite/other query index explicitly deferred as **projection only**
  (coordination-knowledge.md "Explicitly later":282).
- **Trap within the trap**: importing pm's FTS5 or a second query store as a *second truth* —
  the #147-adjacent "a second store is a second truth" veto that pm-kg's C10 correctly
  REJECTs. The honest import is pm's *query patterns* (MAD confidence, contradiction
  signals — see T6, T7) as read-time projections over the event ledger, never its storage.
- **Pre-computed rejection**: any "baton should have a SQLite store like pm" proposal →
  REJECT (Q3) unless explicitly a projection-only index (then ADAPT to the deferred rung).

### T4 — Hook-injection ambient noise (with the delta-nudge evaluation)

- **pm**: E#119 — make the existing briefings **ambient via a UserPromptSubmit hook**
  (`v6-cognitive-augmentation-scope.md:14,:111-114`), gated on `PM_INJECT=1` + a 30s cache
  (`:168`, risk table). The hook injects the knowledge briefing into *every prompt*.
- **Veto**: Q3 + machine-channel sterility (veto 3). Baton: "Recall is pull-only...
  nothing is automatically injected into a worker context" (CK5:189), and "Recall remains
  explicit and never auto-injects" (docs/08 §3).
- **The cries-wolf law**: #72's red-team brief pins it — "a warning that cries wolf —
  operators learn to ignore ALL warnings; the catalog must pin the precision law". An
  every-prompt briefing is the wolf-crier: mostly irrelevant, always present, so it trains
  the agent to ignore it. The *surface* isn't the failure; the **precision** is.
- **The delta-nudge answer, evaluated honestly** (my brief demands this): E#127 replaces the
  static dashboard with `pm since --session` — "delta of what changed since the last nudge"
  (`v6-cognitive-augmentation-scope.md:115-118`), tracked via `~/.local/share/pm/last-nudge.ts`
  (`:118`). **The shape is right**: a delta beats a full briefing; "what changed since the
  last thing you saw" is the correct informational unit. But it has two defects:
  1. **Substrate** — `last-nudge.ts` is a wall-clock timestamp, which fails replay
     determinism. Baton's delta is an **event-boundary cursor**: the global `seq` gap since
     the last read (CK1a:29-31 — "global sequence is the observation order"), which replays
     byte-identically. Time-derived delta = T1; seq-derived delta = baton-native.
  2. **Channel** — even a delta-nudge is ambient injection unless gated on *action-relevance*,
     not on elapsed time. The precision law demands the nudge fire only when the delta is
     actionable *for the receiving worker* (a completed dep unblocking its task, an elevation
     candidate for its run) — recipient-addressed, not broadcast.
  - **Verdict**: ADAPT the delta instinct (that's pm-kg C16's shape — an event-boundary delta
    read closing the proven elevation-review gap K5); REJECT the timestamp substrate and
    time-based firing. Never ship the full-briefing UserPromptSubmit hook.

### T5 — The 37-tool surface breadth (tool-count vs discoverability)

- **pm**: 37 tools registered (`v6-cognitive-augmentation-scope.md:22` §1.1; the
  `src_mcp_tools.rs` registry), with heavy semantic overlap: `pm_context`/`pm_query`/
  `pm_search`/`pm_session_context` all retrieve; `pm_review`/`pm_kg_audit`/`pm_orphan_repair`
  all health-analyze; `pm_dashboard`/`pm_next` both answer "what should run now".
- **Baton's #147 audit**: the combined MCP profile is **86 tools** (`control-surface-audit.md:
  150`), with friction findings: command-spelling divergence, "surfaces teach what they
  refuse", discoverability gaps, scriptability split, doc-truth divergence
  (`control-surface-audit.md` unified friction ranking). Tool-count is not capability; every
  tool is a grammar to learn, a refusal mode to discover, a doc to keep truthful.
- **Veto**: Q8 (imported ornament) + Q2 (surface is a per-operator cost the hub must own).
- **Honest evaluation**: pm's 37 tools are the accumulation of one curator's needs over
  months — right for a single-writer tool, wrong as a template for a fleet surface. Baton must
  import *semantics* (typed read projections, typed queries) not *surface*; where a surface is
  needed, it is **one coherent verb family**, not a sprawling registry — the #147 audit's own
  remedy direction (make the MCP default profile a superset of the bus, reduce grammar
  divergence).
- **Pre-computed rejection**: any proposal that adds tools to match pm's breadth without an
  orientation/remedy for the #147 frictions → REJECT (Q8).

### T6 — Stored confidence / belief scalars (the TMS trap)

- **pm**: `pm_set_confidence` / `pm_set_belief` (`src_mcp_tools.rs:218,:223`); v11 migration
  adds `confidence REAL` + `belief_status` defaults (findings 0.5, hypotheses 0.3, principles
  0.8, constraints 0.9 — `src_store_migrations.rs:296-299`).
- **Veto**: Q3. A mutable stored belief scalar is a **surface that can lie** — anyone can set
  belief to 0.9 without evidence, and the scalar decays into an opinion field that the recall
  path will trust. Baton: grounding is hub-derived (`verified | observed | derived | asserted`)
  and "**never taken from a model confidence float**" (CK5:185).
- **Honest evaluation**: statistical confidence is legitimate as a **read-time projection** —
  pm's MAD-based confidence (`src_analysis_confidence.rs`: `|best Δ|/MAD`, HIGH ≥2.0 /
  MODERATE 1.0-2.0 / LOW <1.0) is a genuinely good idea *as a projection* with
  deployment-owned thresholds. What must not ship is the stored, mutable, belief_status field.

### T7 — LLM-in-the-loop writing to the store

- **pm**: Layer-2 contradiction detection is a Claude Code subagent doing "Typed CoT NLI
  classification" (`src_analysis_contradictions.rs:6,:216-217,:288-289`).
- **Veto**: Q3 + replay determinism. Non-deterministic classification cannot write into a
  byte-exact-replay store (CK1) or produce "one unexplained green bit" (CK6:213). Any LLM
  classification must be a **candidate surface** behind a deterministic admission gate — never
  an auto-asserted `Contradicts` edge. (This is exactly pm-kg C2's REJECT of Layer-2.)

### T8 — Recency-weighted retrieval

- **pm**: composite scoring `text 1.0 + evidence 0.2 + recency 0.3`
  (`v6-cognitive-augmentation-scope.md:29,:83`).
- **Veto**: Q1 (a fixed recency weight smuggles wall-clock influence into what the agent sees)
  + Q3 (silently hiding old-but-authoritative nodes is a lie).
- **Honest answer**: event-seq-derived recency (replay-identical) with deployment-owned
  weights, and recall ranking that never silently drops authoritative nodes. Borrow the *shape*
  of composite retrieval; reject the *recency-as-time* term.

### T9 — Staleness-as-deletion ("fade")

- **pm**: unreferenced findings "older than N experiments fade" (DESIGN.md Layer 3, intent).
- **Veto**: Q3. Silent fade is deletion without an admission gate — a surface that lies about
  history. Baton: bitemporal validity — "Invalidated beliefs are never deleted" (CK5:177),
  supersession appends invalidation events, surface-with-age is a read projection, not a
  mutation.

### T10 — The 0-100 health score

- **pm**: `pm_kg_audit` "Returns health score 0-100" (`src_mcp_tools.rs:228-229`).
- **Veto**: Q3 (a single heuristic number hides its reasons; it can be gamed — the number
  rises without anything being fixed) + Q8 (ornament).
- **Honest answer**: baton's `auditKnowledge()` reports each axis **separately** — causal
  completeness, temporal coherence, orphans, contradiction resolution, invalid references,
  recall utility, contamination blast radius — "never one unexplained green bit" (CK6:213).
  Component checks are the truth; the composite is the lie.

---

## 3. Pre-registered rejections

The three comparison rows were expected to propose specific pm mechanisms. This section
pre-writes the rejections **before** reading their reports, so the rubric isn't retrofitted.
Per the #174 on-disk law, pm-dag.md and pm-kg.md exist on disk and are graded in §4; **pm-agent.md
does not exist on disk**, so the pre-registered list below **stands for the agent row** and is
what the coordinator should apply if that report lands post-harvest.

### Expected from the pm-agent row (no report on disk — this list stands)

| Expected proposal (from pm's agent-facing surface) | Pre-written verdict |
|---|---|
| "Inject the knowledge briefing into every worker prompt" (E#119 UserPromptSubmit hook) | **REJECT** — T4: cries-wolf precision law (#72), machine-channel sterility, CK5 pull-only recall. |
| "Give workers a session-init ceremony / what-should-run-now" (`pm_session_init` / `pm_next`) | **REJECT** (Q2 per-worker ceremony) / **ALREADY-HAVE** ("what should run now" is hub-side deps-ready dispatch + `claimTask` CAS, docs/08 §3, CK2). |
| "Add worker-side confidence/belief state" (TMS, `pm_set_confidence`/`pm_set_belief`) | **REJECT** — T6: stored mutable belief = a surface that can lie; grounding is hub-derived, never a model confidence float (CK5:185). |
| "Let the worker query the shared brain by topic mid-turn" (`pm_context`) | **REJECT** — docs/08 §3: downward context is push/addressed/minimal, "not a query into a shared brain"; recall is pull-only with ReadBy logging (CK5). |
| "Auto-route findings to the active experiment" (`pm_research_step` / `pm_session_set_experiment`) | **REJECT** — auto-wiring worker prose into the KG without an admission gate is contamination without a trace; promotion is deterministic candidate generation (CK6:199), auto-link restricted. |
| "Delta-aware stop-nudge" (`pm since --session`) | **ADAPT-with-replacement** — keep the delta instinct (T4), replace the timestamp substrate with a global-seq cursor, gate on action-relevance, never on elapsed time. |

### Expected from the pm-dag row (report on disk — graded in §4)

Review gates (K experiments / T hours) → **REJECT** both halves (T1: T hours = wall clock; K
auto-block = silent counter freezing progress). Time-boxed budgets → **REJECT** (T1). Idle
detection → **REJECT** as auto-action (T4 machine channel), ADAPT only as event-cadence-derived
detection. Auto-scaffold → **REJECT**.

### Expected from the pm-kg row (report on disk — graded in §4)

Stored belief/confidence → **REJECT** (T6). LLM NLI contradiction writing to the store →
**REJECT** (T7). 0-100 health score → **REJECT** (T10). FTS5 → **REJECT** (T3 second-truth).
Auto-repair of orphans → **REJECT** (Q4 mutation without admission).

---

## 4. Rubric applied to the on-disk reports (#174)

Per the #174 on-disk law, both sibling reports exist at HEAD and are graded directly. **pm-agent.md
is not on disk** — the pre-registered list in §3 stands for that row. Each verdict below states
whether it **SURVIVES** the red-team rubric (with any additional condition) or **FAILS**.

### 4.1 pm-dag.md — every verdict survives; two conditions pinned

| pm-dag verdict | Red-team ruling |
|---|---|
| C1 dependency-typed tasks — **ALREADY-HAVE** (task-topology + #161 `blockedBy`) | **SURVIVES.** Q5 names the existing machinery; no veto. |
| C2 impact propagation — **ADAPT** read-side, structural, never a focus-window driver | **SURVIVES**, with two conditions pinned: (a) the ranking is derived purely from the `blockedBy` DAG (downstream-blocked count = structural/event-derived), **never** an operator-assigned impact scalar; (b) read-side advisory only, never a focus-window driver (the report already pins both). T8 note: do not add a recency/priority weight to the ranking. Serves a real orchestrator cost — the "what should run now" read (docs/08 §3). |
| C3 auto-transition — **ADAPT** (unblock ALREADY-HAVE; derive-done REJECT) | **SURVIVES.** The derive-done half is REJECT on honesty (status is asserted with evidence, never derived) — Q3. |
| C4 stagnation detection — **ADAPT** (evidence-count detection yes; auto-forced review no) | **SURVIVES with a condition + a push-back.** Condition: the "N consecutive failures" threshold is a deployment-owned constant (no-arbitrary-limits law), must ride an existing evidence read, and must never become a gate. Push-back: this is the **weakest survivor** — "consecutive failures" is a research-narrative concept (pm's `stagnation_check`, `src_dag_mod.rs:70-96`); baton's fleet-reality liveness is already owned by #67's no-progress-evidence stall, and the report itself notes the landed `loopThreshold` interrupt (`coordinator.mjs:9646-9655`). Keep only as an optional read-only advisory; do not block the continuation on it. |
| C5 review gates — **REJECT** | **SURVIVES as REJECT.** T1 confirms both halves: T hours = wall clock; K auto-block = a silent counter that freezes progress (Q3 + machine-channel control). The foundry method is the gate, and it is evidence-derived where pm's is counter/clock-derived. |
| C6 portfolio view — **ADAPT** read-side, evidence-derived | **SURVIVES.** Same family as C2; read-side, evidence-derived; priority classes additive. The report's honesty (single-repo today → wave/plan focus-rank projection, not a multi-project board) is correct. |
| C7 topological sort — **REJECT** | **SURVIVES as REJECT.** DAG-validity half ALREADY-HAVE (#161 `plan_topology_invalid`); execution order meaningless for a parallel wave roster (Q6 — imagined cost). |
| C8 time-boxed budgets — **REJECT** | **SURVIVES as REJECT.** T1; `wallMin` node bound + #67 stall are the honest backstops. |
| C9 idle detection / auto-scaffold — **REJECT** auto-scaffold, **ADAPT** idle-to-event | **SURVIVES.** Auto-injection into the agent runtime = T4 machine-channel violation; event-cadence-derived idle *detection* (no auto-action) is the honest shape. |

**pm-dag.md verdict: all nine verdicts survive the red-team rubric.** No FAILS. The
continuation should hold C2/C6 (the portfolio/priority read) as the row's substantive positive,
and treat C4 as optional.

### 4.2 pm-kg.md — every verdict survives; one priority push-back

| pm-kg verdict | Red-team ruling |
|---|---|
| C1 typed edges — **ALREADY-HAVE** (superset) | **SURVIVES.** |
| C2 contradiction detection — **ADAPT** Layer-1 deterministic candidate-surfacing, **REJECT** Layer-2 LLM NLI | **SURVIVES.** T7 confirms the Layer-2 REJECT (non-deterministic classification into a byte-exact store). For Layer-1, three conditions: (a) deployment-owned detector weights (the report already flags this as OQ1 — no-arbitrary-limits law); (b) **candidate-only, never auto-assert** — no mutation of `Contradicts` without an admission gate; (c) **priority push-back**: contradiction detection serves a *proven* cost only when the knowledge plane is populated — the channel-audit shows the plane is nearly write-only (13 scratchpad entries, zero promotions, activation gap K1). The mechanism is correct but **lower-priority than shipping KG-3 activation**; detection on an empty graph is machinery with no consumer. The report's own framing — "the real finding is activation, not representation" — is agreed and should be the continuation's headline. |
| C4 confidence/belief — **ADAPT** MAD read-time projection, **REJECT** stored confidence/belief | **SURVIVES.** T6 strongly confirms: read-time MAD projection with deployment-owned thresholds is the honest import; stored belief_status is the trap. |
| C6 auto-link — **ALREADY-HAVE** | **SURVIVES.** |
| C7 briefing — **ADAPT** (fail-open marker, providerBrief seam, **no ambient hook injection**) | **SURVIVES.** T4 confirms; the "do not borrow hook-script/stderr distribution" exclusion is exactly the machine-channel veto. |
| C8 temporal versioning — **ALREADY-HAVE** / REJECT pm's `modified_at` | **SURVIVES.** T1 + bitemporal validity (CK5:177). |
| C10 FTS5 — **REJECT** | **SURVIVES as REJECT.** T3: a second store is a second truth. |
| C14 kg_audit 0-100 score — **REJECT** | **SURVIVES as REJECT.** T10: a heuristic score hides its reasons; component checks ALREADY-HAVE (CK6 separate-axes audit). |
| C15 orphan detection — **ADAPT** read-only advisory, **REJECT** auto-repair | **SURVIVES.** Auto-repair mutates the KG without an admission gate (Q4). |
| C16 since/delta read — **ADAPT** event-boundary delta as elevation-review queue | **SURVIVES — the strongest ADAPT on either report.** T4's delta evaluation lands here: event-boundary (global seq), never ISO date; rides a *proven* gap (channel-audit K5, no "awaiting elevation" surface). |
| C17 grouped-by-kind context — **ADAPT** (minor) | **SURVIVES.** Presentation refinement, not mechanism. |
| C18 auto-routing — **OUT-OF-SCOPE** (agent row's lane) | **Confirmed.** See §3's pm-agent rejection for the routing proposal. |
| C19 single-node traversal — **ALREADY-HAVE** (`causal.trace`) | **SURVIVES.** |

**pm-kg.md verdict: all verdicts survive the red-team rubric.** No FAILS. The continuation
should hold C16 as the row's strongest positive and re-order C2 behind KG-3 activation.

### 4.3 What the rubric adds that the sibling reports did not

1. **The activation-first push** (C2/kg): a mechanism is only worth shipping if its *input*
   plane is populated. Both reports under-weight this; the channel audit proves the knowledge
   plane is nearly write-only.
2. **The recency-term veto** (T8): composite retrieval must not smuggle a time-weighted term
   into what the agent sees; the sibling reports ADAPT composite scoring but the recency term
   itself is the thing to refuse (or make seq-derived).
3. **The delta-nudge verdict** (T4/C16): the honest evaluation is ADAPT-the-instinct /
   REJECT-the-substrate — event-seq cursor, action-relevance gate, never `last-nudge.ts`.
4. **The orphan-threshold pin** (C4/dag): any "N consecutive" constant is deployment-owned,
   never a hardcoded control.

---

## 5. Judgment calls (recorded per the spawn brief)

- **J1 — C4 (pm-dag) is the weakest survivor.** Judgment: keep the consecutive-failure warning
  only as an optional read-side advisory; do not let it consume continuation budget. It is
  adjacent to the landed `loopThreshold` interrupt and to #67; its marginal value is low.
- **J2 — contradiction detection (C2/kg) is correct-but-deferred.** Judgment: ship KG-3
  activation first; the deterministic detector is the follow-on. Agree with the report's own
  framing.
- **J3 — the delta-nudge verdict (T4).** Judgment: ADAPT the instinct (delta over full
  briefing), REJECT the substrate (timestamp) and the channel (broadcast). This is a
  two-thirds rejection — the most nuanced verdict in this report.
- **J4 — surface minimum.** Judgment: any future baton surface should expose **one verb
  family**, not pm's 37-tool registry; tool-count is the #147 audit's top friction.
- **J5 — no authority-class ambiguity was left open.** Every proposal in this report has a
  named verdict and landing zone or refusal; no DECISION_REQUEST is required.

---

## 6. The shared publish (attempt + exact refusal — #158)

The foundry frame requires publishing this report to the `shared` scratchpad partition
(foundry-brief.md; the #158 publish path). **Attempted and refused at HEAD:**

1. **No write verb exists on any surface.** The CLI scratchpad family is **read + elevate
   only** (`impl/src/application-cli.mjs:30` — `'run.scratchpad.read',
   'run.scratchpad.elevate'`; `:1476-1508` dispatches only those two actions). There is no
   `run.scratchpad.write` and no `run.scratchpad.append`.
2. **First-hand attempt**: `node impl/scripts/baton.mjs run scratchpad write run:1 --scope
   shared --body "pm-redteam publish attempt"` → **`cli_invalid: unexpected argument write`**
   (recorded at HEAD in ws-28a4bf, this session).
3. **Even a direct write cannot target `shared`**: `writeScratchpad` hardcodes
   `const scope = \`worker:${fields.workerId}\`` (`impl/src/coordination-store.mjs:14103`);
   a directly-invoked write is worker-scoped by construction.
4. **No MCP/web write verb either**: the #147 audit records "the shared scratchpad has no
   write verb on CLI/MCP-app — the wave's own handoff lane is read-only" and "the CLI has no
   write verb" (`control-surface-audit.md:22,:191`).

**Outcome**: a `shared` publish is structurally impossible from a member — the #158 gap,
reproduced first-hand. The durable file at
`docs/reference/evidence/pm-comparison-2026-08-13/pm-redteam.md` is the runtime harvest
artifact and the only faithful up-channel record.

---

## 7. Deployment verification

Per the execution contract, the verification command is executable `true`, args `[]`, cwd `.`,
expected exit `0`:

```text
$ true
exit 0
```

The deliverable file exists at the harvest path with the required `pm-redteam` substring and
the attempt line verbatim in the first five lines.
