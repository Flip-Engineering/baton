# baton

**Cross-harness agent orchestration research.** Can an orchestrator agent running in one full coding harness (Claude Code CLI, Codex CLI) direct *other* full-session harnesses (Codex CLI, Claude Code CLI, Z.ai GLM harness) as subordinate workers — with real messaging, telemetry, and mid-flight interruption/steering — rather than the flat "spawn a process, wait for stdout" pattern?

The name: a conductor's baton directs an orchestra; a relay baton gets passed between runners. Both are the point.

## The core question

Every CLI coding agent today can *shell out* to another CLI coding agent. That's not orchestration — it's a blocking subprocess with a string result. Orchestration means:

- **Full-harness workers** — the subordinate keeps its own tools, sandbox, permissions, session state, and context management. You're delegating to *Codex-the-product*, not GPT-the-model.
- **Bidirectional messaging** — workers report progress and ask questions; the orchestrator answers without killing the run.
- **Telemetry** — normalized event stream (turns, tool calls, file edits, tokens, cost) across vendors, observable live.
- **Interruption & steering** — pause, redirect, or cancel a worker mid-turn from the orchestrator or from a human seat.
- **Symmetry** — the same machinery works Claude→(GPT+GLM) and GPT→(Claude+GLM). No privileged vendor.

## → Read [SYSTEM.md](SYSTEM.md) first

**[SYSTEM.md](SYSTEM.md) is the concise architecture overview.**
[docs/26](docs/26-full-system-goal.md) is the retained full-system goal and scope ledger;
[docs/28](docs/28-exhaustive-capability-audit.md) is the shipped/partial/pending status audit.
[GLOSSARY.md](GLOSSARY.md) decodes any leftover jargon.

## Status

**Full-system pursuit active.** Baton is a runnable dependency-free Node ESM reference
implementation, not a prototype skeleton. The canonical `npm test` in `impl/` is **1470/1470
green** and lifecycle-owns its temporary fixture root. Its public
`createDriver()` has driven real Claude Code, Codex app-server, and Grok ACP session workers
concurrently on this repository, with mid-turn steer, confirmed interrupt, approvals, isolated git
worktrees, and fresh-worktree trust gates. Live proofs include four concurrent real Grok sessions
that were interrupted/killed and fully reaped, plus exact concurrent `grok-4.5` and
`grok-composer-2.5-fast` routes with provider-observed identity, native session resume, live kill,
idempotent cleanup, and complete process/worktree/runtime/branch reap.
That Composer run is historical coverage of a distinct model, not literal Grok Build proof:
the current exact `grok-build` run reaches provider readiness but Grok CLI 0.2.99 reports
`grok-4.5`; Baton records the mismatch, rejects the route, and still closes/reaps it exactly.
Opt-in structured
integration now stages divergent accepted results off-main, wraps an injected Mergiraf-class
resolver, freshly verifies the merge commit, and only then advances main; true data-flow semantic
merge remains a separately measured research bet. The active complete scope,
including Atlas AST/CST and lexical work, native SCIP/symbol graphs, CPG/CFG/PDG/SSA and semantic
deltas, conditional compiler IR/translation validation, behavioral fingerprints, true semantic
merge, conditional expression/kernel e-graphs, Vantage, Evidence Ladder, Scratch Board/Bench,
Skill Forge/computer use, later Cartographer/Quartermaster and Cairn rungs, and Baton's
self-contained project-manager-inspired causal/temporal knowledge graph, is preserved in
[docs/26](docs/26-full-system-goal.md). Homelab integration is explicitly out of scope.

Phase 29 now makes deployment-injected Atlas capabilities real fleet tools through one
Coordinator-owned registry. The same bounded invoke/resume/reverify path is available through the
authenticated web command surface and the twelve-tool MCP inventory; deployment-owned multi-root
contexts cannot override actor, budget, repository root, or cancellation, and capability output
cannot claim verification or merge authority. Phase 30 also live-proves the credentialed GLM leg:
exact `glm-4.7` at native `low` effort was provider-observed, freshly verified, normally killed,
and fully reaped without disclosing the ignored local key. Phase 31 adds Cairn's deterministic,
sealed, content-addressed run scorecard and its atomic Run/Artifact knowledge projection. Phase 32
adds Cartographer/Quartermaster's focused Atlas-epoch orientation and evidence-grounded internal-
reuse floor through the same ACI plane. Phase 33 adds exact-fence addressed orientation push over
the ordinary nudge lane and authenticated web/MCP action. Phase 34 makes immutable-Brief scope
drift trigger a deployment-pinned, exact-epoch, deduplicated and cooldown/turn-bounded addressed
orientation refresh while preserving kill as the default and stop/fence authority as final. Phase
35 makes checkout readiness a typed coordinator prerequisite: failure cannot become an undefined
adapter path, worker turn, provider effect, leaked Git diagnostic, or unreaped runtime/worktree.
Phase 36 adds Quartermaster's fail-closed exact-npm evidence floor over deployment-injected
deps.dev+OSV transport, private raw snapshots, TTL/cache/refresh semantics, conservative policy,
and Atlas import observation without false reachability. Phase 37 adds an exact npm package-lock
v3 CycloneDX SBOM, grounded only in actual installed lockfile state and explicitly separated from
future proposed registry graphs. Phase 38 adds the Coordinator-owned immutable `borrow|build`
decision: fresh dossier/SBOM/effective-tree reverify, content-addressed fleet artifacts, derived
Findings, an observed Decision, `Informed`, CAS `Supersedes`, contamination, exact retry, and real
authenticated web/MCP actor propagation—with no install or merge authority. Phase 39 adds the
Coordinator-owned TTL/advisory recheck: exact-expiry read safety, forced official refresh,
coordinate-wide adverse fencing, atomic Decision/Finding invalidation, causal risk `Affects`
projection, and affected-reader contamination.
Phase 40 adds an exact npm proposed-not-installed graph and actual-to-proposed delta. npm runs only
inside a disposable macOS Seatbelt root with writes confined there and direct network denied; one
supervisor-owned CONNECT proxy admits the configured registry. Exact executable/sandbox identities,
source/proposed digests, process-tree cleanup, and proxy cleanup are receipt-bound and offline-
reverified. The official live npm proof is 11/11. Phase 41 now ships exact-input OSV transitive
advisory projection over separately grounded actual/proposed graphs, scan-session/transaction-bound
raw source evidence, public-registry name/version/SRI identity, deterministic dependency paths,
and conservative supported-static-import attention. It
cannot claim vulnerable-function reachability or waive an advisory. Baton's actual 10-coordinate
lock graph live-proves zero known advisories without calling OSV during offline reverify. Phase 42
pins Quartermaster's complete normalized vet-policy commitment in its registered capability card
and synchronously reconciles durable reuse state before a driver exposes authority. Baseline,
same-policy restart, and `A → B → A` epochs are replay-bound under exclusive writer ownership. A
changed policy atomically closes mismatched Decisions and dossier Findings, contaminates exact
readers, migrates old adverse guards as stale-but-blocking, and projects observed local
`Constraint`, `Supersedes`, `Affects`, and `Informed` causal lineage. A green current-policy review
may migrate an inherited fence but never clear it; authenticated web/MCP reads expose only the
sanitized policy commitment and refresh exact idempotent results as current or historical without
accepting caller policy hashes or target sets. Reconciliation performs no provider request, policy
authoring, waiver, clearance, install, project-manager export, or homelab integration. Adverse
provider feeds, independently verified provenance, exact `internal` decisions, trusted advisory/
source identity and true reachability, plan approval, positive clearance, additional ecosystems,
composite surfaces, and deeper Cairn remain pending. The live policy-cycle proof passes **13/13**;
the current canonical suite is **1470/1470 green**.

Phases 43–50 extend the provider, routing, representation-attestation, and Cairn causal-knowledge
verticals through durable provider recovery, exact route learning, supervised native-session
rejoin, bitemporal causal audit, bounded recall, selective promotion, and independent-oracle
Scratch correction. Phase 51 closes the pre-ready native-process gap: every shipped real adapter
separates exact process start, provider readiness, and exact close; kill waits for process-group
death and cleanup, forced/poisoned reaps are retryable, recovery identity remains transactional,
and authenticated web/MCP status exposes only a bounded process reference. Exact Codex
`gpt-5.6-sol`/low, GLM `glm-4.7`/low, Grok 4.5/low, and Grok Build/low remain in the recursive
matrix; that Phase 51 attempt's Grok legs were honestly authentication-red while their concurrent process
groups and all owned resources are proven reaped.
Phase 52 closes Cairn's feedback-observability gap without inventing causation: the audit-gated
`causal.assess_recall` operation deterministically binds task-scoped Phase 48 receipts to later exact
hub-verification and compatible terminal outcomes as `verified_pass_after_recall` or
`verified_fail_after_recall`. The compact append-before-return batch, historical exposure digests,
honest coverage/association audit metrics, restart reverify, direct/web/MCP authority, and every
max+1/output-preflight gate are executable; no worker rating, “helped” claim, ranking/confidence
mutation, project-manager runtime, or homelab integration is added.
That Phase 52 recursive exact-route gate fresh-verifies the project-key GLM PASS report, reaches exact Codex
provider readiness, starts both Grok routes concurrently, records exact close for all four process
groups, explicitly kills GLM, and restores every ownership surface. The strict native matrix stays
honestly red at that installed Grok CLI's pre-readiness authentication refusal.
Phase 53 closes Cairn's operator contradiction seam. `causal.contradictions` exposes a stable,
bounded, untrusted-evidence workspace, while `causal.resolve_contradiction` performs an explicit
authenticated prefix-CAS winner/loser decision through one replay-validated atomic event that
closes the edge, invalidates only the loser, and records exact prior-reader contamination. Direct,
authenticated HTTPS, and MCP invoke/reverify share one authority; cancellation and output ceilings
fail before commit, and post-append cancellation is explicitly commit-wins. Nine grouped Phase 53
contracts, 65 adjacent Cairn contracts, and the **1121/1121** canonical suite are green. Recursive
That Phase 53 run's project-key GLM fresh-verifies PASS; exact Codex is honestly budget-cancelled, both Grok groups are
concurrently auth-red, and every process and ownership surface is exactly closed and reaped. Baton
remains self-contained: project-manager is architectural inspiration only, with no homelab runtime
or integration target.
Phase 54 closes a concrete R3 representation unsoundness found by recursively using Baton on
Baton: lexical bindings, not identifier spelling, now key may-reaching definitions. Deterministic
function/block scopes, parameter-plus-`var` identity, nearest assignment resolution, explicit
unsupported closure/destructuring/catch boundaries, binding-aware delta/taint, independent bounds,
and self-consistent artifact-forgery refusal are executable. The fixed R1–R7 representation packet
now attests the Phase 54 contract too. Nine focused lexical tests, 13 representation-integration
tests, and the **1130/1130** canonical suite are green. An exact routed recursive matrix proved
Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, and simultaneous Grok 4.5/Grok Build process
lifecycle and full reap; semantic review conformance remains honestly red because Codex and GLM
crossed terminal accounting budgets and Grok still reported unauthenticated.

Phase 55 removes a recursive-use deployment fiction exposed by those runs. A clean exact-SHA target
can now receive a separately attested, immutable, bounded toolchain projection without the evidence
runner manually staging dependencies. The public projection identity contains only content/policy
digests and counts; worker, result-verifier, base-verifier, replay, session resume, and structured
merge bind that identity while receiving independent byte copies. Links, hardlinks, special or
privileged files, path collisions, source drift, every max+1 ceiling, result-commit contamination,
and mixed legacy/new configuration fail closed with cleanup. Eleven focused contracts and the
**1141/1141** canonical suite are green. Recursive Baton then admitted exact Codex
`gpt-5.6-sol`/low, Claude Opus/low, project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok Build/low
against a dependency-free clean target. All five native process groups closed and reaped, the two
Grok intervals overlapped, and GLM fresh-verified a report through an independently projected
verifier. The projection/lifecycle gates are green; the strict provider matrix remains honestly red
because the installed Grok CLI reports unauthenticated. At this Phase 55 checkpoint, public
drain-and-close and deterministic route-bound call/usage governance were still open; Phases 56–57
below close those deterministic gaps. Strict native pre-effect provider/tool enforcement,
provider-backed continuation, Scratch Board/Bench, Skill/Playbook promotion, deeper web/operator
surfaces and evaluations, and every retained representation rung remain in the full-system goal.

Phases 56–59 now ship public exact fleet drain/close, route-bound truthful provider governance,
canonical sparse worker/verifier identities with hidden-diff refusal, and a repo-scoped byte/inode
capacity authority. Exact base/branch binding prevents metadata from erasing the admitted diff,
ownership roots refuse symlink escape, and legacy close refuses live reservations. Their historical
phase baselines remain 1179/1179 for Phase 56, 1256/1256 for Phase 57, and 1346/1346 for Phase 59;
the current canonical result is the 1470/1470 status above. The first exact five-provider
sparse+capacity recursive proof admitted all five routes, sampled both Grok groups live
simultaneously, fresh-verified Codex `gpt-5.6-sol`, project-key GLM `glm-4.7`, and Grok 4.5 reports,
and exactly closed/reaped all five generations with zero capacity residue. The strict matrix remains
red: Claude is not logged in, and literal `grok-build` was provider-observed as `grok-4.5` and
rejected for exact-model mismatch. That dogfood also found projection-parent inode undercount and
dead foreign reservation retention; both now have red/green repairs. The post-repair rerun on
`7780266` repeated the three accepted fresh verifications and exact five-generation cleanup, and
all three returned reports now have no P0/P1. The strict external matrix is still red only at Claude
login and literal Build identity. The older Composer proof is not equivalent to literal Build.

The Phase 60 implementation baseline now makes native recovery an attach-only transaction. Claude,
Codex, and Grok may prove the exact persisted native identity without receiving the recovered Brief; Baton then atomically
creates/claims a bounded recovery refinement, records an exact continuation intent, and exposes
working authority only after an adapter-local accepted disposition. Exceptions, timeouts, false
Acks with facts, append loss, and stop races remain durable `dispatch_unknown` and are never
automatically redelivered. Provider seats stay reserved until exact stop/reap and late-spawn
settlement. Closed store APIs reject forged not-sent evidence, generic recovery-task bypasses,
unverified or cross-worker lineage, context substitution, and newline-complete torn transactions.
The persistent-session gate is 43/43, the dedicated store/replay gate is 7/7, and the current
canonical result is the 1470/1470 status above. The first recursive five-route Phase 60 review
admitted all exact routes, sampled both Groks live concurrently, independently verified Codex
`gpt-5.6-sol`, project-key GLM `glm-4.7`, and Grok 4.5, and exactly killed/reaped every process and
ownership surface. Its strict external matrix remains honestly red at Claude login and literal
Build identity. A provider-backed native-recovery proof plus the remaining NR7 crash/adapter
matrix remain acceptance gates; neither is inferred from the shipped fixture or review coverage.

Phase 61 now turns the shipped bounded Atlas R1 structural delta, R2 SCIP snapshot, and R3 CPG
semantic delta into first-class derived Cairn `Representation` nodes. Fixed producer mappings,
current-card and immutable-environment binding, immediate source reverify, exact primary artifacts,
stable identities, mode-0600 receipts, atomic `DerivedFrom`/`ProducedBy`/`ObservedIn` lineage,
request-bound replay, completed-result integrity checks, and direct/authenticated-web/MCP parity are
executable. The retained R1–R7 packet now mechanically includes the Phase 61 contract and producer
for R1–R3. The Phase 61 baseline was **1415/1415 green**. Baton also produced and freshly reverified an
R1 representation of its own committed retention-source delta. Its five-route recursive review
admitted exact Codex `gpt-5.6-sol`, Claude Opus, project-key GLM `glm-4.7`, Grok 4.5, and literal
Grok Build at low effort; both Grok groups were live concurrently and all five generations and
ownership surfaces reaped. GLM and Grok 4.5 reports fresh-verified. The strict matrix remains
honestly red at Claude login, a Codex terminal-reserve overrun, and literal `grok-build` being
provider-observed as `grok-4.5`.

Phase 62's initial Goal/Plan authority was introduced at `f4b8f46` and hardened through committed
checkpoint `230db8e`. Append-only goal and bounded plan versions, distinct proposer/approver
decisions, locale-independent plan ordering, exact nano-USD authority, complete closed
authoritative Briefs, exact harness/model/effort constraints, immutable plan-owned verification,
atomic pre-effect `plan.node_dispatched` + `task.created`, current-head enforcement, iterative DAG
validation, and durable consumed/released/held/overrun settlement now gate mandatory-scope work.
Direct, authenticated HTTPS/SSE, and MCP use the same authority and lost-response reconciliation;
unauthorized stream observers do not receive Goal/Plan state. The canonical suite is **1470/1470
green**.

The original five-route proof at `45072eb` used one approved five-node plan to admit exact
low-effort Codex `gpt-5.6-sol`, Claude Opus, project-key GLM `glm-4.7`, Grok 4.5, and literal Grok
Build routes. Both Grok process groups were live concurrently, every started generation closed
exactly, every requested kill was confirmed, and all owned resources returned to zero. Its strict
report matrix remains honestly red at Claude login, its absent Codex report, its concurrent GLM
verifier failure, and literal Build being provider-observed as `grok-4.5`. Later focused retries
independently passed exact route observation, mechanical report verification (required shape plus
pinned tests), mandatory Goal/Plan binding, budget settlement, lifecycle, and cleanup for Codex
`gpt-5.6-sol`/low at `9ce83e9` and project-key
GLM `glm-4.7`/low at `230db8e`. These focused greens do not relabel the original five-provider
matrix.

**What baton is:** a **fleet driver** — one orchestrator agent that directs full Claude Code / Codex / GLM worker agents across vendors, sending them work, watching them (telemetry), and interrupting and steering them mid-run. That is the product. `Claude → (Codex + GLM)` and `Codex → (Claude + GLM)`.

**Everything else supports the driver, and none of it is dropped:** independent verification (re-running a worker's tests so "done" can be trusted), learned routing (which vendor is good at what), a reliable coordination core (so "interrupt worker 3" always lands), telemetry/replay, and worker tools (search, debug, semantic diff). Earlier docs over-billed the *verification* as the product and demoted the *driving* to optional — doc 19 turns that right-side-up.

**Architecture, plainly:** you drive from your CLI agent (Claude Code or Codex is the orchestrator — it decides); underneath, a small reliable program carries out those decisions and does the bookkeeping (dispatch, making interrupts land, re-checking worker claims, the event log). The AI drives; the plumbing makes the driving safe. Southbound, the product tier uses persistent Claude stream-json, Codex app-server, and Grok ACP sessions; one-shot subprocess adapters remain an explicitly limited fire-and-forget tier. Those basic depth gates, audited ACI invocation, Cairn's current causal audit/recall/promotion/correction rungs, Cartographer/Quartermaster's local orientation/reuse, addressed-push, provider and policy-epoch safety rungs, exact provider lifecycle/reap, and initial Goal/Plan authority now ship. Current pursuit retains richer Goal/Plan evidence and amendment policy, authorized continuation/recovery, native session depth, Baton's self-contained project-manager-inspired causal/temporal knowledge graph, authenticated web/runtime depth, Vantage, Evidence Ladder, Scratch Board/Bench, Skill Forge/computer use, registered evaluations, Atlas AST/CST and lexical precision, native SCIP/symbol graphs, deeper CPG/CFG/SSA/PDG and semantic deltas, conditional compiler IR, behavioral fingerprints, true semantic merge, conditional expression/kernel e-graphs, and later Cartographer/Quartermaster and Cairn rungs. Homelab integration is excluded. See [docs/28](docs/28-exhaustive-capability-audit.md).

**Design docs** (`docs/`):

| Doc | Contents |
|-----|----------|
| [00-brief](docs/00-brief.md) | Problem statement, expanded research agenda, framing |
| [01-landscape](docs/01-landscape.md) | Cited deep-research report: protocols, control surfaces, prior art, ToS |
| [02-harness-control-surfaces](docs/02-harness-control-surfaces.md) | Per-harness capability matrix (verified against installed binaries) |
| [03-protocol-analysis](docs/03-protocol-analysis.md) | ACP vs A2A vs MCP vs bespoke — the layer model |
| [04-architecture-options](docs/04-architecture-options.md) | Candidate designs, tradeoffs, recommendation |
| [05-telemetry-steering](docs/05-telemetry-steering.md) | Event schema, monitoring, corrected interruption/steering semantics |
| [06-critiques-and-quibbles](docs/06-critiques-and-quibbles.md) | Failure modes, security, the hard problems |
| [07-roadmap](docs/07-roadmap.md) | Build sequence (revised: eval + differentiating demo front-loaded) |
| [08-shared-memory-and-pm](docs/08-shared-memory-and-pm.md) | Three-tempo memory model; project-manager as foil |
| [09-revision-log](docs/09-revision-log.md) | Round-1 review: every finding → disposition → the doc change it forced |
| [10-interaction-model](docs/10-interaction-model.md) | Two channels (comms/steering) + three topologies; *paradigm framing deflated in round 2* |
| [11-capability-plane](docs/11-capability-plane.md) | The seven agent-shaped capability modules (search/debug/evidence/REPL/skills/orient/BoK) |
| [12-context-harness-engineering](docs/12-context-harness-engineering.md) | Context composition, agentic-first tools, interop; *emergence/ensemble claims revised in round 2* |
| [13-revision-log-r2](docs/13-revision-log-r2.md) | Round-2 red/blue/explore: the Referee-not-Conductor reframe + all six REVISE verdicts |
| [14-practitioner-addenda](docs/14-practitioner-addenda.md) | 30 net-new directions/critiques/features in my own voice: agent experience, context/harness craft, operator DX, the subtractive thesis |
| [15-representation-and-computation](docs/15-representation-and-computation.md) | Re-anchor (Conductor is the ask; Referee is its trust spine) + the representation ladder (AST→CPG→IR→e-graph) and beyond-frontier self-ideated ideas (semantic diff/merge, behavioral fingerprint, attestation-overlay) |
| [28-exhaustive-capability-audit](docs/28-exhaustive-capability-audit.md) | Current shipped/partial/pending/retired map; supersedes the Phase-10 matrix for status without deleting any research row |
| [19-north-star-corrected](docs/19-north-star-corrected.md) | The fleet driver is the product; verification/routing/memory support it |
| [22-completeness-audit](docs/22-completeness-audit.md) | The built-not-wired audit that drove phases 8–10 |
| [24-goal-system-completion](docs/24-goal-system-completion.md) | Phase-10 whole-system goal and completion record |
| [25-capability-gap](docs/25-capability-gap.md) | Current researched-versus-shipped inventory and phase-11 boundary |

Capability module designs: [docs/capabilities/](docs/capabilities/). Context/harness angle designs: [docs/reference/context-harness/](docs/reference/context-harness/).

**Specs** (`spec/`): [adapter-contract](spec/adapter-contract.md) (verb→real-API mapping per harness), [supervisor-state-machine](spec/supervisor-state-machine.md) (the durable control plane), and [phase-10.1 reconciliation](spec/phase10.1/spawn-stop-reconciliation.md) (async spawn/stop ownership and the recursive-live safety gate).

**Reviews** (`reviews/`): [codex-external-review](reviews/codex-external-review.md) (cross-vendor red-team), [steering-interruption-redteam](reviews/steering-interruption-redteam.md) (the subordination-reliability red-team).

**Reference** (`docs/reference/`): implementation-grade dossiers plus committed live ledgers. The completed recursive fleet and four-Grok reap runs are under `docs/reference/evidence/`.
