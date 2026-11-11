# #79 blue-team — worker-delivery-push red suite, adversarial verification

Contract: `docs/reference/evidence/worker-delivery-push-2026-08-07/worker-delivery-push-contract.md`
(v1.1, fold HEAD `a2a4b295…`). Suite: `impl/test/worker-delivery-push-red.test.mjs` (24 rows:
13 RED / 11 PIN). Verified at HEAD `7cc12f4` ("Baton private effective-tree snapshot"),
2026-08-07, node v25.8.0. NUL discipline honored: `application.mjs` and
`coordination-store.mjs` (3 NUL bytes each) were read only via `grep -an` / `sed -n`; all
citations below re-verified at this HEAD.

**Verdict: NEEDS-FOLD.** The suite is honestly red today (11 pass / 13 fail, every red row fails
at its NAMED stage, hermetic, deterministic) and every red fixture is green-side mintable under a
correct v1.1 implementation — I verified each event stream the rows depend on (refused-write
receipt, corrective write receipt, the real trust-gate scope error, the closed spill lane, the
store recovery-refinement refusal). The 11 PINs are green for legitimate reasons. But the suite's
**red-keeping power has five load-bearing holes**: (1) the never-pushed-kinds law (R7) has no
enforcing row — `ORCHESTRATOR_ONLY_KINDS` is declared and never used; (2) the D2 overflow/spill
round trip has no row (the registry and lane are pinned, the overflow behavior is not), and a
naive overflow fixture would itself be green-side-blocked by the run-view `.slice(-2)` bound;
(3) the D5 dedup row is single-instance and passes with an in-memory Set (no restart/replay
oracle); (4) the D4 delivered-then-read receipt is pinned only in its `read: null` case; (5) the
D6 verdict push is pinned only for a single worker's scope gate — run-wide verdict scoping and a
raw red_green/coverage tail both green the suite. Seven further gaps are numbered below.

---

## 0. Run record (exact)

Run from the repo root (`node --test impl/test/worker-delivery-push-red.test.mjs`), two
consecutive runs:

```
run 1: tests 24 · pass 11 · fail 13 · cancelled 0 · skipped 0 · todo 0 (≈379 ms)
run 2: tests 24 · pass 11 · fail 13 · cancelled 0 · skipped 0 · todo 0 (≈411 ms)
```

The 11 passes are exactly the PIN rows **A4, A5, B2, B3, C3, C4, C5, F2, F3, F4, G2**; the 13
failures are exactly the RED rows **A1, A2, A3, B1, C1, C2, D1, D2, D3, E1, E2, F1, G1**. The
split matches the suite header exactly; no divergent test.

Every red row fails at its named stage (extracted from the failure output):

| Stage | Rows |
|---|---|
| `renderBrief-attention-missing` / `renderPrompt-attention-missing` | A1, A2 |
| `pending-attention-seam-missing` | A3 |
| `wrapHubDerived-missing` | B1 |
| `attention-push-registry-rows-missing` / `attention-push-bytes-row-missing` | C1, C2 |
| `pending-attention-push-missing` | D1, D2, D3 |
| `attention-pushed-event-missing` | E1 |
| `attention-receipt-projection-missing` | E2 |
| `gate-verdict-push-missing` | F1 |
| `push-refusal-codes-missing` | G1 |

## 1. Hermeticity + stage honesty (verified)

- **Hermetic**: every row drives a fresh `Coordinator` over a `mkdtempSync` log with a
  `ScriptableAdapter` (no harness, no network); the store row uses a tmpdir `Log`; global
  `test.after` removes every tmpdir. No writes outside `os.tmpdir()`. The deployment-verification
  stub is the brief's `true` command.
- **No order-dependence**: each test constructs its own coordinator/log/adapter; the only
  module-level state (`dirs`) is cleanup bookkeeping. `node:test` runs the file sequentially by
  default; nothing in the suite depends on run order.
- **Named-stage honesty**: every RED row's first assertion is an `assert.ok`/`assert.equal(typeof
  …,'function', …)` carrying the stage name, so each row fails at the stage — never on a vacuous
  shape assertion or a fixture precondition. Confirmed by the per-stage table above; the
  preconditions (A3's refused-write receipt, F1's trust-gate error, C4's two lane answers) all
  hold at HEAD before the named assertion is reached.
- **No clocks as controls**: `Date.now()` appears nowhere; a fixed microtask drain drives the real
  coordinator event path.
- **No `localeCompare`**; the `PUSH_REFUSAL_CODES` literal and the `pathScopeEvidence` key set are
  asserted in ACTUAL source order.

## 2. Green-side mintability — every red row CAN go green under a correct v1.1 impl (verified)

I drove the exact fixtures the RED rows rely on and confirmed each event stream a correct
implementation needs is minted at HEAD:

- **A3 / D1 / D2 / D3 (refused write)**: `stageRefusedWrite` mints `scratchpad.write_result
  {ok:false, result:'scratchpad_entry_invalid'}` at a worker-attributed seq (top-level `worker`
  present), so the D5 key `swf:${workerId}:${event.seq}` and the GT1 refusal code are derivable.
- **D3 (corrective)**: `stageValidWrite` mints `scratchpad.write_result {ok:true, result:'written'}`
  with a LATER seq, so the D5 "no later ok:true after the failure's seq" predicate resolves — the
  dedup row's turn-N+1 arm is reachable.
- **F1 (verdict)**: the completed-turn/claim-card path falls through the real trust gate and mints
  a durable `error {phase:'trust_gate', code:'worker_path_scope_violation'}` with a top-level
  `worker` field and `pathScopeEvidence` carrying digests+counts only (application.mjs:984-1006
  projects it to `gate:'scope'`, `detail:{digests,counts}`), so the `gate:${event.seq}` item is
  derivable.
- **C4 (spill lane)**: the closed `CONTEXT_READ {kind:'spill'}` lane answers a well-formed
  `spill:sha256:<64hex>` citation with `context_not_found` and a malformed one with
  `context_read_invalid` (coordinator.mjs:10774-10788) — the lane is reachable.
- **G2 (recovery-refinement refusal)**: `createAndClaimRecoveryRefinement` on a missing prior
  refuses with a typed `CoordinationRefusal` carrying `recovery_refinement_unavailable` (matches
  `/^recovery_refinement_/`).

**No green-side blocker found.** The two "invented surface" interactions are consistent with the
folded contract: `_providerBrief(task.brief, workerId)` two-arg (current signature is one-arg) is
an extension the contract's D1 seam requires; A5's copy-on-write purity (no `task.brief` mutation,
no adapter call) is compatible with E1's requirement that composition mints the durable
`attention.pushed` event (a log write is not an adapter call and does not touch `task.brief`). The
11 PINs are green for legitimate, verified reasons (see §3).

## 3. Per-pin verdicts (false-green hunt)

| Pin | Verdict | Evidence |
|---|---|---|
| A4 absence-on-empty | **SOUND** | Both renderers omit the section AND the frame for `attention:[]` and absent `attention`; an always-emit implementation fails it. |
| A5 provider-brief purity | **SOUND** | `_providerBrief` today is a pure compose (copy-on-write via the orientation/briefing augmentation, never mutating `task.brief`, no adapter call); the digest-pin region verified at coordination-store.mjs:3000-3008. |
| B2 wrap shapes | **SOUND** | `wrapFact` (messages.mjs:459-461, `untrusted:false`) and `wrapProse` (:463-465, `untrusted:true`) byte-stable; the `wrapFact(...).untrusted === false` kill is load-bearing for R8′. |
| B3 inbox vocabulary | **SOUND** | `ATTENTION_TYPES` frozen at messages.mjs:18, `MESSAGE_KINDS` at :17, both asserted in ACTUAL order. Pins the D3/G8 source-set exclusion only as vocabulary (see F1 for the enforcement gap). |
| C3 spill.body row | **SOUND** | limits.mjs:86 — the one substrate row that mints `spill_body_exceeded`; value 1 MiB verified. |
| C4 spill lane reachable | **SOUND** | Verified live: `context_not_found` for a well-formed citation, `context_read_invalid` for malformed. The lane grammar is closed. |
| C5 coaching refusal shape | **SOUND** | `composeFrameLimitRefusal` (limits.mjs:40-42) emits `{cap, actual, unit}` + the spill path phrase for a `spill-digest-citation` lane. |
| F2 pathScopeEvidence shape | **SOUND** | The real trust-gate error mints the six digests+counts keys and never a path string (`!JSON.stringify(evidence).includes('outside.txt')` — the fixture DOES include an adversarial path string, so this is not a greenwash). |
| F3 sanitizer | **SOUND** | `sanitizeVerifierDiagnosticText` (verifier-diagnostics.mjs:26) redacts a home path, a well-formed JWT, and a `ghp_` token — all present in the fixture. |
| F4 static message | **SOUND** | The minted gate message is the static string `'captured worker result changed paths outside approved Plan scope'` (coordinator.mjs:12896), asserted verbatim. |
| G2 refusal precedents | **SOUND** | `spill_body_exceeded` / `scratchpad_entry_exceeded` registry codes verbatim; the store recovery-refinement refusal is a typed `CoordinationRefusal` carrying `recovery_refinement_unavailable` (verified live). |

**Net: 11/11 SOUND.** No vacuous or staged-wrong pin.

## 4. Findings (numbered) — row/gap + attack + concrete fix

### F1 (HIGH) — The never-pushed-kinds law (R7) has no enforcing row; `ORCHESTRATOR_ONLY_KINDS` is dead code

- **Row/gap**: R7 pins that the orchestrator-only kinds (`answer_decision`, `candidate_selection`,
  `workflow_revision`, `workflow_recovery`, `session_preservation`, `turn_checkpoint`) and the
  #10-era inbox kinds (`approval`/`question`/`blocked`/`stalled`/`budget_alarm`) NEVER reach a
  worker's block, and a BD3-C lane-delivered message is never double-pushed. The suite declares
  `ORCHESTRATOR_ONLY_KINDS` (test:88-91) and **never references it in any assertion**. `INBOX_KINDS`
  (test:86) is used only in B3 to pin that the vocabulary is frozen — not that a worker's block
  excludes it.
- **Attack**: a wrong implementation that pushes the full run-view attention array
  (application.mjs:7608-7672 — which includes `turn_checkpoint` for pauses and `answer_decision`
  for pending decision requests) into every worker's `composed.attention`, skipping only the D3
  exclusion filter, passes A3/D1/D2/D3/E1/F1 (those fixtures mint none of the excluded kinds).
- **Fix**: add a RED row that mints an excluded kind and asserts it is absent from the worker's
  block — e.g. pause the driver so `turn_checkpoint` is projected, or stage a pending decision
  request so `answer_decision` is projected, then assert `_pendingAttentionPush(workerId)` and the
  composed block contain neither. Add a second arm: deliver a BD3-C message through the real lane
  and assert the message id is not re-served as an attention item (R7 double-push).

### F2 (HIGH) — The D2 overflow / spill round trip has no row, and a naive fixture would be green-side-blocked

- **Row/gap**: C1/C2 pin the two `view.attention_push.*` registry rows; C4 pins the closed spill
  lane; C5 pins the coaching shape. Nothing pins the D2 overflow **behavior**: a pending set over
  the 8-item bound, in-block items served in full, the excess written to a durable spill artifact,
  the block closing with `spill:sha256:<digest>` + the overflow item ids, and the worker RESOLVING
  the digest-cited spill via `CONTEXT_READ {kind:'spill'}` — the round trip the blue brief names
  explicitly. The byte-shed (OQ1) — rendered leaf text shortened with a `(truncated)` marker and
  the FULL text riding the spill — is likewise unpinned.
- **Attack**: a wrong implementation that ignores the item bound entirely (serves all items, no
  spill) or truncates the excess (never spills) greens C1/C2/C3/C4/C5 — the registry and the lane
  exist, the overflow law does not.
- **Fixture trap (green-side)**: the run-view source for `scratchpad_write_failed` is bounded to
  the **last two failures per worker** (application.mjs:7659, `.slice(-2)`). A naive overflow row
  that mints 9 refused writes would yield only 2 pending scratchpad items if the push projection
  inherits the run-view bound — the >8 pending set would be unreachable and the row could never go
  green. The contract never states whether `_pendingAttentionPush` inherits `.slice(-2)` or
  re-bounds per D2 (8); this must be pinned before an overflow row is writable.
- **Fix**: pin the push projection's per-source bounds in the contract, then add a RED row that
  mints >8 genuinely pending items for one worker (via the interaction/approval seam if scratchpad
  stays bounded at 2), composes the block, asserts the first 8 in-block items carry full framing,
  the block ends with `spill:sha256:<digest>` + the overflow ids, and the overflow ids resolve
  through the CONTEXT_READ spill lane to the full framed items. Add a byte-shed row: long-text
  items crossing 4096 rendered bytes assert the `(truncated)` marker and full-text-by-citation.

### F3 (HIGH) — The D5 dedup row is single-instance: an in-memory Set passes it

- **Row/gap**: D3 tests still-pending → re-pushed, resolved → not, all within one `Coordinator`
  instance. The contract's replay-safety law — "the pending set is a pure function of the durable
  event log … In-memory 'already pushed' bookkeeping is never authoritative" (D5) — has no oracle.
  No row rebuilds a `Coordinator` over the same log and re-derives the push set.
- **Attack**: a wrong implementation that tracks "already pushed" in a per-process `Set` (keyed by
  `requestId`) passes D3; after a driver restart/attach the Set is empty and a still-pending item
  is silently skipped — the exact D5 violation.
- **Fix**: add a row that (a) writes the refused-write stream to a log via coordinator A, composes
  once; (b) constructs coordinator B over the SAME log (fresh process-equivalent) and asserts
  `_pendingAttentionPush` re-derives the identical pending set purely from events; (c) asserts a
  still-pending item is re-pushed after the "restart" (never skipped by stale in-memory state).
  Optionally assert a resolved item is not re-pushed after the restart.

### F4 (HIGH) — The D4 delivered-then-read receipt is pinned only in its `read: null` case

- **Row/gap**: E2 asserts `{delivered:true, read:null}` when no turn has started after the push.
  R6's full law — `read` = the first `lifecycle.turn_started` with `seq ≥ push.seq` and NO
  `lifecycle.process_closed` with `seq` in `(push.seq, turn.seq)` between them; a respawned worker
  honestly shows `read:null` — is untested. No row stages a `turn_started` after the push, and no
  row stages a `process_closed` between push and turn.
- **Attack**: a wrong implementation whose receipt projection never marks `read` (always null) — or
  marks it at push time — passes E2. The "read is replay-derived, never a lie across process
  death" honesty is unpinned.
- **Fix**: add (a) push → `lifecycle.turn_started` (seq > push.seq) → assert `receipt.read` equals
  that turn_started's seq; (b) push → `lifecycle.process_closed` → `lifecycle.turn_started` →
  assert `receipt.read` is null (the respawned worker does not inherit the read); (c) assert
  `read` is an event seq, never a wall clock.

### F5 (HIGH) — The D6 verdict push is pinned only for one worker's scope gate: run-wide scoping and a raw tail both green it

- **Row/gap**: F1 stages a single worker and a scope gate. The per-worker projection law — the
  verdict is `debugGateRefusal(events.filter(e => e.worker === workerId))`, and a worker receives
  ONLY its OWN judged verdict (R2, D6) — has no cross-worker negative arm (D2's negative arm covers
  the scratchpad item only). And no row drives a red_green/coverage gate, so the D6 never-raw law
  for `detail.tail` and the `message` field is unpinned at the push level: F3 pins the sanitizer in
  isolation and F4 pins the source message as static, but nothing asserts the PUSHED verdict's
  `tail`/`message` is sanitizer output.
- **Attack**: (a) run-wide verdict scoping — reuse `debugGateRefusal(events)` (the run-level caller
  at application.mjs:11284) for every worker; the single-worker fixture still receives its own
  verdict, so F1 passes, and a second worker would be handed the same verdict untested. (b) raw
  tail — push `event.payload.verdict.failureCapsule.text` (or `verdict.output`) verbatim as
  `detail.tail` without running `sanitizeVerifierDiagnosticText`; the fixture never contains a home
  path / JWT / provider token, so nothing to redact means nothing fails.
- **Fix**: add a two-worker verdict row (worker A judged → worker B's block must NOT carry a
  `gate_verdict` item, and A's item `workerId` is A). Add a red_green/coverage verdict row whose
  raw failure capsule contains an adversarial secret (e.g. `/Users/alice/projects/secret/lib.rs:12`
  or a well-formed JWT), asserting `detail.tail` is `sanitizeVerifierDiagnosticText` output (secret
  absent, redaction flagged) and the `message` field is static-or-sanitized, never raw.

### F6 (MEDIUM) — No row fires a single `attention_push_*` refusal; G1 pins the family as a name only

- **Row/gap**: the contract's serving-path refusals (`attention_push_not_addressed`,
  `attention_push_unknown_item`, `attention_push_stale`, `attention_push_oversized`) are pinned as a
  frozen constant by G1, but no row drives any refusal to fire. D3 asserts a resolved item is
  absent from the projection — it never asserts that attempting a re-push of that item raises
  `attention_push_stale`.
- **Attack**: a wrong implementation that silently drops resolved / unaddressed / unknown /
  over-limit items (instead of refusing with the typed code) greens every row.
- **Fix**: add RED rows that (a) attempt a re-push of a resolved item → `attention_push_stale`;
  (b) reference an unknown item id → `attention_push_unknown_item`; (c) compose a block containing
  an orchestrator-only or inbox-kind item → `attention_push_not_addressed`; (d) exceed the item
  bound with the spill lane unavailable → `attention_push_oversized` carrying the
  `{cap, actual, unit, gracefulPath}` coaching shape (C5's composer).

### F7 (MEDIUM) — The `answer_question` / `answer_approval` push (a D3 push-qualified kind) has no row

- **Row/gap**: D3 lists pending interactions as push-qualified and D5 pins their durable
  `requestId` keys (and the `_pending`-replay dependency). No row stages a pending
  `answer_question`/`answer_approval`, asserts it lands in the block, re-pushes while unanswered,
  and drops once answered. The suite's fixtures exercise only the scratchpad-write and gate-verdict
  members.
- **Attack**: an implementation that implements the two tested members but never pushes pending
  interactions greens the suite.
- **Fix**: add a RED row that mints a pending question/approval through the real interaction seam,
  asserts it pushes with the interaction `requestId`, answers it, and asserts the dedup.

### F8 (MEDIUM) — A2 under-pins the renderPrompt position (D1's "after the verification contract")

- **Row/gap**: A2 asserts `pendingAt > doneAt` where `doneAt = indexOf('Done when:')`. The
  verification execution contract renders AFTER `Done when:` (cli-adapters.mjs:102-107). D1 pins
  the section AFTER the verification execution contract line — the last lines of the prompt. A
  section inserted between `Done when:` and the verification block passes A2 while violating D1.
  (A1's renderBrief anchor — `pendingAt > ambientAt`, the true last data-bearing section — is
  correct.)
- **Attack**: insertion at the wrong seam in the CLI prompt.
- **Fix**: A2 should assert `pendingAt > rendered.indexOf('A reviewer')` (or the index of the
  rendered verification execution contract), pinning the section as the final block.

### F9 (MEDIUM) — The seam-level absence-on-empty is unpinned: `inner.attention` `undefined` vs `[]`

- **Row/gap**: A4 pins the RENDERERS omit the section for empty/absent attention. D1's letter —
  "when the per-worker pending set is empty, `inner.attention` is `undefined`" — has no seam-level
  oracle. A5 checks `task.brief` stability and no adapter call but never inspects `composed.attention`
  for the empty case.
- **Attack**: a wrong implementation attaches `attention: []` on every `_providerBrief` call; the
  renderers (length-gated) omit the section, so A4 passes and every red row passes — the D1
  `undefined` letter is violated with no behavioral consequence caught.
- **Fix**: extend A5 (or add a row) to assert `composed.attention` is `undefined` (not `[]`) when
  nothing is pending.

### F10 (MEDIUM) — R8′ provenance is pinned at the wrapper-construction and render levels, not at the delivery seam

- **Row/gap**: B1 pins `wrapHubDerived`'s shape; A1 pins the renderer emits no `hub-computed`. No
  row asserts the ITEMS in `_pendingAttentionPush` output / `composed.attention` actually carry the
  wrap provenance (`hub-derived`/`model-authored`, `untrusted:true`) — a wrong implementation that
  pushes raw unwrapped leaves through a shallow renderer (which prints them without wrapping)
  passes A1 (no literal `hub-computed` anywhere) and B1 (the wrapper exists, unused).
- **Attack**: push unwrapped hub content across the seam with no wrap provenance.
- **Fix**: assert each pushed item carries `provenance: 'hub-derived'` (or `'model-authored'` for
  prose leaves) and `untrusted: true`.

### F11 (LOW) — E1's `attention.pushed` itemIds are not cross-checked against the composed block

- **Row/gap**: E1 asserts exactly one `attention.pushed` event with a non-empty `itemIds` array and
  a HEX64 `blockDigest`. The event's `itemIds` are never compared to the items A3/F1 find in the
  block. (The always-mint case IS caught: a spawn-time empty-push event plus the post-refusal event
  would be two, failing E1 — a correct implementation must not mint on an empty set, consistent
  with D4.)
- **Attack**: mint the event with arbitrary `itemIds` while the block (checked by A3/F1) holds the
  real items.
- **Fix**: assert `pushes[0].payload.itemIds` deep-equals the requestIds found in `composed.attention`,
  and that `blockDigest` equals the sha256 of the rendered block.

### F12 (LOW) — G1 is a naming-only pin until F6 lands

- **Row/gap**: G1 pins the frozen `PUSH_REFUSAL_CODES` family in ACTUAL sorted order. A wrong
  implementation can export the constant and enforce none of the codes.
- **Fix**: keep G1 (it is a legitimate surface-constant pin and the sorted-order check is
  meaningful); it becomes load-bearing only once F6's firing rows exist.

## 5. Closing verdict

**NEEDS-FOLD.** The suite's current red state is honest and its green pins are sound — 11/11 PINs
verified, 13/13 red rows failing at named stages, deterministic across consecutive runs, fully
hermetic, and every red fixture is green-side mintable. But as a gate on the implementation wave it
is under-pinned where the contract matters most: the never-pushed-kinds law (R7), the D2 overflow
round trip, the D5 restart-safety law, the D4 delivered-then-read receipt, and the D6 per-worker +
never-raw verdict law can each be violated by a plausible wrong implementation that still greens the
entire suite. Fold the five HIGH findings (F1–F5) into the suite before the implementation wave is
held to it; the MEDIUM/LOW items (F6–F12) close out the refusal-firing, interaction-push, and
position/provenance seams.
