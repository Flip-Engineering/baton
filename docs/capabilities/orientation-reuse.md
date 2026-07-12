# Cartographer & Quartermaster — baton's Orientation & Reuse capability module

*One code-intelligence spine, two faces. The **Cartographer** builds a shared, cached map of an unfamiliar repo and serves orchestrator-steered attention slices to workers. The **Quartermaster** brokers "build vs borrow" — vetting OSS candidates and recording provenance so no two workers re-litigate the same dependency. They share one artifact (a per-SHA code graph) and one discipline (evidence promoted into the knowledge plane).*

## Summary (5 bullets)

- **The map is a fleet artifact, not a per-worker habit.** Repo-mapping (tree-sitter+PageRank à la Aider, LSP à la Serena, SCIP à la Sourcegraph) is expensive; N workers each re-orienting to the same repo is N× compute *and* N× orchestrator-context burn. Baton builds the map **once per `(repo, commit_sha)`**, CAS-deduped like a task claim, caches it in the artifact registry, and serves **token-bounded, addressed slices** — never a whole-repo dump.
- **Orientation is push, addressed, minimal — and the orchestrator steers it.** The marquee verb is `fleet_orient_worker(w, focus)`: "this change touches the auth boundary; here's the subgraph." This is doc 08 §2.1's rule (downward context is pushed and scoped, not a similarity fan-out into a shared brain) made into a control primitive that plugs into the doc 05 §6 steering cadence — including *re-orienting* a worker mid-task when the scope-drift derived signal fires.
- **Reuse is a gated broker over supply-chain evidence.** AI agents hallucinate/mis-pick dependencies at scale (Endor Labs 2025: only **1 in 5** AI-suggested dependency versions were safe). A fleet multiplies that and the blast radius (Shai-Hulud npm worm, Sept 2025). `fleet_reuse`/`fleet_vet` sit in front of every `dependency_added`, backed first by free **deps.dev + OSV + OpenSSF Scorecard + license/provenance**, with commercial Socket only as optional enrichment, and cache the verdict fleet-wide.
- **One graph serves both faces.** The Cartographer's graph is the future substrate for **reachability prioritization**, but incomplete static reachability may never clear a known package-level advisory. And "borrow" includes borrowing *internally* — before reinventing, `fleet_reuse` asks the map whether the repo already does it.
- **Both outputs become durable fleet knowledge.** Reuse decisions promote to doc 08's epistemic layer as `pm_decision`-shaped records with `Informed` edges to their evidence; the architecture brief's module summary becomes a Finding; the map itself is git-versioned (the repo is the memory). Cross-run recall is explicit (`fleet_recall`), never auto-injected (doc 08 §7 Q3).

## The problem for an agent fleet (why harness-native tools are insufficient)

Every worker harness *already* has orientation tools: Claude Code and Codex both grep, read files, and follow references on their own. So why a module? Because harness-native orientation is **per-agent, per-turn, and invisible to the fleet** — three properties that are fine for one interactive coder and pathological for an orchestrated fleet:

1. **N× redundant orientation, paid in the scarcest resource.** doc 05 §3 states baton's law: *the orchestrator's context is the scarcest resource in the system.* A worker that spends 40 tool calls and 15k tokens grokking the auth module produces nothing reusable — and if five workers touch that module across a run, that's five independent, uncached, un-compared explorations. Aider's own benchmarks show a ranked repo map beats naive file-inclusion on edit accuracy; RepoGraph reports **+32.8% relative** on SWE-bench from a repo-level code graph, LocAgent/KGCompass show graph-guided localization wins. The fleet should compute that graph **once** and amortize it, exactly the way doc 08 §3b treats the repo as shared memory and the registry as its index.

2. **Orientation is un-steerable when it lives inside the worker's turn.** A CLI turn is synchronous (doc 04 "event-loop problem"). While a worker is autonomously spelunking, the orchestrator cannot say "you're in the wrong subsystem — the change touches the auth boundary, here's the map." Harness-native repo maps (Aider's personalizes to *chat files*; Cursor/Amp index for *their own* agent) have no notion of an **external conductor scoping a worker's attention**. Baton's whole thesis is control-plane steering; orientation is the highest-leverage thing to steer, because misorientation is silent and confident. The scope-drift signal already exists (doc 05 §2); the missing half is a corrective push that *re-narrows* attention.

3. **Dependency choices are unilateral, unvetted, and un-deduplicated.** This is the sharper multi-agent failure. Each worker independently decides to `npm install`/`cargo add` something. At fleet scale that means: inconsistent choices across workers (two JSON libs, two JWT libs merged into one PR set), an **N× unvetted attack surface**, and exposure to slopsquatting/dependency-confusion — the Endor "80% of AI-suggested dependencies carry risk" finding, and the arXiv result on registry-provenance defenses against dependency confusion *in AI package ecosystems* specifically. A harness has no shared allowlist, no memory that worker-2 already rejected `left-pad-2`, and no gate before the malicious package lands in a worktree. The fleet needs a **single broker with a shared, provenance-tracked decision cache** — precisely the coordinative+epistemic pattern baton already owns, applied to "build vs borrow."

The orchestration angle in one line: **orientation and reuse are fleet-shared state with concurrent writers and expensive-to-compute artifacts — the exact shape doc 08 says belongs in the hub (coordinative) and promotes into the KG (epistemic), not inside each harness.**

## Prior art

| Tool / system | What it does | 2025-26 status | What baton borrows | What baton rejects |
|---|---|---|---|---|
| [Aider repo map](https://aider.chat) ([DeepWiki](https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system)) | tree-sitter def/ref tags → NetworkX **PageRank** over the symbol graph → token-budgeted ranked context | Mature, widely copied ([RepoMapper](https://github.com/pdavis68/RepoMapper), MCP ports) | Ranked, **token-bounded** map; "not all symbols are equal — centrality is the ranking prior" | *Chat-file* personalization (single-session) — the fleet personalizes by **orchestrator focus** instead |
| [Serena](https://github.com/oraios/serena) (oraios) | LSP-backed MCP: `find_symbol`, `find_referencing_symbols`, edit by **symbol path** (`Class/method`, not line numbers); 30+ languages | OSS (MIT), active; the de-facto "IDE for your agent" | **Symbol-path addressing** (stable across edits, composable) + LSP precision as the rung-2 backend | Whole-toolkit adoption; baton needs a *hub-shared cache*, not a per-agent LSP session |
| [SCIP](https://scip-code.org/) / [Sourcegraph precise nav](https://sourcegraph.com/docs/code-navigation) | Language-agnostic, **compiler-accurate**, cross-repo, **incremental** index (reindex only changed files) | SCIP is the standard (rust-analyzer, Searchfox, Glean emit it); 45k+ repos indexed on sourcegraph.com | SCIP as the durable **incremental** index format; invalidate-per-commit | Requiring a Sourcegraph deployment; enterprise gating |
| [Sourcegraph Cody → Amp](https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans) | Cody (context-aware assistant), Amp (agentic) | **Cody Free/Pro discontinued Jul 2025**; Cody Enterprise-only ($59/mo); **Amp spun out Dec 2025** | The lesson: keep the index **local/free**, don't build on a product that can be sunset | Betting the module on a vendor SaaS |
| [code2prompt](https://github.com/mufeedvh/code2prompt) / [Repomix](https://repomix.com/) / gitingest | Pack a repo into one AI-friendly file; token counting; glob/.gitignore filters | Very active (Repomix ~21k★, JSNation 2025 nominee) | Token-counted packing for the brief artifact; glob-scoping | **Whole-repo dump** — context-blind, burns the scarcest resource; the opposite of addressed slices |
| [ast-grep](https://github.com/ast-grep/ast-grep) | tree-sitter **structural** search/rewrite, polyglot, Rust | Active (v0.44, Jul 2026) | The deterministic "find all call-sites of pattern X" primitive behind `fleet_locate` (precise > semantic for structural queries) | Nothing — used as-is |
| [RepoGraph / CodexGraph / LocAgent / KGCompass](https://arxiv.org/pdf/2503.09089) | Repo-level code graphs for LLM localization | Peer-reviewed (ICLR/NAACL 2025); +32.8% rel. SWE-bench | Evidence that **graph localization works**; the "locate then orient" flow | Bespoke per-paper graph schemas — baton standardizes on SCIP+tags |
| [Graphify](https://graphify.net/) / Codebase-Memory | Self-updating tree-sitter KG **as an MCP skill**; NetworkX + **Leiden** community clustering | OSS, 2025-26; Claude Code/Codex/OpenCode skill manifests | **Community detection → module/architecture summary**; self-update on commit | Neo4j/graph-DB as a hard dependency for the MVP |
| [AGENTS.md](https://github.com/openai/agents.md) | "README for machines" — human-authored conventions | Open standard (OpenAI/Google/Cursor/Sourcegraph, Aug 2025); **60k+ repos**; donated to Linux Foundation's Agentic AI Foundation Dec 2025 | Read as the **conventions seed/prior**; the map *augments* it, doesn't replace it | Treating it as complete — it's a prior, the computed map is the structure |
| CODEOWNERS | path → owning team/reviewer | Ubiquitous; gates who merges agent PRs | The **boundary map** — "this diff touches /auth ⇒ auth-team boundary" feeds attention-steering | Using it as authorization (that's the OS sandbox, doc 05 §5) |
| [deps.dev](https://deps.dev/) + **GOSSIP** (Google Open Source Insights) | Free API/BigQuery: **computed** dep graph, licenses, OSV advisories, OpenSSF Scorecard, health signals; GOSSIP flags abandoned projects | Live, free; 50M+ versions; GOSSIP launched 2025-26 | **Primary evaluation oracle** — quality/security/license/maintenance in one free call | Nothing — it's the backbone |
| [OSV / OSV-Scanner](https://openssf.org/blog/2026/05/20/detecting-malicious-packages-using-the-osv-api/) + OpenSSF **Malicious Packages** feed | Vulnerability + **malicious-package** detection | OpenSSF, active | The **malicious-package tripwire** (block Shai-Hulud-class) | — |
| [Socket](https://socket.dev/) | Static/behavioral package analysis (install scripts, network, obfuscation), **AI malware detection**, real-time zero-day | Commercial; npm-registry integrated; AI-malware default "warn" Apr 2026 | **Behavioral** signals CVE DBs lack yet (novel malware) | Hard paid dependency — used as an optional enrichment tier |
| [OpenSSF Scorecard](https://openssf.org) | 18+ checks: branch protection, review, signed releases, fuzzing | Active; surfaced *inside* deps.dev | Maintenance/quality score (read via deps.dev, free) | Running it ourselves (deps.dev already hosts it) |
| [Endor Labs](https://docs.endorlabs.com/scan/sca/reachability-analysis) reachability | Which vulnerable functions are **actually called**; noise −95% | Commercial; pre-computed reachability Oct 2025; "80% of AI deps risky" report | **Reachability gating** using the *Cartographer* call graph (free, in-fleet) | The paid platform — baton reimplements the *idea* on its own graph |
| [Syft](https://github.com/anchore/syft)/CycloneDX/SPDX + Grype/Trivy | SBOM generation + CVE scan | OSS, standard stack | Fleet **SBOM as an artifact**; SBOM-diff per reuse decision | — |
| [npm provenance](https://github.blog/security/supply-chain-security/introducing-npm-package-provenance/) / [Sigstore](https://blog.sigstore.dev/npm-provenance-ga/) / [SLSA](https://slsa.dev) / [slsa-verifier](https://github.com/slsa-framework/slsa-verifier) | Cryptographic build provenance; Trusted Publishing (Jul 2025) | GA; SLSA Build L2+ | **Positive signal** — prefer attested packages; verify as a gate when present | Making provenance a *hard* gate (most packages still lack it) |
| Snyk / FOSSA / ScanCode | Commercial SCA + license | Active | License-policy patterns (use free ScanCode/deps.dev as the floor) | Proprietary as a required dependency |

## Module design

### Agent-facing interface (MCP verbs)

Two verb families in the existing `fleet_*` namespace. Worker-facing verbs are read/query; the orchestrator additionally gets the **steering** verbs. All signatures return token-bounded structured data, never prose transcripts.

**Cartographer (orientation)**

```
# Build/attach the shared per-SHA map. Idempotent by (repo, ref): concurrent
# callers CAS onto ONE build task, the rest attach. Returns immediately — the
# build is a DAG task (may be long, interruptible).
fleet_map_build(repo, ref, {langs?, budget_tokens?, incremental=true})
    -> { map_id, ref, status: building|ready|stale, task_id, cache: hit|miss }

# The workhorse: an ADDRESSED, token-bounded slice. `focus` is the scoping key.
fleet_orient(scope, {
    focus?,                       # symbol-path | path-glob | diff_ref | free-text
    shape = 'brief'|'subgraph'|'callers'|'callees'|'owners',
    budget_tokens = 1500
}) -> OrientationSlice

# Localization (Serena/ast-grep-backed). "Where is X?" without reading files.
fleet_locate(scope, query, { kind='symbol'|'concept'|'callers'|'impl_of'|'tests_of' })
    -> [ SymbolRef ]              # {sympath, file, span, kind, rank}

# ORCHESTRATOR-ONLY steering primitive. Pushes an addressed slice into the
# worker's adapter outbox (nudge-class delivery, at tool boundary — never
# mid-turn stdin, doc 05 §4). This is "this touches the auth boundary; map attached."
fleet_orient_worker(worker_id, focus, note, { shape, budget_tokens })
    -> { ack, delivered_at, slice_id }
```

**Quartermaster (reuse & provenance)**

```
# "I need capability X (e.g. JWT verification). Borrow or build?" Checks the
# fleet decision cache FIRST (dedup), then the internal map (does the repo
# already do it?), then ranks vetted OSS candidates.
fleet_reuse(need, { ecosystem, context_ref? })
    -> ReuseVerdict   # {cache_hit?, internal_match?, candidates:[...], recommendation}

# Deep dossier on one specific package@version. Reachability-enriched via the map;
# reachability may prioritize review but never waive policy or evidence gates.
fleet_vet(package, version, { ecosystem })
    -> DependencyDossier

# Record a build-vs-borrow decision → fleet allowlist + knowledge plane.
# Immutable; a change is a new record with a Supersedes edge (PM pattern).
fleet_reuse_decide({ need, choice: 'borrow'|'build', rationale,
                     dossier_claim, sbom_claim, supersedes? })
    -> { decision_id }

# `internal` remains a separate planned choice until an exact reuse.internal
# artifact can be freshly reverified and promoted without external-dossier fiction.

# The fleet's current provenance posture: SBOM, license report, open risks.
fleet_provenance(scope, { format='cyclonedx'|'summary' })
    -> { sbom_ref, license_posture, unresolved_risks:[...] }
```

Anti-pattern refused, mirroring doc 05 §6's ban on `fleet_chat`: there is **no `fleet_reuse` auto-install**. The tool *recommends and records*; the worker still runs the install in its sandboxed worktree (the OS sandbox stays the authorization boundary, doc 05 §5). And there is no "orient the whole repo" verb — every slice is budgeted and focused by construction.

### Integration with the three planes

**Operational (ledger).** Extend the closed `BatonEvent` kind taxonomy (doc 05 §1) with a `knowledge.*` family — the natural home for capability-plane facts:

- `knowledge.map_built` `{map_id, ref, langs, symbols, edges, build_ms, backend: tags|lsp|scip}`
- `knowledge.map_served` `{slice_id, worker, focus, shape, tokens}` — so orientation is auditable and the orchestrator's *steering* is visible (no invisible hand, doc 05 §4).
- `knowledge.reuse_evaluated` `{need, ecosystem, candidates_n, cache: hit|miss}`
- `knowledge.reuse_evidence_reverified` `{decision_digest, evidence_projection_digest, dossier_digest, sbom_digest}` (Coordinator-authored and globally mapped)
- `knowledge.reuse_decided` `{decision_id, subject_digest, choice, exact_coordinate, evidence_refs, supersedes?}` (actor comes only from authenticated authority)
- `knowledge.provenance_recorded` `{sbom_ref, added:[pkg@ver], risk_delta}`
- `health.dependency_risk` `{package, severity, reachable: yes|no|unknown}` — a derived signal, surfaced in `fleet_wait` digests alongside budget/loop/scope-drift.

Long operations (whole-repo SCIP index, deep transitive vet) are **DAG tasks**, so they inherit interruption for free: `fleet_interrupt` on the build task, quiesce per doc 05 §4.

**Coordinative (task-DAG + artifact registry).**
- The map is a **fleet-scoped artifact** keyed `(repo, commit_sha) → map_ref` (SCIP index + tags + PageRank ranks + module summaries). Building it is a task with `deps: []` that **CAS-dedupes** exactly like a task claim (doc 08 §4) — two workers requesting the same SHA don't both build; the loser attaches. Incremental rebuild on a new commit is a task that `refines: prior_map_task` and produces a new immutable snapshot; a worker on a divergent worktree reads the snapshot matching *its* HEAD.
- The **fleet allowlist / reuse-decision cache** and the **fleet SBOM** are fleet-scoped registry artifacts. A decision is immutable; supersession appends a record with a `Supersedes` edge. The shipped subject key binds configured repository/effective tree, normalized need, exact coordinate, Atlas epoch, and policy hash; exact request preflight avoids repeated reverify work, and concurrent supersession uses validity-version CAS.
- Nothing here is a shared *mutable* blob (doc 08 §4's cardinal rule): the map is per-SHA immutable, the allowlist is append-only, the SBOM is derived.

**Epistemic (knowledge plane, doc 08 §5).** These are precisely the "cheap, high-value epistemic artifacts" doc 08 says to promote selectively — not a second brain, an export at boundaries:
- Each accepted **reuse decision** now promotes locally to an actor-observed Decision with required rationale and `Informed` edges to derived dossier/SBOM Findings. Evidence integrity, TTL, policy, effective-tree overlay, and exact lockfile are reverified; “derived” is deliberately not “verified safe.” This satisfies doc 08 §2's **temporal-coherence** invariant without claiming true vulnerable-function reachability. Optional deployment-neutral export remains later; there is no PM or homelab runtime integration.
- The architecture brief's **module summary** (from community detection) promotes to a durable Finding per module — the reusable "what this repo *is*."
- Cross-run recall is **explicit and pull-only**: `fleet_recall("has anyone vetted a JWT lib for this repo?")` hits the decision cache; never auto-injected into a worker's context (doc 08 §7 Q3 — avoid re-poisoning).

**How the orchestrator steers.** `fleet_orient_worker` is the addressed push (doc 08 §2.1). The cadence follows doc 05 §6: brief well → let it cook → **intervene on signal**. New closed-loop move: scope-drift derived signal fires (worker editing outside the brief's path scope) → orchestrator issues `fleet_orient_worker(w, focus=brief.scope, note="you've drifted into /billing; the change is scoped to /auth — map attached")` — a *corrective re-orientation*, not just a nudge. Delivery is outbox/tool-boundary (doc 05 §4), voidable by interrupt.

**How it's interrupted.** Builds/vets are DAG tasks → `fleet_interrupt`/quiesce. An `fleet_orient_worker` push is a queued nudge → flushed by interrupt with the voided `slice_id` listed in the ack, same as any outbox item.

### Agent-ergonomic output shape

An `OrientationSlice` for `focus="auth token refresh"`, `budget_tokens=1500` — everything symbol-path addressed (composes with edits), ranked, with an explicit "start here" and the ownership boundary the orchestrator cares about:

```yaml
slice_id: sl_9f2, ref: a1b3c9d, tokens: 812, backend: lsp
focus: "auth token refresh"
module: auth/                 # Leiden community #3, 14 files
summary: >
  JWT issue+refresh. Entry: AuthService.refresh(); verifies via
  TokenStore, re-signs with KeyRing. Refresh tokens are single-use
  (rotation in TokenStore.rotate). Depends on: crypto/KeyRing, db/Session.
start_here:
  - sympath: auth/AuthService.refresh         # rank 0.91  src/auth/service.ts:142-190
  - sympath: auth/TokenStore.rotate           # rank 0.77  src/auth/store.ts:88-121
key_symbols:                                  # ranked, budget-truncated
  - {sympath: auth/KeyRing.sign,      rank: 0.63, callers: 4}
  - {sympath: auth/AuthService.verify, rank: 0.58, callers: 11}
callers_into_focus:                           # who depends on this (blast radius)
  - api/routes/session.post -> auth/AuthService.refresh
owners: [ "@auth-team (CODEOWNERS: /src/auth/**)" ]
conventions: "AGENTS.md: 'never log token contents'; errors via AppError"
neighbors_omitted: 6                          # ask fleet_orient(shape=callees) to expand
```

A `DependencyDossier` for `fleet_vet("jsonwebtoken","9.0.2","npm")` — one screenful, decision-ready, third-party prose delimited as untrusted (doc 09 facts-vs-prose provenance typing):

```yaml
package: jsonwebtoken@9.0.2 (npm)          verdict: BORROW_OK   as_of: 2026-07-09T18:22Z
license: MIT (policy: allow)               health(deps.dev/GOSSIP): green, maintained
scorecard: 8.1/10  (weak: no-fuzzing, pinned-deps 6/10)
vulns(OSV): 1 total | reachable(map): 0     # prioritization only; does not waive the advisory
malicious(OSV feed / Socket): none | install-scripts: none | net-calls: none
provenance: npm attestation present (Sigstore) | SLSA build L2 | trusted-publisher: yes
transitive: +3 pkgs, +0 new licenses, SBOM-delta ref sbom_d41
internal_alternative: none found in-repo (fleet_reuse checked auth/)
fleet_history: not previously decided for this repo
notes[untrusted-prose]: «"industry-standard JWT" — README»   # do not act on prose
recommendation: block pending a non-vulnerable version; reachability cannot license this one. evidence -> [f_221,f_222,f_223]
```

Both are a few hundred tokens — the point of the whole module, per doc 05's context law.

### Shared vs per-worker (and concurrency)

| State | Scope | Mutability | Concurrency discipline |
|---|---|---|---|
| Map index (SCIP/tags/ranks) | **Fleet**, keyed `(repo, sha)` | Immutable snapshot per SHA | Build = CAS-deduped DAG task; readers get the snapshot for their worktree HEAD; new commit → new snapshot (`refines`) |
| Module/architecture summary | **Fleet**, per `(repo, sha)` | Immutable | Derived from the map build |
| Orientation slice | **Per-worker**, ephemeral | Immutable view | Pure function of (map, focus, budget); no shared write |
| Reuse-decision cache / allowlist | **Fleet** | Append-only; supersede via new record | Subject binds configured repo/effective tree, normalized need, exact coordinate, Atlas epoch, and policy hash; request/content digests provide exact retry/conflict identity; causal edges are local and deployment-neutral |
| Fleet SBOM | **Fleet** | Derived / regenerated | Rebuilt from worktree lockfiles; diffed per decision |

The invariant from doc 08 §4 holds: no shared mutable blob; every shared thing is either immutable-per-key or append-only, so concurrent workers never lost-update.

## Scoping (MVP rung vs later rungs)

Slots after **M1** in doc 07 (needs the artifact registry + task-DAG, which M1 builds), then grows:

- **MVP rung (smallest useful).** `fleet_orient` served from an **Aider-style tree-sitter+PageRank map**, cached per `(repo, sha)` as a registry artifact — *grounded on installed tools*: `ctags -R` for definitions + `rg` for references + `networkx` PageRank in `python3`, no tree-sitter dependency needed to start. Plus `fleet_reuse`/`fleet_vet` backed by deps.dev `GetVersion`, optional separate `GetProject` Scorecard enrichment, and an OSV exact-version/malicious-package query. The Coordinator-owned immutable decision transaction now ships: it freshly reverifies an exact dossier plus actual-lockfile SBOM, projects deployment-neutral causal knowledge, and grants no install or mutation authority. `fleet_orient_worker` ships here too; it's cheap once slices exist and it's the differentiator.
- **Rung 2.** LSP/Serena precision (symbol-path addressing, `find_referencing_symbols`), **SCIP incremental** index (reindex only changed files on commit), **Socket** behavioral enrichment, and the cross-module payoff: **reachability gating** = the map's call graph × OSV (deprioritize unreachable vulns). ast-grep behind `fleet_locate(kind=callers)`.
- **Rung 3.** Promotion into the **PM epistemic KG** (decision records with causal `Informed`/`Supersedes` edges, temporal-coherence checks), `fleet_recall` cross-run, **Syft SBOM + Sigstore/SLSA provenance verification** as a gate, and **Leiden community-detection** architecture summaries. `lldb`/`clang` optional dynamic-reachability for C/C++/native.

## Limitations & honest residuals

- **Centrality ≠ task relevance.** PageRank/betweenness is a *prior*, not truth; the real signal is the orchestrator's `focus`. So the module's value is bounded by the orchestrator's judgment — and a *confidently wrong* orientation push (`fleet_orient_worker` to the wrong subsystem) misleads exactly as efficiently as a right one helps. Attention-steering is a loaded gun.
- **Map staleness vs cost.** Per-SHA immutability is clean but a hot worktree churns the cache; tree-sitter def/ref maps must be diffed or rebuilt (only SCIP is truly incremental, and only for languages with a SCIP indexer). Cross-file semantic edges need a live language server per language — heavy, and LSP quality is uneven (great for TS/Go/Rust, weak for dynamic/templated/DSL code).
- **Reachability is advisory, never a shipping license.** Call graphs are incomplete for reflection, dynamic dispatch, DI, `eval`, FFI. A false "unreachable" that deprioritizes a real vuln is a security regression. Rule: reachability may *reorder* attention; it may **never** be the reason to ship a known-vulnerable, non-attested dependency.
- **Verdict freshness — the Shai-Hulud problem.** A package safe yesterday is malicious today (compromised maintainer, worm). Caching a `BORROW_OK` verdict by `(package, version)` alone is unsafe; every cached decision needs a TTL **and** advisory-feed invalidation, and the ledger's temporal-integrity rule (doc 08 §2.2) means the dossier's `as_of` timestamp is load-bearing — a decision inherits the staleness of its evidence.
- **Third-party metadata is an injection surface.** Package READMEs, descriptions, and even symbol docstrings are untrusted content (doc 06 Q4). Dossiers and slices must delimit third-party prose as untrusted `prose` (doc 09 facts-vs-prose typing); an agent must never *act* on a package's self-description.
- **Human-authored priors can lie.** AGENTS.md and CODEOWNERS drift; the computed map can contradict them. The module surfaces both and flags disagreement (`conventions` vs observed structure) — it does not silently pick a winner.
- **External-oracle dependency.** deps.dev/OSV/Socket are network services with rate limits and outages; the MVP must degrade to "unknown, blocked pending vet" rather than default-allow (mirroring doc 05 §5's deny-with-message on approver timeout). "Unknown" is a safe verdict; "assume safe" is not.
- **Build-vs-borrow is judgment the tool can only inform.** A green dossier can still be the wrong call — a well-maintained dependency you didn't need (bloat), or a license-clean package that's architecturally wrong for the repo. The module makes the decision *cheap and recorded*, not *automatic*.

## Sources

- Aider repo map — https://deepwiki.com/Aider-AI/aider/4.1-repository-mapping-system · RepoMapper https://github.com/pdavis68/RepoMapper
- Serena (LSP-backed MCP, symbol-path addressing) — https://github.com/oraios/serena
- SCIP Code Intelligence Protocol — https://scip-code.org/ · Sourcegraph precise nav https://sourcegraph.com/docs/code-navigation · SCIP-vs-LSIF https://sourcegraph.com/blog/announcing-scip
- Sourcegraph Cody plan changes / Amp spin-out — https://sourcegraph.com/blog/changes-to-cody-free-pro-and-enterprise-starter-plans
- code2prompt — https://github.com/mufeedvh/code2prompt · Repomix https://repomix.com/
- ast-grep — https://github.com/ast-grep/ast-grep
- Graph-guided localization (RepoGraph/LocAgent/CodexGraph/KGCompass) — https://arxiv.org/pdf/2503.09089
- Graphify (tree-sitter KG MCP skill) — https://graphify.net/ · Codebase-Memory https://arxiv.org/html/2603.27277v1
- AGENTS.md standard — https://github.com/openai/agents.md · InfoQ https://www.infoq.com/news/2025/08/agents-md/ · Agentic AI Foundation https://openai.com/index/agentic-ai-foundation/
- deps.dev / Open Source Insights + GOSSIP — https://deps.dev/ · API https://blog.deps.dev/api/ · GOSSIP https://blog.deps.dev/gossip/index.html
- OSV / malicious-packages via OSV API — https://openssf.org/blog/2026/05/20/detecting-malicious-packages-using-the-osv-api/
- Socket (behavioral supply-chain) — https://socket.dev/ · CISA Shai-Hulud npm compromise https://www.cisa.gov/news-events/alerts/2025/09/23/widespread-supply-chain-compromise-impacting-npm-ecosystem
- OpenSSF Scorecard / supply-chain stack (Syft+Grype+OSV+Scorecard+cosign) — https://www.minimus.io/post/software-supply-chain-security-tools
- Endor Labs reachability + "80% of AI deps risky" — https://docs.endorlabs.com/scan/sca/reachability-analysis · https://www.prnewswire.com/news-releases/endor-labs-launches-2025-state-of-dependency-management-report-finds-80-of-ai-suggested-dependencies-contain-risks-302603438.html
- npm provenance / Sigstore / SLSA — https://github.blog/security/supply-chain-security/introducing-npm-package-provenance/ · https://blog.sigstore.dev/npm-provenance-ga/ · slsa-verifier https://github.com/slsa-framework/slsa-verifier · deps.dev npm SLSA provenance https://blog.deps.dev/npm-provenance/ · registry-provenance vs dependency-confusion in AI ecosystems https://arxiv.org/pdf/2605.03309

---

# Appendix: Design critique (workflow critic pass)

The user wants me to be a design critic. Let me first read the referenced docs for context before critiquing. The dossier references several docs. Let me find them. The paths use "undefined/" prefix which is odd — probably meant to be relative to the baton repo. Let me look at the actual repo structure.

Let me start by exploring the repo to find the docs.
