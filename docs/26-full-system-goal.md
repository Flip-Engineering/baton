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

- Eight public commands: spawn, send, wait, respond, interrupt, result, list, kill.
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

The current recursive-dogfood route is `CodexAppServerCli` + exact `gpt-5.6-sol` + `low` effort for
efficient implementation work. `gpt-5.6` is not an alias and was correctly rejected by the live
ChatGPT transport; Baton may not silently substitute it or any older default. Once isolated Grok
authentication is available, Grok 4.5 through Grok Build is the intended cross-family,
Opus-class review/implementation stand-in. These are operator policy inputs backed by live cards,
not timeless model folklore. GitHub issue
[#2](https://github.com/wahargis/baton/issues/2) records the completed deterministic and recursive
route-tuple implementation gate. The isolated concurrent Grok rerun is now also complete: Baton
requested and provider-observed exact `grok-4.5` and `grok-composer-2.5-fast` routes, resumed one
session, killed it while working, and fully reaped both workers.

Concurrent-provider acceptance includes starting multiple Grok workers at once, observing the
configured concurrency/card limits, interrupting and killing selected workers, and proving native
process, worktree, runtime scope, branch, and coordinator-state reap. Missing provider credentials
remain a typed live-evidence blocker; they are never grounds to project ambient secrets or weaken
runtime isolation.

### C. Southbound harness depth

- Claude: native session steering/interrupt, approvals/questions, hooks, context/usage
  introspection, compaction events, constraint reinjection, model/permission reconfiguration,
  resume/fork/rewind, config-home isolation, and live capability discovery.
- Codex: app-server sessions, steer/interrupt, approvals/questions, thread inject/resume/fork,
  goal pinning, structured outputs, review, compaction, usage/rate limits, broker/daemon topology,
  model/service/reasoning selection, sandbox policy, and schema-driven feature detection.
- Grok: ACP core plus model selection/state, session load/fork/rewind, auth, extensions, usage,
  multi-client attach, home/MCP isolation, and explicit handling of unsupported ask-user behavior.
- GLM: Claude-harness session parity, exact model mapping, non-refuser capability metadata,
  concurrency/quota inputs, scoped credentials, and live proof when credentials are available.
- Honest one-shot tier and future ACP adapters remain separately carded; no reduced tier may pose
  as the session product.

### D. Safety and governance

- Real OS sandbox profiles, worktree confinement, network policy, scoped environment/credentials,
  isolated harness homes, and approval-gated outside-world side effects.
- Dry-run/approve-all/sample/autonomous trust ramp with emergency stop always available.
- Wall, token, USD, rate-limit, account-seat, and quota-window budgets folded into authoritative
  state with thresholds, hard stops, and degradation policies.
- Deterministic watchdog actions for mechanical stall/loop/scope/churn cases; semantic failure
  classifiers remain explicitly untrusted model judgments.
- Correct provenance: hub facts, worker prose, external evidence, and derived claims never share a
  trust label. Read edges support contamination/contradiction analysis.

### E. Trust, review, and integration

- Immutable validated delegation contract and exact definition of done.
- Fresh-result verification plus base red→green, coverage-of-change, mutation strength,
  impact-selected tests, property/fuzz/BMC/SMT/proof rungs, and reproducible counterexamples.
- Independent oracle construction and cross-vendor semantic-diff review for risk-selected work.
- Structured postmortems and failure attribution linked to source events.
- Verified branch integration, textual then structured/semantic merge, conflict handling, effect
  tripwire, review artifact, and explicit approval before push/deploy/other irreversible actions.

### F. Routing, evaluation, and learning

- Routing buckets keyed by harness, exact model, model family, task class, capability, policy, and
  version; only verified outcomes learn; idempotent replay preserves them.
- New-model exploration, decay, refusal feedback/reroute, operator pin/exclude/prefer controls,
  quota awareness, and outcome/calibration telemetry.
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

### J. Context, operator, northbound, and runtime

- Vendor-shaped briefs, addressed context, orientation references, constraint/DoD reinjection on
  compaction, context usage governance, and retractable views.
- MCP northbound fleet tools and tasks, a long-lived daemon, resumable waits/subscriptions, and an
  operator text/TUI seat with narrative, provenance, takeover, approvals, budgets, and emergency
  control.
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

Current shipped checkpoints as of 2026-07-11: CK1–CK9 supplies the deployment-neutral task,
artifact, Scratch, and typed causal knowledge authority; Atlas supplies AST structural delta,
proposal-only structural pattern search/rewrite, shared base/worktree index, lexical orientation,
symbol/reference/call graph, SCIP JSON, and a first single-file CPG seed with containment,
control, lexical reaching-def, and honest local-call edges; and
Phase 12 WN6 supplies the authenticated resumable SSE user-to-orchestrator observation channel;
and Phase 14 supplies the first-class `{harness, exactModel, effort}` route tuple across cards,
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
rerun also exposed and closed linked-Git-worktree exclusion-path handling. Earlier dogfood exposed
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
restart-safe replay. Its 14 focused tests and the current 692/692 full suite are green, including
fatal UTF-8/output handling, lifecycle readiness, closed nested schemas, and deployment-derived
frame limits. A recursive exact-route review reached native `gpt-5.6-sol` and then hit the provider
usage limit; all owned resources were reaped but no independent verdict is claimed. Streamable
HTTP authorization, MCP Tasks, progress heartbeats, and daemon supervision remain explicit next
depth rather than being inferred from stdio. Real-browser interaction and provider-backed review remain pending; neither is inferred
from the deterministic suite. A real TLS socket proof now passes OIDC redirect/PKCE/callback,
operator/session, command, SSE snapshot, logout/revocation, listener shutdown, and owned-state
cleanup. The in-app browser interaction remains pending because its required execution bridge was
not exposed; the wire proof is not relabeled as a browser pass.

The active next increment is the real-browser OIDC/control/stream/logout proof when its bridge is
available, plus optional WebSocket parity, Streamable HTTP MCP/tasks/daemon depth, and deeper operator surfaces. It is followed by
the next measured Atlas representation rungs. Proposal-only structural rewrite now ships with a
9/9 focused gate, 701/701 full suite, and a Baton-on-Baton immutable proposal proof. Direct apply
and live-LSP depth remain, while CPG/dataflow, IR, behavioral fingerprints, semantic diff/merge,
and e-graphs stay in the catalog. The CPG seed, delta/impact, and operator-specified taint
continuation now ship. Phase 22 adds correct braced-if/else CFG, deployment-bounded CFG
may-reaching definitions, direct identifier-copy flow, immediate-only nested value edges, and
literal-dead-branch pruning, including reachable `else if` chains and conservative may-unions
inside atomic unsupported control. AST boolean leaves prune comment-bearing dead arms without
orphan join edges. The combined R3 gate is 31/31 focused and the current canonical suite is
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
an exact credentialed `glm-4.7`/low recursive run both verify no replay double-count and complete
kill/reap. Phase 45 supervised auto-rejoin, Phase 46 representation attestation, later causal
audit/recall and contradiction hardening, and every higher AST/SCIP/CPG/IR/behavior/merge/e-graph
contract remain in the goal. No homelab or external project-manager runtime is introduced.

Phase 45 ships deployment-opt-in supervised startup auto-rejoin without weakening PS7's manual
trust gate. A bounded startup scan installs a synchronous readiness barrier, retains only replayed
native-resumable sessions' exact worktree and private runtime ownership, and attempts them
sequentially. Fresh context validation and exact native identity/model/effort precede the recovery
refinement becoming working. Per-session mismatch/refusal/timeout remains an explicit orphan and a
sanitized degraded summary; authoritative-write loss fails readiness. Provider supervisors remain
stopped until readiness settles. Async close awaits the scan and kills every auto-attached session
before releasing worktree, runtime, branch, Coordinator, and writer ownership. The fixture proves
verified turn → simulated process loss → exact rejoin → verified refinement → full reap. This does
not claim in-flight turn continuation, checkpoint/rewind parity, or provider-backed native resume.

Phase 46 prevents the representation program from shrinking through documentation drift. The
`representation.review` ACI operation fixes R1 AST/CST structural work, R2 symbol/SCIP, R3 bounded
CPG/CFG/path/taint/delta, the R4 compiler-IR ceiling Decision, R5 behavioral fingerprints, R6
structured merge, and the R7 e-graph Decision into one ordered packet. It reads 20 fixed source and
contract files from an exact current Git commit, independently bounds files/bytes/rows/artifact/
context, writes a content-addressed artifact, and reverifies the entire deterministic claim.
Authenticated ACI reach grants no edit, verification, merge, approval, publication, routing,
proof, or policy-authoring authority. The packet mechanically retains live LSP, SSA/PDG/path
solving, alias/heap/implicit flow, exceptions/interprocedural returns, external IR/translation
validation, true semantic merge, and conditional expression/kernel e-graphs as unbuilt work.

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

1. Repair P0 control integrity: immutable briefs, truthful responses, crash-safe idempotent kill,
   provenance, story identity, replay identity, and complete cleanup.
2. Ship independent harness + exact-model + effort selection and attribution. **Shipped.**
3. Make persistent sessions genuinely usable through the driver; supervised startup auto-rejoin
   is shipped in Phase 45 and exact provider-process lifecycle/reap in Phase 51, while broader
   provider-backed recovery proof, in-flight continuation, and vendor-honest fork/rewind depth
   remain.
4. Ship OS/credential isolation and budget/watchdog governance.
5. Complete hardened acceptance and structured integration.
6. Ship the task/artifact/Scratch substrate and deployment-neutral causal knowledge core.
7. Ship Atlas + AST structural delta + repo map + Cairn scorecard, durable RouteStats/advice,
   causal integrity/audit/trace, audit-gated bounded recall, audit-gated selective promotion, and
   fact-bound Scratch oracle correction as the first capability verticals. **Shipped locally
   through Cairn Scratch correction/oracle release; Phase 51 also closes exact process lifecycle
   and reap. The implementation is canonical-green and its recursive exact-route matrix is retained
   as separate operational evidence.**
8. Expand the representation and capability ladders in measured increments.
9. Add MCP plus authenticated HTTPS/WebSocket user↔orchestrator control, operator surfaces,
   production runtime, and the registered evaluations.

No later step is permission to erase it from the goal.
