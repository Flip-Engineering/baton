# #79 FOLD — blocker → change map (v1.0 → v1.1)

Source: `contract-redteam.md` (pass r5-2026-08-07, **NOT FOLD-READY**). Fold target:
`worker-delivery-push-contract.md` v1.1. Fold HEAD: `a2a4b295539fa0358d78bdf4a97fd2e3029d88ed`
(the red-team pass ran against `c34e1f36…`; every corrected anchor was re-grepped at the fold
HEAD before writing).

Verdict folding: all **10 numbered blockers** resolved with the report's concrete fix; the
**5 citation blockers** (§1.2) and the **2 cosmetic-minor anchors** (§1.2 #6) re-anchored;
open questions **OQ1 RESOLVED** (as a v1.1 blocker), **OQ2/OQ3/OQ4 SOUND** as written.

---

## Citation blockers (report §1.2 / final #1) — automatic, all corrected

| # | Blocker (report) | v1.0 anchor (wrong) | v1.1 anchor (re-grepped at fold HEAD) | Where in v1.1 |
|---|---|---|---|---|
| 1 | GT1 `projectDecisionAttention` call | `application.mjs:7622` (the `// Issue #31 §2.3` comment) | **`:7621`** (`allAttention.push(...)` grep-pinned) | GT1 |
| 2 | GT6 `debugGateFromLiveCode` span | `:943-949` | **`:940-947`** (function at :940, closes :947) | GT6 |
| 3 | D5 `debugGateRefusal` `.at(-1)` | `:996-997` | **`:990`** (`candidates.at(-1)` grep-pinned) | D5 |
| 4 | D6 red_green/coverage branch | `:979-983` | **`:971-977`, tail at `:976`** | GT6, D6 |
| 5 | GT4 "pin on `task.brief` ONLY" overclaim | `coordination-store.mjs:3003` | rephrased: brief + `modelRequested`/`modelPolicy`/`effortRequested`/`attribution.*`/`vendorRequested`(harness)/`refines`/`reservedWorkerId`/`assignee`/`runId`/`taskType` (`coordination-store.mjs:3000-3008`) | GT4 |
| 6 | GT6-minor scope range bleed | `:955-976` | digests `:955-961`, counts `:962-968`, branch closes `:970` | GT6, D6 |
| 6b | GT9 `wrapProse` range | `:458-462` | **`:463-465`** (fold-HEAD anchor; also added `wrapFact` `:459-461`) | GT9 |
| 6c | GT9 `UNTRUSTED_WEB_CONTENT_FRAME` range | `:542-543` | **`:547-548`** (fold-HEAD re-anchor) | GT9 |

Every other citation the report marked ✓ was re-confirmed at the fold HEAD unchanged.

## Numbered blockers (report §3) — all resolved

| # | Blocker | Concrete fix (from the report) | Change in v1.1 |
|---|---|---|---|
| 2 | **Per-worker gate-verdict filter unpinned** (D6/D3) | pin `debugGateRefusal(events.filter(e => e.worker === workerId))`; verdict `workerId` = source-event top-level `worker` | **D6** new bullet "The per-worker projection is pinned" — the worker-scoped filter, keyed `gate:${event.seq}` from the worker-scoped latest event, `workerId` = the source event's top-level `worker` field (mints cited at `coordinator.mjs:6459`, `:13010`, `:13197`); the run-wide caller `application.mjs:11284` is called out as correct ONLY for `run.debug`. **R2** extended: "to ONLY the judged worker". **D1** composition bullet updated to name the worker-scoped projection. |
| 3 | **`delivered` overclaims on send failure** (D4) | redefine `delivered` = "composed into the provider-facing brief value" + separate `wireAffirmed` state | **D4** `delivered` bullet rewritten: composition-receipt honest definition, explicitly NOT a wire ack (the pure-function seam cannot await the adapter `prompt()` send; BD3-C `{ok:false}` model cited `coordinator.mjs:6934-6937`); `wireAffirmed` named as the honest home, not claimed in v1.1. **R6** extended. |
| 4 | **`read` not pinned replay-derived** (D4) | pin "read = first `turn_started` with `seq ≥ push.seq` and no `process_closed` between"; do NOT route through the BD3-C live map | **D4** `read` bullet rewritten with the exact definition; the BD3-C live-map marking (`coordinator.mjs:12036-12058`, live maps `:1190`/`:1194`) explicitly excluded. **R6** extended. |
| 5 | **Byte shed vs "served in full" contradiction** (D2) | pin the shed semantics or retire the byte row — OQ1 is a v1.1 blocker | **D2** new "Byte-shed semantics, pinned" block — option (a): the shed truncates each in-block item's rendered leaf text with a `(truncated)` marker; the FULL text of every affected item rides the spill; nothing is dropped, nothing is unrecoverable. Option (b) (retire the row) considered and rejected with the #89 reasoning. **OQ1** marked RESOLVED. |
| 6 | **Empty-pending-section frame waste** (D1) | pin "section absent when the per-worker pending set is empty" | **D1** composition bullet "Empty-pending-set pin": `inner.attention` is `undefined` and NEITHER renderer emits the section; knowledge-slice precedent (`adapter.mjs:147`). **R8** extended with the absence-on-empty assertion. |
| 7 | **Provenance collision** (D1) | require a new `wrapHubDerived` with `untrusted:true`; never map onto `wrapFact`; add red pin | **D1** frame-literal bullet: `wrapHubDerived(worker, text)` → `{provenance:'hub-derived', untrusted:true}` required; `wrapFact`/`hub-computed` (`messages.mjs:459-461`) explicitly warned off. **R8′** added: provenance NEVER `hub-computed`. |
| 8 | **`budget_alarm` unaddressed** (D3) | declare the #10-era inbox vocabulary out of the push's source set | **D3** Excluded list gains "The #10-era inbox kinds" (`approval`/`question`/`blocked`/`stalled`/`budget_alarm`, `ATTENTION_TYPES` `messages.mjs:18`); `budget_alarm`'s BD3-D wake reason cited `coordinator.mjs:11859`. Also folded the report's **SOUND** cross-run note ("this is intended" — `reservedWorkerId` durable `coordination-store.mjs:2592`, reused only across recovery `:2898`). **Refusal vocabulary**: `attention_push_not_addressed` fenced against the inbox kinds. **R7** extended. |
| 9 | **`message` field bounded-only** (D6) | assert message sources are static, or route through the sanitizer | **D6** new bullet "The `message` field is static-or-sanitized, never raw": static-message mints cited (`coordinator.mjs:12896`, `:12916`, `:4315`), `verify.reverified` has no top-level `payload.message`; route through `sanitizeVerifierDiagnosticText` or refuse non-static. **R2** extended. |
| 10 | **Spill internal framing** (D2/D1, minor) | pin the spill serialization to preserve per-item framing, or state the top-level UNTRUSTED wrap is deliberate | **D2** overflow list gains "Spill serialization preserves the per-item frame": full text written WITH each item's `[attention/untrusted]` framing + `wrapHubDerived`/`wrapProse` wraps; the top-level UNTRUSTED wrap at the CONTEXT_READ render (`coordinator.mjs:10796-10800`, `UNTRUSTED_READ_CONTENT`) is the outer layer, never a substitute. |

## D5 note (not a hole) — folded

The report's D5 note: the `answer_question`/`answer_approval` still-pending predicate leans on
`_pending` being rebuilt on replay, and D5 should cite it. Folded: **D5** Replay-safe paragraph
now cites the rebuild machinery — map init `coordinator.mjs:1156`, the `reconstructedPending`
replay loop repopulating the live map (`:14163-14165`), and the KG-1 comment naming the replay
path (`:11560-11562`).

## Open questions (report §2)

- **OQ1** — RESOLVED as a v1.1 blocker (see blocker 5): byte-shed semantics pinned (option (a)).
- **OQ2** — SOUND, unchanged. Latest-evidence-only matches `.at(-1)`.
- **OQ3** — SOUND, unchanged. Implementation-fold decision.
- **OQ4** — SOUND, unchanged. `gate:${event.seq}` is the contract; the render label is free.

## What the fold must NOT change (report §3 — verified sound) — preserved intact

- The delivery seam and render positions (D1: `_providerBrief` `coordinator.mjs:3790`, after
  `## Ambient knowledge` `adapter.mjs:147-161` / after the execution contract
  `cli-adapters.mjs:102`).
- The item-count bound (8) + digest-cited spill lane (D2 — the lane is reachable:
  `coordinator.mjs:10633`/`:10774-10787`, `mintSpill`/`materializeSpill`
  `coordination-store.mjs:13217`/`:13246`).
- The durable-id dedup keys (D5): `swf:${workerId}:${event.seq}`, interaction `requestId`,
  `gate:${event.seq}`.
- The sanitized detail shape (D6): digests+counts never path strings; `tail` =
  `sanitizeVerifierDiagnosticText` output (`verifier-diagnostics.mjs:26`).
- The refusal family (`attention_push_*`, `spill_body_exceeded`, `recovery_refinement_conflict`).
- **R5's** byte-stability of the digest pin (the augmentation never mutates `task.brief`).
