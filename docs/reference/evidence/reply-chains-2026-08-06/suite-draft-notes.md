# #105 Suite Draft Notes — `reply-chains-red.test.mjs`

Date: 2026-08-06 · Contract: **reply-chains v1.1** (folded) · Suite: 25 rows
Deliverable: `impl/test/reply-chains-red.test.mjs` (this draft's only other deliverable).
Authority: `reply-chains-contract.md` (v1.1 source of truth), `contract-fold.md` (B-1..B-7),
`contract-redteam.md` (attack surface), `suite-105-brief.md` (this suite's brief).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/reply-chains-red.test.mjs   # run from repo root
ℹ tests 25
ℹ pass 5
ℹ fail 20
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the suite was finalized (the G1 live-handle fix landed). Two consecutive runs of the
finished suite both produced **pass 5 · fail 20** — the split is deterministic. The 5 passes are
exactly the five PIN rows (A1, G1, H2, H6, H7); the 20 failures are the red rows, each confirmed to
fail at its NAMED stage (the per-row stage is in the header and in each row's assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.1 implementation ONLY. Stages
in **bold** are the current HEAD failure seam.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | Budget | PIN | default-1 byte-identity | green today — a plain send admits exactly one reply (slot law) and a reply-to-reply refuses `message_depth_exceeded` |
| A2 | Budget | | **chain-dies-at-r1** | a reply to a reply refuses at depth 1 (coordinator.mjs:12533-12535) — the 3-deep exchange dies at r1; budget is ignored |
| A3 | Budget | | **exhaustion-payload-missing** | the depth-exhaustion refusal payload is `{reason, inReplyTo, depth}` only (coordinator.mjs:12534) — no `budget`/`remaining` |
| A4 | Budget | | **send-budget-refusal-missing** | `sendMessage` destructures `{kind, to, body}` — a `budget: 0` / `budget: 9` send resolves, never `message_budget_invalid` |
| A5 | Budget | | **lane-shape-authority-missing** | budget `1.5` / `'3'` resolve — the lane never shape-checks the budget |
| A6 | Budget | | **budget-count-missing** | the send outcome carries no budget; the receipt carries no depth/budget/remaining |
| B1 | Walk | | **per-hop-depth-missing** | `messageReceipt` returns `{delivered, read, actedOn, reply}` — no per-hop depth fields |
| B2 | Walk | | **target-inheritance-missing** | reply records mint `target: {workerId: null}` (coordinator.mjs:12580) → `messageRunId(r1)` → null → the facade refuses `application_unauthorized`; the walk dies at the first hop |
| C1 | Member | | **membership-check-missing** | a foreign worker's reply is ADMITTED (fills the slot); no `message_target_not_member` exists |
| D1 | Per-branch | | **per-branch-budget-missing** | budget ignored; no per-branch constant to inherit |
| D2 | Per-branch | | **max-budget-constant-missing** | `limits.mjs` exports no `MAX_MESSAGE_DEPTH_BUDGET` |
| E1 | Replay | | **reply-row-absent** / **root-row-depth-missing** | replies are worker-log `appendAttributed` only, never store-audited `message.delivered` rows; root rows carry no depth/budget/remaining |
| E2 | Replay | | **alias-row-undifferentiated** | the legacy alias row carries `alias: true` + key `message.sent:<workerId>:<tail>` but no depth/budget/remaining to skip on (coordinator.mjs:7409-7421) |
| F1 | Observability | | **lastRefusal-absent** | `messageReceipt` has no `lastRefusal`; `message.rejected` is stream-only |
| F2 | Observability | | **facade-double-gate** | the facade's closed key set rejects `budget` → `application_message_send_invalid`, masking the lane's authority (application.mjs:12512) |
| F3 | Observability | | **allowlist-missing** | `stateFailureCode` (mcp-northbound.mjs:198-261) knows no `message_budget_invalid` |
| G1 | Escalation | PIN | interaction-lane | green today — blocking `question.asked` transitions the task to `input_required` (coordinator.mjs:12614-12631); a reply never transitions a phase |
| G2 | Escalation | | **lastRefusal-absent** | the stalled chain's exhaustion is not orchestrator-readable (stream-only refusal); re-rooting works but the observation surface is missing |
| H1 | Facade | | **facade-budget-missing** | `run.message.send` rejects the `budget` key (`application_message_send_invalid`); no budget on the outcome, no depth fields on the receipt |
| H2 | Facade | PIN | command-table byte-stability | green today — the eight message-lane direct ports are not `APPLICATION_COMMAND_DEFINITIONS` keys |
| H3 | MCP/web | | **mcp-message-budget-missing** | `baton_run_message_send` schema has no `budget` property (mcp-northbound.mjs:585-593) |
| H4 | MCP/web | | **mcp-message-budget-missing** | a `budget` argument dies at the generic key-closure as `unknown_argument_field` (mcp-northbound.mjs:898) |
| H5 | MCP/web | | **web-mapper-branch-missing** | web-northbound.mjs has zero `message_budget_invalid` references (dispatchFailure:149-232) |
| H6 | MCP/web | PIN | closed enums | green today — `WAITING_ON_KINDS` (closed five) and `BLOCKING_INTERACTION_KINDS` (closed three) are byte-unchanged; a replied worker is mid-turn working with `waitingOn` null |
| H7 | MCP/web | PIN | wire asymmetry | green today — the scanner rejects any reply frame with an extra `budget` field (closed sorted-key literal `'body,inReplyTo'`) |

## Invented surfaces

No invented module is imported. Every invented member is probed through a REAL surface entry point
and is absent from the surface at HEAD (the seam the red row holds):

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `sendMessage({kind, to, body, budget}, auth)` — declared budget on the lane send | `Coordinator.sendMessage` | destructures `{kind, to, body}`; budget ignored (A2/A4/A5) |
| `messageReceipt().depth/.budget/.remaining/.lastRefusal` | `Coordinator.messageReceipt` | `{delivered, read, actedOn, reply}` only (A6/B1/F1) |
| reply envelope `{depth, budget, remaining}` | `messageReceipt(parent).reply` | envelope closed `{messageId, inReplyTo, from, body}` (B1) |
| refusal payload `{budget, remaining}` | worker `message.rejected` event | `{reason, inReplyTo, depth}` only (A3) |
| worker-stream `message_target_not_member` | worker `message.rejected` event | no membership check; the foreign reply lands (C1) |
| send outcome `.budget` | `run.message.send` outcome | facade rejects the budget key (H1) |
| durable reply rows (`message.delivered` with `inReplyTo`) | `coordinationForLog(...).events()` | replies are worker-log `appendAttributed` only (E1) |
| `MAX_MESSAGE_DEPTH_BUDGET` (limits.mjs) | namespace import `* as limits` | no such export (D2) |
| `run.message.receipt {depth, budget, remaining, lastRefusal}` | `BatonApplication.command` | `{delivered, read, actedOn, reply}` only (H1/B2/F1) |
| `baton_run_message_send` inputSchema `budget` | `McpFleetServer tools/list` | schema closed (H3); a budget argument → `unknown_argument_field` (H4) |
| web `dispatchFailure` `message_budget_invalid` branch → 400 | source read of web-northbound.mjs | zero references (H5) |

`laneSendCode(coordinator, args, auth)` is the lane-refusal seam for A4/A5: it awaits
`coordinator.sendMessage` and returns `'resolved'` on success or `error.code` on throw — so the rows
fail on the code identity (`'message_budget_invalid'`), not on the mechanism (throw vs refusal).

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A1** default-1 byte-identity | a default other than 1 — `budget: 0` admits nothing (r1 null) or `budget: 2+` admits a reply-to-reply (the second refusal never fires) — changing today's admission decision |
| **G1** blocking → interaction lane | a machine-readable blocking marker riding the reply frame (violates RC-11 wire asymmetry) or a reply transitioning a task phase |
| **H2** command-table byte-stability | message ports registered as `APPLICATION_COMMAND_DEFINITIONS` entries (breaks the direct-port law, G7) |
| **H6** closed waiting enums | a new `waitingOn` kind for chains or a reply routed into `BLOCKING_INTERACTION_KINDS` |
| **H7** wire asymmetry | the scanner accepting `budget`/extra fields in the reply frame (a worker setting a budget) |

## What makes each stage go green (implementer's checklist)

- **chain-dies-at-r1 / per-hop-depth-missing / budget-count-missing** → D1/D2/D4: the lane admits a
  reply when `parent.depth < (parent.budget ?? 1)`; the reply record gains `depth: parent.depth + 1`,
  `budget: parent.budget`, `remaining: budget - depth`; the reply envelope and every
  `messageReceipt` carry `{depth, budget, remaining}`; the send outcome carries `.budget`.
- **exhaustion-payload-missing** → D3: the depth-exhaustion refusal carries `{reason,
  message_depth_exceeded, inReplyTo, depth, budget, remaining}` (remaining `0`).
- **send-budget-refusal-missing / lane-shape-authority-missing / facade-double-gate** → B-5b: the
  lane is the single budget authority — the facade passes `budget` raw (`_normalizeMessageSend`
  closed key set gains `'budget'`, value passed verbatim, `budget: value.budget ?? 1`); the lane
  throws `message_budget_invalid` for any value outside `[1, MAX_MESSAGE_DEPTH_BUDGET]` or a
  non-safe-integer — never `application_message_send_invalid`.
- **target-inheritance-missing** → B-1: the reply record carries `target: parent.target` verbatim;
  every hop resolves through `messageRunId` to the root's run under resolve-then-authorize.
- **membership-check-missing** → B-2: a reply whose `from` is not a member of `parent.target`'s run
  refuses `message_target_not_member` BEFORE the depth/slot checks; the slot is never consumed and a
  budget hop never spent by a non-member.
- **per-branch-budget-missing / max-budget-constant-missing** → B-3/D1: the budget is a per-branch
  constant (inherited verbatim; only `remaining` counts down); sibling branches each get the full
  depth; a fresh root send re-roots with a full budget. `MAX_MESSAGE_DEPTH_BUDGET = 8` (closed,
  power of two, the smallest strictly above the 3-deep acceptance exchange).
- **reply-row-absent / alias-row-undifferentiated** → B-4: reply hops are store-audited
  `message.delivered` rows carrying `inReplyTo` (idempotency-keyed `message.delivered:<replyId>:
  <workerId>`); root `message.sent` rows carry `{depth: 0, budget, remaining}`; legacy alias rows
  (`alias: true`, key `message.sent:<workerId>:<tail>`) are replay-skipped; `parent.reply` re-links
  from the rows. The `_replay()` topology rebuild is the invented surface the rows pin the shape of.
- **lastRefusal-absent** → B-5a: after a refusal, the refusing parent's receipt carries
  `lastRefusal {reason, depth, budget, remaining}` — at the lane and through `run.message.receipt`.
- **allowlist-missing / web-mapper-branch-missing** → D3/D7: `message_budget_invalid` is the ONE new
  code in `stateFailureCode` (MCP) and the web `dispatchFailure` gains a 400 branch; the worker-stream
  codes (`message_depth_exceeded`, `message_target_not_member`, `message_parent_not_found`) stay
  absent from both surfaces.
- **mcp-message-budget-missing** → D7: `baton_run_message_send` schema gains optional `budget
  {integer, minimum: 1, maximum: 8}`; a budget argument routes through the lane so an out-of-range
  value surfaces `message_budget_invalid`, never `unknown_argument_field` /
  `command_outcome_unknown`.

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter (no harness, no network), `mkdtempSync` repos/logs, global
  `test.after` cleanup; the MCP fixture uses `McpFleetServer.handle` in-process (no live server);
  the verification command is the brief's `true` stub.
- **NUL discipline**: the two NUL files are never read whole — `application.mjs` only through the
  imported `APPLICATION_COMMAND_DEFINITIONS` export (H2) and the facade fixture;
  `coordination-store.mjs` only through the imported `CoordinationStore`/`coordinationForLog`
  (E1/E2). All other sources are NUL-free and read whole for the source pins (mcp-northbound.mjs F3,
  web-northbound.mjs H5, wave-driver.mjs H6). The suite file itself is NUL-free (0 NUL bytes).
- **No clocks**: the budget is a count, never a clock (D1) — the only timestamps are the fixed `NOW`
  constant and the fixed `now: () => 0` clock passed to the surfaces; no `Date.now()` in the suite.
- **No `localeCompare`**; the one sorted-key literal (`'body,inReplyTo'`, H7) is in ACTUAL sorted
  order and asserted via the real scanner export.
