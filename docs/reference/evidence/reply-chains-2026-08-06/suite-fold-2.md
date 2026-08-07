# #105 SUITE-FOLD-2 — finding → resolution map

Date: 2026-08-06 · Attempt: `fb-2026-08-07T02:56:38.055Z`
Source: `docs/reference/evidence/reply-chains-2026-08-06/suite-blueteam.md` (verdict NEEDS-FOLD)
Target: `impl/test/reply-chains-red.test.mjs`
Contract: `reply-chains-contract.md` — **unchanged (v1.1)**. No finding required a contract change:
B1 is a test-side oracle contradiction (the contract's D5/B-4 alias shape is correct), and every
other finding is a test-side teeth gap. No v1.2 bump.

## Fold summary

The blue-team report found one blocker (B1 — E2's alias-row oracle contradicts the folded contract,
so the row could never go green on a correct v1.1 implementation), four shallow-green blockers
(T1-T4 — each admits a plausible wrong implementation that skips the named behavior), one
low-severity teeth flag (T6), two low-severity source-pin weaknesses (T5, folded under the same
pass), and four non-blocking observations (N1-N4). All four shallow-green blockers and B1 are
implemented **as written** in the report's concrete fixes; T5/T6 implemented as written; N1 folded
into H4 with the report's recommended in-range probe; N2/N3/N4 explicitly deferred with reasons
(below). No deviation from the report's fixes was needed.

The suite grew from 25 rows (5 PINs · 20 red) to **26 rows (6 PINs · 20 red)** — C2 added as a PIN.
The split is stable across two runs from the repo root: **pass 6 · fail 20**.

## Finding → resolution map

| Finding | Severity | Resolution | Row(s) | Resulting HEAD stage |
|---|---|---|---|---|
| **B1** — E2's alias-row oracle contradicts the contract (asserts `depth===0`/`budget===1`/`remaining===1` on a row the contract says has none) | blocker | Deleted the three field assertions. E2 now asserts the contract-correct discriminators: `alias.payload.alias === true`, the `message.sent:<workerId>:<tail>` key shape (never a minted id), NO `inReplyTo` (`Object.hasOwn` false), and the ABSENT depth/budget/remaining fields (`Object.hasOwn` false for each). Folds the T2 fresh-store rebuild into the same row. | E2 | `replay-topology-not-rebuilt` (the row stays red at HEAD via the replay rebuild, not the alias shape) |
| **T1** — C1 does not fail a target-only membership impl (the B-2 run-membership ADMISSION clause is never exercised) | HIGH | Spawned a second worker `memberC` in the SAME run as the target `memberA`; the positive control is now `memberC` replying to a message targeted at `{workerId: memberA}` and being **admitted** (B-2 clause 2). `foreignB` (different run) stays the negative. A target-only impl now fails (b). | C1 | `membership-check-missing` — at HEAD the foreign reply still lands at (a); the sibling control sits behind it |
| **T2** — E1/E2 pin durable-row SHAPE only, never a fresh-store `_replay()` rebuild | HIGH | Added the `replayCoordinator(fx)` fixture: release the live store's writer lease, construct a FRESH `CoordinationStore` over the same logDir, construct a second `Coordinator` (the real replay entry point is the constructor's `_replay()`). E2 drives the rebuild and asserts the chain walks root→r1 through `messageReceipt` carrying `depth/budget/remaining`, `parent.reply` re-linked, and no phantom alias root. | E2 | `replay-topology-not-rebuilt` — at HEAD `_replay()` never seeds `_messages` (coordinator.mjs:13274), so `messageReceipt(root.messageId)` is null |
| **T3** — the B-2 admission ORDER is half-pinned: parent-exists is never behaviorally exercised | MEDIUM | Added C2 as a new PIN: a run-member AND a foreign worker each reply to an unknown `message:` id (64 zeros); BOTH draw `message_parent_not_found` (pre-existing, coordinator.mjs:12530), never `message_target_not_member`. No ghost message is ever minted. Green today, kills a membership-before-parent-exists impl. | C2 (PIN) | green at HEAD — the ordering is pinned both ways |
| **T4** — the RC-11 wire-asymmetry pin probes only `budget`; a `blocking` marker rides free | MEDIUM | H7 now probes `blocking: true` AND `priority: 1` frames alongside the `budget` frame — all rejected by the closed sorted-key literal `'body,inReplyTo'`; the clean frame asserts `budget/blocking/priority` all undefined. G1 now emits a reply frame carrying `blocking: true` and asserts it is treated as prose (no phase transition, no `_pending` entry). | H7 (PIN), G1 (PIN) | green at HEAD — the wire asymmetry is pinned both directions |
| **T5** — F3's whole-file source pins are shallow in both directions | LOW | F3 now extracts the `stateFailureCode` FUNCTION BODY via `/function stateFailureCode\(cause\) \{([\s\S]*?)\n\}/` and scopes all four checks to it: `message_budget_invalid` must be present INSIDE the body; the three worker-stream codes must be absent from the body. A literal elsewhere in the file (comment or unrelated string) can no longer satisfy the positive or trip the negatives. | F3 | `allowlist-missing` — at HEAD the body knows no `message_*` codes |
| **T6** — B2 pins observable resolution, not verbatim target inheritance | LOW | B2 adds a record-level assertion: `coordinator._messages.get(r1.messageId)?.target` deep-equals `coordinator._messages.get(root.messageId)?.target` — the reply record inherits `target: parent.target` VERBATIM (B-1), not a resolved/denormalized run. At HEAD the reply mints `target: {workerId: null}` (coordinator.mjs:12580), so the deep-equal fails on the same seam. | B2 | `target-inheritance-missing` (unchanged stage, stronger pin) |
| **N1** — H4's go-green depends on the unnamed `_dispatch` seam (mcp-northbound.mjs:1771-1778) | note | Folded: H4 names the `_dispatch` branch in prose and adds an IN-RANGE call (`budget: 3`) asserting `isError === false`. At HEAD the branch builds the closed `{runId?, workerId, kind, body}` shape — budget stripped — so even the in-range call dies as `unknown_argument_field`. A correct impl must forward budget in the branch. | H4 | `mcp-message-budget-missing` (unchanged stage, plus the in-range probe) |
| **N2** — G2's "deadlock-recovery path" name overstates the row's pins (the decision-gate leg is existing escalation) | note | **Deferred with reason:** the D8 deadlock-recovery decision gate is the orchestrator's existing `input_required` escalation (existing machinery, not new v1.1 surface); G2's red power is entirely the `lastRefusal` assertion, shared with F1. Keeping the row as written keeps its stage honest; a decision-gate row belongs to an escalation-focused suite, not this budget suite. | — | — |
| **N3** — per-member multi-reply replay rows are unpinned (target-state broadcast law, G4) | note | **Deferred with reason:** the per-member reply-slot law is target-state machinery whose red pin lives in the tight-cell suite (`per-member-reply-slot-missing`); this suite's replay rows now pin the fresh-store topology rebuild (T2), which is this fold's scope. | — | — |
| **N4** — pre-existing refusal codes (`message_frame_invalid` / `message_target_caller_named`) need no rows | note | **Deferred with reason:** both codes are untouched by v1.1 and need no rows; the ordering law that includes them is now behaviorally pinned by C2 (T3). | — | — |

## What was NOT changed

- **`reply-chains-contract.md`** — remains v1.1. B1 proved the contract's alias shape correct and the
  suite wrong; no finding implicated a contract decision. (The fold-2 brief permits a v1.2 bump ONLY
  if a finding's fix says the CONTRACT is wrong — none did.)
- **The red-first discipline** — PINs are green at HEAD and under the correct implementation and
  fail plausible wrong ones; every red row fails at its NAMED stage at HEAD. The split is 26 rows ·
  6 pass · 20 fail, identical across two runs.

## Both run splits (from the repo root)

```
$ node --test impl/test/reply-chains-red.test.mjs
# run 1
ℹ tests 26   ℹ pass 6   ℹ fail 20   ℹ cancelled 0   ℹ skipped 0
# run 2
ℹ tests 26   ℹ pass 6   ℹ fail 20   ℹ cancelled 0   ℹ skipped 0
```

PINs green (both runs): **A1, C2, G1, H2, H6, H7**.
Red rows (both runs, each failing at its named stage): A2 `chain-dies-at-r1`, A3
`exhaustion-payload-missing`, A4/A5 `send-budget-refusal-missing`/`lane-shape-authority-missing`,
A6 `budget-count-missing`, B1 `per-hop-depth-missing`, B2 `target-inheritance-missing`, C1
`membership-check-missing`, D1 `per-branch-budget-missing`, D2 `max-budget-constant-missing`, E1
`reply-row-absent`/`root-row-depth-missing`, E2 `replay-topology-not-rebuilt`, F1 `lastRefusal-absent`,
F2 `facade-double-gate`, F3 `allowlist-missing`, G2 `lastRefusal-absent`, H1
`facade-budget-missing`, H3/H4 `mcp-message-budget-missing`, H5 `web-mapper-branch-missing`.

## Suite-law compliance of the fold

- **No clocks**: the replay fixture and the new probes add no timestamps — `now: () => 0` and the
  fixed `NOW` constant are unchanged; the budget remains a count.
- **Sorted-key literals in ACTUAL order**: the only literal (`'body,inReplyTo'`) is unchanged and in
  sorted order; `localeCompare` is not used anywhere.
- **NUL discipline**: `application.mjs` and `coordination-store.mjs` are still only ever touched
  through the imported exports (`APPLICATION_COMMAND_DEFINITIONS`, `CoordinationStore`,
  `coordinationForLog`) — including the fresh-store replay in E2. All other sources read whole are
  NUL-free. The suite file itself is NUL-free (0 NUL bytes).
- **Hermetic**: `replayCoordinator` reuses the lane's own `mkdtempSync` dir (a second store over the
  same logDir); no harness, network, or live server is introduced.
