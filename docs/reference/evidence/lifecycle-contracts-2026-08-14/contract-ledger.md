[attempt: a8f2584a-3282-4825-b1d0-5aa4a6b69067 row-lc-ledger]
# Issue #194 + #205 — the logged-invariant contract: model-visible means logged, the durable
# no-step turn, and the decision lane's missing ledger row

The implementation contract for #194 (dsh-adoption ①) and #205 (decision ledgering): the
coordination store's typed rows are **digest-only pointers**, so "anything that reaches a model
request must be reconstructable from the store" has to mean something precise; a rejected or empty
attempt must close a durable recorded turn; and the decision lane round-trips without ever writing
a first-class `decision.*` ledger row. This is a **Ring-2 contract** (ground truths → decisions →
refusal vocabulary → red-first acceptance pins → open questions): it **specifies behavior**; it
does not amend implementation in this artifact. It cross-references — it does not re-specify — the
landed lane-proof (#205's GAP verdict), the channel audit's `decision.*` finding, and the
dsh-comparison's reconciled adoption item 1 (#194).

- **Date:** 2026-08-14
- **Status:** RED-first — every pin below names its RED stage at HEAD; no code lands in this rung.
- **Verification HEAD:** `1ff83353d7dc068ebdb87d1909f83fe80cee6b0b` ("Baton private effective-tree
  snapshot"). Every `file:line` citation below was re-verified this session with `grep -an` /
  `sed -n` / `Read` at this HEAD, not inherited. NUL-bearing files (`application.mjs`,
  `coordination-store.mjs`) are cited with `grep -an` / `sed -n` only. Store facts were re-verified
  against `.git/baton/application-v3/state/coordination/events.jsonl` this session.
- **Brief:** `row-lc-ledger.md` + `foundry-brief.md` (same dir) — read fully; the frame and laws
  bind. `gh issue view 194/205` could not be fetched (`gh` is unauthenticated in this worktree);
  the requirements are carried by the brief, `docs/PROGRESS.md`, the per-issue evidence dirs, and
  the code itself.
- **Shared-scratchpad publish: REFUSED, recorded (issue #158).** No worker-facing surface writes
  the `shared` scratchpad partition at this HEAD. The store's `writeScratchpad` row write hardcodes
  `const scope = \`worker:${fields.workerId}\`;` (coordination-store.mjs:14106) even though the
  schema admits `shared` (`SCRATCHPAD_SCOPE`, coordination-store.mjs:533) — the shared partition is
  reachable only through coordinator elevation/settlement seams (`elevateTaskScratchpad` /
  `settleWorkflowScratchpad`), never a worker row write. The #158 gap was verified at the code
  level this session. Per the coordinator brief's "Publish to `shared` — or record the refusal,"
  this file IS the deliverable publish; the coordinator should note the refusal.
- **Scope, one sentence:** the logged-invariant's honesty is closed — every model-visible decision
  interaction is reconstructable from the store through a cited spill artifact, never a body inline
  in a typed row (D1); every rejected/empty attempt closes a durable recorded turn that spent no
  step (D2); and the answered decision round-trip leaves a first-class `decision.*` ledger row in
  the store (D3).

---

## Ground truths (verified this session)

### G1 — The coordination store's typed rows are digest-only pointers; content enters only through `spill.minted`

- `mapOperationalEvent` (coordination-store.mjs:12705-12707) builds the mapped payload as exactly
  `{ worker, workerSeq, digest, kind, ts }` — **no content** — and appends `evidence.mapped`. It
  verifies the digest against the injected resolver `_operationalRead` (coordination-store.mjs:851,
  wired at index.mjs:1255 to `(worker, seq) => log.at(worker, seq)`; the operational log itself is
  durable on disk, index.mjs:1209 `new Log(opts.logDir, ...)`).
- `mintSpill` (coordination-store.mjs:13477-13504) is the **only** content-bearing row type: it
  appends `spill.minted` with the full `body` in the payload, content-addressed id
  `spill:sha256:<digest>`, ceiling `FRAME_LIMITS['spill.body'].value` (1 MiB).
- **Store verification (this session):** the store has **0 `spill.minted` rows** and **76,346
  `evidence.mapped` rows** — the content channel has never been exercised; every typed row in the
  live store is a digest pointer.

### G2 — The decision lane's question content is absent from the store's typed rows; only requestId + disposition project

- `decision.requested` is minted by the worker at claude-session.mjs:1138-1141 with
  `requestId = \`${session.worker}:decision:${session.decisionSeq}\``. The coordinator admits it at
  coordinator.mjs:13311, appends the raw `askedEvent` carrying the full `request` content
  (coordinator.mjs:13388 — in the **worker operational stream**, not the store), parks the
  task at `input_required` via `_coordTransition` (coordinator.mjs:13409).
- The store's `task.transitioned` row for that transition carries the interaction as
  `{ kind: 'decision', requestId, blocking: true }` — the **disposition only**. Verified live row
  (seq 38057): `{"id":"baton-dc089fa2a8423374a24cb69b-work","from":"working","to":"input_required",
  "evidence":{...,"interaction":{"kind":"decision","requestId":"w-144:decision:1","blocking":true}}}`.
- The mapped `evidence.mapped` row carries the digest + `payload.kind: 'decision.requested'`
  only. Verified live row (seq 38056): `{"payload":{"worker":"w-144","workerSeq":13,
  "digest":"920f855a...","kind":"decision.requested","ts":"..."}}`.
- The question, options, and answer therefore never appear in any typed store row — they are
  reconstructable only via the digest pointer into the operational stream, or (for the answer) the
  wave receipt's steering trail.

### G3 — No top-level `decision.*` event kind exists in the store ledger (the #205 GAP, verified)

- **Store verification (this session):** `grep '"kind":"decision\.'` on
  `events.jsonl` → **0 matches**. The decision interaction appears in the store only as:
  - `evidence.mapped` rows (digest-only) with `payload.kind` = `decision.requested` (8),
    `decision.settled` (2), `decision.expired` (3);
  - `task.transitioned` rows with `interaction: {kind:'decision', requestId, blocking:true}` (7)
    or `interaction: {requestId, disposition}` (5: `delivered`×2, `expired`×3).
- `recordAuthorityRejected` (coordination-store.mjs:13206) would append a top-level
  `authority.rejected` row, but the store has **0 such rows** — the decision refusal branches have
  never fired on a live store.
- This confirms the lane-proof GAP verdict (lane-proof-2026-08-13/landing-note.md:10): "DECISION
  ledgering | GAPPED | zero `decision.*` events in the store, EVER — the round-trip is real but
  unrecorded (filed)", and the channel audit (channel-audit-2026-08-13/channels.md:147): "No
  `decision.*` event kind exists in the store at all."

### G4 — The answered decision's content rides only the worker operational stream + the wave receipt's steering trail

- `decision.settled` raw append (coordinator.mjs:10417) carries `payload:
  { requestId, answer: normalized, disposition: 'delivered' }` — in the worker operational stream.
  The handler maps it to a digest-only `evidence.mapped` row and transitions the task back to
  `working` (coordinator.mjs:13421-13431).
- `answerDecision` (workflow-interpreter.mjs:821-870) pushes steering outcomes — `deferred` (:830),
  `denied` (:846/:865), `refused` (:856), `answered` (:850/:869) — into an **in-memory** `steering`
  array, materialized into the wave receipt, which lands in the store as a `web.command_completed`
  blob. The lane-proof's answered question is in the store only there. Verified blob:
  `{"trigger":"answerDecisions","role":"row-lane-decision","requestId":"w-263:decision:1",
  "text":"opt-shared","outcome":"answered"}`.
- The wave-driver's `decisionEvidence` array (wave-driver.mjs:461, captured at :663-691, receipt
  `decisions:` at :855) records `{role, runId, requestId, at, outcome}` — the outcome/disposition,
  **not the answer text**. So neither the store's typed rows nor the receipt's `decisions` block
  carry the answer; only the worker stream (via digest) and the steering-trail blob do.

### G5 — The spill-digest-citation discipline keeps model-visible bodies out of typed rows

- FRAME_LIMITS (limits.mjs:54-57) declares the graceful lanes with `graceful: 'spill-digest-citation'`:
  `message.send.body` 2048 B, `message.reply.body` 2048 B, `run.objective` 4096 B,
  `wave.member.objective` 4096 B — over-cap bodies "spill to a durable artifact — resend with a
  digest-citable head" (`refusalPath`, limits.mjs:32-36).
- `spill.body` is the ONE substrate row that mints a refusal (limits.mjs:84-86): a resource ceiling
  on a durable write, enforced at admission.
- The decision lane's byte rows are admission ceilings, not spill-cited: `decision.question` 2048 B
  (limits.mjs:59), `decision.need` 2048 B (:60), `decision.rationale` 8192 B (:61),
  `decision.option.label` 160 B (:68), `decision.option.summary` 512 B (:69), `decision.text`
  4096 B (:70). The `decision.*` rows have `graceful: null` — over-cap draws the coaching refusal
  (`composeFrameLimitRefusal`, limits.mjs:40-42) with the typed code, never a body inline.

### G6 — A rejected/empty attempt closes a durable recorded turn (the no-step turn seam exists, unpinned)

- dsh-digest architecture.md:88 — "a rejected or empty first claim still closes a durable turn that
  spent no step, so the log records the attempt." dsh architecture.md:96 — "**Model-visible means
  logged.** Anything that reaches a model request must be reconstructable from the log, and a
  runtime invariant asserts it."
- The dsh-comparison reconciled adoption item 1 (landing-note.md:16-18): "**'Model-visible means
  logged' as a dispatch-seam invariant + the durable no-step turn** … any member's exact served
  context is reconstructable from the shared ledger — with the rubric caveat: reconstructable VIA
  the cited spill artifact, never bodies-inline — limits.mjs keeps bodies out."
- Baton's decision admission seam already records every rejection class with a typed raw event +
  an authority record: oversize/malformed → `control.malformed_interaction_rejected`
  (coordinator.mjs:13326); drain → `control.drain_interaction_discarded`
  (:13347); duplicate → `control.duplicate_interaction_rejected` (:13354); one-pending →
  `control.decision_already_pending_rejected` (:13373). Each also writes an
  `authority.rejected`/`authority.cancelled` coord record.
- Wave member start: ANY `run.start` refusal that throws converts to the typed `wave_member_invalid`
  carrying `{actual, cap, cause, role}` (application.mjs:11747-11761), and the wave response is
  never a success shape (`runs:[null]` drain is impossible by construction, application.mjs:11755-
  11761).
- **The seams exist but are unpinned**: no test asserts the recorded-turn property; the store has
  zero `authority.rejected` rows; the ONE silent path is a `decision.requested` with no
  `requestId`, which `break`s with no authority record (coordinator.mjs:13345) — see OQ2.

---

## The question

An orchestrator driving a wave sees the decision lane answer a `DECISION_REQUEST` (the lane-proof
wave answered `opt-shared` and the run continued), yet nothing about that interaction — the
question, the options, the answer — is a row in the coordination store's ledger; the only
trace is a digest pointer into the worker operational stream and a receipt blob. Separately, the
#194 adoption promises "model-visible means logged" and a "durable no-step turn," but the store's
typed rows are digest-only pointers and no runtime invariant asserts that anything reaching a model
is reconstructable. Can the logged-invariant be closed — a reconstruction law that names the cited
spill artifact as the channel and asserts it at runtime (D1), a durable no-step turn that records
every rejected/empty attempt (D2), and a first-class `decision.*` ledger row that survives the
round-trip (D3)?

---

## Control-law preamble (binding)

The campaign control law (bidirectional-v3-decisions.md:134-143) bans clocks as CONTROLS on agent
work. This contract introduces **no new clock**. The only clock touch in the decision lane is the
existing pending-record `deadlineAt` (coordinator.mjs:13401 `this._now() + request.deadlineMs`),
which is a **resource bound on a pending interaction** (it governs when a parked decision expires,
so a dead worker cannot hold a task in `input_required` forever) — it never truncates agent work,
never judges a turn. The D1 reconstruction invariant is a **consistency check on the store's own
rows at read time**, not a timer. No pin below requires a wall clock.

---

## Decisions

### D1 — Model-visible means logged: reconstruction VIA the cited spill artifact, never bodies-inline; a runtime invariant asserts it

**The law.** Any model-visible decision interaction — the question, the options, the answer — must
be reconstructable from the coordination store's typed rows **through a cited spill artifact**,
never by bodies-inline in a typed row (limits.mjs keeps bodies out). Reconstruction is a
two-part digest-citation chain:

```
typed row:        { ..., citation: { coordinationSeq, spillId, spillDigest } }   # or the evidence.digest pointer
spill.minted row: { ..., payload: { spillId, digest, bytes, lane, body } }       # the content, content-addressed
```

- The typed row's `spillId` is `spill:sha256:<digest>` (mintSpill, coordination-store.mjs:13477-13504),
  so a reader resolves content by re-minting the digest — the store's content-addressed idempotency
  makes the same body return the same `spill.minted` (coordination-store.mjs:13497-13500).
- **The runtime invariant asserts it** (the dsh "runtime invariant asserts it", architecture.md:96):
  a store read that encounters a typed row citing a `spillId` with no matching `spill.minted` row
  refuses (integrity), and a spill mint that would collide with a different body under the same
  digest refuses (`spill_conflict`, coordination-store.mjs:13489-13492). The invariant is enforced
  at the store seam — the same seam that already verifies `evidence.mapped` digests against the
  operational resolver (coordination-store.mjs:12701-12707) — never by a reader's good behavior.
- **What "reconstructable" means.** A later reader (operator, auditor, another member) can
  reconstruct the exact served context of any decision interaction from the store + its cited
  spill artifacts alone — no out-of-band channel, no worker-live access. The digest-only
  `evidence.mapped` pointer stays (it is the citation discipline), but content that must survive
  in the store rides the spill.
- **What this does NOT require.** It does not require every worker turn to be spill-minted — only
  content that must be reconstructable from the store (the model-visible interaction surfaces the
  wave orchestrator sees). Raw worker prose stays in the operational stream; the store keeps
  pointers.

### D2 — The durable no-step turn: a rejected/empty attempt is RECORDED, never a silent no-op

**The law.** A rejected or empty attempt — a member whose `run.start` refuses, a decision request
whose admission refuses, an interaction discarded while draining — closes a **durable recorded
turn that spent no step**. The record is the typed raw event + the authority/coordination row; a
silent `break`/`continue` with no row is a defect of this contract.

- **On the decision admission seam** (coordinator.mjs:13311-13416), every rejection class already
  appends a typed raw event (`control.malformed_interaction_rejected` :13326,
  `control.drain_interaction_discarded` :13347, `control.duplicate_interaction_rejected` :13354,
  `control.decision_already_pending_rejected` :13373) and writes an `authority.rejected` /
  `authority.cancelled` coord record via `recordAuthorityRejected` (coordination-store.mjs:13206).
  The contract pins that these records are **mandatory** — the recorded turn exists even when the
  admission never reached a model-visible state.
- **On the wave member seam** (application.mjs:11711-11773), a member whose `run.start` refuses
  converts to the typed `wave_member_invalid` with `{actual, cap, cause, role}` and the wave
  response is never a success shape (`runs:[null]` is impossible). The failed member is a recorded
  no-step turn — the driver can observe exactly which member failed and why.
- **The one current silent path is closed by this decision**: a `decision.requested` with no
  `requestId` currently `break`s with no authority record (coordinator.mjs:13345). Under D2 it
  must append a typed rejection row too (the raw event exists in the worker stream; the authority
  row must exist in the store). See OQ2 for the ruling this needs.

### D3 — The decision lane ledgers: a first-class `decision.*` row survives the answered round-trip

**The law.** The answered (and expired, and refused) decision round-trip leaves a first-class
`decision.*` event kind in the coordination store's typed ledger — a row from which a reader
reconstructs the requestId, the disposition, and a citation to the answer content — distinct from
the digest-only `evidence.mapped` projection and the receipt's steering trail.

- **Kind set.** The typed ledger gains `decision.requested`, `decision.settled`, `decision.expired`
  (and the rejected classes already named in D2) as first-class event kinds — the SAME kind names
  the worker stream already uses (claude-session.mjs:1141, coordinator.mjs:10417, coordinator.mjs:
  10472), so the raw stream and the ledger projection share a vocabulary.
- **Row shape (semantic order; no byte-stability claim).** Each row carries the interaction's
  durable projection: `{ requestId, disposition, citation }` where `disposition` ∈
  `pending | answered | expired | refused` and `citation` is the D1 chain (a `spillId` for the
  question/answer content, or the `evidence.digest` pointer when the content stays in the
  operational stream). The question text, option set, and answer text ride the cited spill — never
  bodies-inline (D1, limits.mjs keeps the caps).
- **The wave receipt's steering trail stays** (it is the receipt's honest interaction log), but it
  is no longer the ONLY trace of the answer: the store's `decision.settled` row + its cited spill
  is the reconstruction source. The lane-proof wave's answered question (`w-263:decision:1` →
  `opt-shared`, steering-trail blob verified in G4) is the red-first target: after this contract
  lands, that exact interaction is reconstructable from the store + its spill, without the receipt
  blob.
- **What this does NOT require.** It does not require the store to carry full bodies inline — the
  caps and the spill-digest-citation discipline stay (D1). It does not require the operational
  stream to stop carrying the raw events — the typed ledger is additive, a projection with
  citation, never a replacement.

---

## Refusal vocabulary (closed, typed, surface-constant)

The decision + reconstruction surfaces emit exactly these codes — closed (no other codes on these
seams), typed (each carries the coaching shape), surface-constant (the same code and shape at the
coordinator seam, the wave-driver callback, and any northbound projection):

| Code | Class | Shape | Remediation |
|---|---|---|---|
| `decision_question_exceeded` | admission | `{lane, actual, cap, unit, gracefulPath}` via `composeFrameLimitRefusal` | resend within the 2048-B cap, or spill-cite the question |
| `decision_text_exceeded` | admission | same | resend within the 4096-B cap, or spill-cite the answer |
| `decision_option_label_exceeded` | admission | same | resend within the 160-B cap |
| `decision_option_summary_exceeded` | admission | same | resend within the 512-B cap |
| `decision_need_exceeded` / `decision_rationale_exceeded` | admission | same (2048 / 8192 B) | resend within the cap |
| `spill_body_exceeded` | substrate (admission-enforced) | `{lane, actual, cap, unit}` | the spill is a durable write; the 1 MiB ceiling is a resource bound |
| `spill_conflict` | integrity | `{spillId, digest}` | the store refuses a digest collision on a differing body (content-addressed idempotency) |
| `control.malformed_interaction_rejected` | decision admission | `{requestId, kind:'decision', reason, cap?, actual?, unit?, gracefulPath?, message?}` | the typed coaching refusal for an oversize/malformed request |
| `control.duplicate_interaction_rejected` | decision admission | `{requestId, kind, reason:'duplicate_request_id'}` | one pending requestId per worker at admission |
| `control.decision_already_pending_rejected` | decision admission | `{requestId, kind, reason:'decision_already_pending', pendingRequestId}` | one pending decision per worker (R-BD-4) |
| `control.drain_interaction_discarded` | decision admission | `{requestId, kind, reason:'fleet_drain'}` | the interaction is discarded during drain — recorded, never silent |
| `wave_member_invalid` | wave admission | `{role, cause, actual?, cap?}` | the member's `run.start` refused; the wave never returns a success shape |

The coaching text is `composeFrameLimitRefusal`'s output for the `decision.*` and `spill.body` rows
(limits.mjs:40-42) — never a hand-typed string (Decision 9, the one refusal-text composer). The
`authority.rejected`/`authority.cancelled` coord records (G6) accompany every decision rejection
class; `recordAuthorityRejected` (coordination-store.mjs:13206) is the store seam.

---

## Acceptance (red-first — every pin RED at the current HEAD)

**A1 (D1 — the reconstruction invariant, asserted at the store seam).** A store read that reaches
a typed row citing a `spillId` with no matching `spill.minted` row refuses (integrity), and a
spill mint that would place a differing body under an existing digest refuses `spill_conflict`
(coordination-store.mjs:13489-13492). A source scan pins that no typed store row carries a
model-visible decision body inline — `decision.question` / `decision.text` /
`decision.option.*` content appears only as a cited spill or an `evidence.digest` pointer. A
reader test reconstructs the lane-proof wave's answered interaction (`w-263:decision:1` →
`opt-shared`) from the store + its cited spills alone, with no receipt blob and no worker-live
access. *RED at HEAD: zero `spill.minted` rows exist (store-verified); no reconstruction invariant
exists; the answer text survives only in the worker stream + the `web.command_completed` steering
blob.*

**A2 (D2 — the rejected attempt closes a recorded no-step turn).** Each decision rejection class —
oversize/malformed, duplicate, one-pending, drain-discarded, and missing-requestId (the current
silent `break`, coordinator.mjs:13345) — closes a recorded turn: the typed raw event row AND the
`authority.rejected`/`authority.cancelled` coord record both exist in the store, and the task does
not spend a step (no `resource.provider_call` attributable to the rejected request). A behavior
test drives each class and asserts the two rows. *RED at HEAD: zero `authority.rejected` rows in
the store (the branches have never fired); the missing-requestId path records nothing; no test
pins the recorded-turn property.*

**A3 (D2 — the wave member's no-step turn is recorded, never a success drain).** A wave member
whose `run.start` refuses (quota, `spill_body_exceeded` past `run.objective`'s spill ceiling, or
an `application_*` admission code) produces the typed `wave_member_invalid` carrying
`{actual?, cap?, cause, role}` (application.mjs:11747-11761) and the wave response is never a
success shape — `runs:[null]` is impossible. A behavior test asserts the refusal shape + role and
that no member of a partially-started wave is silently dropped. *RED at HEAD: the conversion
exists at application.mjs:11747-11761 but no test pins the no-`runs:[null]` property or the
recorded refusal shape; the member-creation honesty rung (row-lc-members, #199) and this rung must
agree on the typed shape — see OQ5.*

**A4 (D3 — the first-class `decision.*` ledger row survives the round-trip).** After an answered
decision, the store carries a top-level `decision.settled` row (and `decision.requested` /
`decision.expired` for their classes) from which a reader reconstructs `{requestId, disposition,
citation}` — distinct from the digest-only `evidence.mapped` projection and the receipt's steering
trail. A behavior test answers a `DECISION_REQUEST` through the full lane (worker text grammar →
admission → wave-driver `onDecision` → `answerDecision` → delivery) and asserts the store row
carries the requestId, the `answered` disposition, and a citation resolvable to the answer content.
*RED at HEAD: zero top-level `decision.*` kinds in the store (verified this session); the answer
content exists only in the worker stream + receipt blob.*

**A5 (refusal vocabulary — closed, typed, surface-constant).** A source scan pins that the
`decision.*` and `spill.body` size refusals are `composeFrameLimitRefusal`'s output for their
registry rows (limits.mjs:40-42), never a hand-typed string; the decision admission rejections
carry the typed coaching shape (`{cap, actual, unit, gracefulPath}` when a safe integer, never a
bare `malformed_request` — coordinator.mjs:13322-13334); and no OTHER code appears on the decision
seams. A wrong impl that substitutes a generic "not ready" message fails the scan. *RED at HEAD:
the coach exists at coordinator.mjs:13322 but no test pins the shapes or the closed set; the
refusal branches have never fired (store-verified zero `authority.rejected`).*

**A6 (D1 + D3 — the store's content is spill-addressed, not body-inline).** A source scan pins that
any typed row carrying a model-visible decision body uses `spillId = spill:sha256:<digest>`
(mintSpill's content-addressing, coordination-store.mjs:13477-13504) and that the byte ceilings
stay registry-declared (limits.mjs:59-61, :68-70, :86) — no new inline literal bound. A wrong impl
that embeds a body inline (or a new hardcoded byte cap) fails the scan. *RED at HEAD: no decision
content is spill-cited anywhere (zero `spill.minted` rows); the `decision.*` caps exist but no
spill path is wired for the decision lane.*

---

## Verification

```text
node --test <the new #194+#205 red suite>     # A1..A6, shipped red-first
```

Then the canonical suite fully green (`node impl/scripts/run-suite.mjs`). Post-landing live
receipt: the next answered `DECISION_REQUEST` wave records a first-class `decision.settled` row +
its cited spill in this evidence directory, mirroring the lane-proof's live-receipt precedent
(lane-proof-2026-08-13/lane-decision.md) — the exact interaction the lane-proof wave showed
unrecorded becomes the recorded counter-example.

---

## Open questions (judgment calls, recorded)

- **OQ1 — the reconstruction channel: spill-cite vs digest-pointer.** The rubric says
  "reconstructable VIA the cited spill artifact, never bodies-inline," and `evidence.mapped`'s
  digest pointer already resolves through the operational resolver (index.mjs:1255). Judgment
  (this contract): the model-visible interaction CONTENT (question/options/answer) must ride the
  spill; the digest pointer alone is a pointer into a separate store, not a store-contained
  reconstruction. A coordinator ruling preferring the digest-pointer-only channel shrinks D1/A1 to
  a citation-existence check — either satisfies the letter, but the spill form makes the store
  self-contained.
- **OQ2 — the missing-requestId silent path.** A `decision.requested` with no `requestId`
  currently `break`s with no authority record (coordinator.mjs:13345). Under D2 it must record. Is
  this an authority-class ruling (a typed `control.malformed_interaction_rejected` with
  `reason: 'missing_request_id'`), or is the raw worker-stream event sufficient evidence of the
  no-step turn? Judgment: D2 requires the typed row; the raw event alone is not a store row. Ruling
  wanted.
- **OQ3 — does `decision.settled` carry the answer spill-cited or digest-only?** The answer is
  `decision.text`-bounded (4096 B, limits.mjs:70) — small enough to inline, but the D1 law keeps
  bodies out of typed rows. Judgment: the typed ledger row carries the citation; the answer content
  rides the spill. A ruling preferring inline-answer would keep `decision.settled`'s payload small
  but break the no-bodies-inline law for the decision lane.
- **OQ4 — the `decision.*` first-class rows vs the raw stream.** The typed ledger gains rows with
  the SAME kind names the worker stream uses (claude-session.mjs:1141, coordinator.mjs:10417,
  :10472). Judgment: additive projection with citation — the raw stream keeps the full payloads;
  the store rows carry `{requestId, disposition, citation}`. A ruling preferring the store rows to
  become the single source would require the operational stream to shrink — rejected here (the
  operational stream is the adapter/worker trust boundary).
- **OQ5 — `wave_member_invalid` shape agreement across rungs.** This rung pins the typed shape
  `{actual?, cap?, cause, role}` (A3). The member-creation honesty rung (row-lc-members, #199)
  contracts creation-failure events; the launch/receipt rung (row-lc-launch, #173) contracts the
  startError on the wire. The three rungs must agree on the same typed shape and code for a member
  start failure. Judgment: `wave_member_invalid` (application.mjs:11750, :11760) is the shared
  code; the cross-rung QA must confirm no drift.
- **OQ6 — the `deadlineAt` clock.** The pending record's `deadlineAt` (coordinator.mjs:13401) is a
  resource bound on a parked interaction, not a progress control (control-law preamble). The
  contract introduces no new clock; a ruling extending the decision deadline into a liveness
  feature would need its own honesty rung.

---

## Cross-rung boundary note (for the coordinator QA)

This contract and its three siblings share the wave lifecycle. The boundary map this rung claims:

- **ledger (this rung)**: the LOGGED-INVARIANT — what must be reconstructable from the store (#194)
  and the decision lane's ledger projection (#205). Consumes the decision seam's admission rows
  (coordinator.mjs:13311), the operational-store mapping (coordination-store.mjs:12701), and the
  spill channel (coordination-store.mjs:13477).
- **launch/receipt (row-lc-launch)**: the launch/acceptance-receipt honesty + the startError on the
  wire — touches `wave_member_invalid` at the response surface (application.mjs:11750). Overlap
  with A3's refusal shape: the two rungs must agree on the wire shape of a member-start failure
  (OQ5).
- **members (row-lc-members)**: creation-failure events (#199) + task-id namespacing (#200) + drain
  semantics (#204) — touches the same member-start loop (application.mjs:11711). Overlap: both
  rungs pin the member-start failure record; no conflict if the code is shared and the shapes agree.
- **filesystem (row-lc-fs)**: own-index + member confinement/settle — no direct overlap with the
  ledger rows; the shared store (events.jsonl) is the one joint surface, and the ledger rung's rows
  are additive (`decision.*`, `spill.minted`), never renaming an existing kind.
