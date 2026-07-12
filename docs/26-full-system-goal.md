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
route-tuple implementation gate; the isolated concurrent Grok rerun remains separate live evidence
pending provider re-authentication.

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

The first shipped vertical is AST/structural delta for review. CPG, semantic merge, behavioral
fingerprints, IR, and e-graphs remain in the goal with explicit prototype/evaluation gates; a
negative result retires a rung through a recorded Decision, never through omission.

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
artifact, Scratch, and typed causal knowledge authority; Atlas supplies AST structural delta plus
shared base/worktree index, lexical orientation, symbol/reference/call graph, and SCIP JSON; and
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
It is locally green at 82 focused edge-policy tests and the current 678-test full suite after eleven recursive
corrective reviews. A twelfth clean Codex review was refused by the provider usage limit before a
verdict, so the clean independent-review gate remains pending. Authenticated concurrent Grok 4.5
route/kill/reap is likewise `PENDING-LIVE` until isolated provider authentication is available;
the latest two-worker attempt reached both worktrees and then reaped every resource after both
authentication refusals. That dogfood also exposed a false-green missing-test command and 14,070
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
restart-safe replay. Its 11 focused tests and the current 689/689 full suite are green. Streamable
HTTP authorization, MCP Tasks, progress heartbeats, and daemon supervision remain explicit next
depth rather than being inferred from stdio. Real-browser interaction and provider-backed review remain pending; neither is inferred
from the deterministic suite. A real TLS socket proof now passes OIDC redirect/PKCE/callback,
operator/session, command, SSE snapshot, logout/revocation, listener shutdown, and owned-state
cleanup. The in-app browser interaction remains pending because its required execution bridge was
not exposed; the wire proof is not relabeled as a browser pass.

The active next increment is the real-browser OIDC/control/stream/logout proof when its bridge is
available, plus optional WebSocket parity, Streamable HTTP MCP/tasks/daemon depth, and deeper operator surfaces. It is followed by
the next measured Atlas representation rungs, beginning with structural rewrite/live-LSP depth
and retaining CPG/dataflow, IR, behavioral fingerprints, semantic diff/merge, and e-graphs in the
catalog. These checkpoints narrow sequence only; they do not retire any later capability below.

1. Repair P0 control integrity: immutable briefs, truthful responses, crash-safe idempotent kill,
   provenance, story identity, replay identity, and complete cleanup.
2. Ship independent harness + exact-model + effort selection and attribution. **Shipped.**
3. Make persistent sessions genuinely usable through the driver; add resume/fork/rejoin.
4. Ship OS/credential isolation and budget/watchdog governance.
5. Complete hardened acceptance and structured integration.
6. Ship the task/artifact/Scratch substrate and deployment-neutral causal knowledge core.
7. Ship Atlas + AST structural delta + repo map + scorecard as the first capability vertical.
8. Expand the representation and capability ladders in measured increments.
9. Add MCP plus authenticated HTTPS/WebSocket user↔orchestrator control, operator surfaces,
   production runtime, and the registered evaluations.

No later step is permission to erase it from the goal.
