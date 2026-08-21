# 28 — Exhaustive current capability audit

This audit supersedes the **status** layer of the 107-row Phase-10 snapshot in
`docs/handoff/evidence/capability-matrix.json`. The old file remains the historical research
inventory; it is not deleted. Current status is grounded in public assembly, coordinator and
northbound call paths, focused tests, live evidence, and explicit retirement/reopening Decisions.
Documentation prose or an exported class alone does not make a full-system feature shipped.

## Decision

**No: Baton has not yet built every intended capability in the full-system goal.** It has a real,
live-proven control/trust/northbound spine and an unusually broad executable substrate, but the
capability plane, several governance/session depths, higher trust/evaluation programs, and parts
of the production northbound/runtime remain partial or pending.

The historical Phase 28 snapshot produced a 71-row primary matrix and an 83-row expanded matrix.
Its non-exclusive status totals are retained as evidence of that checkpoint, not as current feature
totals; the phase entries and remaining-work sections below supersede them. The exact row-level
evidence and disagreement are retained in
`docs/reference/evidence/phase28-exhaustive-capability-audit-grok-review-2026-07-11/`.

## What is genuinely shipped

1. **Fleet control and authority:** the eight commands, ordered delivery, fences, single-consumer
   questions/approvals, two-phase stop, terminal monotonicity, task DAG/claims, worktree ownership,
   typed pre-spawn worktree readiness failure, fresh verification, emergency stop, and complete
   in-process reap. Failed checkout creation cannot fall through to a worker turn or adapter cwd.
2. **Route specificity:** independent harness, exact model, and effort selection; visible
   requested/resolved/observed attribution; fail-closed mismatch; concurrent provider-observed
   exact Grok 4.5 and Composer routes. Literal Grok Build has concurrent exact process lifecycle
   and reap evidence and reaches provider readiness, but Grok CLI 0.2.99 reports `grok-4.5`; the
   exact-model mismatch is rejected and literal Build acceptance remains red. The shipped tuple
   contract and current evidence are retained in closed
   [GitHub #2](https://github.com/user/baton/issues/2).
3. **Trust spine:** immutable briefs, pinned verification, red→green, changed-line coverage,
   mutation, independent-family oracle, ff integration, approval-gated exact-SHA publication, and
   opt-in structured staging with post-effect poison semantics.
4. **Governance substrate:** scoped runtime homes/credentials, canonical token/USD/wall budgets,
   hard stops, deterministic watchdogs, and verified-outcome adaptive routing.
5. **Shared coordination/knowledge substrate:** operational ledger/cursors/replay, durable task and
   artifact authority, Scratch claims/facts/expiry, typed causal knowledge, bitemporal reads,
   contradiction/supersession, promotion, and contamination evidence. Its typed causal and temporal
   discipline is inspired by the repository's project-manager prior art, but Baton is self-contained
   with no external project-manager runtime or homelab dependency.
6. **Northbound:** authenticated HTTPS commands, resumable SSE, OIDC wire/bootstrap and minimal
   operator assets, edge policy/reconciliation, and MCP stdio tools over the same coordinator.
7. **Representation implementations:** R1 structural delta/rewrite proposals, R2 symbols/SCIP
   interchange, bounded R3 CPG/delta/taint/path sensitivity, bounded R5 behavioral fingerprints,
   R6 syntax-aware structured merge, plus explicit R4 and R7 Decision gates.
8. **Cairn Rung 0:** bounded run identity now survives direct/web/MCP spawn, task state, replay,
   handles/results, reviews/refinements, and coordinator-owned operational attribution. The
   deterministic `run.scorecard` ACI operation seals terminal runs, pins independent log tails,
   distinguishes verified from asserted completions, aggregates normalized cost/control/approval
   evidence, emits a content-addressed artifact, and atomically materializes Run/Artifact graph
   authority in one replay-safe event.
9. **Cartographer/Quartermaster local Rung 0:** `orientation.slice` and `reuse.internal` reuse one
   explicit immutable Atlas epoch plus worktree overlay through the Coordinator-owned ACI plane.
   Focused brief/map records are typed and resumable; internal reuse requires actual symbol/call/
   lexical evidence, while a miss returns only `external_vet_required`. Artifacts are confined,
   content-addressed, tamper-refusing, and exact-operation reverifiable; these local operations
   perform no network request and claim no verification or merge authority. Phase 33 adds
   `orientWorker`: exact-fence, authenticated addressed delivery over the existing serialized
   nudge lane. Capability code has no adapter authority; host paths/private provenance are stripped,
   and successful delivery is one actor-stamped `knowledge.map_served` event. Phase 34 adds an
   opt-in deployment-pinned scope-drift scheduler over immutable Brief scope and authoritative edit
   events, with per-path deduplication, one in-flight refresh, cooldown/turn ceilings, exact epoch
   and fence, stop-race refusal, and distinct mechanical outcome events. Kill remains the default.
10. **Quartermaster external evidence floor:** deployment-configured `reuse.vet` accepts only exact
   npm coordinates and combines exact Atlas import observation with bounded deps.dev/OSV evidence.
   Raw source bytes and normalized dossiers are content-addressed; TTL/cache/explicit-refresh and
   snapshot reverify fail closed; known advisories are never waived by incomplete reachability.
   It recommends only candidate/block/pending and has no install, decision, knowledge, verification,
   or merge authority.
11. **Exact-lockfile SBOM floor:** deployment-configured `provenance.sbom` turns a confined npm
   package-lock v3 into a deterministic CycloneDX 1.6 inventory and dependency graph. Components,
   integrity, dev/optional flags, nested resolution, and unresolved edges are actual-lockfile
   grounded; proposed registry graphs remain explicitly absent. It is content-addressed and
   reverifiable, with no mutation, advisory, decision, or promotion authority.
12. **Immutable reuse decision and causal promotion:** a deployment-authorized Coordinator path
   freshly reverifies the exact dossier and actual-lockfile SBOM, binds them to one configured repo,
   clean Git tree, Atlas effective overlay, lockfile digest, actor, need, exact coordinate, and policy,
   and records `borrow|build` only. One replay-validated `knowledge.reuse_decided` event materializes
   fleet evidence/decision artifacts, derived Findings, an actor-observed Decision, `Informed` and
   provenance edges, plus optional CAS `Supersedes` and affected-reader contamination. Blocked
   evidence cannot authorize borrow. Exact direct retry performs no second reverify; authenticated
   web and `fleet_reuse_decide` preserve actor/repo/idempotency. There is no install, mutation,
   merge, policy override, publication, PM export, or homelab integration.
13. **Advisory refresh guard and TTL invalidation:** separate Coordinator recheck authority accepts
   only an exact decision/version and closed trigger. TTL is hidden at exact expiry before the
   durable no-network closure. Advisory mode internally forces official refresh and reverification;
   an adverse observation atomically fences the exact coordinate, invalidates every matching stale
   Decision/dossier Finding, records affected readers, and projects a derived risk Finding plus
   `Affects` edges. A green check cannot clear the fence. Web and the twelfth MCP tool carry derived
   actor/repo/idempotency with no caller-supplied evidence or package authority.
14. **Proposed npm install graph and actual delta:** deployment-configured `provenance.plan`
   resolves one exact npm coordinate from immutable actual lockfile/manifest bytes without
   installing it. Measured macOS Seatbelt confines writes to a disposable root and denies direct
   network; an exact-authority loopback CONNECT proxy is the only registry route. Closed dependency
   specs, fixed argv, bounded output/deadline, marker-based subtree reconciliation, PID-start-bound
   lease, supervisor-verified receipt, separate proposed lock/SBOM/receipt/delta artifacts, and
   offline reverify fail closed. Authenticated web/MCP reach the same Coordinator-owned operation.
   The live official npm proof observes no source mutation or install. This is not a reuse decision,
   transitive advisory scan, reachability proof, provenance verdict, merge, or homelab integration.
15. **Transitive advisory projection:** Phase 41 scans every exact-input npm component in separately
   grounded actual or proposed graphs through fixed official OSV QueryBatch semantics, binds private
   scan-session/request/response evidence, retains typed dependency-path and supported-static-import
   attention, and permanently leaves vulnerable-function reachability unknown. It grants no waiver,
   clearance, decision, or mutation authority.
16. **Reuse policy-epoch reconciliation:** Phase 42 derives the only active policy identity from the
   deployment-pinned Quartermaster card and reconciles it synchronously under exclusive writer
   ownership. One bounded replay-validated event closes all mismatched Decisions and Findings,
   contaminates exact readers, preserves old adverse fences as stale-but-blocking, binds legacy
   matching Decisions, and projects local Constraint supersession/affect/informing lineage. Green
   migration never clears inherited adverse state; authenticated web/MCP replay reports current
   versus historical without accepting policy inputs. No provider request, policy authoring,
   positive clearance, external knowledge-graph runtime, project-manager export, or homelab
   integration is introduced.
17. **Cairn Rung 1 durable route learning:** Phase 44 atomically records one exact
   harness/version/model/effort/family/task-class observation only from the hub's authoritative
   terminal verification. The deployment policy is replay-pinned; same-key changed terminal,
   artifact, evidence, or route bytes refuse; append failure exposes no terminal, artifact,
   RouteStat, or live-router update. Startup hydrates a fresh router from coordination-ordered
   observations before dispatch. Cairn's bounded `route.advice` is deterministic and read-only,
   reachable through the existing authenticated direct/web/MCP capability path, and grants no
   routing-mutation, verification, merge, approval, publication, or worker authority.
18. **Supervised startup session auto-rejoin:** Phase 45 adds an opt-in exact deployment policy,
   synchronous readiness barrier, bounded stable eligible set, and one sequential supervisor over
   the existing identity-checked recovery transaction. Replay preserves only eligible native
   sessions' exact owned worktrees and private runtime homes; unsupported leftovers are reaped.
   Context, session ID, model, and effort are freshly checked before a refinement becomes working.
   Ordinary failures remain explicit orphans and a sanitized degraded summary; authoritative-write
   loss fails readiness. Async close kills every auto-attached transport before worktree/runtime/
   branch/writer release, and provider supervisors start only after readiness settles.
19. **Attested representation review packet:** Phase 46 fixes the full R1–R7 inventory in code and
   now attests 21 implementation/contract files, including Phase 54's R3 binding contract, from one exact current Git tree. Closed statuses keep
   AST/CST proposals, symbol/SCIP, bounded CPG/path, behavioral observation, structured merge, the
   R4 IR ceiling Decision, and R7 e-graph retirement distinct. Independent source/file/row/artifact/
   context bounds, content-addressed artifacts, full-claim reverify, audited ACI/authenticated web
   reach, and explicit zero authority prevent the packet from becoming a proof. Its retained-gap
   list makes live LSP, SSA/PDG/path solving, alias/heap/implicit flow, exceptions/interprocedural
   returns, external IR/translation validation, true semantic merge, and conditional e-graphs
   mechanically visible.
20. **Cairn causal integrity and attested audit/trace:** Phase 47 adds content/request-bound generic
   graph appends, replay-validated lifecycle rows, observation-version history, pinned valid-time
   views, live typed earlier lineage, authorized CAS contradiction resolution, exact affected-read
   contamination, independently bounded metric audit and live causal trace, repository/transport-
   bound direct/web/MCP reverify, durable request/result-bound ACI idempotency, descriptor-first
   occupied-artifact bounds, publication-edge cancellation, and a digested stable-ID copy of the
   full retained goal catalog. The 15 focused contracts and 1005/1005 canonical suite are green.
   Recursive exact-route GLM and Codex reports are freshly verified with full reap; the current
   two-Grok retry remains honestly authentication-red before provider PIDs.
21. **Cairn audit-gated bounded recall:** Phase 48 adds pinned Phase 47 audit gating, fixed integer
   lexical/graph ranking with stable ties, complete unresolved-contradiction bundles, compact
   append-before-return receipts, historical `ReadBy`/affected-reader projection, pull-only
   untrusted snippets, and exact direct/web/MCP replay and reverify. Durable request identity is
   recomputed from compact receipt fields. The public preview oracle is removed, and a closed-card,
   registry-derived ACI output policy rejects envelope or budget overflow before any receipt/read
   effect. Ten focused BR tests and 1016/1016 canonical tests are green. Exact Codex and project-key
   GLM reviews fresh-verified and fully reaped; the current two-Grok allocation remains explicitly
   auth-red before provider PIDs while all worktrees/runtimes/branches/writer authority reap.
22. **Cairn audit-gated selective promotion:** Phase 49 adds a deployment-pinned closed source
   taxonomy and derives candidates from one audited coordination prefix without caller nomination.
   Operator/orchestrator spawn and selected control/publication events become Decisions; closed
   policy failure observations become Counterexamples; and cited same-repository observed Scratch
   becomes a Finding only through distinct completed tasks with live verified outcome grounding.
   One atomic replay-validated batch uses fixed safe bodies, closed identifiers/digests, exact
   causal edges, max+1 ceilings, ACI pre-effect result gates, and direct/web/MCP invoke/reverify.
   Eight focused SP tests and 1024/1024 canonical tests are green. Phase 49 left derived-Scratch
   oracle release and correction/supersession explicit for Phase 50; Playbook/Skill promotion,
   recall feedback, contradiction UX, retention/compaction, and deployment-neutral export remain.
   Final exact project-key
   GLM `glm-4.7`/low review on PID `46906` fresh-verified, confirmed kill, and fully reaped; its
   non-reproducing transport, boundary, and ACI-preflight claims are dispositioned with explicit
   transport-binding and post-audit append regressions.
23. **Cairn Scratch correction and independent-oracle release:** Phase 50 adds a fact-bound
   `scratch_oracle` task whose explicit harness/model/effort route must differ from the producer by
   harness and model family. Hub-derived Scratch IDs, immutable bounded targets and worktree bases,
   exact six-field producer/reviewer route commitments, accepted worker/task/run/base/capture/
   commit/reverification provenance, current unsuperseded artifacts, and non-integrable oracle
   results prevent evidence substitution. `causal.correct_scratch`
   releases, supersedes, or retracts only the closed Scratch Finding class through one audited
   prefix-CAS event with target validity CAS, exact historical-reader contamination, closed public
   results, token-bound direct/web/MCP transport authority, ACI pre-effect output gates, and full
   replay/idempotency/tamper refusal. Fourteen focused SC tests and 1038/1038 canonical tests are
   green. Post-fix project-key GLM fresh-verified the implementation and was kill-confirmed/reaped;
   Codex initialization and two concurrent Grok allocations remained pre-PID red, so the strict
   native matrix is separately retained and does not inflate implementation status.
24. **Exact pre-ready provider process lifecycle and reap:** Phase 51 separates OS child existence,
   provider readiness, session identity, terminal close, and resource cleanup for Claude/GLM,
   Codex, Grok, and the live one-shot tier. Coordinator-selected generations, exact PID/group and
   source correlation, bounded refusal digests, setup/timeout/kill ordering, descendant-group reap,
   retryable forced and poisoned emergency kill, writer/verification cleanup authority,
   transactional recovery readiness, late-close replay, and bounded auth-protected public status
   are executable. Sixty-three focused PL contracts and 1103/1103 canonical tests are green.
   Recursive exact Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Grok `grok-4.5`/low,
   and Grok Build/low routes all produce exact start/close evidence and complete cleanup; the two
   Grok groups overlap, GLM fresh-verifies, and the strict provider matrix remains honestly red at
   the installed Grok CLI's unauthenticated readiness boundary.
25. **Cairn verified recall-outcome attribution:** Phase 52 adds a deployment-pinned
   `causal.assess_recall` operation that accepts only one observation boundary and deterministically
   selects task-scoped Phase 48 receipts followed by exact mapped hub verification and compatible
   terminal outcome. One compact atomic batch binds the historical exposure plus task/run/worker/
   route/verification/terminal evidence and reports `verified_pass_after_recall` or
   `verified_fail_after_recall` with `causationClaimed:false`. Nine grouped RA tests cover exclusions,
   borrowed evidence, races, contamination, audit/cancellation/append failure, every max+1 ceiling,
   restart/tamper, output preflight, and direct/web/MCP parity. It does not accept worker ratings or
   mutate grounding, validity, confidence, ranking, routing, or promotion. The 54-test adjacent
   Cairn gate and 1112/1112 canonical suite are green; recursive project-key GLM fresh-verifies
   PASS, while exact Codex and two concurrent Grok process groups retain honest route/lifecycle/reap
   evidence and that Phase 52 Grok provider-readiness matrix stayed authentication-red.
26. **Cairn authenticated contradiction workspace:** Phase 53 adds deployment-pinned
   `causal.contradictions` and `causal.resolve_contradiction` operations. The first presents a
   stable paged audited workspace of complete unresolved pairs using only bounded UTF-8 snippets
   and evidence/content digests. The second requires the caller to name edge, winner, loser, and
   all three exposed validity versions, then appends one replay-validated prefix-CAS event that
   closes the edge, invalidates only the loser, and records every bounded earlier ordinary/recall
   read. Historical views remain exact. Direct, authenticated HTTPS, and MCP share transport-derived
   authority; forged actors, stale/reversed races, malformed bundles, audit failures, cancellation,
   preflight mutation, append failure, and every independent ceiling fail closed. A durable append
   is explicitly commit-wins. Nine grouped CX tests, the 65-test adjacent Cairn gate, and the
   1121/1121 canonical suite are green. Recursive project-key GLM fresh-verifies PASS; Codex is
   honestly budget-cancelled, both Grok groups overlap but remain auth-red, and every process and
   ownership surface exactly closes and reaps.
27. **Atlas lexical-binding-aware R3:** Phase 54 replaces spelling-keyed reaching definitions with
   one deterministic, bounded two-pass binding model for simple JS/TS parameters, declarations,
   assignment-left definitions, and value references. Function/block scope and binding nodes,
   `DECLARES`/`BINDS`, stable semantic keys, nearest same-function resolution, binding-aware delta,
   binding-aware taint, explicit unresolved/unsupported boundaries, and every independent ceiling
   are executable. Resume rejects duplicate/malformed graph identity and derived child substitution;
   the fixed R1–R7 representation packet now attests the Phase 54 contract. Nine focused lexical
   contracts, 13 representation-integration contracts, and the 1130/1130 canonical suite are green.
   Recursive exact Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok
   Build/low all have exact start/close and complete reap evidence; both Groks remain authentication-
   red, Codex crosses its token ceiling in one reported burst, and GLM's terminal lump crosses its
   USD ceiling, so no semantic review report is mislabeled verified.
28. **Immutable bounded dual-root toolchain projection:** Phase 55 makes target Git identity and
   dependency/toolchain identity separate deployment inputs. One closed configuration inspects only
   selected ordinary files/directories under exact mapping/file/directory/byte/path/depth ceilings,
   rejects links, hardlinks, special/privileged entries, collisions and drift, and exposes only a
   content/policy identity. Worker, result verifier, base verifier, session resume/replay, and
   structured merge independently materialize and bind ordinary byte copies. Per-worktree excludes
   plus capture refusal keep projection bytes out of result commits without requiring target
   `.gitignore`; failure/reap/reconcile removes owned targets and exclude state. Legacy same-root
   copying is unchanged and mixed modes refuse before driver authority. Eleven grouped contracts and
   1141/1141 canonical tests are green. Recursive exact Codex, Claude, project-key GLM, Grok 4.5,
   and Grok Build routes used the shipped API against a clean dependency-free target: all five
   process groups closed/reaped, both Grok process intervals overlapped, and GLM fresh-verified under
   the same projection identity. Projection and lifecycle gates pass; provider matrix remains
   honestly red because Grok reports unauthenticated.
29. **Public exact fleet drain and driver close:** Phase 56 gives direct, authenticated HTTPS, and
   MCP a fenced replay-validated coordinator drain, and gives the process-owning host a stronger
   driver close. Drain records every target disposition, closes exact process generations, and
   reconciles process/worktree/runtime/branch and projection residue while retaining transport and
   writer authority. Host close performs that drain and then closes coordinator and writer authority
   under one deadline. The owned
   evidence wrapper also confines and reaps its full process group and temporary root. Thirty-seven
   focused contracts and the historical 1179/1179 canonical suite are green. The five-route run
   proves drain/lifecycle truth, not provider/report success; literal Grok Build remained
   authentication-red before provider observation.
30. **Route-bound truthful provider governance:** Phase 57 binds the orchestrator-selected harness,
   exact model, and effort to a closed strict/observe policy, per-turn reserve/release, native usage
   seals, provider/tool-call accounting, replay, and sticky post-acceptance revocation. It refuses
   strict claims when a route lacks native pre-effect support and never calls post-hoc telemetry
   prevention. Twenty-two grouped contracts and the historical 1256/1256 canonical suite are green;
   strict native never-cross enforcement and live provider readiness remain separate gates.
31. **Canonical sparse worker/verifier authority:** Phase 58 carries one exact sparse identity
   through deployment policy, atomic metadata, Git config/index, worktree events, capture, session
   replay/resume, verification, and reconciliation. Hidden/out-of-view changes, tracked projection
   substitution, base/branch smuggling, and physical ownership-root escapes fail closed. Fifty-four
   focused real-Git contracts are green. Sparse checkout remains materialization/integrity identity,
   not quota or a hostile-worker sandbox.
32. **Repo-scoped byte/inode capacity authority:** Phase 59 reserves the exact pinned selected Git
   tree, attested toolchain, and runtime allowance before worker/verifier effects. Sealed state,
   generation locks, nonce-bound release, restart adoption/dead-owner release, verifier cleanup,
   active legacy-close refusal, versioned/digested projection-target-parent accounting, sparse-parent
   union, and zero-state drain receipts are executable. The historical baseline was 34 focused
   contracts and 1346/1346 canonical tests; the post-Phase-59 repair baseline was 1351/1351. Both
   pre- and post-repair five-provider runs fresh-verified Codex, project-key GLM,
   and Grok 4.5 and exactly reaped all five routes; all three post-repair reports have no P0/P1.
   Claude login and literal Grok Build model identity remain red. Hard filesystem quota/same-UID
   isolation remains a later boundary.
33. **Attach-only native recovery:** Phase 60 commits recovery identity before continuation and
   durably distinguishes accepted, refused, and dispatch-unknown outcomes without automatic
   redelivery. Provider seats and resources remain owned through exact stop/reap. The current
   implementation and recursive lifecycle matrix are green; provider-backed recovery and the
   retained adapter/crash acceptance rows remain open rather than inferred.
34. **Graph-backed R1–R3 Representation producers:** Phase 61 fixes structural, SCIP, and bounded
   CPG mappings behind the sole ACI registry; current-card/environment binding, immediate source
   reverify, exact primary artifacts, stable identity, mode-0600 receipts, atomic Cairn lineage,
   replay/reconcile, direct/web/MCP parity, and every independent bound are executable. The
   Phase 61 baseline was 1415/1415. Baton produced and freshly reverified its own committed R1 delta,
   then admitted all five exact low-effort recursive routes; project-key GLM and Grok 4.5
   fresh-verified while all five process/ownership surfaces reaped. Claude login, Codex terminal
   reserve, and literal Build identity remain external red gates.
35. **Initial append-only Goal/Plan authority and settlement:** Phase 62 was introduced at
   `f4b8f46` and hardened through `230db8e`. Bounded immutable goal/plan versions, distinct
   proposer/approver authority, locale-independent plan ordering, exact nano-USD authority,
   iterative DAG validation, exact node route/capability/effect/verification commitments, complete
   closed authoritative Briefs, current-head dispatch, atomic pre-effect dispatch/task batches,
   and durable consumed/released/held/overrun settlement are executable. Generic task creation
   cannot bypass a mandatory scope; direct, authenticated HTTPS/SSE, and MCP share the same typed
   authority. The canonical suite is 1540/1540. The original mandatory five-node proof at
   `45072eb` admitted exact low-effort Codex `gpt-5.6-sol`, Claude Opus, project-key GLM `glm-4.7`,
   Grok 4.5, and literal Grok Build; both Groks overlapped and all ownership state reaped exactly.
   Its strict matrix remains honestly red at Claude login, absent Codex report, the concurrent GLM
   verifier failure, and literal Build observed as `grok-4.5`. Focused Codex at `9ce83e9` and
   project-key GLM at `230db8e` independently passed route observation, mechanical report
   verification (required shape plus pinned tests), Goal/Plan binding, settlement, lifecycle, and
   cleanup without relabeling the original matrix.

## What remains partial

- Exact provider-process lifecycle/reap and transactional recovery readiness now ship; in-flight
  session continuation, broader provider-backed crash/rejoin proof, deeper fork/rewind/checkpoint parity, and vendor-specific context,
  hook, broker, extension, and reconfiguration surfaces.
- Initial Goal/Plan definition, proposal, approval, status, mandatory spawn gating, web/MCP parity,
  reservation, terminal consumed/released/held/overrun settlement, replay, and status projection
  now ship. Richer verification/evidence predicates, authorized continuation/recovery nodes,
  amendments and migration, child/refinement allocation, live budget reallocation or increase,
  portfolio scheduling, richer risk/multi-principal approval, and distinct
  integration/publication/deploy/rollback authorities remain partial or pending.
- Canonical determinism is only locally hardened so far. Phase 62 plan and provider-policy ordering
  are locale-independent, but multiple Atlas, Cairn, supply-chain, capacity, and projection
  artifacts still use host-locale `localeCompare`. A repository-wide canonical-order audit,
  migration/version policy, and cross-locale replay gate remain open in
  [GitHub #4](https://github.com/user/baton/issues/4).
- Same-task-ID branch namespaces across independent controllers and branch-only crash residue still
  need explicit ownership and reconciliation contracts; see
  [GitHub #5](https://github.com/user/baton/issues/5).
- Goal/Plan capability/effect declarations provide bounded commitments and dispatch checks, but
  finer-grained effect enforcement, authorized continuation/recovery, live amendments, and richer
  risk/multi-principal policy remain open.
- Full Claude/Codex sandbox denial parity, contamination UX, operator
  pin/exclude/prefer controls, and account quota-window/fleet-seat scheduling.
- Exact cross-vendor semantic review is wired into the Run application, and a real independent GLM
  review has passed immutable-target, report, evidence, adoption, integration, and cleanup gates.
  Continuous semantic review automation, structured reject postmortems, and broad semantic-oracle
  accuracy are not proven; one successful report is route evidence rather than universal semantic
  correctness. The remaining oracle gap is tracked in
  [GitHub #6](https://github.com/user/baton/issues/6).
- Recursive execution now has Phase 55's immutable dual-root projection, Phase 56's public exact
  drain/close plus owned evidence wrapper, Phase 57's truthful route-bound usage/call governance,
  Phase 58's sparse identity, and Phase 59's pre-effect capacity reservation. Provider-terminal
  usage can still arrive too late for native never-cross containment, strict provider/tool limits
  depend on route-native support, and ad hoc direct invocations outside the owned wrapper still need
  explicit temp-root ownership. These are retained governance/lifecycle gates, not reasons to
  weaken exact reap claims.
- Structured merge is shipped with an injected Mergiraf-class boundary; a live Mergiraf binary
  proof is absent. Publication has no live remote-push proof.
- Scratch and causal knowledge primitives ship. Cairn Rungs 0–2 scorecard, verified RouteStats,
  restart hydration, bounded advice, causal integrity, contradiction resolution, and attested
  audit/trace, bounded recall, and the first closed selective-promotion batch now ship locally;
  derived-Scratch independent-oracle release/correction and verified recall-outcome attribution now
  also ship, together with the authenticated contradiction workspace. Phase 81/83 ships the closed
  stateless Context Program plus its durable pure-cell application vertical locally: immutable
  tree-bound manifests, canonical Context Program ASTs (not Atlas repository AST/CST),
  content-addressed source/output/evidence,
  append-only session/cell/settlement authority, restart replay, Context-aware stop receipts, exact
  Git/tree/blob/range provenance, owned process-group reap, credential-minimal execution, and a
  compact ContextSession facade.
  Phase 84 now also ships the first provider-backed Context effect vertical: one completed immutable
  cell maps to content-addressed partitions, one separately approved successor Plan, one atomic
  parallel Wave, exact per-child harness/model/effort and Plan binding, private partition Brief
  materialization, canonical terminal attachment, CAS output/evidence, and one replay-verified
  `task.resources_released` coordinate per child before aggregate settlement. Completed, failed,
  and cancelled children now retain the same exact resource-release evidence. A failed map
  generation also settles once, after cleanup, with the complete ordered accepted/failed/cancelled
  child set, typed retryable termination, immutable private evidence, and `outputRef: null`;
  idempotency mutation and replay duplication fail closed. Failed children cannot be overclaimed, recovery
  converges across admission/Plan/Wave/result/CAS/settlement boundaries,
  Run stop targets every owned Context call, including completed call history, and proves zero
  remaining Context ownership, while direct,
  generic CLI, authenticated Web, and MCP use the same application action and inspection cascade.
  The focused Phase 84 matrix, affected lifecycle/transport matrices, and the current 2,081-test complete
  implementation suite are green. Live Baton-on-Baton evidence completed two exact
  `gpt-5.6-sol`/`xhigh` partitions, recorded the atomic Wave and per-task process/session/worktree/
  runtime releases, and ended with zero owned resources; native Kimi was attempted first and was
  honestly blocked by an exact revoked OAuth tombstone (`authentication_refresh_required`) rather
  than bypassed. Recursive review also tightened the reap-to-settlement crash proof so recovery now
  preserves exact partition order, selected route, result, descendant task/worker/Run identity,
  cleanup target set, authority, and receipt digests without repeating provider or cleanup effects.
  Phase 84 does not ship reduce, semantic review, deterministic verify, recursive retry,
  Atlas/Scratch/knowledge-graph effect branches, or a general programmable orchestration loop.
  Phase 85's first slice now ships immutable Context-cell evidence v2, exact closed lineage for
  every pure operator output, dual-read historical v1 replay, refusal to launch new provider effects
  from aggregate-only v1 evidence, and Context-map v2 partition/Brief projection of one exact item
  lineage rather than an aggregate union. Durable evidence-only failed-call settlement above now
  also ships and is preserved across restart and Run stop. The provider-result capsule core
  now also projects an exact retained commit into private source CAS and a closed capsule, binding
  the canonical retained ref, base ancestry, complete changed-path set, scope, extractor policy,
  child, route, artifact, cleanup, and full source-ref identity; unsupported, partial-sensitive, or
  substituted results fail before usable projection. Durable accepted-child attachment now also
  ships: immutable child rows remain acyclic while an ordered sibling ref set is attached in the
  same settlement event; the application rederives exact historical Plan scope, coordination
  rereads/reprojects capsule and source CAS at settlement and replay, completed output contains only
  safe refs, and failed aggregates retain refs only for accepted children with null output. Closed
  output/evidence schemas prevent raw report smuggling. Workflow definition v3 now additionally
  ships one complete root semantic role catalog with closed node templates, exact independent
  harness/model/effort routes, physical/logical Attempt separation, canonical partition identity,
  and contiguous root/parent/generation ancestry across map and revision successors. Historical
  v1/v2 replay remains schema-stable while new successors upgrade once without inferring a logical
  role from a synthetic legacy name; mixed v2→v3 map admission survives restart. The focused
  role/revision/map authority matrix is 26/26. The pure CLR3 generation-1 `map | reduce`
  request/call/unit identity core now also ships with hub-derived requester authorization,
  deterministic selected-output lineage, and a one-way map-v2 projection that does not dual-write
  authority. Successful map settlement now emits call-evidence v3 whose ordered safe result refs
  each bind one exact source-cell output parent and one direct provider derivation through Plan,
  node, task, terminal event, route, artifact, capsule/source, cleanup, and child identity.
  Coordination rebuilds it on append, replay, and artifact reads while the settlement event keeps
  only content-addressed refs. Historical completed v2 replay remains supported but typed-ineligible
  as a reduce source; failed v2 remains lineage-free. The distinct real call-evidence source contract
  survives cleanup-gap recovery and repeated restart. Durable generic admission now also ships in
  the same event and projection: map schema-v1 history remains stable while effect-call schema v2
  closes service/requester, source, unit, Plan, definition/catalog/template, and exact route
  authority. Completed-cell map and completed-call reduce sources are reverified before append;
  admission is idempotent, replay-checked, included in Run-stop, excluded from map reconciliation,
  and deliberately performs no provider effect. Workflow status now also rebuilds worker Story from
  durable operational logs after restart, recognizes batched repository-relative file edits and
  recovery/process terminal events, and falls back to the Plan's durable terminal outcome when a
  live worker result is unavailable. An exact recovered Run that previously projected zero activity
  now reports one Codex turn, 3,326,408 tokens, exited activity, and typed
  `recovery_terminalized` for both Codex and GLM while still closing with zero workers. Public
  generic reduce proposal/recovery/approval/dispatch now consumes reverified private source content
  through one physical Brief, reopens without redispatch, and stops/reaps the generic worker. The
  latest counted complete suite is green at 2,110/2,110. Baton dogfood retained exact Codex high/xhigh Candidates and reaped both process
  groups; native Kimi K3/max was preflight-refused on expired cached authentication and closed with
  zero workers. A subsequent exact high/xhigh generic-admission attempt was operator-interrupted
  before Candidate retention; durable recovery terminalized both Attempts without inventing success,
  observed/closed both process records, and left zero workers. A fresh exact high/xhigh review then
  retained two accepted Candidates, independently passed 16/16 focused tests, and reaped both
  observed processes. Phase 85 retains the remaining load-bearing order: add generic settlement,
  projection-failure terminalization, workerless non-admission and
  selective retry generations, consolidate pure evaluation behind
  one immutable expression builder and `context_eval`, then live-prove map → reduce → retry → replay
  → stop/reap. Later versioned recall-learning policy, Playbook/Skill promotion,
  retention/compaction, and optional deployment-neutral export remain partial or pending.
  The dispatch dogfood additionally leaves `complete()` live progress/member-stop control and
  zero-Candidate cause presentation open. GLM-5.2 xhigh launch resolved exactly but stalled before
  any provider/tool event; Codex completed focused tests but did not return its final provider frame.
  Neither failed Attempt is represented as a Candidate.
- Phase 29 closes the former Atlas wiring gap: deployments inject a closed set of real Atlas
  instances, bounds, artifact roots, and optional trusted multi-root contexts into `createDriver()`;
  Coordinator owns the sole registry handle, and authenticated web/MCP reuse that invoke/resume/
  reverify path. Atlas is not auto-registered, so an empty deployment remains honestly empty.
- OIDC has a real TLS socket proof, not an in-app browser interaction; the production provider
  adapter, WebSocket parity, deep operator takeover, and some edge-policy review depth remain.
- Phase 30's historical `glm-4.7`/low receipt is retained only as lifecycle history and is not a
  currently admissible route or model-quality claim. Current GLM authority permits only `glm-5.2`
  at orchestrator-selected effort, including `xhigh` when warranted. Concurrent GLM-seat and
  automatic quota discovery remain unproven.
- Phase 32 closes the local orientation/reuse wiring gap, Phase 33 closes addressed downward
  worker push, Phase 34 closes bounded mechanical scope-drift refresh, and Phase 36 closes the
  exact-npm external evidence/freshness floor. Phase 37 adds the actual npm lockfile SBOM floor,
  Phase 38 closes the external `borrow|build` decision plus local causal-promotion transaction, and
  Phase 39 closes pull-to-refresh advisory fencing plus exact TTL invalidation, and Phase 40 closes
  the npm proposed-vs-actual graph delta under an isolated resolver supervisor. Phase 41 is now
  shipped as read-only exact-input transitive advisory projection plus conservative dependency/
  import attention evidence. Phase 42 closes deployment-card-derived policy-epoch reconciliation,
  bounded atomic fan-out, non-clearing adverse-guard migration, and exclusive writer ownership.
  Phase 43 closes the generic adverse-provider vertical through authenticated webhook/full-poll
  ingress, source-health recovery, official processing, durable supervised retries, bounded
  authenticated observation, replay, and cleanup. The authoritative pending ledger in
  `docs/capabilities/orientation-reuse.md` retains real provider/ecosystem adapters, positive
  clearance, exact `internal` decisions, plan approval/binding, trusted
  advisory-symbol identity and true vulnerability reachability, independent provenance, additional
  ecosystems, Socket/full-SCA enrichment, composite `fleet_reuse`/`fleet_provenance`, and optional
  export as distinct later contracts.

## What remains pending

- The integrated Run application now ships cursor follow, recovery, materialized result export,
  atomic multi-node parallel Workflow admission, typed feedback, Candidate selection, selective
  member/whole-Run reap, and one approval-gated exact-Candidate-base revision round across the
  shared command registry. The remaining application gap is not those foundations: it is the
  adverse active-revision restart/stop matrix, policy-admitted Plan v3, acceptance-level recursive
  action parity across direct/CLI/Web/browser/MCP, and compilation of review, debate, synthesis,
  partition, leased-lineage, and composed-overlay strategies.
- Slate's thread-weaving/episodic-memory proposal is useful architectural input, not evidence that
  Baton has already shipped the same product. Baton still needs one first-class addressed Episode
  projection that losslessly binds a bounded action to its exact Plan/Task/Attempt, requested/
  resolved/observed harness-model-effort route, immutable inputs, hub-computed facts,
  content-addressed result/evidence refs, separately fenced untrusted worker narrative, and exact
  lifecycle/release state. It must be a projection over existing authority rather than a second
  receipt ledger or orchestration engine, and it must appear as one compact Run change/card with
  outline → item → evidence expansion instead of adding another flat command family.
- On top of addressed Episodes, Baton still needs reusable one-action workstreams: `act()` performs
  one bounded tactic, commits one Episode, and pauses; `steer()` affects the current in-flight
  action; `queue()` appends a successor action against the exact Episode head; `interrupt()` stops
  the current action without fabricating workstream completion; and `stop()` fences and reaps the
  complete owned stream. Same-route continuation may resume a provider-native session, while a
  harness/model/effort change creates explicit cross-model lineage from immutable Episode refs.
  Paused must never mean an uncounted live process: it either has a replay-verifiable closed-process
  checkpoint/session state or remains visible in Run ownership. All methods must derive internal
  Plan/task/worker/session/worktree coordinates server-side and retain direct/CLI/authenticated-Web/
  MCP parity.
- A closed, versioned Program IR for orchestration remains a later gate, after Phase 85 lineage and
  Episode/workstream semantics. It may express bounded pure selection plus authorized dispatch,
  parallel, await, collect, retry, and selection operations, but must compile every provider effect
  through ordinary Goal/Plan authority; no ambient Python/JavaScript evaluator, arbitrary shell,
  hidden route override, or persistent agent-authored loop becomes authority. Revisioned shared
  state is likewise pending: immutable snapshots and append-only/CAS revisions may be shared by
  handle, with one generation-fenced writer where mutation is necessary, but concurrent
  full-permission multi-writer POSIX state remains unsupported. These gates complement rather than
  replace Atlas AST/CST/symbol/SCIP/CPG representations, Scratch, Cairn's causal graph, exact
  stop/reap, and authenticated user-to-orchestrator control.
- Native Kimi Code and the non-disruptive Claude-Code/Kimi compatibility route remain first-class
  harness targets, not one-off dogfood conveniences. Baton must preserve their separate credential
  overlays and existing Claude installation, exact harness/model/effort selection, and eligibility
  both to originate orchestration and to receive routed work. The same reciprocal contract applies
  to Codex, Claude, Grok, and GLM where their native surfaces permit it; unsupported verbs remain
  explicit rather than emulated invisibly.
- Unattended full-permission launch remains the default harness preference, with exact per-harness
  requested/resolved/observed attestation and honest containment gaps. It grants the child its
  native tool mode, not ambient Baton authority to widen repository scope, routes, credentials,
  approval, integration, publication, or stop ownership.
- The initial common RLM/REPL substrate is the immutable Context expression builder followed by the
  closed Program IR and durable effect-boundary runtime. It may feel Pythonic at the authoring
  surface while compiling to one canonical schema. A general persistent Python/JavaScript/custom
  kernel, ambient imports, or hidden mutable interpreter state remains deferred until replay,
  authority, cancellation, and resource-reap semantics are independently proved; a custom language
  should be earned by measured orchestration benefit rather than novelty.
- The primary historical product gap was completing the integrated Run application over the already-strong
  fleet kernel. Phase 64 now has concise intent/profile → Goal/Plan → distinct approval → exact
  dispatch → bounded RunView → answer/steer → durable Run-scoped stop/reap → host deployment shutdown, plus restart scheduling
  across the approval/dispatch boundary. Direct, authenticated Web/browser, and default MCP are thin
  projections of the shared registry; MCP EOF/signals use an injected host shutdown authority. A safe
  one-shot `baton` client now submits the same bearer-authenticated Web commands without owning
  fleet lifecycle. `baton serve` separately owns listener admission and exact application shutdown.
  That historical cursor/recovery/export/multi-node statement is superseded by the checkpoint
  above; it is retained here only as the sequence that led to the current application.
  Phase 65 now ships exact independent structured semantic review and separately authorized,
  fresh-evidence-bound local integration across direct/Web/MCP/CLI/browser surfaces. Terminal evidence manifests and
  non-merging result adoption now ship, and one bounded progress board consolidates the normal
  Plan/dispatch/provider/verification/semantic/result/cleanup state. Run stop now closes dispatch in the coordination ledger,
  snapshots exact targets, resumes before startup scheduling, and reaps without disturbing other Runs. Fleet-wide shutdown is named
  `application.shutdown` and must not masquerade as `run.close`. The credential-filtered Phase 65
  recursive proof ran the same application registry from intent through exact independent real-GLM
  review, adoption, fast-forward integration, completion, and pre-shutdown reap; it is evidence for
  that exercised route, not a claim of universal provider or semantic correctness.
- Trust ramp policy, richer Goal/Plan verification/evidence and amendment authority,
  impact-selected reruns, structured reject postmortems, and higher
  Evidence Ladder rungs (property/fuzz/BMC/SMT/proof) under honest language/tool ceilings.
- Vantage, Evidence Ladder as a capability module, Skill Forge/computer use, later
  Cartographer/Quartermaster supply/orientation rungs, and Cairn Playbook/Skill promotion,
  versioned feedback learning, retention, and export rungs remain pending; Phase 52's non-causal
  outcome-attribution substrate and Phase 53's authenticated human/orchestrator contradiction seam
  now ship.
- Direct structural rewrite apply, deeper AST/CST and lexical representation, live LSP/native SCIP,
  full SSA/PDG/path solving, interprocedural/alias/heap CPG depth, compiler IR/translation
  validation, closure/destructuring/catch binding support, deeper behavioral/provenance attestation
  overlays, and representation choreography. Phase 61 closes fixed graph-backed R1 structural,
  R2 SCIP, and R3 bounded CPG production; it does not satisfy deeper precision or R4–R7 gates.
- True semantic merge, stacked integration, deploy adapters, rollback automation, and live remote
  publication.
- Streamable HTTP MCP authorization, MCP Tasks/progress/daemon supervision, WebSocket parity,
  deeper operator surfaces, and OpenTelemetry GenAI export.
- Deeper authenticated web user-to-orchestrator policy/control, and the remaining retention,
  learning, contradiction, and planning depth of Baton's self-contained project-manager-inspired
  causal knowledge graph. This remains a local Baton design; homelab integration is out of scope.
- Reproducible M0/M1/E2 evaluation programs, automatic account-aware scheduling, and a production
  Go/Elixir core after executable contracts stabilize.
- Provider-terminal lump usage can cross nominal token/USD ceilings before Baton receives telemetry;
  sticky post-overrun artifact rejection now prevents that output from becoming an accepted task or
  router win. Preauthorization/headroom remains explicit governance work because no local policy can
  retroactively prevent already-reported spend. Provider-native budget flags are not treated as hard
  until live evidence proves enforcement.

## Explicit Decisions and conditional research

- JS/TS R4 compiler IR/translation validation is explicitly ceiling-retired at R3. External
  LLVM/MIR/MLIR paths remain conditional on tool/language/demand evidence.
- Native whole-repo R7 e-graphs are retired; whole-function claims redirect to behavioral evidence
  plus verification; external expression/kernel work remains conditional on Phase 27 thresholds.
- True semantic merge, multi-machine/A2A, extra vendors, and remote mesh stay visible and
  conditional. They cannot weaken the single-box authority model or be silently removed.
- Homelab integration is not a capability gap for this project; adding it would violate scope.
- RLM-style recursive evaluation is adopted first through closed Context expressions and the later
  durable Program IR; a general persistent REPL kernel remains explicitly deferred.
- Slate-style Episodes, workstreams, and Program composition are adopted only as independently
  verified design inputs. Baton retains exact pre-effect authority, provenance, route attestation,
  independent verification, scoped authenticated northbound control, and complete kill/reap rather
  than copying opaque summary trust, globally blocking forks, implicit shared-write authority, or a
  nested harness whose descendants cannot be observed and reaped.

## Dependency-ordered pursuit

1. **Make existing Atlas real fleet tools — shipped in Phase 29:** one Coordinator-owned registry,
   deployment-bounded ACI invoke/resume/reverify, real multi-root Atlas traversal, and authenticated
   web/MCP authority with no verification/merge authority.
2. **Close environment/live honesty gates:** GLM credentialed smoke without key disclosure shipped
   in Phase 30; live Mergiraf, real-browser OIDC, independent edge-policy review, and an optional
   safe remote-push fixture remain.
3. **Finish governance/session continuity:** durable router learning shipped in Phase 44 and
   supervised startup auto-rejoin shipped in Phase 45; next are provider-backed recovery proof,
   in-flight continuation, vendor-honest fork/rewind, compaction DoD reinjection, richer Goal/Plan
   verification/evidence, authorized continuation/recovery, quota-window/seat scheduling, and
   operator route overrides.
   Immutable bounded dual-root toolchain projection shipped in Phase 55; public drain/close,
   route-specific terminal-burst/call governance, sparse worker/verifier identity, and repo-scoped
   byte/inode admission shipped in Phases 56–59, attach-only recovery in Phase 60, and fixed
   graph-backed R1–R3 production in Phase 61, and initial append-only Goal/Plan, its atomic
   pre-effect gate, and durable settlement in Phase 62. The Phase 62 exact five-provider recursive
   run proves mandatory plan binding, concurrent Groks, and exact drain/reap; Claude login, the
   absent Codex report, the concurrent GLM verifier failure, and literal Build identity remain
   honest external/report gates. Focused Codex and project-key GLM retries independently pass.
   Internal pursuit continues with provider-backed continuation and the retained Goal/Plan,
   capability, causal-knowledge, web/runtime, and representation backlog.
4. **Build capability modules on shared substrate:** Cairn Rung 0 shipped in Phase 31 and
   Cartographer/Quartermaster local Rung 0 shipped in Phase 32, addressed push in Phase 33, and
   bounded scope-drift refresh in Phase 34, external evidence in Phase 36, exact SBOM in Phase 37,
   immutable external reuse decision/promotion in Phase 38, advisory/TTL invalidation in Phase 39,
   the isolated proposed npm graph/delta in Phase 40, transitive advisory projection in Phase 41,
   and policy-epoch reconciliation in Phase 42. Phase 43 now has its first provider receipt,
   semantic-processing, observed-Source, machine-ingress, and store-serialized pending-admission
   foundation plus card-pinned exact-wire HMAC and Ed25519/private-CAS webhook boundaries,
   readiness-critical startup receipt replay, and source-epoch sequence conflict/gap health.
   Seedless official Quartermaster processing now covers all-green and mixed/adverse roots with
   deployment index authority, invoke-plus-reverify evidence, async policy/index race refusal,
   atomic multi-coordinate pending removal, immutable multi-provider contributions, a grow-only
   aggregate guard, live Decision/Finding fan-out, manual/provider coexistence, causal Source/
   Finding/Affects lineage, and stale-but-blocking Phase 42 policy migration. Manual explicit
   cursor/full-poll reconciliation completion ships with
   closed poll cards, authenticated bounded proof, staged receipt admission, store-derived recovery
   CAS, causal freshness, replay, and race-safe non-clearance. Automatic deterministic single-flight
   scheduling, capped backoff, hostile-abort/lease-loss fencing, and asynchronous close/abort/await
   now ship. Repo-scoped count/derivation/byte-bounded authenticated web/MCP provider reads now ship
   with sanitized health and current/historical processing pagination. Fixed-origin authenticated
   no-redirect HTTPS paging, private cursor/credential handling, zero-network replay, and a real TLS
   recovery/restart/re-degradation/cleanup proof now ship. Durable deferred official attempts also
   ship with exact deployment policy, stable bounded due derivation, per-receipt attempt windows,
   replay-safe sanitized events, single-flight supervision, abort/lease fencing, restart
   continuation, and a live outage-to-recovery proof. Additional real provider/ecosystem adapters,
   positive clearance, and the still-red exact all-provider matrix remain. Phase 44 then ships
   Cairn Rung 1: atomic verified exact-tuple observations, local RouteStat lineage, deployment-pinned
   replay hydration, and bounded authenticated route advice, live- and recursively proved without
   a homelab or external knowledge-graph runtime. Continue the remaining explicitly
   catalogued later rungs, then demand-earned remaining Cairn Rung 2 depth and Rungs 3–4, Vantage,
   Evidence Ladder, and Skill Forge/computer use behind stronger containment. Phase 61 now closes
   the first graph-backed R1–R3 producer vertical without deleting any deeper rung.
5. **Complete recursive Context and adaptive workstream composition without a second engine:**
   Phase 84's separately approved content-addressed map/Wave/settlement/reap vertical is shipped.
   Phase 85's exact per-output pure lineage, map-v2 projection, all-terminal resource release,
   evidence-only failed-generation settlement, private retained-commit capsule core, and atomic
   accepted-child capsule attachment, durable root semantic role catalog, and pure generic
   generation-1 `map | reduce` identity core plus exact successful result-output lineage and a
   v3-only derived call source are shipped. Sole-authority generic admission, public reduce Plan
   proposal/restart recovery, separately approved exact-route dispatch, reverified private-source
   Brief materialization, reopen idempotency, and generic stop/reap are also shipped. Continue its
   fixed dependency order—generic success/failure settlement, projection-failure terminalization, workerless
   non-admission plus selective retry, unified `context_eval`, then live
   recursive proof. Next add the zero-effect addressed Episode projection, then one-action resumable
   workstreams with exact per-action harness/model/effort, steer/queue/interrupt/stop semantics,
   branch-scoped user attention, atomic parallel dispatch, and no uncounted paused process. Only
   after those contracts are replay- and reap-safe should a closed Program IR and revisioned shared
   state expose bounded adaptive composition; retain immutable shared snapshots, single-writer
   generations, and hub-owned verification rather than concurrent shared mutable sandboxes.
6. **Complete the remaining application and northbound/runtime depth:** extend the shipped Run,
   export, recovery, parallel Workflow, and bounded revision vertical with multi-round eligibility,
   the remaining canonical strategies, and recursive action parity; keep authenticated Web and MCP
   thin and make Episode/workstream control use the same scoped registry; replace phase-specific
   dogfood runners; then MCP HTTP/Tasks/daemon, WebSocket, operator takeover, OpenTelemetry, and only
   then a production-core port.
7. **Pursue representation/trust research only through its Decisions:** higher CPG/IR/semantic
   merge/e-graph gates, with measured incremental value and no proof-language inflation. Phase 54's
   lexical binding increment is shipped; closure/destructuring/catch bindings, SSA/PDG/path solving,
   aliases/heap/interprocedural flow, semantic merge, and conditional expression/kernel e-graphs
   remain explicitly catalogued.
8. **Productize evals and conditional federation last:** M0/M1/E2, including whole-task Attempt
   versus bounded-Episode workstream measurements for latency, context growth, rework, verification,
   operator intervention, route handoff, and kill/reap leakage; then multi-machine/A2A/extra
   vendors only if demand earns them.

Each item retains the earned loop: current verification → numbered contract → red tests →
implementation → adversarial review → live proof → catalog update. No “later” or “fenced” label
deletes a row.
