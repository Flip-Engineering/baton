[attempt: f793be9c-e387-469d-9847-9cd3f4299d0f row-dsh-redteam]
# DSH-REDTEAM — the scope-creep red-team (the rejection rubric, dsh edition)

Row `row-dsh-redteam` of the dsh-comparison foundry (`dsh-comparison-2026-08-13-wave-a`).
Deliverable: the rejection rubric, the pre-computed trap list, and the pre-registered rejections
— plus, because all three comparison row reports were on disk by the time this file was finished
(`../../wt/ws-*/docs/reference/evidence/dsh-comparison-2026-08-13/` per the #174 law), the rubric
applied to each ADOPT/ADAPT they actually made. This row is the wave's conscience: its job is to
make rejection CHEAP and CONFIDENT, so a proposal either names its baton landing zone and its swarm
reading or dies in one line.

Every dsh citation names `dsh-digest/<file>.md` + section/symbol (digest pulled 2026-08-13 — a
dated snapshot of a fast-moving developer preview, per the digest README). Every baton citation
names `impl/src/<module>.mjs` + line or an issue/evidence dir, verified this session with
`grep -an`/`sed -n` (NUL discipline).

---

## 1. THE RUBRIC — how to reject a dsh-shaped proposal in one line

A proposal that reaches the coordinator must survive, in order:

1. **Cite both sides** (foundry law): name the dsh mechanism (digest file + section/symbol) AND
   the baton landing zone (issue number, `impl/src` module, or evidence dir). A proposal with no
   baton landing-zone is decoration — mark OUT-OF-SCOPE yourself.
2. **Name a swarm reading.** Baton's multi-agent primitive is the WAVE (fenced worktrees,
   content-addressed pins, the coordination store). A proposal that only makes sense for ONE live
   agent — per-agent tool scoping for a human's pet session, chat-UI chrome, session titles,
   a per-agent inbox — is OUT-OF-SCOPE unless its swarm reading is named. This is **the
   single-agent trap (a)**.
3. **Name a specific mechanism, not a category.** "Make baton a plugin system" is a rewrite, not
   a rung. Only a proposal that names a specific Cordis-shaped mechanism (a service seam, an event
   mode, a registration disposer) AND the specific baton pain it closes survives. This is **the
   plugin-everything trap (b)**.
4. **Do not trade baton's elegance for dsh's.** Baton's elegance is evidence/pin/harvest honesty:
   an append-only ledger replayed through one deterministic fold, content-addressed pins, receipted
   outcomes. dsh's elegance is boot-composition: a plugin tree where everything is replaceable from
   config. A proposal that trades the second for the first is rejected with the reason named —
   **the framework-envy trap (c)**.
5. **Pass the standing vetoes** (d):
   - **No wall-clock controls.** Anything that introduces a clock, timeout-as-a-control, or
     "check every N ms" is out. Event/seq-ordered delivery only.
   - **Honesty over comfort.** A surface that can lie — conflates "no result" with "empty", records
     a refusal as silence, presents a projection as a fact — is worse than none.
   - **Machine channels stay sterile.** Worker-facing payloads are framed UNTRUSTED; nothing
     persona-shaped, prose-shaped, or model-authored enters stdout JSON, MCP payloads, receipts, or
     the event log.
   - **Additive-only on closed vocabularies.** No closed kind/set/phase/frame literal is amended;
     new behavior adds rows.
   - **No per-worker heaviness.** A mechanism that costs per-agent bookkeeping across a swarm is
     rejected or pushed to the coordinator side. The coordinator composes everything a member sees.
   - **The methodology chain governs impl.** A proposal that bypasses the closed spec → docs → parsed
     → admitted chain (the #159 doc-truth doctrine, #170 DSL) is out.
   - **Imagined-vs-observed cost.** A proposal must cite the observed pain (an issue, an audit
     finding, a landed red pin). "dsh has it and it's nice" is not a cost. If no baton pain is
     named, the proposal is a design idea, not a contract rung.

The rubric is **additive**: it tells you which proposals die, not which proposals the rows should
have made. The rows still own ADOPT/ADAPT/REJECT/ALREADY-HAVE; this row owns the veto vocabulary.

---

## 2. THE TRAP LIST, PRE-COMPUTED — dsh mechanisms that are traps for baton

Read the digest directly; these are the specific mechanisms a dsh-shaped proposal will overvalue,
and the honest baton form of each.

### T1 — The web UI as a center of gravity (baton's surfaces are machine-first)

- **dsh mechanism:** `dsh-web-app` ships as a bundle ("adds the browser application",
  `dsh-digest/architecture.md` §Profiles and bundles); "Add a Web Client Chat node | register a
  `ConversationNodeDefinition` + keyed renderer" and "Generate session titles | register the sole
  `ctx.sessionTitle` provider" are listed as first-class extension points (`architecture.md` §Where
  new behavior goes); raw `assistant/chunk` events exist to preserve "replay and UI fidelity"
  (`dsh-digest/subsystems/session.md` §Session log). The whole harness has a UI surface as a
  peer of the machine surface.
- **Baton side:** baton's surfaces are machine-first by law: the web northbound is an HTTP JSON
  command transport + event stream (`impl/src/web-northbound.mjs` — `application/json` admission,
  the WebEventStream, no HTML), the MCP northbound exposes the same verbs
  (`impl/src/mcp-northbound.mjs`), and stdout is machine-clean. The honest home for visual work is
  the human channel (stderr, help text, HTML report chrome) — the docs/38 framing:
  `docs/38-flip-experience.md` §2 ("Machine output is sacred", "Flair annotates truth; it never
  replaces it", "poses derive from the same projections the machine surfaces expose — the persona
  never invents state"). Issues #115/#133 filed the visual asks; docs/38 is where they are answered.
- **Trap:** a proposal to build "a web UI for baton", "session titles", "chat-UI chrome", or
  "render every event into a dashboard" reads as progress and is dead weight — it adds a human
  surface the swarm does not need, and it risks decorating the machine channel. **Rejection:**
  UI-first proposals are OUT-OF-SCOPE; visual work lives at #115/#133/docs-38, and only as a
  rendering layer over existing projections, never a second source of truth.

### T2 — Profiles/bundles/patches as config sprawl

- **dsh mechanism:** "A **profile** is a named composition... lists the bundles it stacks, holds any
  out-of-tree plugins it installs, and keeps the user's own `cordis.patch.yml`"; a **bundle** is a
  distribution format; layers apply bundle-order → profile patch → home patch → `--patch` overlay;
  "Any row it prints can be replaced by a patch of your own" (`dsh-digest/architecture.md` §Profiles
  and bundles). `dsh --profile web --dump-config` prints the booted tree.
- **Baton side:** baton's deployment is already the thin version: `openBaton({ advanced: { routes,
  verification } })` is the whole declaration (`impl/scripts/resident.deployment.mjs`), and the
  deployment builds `profiles: { default: applicationProfile(...) }` once
  (`impl/src/application-deployment.mjs`), selected per run by `intent.profile`
  (`impl/src/application.mjs:3160` `_profile`, `:3339`). #180 (per-wave profiles) is the open item.
- **Trap:** a proposal to import bundles/patches/"any row replaceable" is config sprawl: it smuggles
  a second configuration dialect past the closed deployment file, and a patch that can replace the
  `verification` row institutionalizes the resident-verifier-`true` gap (#180 becomes a feature).
  The seams row's own counterargument is right: "a patch could *introduce* it." **Rejection:**
  bundles/patches/`--dump-config` wholesale are REJECT; the thin increment is a closed named profile
  map, per-wave selectable (#180), with trust-gate inputs (verification, expectResult) pinned
  non-patchable or patchable-with-audit by deployment-owner authority.

### T3 — Event-mode proliferation (four dispatch modes vs a write-mostly log)

- **dsh mechanism:** every event declares one of four dispatch modes — `emit` (fire-and-forget),
  `waterfall` (delegate-or-short-circuit), `parallel` (all listeners, awaited), `serial` (ordered,
  awaited) — and "the dispatch mode is part of the event's public contract"
  (`dsh-digest/cordis-primer.md` §Dispatch Modes); the generated matrix carries a Mode column on
  every row (`dsh-digest/event-producer-consumer.md`).
- **Baton side:** baton's ledger is write-mostly: ONE append-only `events.jsonl` replayed through a
  single deterministic `_apply` fold (`impl/src/coordination-store.mjs:1492` `_append`, `:7754`
  `_apply`). Events DO have consumers — the fold, cursor waiters (`waitAfter`,
  `coordination-store.mjs:8880`), the run-view/knowledge projections — but no event declares a mode;
  the consumer shape is implicit in the fold's `switch (event.kind)`.
- **Trap:** where does each mode actually pay? `emit` maps to baton's post-commit web feed;
  `await` maps to `waitAfter`; `serial`/`parallel`/`waterfall` dispatch OVER the shared ledger is
  impossible — a `parallel` fan-out or a listener-order-sensitive waterfall would let two histories
  come from one ledger, killing replay honesty for the whole swarm. **Rejection:** a proposal to
  import dispatch modes is REJECT (framework-envy: the fold's determinism is the honest mechanism).
  The narrow ADAPT that survives is the *declaration* only — annotate each kind with its consumer
  mode (fold/observe/await/derive) and generate the producer/consumer matrix, so "where new
  behavior goes" is a checked table instead of a reverse-engineered fold (the arch row's C6).

### T4 — The session-fork romance

- **dsh mechanism:** "Fork a live session | `ctx.sessions.fork(source, boundary?,
  childSessionId?)`" (`dsh-digest/architecture.md` §Where new behavior goes); fork selects source
  events through an inclusive boundary seq, requires the prefix to end outside an open turn, mints a
  live child with lineage metadata, and marks the boundary with `session/end-seed`
  (`dsh-digest/subsystems/session.md` §Live-session fork API, §The end-seed boundary). Fork/resume/
  transcripts/telemetry all derive from the same stream (`architecture.md` §Session log).
- **Baton side:** #59 re-drive continuity transfers a dead attempt's scratchpad projection +
  checkpoint-pin digest list + terminal cause + refusal evidence into the next attempt's objective,
  untrusted-framed — never a live session fork; the worker harness owns the live session
  (`docs/reference/evidence/redrive-continuity-2026-08-07/redrive-continuity-contract.md`).
- **Trap:** the romance is that forking "carries over" the model state — what actually carries over
  in baton is a closed, content-addressed content set (pins + evidence), and THAT is the honest
  answer to "which is honest about what carries over?" A proposal that forks live model state, or
  claims the child "keeps" the parent's open context, is REJECT: the kernel has no live sessions to
  fork (the harness owns them), and a per-agent fork would fragment the shared record. What SURVIVES
  is #59's shape with the boundary made explicit and verified (reject a carry-forward from a live or
  unrelated attempt, never silent), the carried content treated as seed history, not this attempt's
  work, and the lineage recorded durably — the `session/end-seed` discipline as a re-drive law, not
  a fork primitive.

### T5 — The plugin-everything lure (the framework is the poison, the seams are the vitamin)

- **dsh mechanism:** "Every part of the product is a plugin, including the model adapter, the tool
  registry, the session log, and the agent loop itself, so every part is replaceable from
  configuration"; "There is no privileged core to patch"
  (`dsh-digest/architecture.md` §Cordis). The seam catalog enforces a Definition/Provider/Consumer
  triple per capability (`dsh-digest/capability-seams.md` — `ctx.fs`, `ctx.shell`, `ctx.subprocess`,
  `ctx.lsp`, `ctx.subagents`, `ctx.sandbox`, …).
- **Baton side:** baton's kernel has a privileged core BY DESIGN: one coordination store, one fold,
  a closed kind registry with fail-closed `_apply` on unknown kinds, and the doc-truth gate (#159)
  admitting new kinds only through an `_apply` row. Baton's swappable units are the harness adapter
  registry (`impl/src/adapter.mjs` + `cli-adapters.mjs`) and the capability cards
  (`impl/src/capability-registry.mjs`), not "every row of the kernel".
- **Trap:** a proposal framed as "make baton a plugin system", "replaceable-from-config", or "no
  privileged core" is a rewrite, not a rung. **Rejection:** the category dies; only a proposal that
  names ONE specific seam-shaped mechanism with ONE named baton pain survives — e.g. the adapter
  Definition role being implicit (the seams row's C1), the pre-execute gate hole #176 (C3), or a
  delegated-turn adapter tier (C2). Those are additive; the framework is not.

### T6 — The single-agent shape (dsh's primitives are per-agent, baton's are per-wave)

- **dsh mechanism:** the inbox is per-agent — "The inbox is the delivery vocabulary — two ordered
  pending-message lists the agent owns" (`dsh-digest/subsystems/core.md` §The inbox);
  `agent.inject()` lands context in the NEXT admitted request of ONE agent
  (`dsh-digest/architecture.md` §Where new behavior goes); scoped registration is per-agent —
  `agent.ctx` ("agent-scoped context; its contributions are agent-local, unwind on disposal",
  `subsystems/core.md`; the Scope primitive keys an opaque object identity,
  `dsh-digest/subsystems/scope.md`); subagents are children of ONE parent (followup authorized by
  "the durable child's direct parent", `subsystems/subagent.md`).
- **Baton side:** the wave IS the swarm primitive: members are fenced worktrees with content-
  addressed pins; a member's "mailbox" is its `task.*` object in the shared ledger
  (`task.created` → `task.claimed` → `task.settled`); the member's capability surface is fixed —
  roles map to permission subsets (executor-class `{read,claim,report}`, coordinator-worker
  `{read}`, `impl/src/coordinator.mjs:82-85`) and the wave scope field restricts touched paths.
- **Trap:** a proposal shaped as a per-agent mechanism — a member-minted tool registry, a per-worker
  inbox, per-agent context injection with wake/no-wake semantics INSIDE the worker harness — is
  per-worker heaviness AND invisible to the coordinator. **Rejection:** OUT-OF-SCOPE unless the
  swarm reading is named and the landing zone is the shared store or the deployment seam. The honest
  forms are already named by the rows: the run-scoped message lane, coordinator-composed context
  packs, wave-role permission subsets.

---

## 3. THE PRE-REGISTERED REJECTIONS — proposals this row EXPECTS and would reject

Pre-written so rejection is cheap; each names the dsh mechanism and the reason. Where a row report
survived or died differently, §4 records it.

| # | Expected proposal | dsh mechanism | Rejection (one line + the trap) |
|---|---|---|---|
| R1 | "Build the baton web UI / add session titles / render a chat surface" | `dsh-web-app` bundle; `ctx.sessionTitle`; `ConversationNodeDefinition` (architecture.md §Profiles, §Where new behavior goes) | **OUT-OF-SCOPE** — baton's surfaces are machine-first; visual work lives at #115/#133/docs-38 and only as a rendering layer over existing projections (T1). |
| R2 | "Adopt profiles/bundles/patches — any row replaceable" | architecture.md §Profiles and bundles | **REJECT** — config sprawl; a patch that can replace `verification` institutionalizes #180 (T2). |
| R3 | "Add the four dispatch modes to the event log" | cordis-primer.md §Dispatch Modes | **REJECT** — a `parallel`/`waterfall` dispatch over the shared ledger breaks fold determinism; replay honesty dies for the whole swarm (T3). |
| R4 | "Fork a live session so a worker resumes with its context intact" | `ctx.sessions.fork` (session.md §Live-session fork API) | **REJECT** — session-fork romance; the kernel has no live sessions, and what honestly carries over is #59's content-addressed content set, not model state (T4). |
| R5 | "Make baton a plugin system — everything replaceable from config" | architecture.md §Cordis | **REJECT** — plugin-everything; a rewrite, not a rung; no baton pain named (T5). |
| R6 | "Give each member its own tool registry / per-agent inbox / per-agent context injection" | `agent.ctx` (scope.md); per-agent inbox (core.md); `agent.inject()` (architecture.md) | **OUT-OF-SCOPE** — single-agent trap; per-worker heaviness; the coordinator can't reason about a capability a member minted for itself (T6). |
| R7 | "Import the pre-step waterfall so a policy can rewrite what a member sees" | `agent/pre-step` waterfall (agent-lifecycle.md) | **REJECT as a content-rewrite seam** — the coordinator has no hook inside a worker's harness prompt assembly; building one is per-worker heaviness. What survives is next-request composition + a receipted refusal (T6/T3). |
| R8 | "Add a wall-clock progress check / idle timer like dsh's time-context" | `time-context` listener (event-producer-consumer.md) | **REJECT** — standing veto: no wall-clock controls (d). |
| R9 | "Import the web gateway / chat session lifecycle as a first-class product surface" | `dsh-web-app`, chat nodes (architecture.md) | **REJECT** — the same as R1 at a larger scale; a second human surface the swarm doesn't need. |
| R10 | "Add an event-mode catalog AND a runtime dispatcher that obeys it" | cordis-primer.md §Dispatch Modes | **REJECT the dispatcher half** — the catalog/declaration is the narrow ADAPT (T3); the runtime dispatch is the framework-envy half. |

---

## 4. THE RUBRIC APPLIED — the on-disk row reports (they landed before this file finished)

All three comparison reports exist at `../../wt/ws-*/docs/reference/evidence/dsh-comparison-2026-08-13/`
(dsh-arch.md, dsh-lifecycle.md, dsh-seams.md). Per the #174 law this row verifies on disk rather
than trusting its own projection; the coordinator's `dsh-qa.md` is also on disk but was written
before any row report landed (it says so itself) — its §5 rubric application ran against the
briefs' enumerated candidates, not the rows. This section applies the rubric to the rows'
actual ADOPT/ADAPT set.

### 4.1 dsh-arch.md — every candidate survives, none rejected-by-rubric

| # | Candidate | Verdict | Rubric outcome |
|---|---|---|---|
| C1 | "Model-visible means logged" as a dispatch-seam invariant (`brief.served` digest-head + dev-invariant) | ADAPT | **SURVIVES** — honesty *strengthened*, swarm reading named (any member's exact context reconstructable from the shared ledger). Additive: one new durable kind, no closed kind amended. Caveat (from the QA row): the invariant must assert "reconstructable *via* the cited spill artifact," never that the body is inline — the spill keeps bodies out of the log by design (`impl/src/limits.mjs`). |
| C2 | Waterfall interception as policy | REJECT (kernel) + ADAPT (short-circuit decision at `_authorize`) | **SURVIVES** — the REJECT half is the rubric's own (T3/T5); the ADAPT lands a named-capability refusal at the existing gate, additive. |
| C3 | Reversible-effects disposer discipline | ADAPT (#177 recorded lease recovery) | **SURVIVES** — honesty (a recorded `writer.lease_recovered` replaces a silent `unlinkSync`); no new framework; the fence is the swarm's disposer. |
| C4 | Profiles/bundles/patches | ADAPT (per-wave profile #180 + read-only composed-config surface; bundles/patches explicitly NOT adopted) | **SURVIVES** (narrow) — the row already applies T2; the increment is a closed named map in the deployment file. Pin: the composed-config reader must be a pure fold over the deployment file (no second dialect), else it becomes the sprawl it names. |
| C5 | `sessions.fork` | ADAPT (#59 re-drive boundary pinning; live fork explicitly out of reach) | **SURVIVES** — the row is not fork-romance; it pins #59's explicit-boundary rejection + seed-history framing + durable lineage, which is T4's honest form. |
| C6 | Four dispatch modes as a typed contract | ADAPT (per-kind consumer-mode declaration + generated matrix; dispatch REJECT) | **SURVIVES** (narrow) — declaration only, fold determinism untouched; this is T3's narrow ADAPT. |
| C7–C12 | Merge-extensible vocab / three domains / derived projection / discriminated union / durability / idempotency | ALREADY-HAVE (+ one ADAPT in C9) | **SURVIVES** — no new mechanism; C9's never-bare-`'empty'` render is an honesty fix. |
| C13 | Per-agent inbox | REJECT (per-worker) + ALREADY-HAVE (wave `task.*` stream) | **SURVIVES** — the single-agent trap (T6) applied correctly. |

### 4.2 dsh-lifecycle.md — every candidate survives, none rejected-by-rubric

| # | Candidate | Verdict | Rubric outcome |
|---|---|---|---|
| C1 | `agent.inject()` as the mid-flight context lane | ADAPT (`run.context.materialize` facade + no-wake delivery law) | **SURVIVES** — swarm reading named (coordinator-composed context packs over the BD3-B kernel lane); lands on the facade seam, additive, no clock. |
| C2 | `agent/pre-step` interception | REJECT (content rewrite) + ALREADY-HAVE (next-request composition) + ADAPT (steer-refusal receipt) | **SURVIVES** — the REJECT half is the rubric's own (T6/T3); the refusal-receipt ADAPT is honesty (a refused steer is durable, never a silent drop). |
| C3 | Durable no-step turn | ADAPT (`lifecycle.turn_attempted`, REARM_KINDS unchanged) | **SURVIVES** — pure honesty (an empty member ≠ a dead member); additive; not fork-romance and not a mode proliferation. |
| C4 | Per-agent scoped registration | REJECT (mechanism) + ALREADY-HAVE (wave-level scoping) | **SURVIVES** — T6 applied; the only surviving reading is #147 profile composition, never a member-minted registry. |
| C5 | Agent-handle cancel/recovery | ADAPT (#182 death certificates + keepInbox policy) | **SURVIVES** — the durable *why* of a stop is replay-derived; additive on the existing terminal record. |
| C6 | Model-visible-means-logged | ALREADY-HAVE (UNTRUSTED framing) + ADAPT (stated "worker-visible means receipted" invariant) | **SURVIVES** — honesty declaration, no mechanism change. |
| C7 | Single-agent trap (LAW-6) | ALREADY-HAVE (binding constraint) | **SURVIVES** — this is the rubric, restated as a row law. |

### 4.3 dsh-seams.md — one candidate flagged, none rejected outright

| # | Candidate | Verdict | Rubric outcome |
|---|---|---|---|
| C1 | Seam-triple naming discipline | ADAPT (Definition role made explicit on capability cards + adapter contract) | **SURVIVES** — the plugin-everything trap (T5) is avoided by naming only the Definition role as missing; no re-architecture. |
| C2 | Subagent-behind-one-interface / delegated turn in another product | ADAPT (session-adapter tier via resume/attach-only + honest `card()` + typed pre-check) | **SURVIVES** — additive on the adapter contract; the honest-card + fail-loud pre-check pins prevent accept-then-degrade. Flag: this is the candidate most at risk of ballooning into a remote-agent protocol; it must stay one adapter tier behind the existing contract, never a new delegation framework. |
| C3 | Guarded tool pipeline | ADAPT (monotonicity ALREADY-HAVE; fix #176's shared dispatch point) | **SURVIVES** — closes a named, observed hole (#176), not a new mechanism. |
| C4 | Config-patch composition | ADAPT (profiles-as-layers, operator authority) + REJECT (patch-overlay on trust-gate inputs) | **SURVIVES** (narrow) — the row already applies T2; the trust-gate pins (verification, expectResult non-patchable or audited) are exactly the right line. |
| C5 | LSP through the fs/subprocess seam | ADAPT (declare the pool's substrate seam on the #144 card); remote topology REJECT today | **SURVIVES** (narrow, deferred) — the remote move is REJECT (no remote execution world); the substrate declaration is one card field, honest. |
| C6 | Dormant provider directory | ADOPT | **SURVIVES-WITH-A-RED-FLAG** — additive and honest (`{state:'dormant'}`, never admitted), but no observed baton pain is cited (no issue, no audit finding). Under the imagined-vs-observed veto it is a design idea, not a contract rung; it needs a named pain before landing. |
| C7 | Atomic route replacement | ADAPT (validated `replace` on the deployment route set) | **SURVIVES** — a credential-expired/dead-vendor route requiring a restart IS an observed pain; the liveness re-probe gate keeps it honest. |

### 4.4 Reconciliation with the coordinator's `dsh-qa.md`

The QA's §5 REJECTs (A3 waterfall middleware, A5 profiles/bundles, A6 sessions.fork) are REJECTs of
the RAW dsh mechanisms — and the rows' narrow ADAPTs (arch C2/C4/C5) survive precisely because they
avoid the raw mechanism. The two are consistent, not contradictory. The QA's A1/L1/L3/S1/S3 ADOPTs
all survive this rubric. The QA's L4 (member profile ADAPT-as-#147) and lifecycle C4
(REJECT-mechanism, ALREADY-HAVE-wave-scoping) point at the same #147 increment from two angles. The
one rubric correction to the QA: its A1 caveat (the invariant must cite the spill artifact, never
claim the body is inline) is the load-bearing honesty pin on the #1 adoption — without it the
invariant would assert something the ledger cannot hold.

---

## 5. REFUSAL VOCABULARY / RED-FIRST PINS

The refusal vocabulary of this row (what a coordinator can cite when rejecting):

- **`out_of_scope_single_agent`** — the proposal only makes sense for one live agent (T6).
- **`out_of_scope_ui_first`** — a human surface the swarm doesn't need; visual work → #115/#133/docs-38 (T1).
- **`rewrite_plugin_everything`** — a framework adoption framed as a category, no named mechanism + pain (T5).
- **`config_sprawl`** — bundles/patches/any-row-replaceable (T2).
- **`fold_determinism_violation`** — a dispatch mode that would let one ledger produce two histories (T3).
- **`session_fork_romance`** — forking live model state; #59's content-addressed carry is the honest form (T4).
- **`unpinned_imagination`** — no observed baton pain cited (T6 → imagined-vs-observed).

Red-first at the current HEAD (each is RED — the green landing is named in §2/§4, not shipped here):

- **P1 RED** — no `brief.served`-class reconstruction head; the served knowledge slice is not pinned
  (`impl/src/coordinator.mjs` `serveKnowledge`; the arch row's C1 landing).
- **P2 RED** — #177 silent writer-lease recovery (no `writer.lease_recovered` record); the C3 landing.
- **P3 RED** — no per-wave profile (#180); the deployment file is a single `default` map (C4 landing).
- **P4 RED** — no typed per-kind consumer-mode declaration; the fold's consumer map is implicit (C6 landing).
- **P5 RED** — a member cannot publish to the `shared` scratchpad partition: `writeScratchpad`
  hardcodes `const scope = \`worker:${fields.workerId}\`` (`impl/src/coordination-store.mjs:14103`);
  the shared publish lane is closed to members (the #158 gap; recorded in §7).
- **P6 RED** — no durable no-step turn; an empty member and a dead member read identically to the
  #67 evidence gate (`lifecycle.turn_attempted` absent).
- **P7 RED** — the #176 pre-gate dispatch order stands (the eight facade direct ports at
  `impl/src/application.mjs:12514-12521` return before `normalizeCommandContext` at `:12522` and
  before the recursive-session gate in the ordinary path — `authorizeReplay`'s
  `context?.sessionAuthority` check → `_authorizeRecursiveCommand` at `:3330-3340`; the block's own
  comment at `:12513` and `:12539-12540` admits the pre-gate dispatch, and the run-orchestrator
  lease holder is deliberately admitted pre-gate as review authority, FP-18).
- **P8 RED** — the #144 LSP pool's execution substrate is undeclared on its card.

---

## 6. JUDGMENT CALLS AND OPEN QUESTIONS

- **J1 — this row does NOT issue ADOPT/ADAPT verdicts.** The rubric is a veto vocabulary, not a
  candidate table; where this file says "SURVIVES" it means "survives the rubric", and the row still
  owns its verdict. No authority-class ambiguity encountered; no DECISION_REQUEST required.
- **J2 — the QA row applied "the red-team rubric" before this file existed.** Its §5 tracked the
  brief's trap list correctly (a/b/c + standard vetoes); this file confirms that shape and adds T1–T6
  as the pre-computed mechanism-level traps. The QA's A1 caveat is adopted as a hard pin (§4.4).
- **OQ1 — `brief.served`: digest-head or full snapshot?** The arch row recommends digest-head +
  dev-invariant; the QA's #1 adoption wants "reconstructable via the cited spill artifact." This row
  agrees with digest-head — a full snapshot risks echoing model-authored content into the machine
  channel (veto: machine channels stay sterile) and is heavier. The coordinator may want the full
  snapshot for #146 telemetry; that is a #146 call, not a rubric call.
- **OQ2 — the seams C6 dormant-provider flag.** Whether it lands depends on a named observed pain
  (does a coordinator need to see unactivated routes today?). The rubric's answer: not without one.

---

## 7. SHARED PUBLISH — RECORDED REFUSAL (evidence, #158)

Per the foundry law ("Publish to `shared` when complete — or record the exact refusal"), the shared
scratchpad partition is not reachable from this seat: `writeScratchpad` hardcodes the worker scope
(`impl/src/coordination-store.mjs:14103`), and no scratchpad-write surface is advertised to this
worker (the row briefs name `shared` as the publish target, but the kernel admits only
`worker:<id>`). The durable artifact is this file at
`docs/reference/evidence/dsh-comparison-2026-08-13/dsh-redteam.md`, harvestable from the main repo
post-harvest (#174). The refusal is the record; the full text is the deliverable.

---

## 8. SOURCES

- dsh ground truth: `docs/reference/evidence/dsh-comparison-2026-08-13/dsh-digest/`
  (`architecture.md`, `cordis-primer.md`, `agent-lifecycle.md`, `event-producer-consumer.md`,
  `capability-seams.md`, `tool-execution-pipeline.md`,
  `subsystems/{core,session,scope,subagent,tools,llm-streaming}.md`).
- Row reports (applied in §4): `dsh-arch.md` (ws-0a253a8…), `dsh-lifecycle.md` (ws-b7dd9de…),
  `dsh-seams.md` (ws-a85eec6… — first pass §4.3, second pass §9.2 after it was extended on disk),
  `dsh-qa.md` (ws-59ce85b…) — each at
  `docs/reference/evidence/dsh-comparison-2026-08-13/`.
- Baton kernel: `impl/src/coordination-store.mjs` (`_append` :1492, `_apply` :7754, `waitAfter`
  :8880, `writeScratchpad` :14064/:14103), `impl/src/coordinator.mjs` (`REARM_KINDS` :71,
  role subsets :82-85), `impl/src/application.mjs` (`_profile` :3160, `intent.profile` :3339,
  facade gate block :12502-12532), `impl/src/web-northbound.mjs`, `impl/src/adapter.mjs`,
  `impl/src/capability-registry.mjs`, `impl/scripts/resident.deployment.mjs`.
- Baton issues/evidence: #59 `redrive-continuity-2026-08-07/`, #158 (shared-publish gap),
  #159/#170 doc-truth + DSL, #180 per-wave profiles, #176 pre-gate hole, #177 silent lease recovery,
  #182 death certificates, #146 fleet telemetry, #115/#133 + `docs/38-flip-experience.md` (visual
  work's honest home), #67 watchdog, #79 delivery push, #71 orchestrator wake, #164 fail-loud waits.
- Laws: the dsh-comparison `foundry-brief.md` (#171 attempt-echo; the standing vetoes; cite-both-
  sides; publish-or-refuse), the #174 on-disk verification law.

---

## 9. CONTINUATION — the seams row grew a second pass; this row verifies and applies

The seams row (`ws-a85eec6…/dsh-seams.md`) was extended after this row's first pass — it now
carries a "Continuation — second pass" (C2A + C8–C12) and was finalized 13:29:15, three seconds
after this row's first-pass file (13:29:12). Per the #174 law this row verifies the full file on
disk as it now stands, and applies the rubric to the additions.

### 9.1 Recorded citation correction (the seams #176 lines are stale)

The seams file cites the #176 pre-gate hole as "`application.mjs:12502-12516` … vs `:12527-12532`"
(GT3, C3, P3). Both numbers are stale. Verified this session:
the eight facade direct ports are at **`:12514-12521`**; the recursive-session gate is the
`context?.sessionAuthority` → `_authorizeRecursiveCommand` check in the ordinary path
(`authorizeReplay`, **`:3330-3340`**). The **substance holds** — the block's own comments admit it
(`:12513` "Dispatched here — BEFORE … the recursive-session gate"; `:12539-12540` "dispatched here
BEFORE the recursive-session gate") — only the numbers are wrong. This row corrected the same stale
numbers in its own P7 (§5) and records the seam's version as the same defect.

### 9.2 Rubric application to the second pass

| # | Candidate | dsh mechanism | baton target | Verdict | Rubric outcome |
|---|---|---|---|---|---|
| C2A | ACP provider correspondence | `subagent-acp` spawns through `ctx.subprocess` (`capability-seams.md:447,458`) | `grok-acp.mjs`, `kimi-acp.mjs` D1 session adapters, `acp-json-rpc-process.mjs` (verified on disk) | ALREADY-HAVE (grok/kimi) + ADAPT (omp card, typed pre-check before `spawn()`) | **SURVIVES** — the ALREADY-HAVE claim is accurate; the ADAPT is additive and honesty-strengthening (typed refusal before spawn, never accept-then-degrade). Single-agent trap passes: the ACP tier's meaning is a uniform fleet turn lifecycle. |
| C8 | Continuable sessions / followup routing | one durable child Session + decision table over Activation state (running→enqueue, waiting→wake, none→cold-resume) (`subagent.md:132-134`) | `session-recovery-supervisor.mjs` (verified on disk) | ADAPT (explicit followup-routing decision on the recovery path) | **SURVIVES-WITH-PIN** — deterministic decision table, no clock; the row itself checks the no-wall-clock veto (its `timeoutMs` is a bounded-scan bound, agreed). Coordinator-owned → no per-worker heaviness. Pin: "resume from persisted state" must stay content-addressed + untrusted-framed per #59 — a cold-resume is a re-drive, never a live-state fork (same line as arch C5 / lifecycle C5). |
| C9 | Canonical output declaration + content-verified probe | mandatory canonical `output` on every ToolDefinition; registry `schemas()` allowlist (`tools.md:11,28`) | `route-liveness.mjs:186,238,330` — `expectedLine = \`${route.model}-probe ok\``, ≤2KiB capture, exact compare, `verify.reverified` evidence (verified) | ALREADY-HAVE (liveness) + ADAPT (capability cards declare canonical output) | **SURVIVES** — the probe IS an output declaration + independent verification; the ADAPT (declared output on capability-plane ops cards so a referee can verify an op like liveness verifies a route) is additive and honesty-strengthening; a canonical output is a declared shape, not model-authored prose (machine-channels-sterile holds). |
| C10 | Scope-aware shadowing | `agent.ctx` scoped registrations shadow globals; `ToolRestriction` per scope (`tools.md`) | `restrictingReadAuthorize` (read-scope law ALREADY-HAVE); capability-plane registry | ADAPT (a scoped capability set GRANTED to a member, global registry untouched) | **SURVIVES-WITH-CAUTION** — this is the single-agent trap's danger zone: dsh's `agent.ctx` shadowing is agent-OWNED (the agent mints its own scope), which is the trap. The seams ADAPT is the different shape: coordinator-GRANTED, deployment-owner-granted, a permission projection like the wave-role subsets, "never per-worker-heavy." That survives. Boundary pin: the grant must stay a coordinator-side permission projection; if a later version lets a member mint its own shadow, it becomes the trap. The row already draws this line; this row records it as the boundary. |
| C11 | Adapter error contract | one adapter call = one provider attempt; two sanctioned error paths; empty completion is retryable (`llm-streaming.md:208-212`) | typed-code/blocking refusals (`route-liveness.mjs:203-213` class) | ALREADY-HAVE | **SURVIVES** — pure correspondence record; nothing to adopt, no veto exposure. |
| C12 | The skills seam | `ctx.skills` seam (Definition `skill` / Providers `skill-badge`,`skill-filesystem` / Consumer `tool-skill`) (`capability-seams.md:441`) | none | OUT-OF-SCOPE (no landing zone) | **SURVIVES-AS-REJECTED** — the rubric's step 1 (name a baton landing zone) rejects it; instruction/skill loading is the harness's job. Consistent with T5/T6: a framework mechanism with no named baton pain. |

No second-pass candidate violates a standing veto. The row applied the single-agent-trap law to
itself (its GT7, its C2A/C8–C11 swarm readings); this row confirms each reading is a fleet property
and not a lone-agent convenience. The one judgment worth recording is C10: it survives ONLY in the
coordinator-granted reading, which is exactly where dsh's agent-owned shadowing would have failed.

### 9.3 New traps mined on this pass — two the rows did not flag as traps

- **T7 — the delta-streaming event kind.** dsh streams per-delta events over the closed
  `StreamChunk` union — `text-delta`, `reasoning-delta`, `tool-call-delta` with `argumentsDelta`,
  with `block-end` carrying the fully-assembled `ContentBlock` (`llm-streaming.md:154-176`). The
  delta events exist to serve streaming UI fidelity — a human-surface concern. Trap: importing
  per-token delta events into baton's ledger is log explosion for a surface the swarm doesn't read.
  Baton's write-mostly log pins the terminal outcome (content-addressed), never the stream. The
  honest forms are ALREADY-HAVE: baton's closed kind vocabulary IS the "closed union + assertNever"
  disposition (`_apply` fail-closed on unknown kinds, `coordination-store.mjs`), and the
  fully-assembled block maps to the content-addressed pin. **REJECT** delta streaming into the
  ledger — no landing zone. (The `streamIdleTimeoutMs` stall watchdog at `llm-streaming.md:212` is
  a transport bound on a streaming surface baton does not have; nothing to adopt.)
- **T8 — the full-request echo.** dsh logs a FULL `request/header` snapshot — the whole request
  envelope including the rendered system prompt and assembled tool schemas, reason `initial`/
  `resume`/`change`, reconstructed by `foldRequestHeader` — so "every conversation request is a
  pure function of the log" (`session.md:154-161`, the reconstruction Agent Note). Trap: importing
  full-snapshot echo into baton's ledger pulls model-authored content (the rendered prompt) into
  the machine channel — a machine-channels-sterile violation — and it is the seductive half of
  dsh's "reconstructability at any cost" story. Baton's honest form is the digest-head + pinned
  evidence (arch C1's `brief.served`; this row's OQ1): reconstruct the OUTCOME from evidence, never
  echo the PROMPT into the log. **REJECT** the full-request echo; #59's content-addressed carry is
  the honest reconstruction. Note the dsh discipline that DOES map: dsh itself rejects the legacy
  `request/header-delta` event at seed/append/persistence-load boundaries (`session.md:176`) —
  baton's fail-closed `_apply` on unknown kinds is the same disposition, ALREADY-HAVE.

### 9.4 Red-first pins added by this application (RED at current HEAD)

- **P9 RED** — capability-plane ops cards carry no canonical output declaration; only the liveness
  tier declares (and verifies) a canonical output (C9 ADAPT).
- **P10 RED** — no coordinator-granted per-member op shadow; the capability registry is
  deployment-wide only (C10 ADAPT).
- **P11 RED** — followup routing is not an explicit coordinator decision on the recovery path; an
  interrupted turn is not cold-resumed from a routing table (C8 ADAPT).
- **P12 RED** — the seams report's #176 gate citation is stale (recorded: direct ports
  `:12514-12521`, recursive-session gate at `:3330-3340` in `authorizeReplay`; §9.1).

### 9.5 Shared-publish refusal — re-recorded with first-party evidence

This pass independently verified the §7 refusal: `run.scratchpad.write` has **no match anywhere in
`impl/src/application.mjs`** (`grep -a`, exit 1); the worker-facing scratchpad WRITE surface does
not exist on this seat's control surface. The seams row reached the same refusal independently
(its second pass cites `mcp-northbound.mjs:111-115` exposing only scratchpad_read/elevate). Exact
refusal stands: **I cannot publish to the `shared` partition; the scratchpad write surface is not
advertised to this worker.** The deliverable remains this evidence file, harvestable post-harvest
(#174).
