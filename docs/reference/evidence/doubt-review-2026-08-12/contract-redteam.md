# #66 RED-TEAM REPORT — adversarial attack on the doubt-review contract v1.0

**Attacker's HEAD:** `ac92335d9d85de777edbb8cfe67af00c5f10915f` (the Baton private effective-tree
snapshot, current worktree HEAD).
**Verification basis:** every citation below re-verified at THIS HEAD with `grep -an` / `sed -n`;
`git diff` over `impl/src` between the contract's claimed verification HEAD
(`faf4e06d35bba2d1ea53d9d32e3c6d48ff97ee23`) and this HEAD is **empty**, so the contract's line numbers
survive the snapshot bump. The red-team brief's two NUL files — `application.mjs` +
`coordination-store.mjs` — were cited with `grep -an`/`sed -n` only, never whole-file reads (see M2).

**Summary verdict: NOT FOLD-READY.** Seven numbered blockers (§E). The shape decision — composition of
(b) `knowledge.promote_doubt` + a durable doubt ledger on a D4 selection change — is right and the A6
happy path is closed, but the settle-ritual ordering re-creates the silent sink when the raise step
errors, `promote_doubt`'s authority gate is unenforceable as specified (the #73 forge class), the
byte bound cannot render an answered record, the queryable surface's orchestrator gate is declared but
never pinned, the D1 selection change interferes with note candidacy through the shared ceiling, the
closed-loop claim overstates what the not-yet-landed #79 lane can deliver, and the resolution prose is
mis-wrapped.

---

## A. Citation re-verification (brief item 1)

All implementation anchors resolve at this HEAD (the `impl/src` tree is byte-identical to the
contract's verification HEAD):

- `coordinator.mjs:11513` — `entry.kind === 'note' || entry.kind === 'plan'` selection filter ✓
- `coordinator.mjs:11509-11511` — member task/worker resolution (`_settlementMemberTask`, `workerScope`) ✓
- `coordinator.mjs:11522-11525` — shared-partition scan, `note`-only collect ✓
- `coordinator.mjs:11532` — `const materialize = members === null || elevatedNotes.length >= 1` ✓
- `coordinator.mjs:11567-11576` — `board.candidacy:${waveId}:${sharedEntryId}` posts ✓
- `coordinator.mjs:11580` — `candidatesAwaitingAdmission: elevatedNotes.length` ✓
- `coordinator.mjs:11499` — `sweepSettlementLeases` call (the sweep step) ✓
- `coordinator.mjs:11428-11430` — `admitWorkflowFinding` coordinator wrapper ✓
- `coordinator.mjs:3790` — `_providerBrief` seam ✓; `:5502` — `briefDigest: canonicalDigest(activeTask.brief)` ✓;
  `:10512` — KG-3 briefing discipline ("never enters task.brief") ✓
- `coordination-store.mjs:14257-14271` — the `if (source.kind === 'note')` fact branch ✓
- `coordination-store.mjs:14278` — `kind: source.kind, scratchFactId: factPayload?.id ?? null` ✓
- `coordination-store.mjs:14296-14305` — task-settle dispositions (`elevated/selected` vs
  `not_elevated/orchestrator_skipped`) ✓; `:14302-14304` — the unselected row ✓
- `coordination-store.mjs:14360-14364` — workflow-settle `not_eligible`/`min_readers`|`type_ineligible` ✓;
  `:14363` — the kind-conditional reason ✓
- `coordination-store.mjs:15901` — `fact.grounding !== 'observed'` filter in `_deriveKnowledgePromotion` ✓
- `coordination-store.mjs:16207` — `admitWorkflowFinding(repoId, runId, candidateFindingId, policy, auth, lease)` ✓
- `coordination-store.mjs:12556` — `sweepSettlementLeases` (no doubt handling — R7 RED confirmed) ✓
- `coordination-store.mjs:17` — `compareCanonicalStrings` import ✓; **no `localeCompare` anywhere in `impl/src`** ✓
- `wave-driver.mjs:830-837` — `knowledge.{candidates,admittedThisRun,candidatesAwaitingAdmission,settlementRunId}` block ✓
- `application.mjs:726-728` — `scratchpadProse(workerId, text) { return wrapProse(workerId, boundedAttentionText(text)); }` ✓
- `application.mjs:745-748` — the doubt projection `{kind:'doubt', question, context}` ✓
- `application-semantics.mjs:1520-1527` — `knowledge.settlement_lease` row — **resolves, but the
  contract's characterization "embedded-only posture" is contradicted by the cited content** (M1) ✓/✗
- `limits.mjs:53-110` registry ✓; `:40-42` `composeFrameLimitRefusal` ✓; `:65` `board.detail` 4096 ✓;
  `:99` `view.attention_text.bytes` 4096 ✓; `:101` `view.knowledge_slice.items` 8 ✓; **no
  `view.attention_push.*` rows** (GT6) ✓; **no `_pendingAttentionPush`** (GT6) ✓
- Evidence docs: `kg-settlement-decisions.md:103-110` (D4 skip doubts) ✓; `redteam-lifecycle.md:354-400`
  (A6, verdict NEEDS-AMENDMENT, shapes (a)/(b)/(c)) ✓, `:370-374` ("copied to the shared partition, no
  scratch-fact") ✓, `:388-397` (the three candidate shapes) ✓; scratchpad rules 6/8/10-11/15/16-17/19-23
  in `scratchpad-decisions.md` ✓; #79 v1.1 decisions D1-D8 ✓.

**Confirmations relevant to the attack:** every R-pin is RED as claimed — `grep` over `impl/src` finds no
`knowledge.doubt*`, `promote_doubt`, `resolveDoubt`, `openDoubts`, or doubt handling in the sweep. The
`#33`-internal citation drift (`messages.mjs:375-377` for `wrapProse`; actual `:463-465`) is a #33
defect, not a contract-66 citation — the contract cites `application.mjs:726-728` directly, which is
exact.

---

## B. Per-decision verdicts (brief items 2-6)

### D1 — Elevation: doubts elevate to shared (the D4 selection change) — SOUND-with-HOLE

The three pinned consequences are code-accurate: (i) a selected doubt gets `elevated/selected` with the
shared successor as `targetId` (verified `coordination-store.mjs:14296-14305`); (ii) the shared successor
carries `scratchFactId: null` (verified `:14278`), so the taxonomy boundary holds structurally (GT5);
(iii) `MAX_SCRATCHPAD_SHARED_ENTRIES = 512` (scratchpad rule 8) is the per-wave shared ceiling.

**HOLE-5 — the selection change interferes with note/plan candidacy through the shared ceiling.** The
contract frames the 512 ceiling as "the natural throttle, not a new numeric cap," but adding doubts to
the selection makes the shared partition a *shared* pool: an elevation batch is prevalidated as a whole
against the ceiling (#33 rule 19/20 — `scratchpad_partition_exhausted` before any successor/fact/reap).
A doubt-heavy member now fails its whole batch where the old note-only selection would have succeeded —
e.g. 400 notes already shared + one member with 300 doubts + 10 notes → the second batch (310) crosses
512 → *the member's notes do not elevate*; under the old selection that member would have elevated its 10
notes. That is a collateral behavior change on the non-doubt path — exactly the "byte-identical" question
the brief asks. The contract acknowledges the ceiling but not the cross-kind starvation.

**Minor (M8).** "A doubt's task-settle disposition is ... never `orchestrator_skipped`" is too strong:
the rule-20 no-driver policy fallback still dispositions every unselected row `not_elevated/no_driver`
(`:14304`). A doubt in a no-driver run is skipped with the same honest degenerate receipt as notes/plans
— not a new sink, but the claim needs the `steering ?` qualifier.

### D2 — The durable doubt record + lifecycle — SOUND-with-HOLE

Provenance is carried correctly: `knowledge.doubt_raised` pins `{schemaVersion, doubtId, runId, waveId,
taskId, workerId, sourceEntryId, sourceEntryDigest, sharedEntryId, question, context}`; `taskId`/`workerId`
resolve from the member run (`:11509-11511`), never the settlement constants. The idempotency keys are
stable and collision-free (`doubt_raised:${waveId}:${sharedEntryId}` — `sharedEntryId` is run-scoped, so
no cross-wave alias; `doubt_resolved:${doubtId}` — same-key/different-binding conflicts;
`doubt_carried:${doubtId}`). The state machine is the latest event for the `doubtId`, never a caller field.
Replay-exactness holds on the happy path (R10).

**HOLE-2 — there is no state for an elevated-but-unraised doubt, and the ritual ordering lets one
vanish.** The state machine defines `open` (worker partition, pre-raise) and `reviewed`
(`doubt_raised` exists). A doubt that was elevated (shared successor exists) but whose raise step failed
or never ran is in **no defined state**: not `open` (its worker partition was reaped by the elevation
batch), not `reviewed` (no `doubt_raised`). No surface queries it; at workflow settle the shared row is
disposed `not_eligible/type_ineligible` (`:14363`) and reaped; the durable footprint is one unqueried
`scratchpad.entry_elevated` event — **A6's silent sink in a new costume**. The contract's D5 claim that
"there is no path where a doubt is dropped without a receipt" is false for this path. See D5 for the
ordering root cause and fix.

### D3 — The queryable review surface — HOLE (two)

The read-shape is well-formed (bounded records, `nextBefore`, `openDoubtsTruncated`, UNTRUSTED frames)
and the count mirrors `candidatesAwaitingAdmission` honestly (`wave-driver.mjs:834` uses `?? 0`).

**HOLE-1 — the byte bound cannot hold one answered record.** D7 derives `view.open_doubts.bytes = 4096`
with the justification "a single doubt's full frame (question ≤ 1,024 B + context ≤ 2,048 B + prose
wrapper) renders inside it." That arithmetic omits the **resolution**: an `answered` record carries
`resolution` (≤ **4096** bytes, the contract's own `doubt.resolution.bytes` row) plus question + context
+ the three prose wrappers — up to ~7.2 KB. A single answered record over-runs the whole 4096-byte view
bound, so the shed-flag either (a) drops the only row — violating the pinned "never silent truncation of
a row" — or (b) returns over-budget. This is the #79 OQ1 dead-row contradiction re-encountered: the
byte row is unsatisfiable as specified.

**HOLE-4 — the orchestrator-only gate is declared, never pinned.** `doubt_surface_unavailable` names
"unauthorized (non-orchestrator) or unknown wave," but no mechanism is specified for how an observe read
authenticates "orchestrator" (no lease is in the input, no principal check, no capability class), and the
`application.command()` dispatch is a hardcoded if-chain that does **not** auto-dispatch registry rows
(the settlement rows reach it only via the explicit `_settlementCommand` branch at `:12493-12496`). With
`waveId` absent the surface is project-wide across runs — the brief's authority-boundary question — and
the contract's answer ("orchestrator-addressed") is a declaration without an enforcement pin. A worker
holding the embedded facade could read the project doubt surface under the contract as written.

**Minor (M7).** The keyset predicate is cited as "exact #33 rule-15 predicate discipline," but rule 15's
predicate keys on `(createdEvent, entryId)` while D3 sorts by `(raisedSeq DESC, doubtId ASC)` — a
different key set. The discipline is adaptable, but the exact doubt-surface predicate
(`raisedSeq < c || (raisedSeq === c && doubtId > d)`) should be spelled out, not deferred.

**Minor (M5).** "folding, checkpointed, and inventory-listed exactly as #33's scratchpad kinds are"
(rule 10-11) does not pin the projection surface for the doubt records. A ledger-scan implementation of
`knowledge.doubts` would violate #33 rule 11's "no fold scans the whole ledger"; the contract should pin
the folded map + `PROJECTION_CHECKPOINT_FIELDS` + `snapshot()` exposure + event-kind inventory additions.

### D4 — `knowledge.promote_doubt`: the answer/dismiss authority — HOLE

The server-derived actor, `answeredBy: 'orchestrator'` hardcode, closed-input validation, and the
no-Finding/no-KG-node/no-board-item/no-`workflow_admitted`/no-scratch-fact boundary are all SOUND — a
worker cannot name itself the answerer, and OQ2's no-auto-reconcile is consistent.

**HOLE-3 — the lease gate is unenforceable as specified (the #73 forge class).** The input is
`{runId, doubtId, disposition, resolution?, dismissalReason?}` with `serverDerived: ['actor',
'principalId', 'sessionId']` — **no lease field**, and `lease` is absent from `authorityFields`. But the
pinned store gate (`coordination-store.mjs:16207`) requires a lease object and validates
`lease.id/lease.digest/lease.issuedEvent` plus the session binding (`:16228-16251`); `knowledge.promote`
carries `lease` in both its input and `authorityFields` (`application-semantics.mjs:1512-1514`) for
exactly this reason. As specified, `resolveDoubt` has no way to present the lease the gate demands, so an
implementer must either (a) invent a server-side lease derivation the contract never pins, (b) accept a
caller-supplied lease (the bearer-credential / worker-forged-lease hole the brief calls out as the #73
forge class), or (c) weaken the gate. The D4 reference to "the store gate at `:16207`" describes the
destination, not the route.

### D5 — The settle composition — SOUND-on-happy-path, HOLE on the error path

The three-outcome honesty (answered / dismissed / carried) is correct for the happy path, and the sweep's
carry predicate (doubt still `reviewed` of a revoked lease) plus the resolve-wins-on-race ordering are
consistent with the shipped `sweepSettlementLeases` (`:12556`) and the lease-gated resolve.

**HOLE-2 (root cause) — the ordering is sweep → elevate → raise.** The carry sweep runs *before* the
raise in the same `settlementLease` invocation (`coordinator.mjs:11499` vs D5 step 3). A doubt of the
current wave that is elevated (step 2) but whose raise (step 3) refuses/errors is never `reviewed`, so
the carry sweep (already run) cannot catch it, and no later ritual runs for a closed wave before the
shared partition is reaped at workflow settle. The typed-refusal-is-captured-never-aborts semantics make
this a *normal* failure mode, not a crash edge: the wave closes, the doubt leaves no record. Fix: (a) run
the raise scan **before** the carry sweep in the same invocation, and (b) pin the carry predicate to cover
*any* doubt shared entry of a revoked lease's wave not in `answered`/`dismissed` — minting
`doubt_raised` (if absent) + `doubt_carried` in the one sweep — so an elevate-without-raise cannot
escape receipt, and (c) delete the stateless gap (D2) by defining the elevated-but-unraised doubt as a
receipted contradiction.

### D6 — The answer push: composing #79's lane — SOUND-on-addressing, HOLE on delivery honesty

The coordinates are right: `doubt_resolved` carries `{workerId, doubtId, resolution, pushRequested: true}`;
the item is worker-addressed by identity (#79 D3); the durable id `doubt_answer:${doubtId}` and the
still-pending predicate (answered and not yet read) are event-derived. A forged push addressed to a
different worker is structurally excluded.

**HOLE-6 — "the closed loop" is contingent on a live worker that is not guaranteed.** The doubt's worker
belongs to a settled run; the #79 lane composes the `## Pending attention` block at spawn/recovery of
the *current* run's workers, and OQ1 pins `carried` as terminal precisely because "a carried doubt
belongs to a closed wave whose worker cannot receive an answer." An `answered` doubt faces the same
geometry: if the doubting worker is never recovered/respawned, the answer sits pending forever and the
loop never closes. R6 is honest that the render is #79's surface, but D6's "closes the loop back to the
worker" overstates what the rung can deliver while the worker's run is closed. Fix: pin the v1 honesty —
delivered-when-recovered, and the RED-to-green is the `doubt_resolved` coordinates, never a wire-acked
delivery claim.

### D7 — Frame bounds — HOLE-1 (the derived-arithmetic row)

`view.open_doubts.items = 8` (from `:101`) and `doubt.resolution.bytes = 4096` (from `:65`) are sound
derivations consistent with the registry schema (`class`, `graceful`, `refusalCode`). `view.open_doubts.bytes
= 4096` (from `:99`) is the defective row — see HOLE-1: its own derivation justification omits the
`resolution` prose it must hold.

---

## C. Refusal vocabulary, acceptance pins, open questions (brief item 7)

**Refusal vocabulary** — family and coaching are consistent (`composeFrameLimitRefusal` output at
`limits.mjs:40-42` works for an admission row with default `graceful: null`). **Minor (M3):**
`doubt_promote_not_authorized` ("a revoked/expired/foreign-session lease") and `doubt_promote_stale`
("or its review window has expired") both name the expired-lease condition while D4 says the gate "fails
with the typed code" — two candidate codes for one condition. Pin one (recommend the #63 XB lease code
family for the lease gate; reserve `doubt_promote_stale` for state-not-`reviewed`).

**Acceptance pins** — all ten RED claims are code-verified (R1 `:11513`/`:14304`, R3
`wave-driver.mjs:830-837`, R7 `:12556`, R9 `:15901` + no-bridge-fact, R2/R4/R5/R6/R8/R10 via the full-repo
grep showing zero doubt surface). The pins, however, do not cover the blockers: R2/R7 don't pin the
elevated-but-unraised state (HOLE-2); R4 doesn't pin the lease derivation (HOLE-3); R3 doesn't pin the
byte-bound satisfiability or the orchestrator gate (HOLE-1/HOLE-4); R8 doesn't pin the resolution-prose
provenance (HOLE-7); R1 doesn't assert the no-collateral property (HOLE-5); R6 overstates the loop
(HOLE-6). Each blocker needs a matching red row.

**Open questions** — OQ1 (carried terminal) **SOUND**; OQ2 (worker self-resolution, no auto-reconcile)
**SOUND**; OQ3 (surface split) **SOUND**; OQ4 ("complete and re-drive-exact by construction")
**OVERSTATED** (M4): a doubt elevated by a direct `scratchpad.elevate` *after* the wave's ritual has run
is never raised by any later ritual (each ritual scans only its own wave's members) and is reaped at
workflow settle — the silent sink. The claim holds only when the ritual has not yet run.

---

## D. Minor findings (fold, not blockers)

- **M1.** "the same embedded-only posture as the settlement rows, `application-semantics.mjs:1520-1527`"
  is false — the cited row declares `surfaces: ['embedded', 'mcp']` and `baton_knowledge_settlement_lease`
  is a live MCP tool (gated by a settlement capability class, `mcp-northbound.mjs:108/:138/:613`). The
  genuine embedded-only precedent is `board.claim`/`board.report` (`:1418-1439`). The design (embedded-only
  doubt rows) is fine; the justification is not.
- **M2.** The contract misnames the brief's "two NUL files" as `coordination-store.mjs` +
  `coordinator.mjs`; the red-team brief names `application.mjs` + `coordination-store.mjs`. The contract's
  actual practice (grep/sed only on those two) was compliant; the description is wrong and should be
  corrected at the verification-HEAD note.
- **M3.** Refusal-code overlap (`doubt_promote_not_authorized` vs `doubt_promote_stale` on the expired
  lease) — pin one code per condition (see §C).
- **M4.** OQ4 overstates direct-elevation coverage (see §C).
- **M5.** Doubt-record fold surface unpinned — a ledger-scan implementation would violate #33 rule 11
  (see D3).
- **M7.** Doubt-surface keyset predicate not spelled out (see D3).
- **M8.** D1's "never `orchestrator_skipped`" needs the `no_driver` qualifier (see D1).

---

## E. Final verdict — **NOT FOLD-READY**

The shape decision is right and the happy path closes A6, but the contract is not implementable to its
own honesty bar. Numbered blockers (what + why + concrete fix):

1. **Elevated-but-unraised doubts are a silent sink (A6 in a new costume).** The raise step (D5-3) runs
   after the carry sweep (D5-1), and a raise refusal is captured-never-aborts, so an elevated doubt whose
   raise fails (or a direct post-ritual elevation, M4) leaves no `doubt_raised`, no defined state, and no
   carry — it is reaped at workflow settle with only an unqueried `entry_elevated` event. **Fix:** run
   the raise scan before the carry sweep in the same invocation; pin the carry predicate to cover any
   doubt not in `answered`/`dismissed` (minting `doubt_raised` + `doubt_carried` together when the raise
   is absent); delete the stateless gap in D2's state machine.
2. **`promote_doubt`'s authority gate is unenforceable as specified (the #73 forge class).** The input
   and `authorityFields` carry no `lease`, while the pinned store gate requires a lease object and
   validates its digest + session binding — so the gate is either weakened, or a caller-supplied lease
   becomes a bearer credential. **Fix:** pin `resolveDoubt` to re-derive the active run-orchestrator lease
   for the `runId`'s settlement task server-side (the leaseId derivation is already pinned in
   `settlementLease`, `coordinator.mjs:11552-11559`) and validate `principalId`/`sessionId`/
   `sessionAuthorityDigest` against it — the lease is never a caller field, mirroring
   `knowledge.promote`'s `serverDerived`/`authorityFields` discipline.
3. **`view.open_doubts.bytes = 4096` cannot hold one answered record.** Question (1024) + context (2048)
   + resolution (4096) + wrappers > 4096, so the byte shed drops the only row (violating "never silent
   truncation of a row") or over-runs the bound — the #79 OQ1 dead-row contradiction. **Fix:** set
   `view.open_doubts.bytes = 8192` (the honest sum of the three prose bounds + wrapper overhead), or adopt
   #79's OQ1 leaf-text shed (`(truncated)` marker + full text to the spill), or retire the byte row and
   shed on the item bound only.
4. **`knowledge.doubts`' orchestrator gate is declared, never pinned.** No mechanism authenticates
   "orchestrator" for the observe read, the dispatch does not auto-route registry rows, and `waveId`
   absent spans the project across runs. **Fix:** pin the read's authorization (active run-orchestrator
   lease for the named run; the deployment's top-level orchestrator principal for the project surface),
   pin the direct-port dispatch branch in `application.command`, and pin `doubt_surface_unavailable`'s
   trigger exactly.
5. **The D1 selection change starves note/plan candidacy through the shared ceiling.** Doubts consume
   `MAX_SCRATCHPAD_SHARED_ENTRIES`, and the elevation batch fails as a whole on the ceiling, so a
   doubt-heavy member's notes now fail where the old note-only selection succeeded — a collateral behavior
   change on the non-doubt path. **Fix:** pin a doubts-only sub-cap within the 512 shared ceiling (e.g.
   doubts ≤ 384, notes+plans ≥ 128) or pin notes-first-then-plans-then-doubts priority in the selection —
   derived from the existing ceiling, never a new arbitrary cap.
6. **The "closed loop" for answered doubts overstates deliverable v1.** An answered doubt's worker is in
   a settled run that may never respawn; #79 composes the block only at spawn/recovery, so the answer can
   pend forever. **Fix:** pin the v1 honesty — delivered-when-recovered — and assert the `doubt_resolved`
   coordinates (R6), never a wire-acked delivery; rename D6's "closes the loop" to "arms the #79
   `doubt_answer` push" until that lane lands.
7. **Resolution prose is mis-wrapped.** D3/D4 wrap `resolution` as `{worker, text, provenance:
   'model-authored', untrusted: true}` — the #33 `wrapProse` shape for *worker* scratchpad prose — but a
   resolution is orchestrator-authored hub prose; #79 created `wrapHubDerived` (`provenance: 'hub-derived',
   untrusted: true`) precisely for hub-authored content crossing a surface, and the `worker` field for an
   orchestrator author is undefined. **Fix:** pin `wrapHubDerived` for the resolution and any
   orchestrator-authored doubt prose, distinct from the doubting worker's `wrapProse` question/context;
   add a red row asserting the resolution is never `hub-computed` and never `model-authored`.
