# #74 COMM-TOPOLOGY AUDIT — the swarm communication channels, verified against the shipped/lane machinery

**Role:** COMMUNICATION-TOPOLOGY AUDITOR (post-contract; NOT the adversarial red-team).
**Scope:** the 8-cell audit matrix from `comm-topology-audit-brief.md`, every cell answered
VERIFIED / GAP / TARGET-STATE with verified `file:line` citations or contract-section cites.
**Verified HEAD:** `05740e0` ("Baton private effective-tree snapshot").
**Method:** read in order — (1) `worker-orchestrated-swarm-contract.md` v1.0; (2) the coupling
vocabulary (the operator's tight/loose direction + the #102 tight-cell contract v1.1/v1.2,
located in `docs/reference/evidence/tight-cell-2026-08-06/`); (3) the communication machinery as
it actually ships. Every code citation below was re-verified at HEAD with `grep -an`/`sed -n`
on the two NUL files (`impl/src/application.mjs`, `impl/src/coordination-store.mjs`).

## The channel inventory as it ships (verification base)

| Channel | Status at HEAD | Verified anchors |
|---|---|---|
| Message lane (#86/#92) — MESSAGE_SEND scanner | LANDED | `MESSAGE_SEND_GRAMMAR` `impl/src/claude-session.mjs:33`; `scanForMessageSend` `:152-166` with closed frame `{body,inReplyTo}` at `:161`; send kernel `impl/src/coordinator.mjs:6832` (budget field, `message_budget_invalid`); runId broadcast `:6901-6903`; per-send receipt `:6971-6975` |
| Reply chains (#105) | LANDED (see Verification note 1) | depth-budget law `impl/src/coordinator.mjs:12584-12592`; `message_depth_exceeded` + `lastRefusal` `:12589-12590`; B-2 membership `:12570-12578` (`message_target_not_member`); receipt accessors `:6995-7020`; `MAX_MESSAGE_DEPTH_BUDGET=8` `impl/src/limits.mjs:119`; facade dispatch `impl/src/application.mjs:12467` |
| Decision lane — DECISION_REQUEST escalation | LANDED | `DECISION_REQUEST_GRAMMAR` `impl/src/claude-session.mjs:27`; single-request pin `:1132-1141`; admission `impl/src/coordinator.mjs:12769`; reconstruction `:13934`; `run.answer` capability `impl/src/application.mjs:180`; MCP `baton_decision_answer` `impl/src/mcp-northbound.mjs:92`; #94 demo proof `docs/reference/evidence/dynamic-workflow-2026-08-03/control-surface-audit.md:119-126` |
| Attention inbox + waitingOn (#10) | LANDED | `WAITING_ON_KINDS` closed five `impl/src/application-semantics.mjs:59-63`; `BLOCKING_INTERACTION_KINDS` closed three `:33`; `run.attention.watch` facade `impl/src/application.mjs:13016`; waitingOn projections `:399, :7326, :7799, :10746, :11996`; `question.asked` blocking→`input_required` `impl/src/coordinator.mjs:12707-12710` |
| Board (#78) | LANDED (facade + kernel halves) | `run.board.post`/`run.board.read` facades `impl/src/application.mjs:13093, :13163`; kernel worker-half `requestBoardClaim`/`submitBoardReport` `impl/src/coordinator.mjs:11234, :11247`; `mintMemberBoardGrant` `:11324`; `acquireBoardLease` `:11208-11225` |
| Scratchpad + elevation (#33/#68) | LANDED | `run.scratchpad.read`/`elevate` facades `impl/src/application.mjs:13031, :13071`; dispatch `:12470-12471`; visibility rule `:699-701`; partition grammar (facade-projection contract v2.2 `docs/reference/evidence/facade-projection-2026-08-03/facade-projection-contract.md:217`) |
| Context packages (mintContextPack) | KERNEL-ONLY (no facade/MCP projection) | `mintContextPack`/`materializeContextPack`/`recordContextRead` `impl/src/coordination-store.mjs:13255, :13292, :13533`; #74 G11 explicitly records "kernel-only with no facade/MCP projection" (`worker-orchestrated-swarm-contract.md:67`) |
| REPL objects (#69) | IN CHAIN (RED) | `docs/reference/evidence/repl-realization-2026-08-07/repl-realization-contract.md`; suite `impl/test/repl-realization-red.test.mjs` 10/24 pass at HEAD |
| Orchestrator wake (#71) | IN CHAIN (RED) | `docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md` W-1..W-8 all RED; suite `impl/test/orchestrator-wake-red.test.mjs` 6/30 pass at HEAD |
| Wave observability (#132) | LANDED | `_waveRegistry` `impl/src/coordination-store.mjs:1231`; `wave.started` fold `:8103-8120`; `wave.closed` fold `:8793-8803`; `waves.list` `impl/src/application.mjs:11711` (paged ≤16, `wave_not_found`); suite `impl/test/wave-observability-red.test.mjs` 30/30 pass at HEAD |

**Verification note 1 — #105 reply chains are LANDED, not target-state.** The brief labels
#105 as "in the impl queue; mark as target-state where used." That classification is stale at
HEAD: the impl receipt `docs/reference/evidence/reply-chains-2026-08-06/impl-105-receipt.json`
records `"verdict": "IMPL-105-OK"` (2026-08-07), the `reply-chains-red.test.mjs` suite passes
26/26 in the current tree (0 failures at HEAD), and every code anchor cited above verifies.
Per the honesty law (a citation that contradicts the brief is reconciled on the evidence), this
audit reports reply chains as **VERIFIED/LANDED** and flags the brief's label as the stale fact.

**Verification note 2 — the brief's tight-cell artifact path is stale.** The brief locates the
#102 tight-cell artifacts under `docs/reference/evidence/frontier-sweep-2026-08-03/`; the actual
contract + v1.2 context-depth amendment live at `docs/reference/evidence/tight-cell-2026-08-06/`
(`tight-cell-contract.md`). All #102 citations below use the real path.

---

## The audit matrix

### Cell 1 — Top orchestrator → sub-orchestrator (unidirectional down)

**VERIFIED** (mission brief, scope, steering nudges, all receipted).

- The mission brief and scope arrive through the **workflow-as-data spec** on `waves.run`:
  `SPEC_FIELDS` includes `members` and `harvest` (`impl/src/workflow-interpreter.mjs:48`), each
  member carries a REQUIRED `objectiveRef` (`:205-207`), and the interpreter's per-member drive
  mints the worker's brief at spawn.
- Steering nudges arrive through **`messageOnSpawn`** (a member-scoped steering field,
  `impl/src/workflow-interpreter.mjs:52`, validated `:239-246`, driven at spawn `:688-691`,
  bounded ≤3) and through the **message lane** send kernel (`impl/src/coordinator.mjs:6832`,
  kinds `inform|query|steer` at `:6839`) and its facade (`impl/src/application.mjs:12953`).
- Receipts: the D6 wave receipt is the closed seven-key shape
  `{basis, harvest, manifestDigest, outcomes, steering, verdict, waveId}`
  (`impl/src/workflow-interpreter.mjs:593-602`), with `verdict` WAVE-OK / WAVE-INCOMPLETE
  (`:590`); per-message receipts carry `{delivered, targetCount}` plus non-enumerable
  `{depth, budget, remaining, lastRefusal}` accessors (`impl/src/coordinator.mjs:6996-7013`).

**Note:** the down-channel is the one direction that needs NO wake — the sub-orchestrator is
always listening on its own turn (its horizon is read-scoped per run), so the unidirectional
brief/steer path is complete as shipped.

### Cell 2 — Sub-orchestrator → top orchestrator (bidirectional up)

**VERIFIED** for escalation, status/progress, and honest-stuck. **TARGET-STATE** for the wake.

- **DECISION_REQUEST escalation** (the live gate): grammar `impl/src/claude-session.mjs:27`,
  single-request pin `:1132-1141` (one pending admission per session), admission
  `impl/src/coordinator.mjs:12769` (closed-shape check BEFORE side effects), resolution via
  `run.answer` (`impl/src/application.mjs:180`) and MCP `baton_decision_answer`
  (`impl/src/mcp-northbound.mjs:92`). The round-trip is proven end-to-end in the #94 demo
  (`docs/reference/evidence/dynamic-workflow-2026-08-03/control-surface-audit.md:119-126`).
  **A sub-orchestrator seat that rides the DECISION_REQUEST lane does not need a baton
  connection — the gate answers through the session's own escalation path.**
- **Status/progress visibility:** the top orchestrator reads `waves.list` (open rows, paged ≤16,
  typed `wave_not_found`; `impl/src/application.mjs:11705-11747`, `:11711`), per-run `run.status`
  (recursive-session allowlist `:3304-3311`), and the D6 receipt's `outcomes`
  (`impl/src/workflow-interpreter.mjs:580-582` per-member `{role, phase, terminal, resultSha, report?}`).
- **Honest "I'm stuck":** the single waitingOn projection with the closed five `WAITING_ON_KINDS`
  (`impl/src/application-semantics.mjs:59-63`), surfaced at `impl/src/application.mjs:399, :7326,
  :7799, :10746, :11996`; `capacity_ceiling` mints a durable deferral receipt. A mid-turn working
  sub-orchestrator serializes honest `null` (D9: reply-chains-contract.md:317-333).
- **GAP → TARGET-STATE: the top gets WOKEN.** The #71 orchestrator-wake lane is RED at HEAD
  (W-1..W-8; `docs/reference/evidence/orchestrator-wake-2026-08-07/orchestrator-wake-contract.md:374-376`);
  today the attention inbox is page-read-only — the top orchestrator must poll, it is not
  woken on a sub-orchestrator's park or doubt. **Owning issue: #71.** The seam is already
  named: the wake long-poll rides the existing `run.attention.watch` facade
  (`impl/src/application.mjs:13016`) with the `answer_decision` item shape from
  `projectDecisionAttention` (contract W-2). Until #71 lands, the up-channel is "answer-on-its-
  turn" — functionally complete for the escalation gate, but the sub-orchestrator's parked
  decision does not interrupt the top.

### Cell 3 — Sub-orchestrator → swarm members (unidirectional down)

**VERIFIED** for row assignments/briefs via boards, messages, and scratchpad reads, receipted
per member. **GAP** for context packages (kernel-only).

- **Row assignments/briefs:** the sub-orchestrator writes the shared scratchpad tier via
  `run.scratchpad.elevate` (`impl/src/application.mjs:13071`) into the `shared` partition; a
  worker reads it via `run.scratchpad.read` (`:13031`) with the visibility rule at
  `:699-701` (worker sees own `worker:<id>` plus read-only `shared`, both run-scoped). Board
  post/read ride `run.board.post`/`run.board.read` facades (`:13093, :13163`) over the kernel
  worker-half (`impl/src/coordinator.mjs:11234, :11247`, grant mint `:11324`, lease
  `:11208-11225`).
- **Fan-out receipts:** per-send receipts return `{delivered, targetCount}` with the runId
  broadcast (`impl/src/coordinator.mjs:6901-6903, :6971-6975`); board grants are
  minted server-side with persist-before-deliver and an EXACT retry returns the original grant
  (BW-05, `impl/src/application.mjs:11788-11810`). Per-member delivery is recorded per delivery
  row (`deliveries: new Map(), readBy: new Set()` at `impl/src/coordinator.mjs:12653`).
- **GAP → TARGET-STATE: context packages (BD3-B).** `mintContextPack`/`materializeContextPack`/
  `recordContextRead` exist only as kernel lanes (`impl/src/coordination-store.mjs:13255, :13292,
  :13533`) with **no facade/MCP projection** (G11, `worker-orchestrated-swarm-contract.md:67`).
  A sub-orchestrator cannot today hand a swarm member a precomposed context package through any
  surfaced verb. **Concrete seam:** project the kernel lane behind the #87/#48 facade dispatch
  (`impl/src/application.mjs:12460-12476`) as e.g. `run.context.materialize` (a closed
  `{packId}` normalizer + the landed `recordContextRead` side), and mirror it on the MCP
  surface alongside `baton_run_message_send` (`impl/src/mcp-northbound.mjs:626`). **Owning
  issue:** the #87/#48 facade-projection epic (BD3-B row) — recorded as OQ2 in the #74 contract.

### Cell 4 — Swarm members → sub-orchestrator (bidirectional up)

**VERIFIED** for results, blockers, follow-up questions, and reply chains. **TARGET-STATE** for
the #66 doubt lane.

- **Results:** workers report through the board worker-half (`submitBoardReport`
  `impl/src/coordinator.mjs:11247`) and through `waves.stop`/run terminal outcomes; the
  D6 receipt `outcomes` per member (`impl/src/workflow-interpreter.mjs:580-582`) aggregates
  them for the sub-orchestrator.
- **Reply chains (#105, LANDED):** workers get **budgeted reply chains, not one-shot sends**.
  The B-2 membership check (a reply resolves only to its parent target or a run-mate,
  `impl/src/coordinator.mjs:12570-12578`) and the per-branch depth cap
  (`MAX_MESSAGE_DEPTH_BUDGET=8`, `:12584-12592`) bound the chain; exhaustion refuses
  `message_depth_exceeded` and the refusing parent's receipt carries an orchestrator-readable
  `lastRefusal` (`:12589-12590`). Receipt accessors at `:6995-7020`.
- **Clarifying question WITHOUT top escalation — YES:** D8's boundary law
  (reply-chains-contract.md:288-315) is implemented: a **blocking** follow-up raises
  `question.asked` with `blocking: true` → task `input_required`
  (`impl/src/coordinator.mjs:12707-12710`) which is a task-visible interaction the
  sub-orchestrator answers via `run.answer` — **no baton needed**; a **conversational**
  follow-up stays in the budgeted reply lane. The member can always get an answer from the
  sub-orchestrator within the run.
- **GAP → TARGET-STATE: the #66 doubt lane.** Doubts are contracted
  (`docs/reference/evidence/doubt-review-2026-08-12/doubt-review-contract.md`, DRAFT v1.1) but
  RED at HEAD (`impl/test/doubt-review-red.test.mjs` 5/30 pass). A member's structured
  "I doubt this result" has no first-class receipt today — the honest-stuck path exists
  (waitingOn) and the reply lane exists, but the doubt channel (which is specifically about
  result-quality doubt, not blockingness) is not surfaced. **Owning issue: #66.**

### Cell 5 — Within a tightly-coupled cell (the deeper shared context)

**TARGET-STATE (#102)** — the cell machinery is entirely RED at HEAD.

- **What carries the shared context — contracted, not landed.** The v1.2 context-depth
  amendment (`tight-cell-contract.md:799-847`) names four depths: D-depth-1 (cell-mate task
  tiers mutually readable), D-depth-2 (direct shared-tier writes with the cell's nonce), D-
  depth-3 (cell message visibility with per-member reply receipts), D-depth-4 (`group.worktree:
  'shared'`). Today `wave.mjs` has **zero `group`/`cell` matches** and the kernel read port
  constructs `(runId, ['shared'])` server-side — no cell-member task-tier reads exist
  (D-depth-1 RED). The `group` admission vocabulary (`wave_group_invalid`, quorum/size, editing
  indexes) is contract-only.
- **The single-unit presentation is compatible with the channels above — by construction.**
  Decision 7 (designated collector, `tight-cell-contract.md:640-656`) makes member index 0's
  result the collective (one run, one result section, one outcome), and the sub-orchestrator
  assigns integration through the cell brief + the board — both of which are the LANDED board
  and scratchpad channels from Cells 3/4. TC-19's end-to-end #74 loop
  (`tight-cell-contract.md:759`) and TC-21's single-reply law (`:761`) compose onto the shipped
  board/message machinery. So the interface does not need new channels — it needs the #102
  kernel rung (`wave_group_invalid` admission, cell grant, depth predicates) to be implemented.
- **REPL shared object (#69)** — the alternative shared-context carrier — is also in chain and
  RED (`docs/reference/evidence/repl-realization-2026-08-07/repl-realization-contract.md`;
  suite 10/24 at HEAD).
- **Owning issue: #102** (tight-cell kernel + D-depth-1..4 + TC-19/TC-21 suite rows); the REPL
  object carrier is **#69**.

### Cell 6 — Loosely-coupled members: fully distinct contexts (no bleed)

**VERIFIED** — the loose default is byte-identical isolation.

- **Run-scoped horizon:** `_runHorizonNodeIds(runId)` builds the visible set from the run's own
  task ids (`impl/src/coordinator.mjs:11155-11160`); every cross-run context read refuses
  `context_scope_forbidden` (`:10748, :10752, :10785, :10795`).
- **Scratchpad tiering:** the Part D rule-12 visibility predicate
  (`impl/src/application.mjs:699-701`) lets a loose member see ONLY its own `worker:<id>` tier
  plus read-only `shared` — never a sibling's `worker:<id>`. There is no per-member escape.
- **Message membership:** the B-2 check (`impl/src/coordinator.mjs:12570-12578`) refuses
  `message_target_not_member` for a send/reply that targets a different run's worker — a loose
  member cannot message another loose member's worker directly, and a broadcast resolves only
  within its own run.
- **Pinned unchanged:** the #102 v1.2 amendment explicitly pins "a non-cell member's task tier
  remains unreadable to siblings — the loose default is byte-identical"
  (`tight-cell-contract.md:845-847`). No GAP.

### Cell 7 — Steering mid-flight (top → sub AND top → swarm member, with receipts)

**VERIFIED.**

- **Top → sub-orchestrator:** the message lane's `steer` kind (`impl/src/coordinator.mjs:6839`)
  and the facade `run.message.send` (`impl/src/application.mjs:12953`) redirect the
  sub-orchestrator mid-run with a receipt (`{delivered, targetCount}` `:6971-6975`);
  `waves.send`/`waves.stop` steer ONE member via the resume-steer attach
  (`impl/src/application.mjs:11786-11810`).
- **Top → swarm member:** `waves.send` (`sendWaveMember`, `:11788`) with the #78 claimGrant
  extension (persist-before-deliver, EXACT-retry idempotence) delivers the steer to a member
  even mid-work.
- **Declarative steering vocabulary:** the wave-driver enforces `STEERING_MODES` = closed
  {`nudge-on-checkpoint`, `none`} (`impl/src/wave-driver.mjs:76`), and `nudge-on-checkpoint`
  delivers the pending nudge at the member's next checkpoint (`:36, :667-668`); the #114
  steering policy fields (`approveOnAdvertisedPlan`, `nudgeOnCheckpoint`, `claimOnStall`,
  `messageOnSpawn`, `answerDecisions`, `signalOnMembersDone`) are the declarative form
  (`impl/src/workflow-interpreter.mjs:52`).
- **Receipts:** message receipts (per-send), the broadcast receipt, and the D6 receipt's
  `steering` trail (which records `answerDecisions` outcomes including `deferred`,
  `impl/src/workflow-interpreter.mjs:783-792`). The nudge lands with the member's checkpoint
  receipt; a claim grant returns its grant receipt.

### Cell 8 — The authority boundary (what the sub-orchestrator may NOT use)

**VERIFIED** for the underlying typed refusals; **TARGET-STATE** for the one new coaching code.

- **No baton for the sub-orchestrator (two-level shape):** discovery of a baton connection
  profile refuses with the absence refusal `cli_config_invalid: user connection profile is
  unavailable`, byte-identical to #12 (`impl/src/application-cli.mjs:126, :132`). The recursion
  gate is NOT widened for a sub-orchestrator (`nested-orchestration-contract.md:514`, `:520-521`,
  `:587`).
- **Recursive `run.start`/`run.stop` and reads are lease-bound:** `_recursiveLease` validates
  the session authority against the minted lease (`impl/src/application.mjs:4423-4441`), and
  `authorizeReplay` allows only the narrow recursive allowlist (`run.start`/`application.help`
  plus the read verbs) — anything else refuses `run_orchestrator_command_forbidden`
  (`:3304-3311`; kernel side `impl/src/coordination-store.mjs:2069-2078`). The `waves.*`
  steering verbs dispatch through the SAME `_authorize` seam that throws
  `application_unauthorized` (`impl/src/application.mjs:3215`).
- **TARGET-STATE: the one new code — `coordinator_authority_forbidden`.** #74's own refusal
  rung (D2, `worker-orchestrated-swarm-contract.md:230`): a coordinator-seat principal reaching
  for a wave/steering authority verb should draw `{attempted, gracefulPath}` naming the
  DECISION_REQUEST escalation lane — never emitted for the top orchestrator. This code does not
  exist at HEAD (no coordinator seat exists to trigger it; `grep` finds no emitter). It is the
  **single named seam** for the closed authority surface and is the contract's own RED rung.
- The authority surface it would coach is otherwise fully typed: `application_unauthorized`
  (`application.mjs:3215`), `run_orchestrator_command_forbidden` (`:3307, :12134, :12531`),
  `cli_config_invalid` absence (`application-cli.mjs:126, :132`), `message_target_not_member`
  (`coordinator.mjs:12575`), `context_scope_forbidden` (`coordinator.mjs:10748+`). **Owning
  issue: #74** (its own A4/A5 acceptance pins, RED).

---

## Topology verdict

**SWARM-READY for the loosely-coupled two-level shape — NOT-YET for the tightly-coupled cell
rung.**

The two-level shape the contract owns and says works today (D1/D2: a sub-orchestrator over
loose flash/grok swarm members, both inside the top orchestrator's wave, never driving baton)
is fully served by the shipped/lane machinery: **all eight cells verify for the loose shape** —
mission/steer down (Cell 1), escalation + status + honest-stuck up (Cell 2), fan-out down
(Cell 3), results + reply chains + clarifying questions up (Cell 4), loose isolation (Cell 6),
mid-flight steering with receipts (Cell 7), and the authority boundary's typed refusals (Cell 8).
A coordinator seat can run a loose swarm TODAY with no baton connection — the decision gate,
reply chains, boards, scratchpad, waitingOn, waves observability, and #105 reply chains are all
landed at HEAD.

**The tightly-coupled cell rung is NOT-YET** — Cell 5 is entirely RED (the #102 cell admission,
D-depth-1..4 shared contexts, and the collector derivation are contract-only; `wave.mjs` has
zero cell/group machinery).

**Minimal gap list (the honest NOT-YET list):**

1. **#102 tight-cell machinery** — Cell 5: `group` admission, D-depth-1..4 context depths, TC-19
   collector loop, TC-21 single-reply law. (The board/message interface it composes onto is
   already landed — Cells 3/4.)
2. **#71 orchestrator wake** — Cell 2: the top gets WOKEN (today it polls the attention inbox).
   The wake composes onto the landed `run.attention.watch` facade + `projectDecisionAttention`.
3. **#66 doubt lane** — Cell 4: a first-class receipted doubt channel (DRAFT v1.1, RED).
4. **#69 REPL shared objects** — Cell 5's alternative shared-context carrier (in chain, RED).
5. **`coordinator_authority_forbidden`** — Cell 8: the contract's own named coaching code
   (no emitter at HEAD; owning issue #74, A5).
6. **BD3-B context-pack facade/MCP projection** — Cell 3 GAP: `mintContextPack`/`materialize`
   are kernel-only with no surfaced verb (owning issue: #87/#48 facade-projection epic row,
   contract OQ2).

Verdict shape: **SWARM-READY (loose) / NOT-YET (tight cell)** — a sub-orchestrator can launch a
loose swarm and run the full communicate/escalate/steer/harvest loop today; a tightly-coupled
cell of same-seat members cannot yet share the deeper context, so the #74 full shape waits on
#102 (and on #69 if REPL objects are the chosen carrier).
