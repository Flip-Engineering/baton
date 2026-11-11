# dsh-seams — dsh capability seams & composition vs baton's adapters/routes
[attempt: f793be9c-e387-469d-9847-9cd3f4299d0f row-dsh-seams]

Row `row-dsh-seams` of the dsh comparison campaign. Subject: dsh's capability
seam model (`capability-seams.md` + `architecture.md`) and composition model
(profiles/bundles/patches) versus baton's harness-adapter registry, route
admission, deployment profile, and the #144 LSP pool. Ring-2 contract form:
ground truths → candidate evaluations → decisions → refusal vocabulary →
red-first acceptance pins → open questions. Every acceptance pin is RED at the
current HEAD of this worktree (`ws-a85eec6c86558faa0aab58d6ed19387c`).

## Ground truths

- **GT1 — The seam triple.** dsh defines a seam as a swappable capability with
  three roles — Service Definition (declaring the interface), Service Provider
  (implementing it), Consumer (commonly a model-facing tool) — and insists "one
  role alone is not a seam; adding a capability means designing all three"
  (`architecture.md` §Capability seams; `capability-seams.md` catalog, ~40
  rows each with `ctx key | Role | Owner | Implementations | Direct consumers |
  Companion plugins`). Baton's adapter layer has the three roles at
  *whole-harness* granularity: Definition = the D1 Adapter contract
  (`adapter.mjs` — `card()/spawn()/prompt()/interrupt()/approve()/answer()/
  kill()/onEvent()`, duck-typed via `assertIsAdapter`); Provider =
  `CLI_ADAPTERS` (`cli-adapters.mjs` — `CodexCli`, `ClaudeCli`, `ZCodeCli`,
  `PiCli`), `MockAdapter`, session adapters (`claude-session.mjs`,
  `codex-appserver.mjs`); Consumer = the coordinator, `RouteLiveness` probes,
  the wave-driver. Per-capability granularity lives in `capability-registry.mjs`
  (cards: `name`, `ops` with `latency_class`/`preflight_output`/`interruptible`,
  `northbound` split).

- **GT2 — Swappability is whole-harness in baton.** The unit of swappability is
  the adapter keyed by route tuple: `routeTupleKey` is
  `[harness, version, model, effort, family, taskType, resolutionDigest?]`
  (`route-tuple.mjs:1-5`). dsh's unit of swappability is the *capability*
  (`ctx.fs`, `ctx.subprocess`, `ctx.shell`, `ctx.lsp`, `ctx.subagents`,
  `ctx.llm`, `ctx.tools`) — a single provider swap can move an entire execution
  world. Baton has no per-capability provider swap; its finest swappable unit is
  the harness adapter plus the capability-plane ops.

- **GT3 — Guarded dispatch.** dsh runs every tool call through a guarded
  pipeline: `tools/pre-execute` (allow/deny/ask waterfall) → monotonic
  `ToolGuard`s (deny-only; a guard's return "deliberately has no allow result… a
  later listener cannot undo it") → `tools/execute` (around-dispatch) →
  `tools/post-execute` → `finalizeContent` → `tools/result`
  (`subsystems/tools.md`). Baton's single policy gate is `_authorize` at
  `application.mjs:3214` (boolean; `application_unauthorized` otherwise). The
  counterexample is the #176 pre-gate hole: the facade projection direct ports
  dispatch BEFORE the recursive-session gate
  (`application.mjs:12502-12516` — the `run.*` wave-surface ports dispatch
  before `normalizeCommandContext`/the gate at `:12527-12532`; the block's own
  comment admits "Dispatched here — BEFORE … the recursive-session gate").
  Baton's monotonicity is sound (`_authorize` cannot force-allow); its shared
  dispatch point is not universal.

- **GT4 — Composition is layered in dsh, constant in baton.** dsh profiles list
  bundles; layers apply in order — each bundle in profile order, then the
  profile's `cordis.patch.yml`, then the home-level, then any `--patch` overlay;
  a patch targets a row by id and replaces its whole config or inserts rows
  (`architecture.md` §Profiles and bundles). Baton's deployment is a module
  constant: `resident.deployment.mjs` hard-codes routes and
  `verification: Object.freeze({ command: 'true', arguments: [] })` at line 17,
  and `application-deployment.mjs` `applicationProfile()` builds a single
  `default` profile. #180 (resident-verifier-true) is that hard-coded
  trivially-passing verification.

- **GT5 — LSP substrate.** dsh's `ctx.lsp` seam has a single provider
  (`lsp-local`), but lsp-stdio spawns through `ctx.subprocess`, and "Filesystem
  and subprocess providers share one execution world, so pointing them at a
  remote sandbox moves Bash, PTY, and LSP with them, with no provider forks"
  (`capability-seams.md`; `architecture.md` §Capability seams). Baton's #144 LSP
  pool is hub-managed and local: one server per (repo, language), never
  per-worker, supervised under process-lifecycle, reading the repo base root
  (`lsp-support-contract.md` D1), with a degradation ladder live-LSP → static
  atlas → honest-empty.

- **GT6 — Postures are mirror images.** dsh is a HOST: it spawns southbound
  providers (`subagent-acp`, `subagent-codex`, `subagent-claude-code`,
  `subagent-dsh-sdk` — delegated turns in *other* products) via `ctx.subagents`
  (`subsystems/subagent.md`). Baton EXPOSES itself as an MCP server northbound
  (`impl/MCP.md`, `mcp-northbound.mjs`), admitting wave members only against the
  deployment profile's exact `{harness, model, effort}` tuples
  (`application.mjs:3185` `application_route_not_allowed`).

- **GT7 — The single-agent trap is law.** Every candidate is evaluated for what
  it means across a swarm — the WAVE primitive (fenced worktrees,
  content-addressed pins, coordination store, coordinator seat) — never for a
  lone agent. A candidate whose only benefit is a single agent's convenience,
  with no fleet-coordination consequence, is not adopted on that account.

## Candidate evaluations

### C1 — The seam triple as a discipline
- **dsh mechanism:** `architecture.md` §Capability seams — the three roles
  (Definition/Provider/Consumer) per capability; "adding a capability means
  designing all three."
- **baton target:** `capability-registry.mjs` (cards + `invoke()` +
  `northbound` split) and `adapter.mjs`/`cli-adapters.mjs` (whole-harness
  adapters). Landing zone: the capability cards and the #144/#123 contract
  discipline.
- **Verdict: ADAPT.** The three roles are present in baton but at two
  *different* granularities with the Definition role implicit: at harness
  granularity the adapter object is simultaneously the Definition reflection
  (`card()`) and the Provider (verbs) — read-only by the router and
  `RouteLiveness.adapterFor()`, but not a declared interface package; at
  capability granularity the `capability-registry.mjs` card is a real
  Definition/Provider/Consumer triple (card ops / module / `context.read`
  dispatch). Adopt the *naming discipline*: a new capability must declare
  Definition (card ops) + Provider (module) + Consumer (read-kind dispatch),
  and the harness adapters should be understood as coarse seams — not
  re-architected.
- **Swarm meaning:** capability-grade seams let a coordinator reason per-op
  ("which capability card serves `latency_class: task` with
  `interruptible: true`") instead of per-harness.

### C2 — Subagent-behind-one-interface / delegated turn in another product
- **dsh mechanism:** `subsystems/subagent.md` — one `SubagentProvider` interface
  over six providers ranging from a fresh child (`spawn-in-process`,
  `fork-in-process`) to a *delegated turn in another product* (`acp`, `codex`,
  `claude-code`, `dsh-sdk`); capability flags (`outputSchema`/`depthLimit`/
  `toolFilter`/`persona`) validated before start, fail loud; continuable
  children with Activations (followup routing: running→enqueue, waiting→wake,
  none→cold-resume).
- **baton target:** the adapter registry IS the one-interface-many-providers
  pattern (`CLI_ADAPTERS`), and "drive an *already-running* other-product
  session as a wave member without a fresh CLI spawn" is ALREADY IMPLEMENTED
  for three vendors: `grok-acp.mjs` and `kimi-acp.mjs` are D1 *session*
  adapters speaking JSON-RPC 2.0 over NDJSON stdio to a dedicated vendor ACP
  child per worker (`acp-json-rpc-process.mjs` is the "bounded, fail-closed
  JSON-RPC 2.0 NDJSON client for one owned ACP process"); `claude-session.mjs`
  and `codex-appserver.mjs` drive long-lived sessions via SDK/app-server.
  `MockAdapter`'s `attachOnly`/resume (`session.mode === 'resume'`) is the
  attach primitive. Landing zone: `cli-adapters.mjs` + `adapter.mjs`
  (attach/resume), gated by `_authorize` + route admission with an honest card.
- **Verdict: ADAPT — narrowed.** The delegated-turn provider is NOT absent; it
  is the ACP/SDK session tier, already on the D1 surface. The remaining gaps:
  (a) an OhMyPi/omp session card (no omp adapter in `CLI_ADAPTERS`), (b) the
  `SubagentCapabilities` pre-check discipline (`outputSchema`/`depthLimit`/
  `toolFilter`/`persona` — a typed refusal BEFORE spawn on the route admission
  path rather than accept-then-degrade). Shape change for (a): a session
  adapter whose card is honest about verbs (`attach` only); for (b): a
  capability-flag gate before the adapter `spawn()`.
- **Swarm meaning:** a wave member can be an existing long-lived session, not
  just a CLI child — the coordinator's spawn/kill lifecycle stays uniform
  because the adapter contract is unchanged.

### C3 — The guarded tool pipeline
- **dsh mechanism:** `subsystems/tools.md` — the guarded pipeline with two load-
  bearing properties: (a) the guard evaluates at a *shared* dispatch point for
  every call (`tools/execute`), and (b) guards are *monotonic* (deny-only,
  `ask` fails closed to deny, arguments frozen so history/audit/UI/execution
  agree).
- **baton target:** `_authorize` at `application.mjs:3214` already has the
  monotonic property (boolean, cannot force-allow). It does NOT have the
  shared-dispatch-point property across every northbound verb: the #176 pre-gate
  hole (`application.mjs:12502-12516` facade direct ports dispatch before the
  recursive-session gate at `:12527-12532`) is a verb path that bypasses the
  gate. Landing zone: `application.mjs` `command()` dispatch — the facade block.
- **Verdict: ADAPT.** Monotonicity is ALREADY-HAVE (`_authorize` is a boolean
  gate and `restrictingReadAuthorize`/`deploymentGoalPlanAuthority`/
  `_refuseCoordinatorAuthority` are deny-scoped). The fix is the shared dispatch
  point: every northbound verb — facade direct port or recursive command — must
  traverse the same authority gate. This is a correcting action on #176 (the
  §D2 full shape), not a new mechanism. The args-frozen property maps to baton's
  deep-frozen immutable context (already the norm).
- **Swarm meaning:** no wave verb draws authority past a gate it should have
  been refused at — the A5 finding's lesson is that lease-bound `waves.*` ports
  must be gated like every other verb.

### C4 — Config-patch composition
- **dsh mechanism:** `architecture.md` §Profiles and bundles — named
  composition layers, later-layer overrides, replace-any-row-by-id patches,
  profiles as named configurations stackable over a default.
- **baton target:** deployment is a module constant (`resident.deployment.mjs`);
  `applicationProfile()` builds one `default` profile; the MCP descriptor is
  read-once-immutable. Landing zone: `application-deployment.mjs` profile
  construction + `resident.deployment.mjs`.
- **Verdict: ADAPT — narrowly.** Adopt *profiles-as-layers* (a campaign profile
  stacking over the default profile) so a deployment can declare heavyweight and
  cheap seats without editing the deployment module. Do NOT adopt
  patch-overlay on trust-gate inputs: if a patch could replace the
  `verification` row, #180's `command:'true'` becomes a feature and honesty-over-
  comfort is violated. Would a patch layer have prevented #180? No — a patch
  could *introduce* it. #180 is a default-value bug: the resident's verification
  default must be an honest command or none, and trust-gate inputs
  (`verification`, `expectResult`) are either non-patchable or
  patchable-only-with-audit, by deployment-owner authority never a worker.
- **Swarm meaning:** campaign profile layers make the fleet's route set explicit
  and stackable, but the trust-gate inputs that make routes *verifiable* stay
  pinned.

### C5 — LSP through the fs/subprocess seam
- **dsh mechanism:** `capability-seams.md` — LSP rides the `ctx.subprocess`
  seam; swapping the subprocess provider to a remote sandbox moves Bash, PTY,
  and LSP together "with no provider forks."
- **baton target:** #144 hub-managed-local pool (`lsp-support-contract.md` D1),
  static-index degradation ladder. Landing zone: the #144 pool card + contract.
- **Verdict: ADAPT (principle) / REJECT (topology today).** The remote-sandbox
  move is REJECT at current HEAD: baton has no remote execution world (no
  `ctx.e2b` analog), and #144 deliberately pinned hub-managed-local with
  honest-empty degradation — that decision stands. The substrate-seam principle
  is ADAPT: name the pool's execution substrate on its card (local subprocess
  under process-lifecycle) so a future remote world moves the pool without
  forking its consumers. The dsh claim "move the seam, not the provider" is the
  discipline to record — #144 already keys per-(repo, language); naming the
  substrate completes the seam.
- **Swarm meaning:** a future fleet running remote workers keeps one pool per
  (repo, language) regardless of where the worker executes, because the pool's
  substrate is declared, not implicit.

### C6 (found) — Dormant provider directory
- **dsh mechanism:** `subsystems/llm-streaming.md` —
  `registerConfigurableProviders` lets config surfaces *offer* dormant providers
  before any route registers.
- **baton target:** route admission admits only configured profile routes
  (`application.mjs:3185`); `RouteLiveness.project()` already distinguishes
  verified/failed/unsupported/unverified. Landing zone: `mcp-northbound.mjs`
  descriptor + `RouteLiveness.project()` — a `{state:'dormant'}` projection
  distinct from unverified.
- **Verdict: ADOPT (additive).** The MCP surface can *offer* a route the
  deployment hasn't activated, with honest dormant state, never admitting it.
  Additive on the closed exact-tuple vocabulary; no new route class; no wall-
  clock control (dormancy is a static state, not a timer).
- **Swarm meaning:** a coordinator can see what a deployment *could* run without
  silently admitting it — honest surface, no admission.

### C7 (found) — Atomic route replacement
- **dsh mechanism:** `subsystems/llm-streaming.md` —
  `AdapterRegistrationHandle.replace(providers)` — atomic route swap, validated
  in full first, no gap.
- **baton target:** deployment routes are immutable for the server's life;
  a credential-expired or dead vendor route needs a restart. Landing zone:
  `application-deployment.mjs` + `RouteLiveness` re-probe.
- **Verdict: ADAPT.** An additive, validated `replace` on the deployment's route
  set — same exact-tuple class, no new routes — gated by a route-liveness
  re-probe, deployment-owner authority only. Rides the #167 readiness tier.
- **Swarm meaning:** a long-lived resident swaps a dead route without a fleet
  restart; the liveness tier re-probes before the new tuple admits.

## Decisions

| ID | Candidate | Verdict | Landing zone |
|----|-----------|---------|--------------|
| C1 | seam triple discipline | ADAPT | `capability-registry.mjs` cards + #144/#123 contract discipline |
| C2 | subagent-behind-one-interface / delegated turn | ADAPT | `cli-adapters.mjs` + `adapter.mjs` resume/attach + route admission |
| C3 | guarded tool pipeline | ADAPT (monotonicity ALREADY-HAVE) | `application.mjs` `_authorize` + facade block (#176) |
| C4 | config-patch composition | ADAPT (profiles-as-layers, operator-authority; patch-overlay on trust-gate inputs REJECT) | `application-deployment.mjs` + `resident.deployment.mjs` (#180 = corrected default) |
| C5 | LSP via substrate seam | ADAPT (substrate seam on #144 card); remote topology REJECT today | `lsp-support-contract.md` D1 |
| C6 | dormant provider directory | ADOPT | `mcp-northbound.mjs` + `RouteLiveness.project()` |
| C7 | atomic route replacement | ADAPT | `application-deployment.mjs` + `RouteLiveness` re-probe |

## Refusal vocabulary

- **REJECT — remote-sandbox LSP topology** until baton has a remote execution
  world. #144 D1 (hub-managed local + static-atlas degradation) stands; dsh's
  e2b seam-move has no baton analog.
- **REJECT — patch-overlay on trust-gate inputs.** A patch that can replace the
  `verification` row institutionalizes #180; violates honesty over comfort and
  machine-channels-sterile. Trust-gate inputs are non-patchable or
  patchable-with-audit, deployment-owner only.
- **REJECT — per-capability provider forking on dsh's model** (`fs-e2b` +
  `subprocess-e2b` sharing one SDK handle). Baton has no sandbox execution
  world; the honest shape is local + declared substrate seam, not parallel
  provider families.

## Red-first acceptance pins (RED at current HEAD)

- **P1 RED** — no per-capability seam-triple naming discipline: capability
  cards do not declare a Provider/Consumer triple, and the harness adapter
  Definition role is implicit duck-typing (`adapter.mjs` `assertIsAdapter`),
  not a declared interface.
- **P2 RED** — no delegated-turn-in-another-product adapter card in
  `CLI_ADAPTERS`; an existing omp/Claude-Code session cannot be admitted as a
  wave member without a fresh CLI spawn.
- **P3 RED** — the #176 pre-gate dispatch order stands: facade direct ports
  dispatch before the recursive-session gate (`application.mjs:12502-12516` vs
  `:12527-12532`).
- **P4 RED** — no profile layers or patch overlays; the resident verification
  row is a hard-coded `command:'true'` (`resident.deployment.mjs:17`).
- **P5 RED** — the #144 pool has no declared execution-substrate seam on its
  card; "local" is implicit.
- **P6 RED** — no dormant-route projection; the MCP surface offers only
  configured routes.
- **P7 RED** — no atomic route replacement; deployment routes are immutable for
  the server's life.

## Open questions & judgment calls

- **Judgment call (C1):** baton's three roles exist at whole-harness
  granularity with the Definition implicit. I treat this as a naming discipline
  to adopt, not a defect to fix — the honest `card()` IS the reflection.
- **Judgment call (C2):** the delegated-turn provider is real but
  forward-looking; the resume/attach-only primitive is the seam. Not a blocker;
  the OhMyPi reading (omp session as wave member) is noted, not implemented.
- **#180 root cause:** a default-value bug, not a composition bug — a patch
  layer would not have prevented it and could have introduced it. The corrected
  default (honest verification command or none) is the primary fix.
- **Authority class:** patch layers and route replacement are
  deployment-owner-authority decisions, not worker decisions. No
  DECISION_REQUEST needed — the standing vetoes (machine channels stay sterile,
  honesty over comfort) already resolve the class.
- **Shared-publish refusal (#158):** the row brief requires publishing to the
  `shared` scratchpad partition when complete, but no worker-facing scratchpad
  write tool is advertised in this worktree's tool surface (no
  `run.scratchpad.write` channel). The only sanctioned deliverable channel is
  this evidence file. Exact refusal: **I cannot write to the `shared` partition;
  the scratchpad write surface is not advertised to this worker.**

## Continuation — second pass

Second-pass extension of the same row. Ground truth **GT7 (the single-agent
trap is law)** binds every candidate below: each is evaluated for fleet
meaning, never lone-agent convenience.

### C2A (amendment to C2) — the ACP provider correspondence

- **dsh mechanism:** `capability-seams.md:447,458` — `subagent-acp` is a
  `ctx.subagents` provider that spawns through `ctx.subprocess`; the bash
  executors, PTY shell backend, LSP host, and the out-of-process ACP/Codex/
  Claude-Code subagent backends all spawn through the subprocess seam.
- **baton target (ALREADY-HAVE):** `grok-acp.mjs` and `kimi-acp.mjs` are D1
  *session* adapters conforming to `assertIsAdapter` in `adapter.mjs`, speaking
  JSON-RPC 2.0 over NDJSON stdio to a dedicated vendor ACP child per worker
  (`acp-json-rpc-process.mjs` — a "bounded, fail-closed JSON-RPC 2.0 NDJSON
  client for one owned ACP process"). The ACP shape difference is documented:
  `session/prompt` is a long-lived request whose response IS the turn terminal;
  `session/cancel` is a response-less notification whose effect arrives as the
  pending prompt resolving `{stopReason:"cancelled"}` (GA3/GA18).
- **Verdict: ALREADY-HAVE for grok and kimi — the delegated-turn-in-another-
  product provider exists on the D1 session surface. ADAPT for the remaining
  breadth:** (a) an omp/OhMyPi session card is absent from `CLI_ADAPTERS`; (b)
  the `SubagentCapabilities` pre-check discipline (typed refusal BEFORE
  `spawn()` on the route admission path) is not a gate.
- **Swarm meaning (single-agent trap check):** the ACP session tier matters
  because a wave member can be a long-lived vendor session — the fleet's turn
  lifecycle is uniform across CLI children and ACP sessions, and an interrupted
  ACP turn is resumable without re-spawning. This is a fleet property, not a
  lone-agent convenience.

### C8 (found) — Continuable sessions / followup routing

- **dsh mechanism:** `subsystems/subagent.md:132-134` — one durable child
  Session with at most one process-local Activation; followup routing is a
  decision table over Activation state (running → enqueue in the same
  Activation, waiting → wake, no Activation → cold-resume from persisted state);
  the continuation manager owns it and `tool-subagent-control` delivers
  follow-ups (`capability-seams.md:458`).
- **baton target:** `session-recovery-supervisor.mjs` — a deployment-owned
  startup scan under Coordinator authority with bounded deployment policy
  (maxAttempts/maxSessions/maxStateRows/timeoutMs, hard-capped) — plus the
  adapter `prompt()/interrupt()/answer()` verbs and the ACP turn-terminal
  semantics above. Landing zone: `session-recovery-supervisor.mjs` + the
  adapter surface.
- **Verdict: ADAPT.** The recovery machinery exists; the dsh discipline worth
  adopting is the *explicit followup-routing decision* (enqueue/wake/
  cold-resume) so a wave coordinator resumes an interrupted turn across members
  deterministically instead of re-spawning. Shape change: name the followup
  decision on the recovery path. No per-worker heaviness — routing stays
  coordinator-owned, which is where the recovery supervisor already sits. (The
  supervisor's `timeoutMs` is a bound on a bounded deployment scan, not a pacing
  control — it does not violate the no-wall-clock-controls veto.)
- **Swarm meaning:** an interrupted turn in one member is resumed by the fleet's
  coordinator from persisted state — cold-resume, not re-spawn — so a long
  campaign survives a member crash.

### C9 (found) — Canonical output declaration + content-verified probe

- **dsh mechanism:** `subsystems/tools.md:11,28` — every `ToolDefinition` has a
  mandatory canonical `output` declaration; the registry's `schemas()` builds
  the model-facing surface by an explicit allowlist so `output`/`execute`/
  `finalizeContent`/`timeoutMs`/`isConcurrencySafe`/`presentCall`/
  `presentResult` never leak into a model request; `finalizeContent` may replace
  model-facing content but never the canonical value.
- **baton target:** `route-liveness.mjs:186,237-241` — the content-verified
  probe: `expectedLine = \`${route.model}-probe ok\``, bounded capture (≤2KiB),
  exact comparison, `verify.reverified` evidence minted through the shared
  evidence path (F-4). Landing zone: the liveness tier + the referee +
  `capability-registry.mjs`.
- **Verdict: ALREADY-HAVE at the liveness tier (the content-verified probe IS
  an output declaration + independent verification); ADAPT the declared-output
  discipline to the capability-plane ops cards.** Capability cards
  (`capability-registry.mjs`) declare `name`/`ops`/`latency_class`/
  `interruptible` but no canonical output — a consumer cannot assert what an op
  returns, so a referee cannot verify an op the way liveness verifies a route.
- **Swarm meaning:** the fleet's verifier and a member's assertion agree on one
  canonical output per op — no member verifies a different shape than the
  coordinator's referee.

### C10 (found) — Scope-aware shadowing

- **dsh mechanism:** `subsystems/tools.md` — scoped registrations (`agent.ctx`)
  shadow globals; `ToolRestriction` allow/deny per scope; a subtree sees the
  shadowed set while the global registry is unchanged.
- **baton target:** `restrictingReadAuthorize` enforces the scratchpad read law
  (`worker:<scope>` reads only its own partition) at read time but has no
  shadowing — there is no mechanism to give ONE member a different op set
  without changing the deployment-wide registry. Landing zone:
  `application-deployment.mjs` + the capability-plane registry.
- **Verdict: ADAPT.** The read-scope law is ALREADY-HAVE; the *shadowing*
  mechanism (a scoped capability set granted to a specific wave member, the
  global registry untouched) is the addition. Additive; deployment-owner-
  granted; never per-worker-heavy (a shadow is a per-member grant, not a
  per-member service).
- **Swarm meaning:** a coordinator grants one member a shadowed op set (e.g.,
  a coordinator seat's authority) without touching the fleet-wide registry —
  the fleet keeps one registry, members see scoped projections.

### C11 (found) — Adapter error contract (one call = one attempt)

- **dsh mechanism:** `subsystems/llm-streaming.md` — the LlmAdapter contract:
  usage before finish, tool-call args stay raw JSON strings, two sanctioned
  error paths, one adapter call = one provider attempt, empty completion is a
  retryable error.
- **baton target:** typed adapter refusals — a typed code blocks
  (`route-liveness.mjs:203-213`), an untyped refusal is honest-unsupported
  (never a block), the `_fail(..., {blocking})` distinction, and the
  credential-scoped invalid_grant fan-out (fold F-1). Landing zone: the
  liveness tier + adapter refusals.
- **Verdict: ALREADY-HAVE.** The "one call = one attempt" and "typed refusal
  class" disciplines are exactly baton's typed-code/blocking split. Recorded so
  the correspondence is on the table; nothing to adopt.
- **Swarm meaning:** route admission treats a typed vendor refusal as blocking
  evidence and an untyped failure as honest-unsupported consistently across
  every member.

### C12 (found) — The skills seam

- **dsh mechanism:** `capability-seams.md:441` — `ctx.skills` is a seam
  (Definition `skill` / Providers `skill-badge`, `skill-filesystem` / Consumer
  `tool-skill`) that "merges provider skill catalogs; tool-skill renders the
  session-prefix catalog and loads complete skill bodies."
- **baton target:** no analog. Baton has no skills seam; worker instruction
  loading (CLAUDE.md) is the harness's job, not the coordinator's. No landing
  zone in the adapter/route machinery.
- **Verdict: OUT-OF-SCOPE (no landing zone).** Instruction/skill loading is the
  harness's responsibility; the coordinator's surface is verbs and routes, not
  skill catalogs. Recorded for completeness, not adopted.

## Decisions — second-pass additions

| ID | Candidate | Verdict | Landing zone |
|----|-----------|---------|--------------|
| C2A | ACP provider correspondence | ALREADY-HAVE (grok/kimi) + ADAPT (omp card, capability-flag pre-check) | `grok-acp.mjs`/`kimi-acp.mjs` + route admission |
| C8 | continuable sessions / followup routing | ADAPT | `session-recovery-supervisor.mjs` |
| C9 | canonical output declaration | ALREADY-HAVE (liveness) + ADAPT (capability cards) | `route-liveness.mjs` + `capability-registry.mjs` |
| C10 | scope-aware shadowing | ADAPT | `application-deployment.mjs` + capability-plane registry |
| C11 | adapter error contract | ALREADY-HAVE | `route-liveness.mjs` / adapter refusals |
| C12 | skills seam | OUT-OF-SCOPE | none |

## Refusal vocabulary — second-pass additions

- **OUT-OF-SCOPE — skills seam.** Baton's coordinator surface is verbs and
  routes, not skill catalogs; instruction loading belongs to the harness.
- **No new wall-clock controls.** The session-recovery `timeoutMs` and the
  liveness probe window remain *bounds* on bounded scans and vendor-derived TTLs
  respectively; nothing in C2A/C8-C11 introduces a timer as a control.

## Red-first acceptance pins — second-pass additions (RED at current HEAD)

- **P8 RED** — no omp/OhMyPi session card in `CLI_ADAPTERS`; no
  capability-flag pre-check (typed refusal before `spawn()`) on the route
  admission path.
- **P9 RED** — followup routing is not an explicit coordinator decision; an
  interrupted turn is not cold-resumed from a routing table.
- **P10 RED** — capability-plane ops cards carry no canonical output
  declaration; only the liveness tier declares (and verifies) a canonical
  output.
- **P11 RED** — no per-member op shadowing; the capability registry is
  deployment-wide only.

## Open questions & judgment calls — second pass

- **Single-agent trap check:** every C8-C11 adoption passes — each has a
  fleet-coordination consequence (resume-across-members, verifier/member output
  agreement, one-registry-many-projections, uniform refusal class). No candidate
  was adopted on lone-agent benefit alone.
- **Judgment call (C8):** baton's session recovery is deployment-owned (good
  for a swarm) while dsh's continuation manager is process-local per child
  session; the adoption is the *routing decision*, not dsh's process-local
  ownership. The coordinator-owned shape is the honest landing zone.
- **Shared-publish refusal — second record, with verified evidence (#158):** I
  re-checked the worker-facing scratchpad surface on this pass. The MCP
  northbound verb table (`mcp-northbound.mjs:111-115`) exposes
  `baton_run_scratchpad_read` (observe) and `baton_run_scratchpad_elevate`
  (control/observe) but NO `baton_run_scratchpad_write`; the web bridge
  (`mcp-web-bridge.mjs:312-316`) lists no scratchpad verb; and
  `run.scratchpad.write` has no match anywhere in `application.mjs`. The
  worker-facing scratchpad WRITE channel is not advertised to this worker.
  Exact refusal stands: **I cannot publish to the `shared` partition; the
  scratchpad write surface does not exist on the control surface available to
  me.** The deliverable remains this evidence file.
