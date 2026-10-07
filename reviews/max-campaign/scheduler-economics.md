# Max-campaign stream: scheduler-economics

## DESIGN
# The Scheduler & Economics Engine

*baton's dispatch and cost-governance plane. Designed against the corpus it's mentioned in but never specified: the thing that makes a heterogeneous fleet actually **run** under real vendor constraints. It sits beside the supervisor state machine (`spec/supervisor-state-machine.md`) as the second non-LLM authority in the hub — the supervisor guarantees liveness and safety; the scheduler decides **placement and spend**. The governing principle mirrors the supervisor's: **the LLM orchestrator submits work; it does not schedule it.** Dispatch under a hard concurrency ceiling, a moving price, and an adversarial vendor is a liveness/economics property that cannot depend on a stochastic model choosing wisely.*

---

## 0. Where this sits, and what it is not

The corpus already decided the boundary and kept re-deciding it:

- doc 01 §7 line 65: *"per-vendor concurrency ceilings belong in the harness card and the scheduler, not in retry loops; peak-hour multipliers argue for time-aware dispatch; the fleet must degrade gracefully to fewer seats when a vendor tightens."*
- doc 06 Q6 line 65: *"Quota/rate-limit → per-vendor backoff + reroute to another seat + budget event"* (not a retry storm).
- doc 07 line 43: *"reroute is a headroom-checked scheduler decision, not a retry cascade."*
- doc 14 #12/#29: **route by difficulty and mode, not just vendor** — "a bigger cost lever than cross-vendor arbitrage, and nobody's economics model includes it."
- doc 13 T6 + doc 11 module 7: the cross-vendor-unique economics value is **learned comparative-advantage routing (`RouteStat`, 1×)**, fed only by I7 outcomes — and *"most fleets should stop at the scorecard."*

Every piece is named; none is built. This doc builds it as one component.

**What it is not.** It is not a general-purpose cluster scheduler, and — critically — **at baton's real scale (N = 3–10 workers) most of it is not a hard problem.** Bin-packing, the generalized assignment problem, job-shop scheduling: these are the textbook framings, they are NP-hard in general, and they are **irrelevant here** — at N ≤ 10 a greedy priority dispatch is optimal-enough and I will say so wherever it applies. The honest novelty is narrow and lives in four places (§9). Everything else is composition of known mechanisms, cited as such.

---

## 1. The problem, precisely stated

The scheduler is handed, continuously:

1. A stream of **ready work items** — units of work whose DAG dependencies are satisfied (§7), each carrying a brief, a verification (DoD), a difficulty/mode hint, a criticality, and a budget cap.
2. A set of **resource pools** — one per vendor-auth identity, each with a **hard, externally-set, possibly-shrinking-without-notice** concurrency ceiling and quota (Z.ai Pro ≈ **1 in-flight**; Lite ≈ 1; Max ≈ 2+; quota Lite ~80 / Pro ~400 / Max ~1600 prompts per 5h — doc 01 §7).
3. A **price that moves with wall-clock time** (GLM-5.2/Turbo: **3× during 14:00–18:00 UTC+8**, 2× off-peak — doc 01 §7).
4. A **budget** (fleet → task → turn) it must not exceed, and whose *shape* is a diagnostic signal (doc 14 #19).
5. A **routing signal** — hub-verified win/loss per (harness × task-class × difficulty), the `RouteStat` table (doc 11), fed **only** by I7 outcomes, never worker self-report.

It must produce, online, a placement decision per work item: **which engine (deterministic tool / fast model / standard / reasoning / plan), which vendor, which seat, now or deferred** — maximizing expected *hub-verified* value per dollar-and-token, subject to the ceilings never being violated, control ops never queuing behind data, and the budget being a hard wall.

Stated this way it decomposes into six sub-problems, four of which are textbook and two of which are baton-specific:

| Sub-problem | Nature | Known lineage |
|---|---|---|
| Concurrency-ceiling-aware dispatch | **Known** — bounded resource pool | counting semaphores; k8s `ResourceQuota`; Sidekiq/Nomad concurrency limits |
| Quota (prompts/window) | **Known** — rate limiting | token-bucket / sliding-window counter |
| Ready-work DAG pull | **Known** — list scheduling | HEFT list-scheduling; Cilk work-stealing; critical-path priority |
| Backpressure & priority lane | **Known** — QoS | weighted-fair-queueing; priority preemption |
| Peak-hour deferral | **Known-adjacent** — deferrable-load scheduling | time-of-use / demand-response scheduling |
| Difficulty + comparative-advantage routing | **Known-adjacent (ML systems)** | LLM cascades (FrugalGPT, Chen et al. 2023); model routers (RouteLLM, LMSYS 2024; NotDiamond; Martian); contextual bandits (LinUCB, Li et al. 2010; Thompson sampling); Wilson score interval |

The genuinely novel composition — the part no off-the-shelf scheduler gives you — is in §9. The rest is engineering discipline applied to a fleet of coding agents.

---

## 2. Objects & schemas

The scheduler is a deterministic module owning three tables and a clock. Everything it decides is a ledger event (so it's replayable and auditable, doc 04 principle).

```jsonc
// A unit the orchestrator submits. It is DATA (a brief); the dispatch of it is CONTROL.
WorkItem = {
  id, task_id,                       // task_id groups the DAG this belongs to
  brief, verification,               // DoD — what the hub re-runs (I7); pinned by human/orch, never worker-adjacent (doc 13 T5)
  deps: [work_item_id],              // DAG edges; item is READY iff all deps terminal-verified
  class: "auth-refactor|test-fix|greenfield|…",   // task-class key for RouteStat
  difficulty_hint?: "mechanical|boring-middle|standard|hard",   // orchestrator's guess; scheduler may override, I7 corrects
  mode_hint?: "deterministic|fast|standard|reasoning|plan",
  criticality: "critical-path|normal|deferrable",  // drives peak-deferral & priority
  budget: { usd_cap?, tok_cap?, turn_cap? },       // hard admission wall
  deadline?: ts,                     // if deferrable, latest dispatch time
  lane: "data"                       // ALWAYS data. Control ops never become WorkItems (§6)
}

// One per vendor-auth identity. The hard-ceiling authority.
ResourcePool = {
  id: "zai:pro:<acct>",              // keyed by auth identity, not vendor — two accounts = two pools
  ceiling: u32,                      // concurrency_ceiling from harness card; DYNAMIC (§4.2)
  in_flight: u32,                    // leased seats currently working
  quota: { window_s, budget_prompts, spent, resets_at },   // sliding-window prompt quota
  price: { base_usd_per_mtok_in, base_usd_per_mtok_out, peak_multiplier_schedule },
  usage_fidelity: "high|degraded",   // from card; gates whether we trust token-cost or fall back to prompt-count
  auth_posture: "subscription|api_key",
  tos_class: "flat-subscription|metered-api|published-tiered"   // §10 — governs how aggressively we may pack
}

// The routing signal. A bandit table, fed ONLY by I7 (spec capability-plane §6; doc 11).
RouteStat = {
  key: (harness, model, mode, class, difficulty),
  wins, losses,                      // hub-VERIFIED task outcomes — never worker self-report
  wilson_lb,                         // Wilson lower bound (small-sample-honest point estimate)
  cost_median_usd, cost_p90_usd,     // for the cost term & anomaly baseline
  last_seen, sample_n
}
```

A **Seat** is a leased slot in a pool. It is fenced exactly like a worker lease (supervisor I1): `Seat = { pool_id, worker_id, fence, acquired_at }`. Reassigning a seat bumps the fence, so a stale dispatch cannot splice into a seat that's been reclaimed — the same defense the supervisor uses for stale steers, applied to placement.

---

## 3. The dispatch pipeline (per ready work item)

A ready item flows through six stages. Stages 0–4 are pure functions over the tables (cheap, deterministic, no model call); stage 5 mutates pool state under a lock.

```
                     ┌─────────────────────────────────────────────────────┐
  ready WorkItem ──► │ S0 orchestrate?  │ S1 difficulty │ S2 candidates │   │
                     │ (null-hyp gate)  │ + mode class  │ (card filter) │   │
                     └────────┬─────────┴───────┬───────┴──────┬────────┘   │
                              │ NO fan-out       │              │            │
                              ▼                  ▼              ▼            │
                        soloist / defer   engine class    [(h,m,model)…]     │
                              │                                 │            │
                              │      ┌──────────────────────────┴─────────┐  │
                              │      │ S3 comparative-advantage select    │  │
                              │      │   RouteStat bandit (Wilson/Thompson)│  │
                              │      └──────────────┬─────────────────────┘  │
                              │      ┌──────────────┴─────────────────────┐  │
                              │      │ S4 cost/peak/budget score           │  │
                              │      └──────────────┬─────────────────────┘  │
                              └─────────────────────┤                        │
                                                    ▼                        │
                                     ┌──────────────────────────────┐        │
                                     │ S5 seat admission            │◄───────┘
                                     │  semaphore + quota + budget  │
                                     │  → dispatch | queue | reroute│
                                     └──────────────────────────────┘
```

### S0 — Orchestration admission (the null-hypothesis gate)

**doc 14 #22 as a scheduler stage.** Before fanning anything out, ask: *does orchestration help this item, or should one good agent (or one deterministic tool) just do it?* The coordination tax (fragmentation, context poison, flow disruption) is often *net-negative*, and *"for a large class of tasks the answer is just let one good agent do it."* Concretely:

- If `class` has a `RouteStat` history where the **soloist baseline** (recorded as a pseudo-harness `solo:<best-vendor>`) beats the fanned-out fleet on cost-adjusted verified pass-rate → **route to soloist**, skip the fleet machinery.
- If the item is `difficulty=mechanical` → it never touches a model (S1 catches it, but S0 short-circuits the whole question).
- Otherwise proceed to fan-out.

This gate is the scheduler's honesty valve. It is also the one place the economics engine can *lose* — and it should, whenever the ledger says fanning out doesn't pay.

### S1 — Difficulty & mode classification (doc 14 #12, #29)

Map the item to an **engine class** *before* choosing a vendor. This is the bigger cost lever than vendor arbitrage, and it's the stage everyone skips.

| Class | What it is | Routed to | Model turns |
|---|---|---|---|
| `mechanical` | rename across 40 files, import fixups, fixture regen | **deterministic capability** (ast-grep/comby, `cost_model: cpu_bound_local`) | **zero** |
| `boring-middle` | bulk change needing light judgment | **fast/cheap model** (glm-turbo, haiku-class) | many cheap |
| `standard` | ordinary feature/fix | standard model | normal |
| `hard` | subtle bug, cross-cutting design | **big model + reasoning mode** | few, expensive |
| `plan` | decompose the task itself | big model, plan mode, once | one |

MVP classifier is **rule-based**: signals from the brief (verb — "rename/apply/regenerate" → mechanical; "why does X fail" → hard), the diff scope the DAG node touches, whether a structural rewrite tool can express it. It does not need a model. **The I7 outcome corrects it**: an item classified `boring-middle` that the hub-verified fails and then succeeds only on a reasoning-mode retry writes back `difficulty=hard` for that `class` — the classifier learns from verified reality, not from the guess. Misclassification is cheap to detect (it fails verification) and self-correcting; a `hard` item mislabeled `boring-middle` costs one wasted cheap round-trip, which is exactly the tier you can afford to waste.

**Mechanical → no model at all** is the single highest-value routing decision in the system and the one the vendor-obsessed framing misses. Most of a real task is the boring middle.

### S2 — Candidate set (harness-card filter)

For the engine class, enumerate `(harness, model, mode)` tuples that (a) the card says can serve it (native mode support, model available), (b) have a pool with usable auth *right now*, (c) aren't declared-unsupported. This is a cheap capability-negotiation lookup — the card's whole reason to exist (`spec/adapter-contract.md`). A `reasoning`-mode requirement drops harnesses whose card lacks it; a `steer`-dependent item deprioritizes `steer:emulated` harnesses if the brief needs mid-flight redirection.

### S3 — Comparative-advantage selection (the RouteStat bandit)

Among candidates, pick by **hub-verified strength for this exact `(class, difficulty)`** — doc 06 Q9's "empirical strength, otherwise it's vibes-based dispatch," made real by feeding it *only* I7 outcomes.

- **Exploit**: score each candidate by `wilson_lb(wins, losses)` — Wilson lower bound is the right small-sample estimator (it doesn't over-trust a 2/2 record). This is the un-vendorable 1× value doc 13 T6 kept.
- **Explore** (later tier): Thompson sampling over Beta(wins+1, losses+1), or UCB1, to keep probing under-sampled candidates so the table doesn't ossify on an early lucky win. Contextual-bandit lineage (LinUCB); the "context" is the task-class features.
- **Cold-start**: with no history, seed priors from (i) the harness personality profile (doc 14 #9 — "does it over-engineer? under-test?"), (ii) a cheap public-benchmark prior, (iii) uniform. First K items in a class are explicitly *exploration you pay for* — and per doc 11 module 7, **if the class never recurs, you never recoup it, so most fleets should run exploit-only on static priors and skip the bandit entirely.** The bandit is earned by task-class recurrence.

The load-bearing tie: **this signal is the Referee's output.** `wins/losses` come from `spec/capability-plane.md §6` `reverify` / supervisor I7 — the hub re-ran the verification and observed the outcome. A worker cannot route itself into favor by self-reporting success (red-team `adversarial-worker` A5). Comparative-advantage routing *without* I7 is exactly the vibes-based dispatch doc 06 warned against; **with** I7 it is baton's one durable cross-vendor economics lever.

### S4 — Cost / peak / budget scoring

Convert "strongest" into "best value now." For each surviving candidate:

```
expected_value   = wilson_lb                                    // P(hub-verified success)
expected_cost    = cost_median_usd(key) × peak_mult(pool, now)  // time-aware price
peak_mult(pool, now): look up pool.price.peak_multiplier_schedule against wall-clock
                       (Z.ai: 3× if 14:00–18:00 UTC+8 else 2× off-peak base; API-key pools flat)
score            = expected_value / (expected_cost + ε)         // verified value per dollar
```

Then the **deferral decision** (deferrable-load scheduling): if `criticality == deferrable` and `peak_mult > 1` and `deadline` allows waiting until the multiplier drops → **hold the item in the pool's deferred queue** and re-admit off-peak. Critical-path items (§7) dispatch regardless of price — you don't delay the bottleneck to save 30%. This is textbook time-of-use load shifting; the only baton-specific part is that the "load" is a coding turn and the "meter" is a vendor's published peak window.

**usage_fidelity gate**: if the chosen pool's card says `usage_fidelity: degraded` (Z.ai's token/cost reporting is unverified — `spec/adapter-contract.md` line 69), the cost term is **not trusted in dollars**; the scheduler falls back to the **prompt-count quota model** (1 prompt ≈ 15–20 invocations, doc 01) as the spend proxy. The economics engine degrades to counting prompts against quota for exactly the vendor with the tightest constraint — honest, and safe.

### S5 — Seat admission (the hard constraint)

The only stage that mutates shared state; runs under the pool lock.

```
admit(item, chosen_pool):
  # 1. HARD ceiling — a counting semaphore. This is where Z.ai Pro ≈ 1 lives.
  if pool.in_flight >= pool.ceiling:            return QUEUE_OR_REROUTE
  # 2. HARD quota — sliding-window prompt budget
  if pool.quota.spent + est_prompts(item) > pool.quota.budget_prompts:
                                                 return QUEUE_OR_REROUTE (until quota.resets_at)
  # 3. HARD budget admission (pre-turn, doc 05 §thresholds)
  if est_cost(item.next_turn) > remaining_budget(item.task, fleet):
                                                 return BUDGET_STOP   # → worker gets "conclude & escalate" (doc 14 #28)
  # 4. all pass → lease a fenced seat, spawn/attach worker, decrement, ledger event
  seat = pool.lease(worker_id, fence); pool.in_flight++; pool.quota.spent += est_prompts
  emit ledger: scheduler.dispatch{item, pool, seat, score, peak_mult, route_reason}
  return DISPATCHED

QUEUE_OR_REROUTE:
  # headroom-checked reroute — NOT a retry storm (doc 07 line 43)
  next = best remaining candidate with a FREE seat and passing quota/budget
  if next and next.score >= chosen.score × REROUTE_THRESH:  admit(item, next.pool)
  else: enqueue(item) in the pool's priority queue (ordered by criticality, then DAG-critical-path, then age)
        # freed on seat release / quota reset / peak rolloff — event-driven, never a spin loop
```

Three hard walls (ceiling, quota, budget), one soft optimization (reroute vs queue). **The ceiling is never violated** — that's the semaphore's whole job, and it's why Z.ai Pro ≈ 1 is a scheduler *input*, not a retry concern: the fleet with one Z.ai Pro seat simply runs one GLM worker and queues the rest, or reroutes them to a Claude/Codex pool with headroom.

---

## 4. The concurrency & quota model in detail

### 4.1 Two independent constraints, both hard

A free seat does **not** imply available quota, and vice-versa. Z.ai Pro gives you 1 in-flight *and* ~400 prompts/5h — you can be seat-free but quota-exhausted (all 400 spent in 3h), or quota-rich but seat-blocked (1 slot, 3 items ready). The scheduler models both as separate gates (S5 steps 1 and 2). This is a **counting semaphore × token-bucket** product — both textbook, both trivially correct at this scale.

### 4.2 The ceiling is dynamic and the vendor is adversarial

The one genuinely uncomfortable part (§9c). `concurrency_ceiling` is **not stable**: the opencode #8618 issue documents Z.ai Pro dropping from 3 → 1 in-flight *without notice* (doc 01 §7). So the pool's ceiling is a **learned, monotone-cautious estimate**, updated from three signals:

- `account/rateLimits/read` push (Codex adapter surfaces this natively — `spec/adapter-contract.md` line 43: "the scheduler learns ceilings without probing").
- Observed **429 / rate-limit events** in the ledger → immediately lower `ceiling` to `in_flight − 1` and stop admitting.
- Successful concurrent completions → *cautiously* raise the estimate, never above the card's stated tier max.

Crucial degrade rule (doc 01 line 65): **when the ceiling drops below current in-flight, the scheduler does NOT kill in-flight workers.** It stops admitting and lets the fleet drain to the new ceiling. Killing to meet a shrunk ceiling would waste in-flight verified progress and violate the coherence-cost principle (§9d). The fleet "degrades gracefully to fewer seats" — exactly the corpus's stated requirement. This makes the scheduler an **online player against an adversary who can change the rules mid-game**; the only honest posture is conservative admission + graceful drain, and there is no clever algorithm that beats "don't over-commit against a limit that can shrink."

### 4.3 Seats are fenced (I1 integration)

A seat lease carries the `(worker, turn_epoch)` fence. Reassigning a seat after a worker stops requires the worker to be **confirmed stopped and its worktree lease released** (supervisor I6 two-phase stop) — the scheduler cannot hand a seat to a new worker while the old one is `stopping` (might still be writing files). Reroute therefore *waits on the supervisor's drain*, not on a timer. The scheduler and supervisor share the fence authority; placement and liveness are the same lease.

---

## 5. Budget: admission wall + diagnostic signal

Budget is hierarchical: **fleet → task → turn**. Two distinct uses, both from doc 05/doc 14 #19:

**As a wall (admission control).** Pre-turn: `est_cost(next_turn) ≤ remaining`. Thresholds at 50/80/100% emit `resource.budget.threshold_crossed` (already in doc 05 §1). At 100% the scheduler **refuses to admit the next turn** and the worker receives the "conclude and escalate" move (doc 14 #28 negative capability) — a *judgment-based* clean stop with a partial-delivery result (doc 14 #3: `progress: 0.8` + `blocker` + salvageable artifacts), **not** a mid-thought kill. Budget-as-limit is the crude floor; it should never be the only way the fleet stops.

**As a signal (cost anomaly, doc 14 #19).** The scheduler keeps `cost_median` / `cost_p90` per `class` (it's in `RouteStat` already). A task at **> N× its class median** emits `resource.cost.anomaly{task, spike_turn, ratio}` — a *diagnostic surfaced to the operator*, not just a budget event. A 5× task is a bug report: the agent looped, over-explored, or fought the harness. Cheap to compute (the ledger has every token), and it points the operator at exactly the runs worth the narrative (doc 14 #16). Budget-as-limit is a floor; **cost-shape-as-diagnostic is the interesting half**, and it costs almost nothing to add once you're tracking medians for routing anyway.

---

## 6. Backpressure & the priority lane

The supervisor already defines two lanes (`spec/supervisor-state-machine.md §4`): priority (`lifecycle/control/approval/health/resource.budget.threshold`) vs bulk (coalescible deltas). The scheduler **inherits and extends** this with one rule:

> **Control ops are never WorkItems.** `fleet_interrupt`, `fleet_approve`, `fleet_kill`, a human takeover — these go **direct to the supervisor**, bypassing the scheduler's queues entirely. The scheduler queues only `lane: "data"` work items. A stop verb never waits behind a queued dispatch.

This is the two-channels-never-fused rule (doc 10 §1, doc 13 T5) at the scheduling layer: **steering/control is a preemption, not a scheduled job.** Concretely, the scheduler exposes no path by which admitting a data work item can delay a control op — they are different queues with different owners (scheduler vs supervisor), and control always wins. Within the data queue, ordering is `criticality → DAG-critical-path-membership → age` (a bounded WFQ-style discipline so a deferrable item can't starve a critical one, and a long-waiting item eventually rises).

---

## 7. The ready-work DAG pull

Work items form a DAG (deps). The scheduler **pulls ready items** (all deps terminal-and-hub-verified) rather than the orchestrator pushing a fixed plan — this is list-scheduling / work-stealing lineage (Cilk, HEFT), and at N ≤ 10 the greedy critical-path-first heuristic is fine; no ILP needed.

- **Readiness** is gated on **I7-verified** completion of deps, not worker-reported completion. An item whose dep "passed" only per worker self-report is **not ready** until the hub re-ran the dep's verification. This threads the Referee through the DAG: the fleet cannot make forward progress on unverified foundations.
- **Critical-path priority**: compute the longest verified-cost path to the task's terminal node; items on it get dispatch priority and are exempt from peak-deferral (§4). This is the one place a scheduling heuristic (critical-path-first) measurably matters — it's the difference between the bottleneck vendor's single seat serving the critical item vs a deferrable one.
- **Fan-out is DAG-shaped, not fixed-N**: the orchestrator submits a DAG; the scheduler decides how many workers to actually run based on ready-width × available seats × the S0 gate. If only one Z.ai seat exists and three items are ready, it runs one on Z.ai and reroutes/queues the other two — the fleet's parallelism is *emergent from available seats*, exactly per the CLAUDE.md "let resource availability be the natural throttle, no arbitrary numeric limits" discipline.

---

## 8. Worked example

**Task:** "Refactor `auth` to rotate refresh tokens; a subtle expiry bug exists." Orchestrator (a Claude Code CLI) submits a DAG to `fleet_submit`. Fleet has three pools: `anthropic:max` (ceiling 3, api-key-fallback, flat price), `openai:codex` (ceiling 2), `zai:pro` (**ceiling 1**, quota ~400/5h, **peak 3× — and it's 15:30 UTC+8, mid-peak**, `usage_fidelity: degraded`). Wall-clock: peak.

Submitted DAG:

```
n1 plan ─┬─► n2 rename `validateToken`→`validateAccess` across 41 files
         ├─► n3 update 6 call-sites w/ new signature (light judgment)
         └─► n4 fix the expiry bug (subtle)
                        └─► n5 verify suite (DoD: `mise exec -- mix test`)
```

Scheduler trace:

| Item | S0 fan-out? | S1 class | S2 candidates | S3 route (RouteStat) | S4 cost/peak | S5 admission |
|---|---|---|---|---|---|---|
| **n1 plan** | yes | `plan` (hard, 1 turn) | claude-opus/reasoning, codex/high | claude-opus wins auth-plan class (wilson .81 vs codex .74) | flat (Anthropic api-key), no peak | seat on `anthropic:max` |
| **n2 rename** | **no — mechanical** | `mechanical` | **ast-grep** (deterministic capability, `cpu_bound_local`) | n/a | **$0, zero model turns** | runs in the capability plane, **no seat, no vendor** |
| **n3 call-sites** | yes | `boring-middle` | glm-turbo/fast, haiku/fast | glm-turbo cheapest-competent for this class | **glm × 3 peak** → cost term inflated; deferrable? **n3 is critical-path (n5 waits on it) → dispatch anyway** | `zai:pro` ceiling=1 **free** → seat; quota decremented; degraded fidelity → counted as prompts not $ |
| **n4 expiry bug** | yes | **`hard`** | claude-opus/reasoning, codex/high | codex wins `hard-bug` class historically (wilson .69 vs opus .61) — **comparative advantage: route the hard bug to Codex** | flat | seat on `openai:codex` |
| **n5 verify** | — | hub-run (I7) | — | — | — | hub re-executes `mise exec -- mix test` in a fresh sandbox; **not a worker seat** |

Observations this example is designed to show:
- **n2 never touched a model** — the single biggest saving, invisible to any vendor-only economics model (doc 14 #12).
- **n4 went to Codex, not the "best" model** — because I7-verified history says Codex is comparatively stronger on hard auth bugs; that's the un-vendorable 1× lever (doc 13 T6), and it's trustworthy only because the win/loss came from hub re-runs, not Codex's self-report.
- **The single Z.ai seat was the scarce resource** — n3 got it because it's on the critical path; had a *deferrable* GLM item also been ready, it would have been **held until 18:00 UTC+8** to dodge the 3× multiplier.
- **Nothing violated ceiling 1** on Z.ai — the semaphore is the whole mechanism; "Pro ≈ 1 in-flight" was an input, not a crisis.
- **Every decision is a ledger event** (`scheduler.dispatch{route_reason, peak_mult, score}`) — the operator's narrative (doc 14 #16) is generated from these: *"n4's expiry bug routed to Codex (stronger here per 12 verified priors); n3 took the only GLM seat; a deferrable doc-gen job is parked until peak ends at 18:00."*

Now suppose mid-run Z.ai drops to 429s (ceiling → 0). The scheduler stops admitting to `zai:pro`, lets n3 **drain** (no kill), and any queued GLM items **reroute** to `anthropic:max` (headroom 2) if their S3 score there clears `REROUTE_THRESH`, else queue until `quota.resets_at`. The fleet degrades to two vendors gracefully — the corpus's stated requirement, delivered.

---

## 9. What's actually novel here (be honest)

Four things are baton-specific; the rest is composition of the cited textbook/ML-systems mechanisms in §1. I claim novelty **only** for:

**(a) The routing signal is I7 hub-verified win/loss — not benchmarks, not self-report.** Every model-router in the wild (RouteLLM, NotDiamond, Martian) routes on a *predicted* quality signal trained offline. baton routes on `RouteStat` counters that are incremented **only** when the hub itself re-ran the verification and observed the outcome (`spec/capability-plane.md §6`, supervisor I7). You cannot game your way into a good route. This is the economics engine welded to the Referee — and it's the one durable, un-vendorable cross-vendor lever the whole corpus keeps landing on. Without I7 it's vibes; with I7 it's the moat.

**(b) Joint difficulty × mode × vendor routing where "mechanical → no model" is a first-class route.** The field anchored "multi-agent" to "multi-vendor" and missed that the boring middle — routed to a deterministic tool at $0 — is a bigger cost lever than vendor arbitrage (doc 14 #12/#29). The scheduler's S1 stage centering *engine class before vendor* is the novel bit; the routing *within* a class is standard bandit work.

**(c) The ceiling is an adversarial, online, un-notified input.** Standard schedulers assume fixed or self-owned capacity. baton's capacities are set by a counterparty who can (and did — opencode #8618) shrink them mid-run without notice. There's no clever algorithm that "wins" this; the honest design is conservative admission + graceful drain + learned-cautious ceiling estimation (§4.2). Naming it as adversarial-online rather than pretending it's a static bin-pack is the contribution.

**(d) Coherence-cost accounting (doc 14 #2).** The budget model prices tokens spent; it does *not* yet price **in-flight reasoning destroyed by a reroute/preempt.** When the scheduler decides to move work off a shrinking pool, it should prefer nudge-at-seam over hard-interrupt and count discarded in-flight tokens as a real cost against the reroute's benefit. This is a genuinely under-measured cost and I flag it as a refinement, not MVP — but it's the kind of accounting no existing scheduler does because no existing scheduler's "jobs" have coherent in-progress *thought* to waste.

Everything else — the semaphores, token-buckets, WFQ lanes, critical-path list-scheduling, peak-deferral, Wilson/Thompson selection — is known and should be *built as known*, boringly and correctly, not dressed up.

---

## 10. Integration with the existing planes & invariants

The scheduler floats beside nothing; every edge lands on an existing invariant:

- **Supervisor I1 (fencing)**: seat leases carry the turn-scoped fence; reassignment bumps it — stale dispatch can't splice into a reclaimed seat.
- **I3/I4 (cursors, bounded poll)**: scheduler decisions are ledger events consumed through `fleet_wait` like any other; the orchestrator learns placements via the same digest stream (`classes: ['scheduler','resource']` on the priority lane so budget/anomaly events never queue behind deltas).
- **I6 (two-phase stop)**: reroute waits on confirmed drain + worktree-lease release; the scheduler cannot reassign a seat mid-stop.
- **I7 (hub-run verification)**: the *sole* source of `RouteStat` wins/losses and of DAG readiness. The economics engine's intelligence is the Referee's output; this is the load-bearing weld.
- **Capability plane `cost_model`** (`spec/capability-plane.md §5`, open Q2): capabilities that call an LLM (semantic search, LLM-judge) route into the *same* scheduler via `cost_model: model_tokens` and consume seats/quota like any turn; `cpu_bound_local` capabilities (ast-grep) are the S1 `mechanical` route and consume no seat. The scheduler is the one place LLM-invoking capabilities and worker turns contend for the same vendor ceiling.
- **Harness card** (`spec/adapter-contract.md §79`): `concurrency_ceiling`, `auth_posture`, `usage_fidelity` are already card fields "fed to the scheduler"; this doc adds `plan_tier`, `quota`, `peak_multiplier_schedule`, `tos_class`, `cost_per_mtok` — probed where possible (Codex `account/rateLimits/read`), configured where not (Z.ai peak window is published, not probed).
- **Two-channels-never-fused** (doc 13 T5): control ops are never WorkItems (§6).

---

## 11. MVP vs later

**MVP (weeks, mostly known engineering — ships with the supervisor MVP):**
- `ResourcePool` semaphore + sliding-window quota per vendor-auth (the hard ceiling — this is the thing without which a Z.ai Pro fleet self-DOSes on 429s). **This alone earns the component.**
- Budget admission wall + 50/80/100% thresholds + "conclude & escalate" at 100%.
- Control-lane bypass (§6) — falls out of the supervisor's existing two lanes.
- Ready-DAG pull with I7-gated readiness + critical-path-first greedy priority.
- **Rule-based** S1 difficulty classifier with the `mechanical → ast-grep, no model` route (the biggest single saving) and static-prior S3 (exploit-only, no bandit) — because per doc 11 module 7, most fleets shouldn't build the bandit.
- `RouteStat` as a **run-scorecard counter** (doc 11's own MVP: "one row per run"), fed by I7.

**Later (earned by measured demand / task-class recurrence):**
- The full bandit (Thompson/UCB explore-exploit) — only when a task-class *recurs* enough to recoup exploration cost.
- Peak-hour deferral of deferrable load (needs the `deadline` + criticality plumbing and a peak calendar per vendor).
- Cost-anomaly diagnostics (doc 14 #19) — cheap once medians are tracked for routing.
- Dynamic-ceiling learning from 429s (§4.2) — add when a second account or a tightening vendor makes it bite.
- Coherence-cost accounting (§9d).
- Cross-vendor best-of-N *exploration* that seeds the routing table (doc 13 T6's narrow honestly-N×-priced corner) — never the default, always exploration-that-graduates-to-a-route.

---

## 12. Honest limits

- **At N = 3–10 this is not a hard scheduling problem.** Greedy is optimal-enough; anyone reaching for an ILP/bin-packer here is over-engineering. The hard parts are the *external* constraints (adversarial ceilings, degraded telemetry, ToS), not the assignment math. Say so and don't gold-plate.
- **The economics engine is only as good as the cost signal, and the tightest-constrained vendor has the worst signal.** Z.ai `usage_fidelity: degraded` means the whole dollar-based scoring degrades to prompt-counting for exactly the pool where economics matters most. This is a real hole; prompt-count is a coarse proxy.
- **RouteStat cold-start is a real cost you may never recoup.** For a one-off task-class, the exploration you pay to learn the route is pure loss — which is *why* the honest default is exploit-on-static-priors and the bandit is opt-in on recurrence. The scheduler that insists on learning every route is more expensive than a soloist.
- **Difficulty classification can be wrong**, and a `hard`-mislabeled-`boring-middle` item wastes a cheap round-trip before I7 catches it. That's the *affordable* failure direction; the classifier is deliberately biased to cheap-first with I7 as the correcting oracle. But a pathological class that always looks easy and is always hard will thrash until the write-back converges.
- **The ceiling adversary can always win the current turn.** No admission policy prevents a vendor from cutting your seats to zero mid-run; the scheduler can only degrade gracefully, not guarantee throughput. Foreman/unattended deployments must treat "vendor tightened, fleet halved" as a normal event, not an error.
- **ToS is a governor on the scheduler's own cleverness (doc 01 §7).** Time-shifting to dodge Z.ai's *published* peak multiplier is fine — it's their pricing. But the same time-shifting/packing logic pointed at a **flat subscription** (`tos_class: flat-subscription`) to maximize extraction is precisely the "long-looping agents exceed subscription revenue" workload Anthropic flagged and nearly metered in June 2026. The scheduler must carry `tos_class` and **not** optimize a flat subscription toward its rate ceiling — the economics engine's job is to spend *less*, not to strip-mine a subscription. An economics engine that maximizes subscription extraction is how baton gets the whole category metered.
- **The whole thing gates on M1, like everything above the control plane.** If a supervised cross-vendor fleet doesn't beat a well-briefed soloist (doc 13 T4/doc 14 #22), there is no fleet to schedule and S0 should route everything to the soloist. The scheduler's most important honest feature is its ability to **decide not to orchestrate** — and the day the eval says orchestration loses for a class, the best scheduler is the one that hands that class to one good agent and gets out of the way.

*— the fly-by-wire for spend and placement: the orchestrator commands the fleet; the scheduler makes sure the commands are affordable, the ceilings are never breached, and the boring middle never costs a thought. Written 2026-07-09.*

Key files read: `/Users/wahargis/Development/Experiments/baton/docs/14-practitioner-addenda.md` (#12, #19, #22, #28, #29), `/docs/04-architecture-options.md`, `/docs/13-revision-log-r2.md` (T6), `/docs/01-landscape.md` §7 (the hard vendor numbers), `/spec/supervisor-state-machine.md` (I1/I3/I4/I6/I7, §4 lanes), `/spec/capability-plane.md` (ACI envelope `cost`, §6 reverify), `/spec/adapter-contract.md` (harness card, §43 rate-limit push), `/docs/11-capability-plane.md` (RouteStat/Cairn), `/docs/05-telemetry-steering.md` (BatonEvent `resource.*`, budget thresholds).

## RED-TEAM
## Red-team: scheduler-economics

The design is fluent and self-aware — which is the problem. It pre-concedes almost every attack in §12, then keeps the grand claims in §9 and the title anyway. Strongest honest attacks, ranked. I checked the citations; they mostly hold (adapter-contract L43/L69/L81 really do carry `usage_fidelity`, `concurrency_ceiling`, "scheduler learns ceilings without probing"), so I'm not attacking sourcing — I'm attacking the load-bearing claims.

---

### S1 — The moat is an empty table. §9(a) and §12 directly contradict each other.

§9(a) headlines the whole component: *"the one durable, un-vendorable cross-vendor lever the whole corpus keeps landing on… Without I7 it's vibes; with I7 it's the moat."* The moat is `RouteStat`, keyed `(harness, model, mode, class, difficulty)`.

Count the cells. Harnesses (3+) × models-per-harness (several) × mode (5) × `class` (explicitly open-ended: `"auth-refactor|test-fix|greenfield|…"`) × difficulty (4). That is thousands of cells. The population feeding them is **N = 3–10 workers**, and each cell only increments when *that exact tuple* runs *and* I7 produces a decisive win/loss. Now read §12: *"RouteStat cold-start is a real cost you may never recoup… for a one-off task-class the exploration you pay to learn the route is pure loss… the honest default is exploit-on-static-priors and the bandit is opt-in on recurrence."* And §3: *"most fleets should run exploit-only on static priors and skip the bandit entirely."*

So the design's own scoping says: for most fleets, most classes, the table is in permanent cold-start and you route on **static priors** — i.e., benchmark/personality guesses. That is *exactly the "vibes-based dispatch" §9(a) says the moat replaces.* The worked example papers over this with fabricated density — *"codex wins hard-bug class historically (wilson .69 vs opus .61)"*, narrated as *"stronger here per 12 verified priors."* Twelve verified priors for one `(codex, high, hard-bug, auth)` cell, at N≤10, is a fiction the rest of the document admits you will almost never have. **The headline novelty is a table that is empty in practice, and the design says so 400 lines later.**

Failure scenario: a real fleet runs 200 heterogeneous tasks across 60 distinct classes. No class recurs more than ~4 times; no `(class, difficulty)` cell exceeds a handful of samples; Wilson lower bounds are all dominated by their priors. S3 routes on static priors for the entire deployment. The "un-vendorable moat" never fired once, and nobody can tell, because the ledger records a `route_reason` either way.

---

### S2 — The value/dollar score is incommensurable exactly across the vendor boundary it exists to arbitrate.

S4's whole engine is `score = expected_value / (expected_cost + ε)`, with `expected_cost = cost_median_usd(key) × peak_mult`. Cross-vendor comparative advantage means comparing that score for a Codex candidate against a GLM candidate.

But §4-S4 and §12 both concede: for Z.ai, `usage_fidelity: degraded`, so *"the cost term is not trusted in dollars; the scheduler falls back to the prompt-count quota model (1 prompt ≈ 15–20 invocations) as the spend proxy."* GLM is **the tightest-constrained, most-economically-interesting pool** — it is the entire reason the scheduler exists — and it is the one pool whose dollar cost is a fabricated conversion of a prompt count.

So in the worked example, n4's *"codex wins hard-bug (wilson .69 vs opus .61)"* and the cross-vendor routing generally is comparing a **real Codex dollar** against a **made-up GLM dollar** (`prompt_count × a guessed $/prompt`). You cannot claim "verified value **per dollar**" as the durable cross-vendor lever when the dollar is non-comparable precisely at the vendor seam. The arbitrage is sharpest where the price signal is real (Anthropic/OpenAI API-key pools, flat, well-instrumented) — and those are the pools where cross-vendor cost arbitrage matters *least*. Where it matters most (GLM's 3× peak, tight ceiling), the cost axis is invented. §12 lists this as "a real hole"; it is not a hole, it is a load-bearing wall of §9(a)-(b) removed.

---

### S3 — I7 is the routing ground-truth, but it's absent for judgment tasks and it competes with workers for the scarce seat.

Two compounding problems the design treats as free.

**(a) No ground truth where judgment lives.** §9(a): wins/losses are incremented *"only when the hub itself re-ran the verification and observed the outcome."* But `spec/capability-plane.md §6` open-Q1 is explicit: reverify is *"always re-run cheap/deterministic (tests, proofs); sample + spot-check expensive/non-deterministic."* Many real coding tasks — "make this module less confusing," a refactor for readability, an API-shape design call — have **no crisp machine-checkable DoD**. They generate no I7 win/loss. So RouteStat gets dense signal exactly on test-shaped tasks (which a soloist handles fine and where routing barely matters) and **zero signal on the `hard`/`plan` classes where the expensive tier and comparative advantage actually matter.** Inverse-value: the moat is sharpest where it's cheapest and blind where it's dear. The worked example's marquee decision — routing the *subtle expiry bug* (a judgment task) to Codex — is precisely the class least likely to carry decisive I7 win/loss history.

**(b) The Referee is an unpriced consumer of the scarce resource.** `spec/capability-plane.md §6` Q2 and doc 05 both establish that LLM-judge / `cost_model: model_tokens` verifications *"route into the same scheduler and consume seats/quota like any turn."* So every RouteStat outcome that comes from an LLM-judged reverify **itself burns a vendor seat and budget** — and if that judge runs on GLM, it contends for the ceiling-1 pool with the workers it's supposed to be scoring. The design's "intelligence source" is a scheduled load it never puts on its own books. The economics engine's telemetry has a nonzero marginal cost that S4's score omits entirely.

---

### S4 — "Makes the fleet actually run" is the one property it cannot guarantee. Graceful degradation is indistinguishable from an unbounded stall.

The opening sells the component as *"the thing that makes a heterogeneous fleet actually **run** under real vendor constraints."* Then §4.2 establishes the adversarial ceiling can drop *"3 → 1 in-flight without notice,"* and doc 01 §7 (cited) notes Z.ai enforcement includes *"account freezing, bans after 3 violations"* — i.e., ceiling can go to **0**. §4.2's rule: *"immediately lower ceiling to in_flight − 1 and stop admitting… the scheduler does NOT kill in-flight workers."*

Now compose the three hard walls with a bad-but-normal state: GLM ceiling → 0 (freeze), Anthropic pool quota-exhausted for this 5h window, Codex budget-blocked on this task. A **critical-path** item is ready. S5 returns `QUEUE_OR_REROUTE`; no candidate has a free seat with passing quota/budget; it enqueues *"until quota.resets_at."* Quota windows are **5 hours**. The design forbids every escape: can't kill in-flight to reclaim a seat (§4.2), can't exceed ceiling (semaphore), can't exceed budget (wall). The critical-path bottleneck now sits with **no worker for hours**, and §12 waves it away: *"Foreman/unattended deployments must treat 'vendor tightened, fleet halved' as a normal event."*

Halved is not zeroed. The design **never bounds worst-case time-to-dispatch for a critical item**, and under its own adversarial-ceiling premise it *cannot*. "Degrades gracefully" is true; "actually runs" is the claim it quietly drops. A scheduler whose headline promise is liveness under vendor constraint, and whose honest limit is "the adversary can always win the current turn" (§12), has refuted its own title.

---

### S5 — The scheduler forgot to schedule the Referee. Hub-verification is an unmodeled resource pool on every critical path.

The design meticulously models vendor seats and quota, then treats I7 as free and instantaneous. But §7 gates *DAG readiness* on I7: *"an item is ready only when deps are terminal-and-hub-verified."* And §5 shows what that costs: n5 is *"hub re-executes `mise exec -- mix test` in a fresh sandbox."* Under the corpus's **one-box-first** constraint, that verification sandbox runs on the *same machine* as the workers, and `cap-plane §6` Q1 contemplates *"a 10-minute fuzz."*

So hub-verification is: (i) a real, sometimes-slow compute load, (ii) with its own concurrency limit on the one box, (iii) sitting on the critical path **between every DAG stage** (readiness gate), **and** (iv) the sole generator of RouteStat. The scheduler builds a `ResourcePool` semaphore for every vendor and **none for the hub's own verification capacity** — the one resource that gates both forward DAG progress and the intelligence signal. With GLM already serializing at ceiling-1 and I7 serializing stage transitions, the "emergent parallelism from available seats" (§7) is throttled twice, once by a limit the design never wrote down. Where is `ResourcePool = { id: "hub:verify", ceiling: ... }`? It's the most contended pool in the system and it's absent.

---

### S6 — The difficulty classifier's self-correction is one-sided; it will drift *expensive*, the opposite of what it's sold as.

S1 and §12 sell the classifier as cheap-biased and self-healing: *"Misclassification is cheap to detect (it fails verification) and self-correcting… a `hard` item mislabeled `boring-middle` costs one wasted cheap round-trip, which is exactly the tier you can afford to waste."* True — **downward**. The feedback loop is: cheap attempt → I7 fails → write back `difficulty=hard`.

But it only closes downward. A `mechanical`/`boring-middle` item **mislabeled `hard`** goes to a reasoning model, **passes verification** (of course it does — overkill succeeds), and I7 records a **win**. There is no signal that it was 10× too expensive; success hides waste. So the corrective oracle punishes under-powering (visible as failure) and *rewards* over-powering (invisible, banked as a win). Over many tasks the classifier's errors are asymmetrically reinforced toward the expensive-safe tier — the exact opposite of the *"reserve the expensive reasoning for the parts that are actually hard"* discipline (doc 14 #12) the stage is built to enforce. "Deliberately biased to cheap-first" (§12) is a hope; the mechanism is biased to whatever-passes, and expensive things pass more.

---

### S7 — S0 runs the M1 eval's hardest question as a cheap online gate. That's the "sloppy eval builds on sand" failure, one level down.

S0 routes to soloist when *"the soloist baseline… beats the fanned-out fleet on cost-adjusted verified pass-rate."* To *have* that per-class comparison you must have run **both** the soloist and the fleet on that class, hub-verified, enough times to compare cost-adjusted pass-rate — continuous online A/B at a fraction of the rigor doc 14 #21 demands of the offline eval: *"a fair eval is a research problem, not a checklist… task selection must not be cherry-picked toward parallelizable work the fleet is structurally good at… the metric encodes a value judgment… pick deliberately and pre-register it."*

S0 is therefore either (a) **redundant** — the M1 eval already pre-committed the soloist-vs-fleet verdict per class, so just read it — or (b) a claim to *re-derive M1's finding online, per class, cheaply*, which is precisely *"if it's rigged — in either direction — every downstream decision inherits the rig"* (#21) reproduced inside the dispatch loop with no pre-registration and self-selected (parallelizable-favoring) task samples. The design calls S0 *"the scheduler's honesty valve."* An un-pre-registered online eval that decides fan-out is a dishonesty amplifier wearing the eval's clothes.

---

### S8 — Framing inflation. A counting semaphore is titled "the second non-LLM authority in the hub."

The MVP section: *"`ResourcePool` semaphore + sliding-window quota… **This alone earns the component**."* And §1's own table classes that as **entirely textbook** — *"counting semaphore × token-bucket… both trivially correct at this scale."* Everything the doc claims as novel — §9(a) I7-routing, (b) mechanical-route, (c) adversarial-ceiling, (d) coherence-cost — is either deferred to **"Later"** in §11 or admitted un-recoupable in §12. So what "ships with the supervisor MVP" is: a per-vendor semaphore, a token bucket, a budget comparison, and a rule-based `if verb=="rename": use ast-grep`.

That is a **~50-line admission gate in the supervisor's spawn path**, not a *"second non-LLM authority… beside the supervisor state machine"* deciding *"placement and spend."* This is exactly the framing-vs-scoping gap doc 13's disposition names as the corpus's recurring sin: *"do what your own scoping already says, and stop letting the framing contradict it."* The document even quotes doc 11 module 7's *"stop at the scorecard"* — and then builds past the scorecard while insisting most fleets shouldn't. The honest title is "the fleet's admission control." The grand one earns the same red-pen doc 13 already applied to T3/T6.

---

### S9 — Minor: a claimed novelty with no mechanism, and magic numbers the user's own standing principle forbids.

Two smaller but real inconsistencies:

- **§9(d) coherence-cost is a named "contribution" with no mechanism, no unit, deferred to Later, and *contradicted by the shipping code*.** §9(d): *"count discarded in-flight tokens as a real cost against the reroute's benefit… no existing scheduler does."* But S5's actual reroute rule is `next.score >= chosen.score × REROUTE_THRESH` — **zero coherence-cost term.** The one place the design says coherence-cost is load-bearing (reroute/preempt) is the one place the mechanism ignores it. A novelty that is deferred, unmeasurable by its own admission (*"prices… in-flight reasoning destroyed"* with no way to observe it), and absent from the code that would use it is a gesture, not a fourth contribution. Claim three, not four.

- **The knobs violate CLAUDE.md's "No Arbitrary Numeric Limits."** Ceilings and peak windows are physical (fine — derived from vendor constraints). But `REROUTE_THRESH` (S5, decides reroute-vs-stall — load-bearing), the `N×`-median anomaly trigger (§5), and the *"first K items… exploration you pay for"* (§3) are ungrounded tuning constants with no derivation, exactly the *"hardcoded numeric limits as control mechanisms"* the user's standing instruction forbids *"unless the number is derived from a physical resource constraint."* `REROUTE_THRESH` in particular silently arbitrates the S4 liveness gap (reroute or queue-for-5h) and is presented as if self-evident.

---

**Bottom line.** Strip the rhetoric and the honest residue is: *a per-vendor semaphore + token bucket + budget wall + a rule that sends renames to ast-grep* — all textbook, all correct, all worth building. Every part the document markets as novel (§9 a–d) is either an empty table at N≤10 (S1), non-comparable across the vendor seam that motivates it (S2), blind on the tasks that matter and self-taxing (S3), or deferred/unmeasured (S9). The two properties it names in its own thesis — *"actually run"* and *"the un-vendorable moat"* — are the two it cannot deliver (S4, S1). The document is at its most trustworthy in §12, where it quietly refutes §9; the fix is to promote §12 to the abstract, retitle the thing "fleet admission control," and delete the claim that it is a co-equal authority with the supervisor.

## BLUE-TEAM & SALVAGE
## Blue-team & salvage: scheduler-economics

I checked the load-bearing citations the red team leaned on and they hold: `spec/capability-plane.md §6` really does say reverify is "always re-run cheap/deterministic … sample + spot-check expensive/non-deterministic"; `spec/supervisor-state-machine.md` I7 really does re-execute "in the worker's (or a fresh throwaway) sandbox — **never on the hub**"; `docs/11-capability-plane.md` module 7 really does scope the MVP as a "run-scorecard … one row per run," keyed **(harness × task-class)** — *not* the 5-tuple the design later widens to; and `docs/14 #22` really does say "that knowledge **is** the `RouteStat`/scorecard the design already has." Those four facts do most of the defending below. The red team is substantially right about the *framing*, and mostly wrong that the *residue is nothing*. Verdicts per finding, then salvage, then integration.

### Per-finding

**S1 — "the moat is an empty table." CONCEDE-and-FIX (the headline), DEFEND (the substance).**
The red is right that headlining §9(a) as *routing* invites the cell-count kill: (harness×model×mode×class×difficulty) is thousands of cells against N≤10, and the design's own §12 says most classes sit in permanent cold-start on static priors — i.e. vibes. The worked example's "12 verified priors" is fabricated density; **retire it.** But two mechanisms the red skipped rescue the *substance*, not the headline:
- **The moat was mis-located, not absent.** The durable, un-vendorable thing is not the routing table — it is **I7 itself: independent cross-vendor verification, which fires on *every* task regardless of table density** ("a vendor will never grade itself," `doc 14 #23`, tagged *durable*). RouteStat is a *cheap second-order optimization the Referee enables*, not the moat. Concede §9(a)'s prose; keep I7-as-Referee as the actual moat and demote routing to "a coarse optimization earned by recurrence."
- **Coarse structural weakness is learnable early.** The MVP key is `doc 11`'s (harness×class), not the 5-tuple. "Codex reliably fails auth-refactor" is a decisive structural fact whose Wilson lower bound on 0/4 or 1/5 already dominates toward *avoid* — you do not need thousands of samples to learn *who is reliably bad at what*. Fine-grained cells are gravy; the coarse "avoid" signal is cheap and un-fakeable. **Fix:** the 5-tuple key is explicitly the *Later* bandit; the MVP claims routing value only at (harness×class) grain and only for the *avoid* direction.

**S2 — "value/dollar is incommensurable at the vendor seam." CONCEDE-and-FIX; partial DEFEND.**
Real: `score = value/(cost+ε)` with a *fabricated* GLM dollar (prompt-count × guessed $/prompt) cannot be compared against a real Codex dollar precisely at the seam the scheduler exists to arbitrate. Defense the red missed: **GLM's binding constraint is not its dollar — it is the ceiling and the 5h prompt-quota, both of which are *exactly* measured, not fabricated.** So the fix is to stop pretending pools are dollar-commensurable:
- *Within* a pool (commensurable): rank by `value/cost`.
- *Across* pools: this is a resource-allocation decision, not a scalar comparison. Prefer the candidate that consumes the *least-scarce* resource for equivalent verified value. GLM's cost axis is **quota-fraction consumed**, shadow-priced by scarcity — never a dollar.
- Route *to* a degraded-fidelity pool only when the decision is **robust to the cost bracket**: either it is the sole candidate that can serve the class, or its verified-value edge wins even under the *worst-case* dollar interpretation of the prompt count. This deletes "verified value **per dollar**" as the cross-seam claim and replaces it with "verified value per unit of the scarcer resource" — honest, and it survives degraded telemetry.

**S3(a) — "I7 is blind where judgment lives." DEFEND.**
The red conflates *hard* with *unverifiable*. Difficulty ⊥ verifiability. The marquee example refutes the red's own reading: the subtle expiry bug's DoD is `n5 = mise exec -- mix test` — it is hard **and** crisply I7-verifiable, so RouteStat fires fine on exactly the class the red said it couldn't. Genuinely un-verifiable tasks ("make this less confusing," no machine-checkable DoD) are precisely the ones baton's whole thesis says to **shed to a soloist** — no verification means no fleet value means no route to compute (S0 fires by design, `doc 14 #22`). RouteStat being blind there is *consistent*, not broken: you don't route what you can't re-run. Small **fix** for the verifiable-but-expensive middle (10-min fuzz, sampled reverify per `§6`): record verdict *confidence*; decisive re-runs move the Wilson counter at full weight, sampled spot-checks at discounted weight.

**S3(b) — "the Referee is an unpriced consumer of the scarce seat." CONCEDE-and-FIX (and note the design half-covers it).**
`§10` already routes `cost_model: model_tokens` capabilities "into the same scheduler … consume seats/quota like any turn" — so LLM-judge reverify *is* on the concurrency books; the red overstated "never puts on its own books." The real gap: S4's *score* omits reverify's marginal cost. Two fixes, one of which is free integrity:
- `expected_cost` includes amortized reverify cost for the class (deterministic reverify ≈ CPU-bound, ~0; LLM-judge adds its tokens).
- **Never run the judge on the same pool as the worker it grades** — route reverify to a *different* vendor. This is *required anyway* (a vendor grading itself is exactly what I7 forbids), and it simultaneously removes the ceiling-1 self-contention the red found. The integrity rule and the contention fix are the same rule.

**S4 — "graceful degradation is indistinguishable from an unbounded stall." CONCEDE the title, DEFEND the real guarantee.**
The red is right that "makes the fleet actually **run**" is refuted by the adversary who can zero your seats — no admission policy bounds time-to-*dispatch* against that. But the design's real, deliverable guarantee is narrower and intact: **it bounds time-to-*visibility*, not time-to-dispatch.** The fix makes that explicit: a critical-path item with no headroom anywhere does not silently park — within one bounded poll (I3/I4) it emits `resource.exhausted{item, all_pools, earliest_relief: quota.resets_at}`, an escalation-with-ETA, and if the ETA misses the item's deadline it triggers the `doc 14 #28` "conclude & escalate / human takeover" path. "Hangs for 5h" becomes "reports *blocked, relief at T, human needed* in one cycle." **Retitle the promise:** never breach a ceiling, never silently stall, **dispatch-or-escalate-with-ETA within a bounded poll.** That is honest and it is what the mechanism actually delivers.

**S5 — "you forgot to schedule the Referee." CONCEDE-and-FIX. (Best finding.)**
I7 verification is a real, sometimes-slow, one-box compute load sitting on the critical path *between every DAG stage* and it is the sole RouteStat generator — and there is no semaphore for it. Partial defense (I7 runs "never on the hub," so it's off the control thread) does not save it: on one-box-first it still contends for the box. **Fix:** add a first-class `ResourcePool{ id:"local:verify", ceiling: derived-from-cores }` — a *physically* derived ceiling (satisfies CLAUDE.md's no-arbitrary-limits rule), scheduled like any pool. This also closes S3(b): reverify becomes a priced, scheduled load, not free magic.

**S6 — "self-correction is one-sided; it drifts *expensive*." CONCEDE-and-FIX. (Also sharp.)**
Correct and important: failure downgrades *upward* (visible), but overkill *passes* and banks a win (waste invisible), so the oracle rewards over-powering — the opposite of `doc 14 #12`. The design already tracks the missing signal and never wired it in: **the `§5` cost-anomaly detector *is* the upward-drift oracle.** Fix — make feedback symmetric: an item classified `hard` that passes but whose *shape* falls in the `boring-middle` distribution (few reasoning tokens, fast convergence, small diff, cost near the cheap-tier median) writes back a **downgrade candidate** for that class. Failure powers up; cheap-shaped success powers down. Closes the loop with signal already on the ledger.

**S7 — "S0 runs M1's hardest question as a cheap online gate." CONCEDE-and-FIX.**
Right per `doc 14 #21`: an un-pre-registered online A/B on self-selected (parallelism-favoring) samples is a dishonesty amplifier. The fix binds S0 to M1 instead of re-deriving it: **S0 consumes M1's *pre-registered* per-class soloist-vs-fleet verdict as its prior** (the soloist arm is paid once, offline, rigorously, with M1's fixed metric/grader/value-judgment). Online, S0 is a **drift-detector against that baseline**, not an eval — it accumulates I7 evidence under *the same* pre-registered metric and only flips a class on a pre-registered decision boundary; it never manufactures a comparison by paying to run both arms live. That removes the self-selected-sample rig and the cheap-re-derivation both.

**S8 — "a semaphore titled the second non-LLM authority." CONCEDE the framing, DEFEND the narrow authority.**
Adopt the red's prescription: **promote §12 to the abstract, retitle the component "Fleet Admission Control & Cost Governor."** But the "non-LLM authority" claim is *correct for one narrow thing*: the guarantee that the ceiling/quota/budget are hard walls that a stochastic model can never override *must* be deterministic — that genuinely is a supervisor-adjacent authority, small as it is. What's inflated is banner-ing the deferred bandit and coherence-cost as if they ship. Fix: the *authority* is exactly the three hard walls; everything above it is a thin optimization layer earned by recurrence.

**S9(a) — "coherence-cost is a claim with no mechanism." CONCEDE ("claim three, not four"), with one correction.**
Adopt "three contributions + one deferred refinement." Correction: it is *not* unmeasurable — discarded in-flight tokens are on the ledger at preempt time; the unit is tokens like everything else; the design under-sold it. Keep it as a *measured, deferred* refinement and actually wire it into the reroute rule (below) so §9(d) stops contradicting S5's code.

**S9(b) — "magic numbers violate CLAUDE.md." CONCEDE-FATAL to the constants as written; FIX with derived replacements.** This is the user's own standing principle, so no defense:
- `REROUTE_THRESH` → **eliminated.** Reroute-vs-queue is decided by the item's own `criticality` + `deadline` (physical), not a global constant: a critical-path item reroutes to *any non-worse-value pool with real headroom*; a deferrable item queues. No threshold, and the coherence-cost term (tokens discarded × reconstruction cost) enters *here*, deducted from the reroute's benefit.
- `N×`-median anomaly → replaced by a **distributional outlier** (e.g. beyond the class's own cost p99), derived from observed data.
- "first K items" exploration → not a control limit: **explore until the Wilson interval narrows below the routing decision's sensitivity**, or simply stay exploit-on-priors until a class recurs (the design's own default). No hardcoded K.

### Salvage — the strongest version that survives

The red's "honest residue" *is* the strong core; it is just mis-marketed. The salvaged component:

1. **Rename to Fleet Admission Control & Cost Governor.** The deterministic *authority* is exactly three hard walls — **ceiling (counting semaphore), quota (token-bucket), budget (pre-turn wall)** — plus the new **`local:verify` semaphore**. This is the thing without which a Z.ai-Pro fleet self-DOSes on 429s; §12 is the abstract.
2. **The moat is I7, not the table.** Independent cross-vendor verification fires on every verifiable task and no vendor can grade itself. RouteStat is a coarse (harness×class) *avoid-signal* optimization, exploit-on-priors, earned by recurrence — never headlined as the moat.
3. **Engine-class-before-vendor stands, and is the real cost lever** (`doc 14 #12/#29`): `mechanical → deterministic tool at $0` needs no table and is the biggest saving. Keep it; it's not vendor arbitrage and doesn't depend on the empty table.
4. **Cross-seam routing is scarcity-based, bracket-robust** (S2 fix): no fabricated common dollar; route to degraded-fidelity pools only when robust to the cost bracket.
5. **Liveness promise downgraded to what's deliverable** (S4 fix): never breach a ceiling, never silently stall, dispatch-or-escalate-with-ETA within a bounded poll.
6. **S0 is a drift-detector bound to pre-registered M1** (S7), classifier feedback is symmetric (S6), reverify is a priced scheduled load run on a *different* vendor (S3b/S5), and all control constants are data-/physically-derived (S9b).

Everything the red called textbook (semaphore, token-bucket, WFQ, critical-path list-scheduling) ships as textbook, boringly. Nothing here is CONCEDE-FATAL to the component; it survives retitled and re-scoped, which is the honest outcome.

### Integrate — where it plugs in, and the one thing to build first

Every edge lands on an existing invariant, unchanged except the two new welds:
- **I1** — seats are fences (already); reassignment bumps epoch.
- **I3/I4** — every decision is a ledger event on the priority lane (`classes:['scheduler','resource']`), including the new `resource.exhausted{…, earliest_relief}` escalation.
- **I6** — reroute waits on confirmed drain + worktree-lease release.
- **I7** — sole source of RouteStat *and* DAG readiness *and* (new) a scheduled load through **`local:verify`**; the LLM-judge weld: reverify routes to a *different* vendor than the worker it grades (integrity = contention fix).
- **Capability `cost_model`** — `model_tokens` capabilities consume seats/quota and now enter S4's cost term; `cpu_bound_local` is the S1 mechanical route at $0.
- **M1** — S0 consumes M1's pre-registered per-class verdict; it detects drift, never re-derives.

**Build first (single thing):** the **per-vendor `ResourcePool` hard-wall admission gate — semaphore + sliding-window quota + budget wall — plus the `local:verify` semaphore — wired into the supervisor's spawn path.** No routing, no economics, no bandit, no deferral. This is the one piece that is (a) non-LLM authority, (b) the thing without which the tightest-ceiling vendor self-DOSes, and (c) on every critical path (verify). It is `doc 11 §11`'s MVP stripped of the grand framing — and it earns the component on its own, exactly as §12 already admits.

Corpus files engaged: `docs/11-capability-plane.md` (module 7 scorecard MVP, §MVP), `spec/capability-plane.md` (§6 reverify semantics, `cost_model`, ACI `cost` field), `spec/supervisor-state-machine.md` (I1/I6/I7 — verify runs off-hub in a sandbox), `docs/14-practitioner-addenda.md` (#12/#19/#21/#22/#23/#28/#29), `spec/adapter-contract.md` (card fields, per red's confirmed L43/L69).
