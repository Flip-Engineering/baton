# Doc 32 — Reflexive orchestration: decision channels, task boards, knowledge hand-off, REPL objects

*Status: design note (2026-07-21). Tracks REFLEX-1..4 (see §6 and the issue list). Aligns with
doc 31 (Wave surface), issue #9 (Program v1), issue #10 (AX spine), issue #12 (nested
orchestration), and the permanent constraints of `spec/phase93-closed-program-ir.md` §93.1
(no arbitrary runtime/kernel, no worker-to-worker messaging, untrusted worker output).*

The orchestration loop must be reflexive in both directions. Down: the orchestrator shapes work
(briefs, nudges, steers, boards, packages). Up: workers shape the orchestrator's decisions
(progress, results — and **typed decision requests** the orchestrator must settle before the
worker proceeds). Around: shared and individual knowledge (task boards, hand-off packages, REPL
objects) that both sides read and write under one authority. This doc inventories what exists,
names the four gaps precisely, and designs each closure under Baton's rules: the coordinator is
plain code and authoritative; worker content is untrusted; every interaction is durable,
fenced, replay-exact, and single-consumer where it is a decision.

## 1. Current truth inventory

### 1.1 Worker → orchestrator

- **Free-text questions.** `createAsk` (`impl/src/messages.mjs`) with a `blocking` flag. Adapters
  emit `question.asked` (e.g. `claude-session.mjs:850`, MockAdapter `ask.kind:'question'`);
  the coordinator creates a single-consumer pending record, the task moves to `input_required`,
  and `run.answer` → `coordinator.respond(requestId, …)` → `adapter.answer` settles it
  (`approval.resolved`/`question.answered` flow). Answer-exactly-once is enforced (first answer
  wins; the other principal is told "already handled").
- **Approval requests.** `approval.requested` with the same single-consumer settlement;
  `approve()` and `answer()` are deliberately distinct (`adapter.mjs` D1).
- **Results and events.** Untrusted by shape; the trust gate re-runs verification; provider text
  is never trusted as fact (`wrapFact`/`wrapProse`).
- **Attention.** RunView `attention[]` + `_progressTiming`; a pending question/approval holds the
  run at `input_required` — but the ordinary surface only *names* the state; it does not yet
  project the pending question's content or a typed option set (see §2.1).

### 1.2 Orchestrator → worker

- **Brief** (delegation contract with pinned done-command), **nudge** (next natural pause),
  **steer** (redirect now), all fenced (`fence.mjs`: issue/check/bumpTurn/bumpHuman) with
  per-worker ordered delivery (`coordinator._send` send-chain, stale rejection at pre- and
  post-delivery, `control.delivery_amended` loud on stale-after-delivery).
- **Orientation push** (`coordinator.orientWorker`): hub-computed Cartographer/Atlas slice
  delivered as a fenced nudge (`knowledge.map_served`).
- **Wave-level controls** (doc 31): role-addressed `send`, selective `stopMember`, per-member
  approval, and evidence records — orchestrator-side composition over the same commands.

### 1.3 Shared state and knowledge

- **Scratch (kernel only).** `postScratchFact`, `claimScratch`, `expireScratchClaim`,
  `readScratch` (`coordination-store.mjs:11552-11640`; coordinator wrappers at
  `coordinator.mjs:8833-8877`; `spawnScratchOracle` for independent verification of a fact).
  Events `scratch.fact_posted/fact_expired/claimed/claim_expired/read`. **Not on the ordinary
  surface** — no `run.act`/CLI/MCP access path today.
- **Task structure.** Goal/Plan nodes form a coordinator-internal DAG (dispatch, dependencies,
  budgets). It is not a worker-visible board: workers never read it, never claim from it, and
  the orchestrator edits it only through successor Plan versions.
- **Cairn (project-persistent).** Decisions/findings/RouteStats, bounded recall, selective
  promotion, contradiction workspace + prefix-CAS resolution, Scratch correction via independent
  oracle (Phases 47–53), reached through the ACI capability registry — again not an ordinary
  run-scoped surface.
- **Context/memory carriers.** `ContextManifest` (immutable tree + named branches, currently
  only `repository` produced), Context cells (content-addressed pure evaluations, closed op
  set), Program-IR `ValueRef`s, and the artifact CAS. Passing "a body of context" today means
  authoring a manifest + artifacts and citing their digests in a brief.

### 1.4 REPL layer

- **The Bench** (`context-program.mjs`): closed pure Context programs over manifests/artifacts —
  `source outline index search slice chunk filter project sort unique join collect coverage finish`.
  Context actions (`context_eval/search/chunk/coverage/map/reduce/retry`) advertise **only on
  Workflow runs** (`application.mjs:7116-7128`), so orchestrator-side REPL use requires a
  Workflow to exist. No arbitrary scripting — permanent constraint (§93.1(1)).

## 2. The four gaps

**G1 — No typed decision channel up.** A worker can ask a free-text question, but cannot pose a
*decision*: a bounded option set (multi-choice) with an explicit free-response escape, which the
orchestrator must settle exactly once before work continues. Today the answer is free text the
worker must interpret — uncheckable, ungated, and invisible in the RunView beyond a phase name.

**G2 — No orchestrator-controlled task boards.** No shared or per-worker durable task list the
orchestrator owns and workers consume: read slices, claim items, report transitions. Goal/Plan
is the wrong tool for this (it is dispatch topology, not a board), and Scratch is kernel-only.

**G3 — No first-class knowledge/context hand-off object.** "Pass this entire body of
context/memory to that worker / to the shared layer" is currently hand-assembled (manifest +
artifacts + digests in a brief). There is no typed, immutable, replay-safe package an
orchestrator can admit once and attach to runs or boards.

**G4 — REPL objects are workflow-gated and under-used.** The Bench only exists on Workflow
runs, and there is no documented pattern for the orchestrator to compute REPL objects
(partition manifests, orientation slices, digests) and pass them *through* boards/packages to
workers as ordinary hand-offs.

## 3. Designs

### 3.1 REFLEX-1 — typed decision requests (multi-choice + free response)

A decision request is a typed, durable, single-consumer, fenced interaction:

```text
DecisionRequest = exact{
  requestId, worker, taskDigest, fence, turnEpoch, kind:"decision",
  question: bounded text[1..2048],
  options: exact{id,label,summary}[1..8],          // id: SafeId; label: bounded text[1..160]
  allowFreeResponse: boolean,
  recommended: null | options.id,
  postedAt, deadlineMs: null | positive int
}
DecisionAnswer = exact{ kind:"decision", optionId: null | options.id, text: null | bounded text }
// exactly one of optionId (when options exist) or text (when allowFreeResponse) is non-null
```

- **Settlement.** Same single-consumer machinery as approvals (first settle wins, others see
  `already_handled`); `decision.requested`/`decision.settled` ledger events with digests;
  replay-exact; stop/kill supersedes honestly (`control.interaction_superseded`).
- **Gating.** `blocking:true` (v1 always blocking): the worker's turn waits at the adapter ask
  boundary; the task is `input_required` with the decision request attached. No silent default
  — a deadline, if set, settles `decision.expired` (typed, visible; never auto-answers).
- **Attention surface.** `blocked_interaction:decision` in progress classification (issue #10
  AX-1), with a sanitized projection of the question + option ids/labels in RunView,
  `runs.list`, the CLI (`baton run answer RUN --option ID` or `--text "…"`), and MCP
  (`fleet_answer` gains the typed form). Provider text is untrusted; the *settlement* is
  authority.
- **Adapter mapping.** The typed payload rides the existing ask/question channel; adapter cards
  advertise `decision: native | emulated | unsupported` honestly. Briefs render the option set
  in each harness's dialect and require the worker to answer with `DECISION: <id>` or
  `DECISION: freeform` + text; the adapter parses the first well-formed answer, and malformed or
  missing answers keep the request pending (never guessed).
- **Worker-side availability.** Briefs must *advertise* the channel (`DECISION:` grammar) so
  workers learn they can gate on the orchestrator — the receipted gap is that workers do not
  know the channel exists.

### 3.2 REFLEX-2 — orchestrator-controlled task boards

Durable boards, Run-scoped-shared or per-worker, owned by the orchestrator and applied by the
hub:

```text
BoardItem = exact{ itemId, board, title, detail:null|bounded text, state, owner:null|SafeId,
  evidence: bounded refs[0..8], ordinal: positive int, itemDigest }
state = "open|claimed|done|dropped"
```

- **Authority split.** The orchestrator posts, reorders, retitles, and closes items
  (`board.item_posted/reordered/closed` events, fenced per board). Workers **report** —
  `board.claim_requested` / `board.report_submitted` (with evidence refs) — and the hub applies
  claims exactly-once (first claim wins at the item's current fence; stale claims rejected) and
  attaches reports to items. Workers never mutate the board directly.
- **Visibility.** Brief slices and a `tasks` Context-manifest branch (§3.4) expose
  per-worker-filtered views: a worker sees `board=shared` items assigned to it plus its own
  board; the orchestrator sees everything. Sanitized projections on RunView/CLI/MCP
  (`run.workstreams`/`baton run board`).
- **Durability.** Boards are ledger state, replayed from the log; per-board fences serialize
  concurrent orchestrator/worker transitions. Item digests are content-addressed; evidence refs
  bind artifacts/ValueRefs (§3.3).
- **Not Goal/Plan.** Boards coordinate *work-in-flight semantics* (who's doing what, what's
  next, what the orchestrator decided); Goal/Plan remains dispatch topology. Dispatch may
  consume a board (93B/E), never the reverse.

### 3.3 REFLEX-3 — knowledge/context hand-off objects

A typed, immutable, replay-safe package for "pass this body of context/memory":

```text
ContextPackage = exact{
  schemaVersion:1, kind:"baton.context_package", packageId, packageDigest,
  branches: exact{name, source: ManifestRef|null, artifact: ArtifactRef|null, valueRef: ValueRef|null,
                  schema: SchemaRef|null}[0..policy.maxEvidenceRefs],
  provenance: exact{runId|null, principalId, packageEvent},
  policyDigest
}
```

- **Admission.** The package is admitted as an immutable artifact (mode-0600 receipt); every
  branch resolves (artifact bytes revalidated, ValueRefs read-time revalidated per §93.5) at
  admission and at every attach. New content = new digest; never mutation in place.
- **Attachment.** `run.attach_package(run, packageDigest, { scope:"run"|"worker:<role>"| "board:<board>" })`
  — fenced, durable, replay-exact. Worker briefs render branch digests + schemas; shared-layer
  reads (Bench, boards, orchestrator tools) resolve the same objects. The package carries no
  credentials and no mutable refs (§93.1(2)); branch content is untrusted input to every reader
  and carries its provenance.
- **Replay.** Packages replay byte-for-byte; historical packages are never relabeled.

### 3.4 REFLEX-4 — REPL objects as ordinary hand-offs

- **Bench for the orchestrator without a Workflow**: add `application.context_eval` (pure
  programs only) so the orchestrator can compute REPL objects (partition manifests, orientation
  slices, digest maps) against any admitted ContextManifest — the same closed Bench, no new
  evaluator, no Workflow requirement. Map/reduce remain Workflow/successor-Plan-gated.
- **REPL objects in boards/packages**: Context cells are already content-addressed immutable
  objects; §3.2/§3.3 cite them by `cell:` digest, making "computed by the Bench, consumed by a
  worker" an ordinary, replay-safe hand-off.
- **No scripting**: the closed op set is the ceiling (permanent constraint); anything effectful
  compiles to map/reduce/call through approved authority.

## 4. Orchestration practice (how this gets built)

Development of REFLEX is itself orchestrated through baton-on-baton parallel waves (doc 31):

- **Parallel workstreams**: implementation wave (doc-31 roster: implementer + adversarial
  reviewer) runs concurrently with research waves (ATLAS/KG/REPL audits) and with the
  documentation effort — one orchestrator monitoring and steering all of them through
  `wave.progress()/send/stopMember`, with evidence records per wave.
- **Dogfood order**: REFLEX-1 first (smallest, highest leverage: decision channel + attention
  surface + brief grammar), exercised live by using a decision request *inside a wave* (a
  worker gates on an orchestrator choice) as its own acceptance proof; then REFLEX-3, REFLEX-2,
  REFLEX-4. Every slice: spec → adversarial red-team → re-draft → implement red-first →
  acceptance wave → PR.
- **Stress tests**: each new feature is stress-tested by composing it with the wave surface
  (multi-member waves where members issue decision requests mid-flight and the driver answers
  them through the new channel), proving interactive orchestration end-to-end before merge.

## 5. Boundaries (permanent)

- No arbitrary REPL/runtime/kernel; no shared mutable checkout; no worker-to-worker messaging
  (coordination through boards and packages, visible in the log).
- Worker content is untrusted everywhere; the hub is the only authority on boards, packages,
  decisions, and claims.
- No homelab integration; no credentials in packages/boards/briefs; sanitized projections only.
- Program v1 alignment: orchestrator decisions surface through `operator_selected` joins and
  `run.answer`-family settlement; no new Program effect kind is introduced by REFLEX-1..4.

## 6. Issue map

- **REFLEX-1** — typed decision requests (this doc §3.1). AX: `blocked_interaction:decision`
  + CLI/MCP answer forms (issue #10 AX-1 dependency).
- **REFLEX-2** — orchestrator-controlled task boards (§3.2).
- **REFLEX-3** — knowledge/context hand-off objects (§3.3).
- **REFLEX-4** — `application.context_eval` + REPL objects in boards/packages (§3.4).
- **Cross-links**: issue #9 (Program v1 consumes boards/packages as inputs and decisions through
  operator joins); issue #10 (attention classification + help honesty); issue #12 (nested runs
  inherit boards/packages by lease).
