# Spec History Digest — spec/phase* design archaeology (2026-08-03)

*Read-only digest of the `spec/` tree: 8 top-level contract docs + 74 phase directories + 19
named phase files (phase75–93). Landed-ness was cross-referenced by grepping `impl/src/` for each
phase's distinctive vocabulary and checking `impl/test/` for its suite. Status legend:
**LANDED** (vocabulary + module + tests present), **PARTIAL** (some verticals shipped, spec-named
remainder open), **UNLANDED** (no impl vocabulary), **SUPERSEDED** (replaced by a later contract,
vocabulary may persist), **DECISION** (shipped as an explicit refusal/redirect surface — the
capability itself is deliberately not built).*

*Structural finding: the `spec/phase*` era ends at phase 93a. The live frontier (readiness,
orientation, board, browser-use, grammar M1–M5, reflex, REPL, KG, wave-driver lanes of issue #82)
is specced in `docs/` (docs/31–37 + folded contracts under `docs/reference/evidence/`) and driven
by `impl/test/*-red.test.mjs` TDD waves — no `spec/phase94+` dirs exist. See sibling
`design-corpus.md` for that half.*

## 1. PHASE TABLE

### Top-level contract docs (pre-phase / cross-phase)

| Doc | Title | Status | Distinctive vocabulary | Evidence |
|---|---|---|---|---|
| `spec/IMPLEMENTATION.md` | MVP consolidated clusters (log, fence, coordinator, adapter, worktree, referee, router, story, messages) | LANDED (seams superseded by RECONCILIATION) | `tick()`, `bumpTurn`/`bumpHuman`, `stale_fence`, per-worker JSONL | `impl/src/fence.mjs` (bumpHuman, stale_fence), all cluster modules exist |
| `spec/RECONCILIATION.md` | Contract reconciliation D1–D11 (authoritative) | LANDED | 8-verb session Adapter, `answer()`≠`approve()`, confirmed-stop-is-an-event, one Brief typedef | `impl/src/adapter.mjs`, `coordinator.mjs`; still cited by phase specs |
| `spec/adapter-contract.md` | Southbound verb→real-API mapping v0 | SUPERSEDED by D1 + phase8/9/71/72 | `card()`, "no silent emulation", ✅/🔧/❌ verb mapping | vocabulary alive in every adapter `card()` |
| `spec/supervisor-state-machine.md` | Durable non-LLM control plane, invariants I1–I7 | LANDED (name superseded) | fencing I1, single-consumer approvals I2, at-least-once cursors I3, bounded poll I4, two-phase stop I6, hub-run verification I7 | `coordinator.mjs` + `fence.mjs` + `runtime-isolation.mjs`; "supervisor" now only in `session-recovery-supervisor.mjs`, `provider-poll-supervisor.mjs`, `provider-processing-supervisor.mjs` |
| `spec/communication-channel.md` | Bidirectional data-plane channel | LANDED (parts superseded by phase92) | `brief`/`nudge`/`ask`/`answer`/`result`/`digest`, turn-respecting | `messages.mjs`, adapter prompt modes; notify superseded by `run.workstream.notify` |
| `spec/capability-plane.md` | ACI framework + five design laws | LANDED | ACI envelope `op/status/summary/payload/refs/cost/provenance`, `reverify`, `InvokeCtx` | `capability-registry.mjs`, all atlas/cartographer modules |
| `spec/driver.md` | Fleet kernel assembly (8 primitives) | LANDED + surface SUPERSEDED by phase64 | `spawn/send/wait/respond/interrupt/result/list/kill` kernel API | `coordinator.mjs`; doc self-updated to "advanced compatibility surface" |
| `spec/worktrees.md` | Worker isolation via git worktrees | LANDED (amended by 58/59/92.2) | `.baton/wt/<task-id>`, `baton/<task-id>` branches, fresh-tree re-verification | `worktree.mjs` |

### Phase directories/files

| Phase | Title | Status | Distinctive vocabulary | Evidence |
|---|---|---|---|---|
| 8 | Claude session adapter + Codex app-server adapter + gate/control correctness + cross-cluster RECONCILIATION | LANDED | `--input-format stream-json`, `--permission-prompt-tool stdio`, `thread/start`, `turn/steer`, `accept()` sole done-gate, R1–R12 | `claude-session.mjs`, `codex-appserver.mjs`, `phase8-correctness.test.mjs` |
| 9 | Grok ACP session adapter | LANDED | `grok agent stdio`, `session/prompt`, `session/cancel`, live-smoke gate | `grok-acp.mjs`, `grok-acp.test.mjs` |
| 10 | Whole-system completion SC1–SC12 | LANDED | one spawn contract, `worktreeReady` promise | `phase10-completion.test.mjs` |
| 10.1 | Spawn/stop reconciliation | LANDED (stale "implementation pending" header) | reserved cancellable spawn, pending-spawn reservation | `phase10.1-reconciliation.test.mjs` |
| 11 | Control integrity CI1–5, model selection MS, persistent sessions PS, governance GV, acceptance ladder AC, coordination-knowledge CK | LANDED | `CoordinationStore`, `events.jsonl` gap-free seq, `resource.budget_threshold`, red/green sandbox ladder | `coordination-store.mjs`, `runtime-isolation.mjs`, `usd.mjs`, 7 phase11 test files |
| 12 | Authenticated web northbound + session lifecycle + edge policy + OIDC + operator + command reconciliation | LANDED | hashed-at-rest sessions, one-time credential rotation, trusted-proxy allowlist, `web.command_admitted` | `web-northbound.mjs`, `web-auth.mjs`, `web-edge.mjs`, `web-oidc.mjs`, 8 phase12 test files |
| 13 | Atlas CST/AST structural delta + shared index/symbols/SCIP | LANDED | ast-grep, content-addressed epochs, worktree overlay, `index.build` | `atlas-structural.mjs`, `atlas-index.mjs` |
| 14 | Harness/model/effort routing tuple | LANDED | `{harness, model?, effort?}`, `effort_policy_conflict` | `route-tuple.mjs`, `phase14-route-tuple.test.mjs` |
| 15 | Owned test-fixture lifecycle | LANDED | one mode-0700 suite root, `BATON_TEST_TMP_PARENT` | `impl/scripts/run-suite.mjs` |
| 16 | MCP northbound | LANDED (default superseded by phase64) | MCP `2025-11-25`, stdio JSON-RPC, `fleet_*` tools | `mcp-northbound.mjs`; `fleet_run_*` now default, `fleet_*` under `combined` |
| 17 | Atlas structural search + rewrite proposals | LANDED | `search.structural`, proposal-only rewrite | `atlas-rewrite.mjs` |
| 18 | Atlas CPG seed | LANDED | `CONTAINS`/`CFG_NEXT`/`REACHING_DEF`/`ARGUMENT_TO` edges | `atlas-cpg.mjs` |
| 19 | CPG delta + impact | LANDED | semantic matching keys, bounded impact traversal | `atlas-cpg-delta.mjs` |
| 20 | CPG taint | LANDED | operator source/sink/sanitizer names, shortest witness | `atlas-cpg-taint.mjs` |
| 22 | Path-sensitive CPG | LANDED | `CFG_TRUE`/`CFG_FALSE`, may-reaching definitions | in `atlas-cpg.mjs` (120 binding/CFG matches) |
| 23 | Operational-log emergency reap | LANDED | poisoned store, `kill(..., {emergency:true})` stop-only | `coordinator.mjs` (16 emergency matches) |
| 24 | Representation ceiling (JS/TS stops at R3) | DECISION (landed) | `rung_ceiling`, `ir.build` refuses typed | `atlas-representation-ceiling.mjs` |
| 25 | Behavioral fingerprint (R5) | LANDED | Node permission sandbox, corpus agreement ≠ equivalence | `atlas-behavior-fingerprint.mjs` |
| 26 | Structured merge (R6, Mergiraf) | LANDED | `mergiraf solve`, detached integration worktree, `ff-only` default | `structured-merge.mjs` |
| 27 | E-graph evaluation (R7) | DECISION (landed) | `retired_native`, `redirected_behavioral`, no Baton e-graph engine | `atlas-egraph-evaluation.mjs` |
| 29 | Coordinator-owned capability invocation | LANDED | one `CapabilityRegistry`, authority firewall (`mergeAuthority`/`verificationAuthority` rejected) | `capability-registry.mjs` |
| 30 | GLM live honesty | LANDED (pinned model aged: glm-4.7 → 5.2 in use) | `authTokenFile` 0600, Z.ai transport, isolated runtime home | `claude-session.mjs` GLM subclass, `credential-projection.mjs` |
| 31 | Cairn rung-0 sealed run scorecard | LANDED | `run.scorecard`, one-way run closure | `cairn-run-scorecard.mjs` |
| 32 | Cartographer/Quartermaster rung 0 | LANDED | `orientation.slice`, `repo.map`, `code.seed`, `reuse.internal`, `external_vet_required` | `cartographer-quartermaster.mjs` |
| 33 | Addressed orientation push | LANDED | `orientWorker`, fenced nudge-class delivery | `coordinator.mjs` (5 orientWorker matches) |
| 34 | Scope-drift orientation automation | LANDED | `scopeAction: kill\|orient`, `maxRefreshesPerTurn` | `coordinator.mjs` (7 scopeAction matches) |
| 35 | Truthful worktree readiness failure | LANDED | `lifecycle.crashed{phase:worktree}`, `worktree_unavailable` | `phase35` vocabulary in coordinator/worktree |
| 36 | Quartermaster external dossier | LANDED | deps.dev/OSV, typed facts no third-party prose | `supply-chain-oracle.mjs` |
| 37 | Exact-lockfile SBOM | LANDED | CycloneDX 1.6 `actual_lockfile`, `unresolvedEdges` | supply-chain modules + `phase37-lockfile-sbom.test.mjs` |
| 38 | Immutable reuse decision | LANDED | `Coordinator.decideReuse()`, `borrow\|build`, fresh reverify | `phase38-reuse-decision.test.mjs` |
| 39 | Advisory TTL invalidation | LANDED | `recheckReuseDecision`, evidence fence | `phase39-reuse-invalidation.test.mjs` |
| 40 | Proposed install graph | LANDED | `provenance.plan`, isolated `--package-lock-only` resolver, supervisor receipt | `npm-proposal-resolver.mjs` |
| 41 | Transitive advisory projection | LANDED | OSV `querybatch`, conservative reachability never clears | `phase41-*.test.mjs` ×2 |
| 42 | Policy-epoch invalidation | LANDED | vet-policy SHA-256, reconcile-before-authority | `phase42-policy-invalidation.test.mjs` |
| 43 | Adverse-provider ingestion + deferred processing + full-poll reconciliation | LANDED | authenticated hint ≠ verdict, source epoch, sticky sequence gap | `advisory-feed-registry.mjs`, `hmac-advisory-webhook.mjs`, `https-hmac-advisory-feed.mjs`, `provider-processing-supervisor.mjs`, `provider-poll-supervisor.mjs` |
| 44 | Cairn rung-1 RouteStats + route advice | LANDED | `route.outcome_observed`, one observation per task, verified win/loss | `cairn-run-scorecard.mjs` (32 route.* matches), `phase44-cairn-route-stats.test.mjs` |
| 45 | Supervised session auto-rejoin | LANDED | readiness barrier, `session_recovery_pending`, closed eligible set | `session-recovery-supervisor.mjs` |
| 46 | Attested representation review packet | LANDED | fixed R1–R7 ladder, committed-tree attestation | `atlas-representation-review.mjs` |
| 47 | Cairn causal integrity audit (rung 2) | LANDED | one `repoId` binding (CA1), closed node/edge types, readiness-fail on tamper | `phase47-cairn-causal-audit.test.mjs`, knowledge.* events |
| 48 | Cairn bounded recall | LANDED | `cairn/causal.recall`, receipt-before-content | `phase48-cairn-recall.test.mjs` |
| 49 | Cairn selective promotion | LANDED | `knowledge.promotion_batch`, never in stop/kill path | `phase49-cairn-promotion.test.mjs` |
| 50 | Scratch correction + independent oracle | LANDED | `scratch_oracle` task-plane command, `causal.correct_scratch` | `phase50-cairn-scratch-correction.test.mjs` |
| 51 | Pre-ready process lifecycle | LANDED | `lifecycle.spawned` ≠ OS process creation, exact PID-specific reap | `process-lifecycle.mjs` |
| 52 | Recall-outcome attribution | LANDED | `cairn/causal.assess_recall`, no causation claim | `phase52-cairn-recall-assessment.test.mjs` |
| 53 | Contradiction workspace | LANDED | `cairn/causal.contradictions`, `resolve_contradiction` | `phase53-cairn-contradictions.test.mjs` |
| 54 | CPG lexical-binding awareness | LANDED | closed binding syntax, no cross-binding join | `atlas-cpg.mjs`, `phase54-*.test.mjs` |
| 55 | Immutable dual-root toolchain projection | LANDED | attested source projection, byte copies into sandboxes | `toolchain-projection.mjs` |
| 56 | Public drain + exact driver close | LANDED | `driver.drainAndClose()`, transport alive to persist its own completion | `index.mjs` (drainAndClose), `phase56-drain-and-close.test.mjs` |
| 57 | Provider budget/call governance | LANDED | `providerGovernance` exact-route rows, `strict`/`observe`, terminal reserve | `provider-governance.mjs`, 6 phase57 test files |
| 58 | Capacity-aware sparse workers | LANDED | `workerSparsePaths`, no-cone literal sparse spec | `worktree.mjs`/`index.mjs` (68 sparse matches), 5 phase58 test files |
| 59 | Worktree capacity authority | LANDED | `worktreeCapacity` six-field policy, pre-effect reservation | `worktree-capacity.mjs` |
| 60 | Attach-only native recovery | LANDED | `attachOnly` adapter mode, no Brief before provider testimony | `attachOnly` in all 4 session adapters + coordinator (29 matches) |
| 61 | Graph-backed Representations | LANDED | closed producer table (`structural_delta`/`symbol_snapshot`/`cpg_semantic_delta`) | `atlas-representation-producer.mjs` |
| 62 | Goal/Plan web authority | LANDED | `goal_define`/`plan_propose`/`plan_approve`, distinct-authority approval | `goal-plan.mjs`, 5 phase62 test files |
| 63 | Canonical-order authority | LANDED | UTF-16 code-unit comparator, no `localeCompare` authority | `canonical-order.mjs` |
| 64 | Integrated Run application | LANDED | Run facade, `RunView`, nine `fleet_run_*` MCP tools | `application.mjs`, `mcp-northbound.mjs` (30 fleet_run matches) |
| 65 | Run semantic review + integration | LANDED (self-declared shipped+green) | `run.review`/`run.integrate`, deployment-pinned review route | `semantic_review` in 5 src files, `phase65-*.test.mjs` |
| 66 | Run continuation, recovery, materialized export + lifecycle addendum + retained delivery | LANDED (stale acceptance-red headers ×3) | `directory-v1` receipt, `.tmp-<hex>-<uuid>` grammar, `baton-export-tar-v1` | `result-export.mjs`, `web-result-export-delivery.mjs`, 8 phase66 test files |
| 67 | Progressive agent experience | LANDED (stale acceptance-red header) | self-described `run.act` actions, depth-progressive inspect | `application-semantics.mjs`, 6 phase67 test files |
| 68 | Unified agent entrypoint | PARTIAL | `baton run "objective"`, `openBaton` defaults; **adaptive policy derivation open** | `application-cli.mjs`; spec header self-marks adaptive as open |
| 69 | Verifier runtime + checkpoint recovery | LANDED | deployment-owned verifier PATH (no user shims), candidate checkpoints | `verifier-diagnostics.mjs`, 2 phase69 test files |
| 70 | Preserved stop + resumable work | LANDED (stale header) | three-phase destructive stop, kill-ack ≠ close authority | 2 phase70 test files, coordinator preserve paths |
| 71 | Kimi K3 via Claude Code harness | LANDED | `KimiSessionCli`, scoped route, no `~/.claude` rewrite | `claude-session.mjs` kimi route, `kimi-credential-setup.mjs`, 2 phase71 test files |
| 72 | Native Kimi Code harness + bidirectional MCP | LANDED w/ live caveats (issue #54 open) | `kimi acp` JSON-RPC, executable discovery, Kimi-as-orchestrator MCP bridge | `kimi-acp.mjs`, `mcp-web-bridge.mjs`, 2 phase72 test files |
| 73 | Provider-result + required-effect honesty | LANDED | `provider_turn_failed`, failed turns bypass trust gate | `provider_turn_failed` in `index.mjs`, `phase73-required-effects.test.mjs` |
| 74 | Worker autonomy/containment policy | LANDED (stale "in progress" header) | v1 content-addressed policy, `unattended` default, containment ≠ worktree | `worker-policy.mjs`, `worker-policy.test.mjs` |
| 75 | Bounded task topology | LANDED | five closed child relations, `maxDepth`/`maxChildrenPerTask` | `task-topology.mjs` |
| 76 | Durable recovery-attempt authority | LANDED | `recovery.attempt_admitted`, two-phase compare-and-set | `recovery-attempt.mjs`, 2 phase76 test files |
| 77 | Durable recursive Run authority | LANDED | `runLineagePolicy`, fixed-capability orchestrator lease, transitive stop snapshot | `run-lineage.mjs`, 5 phase77 test files |
| 78 | Integrated deployment surface | LANDED | `openBaton({repo})`, deployment factory owns ceilings | `application-deployment.mjs` (openBaton), 8 phase78 test files |
| 79 | Dynamic workflow composition | LANDED | Workflow/WorkItem/Attempt/Wave/Candidate/Feedback packet, generation-fenced writer lease, shared sandbox **rejected** | `workflow-definition.mjs`, `wave.mjs`, `workflow-policy.mjs` |
| 80 | Recursive Candidate revision | LANDED | `revision` envelope, `revise_candidate`, successor Plan per round | `workflow-revision.mjs`, 4 phase80 test files |
| 81 | Context Program / stateless Bench / RLM | LANDED (isolated-code Bench backend optional-unlanded) | `ContextManifest`, closed pure cells, map→WorkItem+Wave, no `llm_query` | `context-program.mjs`, `context-runtime.mjs`, `context-authority.mjs`, `context-call.mjs` |
| 82, 83 | *(no spec dirs)* Context durability + Context application | LANDED, spec gap | — | `phase82-context-durability-red`, `phase83-context-application-red`, `phase83-context-runtime-red` tests exist without spec dirs (covered by 81/84/85 family) |
| 84 | Context successor Plan/Wave, durable map calls | LANDED | `context_map` action, successor Plan + approval + Wave per partition | `context-execution-worker.mjs`, 4 phase84 test files |
| 85 | Context lineage + recursive synthesis | LANDED | map→reduce, result capsules, retry generations, `context_eval` | `context-lineage.mjs`, `context-result-lineage.mjs`, `context-effect-result-lineage.mjs`, 9 phase85 test files |
| 86 | Progressive execution AX + reflexive dogfood integrity | PARTIAL | `start_many`/`group.complete()`, effect scope selection; verified OS containment still gated, dogfood ongoing (issue #82) | `startMany` in `application-semantics.mjs`/`application-client.mjs` (9 matches) |
| 87 | Semantic action authority | LANDED | closed `requiredCapabilities` registry per action kind | 29 requiredCapabilities matches across 5 src files, `phase87-*.test.mjs` |
| 88 | Plan route tuple authority v2 | LANDED | allowlist of exact `(harness,model,effort)` tuples, no Cartesian axes | `route-tuple.mjs`, `phase88-plan-route-authority.test.mjs` |
| 89 | Authenticated resident application + security matrix | LANDED | `openBaton().host()`, `connectBaton`, Run-scoped session authority | `resident-authority.mjs`, `application-host.mjs`, `application-client.mjs`, `local-web-transport.mjs`, 6 phase89 test files |
| 90 | Durable semantic Run control + Run-scoped streams | LANDED | Pythonic `run.send/interrupt/stop`, Run streams | `web-stream.mjs`, `run-timeline.mjs`, 2 phase90 test files |
| 91 | Semantic interrupt preservation | LANDED candidate (broader live gates self-declared open) | schema-v2 `preserve_turn`, ends only the admitted provider turn | `preserveTurn` in `coordinator.mjs` (28 matches), `phase91-*.test.mjs` |
| 92 | Episode/workstream facade | LANDED | `run.episode` topics, `run.workstream.notify/stop`, generation selection | episode 120 + workstream 155 matches across application-semantics/mcp/web-operator/cli |
| 92.2 | Physical workspace owner authority | LANDED | `ws-<opaque>` physical owner, pre-effect durable ownership receipt | `physicalOwner` in `worktree.mjs` (122), `coordinator.mjs`, `index.mjs` |
| 93 | Closed canonical Program IR + effect-boundary runtime | **PARTIAL** (93a.1–93a.3a landed; 93B–93F unlanded) | control: `value context sequence branch parallel await collect select repeat child`; effects: `call map reduce gate notify checkpoint finish`; `pnode:`/`program:` IDs | `impl/src/program-ir/` (10 modules: canonical-value, schema-values, program-policy, role-catalog, approval-template, normalize-program, context-derivation, control-nodes), 5 `phase93a-*-red` tests; git log up to "93a.3a" |

*Phase numbers 21 and 28 never existed as spec dirs (skipped). Phases 82/83 shipped as tests without spec dirs.*

## 2. THE UNLANDED FRONTIER

Ranked by leverage against the open issue ledger (#43–90).

### F1. Phase 93B–93F — the Program runtime (PARTIAL, biggest prize)
- **Proposed:** one closed, content-addressed Program language above Run/Workflow/Context/Atlas/Cairn:
  control vocabulary `value context sequence branch parallel await collect select repeat child`,
  effect vocabulary `call map reduce gate notify checkpoint finish`, a pure transactional reducer
  (§93.14), a five-phase effect protocol (§93.12), and exact lowering of five named route families
  (`parallel_attempts`, `review_revise`, `debate_synthesize`, `context_recursive`,
  `partition_review_integrate`, §93.17).
- **Why now:** it is the L1 spine of the frontier sweep (#82); issue #9's Program requirements were
  captured into it via docs/29 Stages C–E. 93a.1–93a.3a (identity, grammar, policy, role catalog,
  approval templates, context result-schema derivation) already landed in `impl/src/program-ir/`.
- **Solved on paper (don't re-solve):** the entire data model + canonical identity (§93.3–93.5),
  bound authority references (§93.6), role catalog v2 + service tier (§93.7), approval envelopes
  (§93.8), all control-node schemas (§93.9), effect-node schemas + async handles (§93.11), effect
  identity + five-phase protocol (§93.12), counter/branch/stack/rounds (§93.13), the reducer
  (§93.14), typed results (§93.15), feedback/revision/review typing (§93.16), the five lowerings
  (§93.17), workspace/ownership/stop/recovery (§93.18), Atlas/Cairn integration (§93.19),
  deployment policy (§93.20). Known deferrals are enumerated (e.g. `maxParallelBranches`
  enforcement vacuous until effect nodes exist, §93.24).
- **Integration surface:** `impl/src/program-ir/` (new runtime modules beside the landed grammar),
  `context-program.mjs`/`context-runtime.mjs` (purity proof + legacy migration §93.10),
  `workflow-definition.mjs`/`workflow-revision.mjs` (lowering targets), `application-semantics.mjs`
  (93E transport parity), `goal-plan.mjs` (approval envelopes).

### F2. The REPL shared-objects layer (PARTIAL, ~20% realized — issue #69, seed issue #21)
- **Proposed (docs/33, no spec/phase*):** shared objects, scripting, and context passing across the
  orchestration layer — a ReplManifest as a second manifest shape with its own digest basis.
- **Why now:** #69 is on the live ledger; `repl1-manifest-red`, `repl1-kind-inventory-red`,
  `repl23-bindings-red` tests are the active TDD wave.
- **Solved on paper/landed:** REPL-1 manifest discipline already landed in `context-program.mjs:278`
  (`REPL_MANIFEST_FIELDS`, disjoint digest basis, shared branch discipline with Workflow). Phase 81's
  stateless Bench is the declared substrate; bindings/shared-object mutation semantics are the open
  rung.
- **Integration surface:** `context-program.mjs`, `context-runtime.mjs`, `context-authority.mjs`,
  `application-semantics.mjs`.

### F3. Board worker half — claim/report authority (PARTIAL — issue #78, seed #17, docs/32 REFLEX-2)
- **Proposed:** orchestrator-controlled shared task board: post/claim/report as first-class lanes
  (the worker-handoff half of S-2).
- **Why now:** #78 says `board.claim`/`board.report` are registry ghosts (profile worker,
  `surfaces []`); `board-authority-red` and `board-workerhalf-red` tests are in flight; the L2 wave
  driver (commit 238c5bf) parametrizes the board lane.
- **Solved on paper/landed:** closed BoardItem shape factories landed in `messages.mjs:286`
  (`createBoardItem`, frozen shapes, SAFE_BOARD_ID grammar, REFLEX-2 comment pins docs/32 §3.2).
  What is missing is durable claim/report authority + projection onto the facade/MCP surface.
- **Integration surface:** `messages.mjs`, `coordinator.mjs`, `application-semantics.mjs`,
  `mcp-northbound.mjs` (52 board matches today — mostly ghost registrations).

### F4. Worker-orchestrated swarm (UNLANDED — issue #74)
- **Proposed:** a coordinator-worker decomposes big specs into granular sub-specs + test rows for
  heterogeneous swarms, escalating big questions to the orchestrator.
- **Why now:** zero `swarm` vocabulary anywhere in `impl/` (verified) — the only greenfield item on
  this list; dogfood commit messages already reference "wave-4 swarm replica-C" informally.
- **Solved on paper (constraints to reuse, not re-derive):** phase 79 deliberately kept the
  orchestrator in charge of routes and rejected shared writable checkouts (authorship/replay/stop
  fencing); phase 77 supplies the recursive-Run lease a swarm coordinator-worker would hold;
  phase 75 supplies the bounded topology; phase 88 supplies exact route authority. A swarm spec is
  a composition of 75/77/79/88, not a new authority.
- **Integration surface:** `wave-driver.mjs`, `run-lineage.mjs`, `task-topology.mjs`,
  `workflow-definition.mjs`.

### F5. Cross-deployment knowledge (UNLANDED — issue #70, docs/34)
- **Proposed:** projects spanning deployments have no shared memory; every deployment root is its
  own KG today.
- **Why now:** #70 on the ledger; KG activation v1 just landed (commit 3c9f33d — ambient serving
  into briefs, candidacy queue), making the per-deployment boundary the next seam.
- **Solved on paper (the constraint is the spec):** phase 47 CA1 pins every Cairn policy to
  exactly one deployment `repoId`; phases 48/49/52/53 each re-bind audit/recall/promotion/
  assessment/contradiction policies to that same `repoId`. A cross-deployment design must reckon
  with that single-repoId pinning deliberately — it is load-bearing integrity, not oversight.
- **Integration surface:** `coordination-store.mjs`, `cairn-run-scorecard.mjs`, the
  `knowledge.*` event family.

### F6. Orchestrator attention inbox (PARTIAL — issue #71)
- **Proposed:** wake-with-decisions instead of poll for the orchestrator.
- **Why now:** #71; adjacent #51 (worker→orchestrator upward state feedback) and #79 (push
  attention/verdicts down the worker's own channel) are the same seam seen from both ends.
- **Landed pieces:** wave-level attention surfacing exists (`wave.mjs:4` comment + attention
  vocabulary across `wave.mjs`, `wave-driver.mjs`, `application-semantics.mjs`, `messages.mjs`);
  supervisor I4/I5 bounded-poll + out-of-band human path is the standing contract this must not
  violate.
- **Integration surface:** `wave.mjs`, `wave-driver.mjs`, `messages.mjs`, `mcp-northbound.mjs`,
  `web-stream.mjs`.

### F7. Adaptive routing policy derivation + fleet.roster (PARTIAL — phase 68 leftover, issue #83)
- **Proposed:** phase 68 shipped deterministic non-adaptive route resolution and explicitly left
  "adaptive policy derivation" open; #83 wants a first-class seat inventory (routes × live state ×
  occupancy × track record).
- **Why now:** the evidence substrate is already durable — phase 44 RouteStats records
  `route.outcome_observed` per verified task; phase 88 v2 route tuples are the authority form.
- **Integration surface:** `router.mjs`, `cairn-run-scorecard.mjs` (route stats),
  `application-semantics.mjs`, `route-tuple.mjs`.

### F8. Orientation epic successor (PARTIAL — issue #81, succeeds phases 32/33)
- **Proposed:** progressive codebase disclosure: `code.orient` map/region/detail + investigation
  receipts + conciseness-by-citation.
- **Why now:** #81 epic; `orientation-red`/`atlas-orientation-red` tests active; L2 wave lane.
- **Solved on paper/landed:** rung-0 `orientation.slice` (`brief`/`map` shapes), `repo.map`,
  `code.seed`, and fenced `orientWorker` delivery all landed (phases 32/33); Atlas index epochs +
  overlays (phase 13) are the substrate. The epic is an AX/grammar revision of landed machinery.
- **Integration surface:** `cartographer-quartermaster.mjs`, `atlas-index.mjs`, `coordinator.mjs`.

### Also open but smaller
- **Phase 86 containment gate** — verified OS containment for full-permission harnesses remains a
  required, unlanded fleet capability (phase 74's `workspace_preferred` is honest non-containment);
  gates live full-permission dogfood (#82).
- **Phase 91 broader gates** — repository-root and live persistent-provider evidence for semantic
  interrupt preservation (self-declared in spec §8).
- **Prescriptive doctor / diagnostics** (#72, #41, #47) — static readiness landed
  (`application-deployment.mjs` doctor, 329 matches); bounded actual-inference tier and
  prescriptive warnings unlanded; `diagnostics-red`/`readiness-credentials-red` tests in flight.
- **Browser-use lane** (#85) — no spec/phase* coverage; folded contracts live in
  `docs/reference/evidence/frontier-sweep-2026-08-03/`; `browser-use-red.test.mjs` active.
- **DECISION surfaces — do not re-spec:** phase 24 (JS/TS has no honest compiler IR; R3 is the
  ceiling) and phase 27 (whole-repo e-graph `retired_native`; whole-function redirects to phase 25
  behavioral evidence). Both are landed, executable refusals — reviving them means writing a new
  Decision against the recorded evidence, not re-implementing.

## 3. SUPERSEDED-BUT-ALIVE (vocabulary that still haunts current code/docs)

- **"Supervisor" (I1–I7)** — `spec/supervisor-state-machine.md`'s layer was absorbed into
  `coordinator.mjs` + `fence.mjs` + `runtime-isolation.mjs`; the noun "supervisor" now denotes only
  the recovery/poll/processing helpers. I-numbers are still cited as authority in phase specs
  (e.g. phase 8, 91). Rename candidate: retire "supervisor" for the control plane in docs, keep
  I1–I7 as "control invariants".
- **"Cairn" → "KG"** — phases 31/44/47–53 and `cairn-run-scorecard.mjs` say Cairn; the current
  test wave and issue ledger say KG (`kg-activation-red`, `kg-settlement-red`, #66 "KG settlement
  D4", #70). One substrate, two names. Rename candidate: pick KG in prose, keep `cairn/` ACI
  operation prefixes as frozen wire vocabulary.
- **"Scratch" → "scratchpad"** — phases 49/50 say "Scratch Finding/Scratch facts"; code and current
  issues say scratchpad (`scratchpad.write`, `scratchpad-33-red`, #59). Same substrate.
- **`fleet_*` tool dialect (phase 16)** — superseded as the MCP default by phase 64's nine
  `fleet_run_*` tools; survives deliberately under the `combined` advanced surface. Four dialects
  total are the subject of open issue #43 (control-surface audit).
- **`digest`/`brief`/`nudge` (communication-channel.md)** — the channel's message kinds persist in
  adapter prompt modes and wait digests, but the ordinary outer API is now phase 92's
  `run.episode` / `run.workstream.notify`. Old kind-names still structure `messages.mjs`.
- **`orientation.slice` / `repo.map` / `code.seed` (phase 32)** — issue #81 proposes the
  `code.orient` map/region/detail grammar; expect a rename of the landed rung-0 vocabulary.
- **`RunView` (phases 64–67)** — still the returned projection, but progressive disclosure moved
  to Episode topics in phase 92. Both live in `application-semantics.mjs`.
- **driver.md's eight primitives** — survived as the self-declared "advanced compatibility and
  emergency surface"; ordinary callers never see them. The doc was updated in place, so no drift,
  but readers landing there first get the kernel view, not the product view.

## 4. SPEC HYGIENE NOTES (drift worth an issue)

1. **Stale status headers (one sweep issue covers all):** `phase10.1` ("implementation pending"),
   `phase66` ×3 ("acceptance-red"), `phase67`, `phase70`, `phase71`, `phase72` ("acceptance-red"),
   `phase74` ("in progress"), and `phase93` ("planned, specification only… does not implement a
   Program runtime") all contradict shipped code — their tests and modules exist (phase 93:
   `impl/src/program-ir/` + 5 `phase93a-*` suites landed up to 93a.3a). Either adopt the phase 65
   pattern ("Status: shipped and green" with evidence link) or delete status lines.
2. **Phases 82/83 have no spec dirs.** `phase82-context-durability-red`,
   `phase83-context-application-red`, and `phase83-context-runtime-red` tests exist; the nearest
   normative text is inside phase 81/84/85. If those slices were specced elsewhere (docs/), a one-line
   pointer file per missing phase would close the archaeology gap. Phases 21/28 were skipped
   entirely — worth recording as intentional.
3. **`spec/IMPLEMENTATION.md` MVP scope notes are historical:** "single orchestrator consumer" and
   "no background timer thread" predate the web/MCP northbounds and the poll/processing/recovery
   supervisors (which do run intervals). The fence section itself still matches `fence.mjs`
   (`bumpHuman`, `stale_fence`) — only the scope disclaimers drifted.
4. **`spec/phase8/RECONCILIATION.md` records "294 test entries, 275 pass, 19 fail"** as of phase 8.
   It is an honest point-in-time TDD-red record, but unmarked as archival; a reader can misread it
   as current suite health. Suggest an "archival snapshot" banner.
5. **Time-pinned model identities age silently:** phase 30 GL2 pins `glm-4.7` as "the current
   efficient Coding Plan default" while current routes run `glm-5.2`; phase 71/72 pin Kimi K3 /
   `kimi` 0.27.0 facts (issue #54 already bit). These specs date-stamp their ground truth
   correctly — the hygiene gap is that nothing indexes which specs carry expiring vendor facts.
6. **Frontier specs live outside `spec/`:** readiness-credentials, browser-use, board, orientation,
   grammar M1–M5, reflex 1–4, REPL, and the wave-driver lanes are contracted in
   `docs/reference/evidence/frontier-sweep-2026-08-03/` folds + `docs/31–37`, with red tests under
   `impl/test/`. If `spec/phase*` remains the canonical contract home, the next landed frontier
   slice should either file a phase dir or the README should declare the new convention.

---
*Method note: statuses verified 2026-08-03 by vocabulary grep against `impl/src/` and suite listing
of `impl/test/`; issue numbers from `gh issue list --state open --limit 40`. Sibling digests:
`shipped-surface.md` (impl), `design-corpus.md` (docs/).*
