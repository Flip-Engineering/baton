# project-manager knowledge-graph cross-check — review

| | |
|---|---|
| Attempt | `kg-2026-08-12T01:32:55.389Z` |
| Date | 2026-08-12 |
| Worker | glm (research seat) |
| Scope | Compare the **project-manager** (PM) sibling project's knowledge-graph approach against baton's tiered KG model; name the top-3 actionable borrowings. |
| Deliverable | This file (the only file edited). |

> Read-order and laws come from `docs/reference/evidence/kg-cross-check-2026-08-12/research-brief.md`. Every claim below cites the file it was read from. Baton-side claims cite this worktree's source/spec files at exact lines. PM-side claims cite the sources actually reachable from this machine and are **flagged where they are reconstructed rather than read from the PM source tree**.

---

## 0. Bottom line up front

1. **The PM repo is not on this machine, and its host is unreachable from this sandbox.** PM is installed on `atari-homelab`; the only local artefacts are a thin Claude Code command plugin (`$HOME/.claude/plugins/local/project-manager/`), one web-UI screenshot (`$HOME/Documents/project-manager-webui.png`), and the CLI surface recorded in the operator's `~/CLAUDE.md`. SSH to `atari-homelab` timed out (`ssh: connect to host … port 22: Operation timed out`). The PM analysis below is therefore **reconstructed from those three sources**, not from PM's schema/graph modules. §1 says so plainly, per the brief's law.

2. **The headline finding inverts the naive expectation.** Baton's KG type registry is *already a superset* of PM's visible schema. `coordination-store.mjs:148-149` registers 19 node kinds — including `Experiment`, `Phase`, `Literature`, `Question`, `Hypothesis`, `Principle`, `Research`, `Skill` — and 14 edge kinds, including **`Supports`** and **`Contradicts`** (PM's only two visible edge types). But baton's promotion machinery only ever *populates* a narrow control-plane subset; the research-flavoured node kinds are **registered-but-dormant** (zero mint sites in `impl/src`). PM's distinctive value is that it **actively populates exactly those dormant kinds** and *derives* impact/stagnation health from them. The borrowings are therefore about **activating baton's own dormant vocabulary via PM's population patterns**, not about importing types baton lacks.

3. **The settlement ritual is landed and driver-wired** — correcting the 2026-08-01 verdict's "ritual unreachable" gap (F1). `docs/PROGRESS.md:436` records "#63 KG SETTLEMENT LANDED"; the wave driver runs the `kg-ritual` settle-window by default (`wave-driver.mjs:65-68`, `:780-797`). So the seams the borrowings ride are live, not aspirational.

---

## 1. Sourcing truth (the law: read-only outside this repo; cite every claim)

### 1.1 What was read for project-manager (and what was NOT)

PM's own repo (schema, graph/memory modules, migrations) was **not readable** — it is not present under `~/Development` (which contains only `baton` among operator projects), and `atari-homelab` (where `/usr/local/bin/project-manager` is installed) is unreachable from this sandbox. The PM model below is reconstructed from three locally-available sources, each cited inline:

| Source | Path | What it yields |
|---|---|---|
| Claude Code plugin | `$HOME/.claude/plugins/local/project-manager/CLAUDE.md`, `…/.claude-plugin/plugin.json`, `…/commands/{dashboard,next,review,scaffold}.md` | The command surface (all SSH to atari-homelab); `plugin.json:4` self-describes *"Research project management with DAG phases, KG findings, and cross-project dashboard"*. |
| Web-UI screenshot | `$HOME/Documents/project-manager-webui.png` ( analysed) | The KG schema as rendered: node kinds **Finding** (blue) / **Experiment** (green) / **Decision** (orange); edge kinds **Supports** (green) / **Contradicts** (red); views *Research Dashboard*, *Knowledge Graph*, *Phase DAG*. |
| Operator CLAUDE.md | `$HOME/CLAUDE.md` ("Research Project Management") | The CLI object surface: `journal`, `experiment <name> <config> <result> <interpretation>`, `decision <what> <why> <alternatives> <phase>`, `paper <ref> <title> <findings> <relevance>`, `--project <name>`. |

Baton's own specs repeatedly acknowledge PM as **prior-art inspiration for typed causal structure** — e.g. `spec/phase48/cairn-bounded-recall.md:6-7` ("Project-manager remains local architectural inspiration for selective …"), `spec/phase49/cairn-selective-promotion.md:14-15`, `spec/phase47/cairn-causal-integrity-audit.md:107-109`, `spec/phase11/coordination-knowledge.md:4`. This corroborates that the two systems share a design lineage but does **not** substitute for PM's source — it is baton's characterisation of the relationship, not PM's schema.

> **Confidence marker.** PM entity/relation kinds and the dashboard/review/scaffold operations are well-attested by all three sources. PM's *internal* lifecycle states, storage format, and authority model are **not** attested by any available source; where this review speculates about them it says so. No claim about PM is cited to a PM source file, because none was reachable.

### 1.2 What was read for baton (full source access)

The baton side is read from this worktree and cited to exact lines. Primary anchors:

- Tiered promotion + settlement ritual — `spec/phase49/cairn-selective-promotion.md`; `impl/src/coordinator.mjs:11428`/`:11447`/`:11456`/`:11492`; `impl/src/coordination-store.mjs:14173`/`:14326`/`:16207`; `impl/src/wave-driver.mjs:65-68`/`:780-797`; `docs/34-knowledge-horizons.md:44-83`; `docs/PROGRESS.md:434-446`.
- KG data model — `impl/src/coordination-store.mjs:148-151` (type registries), `:8543-8571` (lifecycle apply fold).
- Contradiction workspace — `spec/phase53/cairn-authenticated-contradiction-ux.md`; `impl/src/coordination-store.mjs:8561-8568`/`:15858-15862`/`:16393-16416`/`:16444-16461`; `impl/src/cairn-run-scorecard.mjs:128-129`/`:449-457`.
- Recall surface — `impl/src/coordinator.mjs:10484-10529`/`:10839-10840`; `impl/src/cairn-run-scorecard.mjs:120-130`/`:249-251`; `impl/src/application-semantics.mjs:1528-1534`.
- Context-package lane (BD3-B) — `impl/src/coordination-store.mjs:13255-13280` (`mintContextPack`), `:13533-13545` (`context.read`).
- REPL objects lane (#69) — `impl/src/application-semantics.mjs:1485-1508`; `impl/src/coordination-store.mjs:477`/`:9961-10005`/`:15588-15680`/`:15772-15781`; `impl/src/context-program.mjs:294`.

---

## 2. The two systems, side by side

| Dimension | project-manager (reconstructed) | baton (cited) |
|---|---|---|
| **Purpose** | Research PM tool: plan phases, log R&D objects, surface highest-impact next action (`plugin.json:4`). | Orchestration kernel: a hub-owned causal KG fed by selective promotion from the coordination ledger (`docs/11-capability-plane.md:37-38`). |
| **Node kinds** | Finding, Experiment, Decision (webui legend); plus Journal entry, Paper, Phase, Task (CLI/`scaffold`). | 19 kinds registered (`coordination-store.mjs:148`) — a **superset** including Experiment/Phase/Literature/Question/Hypothesis — but only Run/Task/Artifact/Finding/Decision/Counterexample/Constraint/Representation/ScratchFact/Source/RouteStat are ever minted. |
| **Edge kinds** | Supports, Contradicts (webui legend); plus phase/task blocked-by (`scaffold.md:18`). | 14 kinds registered (`coordination-store.mjs:149`); closed-promotion mints Informed/ObservedIn/DerivedFrom/VerifiedBy/Supersedes/Affects; Supports/Refines/Cites are auto-derivable via the autolink scorer (`:233`, `:16677`); Contradicts is addable+resolvable (`:15858`, `:8561`). |
| **Lifecycle states** | None visible in the webui ( analyse: "None explicitly visible"). | Bi-temporal: `validFrom`/`validTo`/`validityVersion`/`invalidatedBy`/`resolvedBy`/`winnerId`/`loserId`/`resolutionReason` (`coordination-store.mjs:151`, apply fold `:8543-8571`). **Richer than PM's visible model.** |
| **Queries / ops** | `dashboard` (cross-project priority → ACTION), `next`, `review` (stagnation + impact + KG summary), `scaffold` (phase→tasks). | 8 causal ops: `causal.audit`, `causal.trace`, `causal.recall`, `causal.assess_recall`, `causal.promote`, `causal.correct_scratch`, `causal.contradictions`, `causal.resolve_contradiction` (`cairn-run-scorecard.mjs:120-130`, `:561-568`). **Provenance/contradiction-oriented**, not progress/impact-oriented. |
| **Promotion model** | Findings promoted into the KG; experiments/decisions support or contradict them (webui). Free-text bodies (CLI tuples). | Three tiers (task-ephemeral → workflow-ephemeral → project-persistent) with orchestrator-admit gate; closed, content-addressed, deterministic projection (`spec/phase49` SP3-SP7). |
| **Human surface** | Browsable: Knowledge Graph view, Phase DAG view, Research Dashboard (webui). | Internal store surfaced only as bounded **untrusted** recall slices (`coordinator.mjs:10507-10529`, frame `UNTRUSTED_RECALLED_MEMORY` at `:10839`). No human graph view. |

---

## 3. What PM's KG captures that baton's does not

The framing is deliberately precise: it is not "PM has kinds baton lacks" — baton *has* the kinds. It is "PM **populates and exploits** kinds that baton only **registers**."

### 3.1 Active population of research entity kinds (Experiment, Literature/Paper, Question/Hypothesis)

- **PM.** The CLI first-classes `experiment <name> <config> <result> <interpretation>` and `paper <ref> <title> <findings> <relevance>` (`~/CLAUDE.md`); the webui renders Experiment as a green node (`project-manager-webui.png`). Experiments and literature are normal KG citizens that support/contradict findings.
- **Baton.** `Experiment` and `Literature` are in `KNOWLEDGE_NODE_TYPES` (`coordination-store.mjs:148`) but are **never minted** — a grep for `type: 'Experiment'|'Literature'|'Phase'|'Question'|'Hypothesis'|'Principle'|'Research'|'Skill'` across `impl/src` returns zero construction sites. Phase 49's closed source taxonomy (`spec/phase49/cairn-selective-promotion.md:42-63`) admits only `Decision`, `Counterexample`, and `Finding`. So baton can record that a *decision* happened, but not the *experiment that produced the evidence* or the *paper that motivated it*. For research-driven deployments (this brief is one), that is a real gap: the KG cannot answer "what configuration did we already try, and what was the result?"

### 3.2 Decision with explicit alternatives + phase binding

- **PM.** `decision <what> <why> <alternatives> <phase>` (`~/CLAUDE.md`) — a Decision carries the *alternatives considered* and is bound to a *phase* in the DAG.
- **Baton.** A promoted Decision is a control-plane observation derived from `task.created` or four `driver.recorded` control kinds (`spec/phase49:46-50`), carrying trigger + a Task `Informed` edge (`:82`). It records *that* a control decision was made, not *what alternatives were rejected* and not *which phase* of a research plan it belongs to. Baton's `Decision` is operational; PM's `Decision` is research-rational.

### 3.3 Impact assessment + stagnation detection as KG-derived health axes

- **PM.** `review` runs "stagnation detection, impact assessment, KG summary" and emits a STAGNATION/WARNING signal that *drives re-planning* (`commands/review.md:6-7`); `dashboard` computes "highest-impact action across all active projects" (`commands/dashboard.md`, `plugin.json:4`). The KG is the substrate for a *progress/health* query.
- **Baton.** No causal op computes impact or stagnation. The 8 ops (`cairn-run-scorecard.mjs:120-130`) answer provenance and contradiction questions (audit/trace/recall/contradictions), not "is this line of work stalled?" or "which finding has the most downstream support?" The run scorecard (`cairn-run-scorecard.mjs`, Phase 31) scores a *single run*, not the cross-finding health of the project KG.

### 3.4 A human-browsable, navigable graph

- **PM.** The webui offers *Knowledge Graph* and *Phase DAG* views — the graph is an artefact a human steers against.
- **Baton.** The KG is surfaced only as bounded, untrusted recall slices injected into provider-facing briefs (`serveKnowledge`, `coordinator.mjs:10507-10529`) or pulled on demand (`recallKnowledge`, `:10484-10505`). There is no browsable graph projection for the operator. (Baton's deliberate stance — recall is a *read* surface, never ambient instruction — but it means the KG is invisible as a steering artefact.)

### 3.5 Cross-project priority

- **PM.** `--project <name>` plus a cross-project `dashboard` rank orders work *across* projects (`~/CLAUDE.md`, `commands/dashboard.md`).
- **Baton.** Single `repoId`/project-key scope (`spec/phase49:19-32`; recursive project-key GLM is per-deployment). There is no cross-project plane — see §6 (rejected borrowing).

> **Axis where baton is stronger — lifecycle.** PM exposes no explicit node lifecycle states ( analyse found none). Baton's bi-temporal projection (`coordination-store.mjs:151`, applied at `:8543-8571`) gives every node `validFrom`/`validTo`/`validityVersion` plus contradiction `resolvedBy`/`winnerId`/`loserId`. Baton can answer "what did we believe *as of* boundary B, before finding F2 contradicted F1?" — PM's visible model cannot. This is not a PM capture; it is a baton capture PM lacks.

---

## 4. What baton's settlement-review promotion does that PM's does not

This is where the gap runs the other way. Baton's promotion is an *admission-controlled, cryptographically-receipted, safety-isolated* pipeline; PM's (from its CLI surface) is *logging*.

1. **Three-tier promotion with cryptographic admission authority.** task-ephemeral → workflow-ephemeral → project-persistent (`docs/34-knowledge-horizons.md:44-83`; store tiers `coordination-store.mjs:14173` elevate / `:14326` settle / `:16207` admit). Promotion is orchestrator-owned, lease-bound, session-bound, ACI-idempotent: `admitWorkflowFinding` binds `actor:'orchestrator'` under the run-orchestrator lease with idempotency key `knowledge.workflow_admitted:<id>` (`coordinator.mjs:11428-11443`); the orchestrator-admit gate is explicit — "No silent auto-promotion of run-scoped claims into persistent truth" (`docs/34-knowledge-horizons.md:77-83`).
2. **Closed, deterministic, content-addressed projection.** Promotion never copies raw briefs, values, secrets, paths, or payloads — only closed digests/identifiers, byte-bounded with max+1 ceilings, all-or-nothing (`spec/phase49` SP4-SP6, `:65-96`). PM's CLI tuples are free-text by construction.
3. **Causal grounding enforcement.** A scratch Finding promotes only with `grounding:'observed'`, ≥`minScratchReaders` distinct completed readers, and a live `verified_task_outcome` `VerifiedBy` Task edge (`spec/phase49:54-58`, `:84-85`). Derived/uncited/expired/cross-repo scratch is quarantined (`:60-63`).
4. **Pinned critical-audit gate.** Before any candidate is derived, the Phase 47 bounded audit re-runs at the pinned `observedSeq`; any violation refuses with no mutation (`spec/phase49:34-40`; `cairn-run-scorecard.mjs:330`).
5. **Authenticated contradiction *resolution* calculus.** PM has a `Contradicts` *edge*; baton has a whole resolution protocol: one schema-versioned `knowledge.contradiction_resolved` event, prefix-CAS version check, loser-only invalidation, and contamination of every prior reader of the loser (`spec/phase53` CX3-CX4; `coordination-store.mjs:8561-8568` apply, `:16393-16416` derivation, `:16444-16461` entrypoint; `cairn-run-scorecard.mjs:128-129`/`:449-457`). Baton doesn't just *mark* a contradiction; it *closes* it with byte-exact replay.
6. **Safety/knowledge separation + reverify.** Promotion MUST NOT run synchronously inside stop/kill/publication paths — a knowledge-plane failure may never delay a control effect (`spec/phase49:7-9`). Every promotion receipt is read-only `reverify`-able against recomputed commitments (`spec/phase49:122-127`). Neither concept appears in PM's surface.

**Net.** Baton's settlement ritual is a *trust engine*; PM's KG is a *structured notebook*. They are optimized for different things, which is exactly why the borrowing candidates in §5 must be filtered for kernel-fit (§6).

---

## 5. Top-3 actionable borrowings

Each names (a) the PM pattern borrowed, (b) the baton seam it rides — with file:line — (c) how it rides it, and (d) a **skeptical caveat** (the brief demands this). All three activate baton's *own dormant vocabulary* rather than importing foreign structure.

### Borrowing 1 — Populate the dormant `Experiment` node via the settlement ritual

- **PM pattern.** The Experiment entity — a structured `config`/`result`/`interpretation` record — as a first-class KG citizen that supports/contradicts Findings (webui; `~/CLAUDE.md`).
- **Baton seam — the settlement ritual / `knowledge.promote`.** The orchestrator-admit gate already exists (`coordinator.mjs:11456 promoteWorkflowFinding`, `:11428 admitWorkflowFinding`; op `causal.promote`, `cairn-run-scorecard.mjs:125`/`:565`). Phase 49's SP3 is a *closed, extensible source taxonomy* — add a fifth source class that promotes a verified experiment record as an `Experiment` node (already in the registry, `coordination-store.mjs:148`) with `ProducedBy`→Task and `VerifiedBy`→verified-outcome edges, deriving `config`/`result` as **digests** (never raw payloads, honouring SP4's closed projection) plus a bounded `interpretation` body.
- **Why it rides this seam.** The ritual already does orchestrator-owned, lease-bound, content-addressed admission of verified observations; an Experiment is just a new promoted kind flowing the same gate, reusing `knowledgePromotionPolicy` ceilings and the audit gate wholesale.
- **Skeptical caveat.** Only justified for deployments that *run repeatable experiments* (research deployments — this one, Volta-Renaissance, TurboQuant). Pure control-plane deployments would leave the source class unconfigured (the capability card advertises `causal.promote` only when the policy is present — `spec/phase49:27-29`). It must stay closed: `result`/`config` are digests, not free text, or it violates the no-raw-payload law that lets baton treat promotion as trust-safe. If it cannot be closed, it does not ship.

### Borrowing 2 — Relation-aware recall + a within-deployment stagnation signal at the recall surface

- **PM pattern.** The navigable support/contradiction graph (webui) and `review`'s stagnation/impact assessment (`commands/review.md:6-7`).
- **Baton seam — the recall surface.** Today `serveKnowledge` returns flat Finding slices keyword-matched and provenance-wrapped (`coordinator.mjs:10507-10529`, capped by `FRAME_LIMITS['view.knowledge_slice.*']` at `:10514-10515`); `recallKnowledge` pulls on demand (`:10484-10505`); the causal op table (`cairn-run-scorecard.mjs:120-130`) already reserves `causal.assess_recall`. Two PM-inspired additions ride this seam: (a) **relation-aware recall** — include each returned Finding's `Supports`/`Contradicts`/`Supersedes` neighbourhood (the edges already exist; `Supports`/`Refines`/`Cites` are even auto-derived by the autolink scorer, `coordination-store.mjs:233`/`:16677`), so a recalled fact arrives *in its evidential context*; (b) a read-only **`causal.assess_horizon`** op (sibling of `assess_recall`) that derives a within-deployment stagnation signal — *absence of new `verified` Findings in a phase/area across the deployment's own pinned audit boundary* — without ever picking a winner or auto-steering.
- **Why it rides this seam.** Recall is already the bounded, framed, read-only surface where KG facts meet workers; relations and a stagnation flag are new *projections* over the same `_knowledgeNodes`/`_knowledgeEdges`/`_knowledgeReads` the recall ops already read — no new write authority, no new mutation path.
- **Skeptical caveat.** PM's *cross-project* priority dashboard does **not** fit baton (single project-key) — the stagnation signal must be **within-deployment only**. Impact/stagnation must be **advisory, never auto-steering** — baton's law keeps knowledge strictly separate from control (`spec/phase49:7-9`); the operator/orchestrator decides whether to pivot, exactly as `commands/review.md` defers the pivot to the human. And per the house no-arbitrary-limits rule, the stagnation *horizon* must be derived from the deployment's pinned `observedSeq` audit boundary (`spec/phase49:34-40`), never a magic "N runs = stalled" constant.

### Borrowing 3 — Phase DAG as a cited closed-shape planning object (REPL objects + context-package lanes)

- **PM pattern.** The Phase DAG view + `scaffold`, which decomposes a phase into task-tracker items with `blockedBy` dependencies off the phase DAG (`commands/scaffold.md:13`, `:18`).
- **Baton seam — the #69 REPL objects lane composing with the BD3-B context-package lane.** Baton hand-injects plan/phase context into worker objectives today (the #94 demo's lived context-passing and the #129 4 KiB brief-cap lesson, both cited in `docs/reference/evidence/repl-realization-2026-08-07/contract-69-brief.md:11-14`, `:24-27`). The REPL lane already ships closed-shape, cited, never-executable data objects: `repl.manifest`/`repl.binding`/`repl.cite` (`application-semantics.mjs:1485-1508`), with an exact-version citation grammar (`repl:<scope>:<name>@<version>`, `coordination-store.mjs:477`), two-tier `shared`/`worker:<id>` scope (`:9961-10005`), version-CAS binding (`:15588-15680`), and exact-version resolution (`:15772-15781`); the context-package lane mints and delivers cited packs (`mintContextPack`, `coordination-store.mjs:13255-13280`; composed into the orchestrator briefing at `:13466`). Borrow PM's phase-DAG-as-data: a content-addressed **"phase plan"** REPL object — pure DATA with citations, per the #69 house law (`contract-69-brief.md:16-20`): no arbitrary code) — that decomposes into task `DependsOn` structure (edge kind already registered, `coordination-store.mjs:149`), cited into briefs via `repl.cite` and rendered through the context-package lane.
- **Why it rides this seam.** This is precisely the "brief-by-reference replaces objective-text injection" future the #129 cap lesson points at (`contract-69-brief.md:24-27`), and `Phase`/`DependsOn` are already registered-but-dormant in baton's own KG vocabulary — so the planning object composes with, rather than duplicates, the context-package and dynamic-workflow lanes (the #69 brief's explicit composition demand, `:8-9`).
- **Skeptical caveat.** Baton's run-lineage (`impl/src/run-lineage.mjs:14-28`) is a **runtime** parent/child run tree with lease TTL/depth caps — *not* a plan. The phase DAG must stay **pure cited data**, never become a second execution model, and must not duplicate the dynamic-workflow composition surface (#79/#105). Only deployments with explicit phase structure benefit; a deployment with no phase plan simply never mints the object. This is the borrowing most at risk of over-building — it ships only if it provably retires hand-injected objective context.

---

## 6. Rejected borrowings (the skeptical filter, shown explicitly)

The brief asks which PM patterns *would not* improve an orchestration kernel. Three are rejected:

- **Cross-project priority dashboard.** Baton is single-`repoId`/project-key scoped (`spec/phase49:19-32`); there is no second project to rank against. PM's `dashboard`/`--project` model assumes a portfolio operator. **Does not fit.**
- **Human-browsable graph UI as a kernel feature.** The webui's Knowledge Graph / Phase DAG views are a PM-tool affordance for a human steering research. Baton's KG is an internal causal store deliberately exposed only as bounded untrusted recall (the trust discipline at `coordinator.mjs:10839-10840`). A graph view is a *northbound rendering* concern, not one of the four kernel seams (settlement ritual / recall / context-package / REPL), and building it into the kernel would blur the read/trust boundary. **Out of scope for a kernel borrowing** (could be a separate northbound project).
- **Free-text journal/decision bodies.** PM's CLI tuples are free-text (`journal`, `decision <what> <why> <alternatives>`) and that is appropriate for a notebook. Baton's closed-projection law (`spec/phase49` SP4) forbids copying raw prose into promoted nodes; importing PM's free-text bodies would break the property that makes promotion trust-safe. **Rejected** — borrowings 1-3 deliberately digest/clip their bodies instead.

---

## 7. Open questions + verification

**Open questions (none fold-blocking; this is a review, not a contract).**
- **OQ1.** Does PM persist an internal lifecycle/authority model richer than the webui shows (e.g., contradiction resolution, supersession)? Unverifiable without the PM source. If PM *does* resolve contradictions, borrowing 2's "relation-aware recall" partially overlaps existing baton capability and the marginal value shrinks. Resolve by reading PM's graph module on `atari-homelab` when reachable.
- **OQ2.** Is the dormant `Phase`/`Experiment`/`Literature` vocabulary in `coordination-store.mjs:148` intentionally reserved for a planned feature, or accidental over-registration? A spec/PROGRESS grep would tell whether a later phase already intends to populate them — if so, borrowings 1 and 3 *are* that phase and should be framed as "unblock the reserved feature," not "new borrowing."

**Verification.**
- Edited file: only `docs/reference/evidence/kg-cross-check-2026-08-12/project-manager-kg-review.md` (this file). No writes outside the deliverable path; all external reads (PM plugin, webui, operator CLAUDE.md) were read-only.
- Baton-side citations were live-verified in this worktree (grep/read of `impl/src` and `spec/`).
- Deployment verification command per the execution contract: `true` → expected exit `0`.
