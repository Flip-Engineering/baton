PM-QA v1
# PM-QA — coordinator merge + rubric application (pm-comparison wave A)

[attempt: 43ea3f5f-c961-47f2-92d6-2d565dab76b4 coordinator]

- **Role:** `coordinator` (v4-pro seat), objectiveRef `coordinator-brief.md`. This file is the harvest artifact.
- **Verification HEAD:** `e371f704727cbca5fdff86af31ec8b154620a71f` ("Baton private effective-tree
  snapshot") — the base of this worktree and of the sibling row worktrees. The pm-comparison pack
  (briefs + digest + workflow.json) lives at `26732ec` on master; I read all of it from the durable
  files under `docs/reference/evidence/pm-comparison-2026-08-13/` in the main repo.

## 0. On-disk verification — the #174 law, applied (sourcing note, no fabrication)

Step 1 of the brief is "wait for the signal, then verify on disk." I verified on disk. What I found
is recorded here because it changes the **source** of every verdict below, and the law is "no
fabrication" — so the source must be stated plainly.

- **The four row reports are not on disk.** `pm-kg.md`, `pm-dag.md`, `pm-agent.md`, `pm-redteam.md`
  exist nowhere in any sibling worktree (`../../wt/ws-*/docs/reference/evidence/pm-comparison-2026-08-13/`)
  nor in the main repo post-harvest. `find` over the whole repo returns nothing for those names.
- **The rows are not dead — they are deferred.** In the resident coordination log
  (`.git/baton/application-v3/state/coordination/events.jsonl`, located this session the same way
  the channel-audit rows did), the wave `wave:9d09e3ce85d98ec64460e40e29929b14` has roster
  `["coordinator","row-pm-kg","row-pm-dag","row-pm-agent","row-pm-redteam"]`. The four row tasks were
  `task.created` (19:05:41–19:06:06Z) and each shows **`task.dispatch_deferred`** — no
  `lifecycle.spawned`, no `turn.settled`. The coordinator task (this one) is the only member with
  `lifecycle.spawned` + `task.claimed`. Per the #174 law, silence is not death and a missing attempt
  marker is not a dead row: the rows are waiting to run, not run-and-lost.
- **Therefore the merged table below is coordinator-synthesized, not row-derived.** I do not attribute
  any verdict to a row. The candidate universe is taken from the **authoritative candidate lists the
  three row briefs themselves enumerate** (`row-pm-kg.md`, `row-pm-dag.md`, `row-pm-agent.md` — durable
  files) plus the pm ground-truth package (`pm-digest/*.rs`, the README's "source files govern" rule),
  and the verdicts are mine, as the merge authority. Where a row report would have added a verdict I
  could disagree with, none exists to disagree with; that is a gap in the wave's evidence, not a fact
  I will paper over. **Flag for the orchestrator:** either re-dispatch the four rows before treating
  any contract as row-blessed, or accept this coordinator synthesis as the wave's single source.

## 1. Shared partition — the #158 publish result (recorded, as the law requires)

The brief says "publish to `shared` — or record the refusal." The `shared` scratchpad scope is
**unreachable** from this session, for a now-cited reason: `writeScratchpad` hardcodes the scope at
`impl/src/coordination-store.mjs:14103` (`const scope = \`worker:${fields.workerId}\`;`, second
identical hardcode at `:14183`), and the channel-audit `knowledge.md` row already verified from the
store that **all 13 campaign `scratchpad.entry_written` events are `worker:`-scoped — zero `shared`
ever**. There is no `shared` partition for this wave to publish into. My publish is therefore
non-executable; this file is the durable record and the harvest artifact. (Same result the
contract-foundry coordinator recorded for its wave — the #158 append verb is still unlanded.)

## 2. Escalations

No authority-class question requires a DECISION_REQUEST. The one authority-shaped question — "rows
are dispatch-deferred; accept coordinator synthesis or re-run them?" — is surfaced in §0 as a flag,
not escalated: it does not block my deliverable, and the orchestrator already holds the dispatch
authority. Every other open point below is a judgment call, recorded in §6.

## 3. Merged adoption table (candidate → verdict → landing zone → sizing)

Sizing classes: S = single-verb/single-surface change; M = new contract with a small grammar; L =
new contract with schema/structure. "Event-derived" below always means: derived from the
coordination event sequence, never wall clock.

| # | Candidate | pm mechanism (digest file:symbol — both sides cited) | Verdict | Baton landing zone (named) | Sizing |
|---|---|---|---|---|---|
| K1 | Typed edges (supports/contradicts/supersedes) | `src_kg_traversal.rs:236-241` edge set (Contains/ProducedBy/Informed/Supports/Contradicts/DependsOn/DerivedFrom); README "13 edge types" | ADAPT | `run.scratchpad.elevate` surface + the knowledge tiers; typed relations only on **elevated** entries | M |
| K2 | Contradiction detection + explicit-resolution workflow | `src_kg_mod.rs:123` find_contradictions; `src_analysis_contradictions.rs` two-layer cascade (`score_pair`) | ADAPT | `elevate`/decision vocabulary (a closed "contradiction surfaced" note kind), not pm's Rust+NLI cascade | M |
| K3 | Staleness (unreferenced entries fade) | `src_mcp_dashboard.rs:14` is_stale(days); DESIGN.md L3 "unreferenced…older than N experiments" | ADAPT | the tiers' reap path (a `scratchpad.partition_reaped`-class event already exists) | S |
| K4 | Confidence / belief_status fields | `src_analysis_confidence.rs` (MAD); `src_store_migrations.rs:299-318` columns | ADAPT (split) | elevated entries + decision records: **belief_status only**; numeric confidence REJECTed | S |
| K5 | Composite retrieval scoring (text+edges+recency) | v6 §2 Pillar 1 (`pm_search` FTS5 + text + edges + evidence + recency); E#128 access-weighted | ADAPT (split) | the atlas discovery verbs (#123); FTS5/SQLite machinery REJECTed as architectural | M |
| K6 | Auto-linking on write | v6 ("`pm_log_finding` auto-links via composite scoring") | ADAPT | `elevate` (link-on-elevation, not link-on-write) | S |
| K7 | Knowledge briefing (computed per-project digest) | `src_mcp_dashboard.rs:22` build_knowledge_briefing; `:349` tool_session_init | ADAPT | `messageOnSpawn` / the landed #103 briefing pack / #81 orientation lane | M |
| K8 | Temporal versioning | v6 E#130 (`node_versions` table, planned, unlanded) | REJECT | — (git history is the version log) | — |
| D1 | Dependency-typed task structure (blocked-by) | `src_dag_mod.rs:18` topological_sort; `:49` next_phases (depends_on) | ADAPT | the folded #161 plan object (per-wave-subtree WIP law, `focusTaskIds`) | M |
| D2 | Impact propagation for prioritization | DESIGN.md L2 "effective_impact = own + weighted downstream"; `src_dag_mod.rs:65` impact sort | ADAPT | wave-level portfolio projection only; never a throttle | S |
| D3 | Auto-transition on child completion | DESIGN.md L2 "phase completes when all experiments non-pending"; TASKS.md P2.4 | ALREADY-HAVE | #163 quiescence-derived wave completion | — |
| D4 | Stagnation (N consecutive failures → forced review) | `src_dag_mod.rs:70` stagnation_check | ADAPT | the steering lanes (`claimOnStall`/`elevate`) + a repeated-failure escalation; N = count of failure verdicts | S |
| D5 | Review gates (K experiments / T hours without review) | DESIGN.md L2 "blocks after K experiments or T hours"; TASKS.md P2.6 | ADAPT (split) | the foundry evidence-gate methodology / #149 gate digest; the **T-hours half is REJECTed** | S |
| D6 | Opportunity-cost / portfolio view | DESIGN.md L6 (priority classes, portfolio stagnation) | ADAPT | dashboard projection only; baton's "process all work" stance forbids making it a throttle | S |
| A1 | Ambient computed briefing (vs fixed `messageOnSpawn` string) | = K7 (`src_mcp_dashboard.rs:22`) | ADAPT | same landing zone as K7 — **deduplicated** (K7 == A1) | M |
| A2 | Delta-aware nudging (only-what-changed) | `src_mcp_dashboard.rs:682` `pm_since` "Changes since"; v6 E#127 | ADAPT | `nudgeOnCheckpoint`; event-derived "since last nudge," cry-wolf-guarded | S |
| A3 | Idle-detection triggers | DESIGN.md L4 "idle detection"; TASKS.md P5.3 (wall-clock) | ALREADY-HAVE / REJECT | #163 quiescence (event-derived) already covers it; pm's wall-clock idle form REJECTed | — |
| A4 | Auto-scaffold on milestone completion | DESIGN.md L4 "phase completes → task tracker items"; TASKS.md P5.4 | ADAPT | wave harvest → next wave's brief skeleton | S |
| A5 | CLI↔MCP parity testing (their `--all` bug) | v6 CLI-parity gap table (`search --all` double-execution) | ADOPT | the suite (`impl/test/`) as a two-surface parity row; #147/#159 class | S |
| A6 | Session-handoff documents | DESIGN.md L5 "structured handoff on session end"; TASKS.md P6.1 | ADAPT | the resident/orchestrator compaction surface | S |

Net: **0 ADOPT-as-is, 15 ADAPT (with 3 split-REJECTs inside), 2 ALREADY-HAVE, 1 REJECT, 1
deduplication (K7==A1).** No candidate survived as a verbatim ADOPT except A5 — and even A5 is a
test-shape adoption, not a mechanism.

## 4. Rubric application — every ADOPT/ADAPT against the red-team rubric

The rubric (from `row-pm-redteam.md`, the wave's conscience) is eight questions a proposal must
survive. Applied to each ADOPT/ADAPT in the table:

| Candidate | Verdict | Rubric result | Rubric question it engages (and survives or fails) |
|---|---|---|---|
| K1 typed edges | ADAPT | SURVIVES | Q5 (duplication): baton's entries are untyped notes, so no duplication — but the ADAPT is the guard against Q8 (13-edge ontology is an imported ornament; keep only contradicts/supersedes/supports) |
| K2 contradiction detection | ADAPT | SURVIVES | Q3 (can it lie?): no — it *flags* ambiguity up, it never resolves silently; Q2 (per-worker cost): ADAPT keeps detection on the hub-side `elevate`, not per-worker Rust |
| K3 staleness | ADAPT | SURVIVES | Q1 (wall clock): pm's `is_stale(days)` **fails** Q1; the ADAPT rewrites it event-derived, which survives |
| K4 confidence/belief | ADAPT | SURVIVES | Q3: the numeric confidence scalar (0.0–1.0 MAD ratio) **fails** Q3 — a fabricated-precision surface that reads "HIGH confidence" from 3 numbers; belief_status (believed/suspended/retracted) survives |
| K5 composite scoring | ADAPT | SURVIVES | Q8: FTS5/SQLite is pm-shaped (SQLite-local) — REJECTed inside the ADAPT; the multi-signal *principle* has a baton-native reason (atlas #123) |
| K6 auto-link on write | ADAPT | SURVIVES | Q2: link-on-write is per-worker heaviness; link-on-`elevate` is hub-shared, which survives |
| K7/A1 computed briefing | ADAPT | SURVIVES | Q3: must be honesty-pinned — the digest may surface contradictions/untested hypotheses but never a synthesized "confidence"; Q6: it serves a *real* recurring cost (members spawn with a fixed string today) |
| K8 temporal versioning | REJECT | (n/a — REJECT) | Q5: git history already versions; pm's `node_versions` duplicates it |
| D1 typed dependencies | ADAPT | SURVIVES | Q5: #161 already has per-wave-subtree WIP; the ADAPT adds intra-plan edges, not a new DAG |
| D2 impact propagation | ADAPT | SURVIVES | Q6: portfolio prioritization is a real orchestrator cost, but only as projection (never throttle — else Q8 ornament) |
| D3 auto-transition | ALREADY-HAVE | (n/a) | Q5: #163 quiescence completion already lands this |
| D4 stagnation→review | ADAPT | SURVIVES | Q1: pm's "N consecutive failures" is event-derived (count of failure verdicts) — no clock; complements #67's silence-stall with a *failure*-stall |
| D5 review gates | ADAPT | SURVIVES | Q1: the **T-hours half fails Q1** and is REJECTed; the K-experiments half is an evidence count and survives |
| D6 opportunity cost | ADAPT | SURVIVES | Q8: only as a display projection; making it a throttle would violate "no arbitrary numeric limits" |
| A2 delta nudge | ADAPT | SURVIVES | Q3/Q8: the red-team's cry-wolf trap — an ambient briefing that fires constantly trains members to ignore it; ADAPT gates it on event-derived change and a silence floor |
| A3 idle detection | ALREADY-HAVE/REJECT | SURVIVES | Q1: pm's wall-clock idle fails Q1; #163's event-derived quiescence is the baton-native form |
| A4 auto-scaffold | ADAPT | SURVIVES | Q6: wave harvest → next-wave brief is a real recurring cost of the foundry loop |
| A5 CLI↔MCP parity | ADOPT | SURVIVES | Q5: not duplicated — baton's #147 found the surface-area cost, the parity *test shape* is the missing piece |
| A6 session handoff | ADAPT | SURVIVES | Q6: orchestrator session compaction is real ("my reality" per the agent brief); Q2: hub-managed, not per-worker |

**Zero REJECTED-BY-RUBRIC at the candidate level** — but only because the ADAPTs already internalize
the vetoes (three splits carry an explicit internal REJECT: K4's numeric confidence, K5's SQLite
layer, D5's T-hours half). The rubric's trap list (from the red-team brief) is otherwise honored
whole: every time-based gate is ADAPT-to-event-derived or REJECTed; SQLite-local thinking is REJECTed
for baton's content-addressed/git-anchored store; the 37-tool surface breadth is not proposed (baton's
#147 already found surface-area costs; discoverability over tool count).

## 5. Final prioritized adoption list — what actually deserves contracts, in order

1. **K7/A1 — computed briefing at member spawn (ADAPT, M).** The single highest-value pm idea: baton's
   `messageOnSpawn` is a fixed string; pm's `build_knowledge_briefing` (`src_mcp_dashboard.rs:22`) is a
   computed digest (recent findings + active constraints + untested hypotheses + contradictions).
   Contract it: honesty-pinned (no synthesized confidence), event-derived recency, reusing #103's
   landed L0 pack.
2. **K2 + K1 — typed contradiction/supersedes edges with explicit resolution (ADAPT, M).** Baton's
   entries are untyped notes; pm's `find_contradictions` (`src_kg_mod.rs:123`) + the Contradicts
   edge give baton the one knowledge shape its honesty law actually wants: *surface disagreement to
   the orchestrator for explicit resolution*. Keep it hub-side, drop the two-layer NLI cascade.
3. **K4 — belief_status without the confidence scalar (ADAPT, S).** `believed/suspended/retracted`
   with dependent suspension (pm's TMS `pm_set_belief`) is the honesty surface; the 0.0–1.0 MAD
   confidence is a lie surface and stays out.
4. **D4 — repeated-failure stagnation → forced review (ADAPT, S).** Event-derived (count of failure
   verdicts), complements #67's silence-stall with a *failure*-stall the foundry loops actually
   exhibit.
5. **A4 — auto-scaffold on wave harvest (ADAPT, S).** Wave harvest → next-wave brief skeleton
   materializes; closes a real loop in the foundry method.
6. **A2 — delta-aware re-briefing (ADAPT, S).** Only-what-changed on `nudgeOnCheckpoint`,
   cry-wolf-guarded (event-derived delta + silence floor).
7. **A5 — CLI↔MCP parity test shape (ADOPT, S).** Their `--all` double-execution bug is baton's
   #147/#159 class; adopt the *test shape*, not their tool surface.
8. **D1 — intra-plan dependency edges in the #161 plan object (ADAPT, M).** Lower priority: waves are
   mostly flat by design; dependencies matter only when a wave's subtree is blocked.

Deferred (real but not contract-worthy yet): K3 staleness (S), K6 auto-link-on-elevate (S), D2/D6
portfolio projection (S), A6 session handoff (S), K5 multi-signal atlas retrieval (M).

## 6. What pm does better than baton — stated plainly

pm is a **research journal with a query surface**; baton is a **work orchestrator with a control
law**. For the half of the operator's job that is *long-horizon single-researcher R&D* — hypotheses
with stable IDs (H#/E#/F# sequence labels, `src_kg_mod.rs`), experiments, findings that can be
traversed, contradicted, and re-briefed — pm's shape is genuinely better than baton's. Baton's
scratchpad produced **13 worker-scoped entries in the whole campaign** (channel-audit `knowledge.md`),
none of which carry a stable finding identity; pm gives every finding a `project_seq` ID and a typed
graph to query it by. pm's DAG also answers "what's next" deterministically (impact-sorted actionable
phases, `next_phases`), which baton's waves do not compute. And pm's per-project briefing at
`session_init` is a real ergonomic win for a human resuming work after a gap — baton's fixed
`messageOnSpawn` is not.

The honest division is therefore: **pm is right for the research-journal half; baton is right for the
multi-worker orchestration half.** The adoption list above is exactly the subset of pm's
journal-strengths that baton can take *without* importing pm's wall-clock machinery (staleness-by-days,
review-after-T-hours, idle-on-clock), its SQLite locality (baton is content-addressed/git-anchored),
or its fabricated-precision confidence scalar. Those three are the price of pm's shape, and baton
should refuse to pay them — which is what the rubric's vetoes encode.

## 7. Judgment-call record (mine)

- **Coordinator synthesis vs row derivation (§0):** I chose to write the merge from the briefs'
  candidate lists + the digest rather than emit an empty file or wait indefinitely. Judgment: the
  harvest requires a `PM-QA v1` artifact; emitting an honest "rows absent" artifact beats a silent
  dead end or a fabricated attribution to rows that never wrote.
- **K7==A1 dedup:** the kg row and agent row both name the computed briefing; I merged them and sized
  once (M). Judgment: one contract, not two.
- **No DECISION_REQUEST (§2):** the rows-absent question is an orchestrator-side dispatch fact, not an
  authority ambiguity I can resolve; flagging it in §0 is the honest ceiling.
- **A5 as the only ADOPT:** adopting a *test shape* (not a mechanism) is the only candidate clean of
  every veto; I kept that distinction explicit rather than inflate the ADOPT count.

## Bottom line

The wave's four comparison rows were dispatch-deferred at verification time; this coordinator file is
the single synthesis, built from the briefs' candidate universe and the pm ground-truth `.rs` sources,
with no attribution fabricated to any row. 15 ADAPT (3 with internal REJECT splits), 2 ALREADY-HAVE,
1 REJECT, 1 ADOPT — all rubric-checked, none REJECTED-BY-RUBRIC at the candidate level because the
vetoes are already internalized. The one contract that matters first: **computed, honesty-pinned
member briefings**, followed by typed contradiction edges and belief_status. pm wins the
research-journal half outright; baton should take that half's shape and refuse its clocks, its
SQLite-locality, and its confidence scalar.
