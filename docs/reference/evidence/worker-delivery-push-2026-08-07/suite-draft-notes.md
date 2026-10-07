# #79 Suite Draft Notes — `worker-delivery-push-red.test.mjs`

Date: 2026-08-07 · Contract: **worker-delivery-push v1.2** (folded) · Suite: 32 rows (21 RED / 11 PIN)
Deliverable: `impl/test/worker-delivery-push-red.test.mjs` (this draft's only other deliverable).
Authority: `worker-delivery-push-contract.md` (v1.2 source of truth), `contract-fold.md` (citation
re-anchors, per-worker verdict filter, D2 option-a byte-shed, D1 empty-pending-set pin, the
`wrapHubDerived` requirement), `contract-redteam.md` (attack surface — every pin confirmed RED at
HEAD, §1.3), `suite-79-brief.md` (this suite's brief), `suite-blueteam.md` (NEEDS-FOLD — findings
F1–F8, folded in `suite-fold-2.md`).

## Verified split (stable across consecutive runs from the repo root)

```
$ node --test impl/test/worker-delivery-push-red.test.mjs   # run from repo root
ℹ tests 32
ℹ pass 11
ℹ fail 21
ℹ cancelled 0  skipped 0  todo 0
```

Recorded after the fold was finalized. Two consecutive runs of the finished suite both produced
**pass 11 · fail 21** (run 1 ≈ 259 ms, run 2 ≈ 299 ms) — the split is deterministic. The 11 passes
are exactly the eleven PIN rows (A4, A5, B2, B3, C3, C4, C5, F2, F3, F4, G2); the 21 failures are
the red rows, each confirmed to fail at its NAMED stage (the per-row stage is in the header and in
each row's first-failing assertion message).

## Row map

Every red row fails at the named stage today and goes green on the v1.2 implementation ONLY. Stages
in **bold** are the current HEAD failure seam. All RED rows' first assertion is an `assert.ok(...)`
(or an `assert.equal(typeof …,'function', …)` for the invented methods) so the row fails at the
stage — never on a vacuous shape assertion.

| Row | § | Pin | Stage (HEAD seam) | Current failure at HEAD |
|-----|---|-----|-------------------|-------------------------|
| A1 | D1 | | **renderBrief-attention-missing** | `renderBrief` (adapter.mjs:96-163) ends at `## Ambient knowledge` (:147-161); a brief carrying `attention` renders NO `## Pending attention` section — the block is never served |
| A2 | D1 | | **renderPrompt-attention-missing** | `renderPrompt` (cli-adapters.mjs:78-109) ends at the verification execution contract; a brief carrying `attention` renders NO `## Pending attention` tail. The position pin is the `A reviewer` contract marker (:106) — a section between `Done when:` and the contract would violate D1 (F8) |
| A3 | D1/R1 | | **pending-attention-seam-missing** | `_providerBrief` (coordinator.mjs:3790-3839) attaches contextPacks/orientation/briefing but NEVER `inner.attention` — a refused `scratchpad.write_result` (`scratchpad_entry_invalid`) has no push surface |
| A4 | D1 | PIN | absence-on-empty | green today — an empty/absent `attention` emits no section from either renderer; stays live (the empty-pending-set pin, fold) |
| A5 | D1/R5 | PIN | provider-brief-purity | green today — `_providerBrief` is a pure compose (never mutates `task.brief`, mints no adapter call); stays live (the recovery-refinement digest pin never moves) |
| B1 | R8′ | | **wrapHubDerived-missing** | messages.mjs exports `wrapFact` (:459-461, hub-computed/trusted) and `wrapProse` (:463-465, model-authored/untrusted) but NO `wrapHubDerived` — the hub-derived wrapper law has no constructor |
| B2 | R8′ | PIN | wrap-shapes | green today — `wrapFact`/`wrapProse` shapes byte-stable; `wrapFact` stays `untrusted:false` forever (the R8′ kill: the push must never map onto a trusted wrapper) |
| B3 | GT8/D3 | PIN | #10-era inbox vocabulary | green today — `ATTENTION_TYPES` (messages.mjs:18) frozen, out of the push's source set |
| C1 | D2 | | **attention-push-registry-rows-missing** | `FRAME_LIMITS` (limits.mjs:109) has no `view.attention_push.items` row — the 8-item bound does not exist |
| C2 | D2 | | **attention-push-bytes-row-missing** | no `view.attention_push.bytes` row — the 4096-byte RENDER-side shed flag does not exist |
| C3 | D2/GT7 | PIN | spill.body-row | green today — `spill.body` (limits.mjs:85) mints `spill_body_exceeded`, the ONE substrate refusal row |
| C4 | D2/GT7 | PIN | spill-lane-reachable | green today — the closed `spill` query kind (coordinator.mjs:10774-10788) accepts `spill:sha256:<64hex>` and refuses malformed cites; stays live (the spill lane is the D2 overflow path) |
| C5 | GT7 | PIN | coaching-refusal-shape | green today — `composeFrameLimitRefusal` (:40-42) names cap/actual/unit and the spill graceful path |
| C6 | D2 | | **pending-attention-push-missing** | 9 genuinely-pending approvals (the interaction seam, never the `.slice(-2)`-bounded run-view source) compose 8 in-block + a `spill:sha256:<digest>` closing + the overflow id; the worker resolves the citation through the closed lane (the D2 round trip, F2) |
| C7 | D2 | | **pending-attention-push-missing** | 8 long-text questions cross 4096 rendered bytes; the renderer must emit `(truncated)` and the full text must ride the spill (the D2 byte shed, F2) |
| D1 | D1/D3 | | **pending-attention-push-missing** | `_pendingAttentionPush(workerId)` does not exist — the per-worker push projection has no surface |
| D2 | D3 | | **pending-attention-push-missing** | same missing projection — worker identity addressing (an item for A never lands in B's block) is unenforceable |
| D3 | R3/D5 | | **pending-attention-push-missing** | same missing projection — the still-pending/re-resolved dedup (R3, keyed `swf:${workerId}:${event.seq}`) is unenforceable |
| D4 | D3/R7 | | **pending-attention-push-missing** | a pending decision request (the run-view `answer_decision` source) and a BD3-C lane-delivered message must NEVER render in a worker's block — the never-pushed-kinds law (F1) |
| D5 | D5 | | **pending-attention-push-missing** | the dedup oracle must survive a driver RESTART — a second `Coordinator` over the SAME log re-derives the identical pending set; an in-memory Set must FAIL (F3) |
| D6 | D3/D5 | | **pending-attention-push-missing** | pending `answer_question`/`answer_approval` push with the interaction `requestId`, re-push while unanswered, drop once answered (F7) |
| E1 | D4 | | **attention-pushed-event-missing** | composing the block mints NO `attention.pushed {workerId, itemIds[], blockDigest, seq}` delivered receipt — `delivered = composed` is unobservable |
| E2 | D4 | | **attention-receipt-projection-missing** | `_attentionReceipt(workerId)` does not exist — the replay-derived read receipt (`read` = next turn_started) is unobservable. The fold pins BOTH cases: delivered-then-read (`read` = the turn_started seq) and delivered-but-not-read across a `process_closed` respawn (`read` = null) (F4) |
| F1 | D6 | | **gate-verdict-push-missing** | the trust-gate scope refusal mints a real `error`/`trust_gate` event (coordinator.mjs:13196-13207) but the judged worker's next brief carries NO sanitized `gate_verdict` item — the per-worker verdict filter is absent |
| F2 | D6 | PIN | pathScopeEvidence-shape | green today — the gate mints `pathScopeEvidence` digests+counts ONLY (coordinator.mjs:12896-12905), never a path string |
| F3 | D6 | PIN | sanitizer | green today — `sanitizeVerifierDiagnosticText` (verifier-diagnostics.mjs:26) redacts home paths, JWTs, `ghp_` tokens; the never-raw law holds |
| F4 | D6 | PIN | static-message | green today — the gate error `message` is the static string (`'captured worker result changed paths outside approved Plan scope'`, :12896) |
| F5 | D6 | | **gate-verdict-push-missing** | a second worker's block must NOT carry the judged worker's verdict — run-wide `debugGateRefusal(events)` scoping fails (F5a) |
| F6 | D6 | | **gate-verdict-push-missing** | a `verify.reverified accept:false` capsule with an adversarial home path + JWT must reach the worker as sanitized `detail.tail` only — the never-raw law at the push level (F5b) |
| G1 | refusals | | **push-refusal-codes-missing** | the coordinator namespace exports NO `PUSH_REFUSAL_CODES` — the frozen `attention_push_*` family is not a typed surface constant |
| G2 | refusals | PIN | refusal-precedents | green today — `spill_body_exceeded`/`scratchpad_entry_exceeded` registry codes verbatim; a store recovery-refinement refusal is a typed `CoordinationRefusal` carrying `recovery_refinement_*` (store createAndClaimRecoveryRefinement :12372, target check :12375) |
| G3 | refusals | | **attention-push-refusal-missing** | `_assertAttentionPushServed(workerId, items, opts)` does not exist — stale/unknown/not-addressed/oversized never FIRE as typed refusals (F6) |

## Invented surfaces

Two invented members are probed through namespace imports (`coordinatorNs`, `messages`); the rest
are probed through REAL surface entry points (`coordinator._providerBrief`, the renderers, the
store). Every invented member is absent at HEAD (the seam the red row holds). The first assertion on
every invented export is an `assert.ok(...)` / `assert.equal(typeof …,'function',…)`, so the row
fails at the named stage — never on a shape assertion that `Object.isFrozen(undefined) === true`
could spuriously satisfy.

| Invented surface member | Probed through | HEAD behavior |
|-------------------------|-----------------|---------------|
| `coordinator._pendingAttentionPush(workerId)` — the per-worker push projection (D1/D3, worker-identity + R3 dedup + the per-source bounds of D2/v1.2) | the coordinator instance | undefined (C6/C7/D1-D6) |
| `coordinator._attentionReceipt(workerId)` — the replay-derived read receipt projection (D4, delivered-then-read both cases) | the coordinator instance | undefined (E2) |
| `coordinator._assertAttentionPushServed(workerId, items, opts)` — the serving-path refusal guard (stale/unknown/not-addressed/oversized) | the coordinator instance | undefined (G3) |
| `coordinatorNs.PUSH_REFUSAL_CODES` — frozen ACTUAL-sorted `{attention_push_not_addressed, attention_push_oversized, attention_push_stale, attention_push_unknown_item}` | namespace import `* as coordinatorNs` | no such export (G1) |
| `messages.wrapHubDerived(worker, text)` — `{provenance: 'hub-derived', untrusted: true}` | namespace import `* as messages` | no such export (B1) |
| `FRAME_LIMITS['view.attention_push.items']` — `{lane, class:'view', value: 8, unit:'items', graceful:'spill-digest-citation'}` | real `FRAME_LIMITS` | row absent (C1) |
| `FRAME_LIMITS['view.attention_push.bytes']` — `{lane, class:'view', value: 4096, unit:'bytes', graceful:'shed-flagged'}` | real `FRAME_LIMITS` | row absent (C2) |
| the brief `attention` field — `[ {kind, requestId, workerId, …} ]` attached by `_providerBrief(brief, workerId)` | `coordinator._providerBrief(task.brief, handle.id)` | `composed.attention` undefined (A3/E1/F1) |
| the `## Pending attention` render section (UNTRUSTED_ATTENTION frame + `- [attention/untrusted] ${kind} ${requestId}: …` lines) | `renderBrief` / `renderPrompt` | no section (A1/A2) |
| the projection's closing `spill:sha256:<digest>` entry (with the overflow item ids) and the `(truncated)` render-side shed marker | `_pendingAttentionPush` output / `renderPrompt` | no projection, no shed (C6/C7) |

The verdict rows (F1, F5, F6, and the F2/F4 PINs) drive the real trust gate through a claim card —
the ScriptableAdapter deliberately has NO `turnCompletion` field so a completed turn falls STRAIGHT
through to `_runTrustGate` (coordinator.mjs:12357-12374) instead of parking the turn. The capture
double returns out-of-scope `changedPaths` and the gate mints the real `worker_path_scope_violation`
error deterministically on a microtask-only flush. F6 stages the red_green capsule by appending the
`verify.reverified` durable event directly through the coordinator's own `_log` (the D6 source
stream a correct push projection reads); the secret is a home path + a well-formed JWT, so a raw
push has something concrete to leak.

## PIN list (the wrong implementation each pin kills)

| Pin | Kills |
|-----|-------|
| **A4** absence-on-empty | an impl that renders an empty block (a stale `## Pending attention` header over an empty set — the D1 empty-pending-set pin) |
| **A5** provider-brief-purity | an impl that mutates the admitted `task.brief` while composing (the R5 digest pin — `briefDigest = canonicalDigest(activeTask.brief)` moves, and store-side recovery-refinement lineage (:3009) refuses) |
| **B2** wrap-shapes | an impl that reuses `wrapFact` for hub-derived leaves (ships `untrusted:false` across the provider seam — the R8′ kill) or renames the wrapper's provenance |
| **B3** #10-era inbox vocabulary | an impl that draws the push from `approval/question/blocked/stalled/budget_alarm` (the #10-era inbox, GT8/D3) instead of the refused-write/gate-verdict/interaction source set |
| **C3** spill.body-row | an impl that drops the `spill_body_exceeded` refusal or moves it off the ONE substrate row (limits.mjs:85) — the D2 overflow refusal family must stay verbatim |
| **C4** spill-lane-reachable | an impl that replaces the closed `spill` query kind (a truncated raw overflow would never answer with a digest citation) |
| **C5** coaching-refusal-shape | an impl that stops naming cap/actual/unit or the spill path phrase (a silent truncation would evade the D2 spill) |
| **F2** pathScopeEvidence-shape | an impl that leaks a path string in `pathScopeEvidence` (D6's never-raw law) or renames a digest/count key |
| **F3** sanitizer | an impl that lets a raw home path / JWT / provider token through the single redaction path (GT6) |
| **F4** static-message | an impl that splices a raw capsule or embedded path into the gate error `message` (D6) |
| **G2** refusal-precedents | an impl that renames `spill_body_exceeded` / `scratchpad_entry_exceeded`, or types the `recovery_refinement_*` family as a bare throw instead of a `CoordinationRefusal` |

## What makes each stage go green (implementer's checklist)

- **renderBrief-attention-missing / renderPrompt-attention-missing** → D1: after the last data
  section (`## Ambient knowledge` in renderBrief; the verification execution contract — past the
  `A reviewer` marker, cli-adapters.mjs:106 — in renderPrompt) both renderers emit
  `## Pending attention` when `Array.isArray(brief.attention) && brief.attention.length > 0` —
  opened by the closed `UNTRUSTED_ATTENTION` frame, one
  `- [attention/untrusted] ${kind} ${requestId}: ${text}` line per item, never a raw trust marker.
- **pending-attention-seam-missing** → D1/D3: `_providerBrief(brief, workerId)` attaches
  `inner.attention` from the per-worker projection (a NEW value on a NEW provider-facing object —
  the admitted `task.brief` stays byte-stable, A5). A refused write (`scratchpad.write_result
  ok:false`) is the R1 membership class, keyed `swf:${workerId}:${event.seq}`.
- **wrapHubDerived-missing** → R8′: `messages.wrapHubDerived(worker, text)` →
  `{worker, text, provenance: 'hub-derived', untrusted: true}` — hub-recorded content that is
  NEVER trusted, distinct from `wrapFact` (trusted) and `wrapProse` (model-authored).
- **attention-push-registry-rows-missing / attention-push-bytes-row-missing** → D2: the two
  `view.attention_push.*` rows land in the VIEW registry (limits.mjs) — items 8 /
  `spill-digest-citation` (overflow is a digest-cited spill, never a truncation; the
  `view.knowledge_slice.items`=8 precedent, limits.mjs:100) and bytes 4096 / `shed-flagged` (a
  RENDER-side shed flag, never a wire cap, OQ1).
- **pending-attention-push-missing** → D1/D3/R3 + D2/v1.2: `_pendingAttentionPush(workerId)`
  returns the push-qualified pending items addressed to THAT worker by identity (`workerId`),
  derived per D5's still-pending predicates for EVERY source (never the run-view's `.slice(-2)`
  display bound — the per-source pin, D2/v1.2), bounded by the item/byte rows (C6/C7); a re-push
  of a resolved item refuses `attention_push_stale`; dedup keys are the durable ids
  (`swf:${workerId}:${event.seq}`, `gate:${event.seq}`, the interaction `requestId`). The
  orchestrator-only kinds and the #10-era inbox kinds are NEVER in the output (D4).
- **attention-pushed-event-missing** → D4: composition mints exactly one durable
  `attention.pushed {workerId, itemIds[], blockDigest, seq}` (delivered = composed, honestly —
  never a wire ack); `blockDigest` is sha256 of the block.
- **attention-receipt-projection-missing** → D4: `_attentionReceipt(workerId)` replays the worker
  stream: `delivered: true` once an `attention.pushed` exists, `read` = the first `turn_started`
  with `seq ≥ push.seq` and NO `process_closed` in `(push.seq, turn.seq)` between them (replay-derived,
  never upgraded to a lie across process death) — `read` is an event seq, never a wall clock (E2).
- **gate-verdict-push-missing** → D6/TG4: the judged worker's next brief carries ITS OWN sanitized
  `{kind:'gate_verdict', requestId:'gate:${event.seq}', workerId, gate, code, detail}` where
  `detail` is `{digests, counts}` for scope and `{tail: sanitizeVerifierDiagnosticText(raw).text}`
  for red_green/coverage — the per-worker projection
  `debugGateRefusal(events.filter(e => e.worker === workerId))`, never the run-wide log (F5), and
  never a raw path/JWT (F6).
- **push-refusal-codes-missing** → refusals: the coordinator exports the frozen `PUSH_REFUSAL_CODES`
  family in ACTUAL sorted order (`attention_push_not_addressed`, `attention_push_oversized`,
  `attention_push_stale`, `attention_push_unknown_item`), reusing the snake_case refusal machinery
  (`CoordinationRefusal`, the `spill_body_exceeded` precedent).
- **attention-push-refusal-missing** → refusals: the serving path validates a candidate item set
  and refuses with the typed codes — `attention_push_stale` for a resolved item, 
  `attention_push_unknown_item` for an unknown id, `attention_push_not_addressed` for an
  orchestrator-only/cross-worker/inbox item, `attention_push_oversized` with the
  `{cap, actual, unit, gracefulPath}` coaching shape (C5's composer) when the set exceeds 8 and the
  spill lane is unavailable (G3).

## Suite-law hygiene (verified)

- **Hermetic**: ScriptableAdapter (no harness, no network) + mock worktrees/capture; `mkdtempSync`
  logs; global `test.after` cleanup; the deployment-verification stub is the brief's `true` command.
- **Red-first at named stages**: every RED row's first assertion is the named-stage failure (an
  `assert.ok`/`typeof` for invented surfaces, a behavior assertion for the renderer/registry/seam
  rows); the stage names live in the header row inventory AND in each row's assertion message.
  21 RED rows / 11 PINs, stable across consecutive runs.
- **NUL discipline**: `application.mjs` and `coordination-store.mjs` (3 NUL bytes each) are never
  read whole — only their exports are imported (`Coordinator`, `coordinationForLog`,
  `CoordinationRefusal`). `adapter.mjs`, `cli-adapters.mjs`, `messages.mjs`, `limits.mjs`,
  `coordinator.mjs`, and `verifier-diagnostics.mjs` are NUL-free and read for the anchors. The suite
  file itself is NUL-free.
- **No clocks as controls / no wall-clock assertion**: every row drives the real coordinator event
  path with a fixed microtask drain (`flush(n)`); the gate rows are microtask-only by construction
  (the claim card falls straight through to `_runTrustGate`, whose capture is the mock's resolved
  promise). No row asserts a wall-clock behavior; `Date.now()` never appears. The D5 restart row's
  "restart" is a second `Coordinator` over the same durable log (a fresh-process equivalent), never
  a wall-clock wait.
- **No `localeCompare`**; the `PUSH_REFUSAL_CODES` literal and `pathScopeEvidence` key set are
  asserted in ACTUAL sorted order against frozen constants.
