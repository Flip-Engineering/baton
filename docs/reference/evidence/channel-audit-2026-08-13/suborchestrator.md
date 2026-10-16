# CHANNEL AUDIT — row-suborch: suborchestrator ↔ tightly-coupled cell channels

> **#74 follow-up audit** — attempt `e4fb268d-8a0e-41b9-99db-c60ba66b6dce` · row `row-suborch`
> **Verified at HEAD** `e371f704727cbca5fdff86af31ec8b154620a71f`
> **Deliverable (this file only):** `docs/reference/evidence/channel-audit-2026-08-13/suborchestrator.md`
> **Deployment profile:** `default@870ec6640636f0bea6ed8ccca7d02cebddbbfd3c81dbf6c396a9ac89dd6cbb21` · objective/result policy `explicit change_v1`
> **Verification:** deployment verification command run before claiming completion (see §8).

**The four questions and their verdicts**

| # | Question | Verdict |
|---|---|---|
| Q1 | Can a wave member call `waves.run` (or any waves.* authority verb) today? | **PROVEN: NO** — `coordinator_authority_forbidden` at the dispatch seam |
| Q2 | What shared-context machinery exists for the tightly-coupled cell (#102/#69)? Is a cell's shared partition writable by all cell members TODAY? | **PROVEN GAPPED** — zero cell machinery landed; kernel `writeScratchpad` hardcodes `worker:<id>`; a shared write is RED both as tight-cell D-depth-2 and as #158 |
| Q3 | Bidirectionality: member→suborchestrator messages and suborchestrator→top escalation chaining — does a nested DECISION_REQUEST surface at the top with its authority chain intact? | **GAPPED** — member→suborchestrator lanes exist (reply + interaction); suborchestrator→top escalation is flat and cannot be resolved by the suborchestrator (no `approve`); nested DECISION_REQUEST cannot be minted |
| Q4 | The steering lanes a suborchestrator would need — which are interpreter-only today vs available to a member through the facade? | **PROVEN: all seven interpreter-only as lanes**; the raw verbs are NOT seat-refused on the `direct` seam (§5.4 P-c: worker `run.act approve_plan` executes) — blocked only by facade-absence + recursive gate + `waves.run` refusal |

The short answer to the operator's ask ("can a coordinator MEMBER drive its own tightly-coupled
sub-swarms today?"): **no, not on any of the four channels.** The full shape (#12) remains the
composition dependency, and the two-level shape's coordinator seat is a worker seat with no
facade, no `approve`, no shared write, and no nested wave authority.

**One sharpening from this session's live probes (HEAD e371f70):** the *steering lane* as an
orchestration behavior (when/why to approve, nudge, claim) is interpreter-only — but the
*underlying verb* is NOT seat-refused on the raw command seam. A `worker:` principal is offered
`approve_plan` in its caller-scoped outline (its own per-principal `actionId`), and `run.act
approve_plan` **executes** on the internal `direct` seam (deploy seam permissive for non-read
commands, §5.4). What stops the member in every shipped shape is the *facade absence* (two-level,
G9) and the *recursive-session gate* (full shape, P3) — not a worker-seat refusal inside
`run.act` itself. This asymmetry (`waves.run` refuses; `run.act` does not) is §9 Q4 and A7.

---

## 1. Ground truths (all re-verified this session at HEAD e371f70)

- **G1 — the worker seat class.** A coordinator-seat principal has `principalId` `worker:<id>` —
  "the G9 seat class that never holds `approve`" (`impl/src/limits.mjs:133-142`). The ONE new
  refusal code for the wave boundary, `COORDINATOR_AUTHORITY_FORBIDDEN` and its graceful path
  `COORDINATOR_AUTHORITY_GRACEFUL_PATH = 'DECISION_REQUEST'`, live here (`limits.mjs:141-142`).
- **G2 — the waves.* dispatch seam fires before anything else.** `['waves.start','waves.run',
  'waves.stop']` are refused for a worker-seat principal by `_refuseCoordinatorAuthority` at
  `impl/src/application.mjs:12560-12561`, which throws `coordinator_authority_forbidden`
  `{attempted, gracefulPath}` (`application.mjs:3232-3237`). `waves.list` / `waves.progress` are
  observe verbs and are not refused (`application.mjs:12562-12569`).
- **G3 — the deploy authorize seam is read-narrow only.** `restrictingReadAuthorize`
  (`impl/src/application-deployment.mjs:1724-1742`) restricts ONLY `run.scratchpad.read` (own
  `worker:<id>` partition + `shared` + review authority `local-owner`/`service-*`); every other
  command returns `true` (permissive). So the deploy seam does NOT gate a worker seat's
  `run.act` / `run.answer` / `run.message.send` — those are gated elsewhere.
- **G4 — worker principals hold no goal/plan authority.** `deploymentGoalPlanAuthority`
  (`impl/src/application-deployment.mjs:2075-2081`): `principalId.startsWith('worker:')` →
  `false` for `plan:propose` / `plan:approve`.
- **G5 — the kernel scratchpad write is worker-scoped.** `writeScratchpad`
  (`impl/src/coordination-store.mjs:14064-14155`) uses a closed envelope
  `['runId','taskId','workerId','entry']` (:14065) and hardcodes `const scope = \`worker:${fields.workerId}\``
  (:14103). The scratchpad scope regex admits `shared` for READS only
  (`SCRATCHPAD_SCOPE` :533; `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` :525).
- **G6 — the interpreter is the sole driver of a wave.** `waves.run` → `runWorkflow`
  (`application.mjs:11631-11645`) binds the facade `bindBaton(this, principal)` and calls
  `runWorkflow(baton, specOrPath, ...)` — the interpreter drives every member handle with the
  caller's (orchestration-seat) principal, never the member's.
- **G7 — the seven steering policies are a closed list.** `STEERING_FIELDS`
  (`impl/src/workflow-interpreter.mjs:48-54`): `approveOnAdvertisedPlan`, `nudgeOnCheckpoint`,
  `claimOnStall`, `messageOnSpawn`, `elevateWhenNotes`, `answerDecisions`, `signalOnMembersDone`.
  `driveLane` (:679-761) is the ONE control loop.
- **G8 — no cell/group machinery.** `createWave` (`impl/src/wave.mjs:157-215`) has zero group or
  cell construction (verified by grep); tight-cell (#102) D-depth-1..4 are all RED at HEAD
  (suite re-run this session: 39 tests, 9 pass / 30 fail — the D-depth pins included in the RED
  set).
- **G9 — a wave member has no facade in the two-level shape.** A worker's private HOME contains
  no `baton/connections/` tree, so CLI discovery fails `cli_config_invalid`
  (`impl/src/application-cli.mjs:119`; discovery walk :208-250; worker isolation
  `docs/reference/evidence/nested-orchestration-2026-08-03/grounding.md:25-60`).
- **G10 — `gh` is unauthenticated in this worktree.** `gh issue view 74` / `12` / `102` / `158`
  could not be read; issue requirements are carried by the brief and the evidence directories.

---

## 2. Q1 — can a wave member call `waves.run`? **PROVEN: NO**

**Evidence.** The dispatch seam (`application.mjs:12560-12561`) refuses the three waves.*
authority verbs for any `principalId` starting `worker:` BEFORE the recursive gate and before any
per-member admission. `_refuseCoordinatorAuthority` (`application.mjs:3232-3237`) throws
`coordinator_authority_forbidden` with `{attempted, gracefulPath: 'DECISION_REQUEST'}`, consuming
the byte literals from `limits.mjs:141-142`. The refusal vocabulary section of the #74 contract
(`worker-orchestrated-swarm-contract.md` D2/A5) pins exactly this shape, and the red test
`impl/test/worker-orchestrated-swarm-red.test.mjs:888-946` (A5) asserts the worker-seat fixture
`{actor:'baton:worker:w-1', principalId:'worker:w-1', sessionId:'session-worker-w-1'}` draws it —
GREEN at HEAD (the guard is landed; the earlier `comm-topology-audit.md` claim of "no emitter" is
STALE at 05740e0 and does not hold at HEAD).

**Two shapes, two block points:**

- **Two-level shape (current v1.0 contract):** the member never reaches the facade at all — its
  run session has no baton connection (`cli_config_invalid`, G9).
- **Full shape (#12):** even with a lease-bound connection, the same worker-seat principal reaches
  `waves.run` and draws `coordinator_authority_forbidden` — the seam fires before the recursive
  gate (`application.mjs:12555-12561`), so the recursive-session check is never reached.

**Verdict:** PROVEN — a member cannot call `waves.run` today; the boundary is live, typed, and
tested. The top orchestrator never fires the code (`application.mjs:12555-12556` comment).

---

## 3. Q2 — tight-cell shared-context machinery + #158. **PROVEN GAPPED**

**What exists for a cell's shared context.** Nothing landed:

- `createWave` has zero group/cell construction (G8) — a wave is a flat roster, not a cell.
- The scratchpad kernel write is worker-scoped by construction: `writeScratchpad` hardcodes
  `worker:${fields.workerId}` (`coordination-store.mjs:14103`); there is no `shared` write path.
- The member read law (G3) admits `shared` reads and each member's own partition — a *sibling*
  `worker:<role>` read refuses `application_unauthorized` (`application-deployment.mjs:1724-1742`).

So the tightly-coupled cell's defining property — *a shared partition every cell member can write,
read as a single unit* — is **RED today**, exactly as the tight-cell contract's D-depth-2 pin
(`docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md` v1.2 amendment :799-847)
and the #158 contract (`scratchpad-write-contract.md` G8/G9) both state. This is not a separate
finding from #158: the two are the same gap seen from the cell side (tight-cell D-depth-2) and
from the surface side (#158's `run.scratchpad.append` verb, which does not exist at HEAD).

**Verdict:** GAPPED — a cell's shared partition is not writable by cell members today, and there
is no cell machinery to hang it on. Any suborchestrator that wants a shared cell scratchpad is
blocked on #158's surface verb landing AND the tight-cell D-depth-2 write path. Re-verified this
session: `scratchpad-33-red.test.mjs` SP1 (worker-authored `scope:'shared'` write →
`scratchpad_write_invalid`) passes 50/50 at HEAD, and `tight-cell-red.test.mjs` still fails 30/39
(D-depth-1..4 RED).

---

## 4. Q3 — bidirectionality and escalation chaining. **GAPPED**

### 4.1 Member → suborchestrator (up)

Two lanes are LIVE:

- **Reply chains (#105):** `coordinator.mjs:12760-12860` — a member can reply to a suborchestrator
  message within the B-2 membership check. Refusals: caller-named `to` → `message_target_caller_named`
  (:12780); unknown target → `message_parent_not_found` (:12785); non-member target →
  `message_target_not_member` (:12799); depth over the closed budget →
  `message_depth_exceeded` (:12813-12814, budget `MAX_MESSAGE_DEPTH_BUDGET = 8`,
  `limits.mjs:119`). So a suborchestrator that is a member of the same wave/run can be messaged,
  and a member can reply.
- **Interaction lane (DECISION_REQUEST admission):** a member's `question.asked` blocks the
  worker turn (`input_required`, `coordinator.mjs:12940-12988`) and a decision request is admitted
  per worker (`coordinator.mjs:12999-13052`, one pending per worker →
  `decision_already_pending`).

### 4.2 Suborchestrator → top (up, escalation chaining)

- A member's pending DECISION_REQUEST surfaces in the TOP run's view as an `answer_decision`
  attention item via `projectDecisionAttention` (`application.mjs:582-607`), disclosed in the run
  view (:7319). The top answers via `run.answer` (`application.mjs:12680-12710`).
- **The chain is FLAT.** `run.answer` enforces `interaction.runId !== runId` →
  `application_interaction_not_found` (`application.mjs:12700-12702`). The attention item carries
  `{workerId, requestId}` only — there is no parent/child wave lineage, no sub-swarm context, and
  the request's authority chain does not ride the escalation. A suborchestrator's own sub-member's
  DECISION_REQUEST surfaces in the SUBORCH's run view (not the top's); for it to reach the top,
  the suborchestrator would have to re-mint its own decision request upward — flattening the
  origin.
- **A suborchestrator cannot resolve its sub-members' decisions.** `run.answer` needs capability
  `['approve','observe']` (`application-semantics.mjs:708` for `answer_decision`; MCP
  `baton_decision_answer: ['approve','observe']` at `mcp-northbound.mjs:92` (table :89-115)). G9: the worker
  seat never holds `approve` (`limits.mjs:135`). The G9 statement is the **two-level shape's**
  design intent (no facade → no capability grant); the verb itself is capability-gated, not
  seat-gated — a non-recursive MCP surface wired with `approve` can execute it (P-e analog, §5.4).
  In the shipped shapes the suborchestrator stays forward-only: two-level = no facade, full shape =
  recursive gate refuses `run.answer` (A5).
- **Nested DECISION_REQUEST cannot be minted.** Q1 blocks the nested `waves.run` that would
  create the suborchestrator's wave at all; and one-pending-per-worker
  (`decision_already_pending`) serializes any chained escalation to a single pending decision per
  seat.

**Verdict:** GAPPED. Upward member→suborchestrator messaging works (reply + interaction lanes are
live). Escalation chaining is flat (no lineage), forward-only (no `approve` to settle), and
serialized (one pending per worker). The full #12 recursive-session shape is the named
composition dependency (`worker-orchestrated-swarm-contract.md` G12). Re-verified this session:
`nested-orchestration-red.test.mjs` at HEAD still passes only its PINs (7 pass / 8 fail — P1-P7
green incl. P3 recursive-session gate; R1-R8 full-shape connection-profile minting RED), and the
flat-chain pin (`interaction.runId !== runId`) is unchanged at `application.mjs:12700-12702`.

---

## 5. Q4 — the steering lanes a suborchestrator would need. **PROVEN: all seven interpreter-only**

### 5.1 The interpreter's lanes and the facade verb each rides

`driveLane` (`workflow-interpreter.mjs:679-761`) drives all seven policies with the
ORCHESTRATION-seat principal (G6). Mapping to the facade verb + required capability:

| Steering lane | Interpreter call (line) | Facade verb | requiredCapabilities |
|---|---|---|---|
| `approveOnAdvertisedPlan` | wave create approves via `entry.run.approve()` — `wave.mjs:207`; no re-approve (`interpreter :698`) | `run.approve` | `['approve','observe']` |
| `answerDecisions` | `handle.answer(requestId, …)` — `interpreter :824,:844` | `run.answer` | `['approve','observe']` |
| `nudgeOnCheckpoint` | `handle.act('nudge_turn',{message})` — `interpreter :727,:866` | `run.act` | `['control','observe']` |
| `claimOnStall` | `handle.act('claim_turn',{})` — `interpreter :727,:872` | `run.act` | `['control','observe']` |
| `messageOnSpawn` | `handle._command('run.message.send',…)` — `interpreter :708,:771,:781` | `run.message.send` | `['control','observe']` |
| `signalOnMembersDone` | `handle._command('run.message.send',…)` — `interpreter :740-750,:747` | `run.message.send` | `['control','observe']` |
| `elevateWhenNotes` | `run.scratchpad.read` (:882) then `run.scratchpad.elevate` (:890) — `interpreter :730,:877-908` | `run.scratchpad.elevate` | `['control','observe']` |

Capability source of truth: `impl/src/application-semantics.mjs:705-716`
(`approve_plan: ['approve','observe']`, `answer_decision: ['control','observe']`,
`nudge_turn/wait_turn/claim_turn/send: ['control','observe']`); MCP tool gate
`impl/src/mcp-northbound.mjs:89-115` (`baton_waves_run: ['control','observe']` :103,
`baton_run_message_send: ['control','observe']` :111,
`baton_run_scratchpad_elevate: ['control','observe']` :115,
`baton_decision_answer: ['approve','observe']` :92, `baton_run_scratchpad_read: ['observe']` :114).

### 5.2 Why a member cannot reach any of them

| Gate | What it blocks | Citation |
|---|---|---|
| **G9 `approve` gap** | `run.approve` (approveOnAdvertisedPlan) and `run.answer` (answerDecisions): the worker seat never holds `approve` | `limits.mjs:135`; `application-semantics.mjs:705,708`; `mcp-northbound.mjs:89-115` |
| **No worker facade** | In the two-level shape there is no member facade to call ANY verb | G9 grounding: `application-cli.mjs:119`; `nested-orchestration-2026-08-03/grounding.md:25-60` |
| **Recursive gate (full shape)** | With a lease-bound session (`sessionAuthority`), `run.approve`/`run.answer`/`run.message.send`/`run.scratchpad.elevate` → `run_orchestrator_command_forbidden`; only the read/effect allowlist + `run.act` pass | `application.mjs:12588-12627`; `run-lineage.mjs:14` (`RUN_ORCHESTRATOR_CAPABILITIES = ['run.context','run.start','run.status','run.stop']`) |
| **`run.act` is `context_*`-only in a recursive session** | nudge/claim/send/interrupt via `run.act` are refused `run_orchestrator_command_forbidden` for a `sessionAuthority` caller; only `context_*` actions pass | `application.mjs:12183-12186` |
| **Capability filter applies only on capability-authority surfaces** | On MCP/web `capabilityAuthority` is always present, so `capabilityEligibleSemanticActions` filters offered actions AND `_authorizeSemanticAuthority` requires the presented `semanticAuthority` digest + every `requiredCapabilities` ⊆ the caller's `capabilities` (`application.mjs:1157-1161`; context normalization :1170-1215; MCP injects `capabilities`/`semanticAuthority` at `mcp-northbound.mjs:1456-1457,2086-2087` and mints the token via `actionAuthority` :1447). The worker's MCP capability set is whatever the northbound wiring grants — the tool table already assigns `baton_decision_answer: ['approve','observe']`, so a worker *wired with* `approve` can execute `approve_plan` (§5.4). The **internal `direct` seam skips the filter entirely** (`!context?.capabilityAuthority` → no filtering at `application.mjs:1157`; deploy seam permissive for non-read commands, G3) | `application.mjs:3240-3260`; `mcp-northbound.mjs:89-115,1447` |
| **Waves.* authority verbs** | Even the top-level entry (`waves.run`, `waves.start`, `waves.stop`) is refused `coordinator_authority_forbidden` | `application.mjs:12560-12561,3232-3237` |

### 5.3 The gap-list table (suborchestrator need → availability today)

| Lane | Interpreter-only today? | Reachable by a member through the facade? | The blocking seam |
|---|---|---|---|
| `approveOnAdvertisedPlan` | YES | NO | G9 `approve` gap (limits.mjs:135) + recursive gate |
| `answerDecisions` | YES | NO | G9 `approve` gap (run.answer needs `approve`) |
| `nudgeOnCheckpoint` | YES | NO (full shape) / N/A (two-level) | recursive gate refuses non-`context_*` `run.act`; no worker facade in two-level shape |
| `claimOnStall` | YES | NO (full shape) / N/A (two-level) | same as nudge |
| `messageOnSpawn` | YES | NO | `run.message.send` not in recursive allowlist → `run_orchestrator_command_forbidden`; no worker facade |
| `signalOnMembersDone` | YES | NO | same as messageOnSpawn |
| `elevateWhenNotes` | YES | NO | `run.scratchpad.elevate` not in recursive allowlist; read law restricts cross-worker reads (G3) |

**Verdict:** PROVEN — all seven steering *lanes* (the orchestration policies in `driveLane`) are
interpreter-only today. No member (worker seat) can drive any of them **as an orchestration
behavior** through the facade, in either the two-level or the full (#12) shape. The raw verbs the
lanes ride are a separate question from the lanes themselves: the facade *offers* a worker seat
`approve_plan` (own `actionId`) and the `direct` seam executes it — but the member still cannot
run a lane, because (a) there is no member facade in the two-level shape (G9), (b) the full shape
is a recursive session whose gate refuses non-`context_*` `run.act` (P3), and (c) `waves.run` —
the only entry that would hand the member an interpreter — is refused
`coordinator_authority_forbidden` (Q1). §5.4 exercises the verb-level reach and records the exact
refusals; A7 pins the resulting asymmetry.

### 5.4 Exercised verb-level reach at HEAD (this session's live probes)

Fixture: `worker-orchestrated-swarm-red.test.mjs` driver + `BatonApplication` (permissive
`authorize: async () => true`, the HEAD fixture's deploy seam), worker seat
`{principalId:'worker:w-1'}`, owner `s74-owner`, distinct planner `s74-planner` (planner must
differ from goal owner — `application.mjs:4567`). Each row is a fresh `run.start` in
`awaiting_plan_approval`; the worker seat inspected its own caller-scoped outline and acted on its
**own** per-principal `actionId` (minted by `_semanticActionId(current, view, principal, …)`,
`application.mjs:8386-8402`).

| # | Call (worker seat) | Result | What it proves |
|---|---|---|---|
| P-a | `run.inspect {runId, depth:'outline'}` | **OK** — worker sees the same `phase`/`stage` as the owner, and is *offered* `[{kind:'approve_plan', requiredCapabilities:['approve','observe']},{kind:'stop',…}]` with its own `actionId`; `requiredAction` projects `approve_plan` as the worker's required action | The caller-scoped outline mints control verbs for a `worker:` principal on the `direct` seam (no `capabilityAuthority` → `capabilityEligibleSemanticActions` is skipped, `application.mjs:1157-1161`). The *offering* is not seat-gated |
| P-b | `run.act {actionId: <owner's>}` (direct) | `application_action_scope_mismatch` | `actionId` is per-principal — a worker cannot execute the owner's action token (`_semanticActions` resolves by the acting principal, `application.mjs:3282-3288`) |
| P-c | `run.act {actionId: <own>, inputs:{planDigest}}` (direct) | **OK — `approve_plan` executed, phase→`failed`** | The internal `direct` seam has **no worker-seat refusal on `run.act`** (unlike `waves.run`): capability filter skipped (`application.mjs:1157`), `_authorizeSemanticAuthority` sees no `capabilityAuthority` (`application.mjs:3255-3261`), deploy seam permissive for non-read commands (G3, `application-deployment.mjs:1724-1742`). A `worker:` principal can approve the owner's plan through the raw command seam |
| P-d | `run.act` (MCP context, caps `['observe']`, token from `application.actionAuthority`) | `application_unauthorized` | The capability filter is the MCP gate: `approve_plan.requiredCapabilities = ['approve','observe']` ⊄ `['observe']` → `_authorizeSemanticAuthority` refuses (`application.mjs:3247-3253`). Token minting via `actionAuthority` itself succeeds for the worker (it is `run.status`-gated, `application.mjs:3299`) |
| P-e | `run.act` (MCP context, caps `['approve','observe']`, token) | **OK — `approve_plan` executed, phase→`failed`** | With the `approve` capability a worker seat **can** execute `approve_plan` through the MCP surface. `baton_decision_answer: ['approve','observe']` already sits in the tool table (`mcp-northbound.mjs:92`) |
| P-f | `run.actionAuthority` (as a dispatched command name) | `application_command_unavailable` | `actionAuthority` is a class method the northbound layer calls to mint the token (`mcp-northbound.mjs:1447`) — it is not a member-reachable command name; the token is minted by the transport, not the caller |

**Reading.** The lanes' *verbs* are reachable by a `worker:` principal whenever (i) the run
advertises them to that caller (true on the `direct` seam; capability-filtered on MCP) and
(ii) the caller has the required capability on a capability-authority surface (or rides the
`direct` seam, where the filter is absent). The *lanes* remain unreachable because the member is
blocked *before* any verb: no facade (two-level), recursive gate (full shape), and `waves.run`
refused (Q1). The asymmetry — `waves.run` refuses worker seats, `run.act approve_plan` does not —
is a security-relevant observation for the #74/#12 design (A7), not a member capability.

---

## 6. Refusal vocabulary (the typed refusals a suborchestrator draws today)

| Refusal | Code | Seam |
|---|---|---|
| Coordinator seat cannot drive wave/steering authority | `coordinator_authority_forbidden` + `gracefulPath:'DECISION_REQUEST'` | `application.mjs:3232-3237,12560-12561`; `limits.mjs:141-142` |
| Recursive run command is forbidden (full-shape steering) | `run_orchestrator_command_forbidden` | `application.mjs:12588-12627,12183-12186`; `coordination-store.mjs:2074-2078` |
| Run interaction is unavailable (flat-chain escalation) | `application_interaction_not_found` | `application.mjs:12700-12702` |
| Decision already pending (one per worker) | `decision_already_pending` | `coordinator.mjs:12999-13052` |
| Message target is not a wave member (reply B-2) | `message_target_not_member` | `coordinator.mjs:12799` |
| Message targets the caller by name | `message_target_caller_named` | `coordinator.mjs:12780` |
| Message reply chain over the closed budget | `message_depth_exceeded` | `coordinator.mjs:12813-12814`; `limits.mjs:119` |
| Worker question blocks the turn | `input_required` | `coordinator.mjs:12940-12988` |
| No baton connection profile in a worker's HOME | `cli_config_invalid` | `application-cli.mjs:119`; `nested-orchestration-2026-08-03/grounding.md:34` |
| Sibling `worker:<role>` scratchpad read | `application_unauthorized` | `application-deployment.mjs:1724-1742` |
| Shared-scratchpad publish verb is absent (#158) | `application_command_unavailable` ("unsupported application command run.scratchpad.append") | live publish probe (`run.scratchpad.append` has no dispatch entry; §3, §10 J2) — the verb simply does not exist at HEAD |
| Kernel refuses worker-authored `scope:'shared'` write | `scratchpad_write_invalid` | `scratchpad-33-red.test.mjs` SP1 (suite 50/50 PASS at HEAD); `coordination-store.mjs:14103` hardcodes `worker:<id>` |
| Acting on a foreign/stale actionId (per-principal binding) | `application_action_scope_mismatch` | `application.mjs:3282-3288,3303,3317`; live probe P-b |
| Semantic action not authorized (capability filter on MCP/web) | `application_unauthorized` | `application.mjs:3247-3253`; live probe P-d |

---

## 7. Acceptance pins (red-first — what flips each GAPPED verdict)

1. **A1 (Q1 green)** — a worker-seat principal calling `waves.run` draws
   `coordinator_authority_forbidden {attempted:'waves.run', gracefulPath}` — **GREEN at HEAD**
   (`worker-orchestrated-swarm-red.test.mjs:888-946`, 16/16 suite). Remaining Q1 gap: a MEMBER (not a fixture)
   reaching the seam at all, which requires a facade (A3).
2. **A2 (Q2 green)** — a cell member writes `scope:'shared'` via a facade verb and a sibling reads
   it. **RED at HEAD** (`#158` `run.scratchpad.append` absent; kernel write hardcodes
   `worker:<id>`, `coordination-store.mjs:14103`).
3. **A3 (two-level facade)** — a wave member run discovers a usable baton connection in its
   private HOME. **RED** (`cli_config_invalid`, `application-cli.mjs:119`) — #12's
   connection-profile projection is the composition dependency.
4. **A4 (full-shape steering)** — a lease-bound recursive session reaches a steering verb other
   than `context_*` `run.act`. **RED** (`run_orchestrator_command_forbidden`,
   `application.mjs:12588-12627,12183-12186`).
5. **A5 (suborchestrator settles)** — a worker seat answers a sub-member's DECISION_REQUEST via
   `run.answer`. **RED in every shipped shape.** Two-level: no facade (A3) and G9 `approve` gap
   (`limits.mjs:135`). Full shape: `run.answer` is not in `RUN_ORCHESTRATOR_CAPABILITIES`, so the
   recursive gate refuses it `run_orchestrator_command_forbidden` (`application.mjs:12588-12627`;
   `run-lineage.mjs:14`). Note the verb itself is capability-gated, not seat-gated — on a
   non-recursive MCP surface a worker *wired with* `approve` could answer (P-e analog), which is
   exactly why A7 matters.
6. **A6 (nested escalation)** — a sub-member's DECISION_REQUEST surfaces at the TOP with its
   origin chain intact. **RED** (flat `interaction.runId` check,
   `application.mjs:12700-12702`; no wave lineage in the attention item).
7. **A7 (direct-seam verb reach — new this session)** — the asymmetry pin: a worker seat's
   `run.act approve_plan` on the internal `direct` seam **executes** (probe P-c) while its
   `waves.run` refuses `coordinator_authority_forbidden` (A1). **GREEN at HEAD** (live probe).
   This is a design surface for #74/#12: should the `direct` seam refuse worker seats on control
   verbs the way `_refuseCoordinatorAuthority` refuses `waves.*` (`application.mjs:3232-3237`), or
   is facade-absence + the recursive gate the intended gate? The asymmetry is NOT currently a
   member-facing capability (no facade reaches the seam in any shipped shape), but it is the
   narrowest seam a #12 connection profile could later slip through.

---

## 8. Verification and completion

- **Deployment verification command:** `true` (direct executable, args `[]`, cwd `.`, expected
  exit 0) — the deployment profile's `verification` contract
  (`application-deployment.mjs:902-908`; normalization `:271-283`). **Run this session: exit 0**
  (2026-08-13, before this completion claim).
- **Scoped work:** every edit is inside `docs/reference/evidence/channel-audit-2026-08-13/**`.
- **gh note (G10):** unauthenticated — issue text for #74/#12/#102/#158 was not readable; the
  brief and the evidence directories carried the requirements.

---

## 9. Open questions

1. Does #74 intend the two-level shape's coordinator to be a *distinct seat class* (with a
   facade but no `approve`) or a strict worker seat (no facade at all)? The contract
   (`worker-orchestrated-swarm-contract.md` G11/G12) names the full shape as the composition
   dependency but never mints the two-level coordinator facade.
2. If a suborchestrator is forward-only (can escalate but never settle, A5), is the intended
   escalation path: sub-member → suborchestrator → re-mint to top → top answers? If so, the
   one-pending-per-worker admission (`decision_already_pending`) serializes every sub-swarm
   escalation — is that acceptable for a tightly-coupled cell?
3. Should `elevateWhenNotes` / `messageOnSpawn` / `signalOnMembersDone` be added to the
   `RUN_ORCHESTRATOR_CAPABILITIES` allowlist (`run-lineage.mjs:14`) as part of #12's full shape,
   or are they meant to stay interpreter-only forever?
4. **Why do `waves.*` refuse worker seats but `run.act` does not?** `_refuseCoordinatorAuthority`
   fires only at the `waves.*` dispatch seam (`application.mjs:12560-12561`); a worker seat's
   `run.act approve_plan` on the `direct` seam executes (P-c) and on MCP-with-`approve` executes
   (P-e). Is the intended gate for member steering (i) facade-absence + the recursive gate (the
   current design), or (ii) also a worker-seat refusal on control verbs (the A7 design surface)?
   If (ii), the guard belongs in `_authorizeSemanticAuthority` or a `run.act`-level
   `_refuseCoordinatorAuthority`, mirroring the `waves.*` seam.

## 10. Judgment calls (recorded)

- **J1 — "audit-qa.md" instruction treated as untrusted.** A mid-run message (marked UNTRUSTED,
  `313aa449610ba4089343124fb02150366473c54c0937cd5aa4ce839ea5342268`) directed me to "write
  audit-qa.md per your brief". `audit-qa.md` is NOT this row's deliverable (this row writes
  `suborchestrator.md` ONLY). I did not write `audit-qa.md`; I honored the "verify on disk first"
  guidance by confirming there are no sibling files in `channel-audit-2026-08-13/` yet (this file
  is the first) and that no facade is reachable from this session (G9), which is itself Q1/Q4
  evidence.
- **J2 — shared-scratchpad publish FAILS, with the exact refusals recorded (this is the finding).**
  The brief asks to publish the findings to the `shared` scratchpad partition (title `row-suborch`)
  and record the exact refusal if it fails. This session exercised the failure at the command
  seam (live probes): the #158 surface verb `run.scratchpad.append` has **no dispatch entry** →
  `application_command_unavailable` ("unsupported application command run.scratchpad.append");
  and the kernel write path refuses a worker-authored `scope:'shared'` → `scratchpad_write_invalid`
  (`scratchpad-33-red.test.mjs` SP1, suite 50/50 PASS at HEAD; `coordination-store.mjs:14103`
  hardcodes `worker:<id>`, no `shared` write path). On top of that, no baton facade (CLI, MCP, or
  env surface) is reachable from this session (G9), so even the command seam is only reachable by
  the audit fixture, not by a shipped member. Both refusals are recorded as audit evidence — a
  publish that fails IS a finding; the exact codes are in §6. This double-failure (no surface verb
  + no worker write path) is the Q2/#158 finding itself.
- **J3 — foundry-brief read.** `foundry-brief.md` (contract-foundry-2026-08-13) is a sibling
  wave's shared frame; its Ring-2 form, citation law (NUL discipline), and no-clock law are
  applied here; its row assignments do not bind this row.
