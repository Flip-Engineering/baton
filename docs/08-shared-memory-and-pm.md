# 08 — Shared Memory & Project/Task Management

*What the fleet remembers, coordinates on, and hands back — and at what tempo. Uses the user's `project-manager` (PM) MCP server as a foil: studied hands-on 2026-07-09, not from its README. A companion prior-art dossier (anatomy run, `memory-pm-prior-art`) feeds the §6 comparison.*

## 1. The tempo insight (the thing most memory designs get wrong)

A fleet has **three memory tempos**, and collapsing them into one store is the classic mistake:

| Tempo | Horizon | Truth lives in | Access pattern | Consistency need |
|---|---|---|---|---|
| **Operational** | ms → minutes | append-only event ledger | tail, digest, resume | monotonic, gap-flagged |
| **Coordinative** | minutes → hours | task DAG + artifact registry | claim, depend, merge | serializable claims |
| **Epistemic** | days → months | decision/finding graph | query, cite, audit | provenance-integral |

The operational layer is doc 05's `BatonEvent` ledger — already specified. This doc designs the **coordinative** layer (§3) and asks whether the **epistemic** layer belongs in baton at all (§5–6). The failure mode to avoid: forcing minute-scale coordination through a provenance-heavy graph (too slow, too ceremonious), or forcing month-scale epistemics through an event tail (unqueryable, lossy). PM is a pure epistemic-layer tool; baton is dominated by the first two and only touches the third at boundaries.

## 2. What `project-manager` actually is (and what baton should learn from it)

PM is a **typed knowledge graph for long-horizon research**: nodes are Phases, Experiments, Findings, Decisions, Hypotheses, Principles, Constraints, Literature, Research; edges are typed and directional (`Supports`, `Contradicts`, `Supersedes`, `Informed`, `ProducedBy`, `Contains`). Observed live: volta-renaissance carries 742 findings / 283 literature / 2,522 edges across 28 phases. It is not a task tracker with extra steps — it is an epistemic substrate.

Three of its design choices are genuinely good and portable:

1. **Enforced causal backbone.** A Decision *must* trace to upstream evidence (`why` is required, min length; `finding_ids`/`experiment_id` create `Informed` edges). The audit flags orphan findings and decisions-without-evidence. → Baton lesson: **every control action and every accepted result should carry a provenance edge to the event(s) that justified it.** "Worker w3's PR was merged because its verification command exited 0 (event #4471) and reviewer w5 approved (event #4520)" is the audit trail that makes a fleet trustworthy.
2. **Temporal-coherence integrity.** The audit catches a Decision "informed by" a Finding created *after* it — a real logical-integrity invariant, not a lint nicety (execution-engine scored 0/100 on this axis with 20 violations, surfacing that its provenance was back-filled). → Baton lesson: provenance edges must respect the event clock; a steering action can't cite an event that hadn't happened. Cheap to enforce with the ledger's monotonic `seq`, and it catches fabricated/hallucinated justifications automatically.
3. **Health score with metric breakdown, not pass/fail.** Edge density, hypothesis coverage, literature utilization, temporal coherence each scored 0–100 with a bar chart. → Baton lesson: a fleet's *run* deserves the same — a post-run scorecard (coverage of the brief, verification-backed vs asserted completions, unaddressed approvals, budget efficiency) beats a green check.

Three places PM is the wrong shape for baton, which sharpen the requirements:

1. **Retrieval is topic-similarity + 1-hop, tuned for human recall** (`pm_context` returns nodes grouped by type with neighbors, scored). A worker mid-turn doesn't want a research briefing; it wants *its brief, its scope, its DoD, and the specific artifacts it depends on* — a narrow, addressed slice, not a similarity fan-out. → Baton's downward context is **push, addressed, minimal** (doc 06 Q6), not a query into a shared brain.
2. **Write cadence is human/deliberate** (findings are "200+ char lab reports"; decisions require prose rationale). At fleet tempo, thousands of events/minute can't be hand-curated into a graph. → The ledger is machine-written and cheap; graph promotion (§5) must be *selective and automatic*, not a per-event tax.
3. **Single-writer-ish.** PM assumes one agent (or human) curating a coherent narrative. A fleet is inherently **concurrent multi-writer** — the hard problem PM never has to solve (§4).

## 3. The coordinative layer: task ledger + artifact registry

Two stores, both hub-owned, both concurrency-safe by construction.

### 3a. Task DAG
A task is `{id, brief_ref, status, deps: [task_id], assignee: worker_id|null, worktree, budget, verification, result_ref}`. Status is the **five-state lifecycle borrowed verbatim from A2A / MCP-tasks** (doc 01, doc 03): `working` (was submitted→assigned→working; collapse the pre-run states, they're scheduler-internal), `input_required` (blocked on approval/question — the interrupted state), `completed`, `failed`, `cancelled` (terminal, immutable — refinements are new tasks linking `refines: task_id`, exactly A2A's `referenceTaskIds`). Using the standard vocabulary means the DAG *is* the thing baton exposes if it ever speaks MCP-tasks northbound — no translation.

**Ready-work detection** (the one thing a DAG buys over a list): a task is dispatchable iff all `deps` are `completed`. The scheduler pulls ready tasks subject to per-vendor concurrency ceilings (doc 01 §7 — Z.ai Pro ≈ 1 in-flight is a *scheduler input*, not a retry concern). This is the same "next actionable" primitive PM exposes via `pm_next`/`pm_session_init` — worth stealing the interface idea (a single "what should run now" call), rejecting the research framing.

### 3b. Artifact registry
Results are **artifacts, not chat** (doc 06 Q6). The registry maps `task_id → {commits: [sha], diff_ref, files: [path], verification: {command, exit, tail}, summary}`. Artifacts live in git (worktree-per-worker, committed with the worker's own identity + `Harness:` trailer — doc 06 Q10); the registry is just the index. This is deliberately **not** a memory store — it's a manifest. The repo is the memory; the registry finds it.

## 4. Concurrency: the problem PM never had to solve

A fleet is N harnesses writing simultaneously. Design rules:

- **The event ledger is the only append point and the source of truth.** One writer per worker stream (its adapter), monotonic `seq` per worker; the hub multiplexes. Append-only JSONL is naturally concurrent-append-safe *per file*; one file per worker sidesteps interleaving entirely. The SQLite index is a *projection* rebuilt from the ledger — if it corrupts, drop and replay. Never let the index be the truth.
- **Task claims are the only place that needs serialization.** Claiming a ready task = a compare-and-swap on `assignee` (SQLite transaction, or PM's file-lock trick — Anthropic agent teams uses file-locking for exactly this, doc 01 §6). Everything else is either single-writer (event streams) or immutable-once-written (artifacts, terminal tasks).
- **No shared mutable "world state" blob.** The seductive `state.json` that every worker reads and writes is the deadlock/lost-update generator. State is derived from the ledger + DAG; nobody writes a shared document. (This is where naive spawn-a-swarm implementations die.)
- **Idempotency everywhere** (doc 05 §4): every control op and task transition carries a client key; replays are no-ops. Concurrent duplicate claims resolve by CAS; the loser gets `already_assigned`.

## 5. The epistemic layer exists in Baton: selective promotion, not a shared brain

The original research stance made the graph an external PM concern. The full-system goal supersedes
that boundary: **Baton owns a deployment-neutral typed causal graph, while PM remains architectural
prior art only.** Any later import/export surface is a generic Baton interchange contract, not a PM
or homelab adapter. There is no PM or homelab runtime dependency. The graph
remains selective and pull-only because a coding fleet's primary job is to land work, not to inject
an accumulated research narrative into every turn. Two epistemic artifacts are immediately cheap
and high-value:

1. **The run scorecard** (§2, PM's health-score idea): auto-generated at fleet-run end from the ledger — brief coverage, verified-vs-asserted completions, interventions, budget, per-worker cost. Durable, queryable, one row per run.
2. **Decision provenance** (§2, PM's causal backbone): the orchestrator's consequential choices (spawn, reroute-after-refusal, accept-result, merge) written as decision records with edges to the justifying events. This is the "audit the conductor, not just the musicians" requirement from doc 06 Q3, made concrete.

Phase 44 resolves the cheap cross-run routing case without turning anecdotes into ambient truth.
Each hub-reverified terminal outcome atomically promotes one immutable exact-tuple `RouteStat`, and a
deployment-pinned router hydrates only from those ordered observations. Cairn exposes bounded,
read-only advice over a caller-supplied candidate set; callers cannot supply outcomes or mutate
routing. Broader claims such as “a family is bad at auth” still require an explicit Finding with
evidence rather than being inferred from this narrow win/loss table.

Phase 47 makes the causal substrate auditable instead of merely queryable. Node and edge
observation versions now survive replay, while valid time is pinned to the requested observation
boundary rather than the moving wall clock. Generic graph payloads are content-bound and reserve
lifecycle-owned fields. `Supersedes` is same-type, live, CAS-bound, acyclic, and atomically
contaminating; `Contradicts` has one unordered-pair identity and can close only through an explicit
operator/orchestrator CAS resolution that invalidates exactly the loser and records exact prior
readers. Cairn's repository-bound `causal.audit` reports separate causal, temporal, structural,
grounding, contradiction, recall, and contamination axes; `causal.trace` is a bounded live-view
walk with explicit frontier. Both are deterministic/reverifiable through direct and authenticated
web/MCP ACI without edit, verification, merge, approval, publication, routing, proof, note, or
policy authority. This is still a local selective graph: no external PM or homelab runtime exists.

Phase 48 ships that next epistemic dependency. Cairn now exposes audit-gated bounded lexical/graph
recall with fixed integer weights and stable node-ID ties, complete unresolved-contradiction
bundles, compact append-before-return receipts, exact historical `ReadBy`/contamination identity,
pull-only untrusted framing, and direct/authenticated-web/MCP replay and reverify. The receipt's
request identity is recomputable from its compact query/reader/policy projection; no raw query or
snippet is retained. Registry-derived ACI envelope and budget gates run before the receipt append,
and there is no public unreceipted preview surface. Recall remains explicit and never auto-injects
accumulated knowledge.

Phase 49 closes the first general promotion-policy subset. `causal.promote` pins one coordination
prefix, reruns the Phase 47 critical audit, and derives candidates without caller nomination. The
closed taxonomy admits operator/orchestrator spawn and selected control/publication Decisions,
policy-authored integration/publication/recovery Counterexamples, and same-repository observed
Scratch Findings only after distinct completed tasks independently ground them in live verified
outcomes. One replay-validated atomic batch retains fixed safe text, closed identifiers/digests,
and exact causal edges without copying briefs, Scratch values, prompts, paths, reasons, commands,
URLs, credentials, or provider payloads. Phase 49 leaves derived Scratch quarantined pending a
distinct independent-oracle and correction policy. Direct, authenticated web, and MCP
invoke/reverify share the same repository-bound authority and pre-effect publication gates.

Phase 50 closes that quarantined Scratch lifecycle without making arbitrary ledger events
promotable. A derived fact can enter the graph only through a fact-bound oracle task whose explicit
harness, exact model, effort, and model family are independently routed from the producer. The
accepted review artifact is bound to the oracle worker, exact route tuple, capture/commit SHA, and
hub reverification, and the oracle task itself cannot integrate code. `causal.correct_scratch`
then releases, supersedes, or retracts only the closed Scratch Finding class through one audited
prefix-CAS event with exact earlier-reader contamination. Scratch IDs are hub-derived, public
results are closed metadata projections, and trusted web/MCP transport identity is token-bound.

Phase 52 closes recall feedback's observability prerequisite without turning correlation into
authority. `causal.assess_recall` scans one audited prefix and selects only task-scoped Phase 48
receipts followed by exact mapped hub verification and a compatible terminal state. Its compact
batch preserves the historical node/version/score/contradiction exposure and reports only
`verified_pass_after_recall` or `verified_fail_after_recall`, always with
`causationClaimed:false`. Workers cannot rate memory, callers cannot nominate favorable receipts,
and no confidence, rank, grounding, validity, promotion, or route changes. This evidence can inform
a later versioned learning policy, but task success by itself is never a helped-rate.

Phase 53 closes the human/orchestrator contradiction seam without outsourcing the graph. An
audited stable workspace surfaces complete unresolved pairs as bounded untrusted snippets and
digests. An authenticated explicit edge/winner/loser/version decision then commits one prefix-CAS
event that closes the conflict, invalidates only the loser, preserves bitemporal history, and marks
every bounded earlier ordinary or recall read as contaminated. It performs no automatic voting,
confidence mutation, or learned ranking, and it adds no project-manager or homelab runtime.

Richer cross-run learning, literature, hypotheses, contradictions, and supersession therefore live in
Baton's self-contained bitemporal graph under `spec/phase11/coordination-knowledge.md`. They are
promoted selectively from immutable events/artifacts, never written as an ambient mutable brain.
An optional deployment-neutral graph export may ship later, but no PM-specific target is planned and
the product stays self-contained.
This preserves the honest architecture: a **fast operational spine that promotes selectively into
a slow epistemic graph**, with Git-backed artifacts as the third leg.

## 6. Prior-art scorecard (to be completed from the anatomy dossier)

| System | Layer it nails | Concurrency story | Steal | Reject |
|---|---|---|---|---|
| project-manager (KG) | epistemic | single-curator | causal backbone, temporal integrity, health score | topic-retrieval as worker context; hand-curation cadence |
| Anthropic agent teams | coordinative | file-lock task claims, mailbox | ready-work claim via lock; mailbox as `input_required` transport | single-vendor; one-team-per-session; no nested teams |
| OpenAI codex plugin ledger | operational (jobs) | session-scoped job records | job record schema, status-poll (`--wait`), session scoping | poll-only; single-harness |
| claude-squad | (none — git + tmux) | git worktrees | worktree-per-worker isolation; git-as-result-channel | no structured memory at all; scrape-to-observe |
| git / worktrees | artifact | branch isolation | the repo IS the memory; PR-as-result-contract | not a coordination store; no live state |
| MCP-tasks / A2A | coordinative (vocab) | protocol-level task states | the 5-state lifecycle names; refines-links | federation machinery (premature) |

*(The synthesis now resolves to: operational spine + coordinative DAG + artifact manifest +
self-contained selective epistemic graph in the hub. External graphs are optional interchange
targets, never product dependencies.)*

## 7. Open questions

1. Promotion policy: Phases 49–50 resolve a closed first subset for consequential Decisions, closed policy Counterexamples, independently verified cited observed Scratch, and fact-bound independent-oracle release/correction of derived Scratch. Separate contracts are still required for Playbook/Skill promotion and any later taxonomy expansion; arbitrary events never become knowledge by default.
2. Cross-run identity: Phase 44 ships the cheap exact harness/version/model/effort/family/task-class win/loss table. Generalized claims such as "Codex is bad at auth refactors" remain explicit causal Findings, never automatic route evidence.
3. Phase 48 answers re-entry with explicit pull-only recall, and Phase 52 measures verified
   pass/fail-after association without causal overclaim. The remaining question is whether a later
   versioned policy has enough independently assessed evidence to change ranking at all; automatic
   injection and worker self-rating remain rejected.
4. Phase 53 lets an authenticated human or orchestrator resolve a surfaced contradiction through
   exact prefix-CAS authority. Automatic resolution, worker voting, and confidence mutation remain
   rejected without a later independent policy contract.
5. Retention/rotation: ledgers grow unbounded; JSONL rotates, SQLite compacts, artifacts are git-GC'd — but the scorecard + decision graph are meant to be permanent. Where's the boundary, and who prunes?
