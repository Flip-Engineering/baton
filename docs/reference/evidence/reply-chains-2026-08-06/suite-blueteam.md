# Reply-chains (#105) red-first suite — blue-team verification report

Contract: `docs/reference/evidence/reply-chains-2026-08-06/reply-chains-contract.md` (v1.1,
verification HEAD `d7879f2`) + `contract-fold.md` (B-1..B-7).
Suite: `impl/test/reply-chains-red.test.mjs` (25 rows: 5 PINs, 20 red).
Date: 2026-08-06. Verifier: blue team (independent of the suite author and the contract author).
Verified against the current worktree HEAD `82b1113` (Baton effective-tree snapshot; the
contract's `impl/src` is byte-identical at its pinned HEADs).

**Verdict: NEEDS-FOLD.** The run split is exactly as claimed (pass 5 · fail 20, stable across two
consecutive runs from the repo root), every red row fails at its own named stage at HEAD, the
suite is hermetic and clock-free, and all five PINs are green for legitimate reasons. But one red
row — **E2** — is **provably un-passable as written**: its oracle contradicts the contract's own
folded alias-row shape, so it can never go green on a CORRECT v1.1 implementation (the #132
F1-F3 class). Four further red rows are satisfiable by a plausible wrong implementation without
the named behavior: **C1** leaves the B-2 run-membership *admission* clause unexercised, **E1/E2**
pin durable-row shape only and never a fresh-store `_replay()` rebuild, the **parent-exists**
leg of the B-2 admission order is unpinned, and the **RC-11 wire-asymmetry** PIN probes only
`budget`. Blocker and teeth are numbered at the end.

---

## 1. Run record (exact)

Two consecutive runs from the repo root:

```
$ node --test impl/test/reply-chains-red.test.mjs
ℹ tests 25
ℹ pass 5
ℹ fail 20
ℹ cancelled 0  skipped 0  todo 0
```

Stable across both runs (identical 5/20 split). The 5 passes are exactly the five PIN rows (A1,
G1, H2, H6, H7). The 20 failures are the red rows; each fails at its named stage at HEAD (the
named stage is in the row header and in each assertion message; the first-failing-assertion line
is cross-referenced against the test source below):

| Row | Stage (HEAD seam) | Fails at line | Failing assertion (current HEAD truth) |
|---|---|---|---|
| A2 | chain-dies-at-r1 | 435 | `r2` truthy — a reply to a reply refuses at depth 1 (`coordinator.mjs:12533-12535`), budget ignored |
| A3 | exhaustion-payload-missing | 463 | refusal payload deep-equal `{reason,inReplyTo,depth,budget,remaining}` — HEAD emits `{reason,inReplyTo,depth}` only (`coordinator.mjs:12534`) |
| A4 | send-budget-refusal-missing | 472 | `budget: 0` → `'message_budget_invalid'` — `sendMessage` destructures `{kind,to,body}` (`coordinator.mjs:6829`), budget resolves |
| A5 | lane-shape-authority-missing | 483 | `budget: 1.5` → `'message_budget_invalid'` — the lane never shape-checks the budget |
| A6 | budget-count-missing | 494 | `root.budget === 3` — send outcome carries no budget; receipt has no depth/budget/remaining (`coordinator.mjs:6972-6994`) |
| B1 | per-hop-depth-missing | 520 | `rootReceipt.depth === 0` — `messageReceipt` returns `{delivered,read,actedOn,reply}` only |
| B2 | target-inheritance-missing | 550 | `messageRunId(r1) === 'run:b2'` — reply records mint `target:{workerId:null}` (`coordinator.mjs:12580`) → null |
| C1 | membership-check-missing | 572 | foreign reply reason `'message_target_not_member'` — no membership check exists; the foreign reply lands |
| D1 | per-branch-budget-missing | 599 | `branchRoot.budget === 3` — budget ignored; no per-branch constant to inherit |
| D2 | max-budget-constant-missing | 621 | `limits.MAX_MESSAGE_DEPTH_BUDGET === 8` — `limits.mjs` has no such export (0 hits) |
| E1 | root-row-depth-missing | 643 | `sentRow.payload.depth === 0` — root `message.sent` row is `{messageId,kind,from,to,body,targetCount}` |
| E2 | alias-row-undifferentiated | 672 | `alias.payload.depth === 0` — the alias row carries no depth/budget/remaining (`coordinator.mjs:7409-7421`) |
| F1 | lastRefusal-absent | 701 | `messageReceipt(r1).lastRefusal` deep-equal — no `lastRefusal` on the receipt (`coordinator.mjs:6972-6994`) |
| F2 | facade-double-gate | 717 | `half.code === 'message_budget_invalid'` — facade key-closure rejects `budget` → `application_message_send_invalid` (`application.mjs:12512-12537`) |
| F3 | allowlist-missing | 725 | `stateFailureCode` source includes `'message_budget_invalid'` — absent (`mcp-northbound.mjs:198-261`) |
| G2 | lastRefusal-absent | 774 | stall observable via `lastRefusal` — stream-only at HEAD |
| H1 | facade-budget-missing | 798 | `run.message.send` outcome `.budget` — facade rejects the `budget` key (`application.mjs:12512`) |
| H3 | mcp-message-budget-missing | 822 | `baton_run_message_send` schema has a `budget` property — absent (`mcp-northbound.mjs:585-593`) |
| H4 | mcp-message-budget-missing | 840 | `budget: 9` → `message_budget_invalid` — dies at the key-closure as `unknown_argument_field` (`mcp-northbound.mjs:898`) |
| H5 | web-mapper-branch-missing | 846 | web `dispatchFailure` source includes `'message_budget_invalid'` — zero references (`web-northbound.mjs:149-232`) |

**Every red row fails at its own named stage** — verified by cross-referencing each failing
assertion line against the test source; none fails on a fixture/setup error before the named
assertion (the `laneFixture`/`facadeFixture`/`mcpFixture` stacks are exercised green by the PINs).
The two NUL files (`application.mjs`, `coordination-store.mjs`) were read only via `grep -an` /
`sed -n` / imports; `coordinator.mjs`, `mcp-northbound.mjs`, `web-northbound.mjs`,
`claude-session.mjs`, `wave-driver.mjs`, `limits.mjs`, `application-semantics.mjs` are NUL-free
and were read whole where the suite reads them whole.

---

## 2. Coverage map — contract decision/requirement → enforcing test(s)

Legend: 🔴 red row, ✅ pin (green today). **GAP** = no test in this suite.

### Decision D1 — budget model (per-branch depth cap, default 1, count-never-clock)
| requirement | test |
|---|---|
| depth ≥ budget refuses `message_depth_exceeded`; default 1 is today's admission envelope | ✅ A1 |
| a budget-B root admits B hops; the depth-B hop is exhausted | 🔴 A2 |
| exhaustion payload `{reason,inReplyTo,depth,budget,remaining:0}` | 🔴 A3 |
| budget declared per send, rides the outcome and every receipt | 🔴 A6, 🔴 B1, 🔴 H1 |
| per-branch constant: siblings each get the full budget; fresh root re-roots | 🔴 D1 |
| `MAX_MESSAGE_DEPTH_BUDGET = 8` closed, power of two, per-frame invariant | 🔴 D2 |
| count, never clock — no deadline/ticks/window fields | 🔴 A6 |

### Decision D2 — chain shape / the walk
| requirement | test |
|---|---|
| reply envelope `{messageId,inReplyTo,from,body,depth,budget,remaining}`; chain root→r1→r2→r3 | 🔴 A2, 🔴 B1 |
| `target: parent.target` verbatim so `messageRunId` resolves every hop | 🔴 B2 *(mechanism under-pinned — T6)* |
| no send-side `inReplyTo`; the send envelope stays `{kind,to,body,budget?}` | ✅ A1 (implicit), 🔴 A4/A5 |

### Decision D3 — refusal vocabulary (the two budget refusals, single authority)
| requirement | test |
|---|---|
| `message_budget_invalid` thrown by `coordinator.sendMessage` for out-of-range / non-safe-integer | 🔴 A4, 🔴 A5 |
| lane is the SINGLE budget authority — facade passes raw, never `application_message_send_invalid` | 🔴 F2 |
| `stateFailureCode` gains `message_budget_invalid`; worker-stream codes stay absent | 🔴 F3 |
| web `dispatchFailure` gains a `message_budget_invalid` 400 branch | 🔴 H5 |
| refusal payload carries budget/remaining; `lastRefusal` on the refusing parent's receipt | 🔴 A3, 🔴 F1, 🔴 G2 |
| `message_parent_not_found` behavioral (parent-exists leg of the B-2 order) | **GAP** — T3 |
| `message_frame_invalid` / `message_target_caller_named` (pre-existing, untouched by v1.1) | no row needed |

### Decision D4 — receipts
| requirement | test |
|---|---|
| per-hop `{depth,budget,remaining}` on the receipt and the envelope | 🔴 B1, 🔴 A6 |
| `lastRefusal` on the refusing parent's receipt, at the lane and through `run.message.receipt` | 🔴 F1 |

### Decision D5 / B-4 — replay derivability
| requirement | test |
|---|---|
| root `message.sent` rows gain `{depth:0,budget,remaining}`; replies are `message.delivered` rows with `inReplyTo` | 🔴 E1 |
| legacy alias rows distinguishable by `alias:true` + `message.sent:<workerId>:<tail>` key and replay-skipped | 🔴 E2 *(oracle broken — blocker B1)* |
| `parent.reply` re-linking from rows; fresh `_replay()` rebuilds topology | **GAP** — T2 (rows pin shape only) |
| per-member multi-reply parents keep all reply rows (target-state G4) | **GAP** — N3 (target-state; tight-cell's pin) |

### Decision D6 — facade projection
| requirement | test |
|---|---|
| `_normalizeMessageSend` key set gains `budget`; value passed raw (absent → 1); table untouched | 🔴 F2, 🔴 H1 |
| the eight direct ports are not `APPLICATION_COMMAND_DEFINITIONS` keys | ✅ H2 |

### Decision D7 — MCP/web surfaces
| requirement | test |
|---|---|
| `baton_run_message_send` schema gains `budget {integer,minimum:1,maximum:8,optional}` | 🔴 H3 |
| an out-of-range budget routes to the lane → `message_budget_invalid`, never `unknown_argument_field` | 🔴 H4 *(go-green needs the unnamed `_dispatch` seam — N1)* |
| `stateFailureCode` + web mapper gain `message_budget_invalid` only | 🔴 F3, 🔴 H5 |

### Decision D8 — DECISION-request boundary (blockingness + phase impact)
| requirement | test |
|---|---|
| blocking follow-up → existing interaction lane (`question.asked blocking:true` → `input_required`) | ✅ G1 |
| conversational follow-up → reply lane; reply frame closed `{inReplyTo,body}`; no escalation marker (RC-11) | ✅ H7 *(probes `budget` only — T4)* |
| a reply chain never transitions a task phase | ✅ G1 |
| deadlock recovery: fresh root send OR decision gate; exhaustion observable | 🔴 G2 *(fresh-root + lastRefusal only — N2)* |

### Decision D9 — waiting vocabulary
| requirement | test |
|---|---|
| closed five `WAITING_ON_KINDS` + closed three `BLOCKING_INTERACTION_KINDS` byte-unchanged; a replying worker stays mid-turn working | ✅ H6 |

---

## 3. Per-pin verdicts (FALSE-GREEN hunt)

Each green pin is scored against: *could it pass for the wrong reason — vacuous assertion, staged
setup that cannot fail, or asserting the fixture rather than the system?*

| pin | verdict | evidence |
|---|---|---|
| **A1** default-1 byte-identity | **SOUND** | Real admission decision asserted against the live lane: a plain send admits exactly one reply, a duplicate reply to the same parent draws the depth code (never `message_parent_not_found`), and a reply-to-reply draws the depth code — all through `coordinator.sendMessage` + the worker `message.rejected` stream (`coordinator.mjs:12520-12535`). The name overstates ("byte-identity" — no stored baseline is diffed), but the load-bearing claim is the admission DECISION under default 1: a wrong default of 0 admits nothing (r1 null) and a default of 2+ admits the reply-to-reply (the second refusal never fires). Non-vacuous. |
| **G1** blocking → interaction lane | **SOUND** (caveat) | Pins both directions against real machinery: a conversational reply leaves `_tasks` status and `_pending` untouched, and a `question.asked blocking:true` transitions to `input_required` + `blocked` + pending (`coordinator.mjs:12614-12631`). Caveat: it never emits a reply FRAME that carries a `blocking` marker — the RC-11 violation a wrong impl could add is not probed here (T4). |
| **H2** command-table byte-stability | **SOUND** | Imports the real `APPLICATION_COMMAND_DEFINITIONS` and asserts the eight message-lane direct ports are not keys. Would fail the moment any port is registered in the table (the byte-stable projection law, G7/D6). Cannot pass without the table staying closed. |
| **H6** closed waiting enums | **SOUND** (caveat) | `[...WAITING_ON_KINDS]` deep-equal against the closed five is exact and frozen. The blocking-three pin is a whole-file substring literal of `wave-driver.mjs:189-191` (the definition-site source) — a wrong impl that grows `BLOCKING_INTERACTION_KINDS` at that site fails; one that defines a *separate* new constant passes, but that is a contrived violation. The behavioral half (a replying worker stays mid-turn working, `waitingOn` null) is real. |
| **H7** wire asymmetry | **SOUND** but **NARROW** | Real `scanForMessageSend` export: a `budget`-bearing reply frame is rejected by the closed sorted-key literal `'body,inReplyTo'` (`claude-session.mjs:161`), the clean frame parses. But the pin probes `budget` ONLY — a `blocking` marker or any other extra field is rejected by the same literal yet never asserted (T4). |

**Net: 3 SOUND, 2 SOUND-with-caveat, 0 vacuous.** No pin is a staged false-green; H7 and G1
together still leave the RC-11 *blocking-marker-on-a-reply-frame* door open (T4).

---

## 4. Teeth flags — would a plausible WRONG implementation actually fail the red row?

### T1 (HIGH) — C1 does NOT fail a wrong impl that drops the run-membership ADMISSION clause
**Brief's membership-sharpening Q: partially NO.** C1's four sub-assertions — (a) foreign worker
refused `message_target_not_member`, (b) the named target worker admitted, (c) the membership
refusal fires before the depth/slot check, (d) the foreign reply never fills the slot — all pass
under a wrong implementation that implements ONLY the B-2 clause `parent.target.workerId ===
workerId` and refuses everyone else with `message_target_not_member`. The second B-2 clause —
*"worker is member of `messageRunId(parent)`"* as an **admission** — is never exercised: no row
has a worker who is a member of the parent's run but is NOT the named target reply and get
**admitted**. The parent in every C1 scenario is `{workerId: memberA}`; the only admitted party
is memberA herself. A wrong impl that silently drops run-membership admission passes all 25 rows.
**Fix:** spawn a second worker `memberC` in the SAME run as memberA; have `memberC` reply to a
message targeted at `{workerId: memberA}`; assert `memberC` is **admitted** (clause 2). Keep
`foreignB` (different run) refused as the negative.

### T2 (HIGH) — E1/E2 pin durable-row SHAPE only, never a fresh-store `_replay()` rebuild
**Brief's replay-sharpening Q: the answer is NO — it is the live, test-warmed store.** Both E1 and
E2 read `coordinator._coordination.events()` from the SAME live coordinator that minted the rows;
nothing constructs a fresh coordinator over the store and runs the `_replay()` rebuild the
contract's RC-07/B-4 "whole mapping" requires ("replay rebuilds chain topology from the recorded
minted ids"). A wrong implementation that *writes* the `message.delivered` rows with `inReplyTo`
(satisfying E1/E2's shape assertions) but whose `_replay()` still does not rebuild — or does not
exist — passes both rows while the rebuild machinery never materializes. The tight-cell F6 lesson
verbatim.
**Fix:** after the shape assertions, build a SECOND coordinator over a FRESH `CoordinationStore`
on the same logDir and assert the rebuilt chain walks root→r1 (each hop resolvable through
`messageReceipt`, carrying `depth/budget/remaining`, `parent.reply` re-linked). At minimum, drive
the real replay entry point rather than the live map.

### T3 (MEDIUM) — the B-2 admission ORDER is half-pinned: parent-exists is never exercised
C1-(c) pins "membership refusal precedes depth/slot". Nothing pins "parent-exists precedes
membership". A wrong implementation that checks membership FIRST passes every row: a member's
reply to a nonexistent `message:` id would draw `message_target_not_member` instead of
`message_parent_not_found`, and a foreign reply to a nonexistent parent would too. `message_parent_not_found`
is a **pre-existing** code (`coordinator.mjs:12530`) with **no behavioral row anywhere in the
suite** — the only references are F3's negative source check (that it stays absent from
`stateFailureCode`) and comment prose. The contract's D3/B-2 lists it in the admission order; the
suite never exercises it.
**Fix:** add a behavioral row — a worker replies to an unknown `message:` id and the refusal is
`message_parent_not_found`; plus an ordering pair — a FOREIGN worker replying to an unknown parent
draws `message_parent_not_found`, never `message_target_not_member`.

### T4 (MEDIUM) — the RC-11 wire-asymmetry pin probes only `budget`; a `blocking` marker rides free
H7 asserts only that a `budget`-bearing reply frame is rejected. G1 never emits a reply FRAME
carrying `blocking: true` (it asserts a normal reply doesn't transition a phase, and a
`question.asked blocking:true` DOES transition — neither probes the reply-lane reading a
`blocking` field). A wrong implementation that admits `blocking` on the reply frame (or reads any
escalation marker off it) and escalates — the exact RC-11 violation the suite claims to kill —
passes H7 AND G1.
**Fix:** extend H7 to probe `blocking: true` (and a second arbitrary field) in the reply frame and
assert `scanForMessageSend` rejects it; and/or in G1, emit a reply frame carrying `blocking: true`
and assert it is treated as prose (no phase transition, no `_pending` entry).

### T5 (LOW) — F3's whole-file source pins are shallow in BOTH directions
Positive: `src.includes("'message_budget_invalid'")` over the whole `mcp-northbound.mjs` is
satisfied by a comment or an unrelated error string without `stateFailureCode` ever mapping the
code. Negative: `!src.includes("'message_depth_exceeded'")` (etc.) is tripped by a doc comment
naming the excluded worker-stream codes near the new allowlist entry — which the contract's own
D3/D7 prose does — on a CORRECT implementation. Both directions are fragile.
**Fix:** anchor the positive inside the `stateFailureCode` function body (extract the function
source and assert the literal within it), and either drive the negatives live through the mapped-
codes structure or anchor them to the function body too.

### T6 (LOW) — B2 pins observable resolution, not verbatim target inheritance
B2 asserts `messageRunId(r1) === 'run:b2'` and the facade serves the hop receipt. A wrong
implementation that resolves per-hop runs by walking the `inReplyTo` chain to the root, or mints
the reply `target` as the *resolved* `{runId: 'run:b2'}` (denormalized) instead of `target:
parent.target` verbatim, passes B2 while violating B-1. The verbatim target only matters through
B-2's `parent.target.workerId` clause at later hops, which no row pins (see T1).
**Fix:** assert the reply record's `target` deep-equals the parent's target verbatim
(`coordinator.messageReceipt(r1.messageId)`'s record `.target` vs the root's), or add the T1
run-membership-admission case which forces the workerId clause to be load-bearing.

---

## 5. Stage-honesty and surface-drift notes

- **Stage honesty holds for all 20 red rows at HEAD** — each fails at its named stage (see §1
  table, fail line cross-referenced). The two consecutive runs are byte-stable (pass 5 · fail 20).
- **E2's stage message is internally self-contradictory** — it states replay distinguishes the
  alias row "by the alias marker AND the absent depth fields" (absence) while the assertions
  require the fields to be PRESENT (`depth === 0`, `budget === 1`, `remaining === 1`). The oracle
  and its own prose disagree; the prose is contract-consistent, the assertions are not (blocker B1).
- **H4's go-green depends on a seam the contract does not name.** `validateArguments` for
  `baton_run_message_send` uses the hand-rolled guard (`mcp-northbound.mjs:1110-1123`, no budget
  check) after the generic key-closure (`:898`), and the tool dispatches through the explicit
  `_dispatch` branch at `mcp-northbound.mjs:1771-1778`, which builds a **closed** `{runId?,
  workerId, kind, body}` object — `budget` is stripped before the facade. For H4 to go green, the
  implementer must forward budget in that branch. The contract names only the schema (`:585-593`)
  and the guard as MCP seams; D7 requires the behavior ("an out-of-range value passes to the
  lane") but not the seam. Not a blocker (a correct impl necessarily forwards), but a faithful
  first pass that touches only the named seams leaves H4 red for a different reason than its stage
  names. Note N1.
- **The message tools are NOT `APPLICATION_TOOL` entries** (`APPLICATION_TOOL` is built from
  `MCP_APPLICATION_ENTRIES` + the six canonical siblings; `baton_run_message_send` /
  `baton_run_message_receipt` are absent). `validateApplicationCommandArgs` is therefore never
  called for them — the FP-14-dispatch green at HEAD is consistent, and H4's current failure is
  purely the key-closure on the undeclared `budget` field. Confirmed via the map at
  `mcp-northbound.mjs:41-54` and the explicit branches at `:1771-1782`.

---

## 6. Final verdict: **NEEDS-FOLD**

The suite is honestly red, hermetic, and clock-free; the five PINs are genuine; stage honesty is
sound. But it does not yet hold the contract's red line: one row is provably un-passable on a
correct implementation, and four red rows admit a plausible wrong implementation that skips the
named behavior. Blockers below are ordered by severity.

### Blockers

**B1 (blocker) — E2's alias-row oracle contradicts the contract's folded shape; the row can never
go green on a CORRECT v1.1 implementation.**
- Contract D5 (and B-4 fold): the legacy alias `message.sent` row is "a second message.sent
  shape… **no** `depth`/`budget`/`remaining`"; replay distinguishes it "by the `alias: true`
  field (and the `<workerId>:<tail>` key shape)" and skips it. The alias write at
  `coordinator.mjs:7409-7421` records a closed `{messageId, kind, from, to, body, targetCount,
  alias: true}` — a correct impl leaves it unchanged.
- E2 asserts `alias.payload.depth === 0`, `.budget === 1`, `.remaining === 1`
  (`reply-chains-red.test.mjs:672-674`). Under the contract-correct shape `payload.depth` is
  `undefined`, so `undefined !== 0` and E2 stays **red** through an otherwise-correct v1.1.
- The row's own stage prose contradicts its assertions: it says replay distinguishes the row by
  "the alias marker AND the **absent** depth fields", then asserts the fields are **present**.
- **Attack:** a correct implementation (as specified) fails E2; E2's red can only be cured by an
  implementation that adds depth/budget/remaining to the alias row — which contradicts D5's
  explicit shape.
- **Concrete fix:** delete the three field assertions. Instead assert (a) `alias.payload.alias
  === true`, (b) the key shape `message.sent:<workerId>:<tail>` (never a minted `message:` id),
  (c) the row carries **no** `inReplyTo` (so it can never seed a reply), and (d) a fresh-store
  `_replay()` seeds no phantom root from it. If the intent is "replay has a distinguishing
  marker", assert absence (`assert.ok(!Object.hasOwn(alias.payload, 'depth'))`) — the contract's
  own discriminating marker is `alias: true` + the key shape, not a presence/absence of depth
  fields. Optionally fold the fresh-store rebuild of T2 into this row.

### Non-blocking observations

- **N1 (H4 seam)** — see §5: H4's go-green requires budget forwarding at `_dispatch`
  (`mcp-northbound.mjs:1771-1778`), a seam the contract names only behaviorally (D7). If the
  implementer's checklist is the contract's named seams alone, H4 can stay red through a
  first-pass otherwise-correct impl. Recommend the suite (or the fold) name the `_dispatch`
  branch, or have H4 assert the budget reached the lane by inspecting the outcome of an
  in-range call alongside the refusal.
- **N2 (G2 decision-gate leg)** — G2 covers lastRefusal + fresh-root re-root. The D8 deadlock-
  recovery's second leg (decision gate) is the orchestrator's existing `input_required`
  escalation (existing machinery, not new surface); acceptable for this suite's scope, but the
  "deadlock-recovery path" stage name overstates what the row pins (its red power is entirely the
  `lastRefusal` assertion, shared with F1).
- **N3 (per-member multi-reply replay)** — D5/B-4 says replay must not lose per-member reply
  rows under the target-state broadcast law (G4). No row builds a parent with reply rows from
  multiple members. This is target-state machinery whose red pin lives in the tight-cell suite
  (`per-member-reply-slot-missing`); noted, not a blocker for this suite.
- **N4 (pre-existing refusal codes)** — `message_frame_invalid` / `message_target_caller_named`
  are untouched by v1.1 and need no rows; the ordering law that includes them is what T3
  addresses.

**Bottom line:** fold E2 (B1), then tighten C1 (T1), E1/E2 (T2), the parent-exists order (T3),
and the RC-11 probe (T4). The budget-model core (A2-A6, B1, D1, D2), the walk (B2 modulo T6),
refusal observability (F1, F2), the facade (H1, H2), and the MCP/web rows (H3-H5, F3 modulo T5)
are sound red pins as written.
