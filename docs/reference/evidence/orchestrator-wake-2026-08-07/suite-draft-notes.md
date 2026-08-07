# #71 Suite Draft Notes — `orchestrator-wake-red.test.mjs`

Date: 2026-08-07 · Contract: **orchestrator-wake v1.1** (folded) · Suite: 33 rows (27 RED / 6 PIN)
Deliverable: `impl/test/orchestrator-wake-red.test.mjs` (this draft's only other deliverable).
Authority: `orchestrator-wake-contract.md` (v1.1 source of truth), `contract-fold.md` (B1 the
two-cursor split — `storeCursor` + `reasonsCursor`, never folded into one token; B2 the
stable-identity `candidacy_review`; the drift/amendment items), `contract-redteam.md` (attack
surface), `suite-71-brief.md` (this suite's brief), and the staging idioms
`impl/test/workflow-surface-red.test.mjs` (facade fixture, `authorityOn` lease ceremony) and
`impl/test/issue10-waiting-vocabulary-red.test.mjs` (the `waitingOn` vocabulary the wake composes
with).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/orchestrator-wake-red.test.mjs   # run from repo root
ℹ tests 33
ℹ pass 6
ℹ fail 27
ℹ cancelled 0  skipped 0  todo 0
```

Recorded at HEAD `e9cdd0c` on 2026-08-07. Two consecutive runs of the finished suite both produced
**pass 6 · fail 27** (run 1 ≈ 9.5 s, run 2 ≈ 9.5 s) — the split is deterministic (the diff of the
`✔`/`✖` spec lines across the two runs is empty). The 6 passes are exactly the six PIN rows
(ALREADY-RESOLVED, WAITING-ON-KINDS-PIN, ATTENTION-TYPES-PIN, LIMITS-PIN, STORE-VISIBLE,
EXISTING-PINS); the 27 failures are the red rows, each confirmed to fail at its NAMED stage — the
per-row stage lives in the header row inventory AND in each row's first-failing assertion message
(verified mechanically: 27/27 RED rows carry a `stage[…]` assertion).

## Row map

Every red row fails at the named stage at HEAD and goes green on the v1.1 implementation ONLY.
Stages in **bold** are the current HEAD failure seam. All RED rows' first assertion is an
`assert.ok(...)` (or a non-vacuous shape check), so the row fails at the stage — never on a vacuous
assertion over an `undefined` surface. The default seam, `attention-wait-command-missing`, is the
application dispatch tail (application.mjs:12440-12467): the `attention.wait` command is absent, so
`application.command('attention.wait', …)` throws `application_command_unavailable` before any
state is read.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| WAIT-DISPATCH | §A | | **attention-wait-command-missing** | `application.command('attention.wait', …)` throws `application_command_unavailable` (application.mjs:12467) — the dispatch has no wake branch |
| WAIT-HONEST-EMPTY | §A D1.3 | | **attention-wait-command-missing** | same — no dispatch, so the honest empty `{woken:false, timedOut:true, …}` is unreachable |
| WAIT-PLAN-APPROVAL | §A D2.1 | | **attention-wait-command-missing** | same — a run awaiting plan approval has no wake to page `plan_approval` |
| DECISION-PARK-WAKES | §B D2/W-1 | | **attention-wait-command-missing** | same — a registered waiter never wakes on the decision park |
| DECISION-FIRST-SHAPE | §B D2.1 | | **attention-wait-command-missing** | same — the decision-first `actions[0]` shape (projectDecisionAttention + answer address) cannot be read |
| ANSWER-FROM-WAKE | §B D2.2/W-3 | | **attention-wait-command-missing** | same — no item to answer; the `applied` receipt path is not reachable from a wake |
| REVALIDATED | §B D2.3 | | **attention-wait-command-missing** | same — a decision answered between event and delivery cannot be proven never-delivered |
| CURSOR-SHAPE | §C B1 | | **attention-wait-command-missing** | same — the split `storeCursor`/`reasonsCursor` tokens are never produced |
| RETURN-TRIP | §C B1/D1.6 | | **attention-wait-command-missing** | same — a return-trip wake with the prior cursors cannot re-see `member_terminal` |
| REASONS-ALONE | §C D1.3 | | **attention-wait-command-missing** | same — a reason-only mint (actions `[]`) is unobservable |
| CANDIDACY-WAKE | §D D1.2/B2 | | **attention-wait-command-missing** | same — the board-close candidacy never rides a wake as a `candidacy_review` reason |
| CANDIDACY-HONEST-EMPTY | §D D1.3/B2 | | **attention-wait-command-missing** | same — the stable-identity honest empty (re-paging emits nothing) is unreachable |
| CANDIDACY-REFRESH | §D B2 | | **attention-wait-command-missing** | same — a count change cannot be shown refreshing the SAME seq |
| WORKER-REFUSED | §E D3 | | **attention-wait-command-missing** | no wake exists to run `_attentionScopeAuthorized` (coordinator.mjs:7062-7066) against — the row asserts the wake must exist to authorize |
| TWO-WAITERS | §E D3 | | **attention-wait-command-missing** | both waiters (owner + live lease holder) must dispatch; neither can (the D3 authority check itself is GREEN at HEAD, coordinator.mjs:7062-7083) |
| REPLY-NO-WAKE | §F W-5 | | **attention-wait-command-missing** | same — a reply-chain hop's honest-empty (no wake) cannot be asserted |
| BLOCKING-ESCALATES | §F W-5 | | **attention-wait-command-missing** | same — a blocking `question.asked` cannot escalate as an `answer_question` item |
| WAKE-REASONS-SET | §G W-6 | | **WAKE_REASONS-missing** | application-semantics.mjs exports NO `WAKE_REASONS` literal — the closed eight is not a typed surface constant |
| MCP-TOOL | §H D4 | | **baton-attention-wait-tool-missing** | `mcpApplicationToolNames()` (mcp-northbound.mjs:2170) includes no `baton_attention_wait` |
| MCP-SCHEMA-CAPABILITY | §H D4 | | **baton-attention-wait-tool-missing** | no ordinary MCP tool row `name:'baton_attention_wait'` with the `{storeCursor, reasonsCursor}` inputSchema and the `observe` capability map entry |
| WEB-ENVELOPE | §H D4 | | **web-envelope-missing** | `validateWebCommandEnvelope` (web-northbound.mjs:1838) returns `'unsupported command'` for `attention_wait` |
| WEB-CEILING | §H D4 | | **web-envelope-missing** | the envelope is not admitted, so the 30 s ceiling (web-northbound.mjs:366) never applies its wake-named code |
| CLI-GRAMMAR | §H D4 | | **cli-grammar-missing** | `parseBatonCli(['run','attention','wait',…])` throws `'expected attention watch'` (application-cli.mjs:1400-1419) |
| OVERSIZE-REFUSAL | §I D6 | | **attention-wait-command-missing** | no dispatch, so a payload past the frame cap cannot refuse `application_attention_wait_oversize` |
| ACTIONS-SLICE | §I H6 | | **attention-wait-command-missing** | the application dispatch has no `attention.wait` branch to slice `MAX_ATTENTION` (a source-pin row — see below) |
| WAIT-INVALID | §K D6 | | **attention-wait-command-missing** | no wake exists to validate; a malformed `runId` cannot draw the NEW `attention_wait_invalid` code |
| MCP-ALLOWLIST | §K H8 | | **mcp-allowlist-missing** | the `stateFailureCode` allowlist (mcp-northbound.mjs:200-268) lacks `attention_wait_invalid` — the code has NO `application_` prefix, so the `application_` pass-through (:205) will not carry it |
| ALREADY-RESOLVED | §B D2.2 | PIN | run.answer-receipt | green today — `applied` then `already_resolved` on the late answerer; NO `resolvedBy` on the loser (see PIN list) |
| WAITING-ON-KINDS-PIN | §G W-6 | PIN | waitingOn-vocabulary | green today — the #10 closed five byte-unchanged in ACTUAL sorted order |
| ATTENTION-TYPES-PIN | §G W-6 | PIN | inbox-vocabulary | green today — the #10-era inbox five byte-unchanged in ACTUAL order |
| LIMITS-PIN | §I W-8 | PIN | decision/view-limits | green today — the five W-8 frame rows byte-unchanged |
| STORE-VISIBLE | §J W-9 | PIN | store-seq-advances | green today — plan proposal + candidacy admission advance the store seq (a decision park is store-invisible at HEAD — see PIN list) |
| EXISTING-PINS | §K | PIN | existing-refusals | green today — `attention_scope_forbidden` and `application_attention_watch_invalid` survive byte-identical |

## Invented surfaces

All invented members are probed through namespace imports or REAL surface entry points, per suite
law. Every invented member is absent at HEAD (the seam the red row holds); the first assertion on
each is an `assert.ok(...)`, so the row fails at the named stage — never on a shape assertion a
`undefined` could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `attention.wait(runId, {afterCursor:{storeCursor, reasonsCursor}, timeoutMs}, principal)` — the wake command surface | `application.command('attention.wait', …)` | throws `application_command_unavailable` (all §A-§K dispatch rows) |
| `applicationSemanticsNs.WAKE_REASONS` — the frozen ACTUAL-sorted closed eight | namespace import `* as applicationSemanticsNs` | no such export (WAKE-REASONS-SET) |
| `validateWebCommandEnvelope` (web-northbound.mjs:1838, the exported `validateEnvelope`) — the web command envelope | real export | returns `'unsupported command'` for `attention_wait` (WEB-ENVELOPE/WEB-CEILING) |
| `parseBatonCli` — the `run attention wait` verb grammar | real export (index.mjs) | throws `'expected attention watch'` (CLI-GRAMMAR) |
| `mcpApplicationToolNames()` — the `baton_attention_wait` ordinary tool row | real export (mcp-northbound.mjs:2170) | `baton_attention_wait` absent (MCP-TOOL/MCP-SCHEMA-CAPABILITY) |
| the `stateFailureCode` `attention_wait_invalid` row | source-grep of mcp-northbound.mjs (readFileSync — NUL-safe) | absent (MCP-ALLOWLIST) |
| the dispatch `attention.wait` branch + `slice(0, MAX_ATTENTION)` actions builder | source-grep of application.mjs (readFileSync — NUL-safe) | no `'attention.wait'` index (ACTIONS-SLICE) |

Existing surfaces probed for PINs stay as-is: `WAITING_ON_KINDS` (application-semantics.mjs:59,
frozen five), `ATTENTION_TYPES` (messages.mjs:18, frozen five), `FRAME_LIMITS` (limits.mjs:110,
W-8 rows), `coordinator.attentionFollow` (`attention_scope_forbidden`), and
`application.command('run.attention.watch', …)` (`application_attention_watch_invalid`).

## Staging (what each RED row drives)

- **The wake fixture** (`wakeFixture`) builds a real `BatonApplication` over a `createDriver` with
  `goalPlanAuthority` ON, one `ScriptableAdapter` (or a `WorkflowAdapter` — a MockAdapter subclass
  whose `emit` shim lets the test inject harness telemetry) and a wave-shaped run
  (`driverKind:'wave'`). `startWaveRun` starts the run and approves its plan digest — the wave run
  gates on `awaiting_plan_approval` and the member dispatches only after approval (verified at
  HEAD). `approve:false` leaves the run pre-approval for WAIT-PLAN-APPROVAL.
- **The decision park** is driven through the REAL scenario path: `WorkflowAdapter(DECISION_SCENARIO)`
  parks a `decision.requested` interaction on the member turn; it surfaces via
  `application.decisionList` → `projectDecisionAttention` (application.mjs:575-599) and the
  coordinator's interaction lane. The blocking-question park uses the same path with the
  `answer_question` scenario and `application.status`'s `blockedInteraction`.
- **The reason mints** are harness-telemetry-driven: `lifecycle.turn_completed` on a dispatched
  worker mints `member_terminal` (storm-coalesced within `ATTENTION_COALESCE_WINDOW_MS = 500`); a
  SECOND emit past the 500 ms window on an already-terminal worker is a REASON-ONLY mint (D1.6) —
  no store append, a fresh reason seq. RETURN-TRIP and REASONS-ALONE rely on this.
- **The candidacy** is admitted via `addKnowledgeNode` with `promotion.trigger:'board.item_closed'`;
  the evidence `coordinationSeq` must reference a PRIOR store event (`ref.coordinationSeq <
  eventSeq`, coordination-store.mjs:15760), so `admitCandidacy` binds it to the current head at
  admission time. The admission lands in the repo-scoped `knowledgeCandidateQueue`.
- **The D3 lease ceremony** (`authorityOn`) is the workflow-surface fixture: an orchestrator task
  carrying `capabilities:['baton_orchestrator']` on the wave `runId`, a claimed worker, and an
  issued `run.orchestrator_lease` binding `{principalId, sessionId, authorityDigest}`. The store's
  `createTask` path is gated by `_goalPlanPolicy.mandatory` (`goal_plan_required`), so the suite
  fixture runs `mandatory:false` — plan approval is still REQUIRED (verified: the run gates on
  `awaiting_plan_approval` and the member dispatches only after approve), but the gate no longer
  blocks the lease's direct `createTask` (no approved plan node can carry a `baton_orchestrator`
  capability, so the plan-gated `createPlanGatedTask` dispatch is unusable for it). TWO-WAITERS then
  has the wave-owner AND a live lease holder page the same decision item concurrently.

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **P1 ALREADY-RESOLVED** (§B D2.2) | an impl that changes the `run.answer` receipt shape — `applied` first, `already_resolved` on the late answerer — or fabricates a `resolvedBy` on the loser (at HEAD `already_resolved` carries NO `resolvedBy`: `resolvedByRecord` never populates, so the pin asserts only `command`/`requestId`/`result`) |
| **P2 WAITING-ON-KINDS-PIN** (§G W-6) | an impl that perturbs the #10 closed five (`capacity_ceiling`, `dispatch_pending`, `plan_approval`, `provider_stalled`, `spawning`) or their ACTUAL sorted order — `decision_pending` stays OUT (G7) |
| **P3 ATTENTION-TYPES-PIN** (§G W-6) | an impl that perturbs the #10-era inbox vocabulary (`approval`, `question`, `blocked`, `stalled`, `budget_alarm`) or its ACTUAL order (G8) |
| **P4 LIMITS-PIN** (§I W-8) | an impl that changes `decision.question` 2048, `decision.option.label` 160, `decision.option.summary` 512, `decision.text` 4096, or `view.attention_text.bytes` 4096 |
| **P5 STORE-VISIBLE** (§J W-9) | an impl that stops advancing the store seq on a plan proposal (`plan.version_proposed`) or a candidacy admission (`knowledge.node_added`) — W-9's guarantee that every wake-worthy change is store-visible. **Draft-notes correction:** a decision park is STORE-INVISIBLE at HEAD (no new `coordination.events()` after the park — W-9's "decision park advances the store seq" parenthetical is ASPIRATIONAL), so the pin asserts ONLY the two transitions that genuinely append |
| **P6 EXISTING-PINS** (§K) | an impl that breaks `attention_scope_forbidden` (a stranger on `attentionFollow` is refused by name) or `application_attention_watch_invalid` (the page-read normalizer stays byte-identical) |

## What makes each stage go green (implementer's checklist)

- **attention-wait-command-missing** → D1/D2/D3: add an `'attention.wait'` branch to the
  application dispatch tail (application.mjs:12440-12467) that (1) runs the D3 authority check
  (`_attentionScopeAuthorized`: wave-owner always; runId null → any authenticated; run-scoped →
  the live lease holder via `_isReviewAuthority`), (2) long-polls `waitAfter` on
  coordination-store.mjs:8843 with `{storeCursor, reasonsCursor}` (B1 — never folded into one
  token), and (3) composes the woken payload `{schemaVersion:1, woken:true, runId, storeCursor,
  reasonsCursor, actions, reasons, waitingOn, wave:{state, waveId}, timedOut:false}` (the 
  `projectDecisionAttention`-plus-answer-address items first, D2) or the honest empty
  `{woken:false, timedOut:true, storeCursor, reasonsCursor, actions:[], reasons:[]}` on the
  transport bound (D1.3). Refusals name their codes: `attention_scope_forbidden`,
  `attention_wait_invalid` (NEW — no `application_` prefix), `application_attention_wait_oversize`
  (a serialized payload past `policy.maxResponseBytes`, the application.mjs:8307 precedent).
- **WAKE_REASONS-missing** → W-6: `application-semantics.mjs` exports the frozen
  `WAKE_REASONS` literal `['answer_approval','answer_decision','answer_question','budget_alarm',
  'candidacy_review','member_terminal','plan_approval','wave_terminal']` in ACTUAL sorted order
  (a `sort()`/`localeCompare`-derived order is a violation; no `message_reply` kind, D1.2). The
  reasons composer reads from it: `member_terminal`/`candidacy_review` (the coordinator attention
  reasons, G4), `budget_alarm` (the BD3-D digest wake reason, G8/B3), `wave_terminal` (the #132
  registry `state:'closed'`, G9), and the answer/approval classes from the decision/plan items.
- **candidacy_review stable identity** (B2, folded) → mint `candidacy_review` ONCE into
  `_attentionReasons` (a stable seq), refresh count/candidates IN PLACE only on a queue-count
  change, and page it by `reason.seq <= reasonsCursor` exactly like `member_terminal` — never the
  per-page-read live mint at coordinator.mjs:7098-7117. This is what makes the honest empty
  REACHABLE for a run with a live candidacy queue (CANDIDACY-HONEST-EMPTY) and what keeps a
  refresh at the SAME seq (CANDIDACY-REFRESH).
- **return-trip / reason-only** (B1/D1.6) → the split cursors must page the store and the
  `_attentionReasons` space independently; a reason-only mint past `ATTENTION_COALESCE_WINDOW_MS`
  must NOT depend on a store append, and re-waking with the prior cursors must re-see
  `member_terminal` (the mixed-cursor invisibility is dead).
- **no claim-on-read** (D3.2/W-4) → two waiters on the same run both page the same items; the
  first answer receipts `applied`, the loser `already_resolved`. The authority admission is already
  GREEN at HEAD — the fold must not regress it.
- **baton-attention-wait-tool-missing** → D4.1: `mcpApplicationToolNames()` includes
  `baton_attention_wait`; the ordinary MCP tool row carries the split-cursor `inputSchema`
  (`storeCursor` + `reasonsCursor`) and the capability map entry `baton_attention_wait: ['observe']`
  (mcp-northbound.mjs:112 precedent).
- **web-envelope-missing** → D4.2: `validateWebCommandEnvelope` admits `attention_wait`; a
  `timeoutMs` past the 30 s ceiling refuses by `application_attention_wait_timeout_exceeds_web_ceiling`
  (web-northbound.mjs:366 precedent).
- **cli-grammar-missing** → D4: `parseBatonCli(['run','attention','wait', runId, '--timeout',
  '--store-cursor', '--reasons-cursor', '--kind'])` maps to the `attention.wait` command with the
  flat `{runId, timeoutMs, storeCursor, reasonsCursor, kind}` args.
- **mcp-allowlist-missing** → H8: the `stateFailureCode` allowlist (mcp-northbound.mjs:200-268)
  carries `attention_wait_invalid` — because it has no `application_` prefix, the `application_`
  pass-through (:205) will not carry it, so it needs its own row (the `attention_scope_*` :246
  precedent).
- **ACTIONS-SLICE** (H6) → the wake actions builder slices to `MAX_ATTENTION` at the dispatch; the
  remainder spills as a head+digest. This row is a SOURCE pin: the wake is absent at HEAD, so the
  slice cannot be exercised behaviorally — the row reads the dispatch source (readFileSync,
  NUL-safe) for the `'attention.wait'` branch and the `slice(0, MAX_ATTENTION)` pattern in the
  wake region.

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter/WorkflowAdapter (no harness, no network) + mkdtemp worktrees and
  logs; `test.after` cleanup (best-effort teardown even across RED setup interruptions); the
  deployment-verification stub is the brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (an
  `assert.ok`/`typeof` for invented surfaces, a behavior assertion for the seam rows); the stage
  names live in the header row inventory AND in each row's assertion message. 27 RED rows / 6 PINs,
  stable across two consecutive runs (verified mechanically).
- **NUL discipline**: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each) are NEVER
  read whole — the ACTIONS-SLICE and MCP-ALLOWLIST rows read them with `readFileSync` (never a shell
  pipeline) and only slice a fixed region around the target index; every other surface is reached
  through imports. The suite file itself is NUL-free.
- **No clocks as workflow controls / no wall-clock assertion**: `timeoutMs` is only the transport
  bound; the reason-only mint's `sleep(600)` is a COALESCING-window bypass (a real,
  `ATTENTION_COALESCE_WINDOW_MS`-sized pause required to escape the storm-coalesce), never a
  workflow gate. No row asserts a wall-clock behavior; `Date.now()` never appears.
- **No `localeCompare`**; every sorted-key literal (`WAKE_REASONS_SORTED`, `WOKEN_KEYS`,
  `HONEST_EMPTY_KEYS`, `WAITING_ON_KINDS_SORTED`, `ATTENTION_TYPES_ACTUAL`) is written in ACTUAL
  sorted order and asserted against frozen constants.
- **Fixture choice documented**: `GOAL_PLAN_POLICY` runs `mandatory:false` (plan approval still
  required and exercised; the `createTask` gate relaxed) because the D3 lease-holder staging
  requires a `baton_orchestrator` parent task that no approved plan node can carry — the suite
  must not trip the existing goal-plan gate while staging the wake's own capabilities.
