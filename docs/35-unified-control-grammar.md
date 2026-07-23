# 35 — One grammar: the unified agent control surface

**Status: v2 FINAL** (issue #43). v1 was adversarially red-teamed by three decorrelated seats
through baton.waves — codex `gpt-5.6-sol@high` (R-CX-1..15, verdict UNSOUND), kimi `k3@high`
(R-KM-1..17, SOUND-WITH-FOLDS), opus `claude-opus-4-8@high` (R-OP-1..17, SOUND-WITH-FOLDS) —
reports and drivers in `docs/reference/evidence/grammar-2026-07-24/`. Every finding is folded or
explicitly declined in Appendix B. Where reviewers disagreed (`work_completed`: R-CX-4 P0 vs
R-KM "clean"), the disagreement was resolved by direct code verification (R-CX-4 was right:
`application.mjs:117-124` models provider-settled and application-terminal as deliberately
separate lifecycles, pinned by `impl/test/phase67-run-terminality.test.mjs`).
**Seed:** operator directive, 2026-07-23 — *"baton has enormous friction and cumbersome
interaction methods for agents in all operations and control schemes."*
**Mechanical evidence:** `node impl/scripts/surface-audit.mjs` regenerates Appendix A from source.

---

## 1. The audit

### 1.1 What an agent must learn today

Baton has one authority path (§1.3) and **eight** surface dialects over it:

| # | Surface | Names | Source of truth |
|---|---|---|---|
| D1 | Semantic registry operations | 10 | `APPLICATION_SEMANTIC_REGISTRY.operations` |
| D2 | Semantic registry actions (`run.act` targets) | 27 | `APPLICATION_SEMANTIC_REGISTRY.actions` |
| D3 | Application command definitions (older table) | 26 | `APPLICATION_COMMAND_DEFINITIONS` |
| D4 | Web bus commands | 25 app-derived **+ ~19 kernel/goal-plan literals** | `WEB_APPLICATION_ENTRIES` ∪ `COMMAND_CAPABILITY` (`web-northbound.mjs:17-31`) |
| D5 | CLI verb rows | 37 | `registry.cli.commands` + `parseBatonCli` |
| D6a | MCP `fleet_*` dialect | 38 | `mcp-northbound.mjs` |
| D6b | MCP `baton_*` dialect | 21 | `mcp-northbound.mjs` |
| D7 | Embedded client methods | 120 | `application-client.mjs` classes |
| D8 | MCP-over-Web bridge subset | 5 | `ORDINARY_COMMANDS`, `mcp-web-bridge.mjs:14-16` |

(R-OP-2, R-OP-15b: v1's D4 counted only the application-derived half — the Web bus also admits
`spawn`, `send`, `interrupt`, `kill`, `drain`, `respond`, `list`, `result`, `wait`,
`capabilities`, `provider_status`, `capability_invoke`, `scratch_oracle`, `reuse_decide`,
`reuse_recheck`, `goal_define`, `plan_propose`, `plan_approve`, `goal_plan_status`; and the
remote bridge is a ninth hand-list. The M0 audit extraction must cover both.)

**~300 distinct operation names.** Phase strings observed across surfaces: the 16 in Appendix A
**plus** `selection_required`, `candidate_selected`, `input_required`, `planning_failed`
(R-OP-5) — v1's "16" was itself an undercount, proving the hand-list failure mode. The
delegated-seat concept answers to four live names (worker ×427, member ×219, workstream ×121,
assignee ×26 in the application layer).

None of this is one bug; it is accretion. Each layer is internally principled. The composition
is the friction.

### 1.2 Friction ledger (receipts)

- **F1 — Synonym storm.** worker / member / workstream(+role,generation) / seat / assignee all
  name the delegated seat, with different addressing per surface.
- **F2 — Read-model triplication.** `run.inspect` (depth cascade), `run.status` (+wait/follow),
  `run.episode` (chapter reads) are three read models over one Run; embedded adds six more
  spellings.
- **F3 — Two execution models.** Dedicated verbs coexist with the action executor; live receipt:
  the outline advertised `approve_plan`+`planDigest` but `run do` refused
  `application_action_scope_mismatch` because the executable coordinate (`actionId`) was not the
  advertised one.
- **F4 — Two MCP dialects** that disagree with each other on path collapsing *and* read model
  (fleet: status+wait; baton: inspect+act).
- **F5 — Twenty phase strings** across runs, waves, workflow projections, and the CLI terminal
  set, with three different terminal unions (`application.mjs:117-124`, `wave.mjs:11`,
  `application-cli.mjs:29` — wave omits `denied`/`closed`; the CLI adds both).
- **F6 — Cost-per-question.** "Why is my Run cancelled" cost four depth round-trips before the
  issue-35 fix; the cascade prices ordinary questions in tokens and turns.
- **F7 — Four idempotency disciplines** (CLI auto-key, embedded internal, MCP `mcp.call:<id>`,
  Web envelope key).
- **F8 — Start-verb fan-out with divergent *provenance*.** `run` / `run start` / `explore` /
  `review` / `workflow()` / `waves.start`. (R-OP-17 corrects v1: waves already start-then-approve
  explicitly and stamp `driverKind: 'wave'` — `wave.mjs:131,147-156`; `waves.start({approve:
  false})` parks like any run. The real divergence: `explore`/`review` record **no** expansion
  provenance at all — `application-semantics.mjs:597-598` is a CLI-row annotation only.)
- **F9 — Error opacity family** (issue #41; first slice landed).
- **F10 — Intent invisibility** (issue #38).
- **F11 — JSON walls**; no compact projection; field-order guarantees pinned nowhere.
- **F12 — Two registries** (D1/D2 vs D3) both routing commands, agreeing by luck.
- **F13 — Discovery split-brain** (#34/#36/#37; fixed; kept as class receipt).
- **F14 — Addressing drift**: `--to RECIPIENT` vs positional `ROLE` vs `--workstream ROLE
  --generation N`; `--reason` required on some destructive verbs, not others.

### 1.3 What is already right (and must not be lost)

- **One authority path.** Confirmed under adversarial review (R-OP survived-list): CLI, Web,
  MCP-stdio, and MCP-over-Web all terminate in the same application/coordinator authority with
  the same fencing and capability checks. Unification is a naming-and-projection problem.
- **The semantic registry exists** (D1/D2) with schemas, capability requirements, flags, help
  topics, and a digest — the seed of the generator.
- **Capability-filtered projections** — with one honest caveat the ledger must carry
  (R-OP-15e): view-action filtering applies only when the northbound context supplies capability
  authority (`application.mjs:8869-8875`); without it, candidates are returned unfiltered. This
  is a ledgered behavior divergence, not a design premise.
- **Progressive disclosure** is right; it needs the completeness law (L10), not removal.
- **Sanitization discipline, typed refusals, durable admission** keep working unchanged.

---

## 2. Goals and non-goals

**Goals.** One ontology; one closed verb grammar; mechanical name derivation; one lifecycle
vocabulary per axis (run / member / attention); advertised-is-executable (as L2 defines it);
errors that name stage/subject/remedy; constrain by construction (#32); steer don't gate (#31);
the registry as the single generator.

**Non-goals.** No new authority semantics — **in both directions** (R-OP-4): existing admission
preconditions are neither added to verbs that lack them nor removed from paths that have them.
Fencing, durability, verification, capability model, freshness binding, and reconcilability
classes are untouched. No removal of progressive disclosure. No browser-desk redesign (it
re-renders the registry; its pinned element ids move only in M3, R-OP-3). Baton is
self-contained — the blast radius of renames is its own tests, drivers, and docs.

---

## 3. The ontology

A closed noun tree. Nouns are **singular**; collections are `list` reads, never plural nouns.

```
deployment                       readiness/routes/workspace read, serve, host-only shutdown
run                              the unit of delegated objective work
  ├─ plan                        the approval gate (approve lives on run; authoring is a
  │                              separate profile — see below)
  ├─ member(role, generation?)   the delegated seat            ← worker/workstream/seat/assignee
  ├─ candidate(role)             a preserved competing result awaiting selection (R-OP-16)
  ├─ attention(id)               anything awaiting the caller — one SHAPE, several settlers (§7.3)
  ├─ evidence / review / export  trust-chain reads and gates
  └─ context                     cells, calls, expression algebra (unchanged; three
                                 plan-proposal verbs — see §6)
board(name)                      shared task lists (orchestrator- and worker-profiled ops)
package(digest)                  typed knowledge/context hand-offs
knowledge                        horizons (task/workflow/project reads)
route / profile / intent         value objects — never carry verbs
```

**The member unification.** Surface name: **`member`**, addressed **structurally** as
`{role, generation?}` — never by encoding generation into the role string (R-CX-8: `reviewer:g2`
must not collide with `{role:"reviewer", generation:2}`). `worker` remains the kernel term and
never surfaces; `workstream`/`seat` retire from surface names. Two clocks, stated (R-KM-10,
R-OP-14): **workflow-scoped** member reads and notify (`run.member.view`, `run.member.send`)
default `generation` to the run's current durable workflow round; **run-level** send/interrupt
(`run.send`, `run.interrupt`) resolve the current live recipient exactly as today
(`application.mjs:1930-1976`) and have **no generation axis**. During a generation transition
with a predecessor worker still live, a bare-role member send fails with the existing
`application_control_recipient_ambiguous` and requires `--generation`.

**Reserved sentinel `work`** (R-OP-14): `work` is a run-level recipient token meaning *the
current single seat* (`application.mjs:1943`). `run.send` accepts it; `run.member.send ROLE`
rejects it; a workflow role literally named `work` is a registry-lint error.

**The attention unification — one shape, not one verb** (R-OP-7, R-KM-4, R-CX-6). Every
attention item carries `kind`, `prompt`, `options?`, and a bound `do` (§5 L2). `run.answer`
settles the answerable kinds (`answer_question`, `answer_approval`, `answer_decision`,
`turn_checkpoint` — the checkpoint via a three-variant response, §7.3). The gate kinds
(`approve_plan`, `select_candidate`) are settled by their named verbs (`run.approve`,
`run.select`), whose invocation is exactly the item's bound `do`. v1's "one verb answers all of
them" was false and is withdrawn.

**Goal/plan authoring** (R-OP-2): the Web-bus authoring commands (`goal_define`,
`plan_propose`, `plan_approve`, `goal_plan_status` — `web-northbound.mjs:20`, reconcilable,
colon-namespaced capabilities) are a separately-profiled surface (§5 L8 profile `authoring`),
outside the ordinary grammar, unchanged — like the kernel tools. §3's `plan` note above refers
to the *ordinary* surface, where approval is the only plan verb and it lives on `run`.

---

## 4. The grammar

### 4.1 Verb set (closed)

| Class | Verbs | Semantics |
|---|---|---|
| read | `view`, `watch`, `list`, `help` | `view` = one bounded view at a depth, **optionally change-aware** (`--cursor N --wait D` — the registry's own preferred continuation, `application-semantics.mjs:135-140`) **or condition-awaiting** (`--until settled\|terminal`, absorbing `run.wait`'s deployment-bounded settle-block, R-OP-9/R-KM-2); `watch` = the only **event-channel** read (`channel: progress\|events\|output\|changes`, `--to RECIPIENT` for output, inherits `followPolicy` gating and per-channel cursors); `list` = bounded collections; `help` = self-description |
| lifecycle | `start`, `approve`, `stop`, `recover`, `resume`, `retry` | exactly today's authority semantics |
| interaction | `answer`, `send`, `interrupt` | `answer` settles answerable attention (§7.3); `send`/`interrupt` run-level forms resolve the live recipient as today; member forms are `{role, generation?}`-addressed |
| trust | `review`, `adopt`, `select`, `feedback`, `revise`, `integrate`, `export` | the evidence→integration chain, unchanged semantics; `select`/`feedback` address a **candidate**, not a member (R-OP-16) |
| object | board: `post`, `claim`†², `report`†², `retitle`, `reorder`, `close`, `read`; package: `admit`, `attach`, `read`; context: `eval`, `map`, `reduce`, `retry` | reflex/REPL/context families; `context.map/reduce/retry` are plan-proposal verbs (R-CX-1, R-KM-9) |
| meta | `do` | the generic executor for an advertised action; takes the advertised `{kind, actionId, inputs}` and nothing else. **Named verbs are peers, not sugar** (R-OP-4): they carry their own schemas and admission and never inherit `do`'s freshness/semantic-authority machinery; `do` never sheds it. L2 constrains the *advertised* set, not the verb set. |

†² `board.claim`/`board.report` are **worker-profile** operations (R-CX-14): they bind a
worker/owner identity, observed item version/digest, and board fence
(`coordination-store.mjs:12717-12753`) and are deliberately absent from the ordinary operator
surface (`mcp-reflex-board-package-red.test.mjs:213-224` pins the absence). They appear here
because the grammar covers every profile; L1 is profile-scoped.

Banned as surface verbs (synonyms; the lint set is **generated from this table with token
normalization** — `stop_member` and `stop-member` are one token, R-CX-13): `show`, `status`,
`inspect`, `act`, `notify`, `follow`, `wait`, `progress`, `events`, `output`, `episode`‡,
`stop-member`, `steer`†.

† `run.steer` is a **deprecated compatibility command, not an alias** (R-CX-15, R-KM-5,
R-OP-8): its exact five-field schema (`{runId, target, mode, message, reason}` — worker-id
target, all three delivery modes, **required** reason), its worker-ownership/fence resolution,
and its unique `reconcilable: false` admission class (`application.mjs:142`, the only one;
consumed by `web-northbound.mjs:24`) are preserved verbatim through M5 and retired to the kernel
profile, never rewritten into `member.send`. `reconcilable` becomes a per-operation registry
field (§8.1) so no alias can flip a durability class silently.

‡ Episode chapters become sections of `run.view` — **the fold is sound only with the episode's
axes carried over** (R-OP-3, R-KM-3, R-CX-3): `run.view` gains `--role ROLE` (with the explicit
value `--role none` selecting the run-level aggregate, which is a *distinct projection* —
`phase92-episode-attribution-red.test.mjs:105-106`) and `--generation N` (the durable workflow
round, never a Plan version — P92-EA4); episode `detail` maps onto the existing `depth` tail
(`item|content|evidence` ⊂ depth enum, `application-semantics.mjs:44-45` — the clean half).
The four cross-argument admission rules (`pageCursor` only for output×content; `content` only
for output|help; `generation ⇒ role`; `waitMs ⇒ cursor` — `application.mjs:1226-1247`) port
verbatim into the `run.view` schema. Cross-role and cross-generation evidence isolation
(`phase92-episode-attribution-red.test.mjs:103-104,133-144`) is a contract **of the fold**.
Registry-owned `--section` values do not count against H7's name depth (R-KM-3).

### 4.2 House rules

- **H1 — Shape.** `noun[.subnoun].verb`, verb last, imperative. Derivation per §6.1 is
  mechanical; drift like `baton_workstream_notify` vs `fleet_run_workstream_notify` becomes
  impossible.
- **H2 — One name per concept.** Aliases exist only inside the migration window, deprecated in
  help/annotations, resolved in the dispatch layer (§9 M1).
- **H3 — Reads are nouns or the four read verbs.** No `get_`/`fetch_`/`show_`.
- **H4 — Ids positional, options labeled.** A flag's name is the **kebab-case of its JSON schema
  property** (`pageCursor` → `--page-cursor`); an enum-valued property MAY additionally expose
  one flag per value (`delivery: now` → `--now`) declared as `flagAliases` in the registry entry;
  undeclared value-flags are a lint failure (R-OP-12). Member ops take `ROLE [--generation N]`;
  candidate ops (`select`, `feedback`) take `ROLE` addressing a candidate — the only two
  role-addressing classes, both registry-declared (R-OP-16).
- **H5 — Reasons.** Destructive verbs uniformly **accept and durably record** `--reason`, and
  views surface its absence. Schema-*required* only for the non-emergency gate class (`revise`,
  `integrate`, `adopt`); `stop`, `member.stop`, and `interrupt` keep `reason` optional — adding
  a required field to the emergency path would be a new admission precondition, violating §2
  (R-OP-13; `application-semantics.mjs:170,179,612,621`).
- **H6 — No abbreviations, no vendor words, no plural nouns** in operation names.
- **H7 — Depth ≤ noun.subnoun.verb.** Registry-owned enum/section values are data, not names.
- **H8 — Every operation ships an example invocation** rendered into MCP listings, CLI help, and
  generated docs from one string.
- **H9 — Closed enums are registry-owned** (phases, member states, attention kinds, channels,
  effect classes): lower_snake, closed, no surface mints one. **Instance-valued enums**
  (`recipient`, `role`, `strategy`) are registry-*shaped*, not registry-*valued*: they are minted
  per view from live run state (`application.mjs:8880-8906`) and H9 does not bind them (R-OP-14).
- **H10 — Canonical serialization order**, scoped (R-CX-11, R-KM-13): a serialization-layer
  normalization over the envelope, outline top-level fields, and registry-owned nested objects —
  never a builder discipline; arrays whose order is semantic (recipients, prioritized actions)
  are pinned by their declared sort rule. **Parsers must remain order-insensitive.** All
  digest/replay identities stay on the existing sorted-key canonical form
  (`application.mjs:171-187`) — the pin is presentation, versioned and tested separately (C8,
  cut at M4).

---

## 5. The laws

- **L1 — One grammar, per profile** (R-CX-14): every registry operation is reachable on every
  surface **enabled for the same authority profile** under its mechanically derived name, and no
  surface exposes a name the registry cannot derive. Profiles (§8.3): `ordinary`, `kernel`,
  `authoring` (R-OP-2), `worker` (board claim/report), `remote_bridge` (D8, R-OP-15b), `host`
  (serve/shutdown).
- **L2 — Advertised is executable: kind-portable, id-local** (R-OP-1, R-KM-6, R-CX-7). Every
  advertised action carries `do: {action: {kind, actionId}, inputs}`. `kind` and `inputs` are
  portable and byte-identical across surfaces; `actionId` is a **freshness token** bound to the
  view digest and calling principal/session (`application.mjs:7310-7323`) which each surface
  re-derives from its own fresh view. Executing the same `{kind, inputs}` on any enabled surface
  reaches the same authority and the same post-state phase, cause, and attention set (excluding
  cursor and freshness fields). `actionId` is never a durable literal — a driver that caches one
  gets `application_action_scope_mismatch` and re-reads; that refusal is the designed recovery
  (R-KM-15). Over MCP-over-Web the bridge mints the authority envelope per session
  (`mcp-web-bridge.mjs:111-135`); the caller-visible block stays `{kind, inputs}` everywhere.
- **L3 — Terminals are explained** (R-CX-10): every **non-success** terminal carries a typed
  cause; `completed` carries a non-null accepted result/outcome authority and MAY have
  `terminalCause: null` (pinned today by `phase92-read-only-result-red.test.mjs:90-103`).
- **L4 — One vocabulary per axis.** Exactly the §7 enums, with **generated** legacy mappings
  (R-OP-5: hand-maintained mapping lists are the failure mode this document exists to end). The
  registry owns two predicates — `providerSettled(phase)` and `applicationTerminal(phase)` —
  and no surface derives either from a single terminal union (R-CX-4).
- **L5 — Presets are recorded expansions** (R-OP-17, R-KM-17): every preset run's durable log
  carries an expansion record naming the preset and the core operations it issued. Waves already
  approve explicitly and stamp `driverKind: 'wave'` (`wave.mjs:131,147-156`); the work is
  extending that provenance to `explore`/`review` (which today record nothing) and recording the
  expansion itself. `waves.start({approve: false})` is a distinct recorded expansion. No
  durability-semantics change.
- **L6 — One name per concept**, lintable via the generated banned-token set.
- **L7 — Errors name stage, subject, remedy** (`{code, stage, subject, remedy}`; sanitized
  exactly as today; #41 generalized).
- **L8 — Constrain by construction**: a principal's surface inventory *is*
  `render(filter(registry, capabilities ∪ profile))`. The ordinary/advanced MCP split, the
  authoring commands, the remote-bridge hand-list, and worker tool registration (#32) all become
  profile projections of one computation.
- **L9 — Steer, don't gate**: checkpoints surface as attention with the three-variant response
  (§7.3) mapping exactly onto the landed `nudge_turn`/`wait_turn`/`claim_turn` acts — semantics
  untouched (R-CX-6, R-KM-4).
- **L10 — Outline is complete in kind** (R-CX-12): the registry owns a closed
  `outlineTruthKinds` enum — `phase`, `stage`, `terminal_cause_or_outcome`, `attention`,
  `next_action`, `route`, `progress`, `resources`, `preservation`, `section_availability`. The
  outline advertises every kind (including availability links for every registered section);
  deeper depths add authoritative coordinates, payloads, and evidence — never a new kind. C5
  tests the finite phase × attention × next-action matrix, not a prose universal.

---

## 6. The canonical operation set

Forty-five operations replace ~300 names. Verb-level entries are peers of `do` (§4.1 meta row).
Every row carries its authority profile; unmarked rows are `ordinary`.

| Canonical | Replaces / notes |
|---|---|
| `deployment.view` | remote readiness/routes/workspace read (`doctor --check`, `routes()`, `route()`). The CLI's credential-free local doctor is a host-side rendering detail, **not** projected to web/MCP (R-KM-16) |
| `deployment.serve` | `baton serve` — profile `host` |
| `deployment.shutdown` | `application.shutdown` (`application.mjs:152`) — profile `host`, never web/MCP (R-OP-2, R-KM-1) |
| `run.list` | `runs.list`, `baton_runs` |
| `run.start` | `run.start` + presets `explore`/`review`/`workflow()`/`waves.start` (sugar with recorded expansion, L5) |
| `run.view` | `run.inspect`, `run.status`, `run show`, **`run.wait`** (`--until settled\|terminal`, R-OP-9), `run.episode` + chapters (with `--role/--generation/--section`, §4.1‡), embedded outline/index/changes-awaiting reads. `run result` = `run.view --section episode.result` (the double-mapped v1 `run.result` row is deleted, R-OP-9) |
| `run.watch` | `run.follow`, `run progress/events/output --follow` (channels; `--to` for output; followPolicy-gated) |
| `run.do` | `run.act`, `baton run do` |
| `run.approve` | `run.approve` (waves' explicit per-member approve is already this operation) |
| `run.answer` | `run.answer` + `baton_decision_answer`; response union per kind (§7.3) |
| `run.send` / `run.interrupt` | run-level, live-recipient-resolving; `work` sentinel accepted here only |
| `run.stop` | `run.stop`, `fleet_run_stop`, `baton_run_stop` |
| `run.evidence` | `run.evidence` — the one noun-read of the terminal manifest |
| `run.review` / `run.adopt` / `run.integrate` / `run.export` | same verbs, one spelling |
| `run.select` / `run.feedback` | candidate-addressed (R-OP-16) |
| `run.revise` / `run.recover` / `run.resume` / `run.retry` | same |
| `run.member.view` | `run.workstreams` (roster/generations/state read; per-member episode chapters go through `run.view --role`) |
| `run.member.send` | `run.workstream.notify`, `run notify` (structured `{role, generation?}`; `--to` stays on run-level send, R-OP-14) |
| `run.member.interrupt` | member-targeted interrupt |
| `run.member.stop` | `run.workstream.stop`, `run stop-member`, `stopMember` |
| `run.attention.list` | filtered read for polling; outline carries the same items (L10) |
| `context.eval` | `application.context_eval`, `baton context eval`, `baton_context_eval`; **keeps the closed `runId` XOR `manifestDigest` address union** (R-CX-1); `context_search/chunk/coverage` remain registry-recorded aliases of eval (already `legacyAliasFor`, `application-semantics.mjs:280-323`) |
| `context.map` / `context.reduce` / `context.retry` | the plan-proposal context actions (`effect: plan_proposal`, `application-semantics.mjs:226-279`) — first-class verbs, not do-only (R-CX-1, R-KM-9) |
| `board.post/retitle/reorder/close/read` | orchestrator board ops; registry rows carry the orchestrator-lease + `expectedBoardFence` + idempotency-binding authority fields (R-CX-14) |
| `board.claim` / `board.report` | profile `worker` (R-CX-14) |
| `package.admit/attach/read` | `baton_package_*`; same authority fields |
| `application.help` | `help`; topics regenerate from the registry |

**Explicit exclusions** (all L8-profiled, outside the ordinary grammar, unchanged): kernel tools
(`fleet_spawn/kill/respond/…` — profile `kernel`); goal/plan authoring (`goal_define`,
`plan_propose`, `plan_approve`, `goal_plan_status` — profile `authoring`, R-OP-2); the
checkpoint acts remain advertised do-targets whose settle path is `run.answer`'s three-variant
response (§7.3).

### 6.1 Derivation rules (mechanical)

For registry key `a.b.verb`: embedded `client.a(A?).b(B?).verb(opts)`; CLI `baton a b verb A?
B? [--flags]`; MCP `baton_a_b_verb`; web `a_b_verb`. One function computes all four; the
conformance suite asserts the computation. Each operation declares its enabled surfaces and
profile; aliases cannot bypass derivation. **C9** (R-OP-10): the derived web name set must be
disjoint from the kernel/authoring literal sets (`web-northbound.mjs:17-31`) — asserted, not
assumed.

---

## 7. One vocabulary per axis

### 7.1 Run phases

Canonical enum (non-terminal → terminal):

```
planning → awaiting_approval → queued → working ⇄ paused
                                        working → interrupted | uncertain
        → verifying → result_ready → [awaiting_selection → result_selected] → reviewing → integrating
terminal: completed | failed | cancelled | stopped | denied     transitional: stopping
```

`result_ready` is **provider-settled and deliberately non-terminal** (R-CX-4; the two-lifecycle
comment at `application.mjs:117-118` and `phase67-run-terminality.test.mjs` are the binding
contracts): adoption, selection, review, integration, and export all act after it. The registry
predicates: `providerSettled = {result_ready, awaiting_selection, result_selected} ∪ terminals`;
`applicationTerminal = {completed, failed, cancelled, stopped, denied}`.

Generated mapping (normative rule: **the mapping table is generated by the audit tool; a phase
literal in `impl/src` with no entry is a red test** — R-OP-5):

| Legacy | Canonical | Notes |
|---|---|---|
| `awaiting_plan_approval` | `awaiting_approval` | |
| `approved` | `queued` | approved-awaiting-dispatch is a real state (`application.mjs:6685-6725`); v1's `working` erased it (R-CX-5, R-KM-7) |
| `running` | `working` | |
| `interruption_uncertain` | `uncertain` | |
| `work_completed` | `result_ready` | **not** `completed` (R-CX-4) |
| `selection_required` | `awaiting_selection` | attention kind `select_candidate`; live consumer `wave.mjs:85` re-reports at M2 (R-OP-5) |
| `candidate_selected` | `result_selected` | |
| `input_required` (outline) | `working` + attention `answer_question` | `wave.mjs:86` re-reports at M2 |
| `planning_failed` | `failed` (cause `planning`) | |
| `start_failed` | **member state** `failed` (cause `start`, `runId: null`) — never a Run phase (R-CX-5) | |
| `closed` | **dead string** | no live emitter; deleted at M2 from `APPLICATION_RUN_TERMINAL_PHASES`, `PROVIDER_EXECUTION_SETTLED_PHASES`, `application-cli.mjs:29`, **and** the embedded completed-bucket at `application-client.mjs:251` (which today buckets it as completed while action-suppression treats it as stopped — the codebase already disagrees with itself; R-KM-7, R-CX-5) |
| `denied` | `denied` | terminal with cause |
| `pre_delivery` / `post_delivery` | — | control-delivery states in event payloads (`application.mjs:2043`), not run phases; out of scope of this enum |

Every non-success terminal carries `cause` (L3). `paused` is first-class non-terminal
(issue 31). **Axes, not a chain** (R-KM-11): run phase moves `working ⇄ paused`;
`interrupted`/`uncertain` are entered only from `working`; **paused masks interrupted** in the
projection (`application.mjs:6423-6432` checks paused first) — the diagram is two axes with a
stated precedence, and a conformance test written from it must encode that precedence.

### 7.2 Member states

Canonical enum: `pending | idle | working | blocked | paused | interrupted | stopping |
completed | failed | cancelled | stopped`.

Mapping (generated, same discipline; sources: `story.mjs:132-441`,
`coordination-store.mjs:123-130`, `application.mjs:1930-1990`): `idle → idle` (turn finished,
seat alive — not `completed`, R-OP-6); `working → working`; `blocked → blocked`;
`input_required → blocked` + attention `answer_question`; `paused → paused`;
`interrupted → interrupted` (**kept**: interrupt eligibility and preservation receipts key on it
— `application.mjs:1949-1952,1988-1990`; R-OP-6); `stopping → stopping`; `exited` → terminal by
recorded outcome (`completed | failed | cancelled | stopped`); wave `start_failed` → `failed`
(cause `start`).

### 7.3 Attention kinds and responses

Canonical kinds are the **nine live kinds, verbatim** (R-OP-7 — renaming them adds a mapping
for zero gain; v1's six-kind list renamed some, missed three, and invented `capacity`, which has
no emitter and is dropped — reserved for issue #39):

`approve_plan | select_candidate | answer_question | answer_approval | answer_decision |
turn_checkpoint | session_preservation | workflow_revision | workflow_recovery`

Settlement:

| Kind | Settled by | Response |
|---|---|---|
| `answer_question` | `run.answer` | `{text}` |
| `answer_approval` | `run.answer` | `allow \| deny \| cancel` |
| `answer_decision` | `run.answer` | `{option} \| {text}` |
| `turn_checkpoint` | `run.answer` | `continue{text?} \| wait \| settle` — dispatching **exactly** `nudge_turn` / `wait_turn` / `claim_turn` (`application-semantics.mjs:355-380`): `continue` admits a fresh turn; `wait` records the non-consuming receipt and leaves every option open; `settle` re-runs the preserved trust gate (R-KM-4, R-CX-6) |
| `approve_plan` | `run.approve` (bound `do`) | carries `planDigest` |
| `select_candidate` | `run.select` (bound `do`) | carries the minted `roles` choice set |
| `session_preservation` / `workflow_revision` / `workflow_recovery` | their advertised bound `do` (stop/recover/revise family) | as advertised |

---

## 8. The framework

### 8.1 Registry v2 — the single generator

Extend `APPLICATION_SEMANTIC_REGISTRY` to own: nouns, verbs, profiles; one entry per §6
operation with `verb`, `noun`, `effect`, `capabilities`, `profile`, `idempotent`, `destructive`,
**`reconcilable`** (R-OP-8 — so aliases cannot flip a durability class), `emergency`, `input`
schema (with `flagAliases`, H4), `output` view kind, per-surface enablement + derived names +
declared overrides, `aliases` (M-window only), `example` (H8), help topic; the §7 enums with
their generated legacy mappings and the two lifecycle predicates; the error taxonomy (L7); the
`outlineTruthKinds` enum (L10).

**Digest split** (R-OP-11): `authorityDigest` covers schemas/capabilities/effects/enums —
`actionId` freshness (`application.mjs:7313`) and the MCP bridge pin
(`mcp-web-bridge.mjs:172-175`) bind to it alone; `presentationDigest` covers
aliases/help/examples/ordering and may change without invalidating live sessions. Any phase that
changes `authorityDigest` is a **deploy-restart event scheduled at a fleet quiesce point** —
in-flight sessions and cached actionIds do not survive it, by design.

**Named invariant** (R-OP-4): `requiredCapabilities` is always sorted
(`application-semantics.mjs:581-584`); the MCP bridge compares raw order
(`mcp-web-bridge.mjs:156`). The generator must emit sorted lists; a conformance check asserts
it.

### 8.2 Envelope

Every mutation returns the outline view; every read returns the requested depth; every error is
L7-shaped. Idempotency handled inside each client (one discipline). Cursors opaque and
resumable. Serialization order per H10's scope.

### 8.3 Capability projection

`surfaceInventory(principal) = render(filter(registry, principal.capabilities ∪ profile))` with
profiles `ordinary | kernel | authoring | worker | remote_bridge | host`. One computation from
operator surfaces to worker containment (#32). The known conditional-filtering behavior
(`application.mjs:8869-8875`) is a seeded `behavior` ledger row until the projection is
unconditional (R-OP-15e).

### 8.4 Conformance harness

`impl/scripts/surface-audit.mjs` extracts current truth — extended at M0 to cover the full Web
admitted-command set (`COMMAND_CAPABILITY` keys), D8, and complete phase-literal extraction
(R-OP-2, R-OP-5). M0 turns it into contracts (§10) plus the **allowed-divergence ledger**:

- **Bidirectional and append-forbidden** (R-KM-14, R-OP-15d, R-CX-13): at every commit,
  `observed divergences ⊆ ledger` (anything unledgered is red — the novel-divergence guard), and
  the ledger's only legal edit is **removal**; the conformance suite fails on any entry absent
  from the previous commit's ledger appearing again, and on any new entry. Post-M0 additions
  require a spec-version change with red-team approval.
- **Dimensioned** (R-OP-15e): each entry carries `dimension: name | args | schema | behavior |
  enum` and `retiresIn: M1..M5`; seeded `behavior` rows include the conditional capability
  filtering and the per-deployment MCP schema mutation (`mcp-northbound.mjs:826`).
- **M0 harness note**: `impl/src/application.mjs` contains a NUL byte — extraction must read it
  binary-safely (`grep -a` semantics; R-OP scope note).

---

## 9. Migration

Each phase: spec slice → adversarial red-team → red contracts → wave implementation → ledger
shrinks. Suite green at every commit. **Any `authorityDigest`-changing phase lands at a fleet
quiesce point** (R-OP-11).

- **M0 — Harness.** Conformance contracts + the bidirectional ledger seeded from the extended
  audit. No behavior change.
- **M1 — Registry v2 + dispatch-layer aliases + same-surface L2.** Canonical names resolve
  **in a dispatch-layer alias map only** (R-OP-10, R-KM-8, R-CX-9): they do NOT become
  `APPLICATION_COMMAND_DEFINITIONS` keys, do NOT appear in `card().commands`
  (`application.mjs:10668` — `phase64-integrated-run-application.test.mjs` UA5 pins the list),
  and do NOT enter `WEB_APPLICATION_ENTRIES` before M4; every legacy D3 key and flag set stays
  the transport projection verbatim, so parked reconcilable envelopes keep matching their stored
  scope keys. L2 lands **per-surface** (each surface's advertised do executes on that surface);
  legacy spellings marked deprecated.
- **M2 — One vocabulary.** The §7 enums land with their generated mappings; waves/workflow/CLI
  re-report (`wave.mjs:85-86`, `application-cli.mjs:29`, the `closed` deletions incl.
  `application-client.mjs:251`); L3 generalized; L10 matrix contract; C2 re-baselined —
  **the vocabulary flip invalidates outstanding advertised actionIds by design; the fail-closed
  scope-mismatch refusal plus re-read is the intended recovery** (R-KM-15). Cross-surface L2
  outcome-identity begins here (same kind+inputs ⇒ same post-state).
- **M3 — Member + read consolidation.** `run.member.*` canonical; `run.view` gains
  `--role/--generation/--until` and the episode fold lands **with** the axes, the ported
  admission matrix, the `continuation.operation` flip (`run.episode` → `run.view`,
  `phase92-episode-workstream-red.test.mjs:92`), and the browser-desk element-id/bus moves
  (`:167-175`) in the same commit (R-OP-3); `watch` lands; `steer` retires to kernel profile.
- **M4 — Generated surfaces.** CLI table, both MCP profiles, web entries (transport-name
  derivation flips here; parked-envelope reconciliation across the boundary is a named
  conformance case — R-KM-8), embedded facade, CLI.md/MCP.md inventories all render from
  registry v2; hand tables deleted; full four-surface L2/C2; C8 cut here (green-then-red phasing
  resolved by cutting it in its own phase — R-OP-15c); C9 disjointness.
- **M5 — Alias sunset.** Ledger to empty; banned-token lint promoted to red; legacy phase
  strings grep-clean; `run.steer` deleted; GLOSSARY.md updated.

Rollback: aliases are additive until M5; each phase independently shippable and revertible
**for durable state**; live-session invalidation at authorityDigest changes is a stated
operational cost, not a rollback hazard (R-OP-11).

---

## 10. Acceptance contracts

- **C1** (L1): per profile, every registry op × enabled surface resolves under its derived name
  and executes; negative inventory (e.g. board claim/report absent from ordinary MCP,
  `mcp-reflex-board-package-red.test.mjs:213-224`) asserted per profile (R-CX-14).
- **C2** (L2): property test — for N randomized run states, for every advertised action kind,
  each enabled surface re-derives an executable id for the same `{kind, inputs}` and executing
  it yields the same resulting phase, cause, and attention set (excluding cursor and freshness
  fields). Same-surface at M1; cross-surface outcome-identity at M2; four-surface at M4
  (R-OP-1, R-OP-15a).
- **C3** (L4): no surface serializes a phase/member/attention string outside §7; the mapping
  is generated and total over extracted literals (R-OP-5).
- **C4** (L6): banned-token lint generated from §4.1 with token normalization (R-CX-13).
- **C5** (L10): the finite phase × attention × next-action matrix — outline alone answers
  what/why/next for **all nine** attention kinds; cause non-null for non-success terminals only
  (R-CX-10, R-OP-7).
- **C6** (L7): error-shape law over every provokable refusal; leak test that stage/subject never
  carry paths, tokens, or fence coordinates.
- **C7** (L5): every preset run's durable log carries an expansion record naming the preset and
  issued core operations; `waves.start({approve:false})` is a distinct recorded expansion;
  explore/review gain provenance they lack today (R-OP-17).
- **C8** (H10): canonical serialization pin over the scoped surface — cut at M4 (R-OP-15c).
- **C9** (§6.1): derived web transport names disjoint from kernel/authoring literals (R-OP-10).

---

## 11. Honest edges

- **Rename cost is real** and now quantified: the named pinned files
  (`phase64…UA5`, `phase67-run-terminality`, `phase92-episode-*`, `phase12/16/72` inventories,
  `wave.mjs` phase branches, `application-client.mjs:251`) are the M-phase work items, listed in
  their phases above.
- **`actionId` is never durable** — drivers cache `{kind, inputs}` and re-derive; the
  scope-mismatch refusal is the designed recovery, and M2's vocabulary flip exercises it
  fleet-wide (R-KM-15).
- **The episode fold** is the highest-risk M3 item even after the axis repair; the phase92
  attribution/isolation contracts are the acceptance gate, and the fold must land atomically
  with the continuation and desk flips (R-OP-3).
- **Registry-digest churn** is an operational cost at every authority-changing phase; quiesce
  points are scheduling constraints the migration inherits (R-OP-11).
- **Kernel, authoring, worker, and host profiles stay un-unified by design** — the grammar
  covers them as profiles precisely so their boundaries stay enforced, not to erase them.
- This v2 is implementable authority: findings folded, disagreements resolved by code
  verification, and the remaining risk named above. M0 (issue #44) cuts contracts from this
  revision.

---

## Appendix A — mechanical inventory

Regenerate with `node impl/scripts/surface-audit.mjs`. Snapshot at v1: 10 registry operations;
27 actions; 26 command definitions (25 web-flagged **plus ~19 kernel/goal-plan Web literals the
v1 extraction missed** — R-OP-2); 37 CLI verb rows; 38 `fleet_*` + 21 `baton_*` MCP tools; 5
remote-bridge commands (D8); 120 embedded methods; 16+4 phase strings (R-OP-5); seat-synonym
density worker×427 / member×219 / workstream×121 / assignee×26. The M0 audit extension makes
the tool, not this file, the table of record for all of the above.

## Appendix B — red-team fold ledger

All 49 findings dispositioned. **Folded as stated**: R-CX-1 (canonical set closure: +shutdown,
+context.map/reduce/retry, checkpoint settle path, eval address union, search/chunk/coverage as
recorded aliases), R-CX-2/R-KM-2/R-OP-9 (view/watch/wait split: until-condition on view, channels
on watch, run.result row deleted), R-CX-3/R-KM-3/R-OP-3 (episode fold axes + matrix + atomic
flips), R-CX-4 (result_ready + selection states + two predicates; resolved against R-KM's
"clean" by code verification), R-CX-5/R-KM-7 (queued; closed declared dead with named deletions;
start_failed → member state), R-CX-6/R-KM-4/R-OP-7 (attention: one shape not one verb; nine
kinds; three-variant checkpoint response; capacity dropped), R-CX-7/R-KM-6/R-OP-1 (L2
kind-portable/id-local; C2 restated), R-CX-8/R-KM-10/R-OP-14 (structured member address; two
clocks; work sentinel reserved; role:gN banned), R-CX-9/R-KM-8/R-OP-10 (M1 dispatch-layer
aliases only; D3 projection frozen; C9), R-CX-10 (L3 success carve-out), R-CX-11/R-KM-13 (H10
scoped; C8 at M4), R-CX-12 (outlineTruthKinds), R-CX-13/R-KM-14/R-OP-15d (ledger bidirectional,
append-forbidden, generated ban set), R-CX-14 (L1 profile-scoped; worker-profile board ops;
authority fields), R-CX-15/R-KM-5/R-OP-8 (steer = compatibility command; reconcilable a registry
field), R-KM-1/R-OP-2 (deployment.shutdown; authoring profile; D4/D8 audit extension), R-KM-9
(context verbs first-class), R-KM-11 (two axes, paused masks interrupted), R-KM-12 (nine kinds
verbatim; capacity reserved for #39), R-KM-15 (M2 invalidation stated as designed recovery),
R-KM-16 (deployment.view remote scope), R-KM-17/R-OP-17 (L5/C7 re-grounded on driverKind facts;
F8 corrected), R-OP-4 (do as peer; sorted-caps invariant), R-OP-5 (mapping generated + four
missing strings), R-OP-6 (member enum + mapping incl. interrupted/idle/cancelled), R-OP-11
(digest split; quiesce points), R-OP-12 (H4 kebab + flagAliases), R-OP-13 (H5 emergency
carve-out), R-OP-15a (L2/C2 phasing), R-OP-15b (D8 + remote_bridge profile), R-OP-15c (C8
phase), R-OP-15e (dimensioned ledger + seeded behavior rows), R-OP-16 (candidate noun).
**Declined**: none. **Deferred with tracking**: `capacity` attention kind (issue #39's design
lane will mint it with its emitter).
