# #79 RED-TEAM VERDICT — adversarial attack on `worker-delivery-push-contract.md` v1.0

Verifier: red-team pass r5-2026-08-07. Verification HEAD: **`c34e1f36cb48afd98c8bd0433fc60d0fa74387db`**
(current worktree HEAD — the contract's stated HEAD `6f6ea7b…` is not the tree under test; every
citation below was re-grepped at this HEAD). NUL files (`application.mjs`, `coordination-store.mjs`)
were touched only via `grep -an` / `sed -n`, never whole-file reads.

Laws applied: no clocks (none found); every citation re-verified at the current HEAD; sorted-key
literals in ACTUAL source order (none contested); `localeCompare` banned (none found).

---

## 1. Citation re-verification — FAIL (wrong citations present → automatic blocker)

### 1.1 Verified-correct anchors (substance confirmed)

All of the following were re-verified at HEAD and are accurate in substance and anchor:

| Contract claim | Anchor | Verified |
|---|---|---|
| GT1 `answer_question`/`answer_approval` mint, `requestId` fallback | application.mjs:7611-7620 | ✓ (`request.msgId ?? …pendingQuestionId ?? null`, `request.id ?? …pendingApprovalId ?? null`) |
| GT1 `turn_checkpoint` block, `requestId: pauseId` | application.mjs:7627-7644 | ✓ (`kind: 'turn_checkpoint'` at :7632; pushed ALONGSIDE, per the :7622-7626 comment) |
| GT1 `scratchpad_write_failed`, last-two-per-worker bound, `swf:` id | application.mjs:7646-7664 | ✓ (`slice(-2)`; `swf:${workerId}:${event.seq ?? event.turnEpoch ?? 0}` at :7661) |
| GT1 `session_preservation` on `interruption_uncertain` | application.mjs:7666-7671 | ✓ (`kind: 'session_preservation'` at :7667) |
| GT1 `MAX_ATTENTION = 64`; `allAttention.slice(0, MAX_ATTENTION)` | application.mjs:55, :7672 | ✓ |
| GT1 `projectDecisionAttention` kind/state discriminators | application.mjs:566-590 | ✓ (`interaction.kind !== 'decision' || interaction.state !== 'pending'` at :570; addressee = the worker whose `pendingDecisionId` the orchestrator must answer) |
| GT2 wave-view kinds | application.mjs:7242-7281 | ✓ (`answer_question` :7247, `answer_approval` :7252, `candidate_selection` :7258, `workflow_revision` :7266, `workflow_recovery` :7270, `session_preservation` :7274) |
| GT3 `_providerBrief` seam; `UNTRUSTED_CONTEXT_PACK` literal | coordinator.mjs:3790-3839, :3816 | ✓ |
| GT3 "briefing never enters task.brief" comment | coordinator.mjs:3829-3833 (cited :3828-3832) | ✓ (phrase "never enters task.brief" at :3832) |
| GT3 spawn/recovery callers | coordinator.mjs:3516, :4025 | ✓ (both real `_providerBrief` call sites; also :5508) |
| GT3 `renderBrief` dialect; final data section `## Ambient knowledge` | adapter.mjs:96-163 (fn closes :164), :148 | ✓ (header at :148 within the cited :147-161) |
| GT3 `renderPrompt` dialect; `Done when:` + verification contract final | cli-adapters.mjs:78-109, :102 | ✓ |
| GT4 digest-pin check | coordination-store.mjs:3003 | ✓ (`canonicalDigest(fields.brief) !== canonicalDigest(priorTask.brief)`) — **but see §1.2 #5** |
| GT5 BD3-C frame `[MESSAGE … — UNTRUSTED]` | coordinator.mjs:6931-6932 (cited :6930-6932) | ✓ |
| GT5 spill head + `spill:sha256:` citation | coordinator.mjs:6926-6930 (comment), spill id = `spill:sha256:${digest}` at coordination-store.mjs:13229 | ✓ |
| GT5 receipts vocabulary; read marking; process_closed generation end | coordinator.mjs:12036-12058 | ✓ (readBy marking at :12045-12046; `process_closed` bump at :12055-12058) |
| GT6 `debugGateRefusal` span | application.mjs:984-1006 | ✓ |
| GT6 sanitizer | verifier-diagnostics.mjs:26 | ✓ (`export function sanitizeVerifierDiagnosticText`) |
| GT7 FRAME_LIMITS rows | limits.mjs:1-9, :34, :40-42, :85, :98, :100, :101 | ✓ (`composeFrameLimitRefusal` :40; spill phrase :34; `spill.body` 1 MiB/`spill_body_exceeded` :85; `view.attention_text.bytes` 4096 :98; `view.knowledge_slice.items` 8 :100; `view.knowledge_slice.bytes` 2048 :101) |
| GT7 CONTEXT_READ closed `spill` lane | coordinator.mjs:10771-10784 | ✓ (query validation `^spill:sha256:[a-f0-9]{64}$` at :10777; worker-facing `contextRead` at :10630) |
| GT8 `ATTENTION_TYPES` frozen | messages.mjs:18; messages.test.mjs:225 | ✓ |
| GT9 `wrapProse` shape | messages.mjs:458-460 (cited :458-462) | ✓ `{worker, text, provenance:'model-authored', untrusted:true}` |
| GT9 `UNTRUSTED_WEB_CONTENT_FRAME` | messages.mjs:542-543 | ✓ |
| D3 `decision.settled` after native `answer(...)` affirmation | coordinator.mjs:9887 (`answer` call), :9906 (`decision.settled` … `disposition:'delivered'`) | ✓ (cited :9887-9906) |
| D4 process_generation semantics | coordinator.mjs:12055-12058 | ✓ |
| D2 spill mint/materialize reachable | coordination-store.mjs:13217, :13246; coordinator.mjs:10630, :10780 | ✓ |
| Refusal family precedents `scratchpad_entry_exceeded` / `spill_body_exceeded` / `recovery_refinement_conflict` | limits.mjs:70, :85; coordination-store.mjs:3009 | ✓ |

### 1.2 Wrong citations — automatic blockers

1. **GT1**: "…`answer_decision` minted by `projectDecisionAttention` … call at `application.mjs:7622`."
   The call `allAttention.push(...projectDecisionAttention(...))` is at **:7621** (grep-verified).
   Line 7622 is the `// Issue #31 §2.3` comment. **Fix: `:7621`.**
2. **GT6**: "`debugGateFromLiveCode :943-949`". The function spans **:940-947** (`grep -an` → 940).
   Lines 943-947 are its tail; 948-949 are blank + `function debugGateDetail`. **Fix: `:940-947`.**
3. **D5**: "matching `debugGateRefusal`'s `.at(-1)`, application.mjs:996-997". `candidates.at(-1)` is at
   **:990**; :996-997 are the `gate`/`message` locals. **Fix: `:990`.**
4. **D6 / GT6**: "red_green / coverage → `{tail: sanitizeVerifierDiagnosticText(raw).text}` …
   (application.mjs:979-983)". The red_green/coverage branch is **:971-977** and the tail line is at
   **:976** (grep-verified). Lines 979-983 are the closing of `debugGateDetail` and the DG-1 comment
   block. **Fix: `:971-977` (tail at :976).**
5. **GT4 overclaim**: "The pin is on `task.brief` ONLY." The `recovery_refinement_conflict` check
   (coordination-store.mjs:3000-3008) pins **`task.brief`, `modelRequested`, `modelPolicy`,
   `effortRequested`, `attribution.modelRequested`, `attribution.effortRequested`, `vendorRequested`
   /harness, `refines`, `reservedWorkerId`/`assignee`, `runId`, `taskType`**. `task.brief` is the
   operand that matters for the verdict-channel argument, but the claim that it is the ONLY pin is
   false. **Fix: rephrase to "the brief is digest-pinned (as are the model/effort admission fields) —
   the verdict cannot ride a byte-identical refinement brief regardless."**
6. **Minor**: GT6 "scope → `{digests…, counts…}` (:955-976)" — digests block :955-961, counts
   :962-968, branch closes :970; the cited range bleeds into the red_green branch. Substance right,
   range loose. GT9 `wrapProse :458-462` — actual :458-460. Both cosmetic; fold along with #1-#4.

### 1.3 RED-state confirmation

`grep` across `impl/` at HEAD confirms the behavior is genuinely absent today: no
`## Pending attention` section, no `UNTRUSTED_ATTENTION` literal, no `attention.pushed` event kind,
no `gate_verdict` kind, no `view.attention_push.*` registry rows. **All pins R1-R8 are red-first.**
The red-suite harness shape (`impl/test/issue62-write-failure-red.test.mjs` — `BatonApplication` +
`MockAdapter` + `createDriver`, scripted up-channel events) is a workable template for
`issue79-delivery-push-red.test.mjs`.

---

## 2. Decision verdicts

### D1 — The `## Pending attention` brief-section seam — **HOLE**

**SOUND:**
- The seam is right: `_providerBrief` (coordinator.mjs:3790) is the single augmentation point that
  every spawn/recovery path composes through (:3516, :4025, :5508), and `renderBrief`/`renderPrompt`
  are the only two provider-facing renderers. The block cannot touch `task.brief` (it rides the
  returned value, exactly like the `briefing` block), so the GT4 digest pin (coordination-store.mjs:3003)
  is byte-stable — R5 is honest.
- The render positions are pinned correctly: after `## Ambient knowledge` (adapter.mjs:148) in
  `renderBrief`, after the verification execution contract (cli-adapters.mjs:102-106) in `renderPrompt`.
- The spill citation is **reachable, not a dead citation**: the closed `CONTEXT_READ {kind:'spill'}`
  lane is live (coordinator.mjs:10630, :10771-10784), `mintSpill`/`materializeSpill` exist
  (coordination-store.mjs:13217/:13246), and the spill body is UNTRUSTED-framed by the read renderer.

**HOLE 1 — empty-pending-set rendering is unpinned (frame waste, violates #89).**
D1 says the block is "recomputed at every spawn/recovery", but never says whether the section
renders when the pending set is **empty**. A permanent `## Pending attention` (even a
`(none …)` marker) on every turn of a worker with no pending items is exactly the per-turn frame
waste the #89 economics law forbids. The shipped precedent is the knowledge slice, which renders
**only when `brief.knowledge` is present** (adapter.mjs:147) — the section is absent when there is
nothing to serve. **Fix: pin "when the per-worker pending set is empty, `inner.attention` is
`undefined` and neither renderer emits the section."** R8 should assert absence-on-empty.

**HOLE 2 — provenance naming collides with a TRUSTED shipped wrapper.**
The shipped hub wrapper is `wrapFact` → `{provenance: 'hub-computed', untrusted: false}`
(messages.mjs:454-456); `wrapProse` → `{provenance: 'model-authored', untrusted: true}` (:458-460).
D1 invents `{provenance: 'hub-derived', untrusted: true}` — a NEW literal that sits in the same
"hub" family as the TRUSTED `hub-computed`. An implementer who maps "hub-derived" onto `wrapFact`
(not `wrapProse`) produces **untrusted:false** hub content crossing the provider seam — the exact
injection the frame exists to stop. The contract pins the shape but never warns off `wrapFact`.
**Fix: require a new wrapper (e.g. `wrapHubDerived`) and pin `untrusted:true`; add a red pin R8'
that asserts the pushed content's provenance is never `hub-computed`.**

### D2 — Byte budget: item-count bound + digest-cited spill — **HOLE**

**SOUND:** two rows in the ONE registry, no re-declaration; `view.attention_push.items` = 8 matches
the knowledge-slice precedent (limits.mjs:100); overflow is a durable content-addressed spill
(`spill:sha256:` at coordination-store.mjs:13229), never a truncation of the head; the substrate
`spill.body` ceiling mints the one refusal (limits.mjs:85). The spill lane is reachable (see D1).

**HOLE — the byte shed flag contradicts "the in-block items are served in full".**
`view.attention_push.bytes` = 4096 is a "render-side shed flag, explicitly NOT a wire cap". But the
per-item text bound is 4096 **per item** (`boundedAttentionText`, application.mjs:330-331), so 8
items render up to ~32 KB — the block crosses 4096 rendered bytes after ~2 items. When the byte shed
fires, WHAT sheds? If it sheds in-block item text, that is exactly the truncation D2's "never a
truncation of the head items; the in-block items are served in full" forbids. If it only sets a flag,
it does nothing (dead row). The interaction between the item-count bound (spill the excess) and the
byte shed (truncate/shed the in-block) is unspecified. **Fix: pin the byte shed semantics — either
(a) the byte shed truncates each item's rendered text with a `(truncated)` marker and the spilled
items carry the full text (honest, preserves "head served, excess spills"), or (b) retire the byte
row and let the item-count bound be the sole render bound (OQ1's fold). Either way OQ1 is no longer
deferrable — it is a v1.0 blocker.**

### D3 — Worker-identity addressing — **HOLE** (minor)

**SOUND:**
- Worker-id equality is the sole address — no content matching. The run-view projection is
  per-worker-shaped (GT1), the durable ids are the correct keys.
- The excluded kinds are complete **for the run/wave-view projections**: `answer_decision`
  (orchestrator-addressed; lane-delivered via `decision.settled` after the native `answer()`
  affirmation, coordinator.mjs:9906 — never double-pushed), `candidate_selection`/`workflow_revision`/
  `workflow_recovery` (GT2), `session_preservation` (GT1 run-view has NO `workerId` on the item at
  :7667, so it can never match a receiving worker), `turn_checkpoint` (driver-consumed), BD3-C lane
  messages (lane-delivered).
- **Cross-run leakage: no.** Worker ids are durable per-task (`reservedWorkerId`,
  coordination-store.mjs:2592); the push sources are the current run's `story.workers` and the
  current run's log — a reused id cannot pull another run's items. Within a run, ids are reused only
  across recovery refinement (`reservedWorkerId: priorTask.reservedWorkerId`,
  coordination-store.mjs:2898), and re-pushing the still-pending items to the refined worker is the
  intended corrective loop. Worth a one-line "this is intended" pin.

**HOLE — `budget_alarm` is unaddressed in the never-pushed list.**
D3's "Excluded (orchestrator-only, never pushed)" list is framed as complete but omits `budget_alarm`
— a BD3-D attention-inbox wake reason (`'resource.budget_threshold': 'budget_alarm'`,
coordinator.mjs:11856; event mint :8974), not a GT1 run-view kind. It is therefore neither pushed nor
declared out of scope, and GT8 explicitly separates #79 from the #10-era inbox vocabulary.
**Fix: add "the #10-era inbox kinds (ATTENTION_TYPES: approval/question/blocked/stalled/budget_alarm,
messages.mjs:18) are out of the push's source vocabulary — the push sources are GT1's run-view
projection + the TG4 verdict only; none of them is ever pushed."** (This also resolves the attack
question: `budget_alarm` is orchestrator/operator-relevant, and today lives on the BD3-D inbox, not
on a worker's next-turn context.)

### D4 — Delivery receipts — **HOLE** (2)

**SOUND:** delivered-then-read is honestly distinguishable by event order (block composed at spawn
before the first `turn_started`); a respawned worker's original delivery honestly shows `read: null`
(no reads inherited across `process_closed`); `actedOn` never claimed, `reply` unused; no new
response wire (responses ride the existing up-channels — the native adapter `answer()`,
`decision.requested`/`approval.requested`, `scratchpad.write` at coordinator.mjs:12437).

**HOLE 1 — `delivered` overclaims on a provider-session write failure.**
D4 derives `delivered` from "the `attention.pushed` event existing" and asserts that proves "the
block was written to the durable provider-session stream". But the event is minted at the
`_providerBrief` composition seam, which is a pure function — it cannot await the adapter write.
If the spawn/recovery path hands the brief to the adapter and the `prompt()` send fails (the BD3-C
lane's own send models exactly this, returning `{ok:false}`, coordinator.mjs:6934-6937), the event
exists and `delivered` claims a delivery the wire never made. **Fix: append `attention.pushed` only
when the provider-facing write is affirmed (mirror the BD3-C `deliveries`-after-send discipline), or
redefine `delivered` honestly as "composed into the provider-facing brief value" and add a separate
`wireAffirmed` state.**

**HOLE 2 — `read` is not pinned as replay-derived.**
D4's header claims "durable, replay-derived" and "a READ-SIDE PROJECTION over durable events", but
the cited mechanism is the BD3-C read marking (coordinator.mjs:12036-12058), which iterates the
**live** `_messages` map and the **live** `_messageProcessGeneration` map (both `new Map()` in the
constructor, coordinator.mjs:1190/1196; "Receipts are process-scoped coordinator state — never
store-derived", :1188). The push has no `_messages` record, so the implementation must either
replay-derive the generation from durable events (a `lifecycle.turn_started` at seq ≥ push seq with
**no** `lifecycle.process_closed` between them) or reuse a live map. The contract does not say which,
and its own "replay-derived" law demands the former. **Fix: pin the replay-derived definition — "read
= the first `lifecycle.turn_started` with `seq ≥ push.seq` and no `lifecycle.process_closed` with
`seq` in (push.seq, turn.seq)"; do NOT route the push's read through the BD3-C live-map marking.**

### D5 — Dedup / idempotency — **SOUND** (one citation addition)

Durable-id keys (`swf:${workerId}:${event.seq}`, interaction `requestId`, `gate:${event.seq}`);
event-derived still-pending predicates; supersession replaces the verdict item (new `gate:${seq2}`)
rather than accumulating; the block carries the requestId so the idempotency key rides the wire;
re-push-IFF-still-pending is the intended turn-to-turn behavior. **Note (not a hole): the
`answer_question`/`answer_approval` still-pending predicate depends on `_pending` being rebuilt on
replay (coordinator.mjs:1156; rebuild path :14161; comment :11560-11562). That rebuild exists, but D5
should cite it — otherwise "pure function of the durable event log" leans on undocumented machinery.**
After a driver restart/attach the dedup keys are replay-derived, so no same-block double-push is
possible; the still-pending item is re-pushed on the next spawn exactly once per block.

### D6 — The verdict push — **HOLE** (2)

**SOUND:** the pushed shape is the already-sanitized `{kind, code, message, gate, detail}`;
scope `detail` is digests+counts only — `pathScopeEvidence` minted at coordinator.mjs:12895-12904
carries digests and counts, never path strings, and `debugGateDetail` null-checks each field
(application.mjs:950-970); red_green/coverage `tail` is `sanitizeVerifierDiagnosticText` output
(verifier-diagnostics.mjs:26, redacts keys/JWTs/gh-tokens/home+tmp paths), never the raw
`failureCapsule`; the verdict is keyed `gate:${event.seq}` and superseded events replace it. The
worker's correction loop **does** get actionable evidence — gate + code + message + digests/counts it
can compare against its own change-set digests — not just a bare code.

**HOLE 1 — the per-worker verdict filter is unpinned (breaks D3).**
`debugGateRefusal(events)` filters by **event kind only** (`error`/trust_gate, `verify.reverified`
accept:false — application.mjs:984-990), never by `event.worker`. Its only current caller passes the
run-wide log (application.mjs:11284), which is correct for the run-level `run.debug` view. D6 says
`_pendingAttentionPush(workerId)` derives "the live gate verdict for that worker from the same source
events debugGateRefusal reads", but the "for that worker" filter is never specified. The gate events
DO carry a top-level `worker` field (coordinator.mjs:6462 `worker: workerId`, :13010 `worker:
handle.id`, :13200 `worker: handle.id`), so the filter is available — but unless pinned, a naive
reuse of `debugGateRefusal(events)` with the run-wide log pushes the SAME verdict to EVERY worker,
violating D3's worker-identity addressing and the R2/R7 pins. **Fix: pin the worker-scoped
projection — "the verdict item is `debugGateRefusal(events.filter(e => e.worker === workerId))`,
keyed `gate:${event.seq}` from the worker-scoped latest event, and its `workerId` is the source
event's top-level `worker` field."**

**HOLE 2 — the `message` field is bounded-only, not sanitized.**
D6's "the shape is the ALREADY-sanitized one" holds for `detail` but the `message` field
(`boundedAttentionText(event.payload.message)`, application.mjs:997-998) is only byte-bounded. Today
the risk is low — every minted trust-gate error message I checked is a static string
(`'captured worker result changed paths outside approved Plan scope'` :12893, `'approved Plan
required a repository edit …'` :12914, `'plan-gated dispatch requires an exact harness'` :4315), and
`verify.reverified` has no top-level `payload.message`, so the field is null for red_green/coverage.
But nothing in the contract asserts that, and a future gate message that embeds a path or credential
would leak through the push. **Fix: state the message sources are static today, and route the message
through `sanitizeVerifierDiagnosticText` (or refuse non-static messages) so the "NEVER raw" law
covers the whole shape, not just `detail`.**

### Refusal vocabulary — **SOUND**

All six codes are consistent with the registry family: `spill_body_exceeded` (limits.mjs:85) and
`recovery_refinement_conflict` (coordination-store.mjs:3009) reused verbatim; `attention_push_*`
follow the snake_case family; `attention_push_oversized` uses `composeFrameLimitRefusal` output
(limits.mjs:40-42) and names the `view.attention_push.items` row. The three `attention_push_*`
refusals are defensive serving-path guards (the hub composes the push from its own state, so
cross-worker/stale/unknown items are internal-bug signals) — appropriate. **One addition: the
never-pushed set should include the #10-era inbox kinds (see D3 hole), so `attention_push_not_addressed`
has a defined fence against them.**

### Acceptance pins R1-R8 — **RED-first confirmed, with 2 dependencies**

All pins are genuinely red at HEAD (§1.3) and testable with the issue62 harness shape. Two pins
inherit fixes from the decision holes: **R6** ("read is the first `turn_started` in the same process
generation") must assert the replay-derived generation definition (D4 Hole 2); **R2** ("NEVER a path
string") must also assert the `message` field is sanitized/static (D6 Hole 2). **R8** should add the
absence-on-empty assertion (D1 Hole 1) and a never-`hub-computed` assertion (D1 Hole 2). **R5** is
independently honest (the augmentation never mutates `task.brief`).

### Open questions — verdicts

- **OQ1 (byte row necessity):** **NOT deferrable — must be resolved in the v1.0 fold.** The byte
  shed's interaction with "in-block items served in full" is a live contradiction (D2 hole), not a
  post-hoc cleanup. Verdict: either pin the shed semantics or retire the row before fold.
- **OQ2 (verdict supersession display):** **SOUND.** Latest-evidence-only matches `debugGateRefusal`
  `.at(-1)` semantics; the correction loop needs the latest evidence, not the ledger.
- **OQ3 (wave-member parity):** **SOUND.** The per-worker projection is identical either way; a
  legitimate implementation-fold decision.
- **OQ4 (`gate_verdict` kind name):** **SOUND.** The durable id `gate:${event.seq}` is the contract;
  the render label is free.

---

## 3. Final verdict: **NOT FOLD-READY**

Numbered blockers (what + why + concrete fix):

1. **Wrong citations** — GT1 "call at :7622" → **:7621**; GT6 "`debugGateFromLiveCode :943-949`" →
   **:940-947**; D5 "`.at(-1)`, :996-997" → **:990**; D6 "red_green/coverage (:979-983)" →
   **:971-977, tail :976**; GT4 "pin on `task.brief` ONLY" → overclaim (coordination-store.mjs:3000-3008
   also pins model/effort/attribution/vendor fields). The citation law is a hard gate; the substance
   is verified but the anchors are not. *Fix: correct the five anchors/overclaim above.*
2. **Per-worker gate-verdict filter unpinned (D6/D3)** — `debugGateRefusal` filters by kind only
   (application.mjs:984-990); a naive run-wide reuse pushes the SAME verdict to EVERY worker,
   violating D3 and R2/R7. *Fix: pin
   `debugGateRefusal(events.filter(e => e.worker === workerId))` and the verdict's `workerId` =
   source-event top-level `worker`.*
3. **`delivered` overclaims on send failure (D4)** — the `attention.pushed` event is minted at the
   composition seam and cannot await the provider write; "delivered" must not be derived from
   composition alone. *Fix: append the event only on affirmed delivery, or honestly redefine
   `delivered` = "composed into the provider-facing brief" with a separate wire-affirmed state.*
4. **`read` not pinned replay-derived (D4)** — the contract claims "durable, replay-derived" but
   cites the live-map BD3-C marking (coordinator.mjs:12036-12058, live maps :1190/:1196). *Fix: pin
   "read = first `turn_started` with `seq ≥ push.seq` and no `process_closed` between"; do not route
   through the live map.*
5. **Byte shed vs "served in full" contradiction (D2)** — 8 items × up to 4096-byte text each blow
   past the 4096-byte render bound; the shed either truncates the head (forbidden) or is a dead row.
   *Fix: pin the shed semantics or retire the byte row (resolve OQ1 in the fold).*
6. **Empty-pending-section frame waste (D1)** — the section's empty-case rendering is unpinned; a
   permanent empty block is per-turn frame waste under #89. *Fix: pin "section absent when the
   per-worker pending set is empty", matching the knowledge-slice precedent (adapter.mjs:147).*
7. **Provenance collision (D1)** — `hub-derived` (untrusted:true) sits in the same "hub" family as
   the TRUSTED `wrapFact`/`hub-computed` (messages.mjs:454-456); an implementer mapping onto `wrapFact`
   ships trusted hub content across the seam. *Fix: require a new `wrapHubDerived` with
   `untrusted:true` and add a red pin asserting the pushed provenance is never `hub-computed`.*
8. **`budget_alarm` unaddressed (D3)** — the never-pushed list is framed as complete but omits the
   #10-era inbox kinds (`ATTENTION_TYPES` incl. `budget_alarm`, messages.mjs:18). *Fix: declare the
   inbox vocabulary out of the push's source set explicitly.*
9. **`message` field bounded-only (D6)** — the "already-sanitized" claim covers `detail`, not
   `message`. Low risk today (minted messages are static) but unpinned. *Fix: assert message sources
   are static, or route through the sanitizer.*
10. **Spill internal framing (D2/D1, minor)** — overflow items written to the spill artifact lose
    per-item `[attention/untrusted]` framing and provenance wraps if the artifact is a plain
    serialization; only the top-level UNTRUSTED wrap survives the `CONTEXT_READ` render
    (coordinator.mjs:10772-10773). *Fix: pin the spill serialization to preserve per-item framing, or
    state that the top-level UNTRUSTED wrap is the deliberate discipline for spilled content.*

**What the fold must NOT change:** the delivery seam (D1 positions), the item-count bound + spill
lane (D2, the lane is reachable), the durable-id dedup keys (D5), the sanitized detail shape (D6),
the refusal family, and R5's byte-stability of the digest pin. Those verified sound.
