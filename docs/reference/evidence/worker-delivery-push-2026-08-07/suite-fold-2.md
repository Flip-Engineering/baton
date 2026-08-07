# #79 Suite Fold 2 — finding → resolution map (F1–F8)

Date: 2026-08-07 · Fold HEAD `e1117a0` ("Baton private effective-tree snapshot") · node v25.8.0.
Brief: `suite-fold-2-brief.md` · Blue-team verdict: `suite-blueteam.md` (**NEEDS-FOLD**) ·
Suite: `impl/test/worker-delivery-push-red.test.mjs` (folded: **32 rows — 21 RED / 11 PIN**) ·
Contract: `worker-delivery-push-contract.md` (**v1.2** — one required movement, F2).

## Fold result

The suite went from **24 rows (13 RED / 11 PIN)** to **32 rows (21 RED / 11 PIN)**. Run record,
two consecutive runs from the repo root (`node --test impl/test/worker-delivery-push-red.test.mjs`):

```
run 1: tests 32 · pass 11 · fail 21 · cancelled 0 · skipped 0 · todo 0 (≈259 ms)
run 2: tests 32 · pass 11 · fail 21 · cancelled 0 · skipped 0 · todo 0 (≈299 ms)
```

The 11 passes are exactly the PIN rows (A4, A5, B2, B3, C3, C4, C5, F2, F3, F4, G2 — unchanged
from the blue-team verdict's 11/11 SOUND). The 21 failures are the RED rows, each failing at its
NAMED stage; no pin moved, no red row went green. The deployment-verification stub (`true`,
argv `[]`, cwd `.`, expect exit 0) is unchanged and exits 0.

Eight rows were added and one existing row re-anchored, one per finding:

| Finding | Blue-team gap | Resolution row(s) | Stage (HEAD seam) |
|---|---|---|---|
| F1 (HIGH) | never-pushed-kinds law unenforced (`ORCHESTRATOR_ONLY_KINDS` dead code) | **D4** | `pending-attention-push-missing` |
| F2 (HIGH) | D2 overflow/spill round trip unpinned; naive fixture green-side-blocked by `.slice(-2)` | **C6**, **C7** | `pending-attention-push-missing` |
| F3 (HIGH) | D5 dedup single-instance — an in-memory Set passes | **D5** | `pending-attention-push-missing` |
| F4 (HIGH) | delivered-then-read receipt pinned only in the `read:null` case | **E2** (re-anchored + extended) | `attention-receipt-projection-missing` |
| F5 (HIGH) | verdict pinned only single-worker; run-wide scoping and a raw tail green the suite | **F5**, **F6** | `gate-verdict-push-missing` |
| F6 (MEDIUM) | no `attention_push_*` refusal ever fires | **G3** | `attention-push-refusal-missing` |
| F7 (MEDIUM) | `answer_question`/`answer_approval` push has no row | **D6** | `pending-attention-push-missing` |
| F8 (MEDIUM) | A2 under-pins the renderPrompt position (`Done when:` vs the verification contract) | **A2** (re-anchored) | `renderPrompt-attention-missing` |

---

## F1 — The never-pushed-kinds law has no enforcing row

- **Gap (blue-team §4-F1)**: R7 pins that the orchestrator-only kinds (`answer_decision`,
  `candidate_selection`, `workflow_revision`, `workflow_recovery`, `session_preservation`,
  `turn_checkpoint`) and the #10-era inbox kinds (`approval`/`question`/`blocked`/`stalled`/
  `budget_alarm`) NEVER reach a worker's block, and a BD3-C lane-delivered message is never
  double-pushed. The suite declared `ORCHESTRATOR_ONLY_KINDS` and never referenced it in any
  assertion; `INBOX_KINDS` was used only to pin the vocabulary, not the exclusion.
- **Attack it green-lit**: an implementation that pushes the full run-view attention array into
  every worker's block — skipping only the D3 exclusion filter — passed A3/D1/D2/D3/E1/F1.
- **Resolution — row D4 (RED, stage `pending-attention-push-missing`)**: stages a genuinely
  pending decision request (the run-view `answer_decision` source, via the real interaction seam)
  and a BD3-C lane delivery, then asserts `_pendingAttentionPush(handle.id)` returns neither an
  `ORCHESTRATOR_ONLY_KINDS` kind nor an `INBOX_KINDS` kind, and that the composed block never
  re-serves the lane-delivered `messageId` (R7 double-push). `ORCHESTRATOR_ONLY_KINDS` is now
  load-bearing in the first failing assertion path.
- **Contract movement**: none.

## F2 — The D2 overflow/spill round trip has no row (and a naive fixture is green-side-blocked)

- **Gap (blue-team §4-F2)**: C1/C2/C4/C5 pin the registry rows, the closed lane, and the coaching
  shape — nothing pins the D2 overflow BEHAVIOR (serve 8, spill the excess, close the block with
  `spill:sha256:<digest>` + overflow ids, the worker RESOLVES the citation). The byte shed (OQ1)
  was likewise unpinned. The fixture trap: the run-view `scratchpad_write_failed` source is
  `.slice(-2)`-bounded, so a naive 9-refused-writes fixture could never reach a >8 pending set.
- **Attack it green-lit**: ignoring the item bound (serve everything) or truncating the excess
  (never spill) greens C1–C5.
- **Required contract movement — v1.2 (the ONE movement)**: D2 now carries a pinned
  "Per-source bounds, pinned (v1.2 — the F2 blocker)" paragraph: `_pendingAttentionPush(workerId)`
  derives the genuinely-pending set per D5's still-pending predicates for EVERY source and does
  NOT inherit the run-view `.slice(-2)`/`MAX_ATTENTION` DISPLAY bounds; D2's 8-item bound applies
  to the union. The fold note in the contract header records that this was the only decision moved.
- **Resolution — rows C6 + C7 (RED, stage `pending-attention-push-missing`)**:
  - **C6 (item-count overflow round trip)**: 9 genuinely-pending approvals via the interaction
    seam (the seam the per-source pin makes reachable) → 8 in-block + a closing
    `spill:sha256:<digest>` entry carrying the overflow id → the worker resolves the citation
    through the closed CONTEXT_READ spill lane and recovers the full framed overflow item.
  - **C7 (byte shed)**: 8 long-text questions crossing 4096 rendered bytes → every item present,
    the spill citation rides, `renderPrompt` emits the `(truncated)` marker, and the FULL
    untruncated text is recoverable by citation.
- **Contract movement**: yes — D2 per-source bounds pin (v1.2).

## F3 — The D5 dedup row is single-instance: an in-memory Set passes it

- **Gap (blue-team §4-F3)**: D3 tests still-pending → re-pushed and resolved → not, all within
  one `Coordinator` instance. The D5 replay-safety law — "the pending set is a pure function of
  the durable event log … In-memory 'already pushed' bookkeeping is never authoritative" — had no
  oracle.
- **Attack it green-lit**: a wrong implementation tracking "already pushed" in a per-process `Set`
  passes D3; after a driver restart/attach the Set is empty and a still-pending item is silently
  skipped — the exact D5 violation.
- **Resolution — row D5 (RED, stage `pending-attention-push-missing`)**: coordinator A composes
  once (the delivery seam) over a `mkdtemp` log; the coordination writer lease is released;
  coordinator B is constructed over the SAME log (a fresh-process equivalent); `_pendingAttentionPush`
  re-derives the IDENTICAL pending set (`assert.deepEqual(bIds, aIds)`) and the still-pending item
  IS re-pushed after the "restart" — an in-memory Set would be empty there and fail the row.
- **Contract movement**: none (the D5 replay-safety law was already v1.1; the row gives it an oracle).

## F4 — The delivered-then-read receipt is pinned only in its `read: null` case

- **Gap (blue-team §4-F4)**: E2 asserted `{delivered:true, read:null}` only. R6's full law —
  `read` = the first `turn_started` with `seq ≥ push.seq` and NO `process_closed` in
  `(push.seq, turn.seq)` — was untested, so a projection that never marks `read` (or marks it at
  push time) passed.
- **Attack it green-lit**: "read is replay-derived, never a lie across process death" was
  unpinned at both ends.
- **Resolution — row E2 (RED, stage `attention-receipt-projection-missing`, extended)**: after the
  `delivered:true, read:null` baseline, arm (a) emits `lifecycle.turn_started` → `afterTurn.read`
  equals that turn_started's durable `seq` and is a number (an event seq, never a wall clock);
  arm (b) composes again, appends `lifecycle.process_closed` DIRECTLY through the coordinator's
  own `_log` (the durable event the projection reads — the same technique as F6's
  `verify.reverified` append), emits a later `turn_started` → `afterRespawn.read === null`. The
  respawned worker does not inherit the read.
- **Contract movement**: none.

## F5 — The verdict push is pinned only for one worker's scope gate

- **Gap (blue-team §4-F5)**: F1 staged a single worker and a scope gate. Two violations both
  greened the suite: (a) run-wide verdict scoping — reusing `debugGateRefusal(events)` for every
  worker (a second worker would be handed the same verdict); (b) a raw red_green/coverage tail —
  pushing the failure capsule verbatim as `detail.tail` with no adversarial content in the fixture
  to redact.
- **Resolution — rows F5 + F6 (RED, stage `gate-verdict-push-missing`)**:
  - **F5 (per-worker)**: worker A's scope gate mints the real `error {phase:'trust_gate', worker:
    A}`; `composedA.attention` carries A's own `gate_verdict {workerId:A, requestId:'gate:'+seq}`
    and `composedB.attention` carries NO `gate_verdict` — the run-wide scoping caller
    (application.mjs:11284) fails the row.
  - **F6 (never-raw tail)**: a `verify.reverified accept:false` capsule with an adversarial
    home path + well-formed JWT (staged by direct `_log.append`, the D6 source stream) must push
    as a sanitized `gate_verdict {gate:'red_green', detail.tail}` — no `/Users/alice`, no JWT
    material, no `lib.rs` in ANY field, and the `message` field static-or-sanitized, never raw.
- **Contract movement**: none (D6's per-worker projection and never-raw law were already v1.1).

## F6 — No row fires a single `attention_push_*` refusal

- **Gap (blue-team §4-F6)**: G1 pinned the family as a frozen constant — no row drove any refusal
  to fire, so an implementation that silently drops resolved/unaddressed/unknown/over-limit items
  greened every row.
- **Resolution — row G3 (RED, stage `attention-push-refusal-missing`)**: after a refused write
  and its corrective write (the resolved state is durable), asserts `_assertAttentionPushServed`
  exists, then drives all four typed refusals: (a) re-push of the resolved item →
  `attention_push_stale`; (b) unknown id `swf:${id}:999` → `attention_push_unknown_item`;
  (c) `answer_decision` presented for push → `attention_push_not_addressed`; (d) 9 items with
  `{spillLane:false}` → `attention_push_oversized` whose coaching message names the lane, the cap
  `8`, and actual-or-spill (C5's composer shape). F6 (this finding) makes G1 load-bearing.
- **Contract movement**: none.

## F7 — The `answer_question` / `answer_approval` push has no row

- **Gap (blue-team §4-F7)**: D3 lists pending interactions as push-qualified and D5 pins their
  durable `requestId` keys — but the suite's fixtures exercised only the scratchpad-write and
  gate-verdict members. An implementation that implements those two and never pushes pending
  interactions greened the suite.
- **Resolution — row D6 (RED, stage `pending-attention-push-missing`)**: mints a pending question
  and approval through the real interaction seam (`question.asked`, `approval.requested` with the
  non-blocking payload shapes verified in scratch), asserts both push with their interaction
  `requestId` (`answer_question`, `answer_approval`), re-push while unanswered (R3), then after
  `respond(…, 'orchestrator')` on both, are resolved and dropped from the projection (D5 dedup).
- **Contract movement**: none.

## F8 — A2 under-pins the renderPrompt position

- **Gap (blue-team §4-F8)**: A2 asserted `pendingAt > doneAt` (`Done when:`), but the verification
  execution contract renders AFTER `Done when:` (cli-adapters.mjs:102-107). A section inserted
  between the phrase and the contract passed A2 while violating D1's "after the verification
  execution contract — the last lines of the prompt".
- **Resolution — row A2 (RED, stage `renderPrompt-attention-missing`, re-anchored)**: adds a
  precondition that the `A reviewer` contract marker renders, then asserts
  `pendingAt > rendered.indexOf('A reviewer')` — pinning the section as the FINAL block of the CLI
  prompt, past the verification execution contract.
- **Contract movement**: none.

---

## Out of scope this fold (F9–F12, deferred)

The brief folds **all 8** findings F1–F8. The blue-team's F9–F12 (seam-level `undefined` vs `[]`
for the empty set, R8′ provenance at the delivery seam, E1's `itemIds` cross-check, G1's
naming-only status) are NOT folded here. F12 is partially closed incidentally — G3 (F6) makes G1
load-bearing — but F9, F10, and F11 remain open and are captured in `suite-draft-notes.md`'s
implementer's checklist implicitly (the checklist's "never `attention: []`" seam letter and the
wrap-provenance requirements are stated there). They are tracked as a follow-on fold, not this one.

## Fold hygiene (re-verified after the fold)

- **Red-first at named stages**: each of the eight new rows' first failing assertion names its
  stage (`pending-attention-push-missing` ×5, `gate-verdict-push-missing` ×2,
  `attention-receipt-projection-missing` ×1, `attention-push-refusal-missing` ×1); the two
  re-anchored rows (A2, E2) still fail at their original stages.
- **Hermetic / no clocks / NUL discipline / no `localeCompare` / ACTUAL sorted-key literals**:
  unchanged from the blue-team's verified baseline; the new rows reuse the same ScriptableAdapter +
  fixed-microtask-drain harness (no wall-clock assertion anywhere, `Date.now()` nowhere), the same
  direct-`_log.append` technique already in the suite for durable events the projection must read,
  and the same NUL-safe imports.
- **The `.slice(-2)` fixture trap is closed at the contract level** (v1.2 per-source bounds pin),
  not by a fixture workaround — C6/C7 stage genuinely-pending interactions (never the run-view
  scratchpad display bound), so a correct v1.2 implementation is green-side reachable.
