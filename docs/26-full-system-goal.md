# 26 — Full-system goal: no planned capability disappears

This is the plan of record after the 2026-07-11 completeness audit. It supersedes any reading of
docs 22–25 that treats “phase 10 complete” as completion of Baton’s larger design. Phase 10 proved
a useful first-turn control spine. The active goal is the complete fleet system described across
`SYSTEM.md`, `docs/`, `spec/`, and `reviews/`.

“Later”, “fenced”, and “research bet” are sequencing/status labels, not deletion mechanisms. Every
item below remains visible until it is either shipped with evidence or explicitly retired by a
recorded, evidence-backed decision. A feature cannot vanish from the goal through a summary.

## Scope correction

The shared knowledge design takes architectural inspiration from `project-manager`, but Baton has
**no homelab integration or runtime dependency** in this goal. It owns a deployment-neutral typed
causal substrate and may expose ordinary import/export interfaces later. This avoids coupling the
product to one machine or knowledge service.

## Definition of complete

Baton is complete when one orchestrator can choose **harness, exact model, and model effort** as
independent route axes, direct persistent multi-vendor workers through a durable northbound
surface, observe and govern them safely, accept
and integrate only independently established work, share operational/coordinative/epistemic
knowledge, and give workers the complete capability and representation planes below. Every claim
must be reachable through the public assembly, test-locked, adversarially reviewed, and live-proven
where a real harness or operating-system boundary is involved.

Completion also requires one integrated, run-centric application. A caller supplies a concise
objective plus a deployment-owned profile and route choice; Baton owns Goal/Plan compilation,
approval presentation, dependency scheduling, fences, Brief derivation, attention, recovery,
verification, semantic state, evidence, and cleanup. Direct embedding, the `baton` CLI,
authenticated Web, and MCP must call one command registry and return one bounded `RunView`.
Low-level Coordinator verbs and raw receipts remain an advanced kernel/debugging surface, not the
normal agent control surface. A phase-specific runner that manually recreates this choreography is
evidence that the application is incomplete, not an acceptable product interface.

The ordinary agent experience is one Pythonic, self-describing surface with logical methods and
closed parameter branches, not a bag of phase runners or kernel commands. Information and control
cascade from an outline to a table of contents, section summaries, and exact items only when the
caller asks for more depth. Every distinct CLI, Web, MCP, and embedding surface provides contextual
help at the same levels and projects the same application semantics. Routine callers never manage
token/USD/wall budgets, provider-turn counts, export byte/file ceilings, temporary roots, leases,
or capacity arithmetic. Baton owns safe defaults, readiness, capacity, cleanup, and progressively
discloses the exceptional condition and remediation when operator authority is actually needed.

The implementation loop for every increment is:

1. verify current reality;
2. write numbered contracts;
3. capture a red test or measured failing probe;
4. implement the smallest complete vertical;
5. run narrow and full validation;
6. adversarially review seams, not only modules;
7. live-prove the real boundary; and
8. update this catalog and the evidence ledger.

Recursive dogfooding resumes only after the lifecycle, provenance, and credential gates relevant
to the recursive run are green.

After those gates, dogfooding is continuous: Baton implements, verifies, reviews, integrates,
kills, and reaps the workers that improve Baton itself. Manual diagnosis may explain a rejected
result but may not bypass Baton's normal fresh-verification and integration authority.

## Complete capability catalog

### A. Fleet control and reliability

- One primary Run command bus: start, status/watch, approve, answer, steer, durable stop/reap,
  recover, and evidence. The original spawn, send, wait, respond, interrupt, result, list, and kill verbs
  remain the advanced kernel and emergency-control surface beneath it.
- Ordered delivery, human-over-policy fencing, single-consumer interactions, two-phase stop,
  terminal monotonicity, bounded setup/turn/stop operations, and process/worktree reap.
- Persistent multi-turn workers; interrupt-follow-up; resume, fork, rejoin, checkpoint, rewind, and
  crash recovery without fabricating uniform semantics across vendors.
- Restart-safe task/worker identity, pending interactions, fences, adapter/session references,
  worktree ownership, story, budgets, and routing state.
- Test and experiment resources are lifecycle-owned too: temporary repositories, worktrees,
  branches, runtime homes, logs, sockets, and fixture directories are registered, bounded, and
  reaped on success, refusal, crash, timeout, interrupt, and kill. Full-suite repetition must not
  leak disk until the host fails.
- Dependency DAG, refinement links, idempotent claims, artifact registry, path leases, and
  deterministic ready-work selection.

### B. Harness, model, and effort selection

Harness/CLI, exact model, and model effort are independent axes. The orchestrator can:

- name an exact harness and exact model;
- select a model while leaving harness routing automatic;
- constrain allowed/denied models or families and express ordered preferences;
- select reasoning effort and service tier where the harness exposes them, without encoding either
  as an accidental property of the harness name;
- inspect available/default/current model information and the provenance/freshness of that card;
- see requested, resolved, and observed harness/model/effort identities in handles, events,
  results, durable coordination, verification, routing statistics, replay, scorecards, reviews,
  and commit attribution; and
- fail visibly when a model cannot be honored—never silently fall back to a harness default.

Selection must map to real controls: Claude/GLM `--model`, Codex thread/turn model overrides, Grok
`--model`/ACP model state, and future adapters’ native mechanism.

Recursive dogfood uses orchestrator-selected routes per task. Exact `gpt-5.6-sol` may use lower
effort for bounded implementation or higher effort for architectural/adversarial work; there is no
global `low` default. GLM work uses exact `glm-5.2` with explicit task effort (including `xhigh`
where warranted), never the obsolete GLM examples retained in historical evidence. Kimi adds two
separate planned routes: K3 through the `claude-code` harness and native Kimi Code through its own
ACP harness. The ordinary Claude Code route currently pins exact `claude-opus-4-6`. Baton may not
silently substitute a model, harness, or effort. Once isolated Grok authentication is available,
Grok 4.5 through Grok Build remains the intended cross-family,
Opus-class review/implementation stand-in. These are operator policy inputs backed by live cards,
not timeless model folklore. GitHub issue
[#2](https://github.com/user/baton/issues/2) records the completed deterministic and recursive
route-tuple implementation gate. The isolated concurrent Grok rerun is now also complete: Baton
requested and provider-observed exact `grok-4.5` and `grok-composer-2.5-fast` routes, resumed one
session, killed it while working, and fully reaped both workers.

That historical Composer proof is not a literal Grok Build proof. Later recursive runs selected
literal `grok-build` and proved concurrent process start, exact close, and complete reap. The
current Grok CLI 0.2.99 reaches provider readiness but reports `grok-4.5`; Baton rejects the
exact-model mismatch. A literal Grok Build provider observation and accepted report therefore
remain red; Composer evidence is not a substitute.

Concurrent-provider acceptance includes starting multiple Grok workers at once, observing the
configured concurrency/card limits, interrupting and killing selected workers, and proving native
process, worktree, runtime scope, branch, and coordinator-state reap. Missing provider credentials
remain a typed live-evidence blocker; they are never grounds to project ambient secrets or weaken
runtime isolation.

### C. Southbound harness depth

The general launch default is the harness's approval-free/high-autonomy mode. Baton maps that
intent per harness (for example, native Kimi ACP `yolo`) and observes it before work where the
protocol permits. This does not delegate Plan, route, credential, verification, result adoption,
integration, publication, or kill/reap authority to the worker.

Autonomy, access, and containment are separate axes. Today, Codex uses `approvalPolicy=never` with
`danger-full-access`, Claude-family workers use `bypassPermissions` with their command sandbox
disabled, Grok uses `--always-approve` with sandbox `off`, and native Kimi uses ACP `yolo`. A private runtime isolates projected configuration and credentials; a
worktree selects the worker's repository context. Neither fact proves OS filesystem or network
containment. Claude, Codex, Grok, and native Kimi therefore report same-UID containment as unverified, and Baton's
one-shot tier consumes the private replacement environment instead of inheriting ambient host
state. Profile schema v2 now binds requested autonomy, full-versus-workspace access, and containment
through Plan, authoritative Brief, dispatch, and route-learning identity. Provider-observed mismatch,
complete recovery propagation, and concise Run/evidence projection remain before this policy is complete;
host-unrestricted execution is never mislabeled as worktree-contained.

- Claude: native session steering/interrupt, approvals/questions, hooks, context/usage
  introspection, compaction events, constraint reinjection, model/permission reconfiguration,
  resume/fork/rewind, config-home isolation, live capability discovery, and an isolated
  Kimi-through-Claude route that selects exact K3/max without mutating the user's Claude install.
- Codex: app-server sessions, steer/interrupt, approvals/questions, thread inject/resume/fork,
  goal pinning, structured outputs, review, compaction, usage/rate limits, broker/daemon topology,
  model/service/reasoning selection, sandbox policy, and schema-driven feature detection.
- Grok: ACP core plus model selection/state, session load/fork/rewind, auth, extensions, usage,
  multi-client attach, home/MCP isolation, and explicit handling of unsupported ask-user behavior.
- Native Kimi Code: ACP worker and orchestrator/recipient roles, exact `kimi-code/k3` selection,
  `max` effort, subscription-auth projection, full-permission `yolo`, session lifecycle, and honest
  cards for controls that ACP cannot observe.
- GLM: Claude-harness session parity, exact model mapping, non-refuser capability metadata,
  concurrency/quota inputs, scoped credentials, and live proof using only exact `glm-5.2` with
  orchestrator-selected effort (including `xhigh` for the intended dogfood), never an old example.
- Honest one-shot tier and future ACP adapters remain separately carded; no reduced tier may pose
  as the session product.

### D. Safety and governance

- Real OS sandbox profiles, worktree confinement, network policy, scoped environment/credentials,
  isolated harness homes, and Baton-gated outside-world side effects.
- Explicit dry-run/restricted/sample modes plus high-autonomy harness execution by default, with
  emergency stop always available and exact resource reap remaining mandatory.
- Wall, token, USD, rate-limit, account-seat, and quota-window budgets folded into authoritative
  state with thresholds, hard stops, and degradation policies. These are deployment-owned safety
  authority and observability, not routine caller arguments or environment choreography.
- Deterministic watchdog actions for mechanical stall/loop/scope/churn cases; semantic failure
  classifiers remain explicitly untrusted model judgments.
- Correct provenance: hub facts, worker prose, external evidence, and derived claims never share a
  trust label. Read edges support contamination/contradiction analysis.

### E. Trust, review, and integration

- Immutable validated delegation contract and exact definition of done.
- Fresh-result verification plus base red→green, coverage-of-change, mutation strength,
  impact-selected tests, property/fuzz/BMC/SMT/proof rungs, and reproducible counterexamples.
- Independent oracle construction and cross-vendor semantic-diff review for risk-selected work.
- A first-class **Goal/Plan authority**: bounded plans, explicit dependencies and risk, pre-effect
  plan review for consequential work, durable operator amendments, and proof that a worker cannot
  weaken the goal or definition of done while executing it.
- Structured postmortems and failure attribution linked to source events.
- Verified branch integration, textual then structured/semantic merge, conflict handling, effect
  tripwire, review artifact, and explicit approval before push/deploy/other irreversible actions.
- Stacked integration queues, deployment adapters, health-gated rollout, rollback automation, and
  live remote publication remain distinct approval-gated contracts rather than implied by merge.

### F. Routing, evaluation, and learning

- Routing buckets keyed by harness, exact model, model family, task class, capability, policy, and
  version; only verified outcomes learn; idempotent replay preserves them.
- New-model exploration, decay, refusal feedback/reroute, operator pin/exclude/prefer controls,
  quota awareness, automatic account/seat-aware scheduling, and outcome/calibration telemetry.
- Reproducible M0 control latency, M1 orchestration arms, and E2 cross-vendor decorrelation
  evaluations, including null/negative outcomes and human-audit cost.

### G. Three memory tempos plus Scratch

- **Operational:** append-only event ledger, resumable cursors, replay, artifacts, and telemetry.
- **Coordinative:** transactional task DAG, artifact manifest, claims/leases, refinements, and
  ready-work queries.
- **Epistemic:** durable typed causal knowledge with bounded recall.
- **Scratch:** TTL/CAS/take/notify blackboard and memoized Bench for fleet-live facts and leases.

The epistemic layer borrows the strong ideas—not the deployment—from `project-manager`:

- typed nodes: Run, Task, Artifact, Experiment, Finding, Decision, Hypothesis, Principle,
  Constraint, Source/Literature, RouteStat, Skill, Counterexample, and Representation;
- typed directional edges: Supports, Contradicts, Supersedes, Informed, ProducedBy, Contains,
  DependsOn, Refines, ReadBy, VerifiedBy, and DerivedFrom;
- every consequential decision has evidence edges to earlier immutable ledger events;
- temporal coherence forbids an edge to evidence that did not yet exist;
- bitemporal validity preserves what was believed then versus what is valid now;
- selective promotion avoids turning every event into knowledge;
- contradiction-gated, provenance-framed, token-bounded pull recall—never automatic shared-brain
  injection; and
- run scorecards expose graph and fleet health with metric breakdowns rather than one green bit.
- Atlas/CPG/semantic-delta producers mint evidence-bound `Representation` nodes and graph-backed
  deltas; merely permitting the node type does not count as building those producers.

### H. Capability plane

Every capability uses one ACI envelope, capability cards, cost/provenance, resumable long work,
cancellation, and hub re-verification.

1. **Atlas:** shared lexical search, AST/CST structural search/rewrite, symbol graph and SCIP/LSP
   navigation, optional semantic retrieval, base-plus-worktree overlays, staleness, and `code_seed`.
2. **Vantage:** DAP observation plans, causal debugging results, record/replay assets, exclusive
   debuggee leases, and reproducible postmortems.
3. **Evidence Ladder:** tests through proof with honest language/tool ceilings, mutation scores,
   trusted kernels, full dependency-closure hashes, and no “proven” claim over worker-weakened
   specifications.
4. **Scratch:** operational blackboard/coordination REPL and memoized experiment Bench.
5. **Skill Forge and computer use:** verify, promote, version, revoke, and share portable skills;
   distill flaky GUI trajectories into deterministic automation where possible.
6. **Cartographer and Quartermaster:** shared repository orientation/call graphs plus gated
   dependency/reuse/security evidence.
7. **Cairn:** run scorecards, causal findings/decisions, route statistics, promotion, recall,
   contradiction/supersession, and exportable body of knowledge.

### I. Representation and computation ladder

Representation is negotiated by task phase and cost, not reduced to raw text:

- R0 text/tokens;
- R1 CST/AST via tree-sitter/ast-grep/difftastic/GumTree-class edit scripts;
- R2 symbol/call/dependency graphs via LSP, SCIP, stack graphs, or equivalent;
- R3 code property graph: AST + CFG + PDG/dataflow/taint, including CPG deltas;
- R4 compiler/intermediate representations for optimization and translation validation;
- R5 behavioral fingerprints from differential/property/fuzz execution and effect signatures;
- R6 structured and semantic diff/merge over syntax, symbols, control/data-flow, and behavior;
- R7 e-graph/equality-saturation experiments where the domain is tractable; and
- representation choreography: orient with a coarse graph, focus with local AST/CPG, finish with
  a semantic delta and attestation overlay, retracting views no longer useful.

AST/structural delta was the first shipped representation vertical. Bounded symbol/SCIP, CPG and
behavioral-fingerprint rungs now also ship; structured merge ships while true semantic merge does
not, the IR ceiling remains an explicit Decision, and native whole-repo e-graphs are retired in
favor of conditional domain-specific research. Deeper precision and every unshipped rung remain in
the goal behind explicit prototype/evaluation gates; a negative result retires a rung through a
recorded Decision, never through omission.

Phase 54 closes the first measured lexical-identity defect inside R3. Simple supported JS/TS
parameters, `var`/`let`/`const` declarations, assignment-left definitions, and value references now
resolve through deterministic function/block scopes and formatting-insensitive binding keys. CPG
may-reaching definitions, delta, and taint share that identity; unresolved closures and unsupported
destructuring/catch syntax fabricate no value flow. The graph, derived artifacts, bounds, resume,
reverify, and fixed R1–R7 attestation packet fail closed. This does not claim closure capture,
aliases/heap/interprocedural flow, SSA/full PDG, compiler IR, semantic equivalence/merge, or e-graph
proof; every one remains visible under its existing Decision gate.

### J. Context, operator, northbound, and runtime

- Vendor-shaped briefs, addressed context, orientation references, constraint/DoD reinjection on
  compaction, context usage governance, and retractable views.
- MCP northbound fleet tools and tasks, a long-lived daemon, resumable waits/subscriptions, and an
  operator text/TUI seat with narrative, provenance, takeover, approvals, budgets, and emergency
  control. MCP and Web expose the same bounded, self-describing Run cascade and contextual help as
  direct embedding; they do not force callers down to receipt, ledger, lease, or task coordinates.
- An **authenticated web northbound** for the human user ↔ orchestrator direction. HTTPS command
  requests and a resumable WebSocket/event stream expose the same coordinator authority—not a
  parallel state machine—including spawn/harness/model selection, steer/nudge/turn, approval and
  question response, interrupt/kill, goals/tasks, narrative, budgets, and emergency control.
  Authentication binds a stable user/session identity; authorization scopes commands and repo/run
  access; every command carries an idempotency key, fence expectation, origin, and audit actor.
  TLS, secure session/token storage, expiry/revocation, origin and CSRF checks, replay protection,
  rate limits, reconnect cursors, backpressure, and disconnect semantics are contract-tested.
  Browser loss never cancels work implicitly, and the web tier cannot bypass approval, sandbox,
  budget, or trust gates. A richer visual UI is optional; the secure control connection is not.
  Numbered contracts and its adversarial gate live in
  `spec/phase12/authenticated-web-northbound.md` (WN1–WN10).
- Observability exports use OpenTelemetry GenAI conventions.
- One-machine production first, with a reliable Go or Elixir/OTP core after the executable-spec
  contracts stabilize. Remote/multi-machine execution remains catalogued but is not allowed to
  distort the local correctness boundary.

## Current pursuit order

Shipped checkpoint history (with each test count retained at its phase-completion baseline):
CK1–CK9 supplies the deployment-neutral task,
artifact, Scratch, and typed causal knowledge authority; Atlas supplies AST structural delta,
proposal-only structural pattern search/rewrite, shared base/worktree index, lexical orientation,
symbol/reference/call graph, SCIP JSON, and a first single-file CPG seed with containment,
control, lexical reaching-def, and honest local-call edges; and
Phase 12 WN6 supplies the authenticated resumable SSE orchestrator-to-user observation channel,
while the Phase 12 HTTPS surface supplies authenticated user-to-orchestrator commands; and Phase 14
supplies the first-class `{harness, exactModel, effort}` route tuple across cards,
direct and automatic dispatch, authenticated web commands, native wires, durable attribution,
learning, replay, recovery, review, verification, integration, and commit trailers. The recursive
Codex route/review gates used exact `gpt-5.6-sol` at `low` effort and fully reaped every worker.
The injected-provider login, atomic refresh/credential rotation, logout, and live stream
revocation lifecycle also ships under IL1–IL8 with fsynced session truth and fail-closed audit
ordering. EP1–EP9 now ships the canonical direct/trusted-proxy identity boundary, listener-wide
HTTPS enforcement, bounded request/login/principal/cost/ticket/connection quotas,
dependency-grounded readiness, audit-amplification controls, and bounded shutdown/stream cleanup.
It is locally green at 82 focused edge-policy tests after eleven recursive corrective reviews. A
twelfth clean Codex review was refused by the provider usage limit before a verdict, so the clean
independent-review gate remains pending. Authenticated concurrent Grok route/kill/reap now passes
for exact `grok-4.5` and `grok-composer-2.5-fast`: both provider identities were observed, one
session resumed, a live second turn was killed, and every owned resource was reaped. The first
rerun also exposed and closed linked-Git-worktree exclusion-path handling. That Composer route is
historical coverage of a distinct model, not literal `grok-build` evidence; current literal Build
reaches provider readiness but is observed as `grok-4.5`, so exact mismatch rejection and process
close/reap are green while literal Build acceptance remains red. Earlier dogfood exposed
a false-green missing-test command and 14,070
unowned temporary fixture directories that exhausted the host disk; fixture lifecycle ownership
is therefore an explicit reliability gate, not housekeeping. TF1–TF4 now makes `npm test` own a
private suite root, preserve pass/fail/signal truth, terminate the complete test process group, and
reap the root on every observable terminal path; the 660/660 canonical run left zero owned roots.
Direct bare `node --test` and uncatchable wrapper death remain outside that ownership boundary and
must not be used as the acceptance command or mistaken for supervisor reconciliation.

BO1–BO7 now supplies the concrete browser OIDC Authorization Code + PKCE bootstrap with
browser-bound one-time state, injected provider verification, exact issuer/audience/nonce checks,
durable session issuance, and clean callback redirect. BU1–BU7 supplies the first authenticated
operator seat over the same command/SSE authority, including independent harness/model/effort
dispatch and fenced worker control. RC1–RC6 adds durable same-user command-status reconciliation
without replaying effects. The combined Phase 12 suite is 100/100 and the full suite is
678/678. Phase 16 MN1–MN10 now adds the standard MCP 2025-11-25 stdio handshake and eight
closed fleet tools over the same coordinator, including independent harness/model/effort inputs,
fixed injected authority, deployment-owned quota, bounded waits, durable effect admission, and
restart-safe replay. Its 14 focused tests and the Phase 16 baseline of 692/692 are green, including
fatal UTF-8/output handling, lifecycle readiness, closed nested schemas, and deployment-derived
frame limits. A recursive exact-route review reached native `gpt-5.6-sol` and then hit the provider
usage limit; all owned resources were reaped but no independent verdict is claimed. Streamable
HTTP authorization, MCP Tasks, progress heartbeats, and daemon supervision remain explicit next
depth rather than being inferred from stdio. Real-browser interaction and provider-backed review remain pending; neither is inferred
from the deterministic suite. A real TLS socket proof now passes OIDC redirect/PKCE/callback,
operator/session, command, SSE snapshot, logout/revocation, listener shutdown, and owned-state
cleanup. The in-app browser interaction remains pending because its required execution bridge was
not exposed; the wire proof is not relabeled as a browser pass.

Phase 61's graph-backed R1 structural-delta, R2 SCIP-snapshot, and R3 bounded-CPG producers are now
committed, recursively dogfooded, and retained by the fixed R1–R7 packet. Phase 62's append-only
Goal/Plan authority, current-head enforcement, atomic pre-effect spawn gate, and terminal
consumed/released/held/overrun settlement now ship across direct, authenticated web/SSE, and MCP
surfaces. The next dependency-ordered work retains richer Goal/Plan evidence and amendment policy,
authorized continuation/recovery, provider-backed native-session depth, the remaining capability
and R4–R7 representation ladders, and deeper authenticated operator/runtime control.
Real-browser OIDC/control/stream/logout proof when its bridge is
available, optional WebSocket parity, Streamable HTTP MCP/tasks/daemon depth, and deeper operator
surfaces remain after those safety-ordered gates. Proposal-only structural rewrite now ships with a
9/9 focused gate, 701/701 full suite, and a Baton-on-Baton immutable proposal proof. Direct apply
and live-LSP depth remain, while CPG/dataflow, IR, behavioral fingerprints, semantic diff/merge,
and e-graphs stay in the catalog. The CPG seed, delta/impact, and operator-specified taint
continuation now ship. Phase 22 adds correct braced-if/else CFG, deployment-bounded CFG
may-reaching definitions, direct identifier-copy flow, immediate-only nested value edges, and
literal-dead-branch pruning, including reachable `else if` chains and conservative may-unions
inside atomic unsupported control. AST boolean leaves prune comment-bearing dead arms without
orphan join edges. The combined R3 gate is 31/31 focused and the Phase 22 canonical baseline was
776/776 green. Independent exact-model closure passes from Grok 4.5 and Grok Composer both found
no remaining actionable PS1–PS8 defect; their freshly verified reports and complete kill/reap
evidence are retained with the Phase 22 handoff.

Recursive R4 design dogfooding then encountered real host ENOSPC while the authoritative
operational log was appending. Phase 23 ER1–ER6 preserves ordinary poison/fail-closed semantics
but adds an explicit stop-only emergency kill: it can consume native confirmation and reap owned
runtime/worktree state while reporting `confirmed_unlogged`; timeout retains ownership and never
claims success. The recursive proof runner now handles its approval-pump rejection immediately,
uses emergency cleanup only after storage poison, and cannot count that degraded path as a pass.

After that repair, a clean concurrent exact-model R4 scope gate passed with normal durable
kill/reap. Both Grok 4.5 and Grok Composer independently rejected a Baton-authored JS/TS compiler
IR as relabeled CPG or an unverifiable bespoke SSA. Phase 24 makes the decision executable: all
JS/TS-family paths report an R3 ceiling and false `ir.build`, `ir.delta`, and `tv.validate`
operations fail typed. Real external LLVM/MIR/MLIR artifacts and Evidence-owned translation
validation remain catalogued behind language/tool/demand gates; they were narrowed, not erased.

Phase 25 now supplies the first measured R5 behavioral representation. A dependency-free JS ESM
export is run twice over a pinned JSON corpus in separate throwaway Node permission sandboxes with
ambient credentials stripped and filesystem-write/network/child/worker authority denied.
Before/after comparison reports exact case divergences and says
`observed_corpus_agreement_not_semantic_equivalence`; nondeterminism, timeout, denied effects,
resource excess, cancellation, and tamper fail typed. This is empirical differential evidence,
not coverage, a semantic proof, or permission to auto-merge.

The first concurrent exact-model Phase 25 implementation review found two real BF defects: shared
stdout allowed a deferred target frame to replace the runner result, and JSON normalization
collapsed runtime-distinct `NaN`/`null` and `-0`/`0` returns into false agreement. The child now
emits one exclusive structured-value frame and exits before deferred output; multiple frames fail
typed. V8 structured serialization is the comparison identity, while primitive previews remain
human-readable. Additional reds prove actual network, child-process, and worker-thread denial.

The next closure pass found that single-frame cardinality still did not prove runner ownership: a
target could forge one frame and exit before the epilogue. The parent now sends a random 256-bit
nonce over stdin; it is consumed before target import, retained only in the runner closure, and
required in the sole accepted frame. Early exit and forged frames fail typed. Authenticated
top-level runner errors also make missing/non-function exports reliably `invalid_export` rather
than generic execution failures.

A final concurrent exact-model closure pass then found no remaining actionable BF1–BF7 defect.
Exact Grok 4.5 and Grok Composer routes were provider-observed on distinct overlapping PIDs, both
reports were freshly trust-gated, normal kills were durably confirmed, and every owned process,
worktree, runtime, and branch was reaped. Phase 25 is therefore closed at its deliberately bounded
R5 contract; it does not silently acquire coverage, effect tracing, or equivalence claims.

Phase 26 now ships the lower R6 syntax-aware structured-integration rung without laundering it
into semantic merge. `ff-only` remains default. Explicit `structured` integration creates a
detached off-main stage, attempts Git's three-way merge, and passes only unresolved regular text
conflicts—one bounded temporary file at a time—to an injected Mergiraf-class resolver. Missing
tools, unknown outcomes, parse fallback, remaining markers, binary/deleted paths, file/output/time
bounds, dirty or advanced main, and fresh verification failure all refuse typed. Only a two-parent
candidate that passes the immutable pinned primary check in a distinct fresh worktree may
fast-forward main. Reconcile reaps orphan stages; post-effect authority failure remains poisoned
and replay cannot invent success. CPG and behavioral evidence have no integration-authority hook.
The first concurrent exact-model implementation review found three concrete SM4/SM2 seams: NUL
binary conflicts could reach the resolver, marker detection missed delimiter-free marker debris,
and local Git inherited ambient `GIT_*` redirects. Baton now rejects NUL conflicts before resolver
invocation, detects any seven-or-more diff3 marker run at line start, strips all ambient Git
control variables, disables system/global Git config and hooks for staging, and pins these with
reds. A targeted Composer closure then caught the symmetric output seam: a resolver could inject
NUL after the input check. The same binary refusal now gates both sides of the resolver trust
boundary. A subsequent Composer pass found a canonical-path TOCTOU seam around Baton-owned
post-resolver writes. Conflict paths are now canonical-realpath confined before read and required
to retain the exact same canonical identity before write; a hostile resolver-timed parent symlink
swap refuses without modifying the external target. Later exact-model passes closed embedded
marker debris, final-hook execution, ambient Git influence outside staging, and post-fast-forward
authority misclassification. Every exception after the Git effect boundary is now incomplete and
poisoned rather than falsely refused, with an independent `stageSha` inspection for untagged
errors. The host lacks Mergiraf, so the 16/16 focused gate uses an injected wire-faithful resolver
and a live external-tool proof remains pending. A final concurrent exact-model pass at `d92d82d`
found no remaining actionable SM1–SM10 defect; both reports were provider-observed, freshly
verified, normally killed, and fully reaped. True data/control-flow semantic merge stays catalogued
behind adoptable-engine, measured-demand, and false-clean evaluation gates.
Phase 27 makes the remaining R7 e-graph bet executable rather than silently dropping it. Native
whole-repo equality saturation is retired; whole-function equivalence redirects to the shipped
behavioral fingerprint plus pinned verification; expression/kernel equality saturation stays
conditional external research behind exact demand, translation, scale, accuracy, and incremental-
value gates. `AtlasEGraphEvaluation` builds no graph and proves no equivalence. It emits a
content-addressed Decision and refuses native build/saturation/proof, verification bypass, and
merge authority typed. The focused gate is 6/6 and the canonical suite is 776/776.
Final concurrent exact-model implementation closure at `4d038d0` found no remaining actionable
EG1–EG8 defect; both reports were provider-observed, freshly verified, normally killed, and fully
reaped.
Baton-on-Baton proofs cover a `sha` helper node/edge delta with reverse-caller impact and the real
MCP `JSON.parse` assignment reaching `server.handle`. SSA, full path-condition feasibility/PDG,
shadowing-aware bindings, aliases, heap/implicit flows, exceptions, interprocedural returns,
dynamic dispatch, unbraced control expansion, and repository-wide CPG overlays remain unclaimed.
These checkpoints narrow sequence only; they do not retire any later capability below.

Phase 31 ships Cairn Rung 0 without importing the deployment shape of `project-manager` or adding
any homelab integration. A caller-selected bounded `runId` now survives direct, authenticated web,
and MCP spawn; durable task/replay state; public handles/results; review/refinement lineage; and
coordinator-owned operational attribution independently of harness, exact model, and effort.
`run.scorecard` deterministically seals only terminal runs, pins the coordination prefix plus each
task's worker-log tail, distinguishes hub-verified from merely asserted completions, aggregates
normalized token/USD deltas, human interventions, approvals, outcomes, and exact route rows, and
marks prose DoD coverage honestly unavailable. One content-addressed artifact and one durable
`run.sealed` event materialize the Run/Artifact nodes and Contains/ProducedBy edges together, so a
torn line fails as a truncated tail and no multi-line prefix can grant half a run's authority.
Reverify replays the exact bounds and rejects missing evidence, attribution drift, path substitution,
or byte tamper. Phase 44 separately ships RouteStats and route advice as Cairn Rung 1; causal
audit/recall, contradiction UX, and optional deployment-neutral export remain explicit Cairn
Rungs 2–4 and are not implied by either earlier rung.

Phase 32 ships the local Cartographer/Quartermaster floor without adding a second repository map.
`orientation.slice` provides focused typed `brief` and `map` views over an explicit immutable Atlas
epoch plus optional worktree overlay; `reuse.internal` requires projected symbol/call/lexical match
evidence before recommending repository reuse and returns only `external_vet_required` on a miss.
Both operations use the sole Coordinator-owned ACI registry, bounded resume, canonical artifact
confinement, exact reverify, authenticated generic web/MCP reachability, and false authority. A
recursive Baton-on-Baton run exposed and fixed path-token broadening and then passed exact epoch,
self-orientation, grounded reuse, honest miss, resume, reverify, audit, and zero-worker-effect gates.
Addressed `orient_worker`, dependency-vetting oracles, TTL/advisory updates,
license/provenance/reachability policy, immutable decisions, SBOMs, and knowledge promotion remain
explicit later contracts. No homelab or project-manager runtime is introduced.

Phase 33 makes the marquee addressed orientation push executable without granting Cartographer
worker-control authority. `orientWorker` verifies an exact live worker fence before computing a
slice, invokes only `cartographer-quartermaster/orientation.slice`, strips host paths and closed-out
deployment provenance, and delivers structured typed evidence over the worker's serialized nudge
lane. The lane rechecks worker/fence authority after computation; stop/interrupt races therefore
cannot cross it. A successful acknowledgement produces one authenticated `knowledge.map_served`
operational event. Existing web and MCP `capability_invoke` unions gain a restricted `push` action,
not a second command/state machine. A recursive scoped Baton-on-Baton run delivered the real
Cartographer implementation map to an active worker and then confirmed kill plus complete
worktree/metadata/runtime/branch reap. Automatic scope-drift detection, dedup, cooldown, and refresh
policy remained the next contract at that checkpoint; no automatic worker intervention was
implied by the addressed-push rung alone.

Phase 34 adds that automatic intervention as an explicit deployment policy, not as capability
autonomy. The authoritative worker `content.file_edit` projection is compared to the immutable
Brief scope. Outside-scope paths are considered once per native turn; one exact Atlas epoch/focus
may be refreshed at a time under configured cooldown and per-turn ceilings. Delivery reuses
Phase 33's fenced addressed nudge, and a concurrent stop voids the result. Mechanical violation,
suppression, refusal, and acknowledged map delivery are distinct durable facts. The default remains
immediate kill, and neither semantic scope inference nor authority expansion is claimed. The live
recursive proof also exposed a separate lifecycle defect—failed worktree readiness was swallowed
before adapter spawn—which Phase 35 repairs rather than obscuring behind the clean-repo proof.

Phase 35 makes new-session checkout readiness an orchestrator-owned prerequisite. Synchronous and
asynchronous creation failures become one fixed `worktree_unavailable` lifecycle fact before a
conforming adapter can create a child, announce a worker turn, touch disk, or spend provider quota.
The raw Git/path failure is withheld; task/run/route attribution remains exact; pending spawn is
aborted; new-task worktree ownership and runtime scope are reaped; replay is identical; and a
concurrent stop retains terminal authority. Mock now waits before announcing a turn and does not
duplicate the coordinator's failure. This does not auto-stash, retry, broaden repository authority,
or delete resume-owned context.

Phase 36 ships Quartermaster's external evidence/freshness floor without claiming complete supply-
chain authority. `reuse.vet` is advertised only with deployment-injected oracle and policy. The
dependency-free public adapter accepts exact npm package+SemVer coordinates, uses fixed HTTPS
deps.dev GetVersion plus OSV QueryVersion and optional deps.dev GetProject, refuses redirect/
timeout/cancellation/schema/pagination/byte/advisory/coordinate failures, and privately persists
each raw response by digest. The bounded dossier excludes third-party prose, conservatively blocks
known advisories/malicious packages and denied policy facts, marks missing evidence pending, caches
only by exact epoch/overlay/coordinate/policy until TTL, requires explicit refresh after expiry,
and snapshot-reverifies without network. Atlas contributes only npm import observation; it cannot
claim vulnerable-function reachability or waive an advisory. Actual `@ast-grep/napi@0.44.1`
deps.dev+OSV evidence passes the live ACI proof. Exact-lockfile SBOM and immutable
decision/promotion now ship in Phases 37–38, and Phase 39 adds forced advisory refresh plus exact
TTL invalidation. True reachability, optional Socket, and independent Sigstore verification remain
ordered later rungs.

Phase 37 adds the actual dependency inventory required before any durable reuse decision.
Deployment-configured `provenance.sbom` reads one canonical confined npm package-lock v3 under
byte/component ceilings, rechecks source identity after read, and emits deterministic CycloneDX
1.6 components with exact versions/links, integrity, dev/optional posture, npm purls, root identity,
and nested-then-hoisted dependency edges. Missing targets remain explicit unresolved edges. The
artifact and provenance are labeled `actual_lockfile`; `proposedGraph` is explicitly absent, so a
deps.dev hypothetical resolution can never be mistaken for installed state. Ref-only partial
results avoid infinite cursors, and exact rerun detects lockfile change. Baton's real lockfile
produces 10 components and re-verifies. Vulnerability scanning, mutation, proposed graph/delta,
decision/promotion, and policy waivers remain outside this rung.

Phase 38 adds the Coordinator-owned immutable external reuse decision. A deployment must bind one
repo ID, a contextual actor/subject authorization policy, and text ceilings. `borrow|build` requires
fresh exact dossier and actual-lockfile SBOM reverify; dossier reverify also reruns Atlas to bind the
effective overlay, while the environment reference binds clean Git tree, epoch/overlay, and lockfile
digest. Only a `borrow_candidate` can authorize borrow. A full evidence-projection digest, distinct
decision identity/content digests, reserved fleet artifact/graph namespaces, and replay validation
prevent sparse-field substitution and squatting. One `knowledge.reuse_decided` event creates the
artifacts, derived Findings, observed Decision, `Informed`/provenance edges, and optional CAS
`Supersedes` plus contamination. Authenticated web and the decision MCP tool carry the real actor.
Exact idempotent retry stops before reverify. `internal` awaits its exact local-evidence transaction.

Phase 39 adds separate recheck authority, forced official refresh, a permanent exact-coordinate
adverse fence, store-derived fan-out across every matching live Decision, stale dossier-Finding
closure, causal risk `Affects` edges, affected-reader contamination, exact-expiry hiding and durable
TTL closure, plus authenticated web/MCP controls. A green check cannot clear the fence. Provider
push/polling, positive clearance, and `internal` remain later; Phase 42 separately closes
deployment-policy change reconciliation. No installer, merge, policy override, PM export, or
homelab integration is introduced.

Phase 40 ships the separately grounded proposed install graph that Phase 37 intentionally omitted.
`provenance.plan` accepts one confined actual lockfile path and exact npm coordinate through the
Coordinator-owned ACI plane. Quartermaster binds immutable lockfile and manifest bytes, then a
deployment supervisor runs fixed-argv npm under measured macOS Seatbelt confinement: writes are
limited to a disposable root, direct network is denied, and a loopback CONNECT proxy admits only
the exact registry authority. Existing and proposed dependency specs reject file/workspace/link,
Git/SSH, URL, hosted shorthand, and aliases. The supervisor receipt binds executable/sandbox
digests, source/proposed digests, proxy policy, exit, and complete cleanup; marker-based process
reconciliation survives process-group escape without trusting a reused PID. Separate addressed
lockfile/SBOM/receipt/delta artifacts offline-reverify against the unchanged actual source, root,
coordinate, kinds/order, and recomputed graph delta. The operation does not install, decide, merge,
scan all transitive advisories, prove reachability, add ecosystems, or integrate with homelab.

Phase 41 ships the next read-only supply-chain vertical. It scans every exact-input component in
separately grounded actual or proposed npm graphs through a bounded official OSV batch contract,
binds scanner-authored request/response transactions, retains deterministic root dependency paths,
and reports only narrowly named supported-static-import observation. Missing imports, zero local
CPG paths, ambiguous nested instances, unsupported syntax, links, and workspaces never become
`unreachable` or positive clearance; known advisories retain their block priority. True vulnerable-
function reachability waits for trusted release-artifact/export identity, advisory-to-symbol
mapping, and stronger module-aware Atlas/CPG.
The full distinct later backlog is authoritative in `docs/capabilities/orientation-reuse.md`; no
homelab or project-manager runtime integration is introduced.

Phase 42 closes the policy-epoch safety gap. `createDriver()` derives the complete normalized policy
commitment only from the pinned Quartermaster card, validates it against deployment configuration,
and synchronously activates it before exposing Coordinator authority. A first baseline binds
matching legacy Decisions to the observed policy `Constraint`, closes mismatching legacy
Decisions, and marks legacy guards policy-stale but blocking; later policy changes atomically close
every mismatched live Decision and
dossier/risk Finding, contaminate their exact readers, and preserve adverse guards as policy-stale
but blocking. Constraints form a local `Supersedes` chain and `Affects` invalidated Decisions;
current Decisions bind their active Constraint with `Informed`. Green review migrates inherited
adverse state through `DerivedFrom` without clearing it, while a fresh adverse observation records
guard/Finding supersession lineage. Exact replay validates the policy projection, card, targets,
graph identities, actor/key/time, normalized allow/deny sets, and six deployment ceilings.
Exclusive writer claims and the lifetime lease prevent overlapping authority; construction failure
and explicit close release ownership. Public web/MCP surfaces reveal only the sanitized commitment,
and no caller can nominate policy or reconciliation targets. This remains Baton's local deployment-
neutral causal graph: no project-manager or homelab runtime is consulted or mutated.

Phase 44 closes the durable adaptive-routing and Cairn Rung 1 gap. The hub atomically binds each
terminal hub-verification outcome to one exact harness/version/model/effort/family/task-class
observation under a deployment-pinned policy. Exact retry is zero-effect; changed terminal,
artifact, evidence, or route bytes refuse; append failure updates neither the coordination
projection nor the live router. Immutable verified `RouteStat` nodes retain task lineage, and a
fresh router hydrates from their ordered observations before dispatch on restart. Cairn's bounded
`route.advice` reads this evidence through the sole direct/authenticated-web/MCP capability plane
without accepting outcomes or gaining routing-mutation authority. Live two-route restart proof and
an exact credentialed `glm-5.2`/orchestrator-selected-effort recursive run both verify no replay double-count and complete
kill/reap. Phase 45 supervised auto-rejoin, Phase 46 representation attestation, later causal
audit/recall and contradiction hardening, and every higher AST/SCIP/CPG/IR/behavior/merge/e-graph
contract remain in the goal. No homelab or external project-manager runtime is introduced.

Phase 45 ships deployment-opt-in supervised startup auto-rejoin without weakening PS7's manual
trust gate. A bounded startup scan installs a synchronous readiness barrier, retains only replayed
native-resumable sessions' exact worktree and private runtime ownership, and attempts them
sequentially. Fresh context validation and exact native identity/model/effort precede recovered
worker authority being exposed as working. Per-session mismatch/refusal/timeout leaves an explicit
orphan and a sanitized degraded summary; authoritative-write loss fails readiness. Provider supervisors remain
stopped until readiness settles. Async close awaits the scan and kills every auto-attached session
before releasing worktree, runtime, branch, Coordinator, and writer ownership. The fixture proves
verified turn → simulated process loss → exact rejoin → verified refinement → full reap. This does
not claim in-flight turn continuation, checkpoint/rewind parity, or provider-backed native resume.

Phase 46 prevents the representation program from shrinking through documentation drift. The
`representation.review` ACI operation fixes R1 AST/CST structural work, R2 symbol/SCIP, R3 bounded
CPG/CFG/path/taint/delta, the R4 compiler-IR ceiling Decision, R5 behavioral fingerprints, R6
structured merge, and the R7 e-graph Decision into one ordered packet. It now reads 21 fixed source and
contract files from an exact current Git commit, independently bounds files/bytes/rows/artifact/
context, writes a content-addressed artifact, and reverifies the entire deterministic claim.
Authenticated ACI reach grants no edit, verification, merge, approval, publication, routing,
proof, or policy-authoring authority. The packet mechanically retains live LSP, SSA/PDG/path
solving, alias/heap/implicit flow, exceptions/interprocedural returns, external IR/translation
validation, true semantic merge, and conditional expression/kernel e-graphs as unbuilt work.
Phase 54 adds its lexical-binding contract to the R3 attestation row without changing the seven-rung
inventory or upgrading its bounded status.

Phase 47 closes Cairn Rung 2's causal-integrity prerequisite. Every generic graph append is
request/content-bound and replay-validated before materialization; all producers retain true
observation-version history. Queries pin transaction and valid time, and durable reads preserve
that boundary. Same-type live supersession uses validity CAS and atomic exact-reader contamination.
Contradictions have a canonical pair, cannot be born resolved or bypassed through endpoint
invalidation, and close only through an authorized winner/loser CAS event. The bounded Cairn audit
uses live typed earlier lineage and reports independent causal/temporal/structure/grounding/
contradiction/recall/contamination metrics; bounded live trace counts nodes, edges, evidence, and
frontier and refuses unrelated graph state over deployment ceilings. Content-addressed mode-0600
packets and complete direct or transport-canonical reverify are repository-bound through the sole
ACI path. That ACI path now durably binds each idempotency identity to the authenticated repository,
actor, action, capability, operation, input digest, budget, and result; concurrent duplicates
coalesce, restart duplicates replay, and changed requests conflict. Audit artifacts are exact-size/
owner/mode checked through a no-follow descriptor before read, and cancellation closes the final
publication seam without residue. The packet embeds a versioned digest of stable IDs for the full retained capability
catalog—including AST/CST/SCIP/CPG/IR, Scratch, Vantage, Evidence Ladder, Skill Forge, session/
provider/runtime depth, semantic merge/fingerprints, and e-graphs—so Phase 48 recall and the wider
goal cannot disappear through summary. No external project-manager or homelab runtime is added.

Phase 48 makes that audited graph deliberately recallable without creating an ambient shared
brain. `causal.recall` pins one observation/valid-time boundary, reruns the Phase 47 critical audit,
and applies fixed integer ID/type/body plus bounded graph-distance ranking with stable node-ID ties.
It returns unresolved contradictions only as complete bundles and frames every bounded snippet as
untrusted evidence. One compact `knowledge.recall` receipt is appended before content and projects
exact `ReadBy` edges and later contamination; the receipt omits raw text/bodies and recomputes its
request identity from compact query/reader/policy fields on restart. Direct, authenticated web, and
MCP claims share exact replay/reverify. The sole store call has no public preview oracle, and the
closed ACI card opts into registry-derived envelope/payload preflight so size refusal leaves no
receipt or read effect. Exact Codex and project-key GLM recursive reviews supplied the red tests and
fresh verification; the latest exact Grok 4.5/Composer pair remains honestly auth-red before native
PIDs while all allocations and ownership reap. Recall feedback, broader selective promotion,
Playbook/Skill promotion, authenticated contradiction UX, and deployment-neutral export remained
catalogued next; no homelab or external project-manager runtime is added.

Phase 49 ships the first broader selective-promotion batch without placing the knowledge plane on a
safety-critical control path. `causal.promote` pins one coordination boundary, reruns the critical
audit, derives only closed operator/orchestrator Decisions, policy-authored Counterexamples, and
independently verified cited observed Scratch Findings, then appends one all-or-nothing replay-
validated batch. The caller cannot nominate sources, candidates, text, edges, or grounding. Fixed
safe bodies and digested metadata omit briefs, Scratch values, prompts, commands, reasons, paths,
URLs, credentials, and provider payloads. Direct, authenticated web, and MCP invocation/reverify
share exact repository/actor/idempotency authority and pre-effect result gates. Derived Scratch
remains quarantined. Correction/supersession and independent-oracle release, Playbook/Skill
promotion, Phase 52 recall outcome attribution, authenticated contradiction UX, retention/compaction, and
deployment-neutral export remain mechanically retained. Baton remains self-contained: the local
project-manager material is causal-graph inspiration only, and homelab integration is excluded.

Phase 50 closes the derived-Scratch exception without broadening general promotion. A
`scratch_oracle` task pins one hub-derived fact and routes its reviewer by explicit harness, exact
model, effort, and model policy; reviewer harness and family must differ from the producer, and the
accepted artifact binds exact producer/reviewer route tuples, worker, capture/commit SHA, and hub
reverification. Oracle tasks may test in isolation but can never integrate their result.
`causal.correct_scratch` releases, supersedes, or retracts only the closed Scratch Finding class in
one audited prefix-CAS event with exact historical-reader contamination, target validity CAS,
restart replay, pre-effect ACI result gates, and token-bound direct/web/MCP identity. Scratch IDs are
hub-derived and public results contain only closed metadata. Playbook/Skill promotion, recall
outcome attribution, authenticated contradiction UX, retention/compaction, deployment-neutral export,
Bench, and every retained control/session/representation/capability rung remain explicit. No
homelab or external project-manager runtime is introduced.

Phase 51 closes the native-process evidence and reap gap exposed by recursive exact-route runs.
Claude/GLM, Codex, Grok, and live one-shot workers now emit a closed, credential-free
`process_started`/provider-ready/`process_closed` sequence bound to a coordinator-selected
generation, PID, group, and adapter source. Readiness and session identity remain distinct;
transactional recovery persists only sanitized process readiness until exact native identity is
accepted. Kill confirmation requires exact close, process-group death, and owned cleanup;
interrupt retains reusable-session authority, forced disposition retains writer authority, and
ordinary or poisoned emergency kill can retry a dead-but-unconfirmed reap. Replay accepts an exact
late close without treating historical PIDs as live. Direct, authenticated web, and MCP list expose
only the bounded process reference. The 63 focused contracts and 1103/1103 canonical suite are
green. Recursive Baton exact-routes Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Grok
`grok-4.5`/low, and Grok Build/low; all four start/close pairs and full ownership restoration are
retained, with simultaneous Grok process groups observed. GLM fresh-verifies its report, while the
strict provider matrix remains honestly red because the installed Grok CLI reports unauthenticated
before readiness. No homelab or external project-manager runtime is introduced.

Phase 52 closes Cairn's recall-feedback observability prerequisite without making a causal claim.
`causal.assess_recall` accepts only a pinned observation boundary, reruns the critical graph audit,
and selects every previously unassessed task-scoped Phase 48 receipt whose exact historical
exposure preceded exact mapped `verify.reverified` evidence and a compatible terminal transition.
One compact append-before-return event binds receipt, task/run/worker/route, node/version/score/
contradiction commitments, verification, terminal outcome, policy, and digests. Its only outcome
codes are `verified_pass_after_recall` and `verified_fail_after_recall`, always paired with
`causationClaimed:false`; task success is not mislabeled “helped,” worker feedback is not authority,
and no grounding, validity, confidence, ranking, routing, or promotion state changes. Honest audit
axes now report eligible/assessed coverage, pass/fail-after association, distinct exposed nodes, and
later contamination. Exact no-op/idempotency/race/restart/tamper behavior, all independent ceilings,
ACI pre-effect output refusal, and direct/authenticated-web/MCP invoke and reverify are executable.
Nine grouped Phase 52 contracts, the 54-test adjacent Cairn gate, and the 1112/1112 canonical suite
are green. Recursive Baton independently fresh-verifies the project-key GLM PASS report, reaches
exact Codex provider readiness, overlaps two exact Grok process groups, records matching close for
all four routes, explicitly kills GLM, and restores every owned resource. The strict provider
matrix remains honestly red at the installed Grok CLI's authentication refusal before readiness.
Phase 53 separately closes authenticated contradiction UX; versioned learned weighting,
Playbook/Skill promotion, Scratch Board/Bench, Goal/Plan authority, retention/checkpoints, and
approval-gated neutral export remain explicit. Baton stays self-contained with no project-manager
or homelab runtime integration.

Phase 53 makes unresolved causal conflict operable without adding a second state machine.
`causal.contradictions` reruns the critical audit at a caller-pinned prefix and returns stable
canonical pages containing complete live pairs, bounded UTF-8 snippets, and evidence/content
digests under an explicit untrusted frame. `causal.resolve_contradiction` accepts only an
authenticated explicit edge/winner/loser selection with exact edge and endpoint versions. One
schema-versioned replay-validated prefix-CAS event closes the edge, invalidates only the loser, and
records every bounded ordinary or recall reader of that loser; the winner and all historical views
remain intact. Direct ACI, authenticated HTTPS, and MCP share trusted transport-derived authority,
exact idempotency and reverify, and pre-effect audit/output/cancellation/append gates. Preflight
state mutation refuses rather than rebasing; after the durable append, commit wins and Baton returns
the receipt. Nine grouped contracts, 65 adjacent Cairn contracts, and the 1121/1121 canonical suite
are green. Recursive exact project-key GLM fresh-verifies PASS, exact Codex is honestly
budget-cancelled, two concurrent Grok routes remain auth-red before readiness, and all four exact
process/ownership lifecycles reap. Learned recall weighting, automatic conflict resolution,
Playbook/Skill promotion, Scratch Board/Bench, retention/checkpoints, and neutral export remain
catalogued—not silently folded into this operator seam. The project-manager influence remains
architectural prior art for Baton's local graph; no homelab or external graph runtime is added.

Phase 54 also records recursive-operation truth rather than only feature truth. Baton exact-routed
Codex `gpt-5.6-sol`/low, project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok Build/low from one
pinned clean target; all four process identities closed, the Grok groups overlapped, and every
owned process group, worktree, runtime, branch, and writer reaped. The strict review gate remains
red: Codex crossed a token ceiling in one telemetry burst, GLM reported its usage only at terminal
and crossed the USD cap after looping on self-checks, and Grok still refused authentication before
readiness. The next recursive-runtime increment therefore binds clean target and immutable bounded
toolchain projection as separate identities, adds route-specific terminal-burst/call governance,
and exposes a public drain-and-close attestation.

Phase 55 ships the first of those recursive-runtime increments. A closed deployment configuration
pins one absolute private source, source ID, selected mappings, exact file/directory/byte/path/depth
ceilings, and expected content manifest. Its public identity contains no host path. Baton scans with
ordinary-file descriptor identity, rejects links/hardlinks/special/privileged entries, snapshots
bounded bytes, independently copies and verifies worker/result/base-verifier materializations,
rescans the source, and atomically cleans failure. Projection targets are absent from the target
commit, per-worktree excluded, and refused if force-added at capture. Worktree readiness, native
session validation/replay, result/base verification, and structured merge all require the same
identity; legacy same-root dependency copies remain compatible and mixed configuration refuses
before writer/worker authority. Eleven grouped contracts and the 1141/1141 canonical suite are
green.

Recursive proof used this shipped API—not a manual dependency stage—against a clean pinned target.
Exact Codex `gpt-5.6-sol`/low, Claude Opus/low, project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok
Build/low all received the same projection identity. Every one of five process groups has correlated
kill/close and complete worktree/runtime/branch/writer reap; both Grok intervals overlapped, and GLM
fresh-verified a report in its independently projected verifier. Projection and lifecycle gates are
green. The provider matrix stays honestly red because Grok currently reports unauthenticated; the
GLM report's claimed hardlink P0 is rejected by the cited guard, dedicated regression, and fresh
verification. The run also exposed 8,899 stale temp directories from earlier direct exploratory
test invocations, which were reclaimed without touching source or credentials. Temp-root ownership
for every bespoke evidence runner, route-specific terminal-burst/call governance, and a public
drain-and-close attestation are therefore next operational slices. This work does not displace
provider-backed session continuation, Scratch Board/Bench, Skill/Playbook promotion, authenticated
web/operator depth, evaluation, or any AST/CST/SCIP/CPG/IR/behavior/semantic-merge/e-graph rung.

Phase 56 ships the public drain-and-close and universal evidence-owner cleanup increment. Direct
ACI, authenticated HTTPS, and MCP now expose one actor-pinned, idempotent `coordinator.drain`
contract, while the host driver exposes `drainAndClose` to stop supervisors, fence admission,
durably record every target disposition, close exact process generations, reconcile historical
worktree/runtime/branch/projection residue, close coordinator authority, and release the writer
lease under one deadline. Replay validates the disposition set and counts; a completed historical
drain cannot claim a new controller's physical epoch. The owned evidence wrapper now confines the
entire process group and temporary root, escalates TERM to KILL, and proves both gone. Thirty-seven
focused contracts and the 1179/1179 canonical suite are green.

Recursive Baton-on-Baton proof selected exact harness, model, and effort for Codex
`gpt-5.6-sol`/low, Claude Opus/low, project-key GLM `glm-4.7`/low, Grok 4.5/low, and Grok Build/low.
All five routes admitted concurrently; both Grok process groups were sampled alive at the same
instant, and every started generation, leader, group, worktree, runtime, branch, projection, target,
coordinator, writer, and evidence-owner root reaped through `drainAndClose`, with no manual worker
kill or legacy close. A focused GLM retry completed, stayed inside its raised declared budget,
fresh-verified Phase 56, and captured an accepted report. The provider matrix remains honestly red:
Grok's isolated ACP sessions still report authentication required despite an owner-only projected
login file, Codex app-server closed before a response in the five-route run, and Claude did not
produce an accepted report. Concurrent full checkouts also exposed a real capacity limit because
historical evidence dominates the repository; sparse verifier projection is now proven, while
capacity-aware sparse worker checkouts and explicit headless provider credential readiness remain
next operational work alongside route-specific terminal-burst/call governance.

Phase 56 does not narrow the system goal. Provider-backed continuation/recovery, authenticated
user↔orchestrator web/operator depth beyond the shipped drain, Scratch Board/Bench, Skill/Playbook
promotion, trust and evaluation, Atlas/representation expansion, deeper AST/CST/SCIP/CPG/IR and
behavioral analysis, semantic merge, and conditional expression/kernel e-graphs all remain. The
shared causal/temporal knowledge graph remains a self-contained Baton system inspired by the
repository's project-manager material only; no homelab or external project-manager runtime,
credential, query, mutation, or integration is in scope.

Phase 57 ships truthful provider governance over the exact harness/model/effort route selected by
the orchestrator. Closed strict/observe policies bind token metric, usage, provider/tool-call
counts, per-turn reservations, terminal seals, policy digest, and route digest through live events,
result, replay, and post-acceptance revocation. One-shot argv and session routes retain exact model
and effort, while process lifecycle remains bounded and reapable. The canonical suite reached
1256/1256 green. Closed GitHub issue #2 is the public implementation record for exact
harness/model/effort routing; it is not evidence that the remaining live provider-readiness gate is
green. This work does not replace provider-backed recovery, authenticated operator depth,
Scratch/Bench/Skill promotion, or any representation rung.

Phase 58 began as the sparse-worker response to a real Baton-on-Baton ENOSPC failure before any
provider call. Adversarial review proved that initial sparsity alone was unsafe, so the shipped
contract is broader: a canonical sparse identity is now enforced across deployment, atomic private
metadata, Git config/index state, worktree events, live/replayed/resumed session context, capture,
result/base verification evidence, and reconciliation. Capture refuses sparse broadening/disable,
metadata loss/forgery, hidden deletion/addition, prefix escapes, and any full-tree diff outside the
admitted view. Worker/result/base commits cannot hide tracked toolchain targets behind sparse
materialization. Physical worker and verifier IDs are confined before effects; invalid expected
workers are reaped on restart. Combined sparse plus immutable-toolchain native resume is executable.
Fifty-four focused real-Git contracts are green, including exact coordinator-base/branch binding
against metadata smuggling and non-symlink realpath confinement for worker/verifier/integration
ownership roots.

Phase 59 now adds actual fleet byte/inode reservations because sparse checkout is neither a quota
nor a security boundary. A closed deployment policy reserves the exact pinned selected Git tree,
attested toolchain bytes/files/directories, and runtime allowance before worktree, runtime, task, or
provider effects. Repo-scoped HMAC-sealed state, generation locks, nonce-bound release, restart
adoption, abandoned-verifier cleanup, active legacy-close refusal, and pre-writer-release zero-state
drain receipts are executable. Legacy un-attested dependency copying refuses when capacity is on.
The HMAC is corruption detection when its key is withheld, not a hostile same-UID worker boundary;
OS sandboxing and hard isolated-volume quotas remain explicit later gates. The historical Phase 59
baseline was 34 focused capacity contracts and 1346/1346 canonical tests. The first five-provider
recursive sparse+capacity run on `afe1ff6` admitted all five exact requests, sampled both Grok
process groups simultaneously, fresh-verified Codex, project-key GLM, and Grok 4.5 reports, and
exactly closed/reaped every process/worktree/runtime/branch/writer/capacity surface. Claude remained
not logged in; literal `grok-build` was observed as `grok-4.5` and rejected. Its reviews exposed two
P1s: target-parent projection inodes were undercounted, and dead foreign reservation owners could
remain retained. Versioned/digested total-directory accounting with sparse-parent union and
dead-owner reconciliation now close both under red/green tests; the canonical suite is 1351/1351.
The post-repair run on `7780266` again admitted all five exact requests, observed both Grok groups
simultaneously, fresh-verified Codex/GLM/Grok 4.5, returned three reports with no P0/P1, and exactly
closed/reaped every ownership and capacity surface. Claude login and literal Build provider identity
remain external red gates; the all-provider matrix is not claimed complete.

The Phase 60 implementation baseline now closes the covered deterministic attach-only
native-recovery transaction. Recovery validates
an exact completed, hub-verified, same-worker lineage; starts an abortable attach-only native
process; proves the exact provider session identity without sending the recovered Brief; atomically
creates and claims one bounded recovery refinement; records an exact continuation intent; and
exposes worker `working` authority only after an adapter-local accepted disposition. Ambiguous
delivery remains durable `dispatch_unknown` and is never automatically redelivered. Provider-turn
authority is released only after exact stop/reap, owned cleanup, and any late spawn settlement.
Dedicated store APIs bind not-sent refusal to exact zero-fact operational evidence, refuse generic
recovery-task mutation and unverified/context-substituted lineage, and fail replay on newline-
complete torn create/claim or refusal/transition batches. The Phase 11 persistent-session gate is
43/43, the dedicated store/replay gate is 7/7, adjacent adapter/lifecycle validation is green, and
the Phase 60 baseline was 1415/1415. Provider-backed recursive evidence and the remaining NR7
crash/adapter rows remain separate acceptance gates.

The first Phase 60 recursive five-route review then admitted Codex `gpt-5.6-sol`, Claude Opus,
project-key GLM `glm-4.7`, Grok `grok-4.5`, and literal `grok-build` at exact low-effort route
requests. Both Grok process groups were sampled live simultaneously; all five generations closed
exactly, every requested kill was confirmed, no reap remained uncertain, every leader/group was
gone, and all worktree/runtime/branch/writer/capacity ownership returned to zero. Codex, GLM, and
Grok 4.5 produced fresh independently verified reviews with no P0/P1 finding. The strict matrix is
still red because Claude reports no login and literal Build reports observed model `grok-4.5`;
these external facts are not relabeled as a Phase 60 native-recovery proof.

Phase 61 now closes the first graph-backed `Representation` producer vertical. One implementation-
owned table maps structural delta to R1, SCIP snapshot to R2, and bounded CPG semantic delta to R3.
Current source cards, closed arguments, immutable tree/index/overlay environments, exact primary
artifacts, stable source-result projections, immediate reverify evidence, derived child identities,
mode-0600 receipts, result preflight, and graph batches are bounded and replay-checked. One atomic
Cairn event creates the derived `Representation`, source `Artifact`, and `DerivedFrom`, `ProducedBy`,
and `ObservedIn` lineage; equivalent concurrent requests coalesce and append loss exposes no
positive graph result. Direct, authenticated HTTPS, and MCP invoke/reverify share the same ACI and
authorization path. The retained R1–R7 packet now mechanically includes this producer for R1–R3.
The Phase 61 baseline was 1415/1415.

Baton then used the shipped producer to mint and freshly reverify an R1 representation of its own
committed retention-source delta, with every authority field false and its owned evidence root
empty after close. A five-route low-effort review admitted exact Codex `gpt-5.6-sol`, Claude Opus,
project-key GLM `glm-4.7`, Grok 4.5, and literal Grok Build. Both Grok process groups overlapped and
all five generations and ownership surfaces reaped. GLM and Grok 4.5 fresh-verified PASS reports.
The strict matrix stays honestly red at Claude login, a Codex terminal-reserve overrun, and literal
Build being provider-observed as `grok-4.5`.

Phase 62 ships the initial Goal/Plan authority vertical, introduced at `f4b8f46` and hardened
through committed checkpoint `230db8e`. Goals and bounded DAG plans are immutable append-only
versions. A distinct principal approves the exact plan digest; every node fixes its scope, budget,
capability/effect classes, exact harness/model/effort constraint, and plan-owned verification.
Locale-independent plan ordering, exact nano-USD authority, iterative bounded DAG validation,
complete closed Brief comparison, current-head enforcement, and atomic pre-effect
`plan.node_dispatched` + `task.created` batches now fail closed across direct, authenticated
HTTPS/SSE, and the four companion MCP tools. Terminal plan work durably settles exact or
lower-bound consumed, released, held, and overrun dimensions from operational evidence. The
canonical suite is 1540/1540.

The original recursive five-route proof at `45072eb` used one mandatory approved five-node plan
for exact low-effort Codex `gpt-5.6-sol`, Claude Opus, project-key GLM `glm-4.7`, Grok 4.5, and
literal Grok Build. All node bindings and atomic dispatch/task batches were exact. Both Grok
process groups were sampled live concurrently; every started generation closed exactly, requested
kills were confirmed, and all owned state returned to zero. Its strict matrix remains honestly red
at Claude login, its absent Codex report, its concurrent GLM verifier failure, and literal
`grok-build` being observed as `grok-4.5`. Focused retries independently passed exact route
observation, mechanical report verification (required shape plus pinned tests), Goal/Plan binding,
budget settlement, lifecycle, and cleanup for
Codex `gpt-5.6-sol`/low at `9ce83e9` and project-key GLM `glm-4.7`/low at `230db8e`. These focused
greens do not relabel the original five-provider matrix.

Phase 64 is now the product-integration priority exposed by recursive use. The initial Run
vertical compiles a concise intent and immutable deployment profile into Goal/Plan authority,
stops at a readable distinct-principal approval, dispatches the exact approved harness/model/effort
once, reconstructs approval-pending and approved-undispatched runs across process restart, folds a
bounded credential-filtered `RunView`, routes answers and server-fenced steering through the Run,
and exactly shuts down the deployment. Direct embedding, authenticated Web, the browser Run desk,
the authenticated one-shot `baton` Web client, and the default MCP stdio surface now use the shared registry; the stdio host invokes the same
host-only shutdown on EOF/signals. Durable `run.stop` atomically fences later Run effects, snapshots
and reaps its exact worker set, records a restart-recoverable receipt, and leaves the host and other
Runs live. Fleet-wide host authority remains separately named `application.shutdown`. The remaining
completion gate is cursor-based follow; materialized result
export; recovery; multi-node scheduling; and replacement of phase-specific recursive runners with declarative
application use.

Accepted verification now provisionally pins the exact commit before disposable branch cleanup.
`run.evidence` projects one bounded content-addressed terminal manifest, and policy-gated
`run.adopt` records an exact restart-safe result selection without merging, checking out, changing
the working tree, or publishing. It does not advance a semantically unverified Run to `completed`.
Direct, authenticated Web/browser, and MCP share those commands.
Phase 65 continues the same registry with `run.review` and `run.integrate`. Review policy pins an
exact independent harness/model/effort allowlist and a closed report contract; Baton verifies the
report from immutable Git objects, validates Unicode-scalar source anchors and active evidence
references, derives conservative semantic state, and reaps the reviewer. Integration has distinct
authority and requires fresh evidence plus configured adoption/semantic gates before calling the
existing local Coordinator transaction. Web, MCP, CLI, and the browser desk remain thin; neither
command pushes or deploys. Restart, forgery, extra-edit, stale-evidence, stop-race, dirty-checkout,
and non-fast-forward contracts are executable in `impl/test/phase65-run-semantic-review-integration.test.mjs`.
The 2026-07-14 recursive Phase 65 proof exercised the application rather than assembling kernel
features: one Mock implementer produced a confined accepted result, real project-key GLM
`glm-4.7`/low independently reviewed only the exact changed-path projection, Baton adopted that
result by a fresh evidence digest, fast-forward integrated it, and reached `completed`. The report,
route receipt, process generations, pre-shutdown handles, and clean target are preserved under
`docs/reference/evidence/phase65-semantic-review-integration-dogfood-2026-07-14/`. The reviewer
reported its model but not effort; Baton preserves that absence rather than inferring the request.
The 2026-07-13 recursive application proof used that path rather than copying a disposable
worktree: project-key GLM produced a freshly verified commit, Baton pinned and adopted it by the
displayed evidence digest, and the runner exported only the adopted commit. Codex and Claude
failed honestly; both Grok processes were simultaneously live and then independently stopped with
one confirmed kill and zero remaining targets each. All five process generations closed with no
unreaped or ambiguous process. Exact provider-observed effort and the full review matrix remain
red; result retention/adoption and Run-scoped stop/reap are live-proven.

These operational phases do not narrow the retained system. Baton's deployment-neutral
causal/temporal knowledge graph remains self-contained and inspired by repository-local
project-manager prior art. Remaining work includes authenticated user-to-orchestrator control
depth, exact provider sessions, Scratch Board/Bench, Vantage, Evidence Ladder, Skill Forge and
Playbook promotion, later Cartographer/Quartermaster and Cairn rungs, registered evaluations,
Atlas AST/CST and lexical precision, native SCIP/symbol graphs, deeper CPG/CFG/SSA/PDG and semantic
deltas, conditional compiler IR, behavioral fingerprints, true semantic merge, and conditional
expression/kernel e-graphs. Homelab integration is excluded.

The retained dependency chain is explicit: Phase 60 closes covered attach-only native recovery;
Phase 61 promotes the existing bounded R1 structural delta, R2 SCIP snapshot, and R3 CPG delta
through freshly reverified graph-backed Representation producers; and Phase 62 now ships
append-only Goal/Plan `goal_define`, `plan_propose`, `plan_approve`, `goal_plan_status`, and
plan-gated spawn authority over direct and authenticated web surfaces, with exact
`fleet_goal_plan_status` and companion MCP tools. This safety order is not a scope reduction.
Initial node-budget reservation, terminal consumed/released/held/overrun settlement, replay, and
status projection now ship. Remaining Goal/Plan work includes richer verification/evidence
predicates, authorized continuation and recovery nodes, amendments and migration,
child/refinement allocation, live budget reallocation or increase, portfolio scheduling, richer
risk and multi-principal approval policy, and distinct integration/publication/deploy/rollback
authorities. Native session depth,
remaining authenticated web/operator and MCP/runtime depth, deeper AST/CST/SCIP/CPG/IR/SSA/PDG
and R4–R7 representation precision, true semantic merge, conditional e-graphs, registered
evaluation, and production hardening all remain under their existing gates. The shared knowledge
system remains Baton's self-contained project-manager-inspired causal graph; homelab integration
is explicitly out of scope.

1. Repair P0 control integrity: immutable briefs, truthful responses, crash-safe idempotent kill,
   provenance, story identity, replay identity, and complete cleanup.
2. Ship independent harness + exact-model + effort selection and attribution. **Shipped.**
3. Make persistent sessions genuinely usable through the driver; supervised startup auto-rejoin
   is shipped in Phase 45, exact provider-process lifecycle/reap in Phase 51, and attach-only,
   no-auto-redelivery recovery ordering in Phase 60. Provider-backed recovery proof, old in-flight
   quiescence/history reconciliation, and vendor-honest fork/rewind depth remain. Phase 55
   separately ships immutable bounded toolchain projection for clean-target
   recursive sessions. Phase 56 ships universal evidence-owner temp/process cleanup plus direct,
   authenticated web, MCP, and driver drain-and-close. Phase 57 ships deterministic route-bound
   reservation, usage-seal, provider/tool-call, and post-acceptance revocation governance; strict
   native pre-effect enforcement, live provider readiness, and deeper provider recovery remain.
4. Ship OS/credential isolation and budget/watchdog governance.
5. Complete hardened acceptance and structured integration.
6. Ship the task/artifact/Scratch substrate and deployment-neutral causal knowledge core.
7. Ship Atlas + AST structural delta + repo map + Cairn scorecard, durable RouteStats/advice,
   causal integrity/audit/trace, audit-gated bounded recall, audit-gated selective promotion, and
   fact-bound Scratch oracle correction as the first capability verticals. **Shipped locally
   through Cairn Scratch correction/oracle release; Phase 51 also closes exact process lifecycle
   and reap. The implementation is canonical-green and its recursive exact-route matrix is retained
   as separate operational evidence.**
8. Expand the representation and capability ladders in measured increments. **Phase 54 lexical
   binding identity and Phase 61 fixed graph-backed R1–R3 production are shipped; every deeper
   representation precision increment and R4–R7 gate remains.**
9. Add MCP plus authenticated HTTPS/WebSocket user↔orchestrator control, operator surfaces,
   production runtime, and the registered evaluations. **Authenticated HTTPS user-to-orchestrator
   commands, resumable SSE observation, MCP stdio fleet tools, and direct/web/MCP drain control are
   shipped. Phase 62 also ships initial Goal/Plan commands, observation, and plan-gated spawn over
   direct/web/MCP authority. WebSocket parity, richer Goal/Plan verification/evidence, authorized
   continuation/recovery, amendments, publication/operator depth, the production runtime, and
   registered evaluations remain.**

10. Finish the integrated Run application before treating further leaf capability expansion as a
    usable product: one command registry and `RunView` across direct/CLI/Web/MCP, durable scheduling
    and attention, honest semantic state, run-scoped evidence/close, then recursive multi-harness
    dogfood through that surface. **Direct, authenticated Web/browser, and default MCP now share
    exact-route start/approval/restart/answer/steer/stop/RunView behavior. Run stop is durable and
    scoped; the MCP host separately closes through exact deployment shutdown. The one-shot
    authenticated `baton` client now uses the Web command bus and owns no fleet authority;
    `baton serve` separately owns Web admission plus exact host shutdown. Cursor follow,
    materialized export, recovery, and semantic depth remain red.**

## 2026-07-17 continuation ledger

This ledger is the current execution tracker layered over the retained catalog above:

- **Phase 69 — green/shipped:** application-owned verifier retry cascade and regression evidence.
- **Phase 70 — local green, live safety proof obtained:** exact stop checkpoints unaccepted work
  before reap; `resume_work` restores a pinned checkpoint without caller coordinates; repeated
  same-node resumes form one linear lineage. Focused and affected validation is 207/207 green. A
  live resource stop preserved a reviewer's dirty tree under an immutable checkpoint and reaped its
  process/worktree.
- **Provider-result honesty — failure gate locally green; required-effect authority red:** the GLM
  5.2/xhigh wire correctly reported a structured failed result after a 429, but Baton ignored that
  status and accepted an unchanged passing base. Only exact completed results now reach the trust
  gate; failed work instead becomes a durable provider failure, optional Phase 70 checkpoint, and
  confirmed kill/reap with no accepted/adoptable/exportable artifact. Phase 73 separately adds an
  explicit Plan `requiredEffects` contract; existing authorized `effects` is not misused for that
  meaning. GLM is rate-limited until 2026-07-18 09:32:19 and is not retried before then.
- **Phase 71 — deterministic implementation/KK8 expansion in progress:** isolated Kimi K3 routing through the existing Claude
  Code harness, exact `kimi-k3[1m]`, provider-required `max` effort, private owner-only API key,
  per-dispatch environment, and no global Claude mutation. The Kimi API key is not requested until
  the credential-free KK8 gate passes.
- **Phase 72 — deterministic worker implementation green; live dogfood active:** native Kimi Code 0.27.0 ACP worker support plus a
  separately authenticated Kimi orchestrator client over Baton's MCP/application semantics. The
  installed subscription login permits later live proof without a new API key, but only after
  private projection and global-state immutability tests pass. Native Kimi now selects and observes
  K3 plus ACP `yolo` before prompt, while exact effort remains configured privately and reported as
  unobservable where ACP exposes only thinking on/off. Pending provider approvals/questions are
  advertised as ordinary collision-safe Run actions rather than forcing raw request choreography.
  Live dogfood also exposed provider-granularity event amplification; native Kimi now promptly emits
  the first content chunk while coalescing repeated thought/message and tool-progress deltas without
  losing file edits or requested/progress/terminal milestones. Native worker live proof is green:
  K3/max produced an exact required edit, passed the 249-test candidate/base gate, was adopted and
  exported, and then emitted process-close before kill-confirmed with empty worker/runtime roots.
  The Kimi-orchestrator Web/MCP bridge is deterministic-green and exposes only the five compact Run
  tools; its transport cannot shut down the resident Baton application. Packaged live orchestrator
  proof and direct pre/post global-Kimi source digests remain the Phase 72 closure items.
- **Parallel host ownership — red/AX:** separate Baton application hosts cannot reconcile one shared
  target `.baton/wt` namespace concurrently. Current parallel dogfood uses one exact snapshot clone
  per host; future deployment assembly needs explicit namespace/lease authority rather than racing
  startup cleanup.
- **Phase 74 — deterministic application connection green:** `baton setup`, progressive `doctor`,
  connection help, and authenticated repository selection now form one owner-only Git-common-dir
  connection path. Setup never asks an agent to manage token budgets, export byte ceilings, or
  provider credentials on argv; ambiguous profiles remain explicit user input. The authenticated
  Web-to-MCP bridge derives user, session, capabilities, repository scope, and expiry from the
  remote session and re-attests them before every command and replay.
- **Phase 75 — deterministic task topology green:** one closed deployment policy now bounds task
  depth, total and per-relation fanout, and tasks per Run. Root, follow-up, review, oracle, recovery,
  and preserved-resume lineage is prospectively refused before capacity/worktree/provider effects,
  independently revalidated by the store, and deterministically reconstructed on replay. The
  strict test fixture also proves public drain/reap rather than leaving asynchronous workers behind.
- **Phase 76 — deterministic recovery-attempt authority green:** store, Coordinator, application,
  and startup recovery now share two-phase `recovery.attempt_admitted` /
  `recovery.attempt_completed` CAS authority. Admission binds the exact prior task and hub-verified
  owner, Run, route/card/model policy, worker policy, Plan/profile/recovery policy, immutable
  deployment `maxAttempts`, session generation, and deterministic recovery-task identity before any
  provider, operational-log, runtime, or adapter effect. The application supplies policy but never
  an attempt coordinate. Replay reconstructs exact heads and receipts; startup eligibility passes
  this attempt-state gate only after `not_started` or `closed`, while `pending`, `attached`, and
  `unknown` fence automatic redelivery. Focused Phase 76 store and integration contracts are green;
  this entry does not claim a new full-suite result or recursive Run authority.
- **Phase 77 — deterministic durable recursive authority green:** an opt-in closed policy now binds
  fixed-capability application leases to the exact repository, authenticated principal/session,
  live parent Run/task version, and current worker. Child lineage is derived and durably admitted
  before its first Goal/Plan effect under independent depth, direct-child, and root-descendant
  ceilings. The only recursive capabilities are `run.start`, `run.status`, and `run.stop`; Web and
  MCP derive the same private authority from authenticated server state without adding lease or
  ancestry fields to public schemas, and replay re-attests it. Recursive stop snapshots one
  immutable `throughSeq`-bound descendant Run/task/worker union, fences prospective descendants,
  leaves unrelated sibling subtrees open, and completes only with `remainingCount === 0` plus
  `processesObserved === processesClosed`. Focused store, Coordinator/application, authenticated
  Web, and MCP matrices are green under
  `spec/phase77-durable-recursive-run-authority.md`. This is application authorization and
  lifecycle ownership, not OS sandboxing or same-UID credential secrecy. Adversarial closure also
  binds repository identity to deployment authority, prevents an inactive historical recipient
  lease from degrading into ordinary authority, preserves exact recursive refusal through Web/MCP,
  reauthorizes inspect/follow after waits and before return, sanitizes recursive proof fields from
  SSE, and adds one progressive `orchestration` chapter to the Run outline/index/section cascade.
  It shows role/depth, direct-child and descendant counts, effective recipient authority, and
  subtree-stop target counts without exposing repository paths, task/worker/session coordinates,
  or lease/request/authority digests. Unconfigured deployments retain an empty chapter and no
  recursive outline claim.
- **Recursive dogfood AX — active findings:** the objective-first Baton/Kimi route exposed two
  integration frictions before and during real provider work. A clean target missing its declared
  dependency projection collapsed to the generic `worktree_unavailable` terminal instead of a
  setup/doctor action, and public harness attestation initially compared the private adapter key
  (`kimi-code:dogfood`) against the public requested harness (`kimi-code`). The attestation mapping
  is now fixed and deterministically tested. Setup must next preflight declared dependency
  projections and return a self-describing remediation without exposing internal paths by default.
- **Recursive Baton-on-Baton dogfood — authority green, application assembly still active:** native
  Kimi Code K3/max reached the objective-first surface and produced a useful checkpoint before the
  configured wall boundary. The run exposed an ACP-close race that mislabeled Baton's timeout kill
  as a protocol failure; the timeout now wins the race, emits one typed terminal failure before
  exact process-close/kill confirmation, releases session ownership, and is regression-covered.
  The checkpoint's deployment-factory extraction is a useful AX direction, but its route table,
  profile, and one-adapter assembly are stale relative to current Kimi, full-access worker policy,
  provider attestation, recursive authority, and multi-harness routing. Adapt the concept; do not
  cherry-pick the checkpoint. Multi-harness recursive application proof remains pending. Same-UID
  full-access workers still cannot provide adversarial credential secrecy without a distinct
  UID/container/VM or external broker.
- **Harness matrix — live lifecycle progress, provider gates red where measured:** two exact
  Grok 4.5/high Runs were admitted concurrently through the concise bound-Run group; one was
  selectively stopped while the sibling continued, and deployment close/reopen proved zero local
  ownership and no stale stop action. The sibling then failed honestly at
  `authentication_required`: bounded local Grok expiry metadata was stale, so current doctor now
  blocks all Grok efforts before spawn with `grok login` remediation. A literal Grok Build request
  is still provider-observed as `grok-4.5` and therefore rejected as an exact-model mismatch.
  Claude, native Kimi, Kimi-through-Claude, Codex, GLM, and Grok provider-success receipts remain
  separate gates; lifecycle success is not relabeled as provider-work success.
- **Phase 78 — integrated deployment surface active, not a capability-plane completion claim:**
  `openBaton({repo})`, bound Runs, exact route triples, hidden deployment policy, repository
  snapshotting, parallel Run groups, and joined close/reap are the concise application direction.
  Deployment-owned dependency/verification readiness, fixed internal host-capacity admission,
  crash-safe export-owner recovery, profile replay, contextual doctor/help, expired Kimi/Grok auth
  refusal, and current-incarnation-only ownership projection are deterministic-green. Real Codex
  `gpt-5.6-sol`/medium dogfood survived an intentional >1 MiB telemetry event, freshly verified and
  adopted its scoped result, exactly closed, and reopened with cleanup complete and no owned
  resources. Remaining closure requires broader recursive multi-harness live proof through the
  same surface. That proof continues to exercise multiple harnesses in parallel, select exact
  harness/model/effort per task, interrupt or kill a chosen worker, and leave zero process,
  worktree, runtime, lease, and export ownership. It includes Codex `gpt-5.6-sol` with
  task-appropriate effort, native Kimi `kimi-code/k3` at `max`, isolated Kimi-through-Claude K3 at
  `max` when configured, Grok 4.5 (with literal Grok Build remaining red until provider-observed),
  and GLM only as `glm-5.2` at orchestrator-selected effort after provider readiness. Ordinary
  callers do not supply budgets, file-size ceilings, temporary roots, or capacity knobs. Native
  Kimi and Grok are currently auth-red until their ordinary harness logins are refreshed;
  Kimi-through-Claude now has `baton credentials install kimi` but no key has been requested. The
  concise profile now prepares an adopted result and pauses at an explicit destructive `apply()`
  boundary; clean repositories default to `ff-only`, dirty/diverged repositories refuse without
  overwrite, and ambiguous post-fast-forward failure poisons authority rather than being recorded
  as a harmless refusal. Export cannot auto-skip that boundary. Two real Codex workers were then
  dispatched concurrently through `startMany` at exact high and medium effort for Atlas and shared
  knowledge/AX audits. Both passed fresh verification, were adopted and pinned, and close returned
  zero workers. The run also exposed the absence of a compact live group progress method: one
  sibling was verified while the other remained actively editing, but ordinary group output could
  not summarize that without inspecting durable ledgers.
- **Phase 79 — bounded parallel Workflow composition green; strategy expansion active:**
  `spec/phase79-dynamic-workflow-composition.md` adds the missing durable application layer above
  Goal/Plan, task topology, Run lineage, and exact lifecycle ownership. One Workflow owns logical
  WorkItems, parallel attributable Attempts, Waves, immutable Candidates, typed feedback,
  review/revision successor Plan versions, synthesis, deterministic gates, selective stop/reap,
  and replay/recovery. The shipped vertical atomically dispatches one parallel Wave for a shared
  WorkItem, retains role-attributed Candidates, records typed feedback, selects by role, exposes
  compact group state, and supports selective or whole-Workflow stop/reap. Batch requests are fully
  preflighted before effects; partial admission and stop join every affected Run and report exact
  cleanup-incomplete identities. Parallel workers share immutable bases, addressed context, Atlas/artifacts,
  Scratch, and causal knowledge but keep private writable overlays. A shared writable lineage is
  explicitly one fenced writer generation at a time; hub-composed overlays serialize selected
  private deltas. Direct concurrent multi-writer checkout access is refused under Baton's current
  full-permission same-UID posture. Later slices compile review/debate/synthesis/partition strategies,
  deeper workspace composition, and causal projection from the same primitive. This is one multi-node Run
  application, not a second Airflow-like engine or hidden worker chat system.
- **Phase 80 — bounded recursive Candidate revision vertical green; multi-round hardening active:**
  `spec/phase80-recursive-candidate-revision.md` turns typed feedback into executable work only by
  appending a successor Plan version under the same Goal, requiring distinct approval, and
  launching a fresh isolated Attempt from the exact still-resolving retained Candidate SHA. A
  closed content-addressed revision envelope, truthful `revision` topology relation, dedicated
  atomic Candidate-base admission, bounded Plan-history projection, evidence, CLI verbs, replay,
  and one correction round are implemented and tested. A live two-Candidate Codex Workflow then
  attached exact feedback, selected one Candidate, proposed and approved Plan v2, freshly verified
  a distinct exact-base revision Candidate, selected it, and closed with zero workers/worktrees.
  Deployment-owned multi-round policy, cumulative Goal headroom, Plan v3 replay, repeated-feedback,
  identical-Candidate/no-progress and contradiction stopping, lost-approval replay, and typed
  ambiguous-worker recovery are now deterministic-green. The failed attempts also repaired
  too-small internal default execution envelopes, oversized
  historical snapshot projection, durable absence proof for old process groups without signaling
  reused PIDs, and stale historical-worktree cleanup. Remaining Phase 80 work is the adverse
  revision restart/stop effect-boundary matrix and explicit Web/browser/MCP multi-round parity.
  Review, resume, recovery, generic spawn, and shared
  multiwriter shortcuts remain explicitly forbidden.
- **Phase 81 — common Context Program and RLM-style externalized-context strategy active:**
  `spec/phase81-context-program-rlm.md` separates the stateless Bench substrate, Pythonic
  ContextSession AX, and `context_recursive` Workflow strategy. The public experience is concise,
  while the durable language is a closed canonical AST rather than arbitrary Python, shell, host
  `exec`, or a model-controlled provider callback. Exact harness/model/effort remains an outer
  orchestrator role-map decision; ordinary agents and users do not manage recursion, call-count,
  budget, concurrency, export, file, storage, or provider-turn limits. The first local vertical is
  green for immutable tree-bound manifests, closed AST validation, deterministic pure
  search/chunk/coverage cells, content-addressed artifacts, durable session/cell/settlement events,
  restart identity, historical-policy reads, Context-aware Run-stop receipts, exact source
  provenance, owned process-group kill/reap, credential-minimal Git execution, shutdown admission
  fencing, non-poisoning lifecycle abort, and contextual help. Narrow write scope is now distinct
  from deployment-authorized immutable Context read scope. It deliberately does not claim dynamic
  model-backed map/reduce, ContextManifest/Atlas/Scratch partition-to-successor-Plan/Wave
  compilation, child-call synthesis/review/termination, or RLM utility evaluation yet. Those are
  the next gated slices; depth greater than one and persistent shared kernels remain closed.
- **Phase 81 live dogfood — useful friction, not a polished success claim:** the first ordinary
  `openBaton()` attempt collided with stale default coordination state before provider launch,
  showing that default deployment-state compatibility/isolation still needs product handling. An
  internally owned ephemeral deployment then correctly blocked an expired Kimi subscription;
  ordinary Kimi device login refreshed it. The subsequent Wave admitted exact Codex
  `gpt-5.6-sol`/low and native Kimi `kimi-code/k3`/high routes in parallel private worktrees. Codex
  produced and freshly verified a Candidate while Kimi stalled inside a harness-internal recursive
  analysis. A terminal interrupt durably admitted the Run stop and exact kill requests but exited
  before the foreground runner could present confirmation. Reopening the same ledger joined that
  stop, truthfully failed the interrupted Kimi task, observed both provider processes closed,
  removed both worktrees, completed with `remainingCount: 0`, and closed with zero workers. The run
  exposed weak concise in-flight progress, incomplete visibility into harness-internal descendants,
  and the need to keep idempotent signal handlers installed until awaited cleanup finishes. It is a
  recovery/reap proof, not a successful Kimi Candidate. A tightened rerun then kept Kimi inside one
  direct-tool provider generation: exact Codex low and Kimi high both produced freshly verified
  Candidates; typed feedback selected the exact Kimi Candidate; Baton appended and distinctly
  approved Plan v2; the revision launched from the exact retained Kimi SHA and freshly verified a
  revised Candidate. Final Workflow stop and deployment close returned zero workers, and caller
  status/index were unchanged. The live run therefore proves the Kimi parallel and successor-Plan
  path while retaining the progress/auth-lifetime friction honestly.
- **Phase 83 — durable owned Context application vertical:** Context sessions and pure cells now
  have append-only admission/settlement authority, exact restart and historical-policy replay,
  v2 Git/tree/blob/range source receipts, private attester capability, Context-aware Run-stop
  receipts, an open/closing/closed deployment gate, and owned minimal-environment process groups
  whose result cannot settle before whole-group reap. Lifecycle abort leaves the logical cell
  recoverable. Deployment-authorized `contextScope` is distinct from narrow write `pathScope`, a
  split derived from live Baton dogfood rather than exposed as another routine caller knob. The
  remaining Context successor is real provider-backed AST `map/reduce/review/verify` compilation
  through separately approved Plans/Waves, durable child synthesis/termination, richer Atlas and
  shared-knowledge branches, transport evaluation, and a four-arm RLM utility gate.
- **Phase 83 live dogfood — exact stop/reap success, Candidate failure kept honest:** two parallel
  exact Codex `gpt-5.6-sol` routes at high/xhigh effort and a concurrent pure Context cell were
  admitted. The report-only edit scope initially yielded zero repository Context items, which led
  directly to the `contextScope` correction. Both provider workers then over-inspected for roughly
  ten minutes without writing their single scoped report, exposing the lack of a concise
  finish-now/synthesis policy. The operator interrupted; Baton returned a durable stop receipt,
  zero workers, zero worktrees/processes, zero ownership on close, and unchanged caller
  status/index. No Candidate success is claimed. Current native Kimi and Grok subscription caches
  were expired and correctly refused before spawn; earlier Kimi/Grok receipts remain historical.
- **Phase 84 — first provider-backed Context successor is implementation-green:** one addressed
  `context.map(...)` call now binds a completed pure cell to a content-addressed partition set,
  durable call admission, ordinary successor Plan, distinct approval, and one atomic parallel Wave.
  Raw selected partition bytes materialize only into the physical provider Brief. Terminal
  settlement refuses failed/cancelled children, records the exact provider-effect count, and cannot
  succeed until every mapped task has a policy-authored operational cleanup attestation, mapped
  coordination evidence, and dedicated `task.resources_released` event proving process, session,
  worktree, runtime, interaction, and local-authority closure. Restart after physical cleanup but
  before settlement converges without a second provider effect; Run stop v3 includes Context calls.
  The Pythonic cell/call surface now includes output/evidence/help and singleton-role inference,
  while empty/singleton map input returns typed guidance instead of a fake Wave. Dedicated Phase 84
  tests are 17/17, focused recursive/lifecycle coverage is 150/150, transport coverage is 82/82,
  and the current complete implementation suite is green at 2,081/2,081.
- **Phase 85 — addressed lineage and recursive synthesis underway:**
  `spec/phase85-context-lineage-recursive-synthesis.md` preserves exact per-output source lineage,
  a root Workflow role catalog across synthetic successor Attempts, one generic durable
  `map | reduce` call envelope, terminal failed-call cleanup, selective retry generations, and an
  immutable expression builder compiling through one `context_eval` action. The intended bounded
  workflow is pure selection -> parallel map -> separately approved reduce -> optional selective
  retry. The first implementation slice now emits and validates immutable cell-evidence v2 across
  every pure operator, dual-reads historical v1 evidence, refuses aggregate-only v1 provider
  admission, binds map partitions/physical Briefs to exact per-output coordinates, and releases
  completed, failed, and cancelled terminal task resources. Failed map generations now also settle
  durably only after release with the complete ordered accepted/failed/cancelled set, evidence-only
  private CAS, typed termination, `outputRef: null`, exact idempotency, restart convergence, and
  terminal preservation through Run stop. The retained-commit provider-result capsule core now
  projects only canonical protected result refs descending from the runtime base, requires the full
  changed-path set to be in scope and supported, rejects sensitive/partial projections, writes raw
  content only to private Context source CAS, and binds the complete source ref plus child, route,
  artifact, cleanup, scope, and extractor-policy identities. Accepted capsules now attach atomically
  as an ordered sibling set without changing or cycling terminal child digests. The application
  rederives inputs from the exact historical successor Plan; coordination rereads and reprojects
  capsule/source CAS against child, route, commit/ref, cleanup, and path-scope authority both at
  settlement and replay. Completed output exposes only safe refs; failed aggregates retain refs only
  for accepted children with null output and the full attempted provider-effect count. The focused
  Phase 84/85 attachment matrix is green at 31/31. Workflow definition v3 now also separates
  durable semantic roles from physical Attempts through one closed, digest-bound root catalog with
  exact node templates and independent harness/model/effort routes. Map and revision successors
  retain unused roles, instantiate exact templates, bind synthetic Attempt identity to canonical
  partition indexes, and preserve a complete non-cyclic root/parent/generation chain. Historical
  v1/v2 definitions replay under their recorded schema; new successors upgrade once to v3 without
  inferring roles from synthetic names, and unbound derived v1 revisions are durably anchored before
  v3 succession. Mixed v2→v3 map admission survives close/reopen with its exact route tuple. The
  focused role/revision/map authority matrix is green at 26/26. A pure CLR3 generation-1
  `map | reduce` request/call/unit identity core now also derives requester authorization and exact
  selected-output lineage, with a one-way map-v2 compatibility projection and no competing ledger
  identity. Successful map settlements now add closed call-evidence v3 with one exact source-output
  parent and one Plan/node/task/terminal/route/artifact/capsule/source/cleanup/child derivation per
  ordered safe result ref. Coordination rebuilds the complete lineage on live append, event replay,
  and artifact reads; the settlement event does not duplicate it. Historical successful v2 remains
  replay-readable but cannot become a reduce source by inference, failed v2 remains lineage-free,
  and only a fully reverified v3 settlement derives the distinct call-evidence source contract.
  Cleanup-gap recovery and a second restart preserve that source without another provider effect.
  Generic effect-call admission now shares the same `context.call_admitted` event and `_contextCalls`
  projection: historical map payload schema v1 remains stable, while schema v2 durably prebinds one
  closed generic map or reduce call to an exact successor Plan. Live admission revalidates service
  plus requester identity, current Plan/definition/catalog/template/route authority, completed-cell
  evidence v2 or completed-call evidence v3, and every exact unit; idempotency, restart, tamper
  replay, application map-reconciliation exclusion, and Run-stop targeting are covered without a
  provider effect. Parallel dispatch dogfood then exposed a restart AX defect: live worker journals
  contained real turns, token deltas, tools, tests, and edits while reopened Workflow status showed
  zero turns/usage/paths and no terminal cause. Driver startup now rebuilds Story from durable logs,
  batched adapter edit paths normalize to repository-relative paths, recovery/process-close events
  terminalize activity, and Plan terminal outcomes supply typed provider causes when no live result
  survives. The exact stopped Codex/GLM Run now reopens showing Codex's 3,326,408 tokens, both exited
  states, both `recovery_terminalized` causes, and zero workers on close. Generic reduce dispatch
  now also ships through the existing application surface: `context_reduce {callId, instruction,
  role?}` rederives only a fully verified successful call-evidence-v3 source, binds the requester and
  current Workflow v3 catalog/template/route, admits and proposes the exact successor Plan without
  provider work, recovers a missing proposal on restart, and crosses the provider edge only after
  separate approval. The selected provider Brief reopens each result ref, capsule, retained-result
  projection, and private source; durable coordination stays reference-only. Reopen proves no
  duplicate dispatch and Run stop reaps the generic worker. The full suite is green at 2,110/2,110.
  Baton itself produced two reviewed exact
  Codex high/xhigh Candidates and then kill-confirmed/closed both observed process groups with zero
  remaining workers; a native Kimi K3 max-effort attempt was truthfully preflight-refused because
  its cached authentication had expired and closed with zero workers. A later exact Codex high/xhigh
  admission run was interrupted before either Attempt produced a Candidate; Baton reopened the exact
  deployment, recovery-terminalized both honestly, observed/closed both process records, and proved
  zero remaining workers. A fresh exact Codex high/xhigh Baton review then retained two accepted
  Candidates, independently passed the focused 16/16 gate, found no concrete defect, and stopped
  with both observed processes closed and zero workers. An exact Kimi Code K3 high route was
  truthfully refused before Run creation because its cached authentication had expired; no harness
  substitution occurred and close returned zero workers. Generic successful/failed settlement still
  must be generalized without duplicating map-specific authority. The accepted-artifact variant,
  projection-failure terminalization, workerless
  non-admission, generic reduce/retry/eval semantics, and live recursive proof remain.
  Generic dispatch dogfood also showed that `complete()` still needs integrated live member progress,
  concurrent member stop/timeout, and explicit zero-Candidate terminal-cause presentation. GLM-5.2
  xhigh repeatedly resolved through the Claude-Code/Z.ai adapter but remained initialization-stalled;
  Codex could complete focused tests yet lose its final provider response. These are retained harness/
  control-plane gaps, not successful design Candidates.
  Goal/Plan authority also still represents harness/model/effort as independently admitted sets;
  exact authorized tuple anti-recombination is tracked in
  [GitHub #2](https://github.com/user/baton/issues/2#issuecomment-5012736166).
  Executable review/verify, custom syntax, persistent kernels, and deeper recursion remain
  closed until their independence/gate authorities exist; they are not silently claimed or erased.
- **Phase 92 — Episode/workstream facade and resident trust/liveness closure green:**
  `spec/phase92-episode-workstream-facade.md` projects one progressive Episode/workstream surface
  through direct API, selector-free CLI, authenticated Web, MCP, and browser. Aggregate and exact
  role/generation Episodes retain separate result, artifact, route, verification, and cleanup
  truth; pending result is explicit; help and continuation are closed. Temporal Run/Plan/Attempt/
  Context evidence joins Atlas and Cairn through immutable evidence-bearing edges. Replay uses
  append-aware one-parse-per-byte worker indexes and parsed-event checkpoints that still execute
  every current replay validator; a checkpoint cannot bless ledger drift or block writer-lease
  release. Ordinary reads do not amplify the ledger, while readiness/status security audits remain
  durable. Stale resident replacement is deployment/PID-start exact, serve construction is unified,
  false verifier verdicts cannot accept, read-only reviews can settle without edits, and route
  readiness explains blocked Kimi/Grok/Claude/Kimi-through-Claude states. Built-in GLM exposes only
  `glm-5.2` with exact selectable `low`, `medium`, `high`, `xhigh`, and `max`; `xhigh` remains an
  explicit dogfood choice and provider-omitted Codex model observation remains null. The complete
  deterministic implementation suite is green at 2,302/2,302. Fixtures are not live-provider or
  real-PID proof.
- **Retained next systems:** the evidence-backed Episode/workstream/closed-Program-IR assessment in
  `docs/29-slate-architecture-assessment.md` complements rather than replaces Context, Atlas,
  Cairn, stop/reap, and Web authority. Adapter identity/capability metadata, authenticated bidirectional Kimi
  control, AST/CST/SCIP/CPG and semantic-delta precision, shared causal knowledge graph, Web control
  depth, Vantage/Evidence/Scratch/Skill Forge, evaluations, and the rest of this catalog remain
  tracked. Phase 93 next preserves this sequence: closed Program IR; event-driven recursive/
  parallel composition; immutable base plus private overlays; one fenced integrator; live
  multi-harness gates. No homelab integration is included.

No later step is permission to erase it from the goal.
