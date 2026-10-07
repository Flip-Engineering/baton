# #73 RED-TEAM VERDICT — adversarial attack on `feedback-forge-hardening-contract.md` v1.0

Verifier: red-team pass rt-2026-08-07. Verification HEAD: **`b2c98f001bd0176b571d36d165428829caeab61e`**
(the current worktree HEAD — the contract's stated HEAD `985fc75e…` exists as a git object but is
not on the current branch; every citation below was re-grepped at the current HEAD). NUL files
(`application.mjs`, `coordination-store.mjs`) were touched only via `grep -an` / `sed -n`, never
whole-file reads (`tr -cd '\000'`: 3 / 3 / 0 for `application.mjs` / `coordination-store.mjs` /
`verifier-diagnostics.mjs` — matches the contract's NUL claim).

Laws applied: no clocks (none found); every citation re-verified at the current HEAD; sorted-key
literals in ACTUAL source order (one contested — see D3 blocker B2); `localeCompare` banned (none
found).

---

## 1. Citation re-verification — FAIL (wrong citations present → automatic blocker)

### 1.1 Verified-correct anchors (substance confirmed)

All of the following were re-verified at the current HEAD and are accurate in substance and anchor:

| Contract claim | Anchor | Verified |
|---|---|---|
| G1 `normalizeGateCauseFeedback` span | application.mjs:1594-1643 | ✓ |
| G1 `DEBUG_GATE_CODES` | application.mjs:945-948 | ✓ (`Object.freeze(new Set([...]))` at :945) |
| G1 `normalizeWorkflowFeedback` gate dispatch | application.mjs:1645-1652 | ✓ (`typeof value.gate === 'string'` at :1648) |
| G1 source `authenticated_user` | application.mjs:6746-6749 | ✓ (`kind: 'authenticated_user'` at :6747) |
| G1 recordDriver | application.mjs:6778-6782 | ✓ |
| G2 `SECRET_SHAPED_TEXT` | application.mjs:327-331 | ✓ (declaration at :327) |
| G3 `debugGateRefusal` | application.mjs:993-1010 | ✓ |
| G3 `debugGateFromLiveCode` | application.mjs:949-956 | ✓ |
| G3 `debugGateDetail` | application.mjs:958-990 | ✓ |
| G3 `debug` authorize `run.inspect` | application.mjs:11279-11294, :11284 | ✓ |
| G3 `_debugMember` events filter (runId+taskId) | application.mjs:11300-11308 | ✓ |
| G3 sanitizer | verifier-diagnostics.mjs:26 | ✓ (`export function sanitizeVerifierDiagnosticText` at :26) |
| G5 kind constant | application.mjs:51 | ✓ (`'application.workflow_feedback_recorded'`) |
| G5 `_workflowFeedback` span / fields / ceiling / digest-check | application.mjs:6346-6423, :6360-6362, :6353-6355, :6389 | ✓ |
| G5 `sendWorkflowFeedback` span / feedbackId / recordDriver | application.mjs:6717-6790, :6761-6765, :6778-6782 | ✓ |
| G6 #79 push key/projection/frame | worker-delivery-push-contract.md:294, 317-323, 158-159 | ✓ |
| G7 `_workflowRevisionFeedbackRows` | application.mjs:6789-6807 | ✓ |
| G7 `.findings.some` crash | application.mjs:6860 | ✓ |
| G7 `renderWorkflowRevisionObjective` + `:1781`/`:1789` | application.mjs:1780-1795 | ✓ |
| G7 `packet.feedback.summary` render | application.mjs:10574 | ✓ |
| G8 DG-1b red pin | diagnostics-red.test.mjs:356-406 | ✓ (test body :356-400; the assertion spans into the cited range) |
| G8 workflow-gate refusal | application.mjs:6733-6735 | ✓ |
| G9 `_isWorkflowRun` / candidate lookup / anchors | application.mjs:6733, :6740, :6745 | ✓ |
| G10 `recordDriver` → `_append('driver.recorded')` | coordination-store.mjs:13178-13182 | ✓ |
| G10 `_events.push` / snapshot `lastSeq` | coordination-store.mjs:1444/1512/1590, :11626 | ✓ |
| D1 gate-cause closed schema | application.mjs:1597-1598 | ✓ (literal at :1597 — see §1.2 #2) |
| D2 discriminator `typeof value.gate === 'string'` | application.mjs:1648 | ✓ |
| D2 coaching closed schema | application.mjs:1656-1657 | ✓ (literal at :1656 — see §1.2 #2) |
| D2 `assertWorkflowFeedbackAnchors` | application.mjs:1683-1694 | ✓ |
| D3 `_workflowFeedback` fields literal | application.mjs:6360-6362 | ✓ |
| D3 OQ3 `feedbackId` shape | application.mjs:6761-6765 | ✓ |
| Forge-surface `run.feedback` capabilities `['control','observe']` | application.mjs:181 | ✓ |
| Attack quote | trust-gate-steering-2026-08-02/redteam-authority.md:231-236 | ✓ |
| Hub-minted amendment | trust-gate-steering-2026-08-02/redteam-authority.md:246-249 | ✓ |
| TG4 revision-channel + non-use + follow-up | trust-gate-steering-2026-08-02/trust-gate-steering-decisions.md:115-131, :121-122, :167 | ✓ |
| MCP/web preserve `application_*` codes | mcp-northbound.mjs:206, web-northbound.mjs:201-203 | ✓ (verified as the transport seam the new code must ride — §4) |

### 1.2 Wrong / imprecise citations

1. **G4 (substantive — automatic blocker):** the contract claims `_workflowCandidates` gives each
   accepted Candidate `verification.worker` / `verification.workerSeq`. It does not. The
   Candidate's `verification` field is `this._closedVerdictProjection(...)` (application.mjs:6278-6281)
   whose returned literal (application.mjs:10508-10514) contains `accepted`, `acceptancePolicy`,
   `digest`, `outcome`, `failureOwnership`, `expectedExit`, `observedExit`, `execution`,
   `baseExecution`, `outputExceeded`, `capturedOutputBytes`, `capturedOutputDigest`,
   `(failureCapsule)`, `diagnosticCode`, `durationMs`, `runtimeDigest`, `attemptOrdinal` — **no
   `worker`, no `workerSeq`**. The worker/workerSeq live in `candidate.evidence.verification`
   (application.mjs:6264-6267, `evidenceCore.verification = { worker, workerSeq, verdictDigest,
   changedPathsDigest }`). The D1 implementation snippet (`const workerId =
   candidate.verification.worker`, §3 D1) therefore reads `undefined` on every Candidate, `events`
   is always `[]`, `derived` is always `null`, and **every gate-shaped submission REFUSES
   `application_workflow_feedback_gate_unbound` — GREEN-2 is unachievable as written.** Fix: the
   snippet and the G4 ground-truth row must read `candidate.evidence.verification.worker` /
   `.workerSeq` (and the anchor `:6248-6253` corrected to `:6247-6252` — `worker` is at :6247).
2. **Minor off-by-one on closed-schema literals:** `['gate', 'detail']` literal is at
   application.mjs:1597 (contract cites :1598 — the call's second argument line); `['summary',
   'findings']` literal is at application.mjs:1656 (contract cites :1657). Both `exactObject` calls
   span the cited line, so the substance holds; fold as cosmetic.
3. **Minor range on coaching normalization:** G2 cites `:1657-1682`; the coaching branch opens at
   :1653 (`const input = typeof value === 'string' …`). Cosmetic.
4. **G6 scope claim is loose:** the contract's D1 says the admission derivation uses "the SAME
   source events … #79's push use". The #79 push projection is worker-scoped
   (`debugGateRefusal(events.filter(e => e.worker === workerId))`, push-contract.md:322), while the
   D1 snippet and `_debugMember` are run+task-scoped. The two scopes legitimately differ (worker's
   own latest verdict vs this Candidate's task stream); the phrase "SAME source events" overstates
   the identity. Not a blocker; amend to "the same sanitizer and the same `debugGateRefusal`
   projection function, over the candidate-scoped (run+task) event set".

---

## 2. Decision verdicts

### D1 — HOLE (as specified; the underlying boundary is SOUND)

**What is sound:**
- **Cross-run verdict laundering is blocked.** The candidate-scoped projection filters
  `event.runId === current.goal.runId && event.taskId === candidate.taskId`
  (application.mjs:11304-11306 pattern), so a REAL gate event on a DIFFERENT run/worker is never a
  referent. The caller never chooses the referent — it is hub-derived from the Candidate's own task
  stream. The headline forge (shape-valid payload, no referent) is closed.
- **Refuse-vs-replace is decidable and correctly ordered.** The boundary `derived === null → REFUSE
  (gate_unbound); derived !== null → validated-or-replaced` is a pure function of the event log.
  REFUSE-with-no-referent is the right call (a fabricated "derived" payload would lie to the D3
  field); REPLACE-with-referent preserves the caller's honest intent and keeps `derived: true`
  truthful. Placement after `_isWorkflowRun` (G9, application.mjs:6733) preserves GREEN-1.
- **Replace cannot be exploited to forge content** — the stored bytes are always the derived
  payload; the caller's differing bytes are discarded.

**Hole B1 (the D1 snippet is broken):** `candidate.verification.worker` does not exist (§1.2 #1).
**Fix:** `candidate.evidence.verification.worker`.

**Hole B4 (compounds into D3):** the derived projection is the LATEST gate-refusal
(`debugGateRefusal` uses `candidates.at(-1)`, application.mjs:999), so the projection at admission
and the projection at read-back differ once the task stream grows (a later trust-gate error or a
later `verify.reverified{accept:false}` after the feedback was recorded). The D3 read-back
integrity check ("derived === true IFF … equals the candidate-scoped `debugGateRefusal`
projection") therefore throws `application_workflow_integrity` on a record that was valid at
admission. **Fix:** bind the record to the source gate event's seq (the #79 precedent:
`gate:${event.seq}`, push-contract.md:294), store it on the packet, and have the integrity check
re-project THAT event (or verify the stored payload is a projection of SOME real gate event on the
task stream), not the latest one.

**Hole B5 (legacy records):** gate-shaped records already in the ledger (the forge's own output —
shape-only admission predates the hardening) will fail the hardened `_workflowFeedback` read
(§D3 B2/B4) and throw `application_workflow_integrity` for the WHOLE feedback read surface. The
contract does not specify migration/expiry for pre-hardening records. **Fix:** pin the migration
(exclude or explicitly re-derive-and-mark legacy gate-shaped records; at minimum a deployment
step), and make the extended integrity check degrade per-record rather than brick the map.

### D2 — SOUND

- **The closed shape is actually closed.** `exactObject` (application.mjs:302-307) rejects unknown
  keys on the gate-cause form (`['gate','detail']` :1597), the scope/red_green/coverage detail
  forms (:1599-1641), and the coaching form (`['summary','findings']` :1656). A caller-supplied
  `derived` key of either value refuses `application_workflow_feedback_invalid` on both forms
  (RED-2 holds).
- **A forged verdict cannot hide in a non-gate field at the record level.** Coaching is stored as
  `{summary, findings}`; a gate-shaped payload cannot be smuggled into it (exactObject), and
  `assertWorkflowFeedbackAnchors` short-circuits on `feedback.gate !== undefined` (:1686) so a
  gate-shaped coaching finding cannot carry path anchors either.
- **The discriminator is decidable.** `typeof value.gate === 'string'` (:1648) is a total,
  syntactic split; both branches then enforce closed schemas. Coaching prose may embed verdict-shaped
  TEXT (a defect finding describing a gate failure), but that is authored coaching by design,
  UNTRUSTED-framed at delivery (push-contract.md:156-159, :414), and no consumer parses structured
  verdicts out of coaching text (§3).
- **No back door through a non-gate field on the two dispatch paths:** both the `send_feedback`
  semantic action (application.mjs:12288) and the `run.feedback` command (application.mjs:12578)
  call the same `sendWorkflowFeedback`, which is where D1/D2 slot. `run.steer` is deleted from every
  surface (application.mjs:12481-12484). No bypass.

### D3 — HOLE

**What is sound:** the caller cannot forge `derived: true` (closed-schema rejection, D2); the field
is hub-set after admission validation. The replay-derivability *over a fixed event set* is correct
(`debugGateRefusal` is a pure function of `events`; the store replay reconstructs `_events`,
coordination-store.mjs:1444/1512/1590).

**Hole B2 (internal contradiction: coaching records carry NO `derived` key vs. the amended closed
field literal).** D3 amends the `_workflowFeedback` closed field literal (application.mjs:6360-6362)
to include `derived`, making it 11 fields, while simultaneously pinning "coaching records carry NO
`derived` key". The read-back check `Object.keys(core).sort().join(',') !== fields.sort().join(',')`
(:6380) is an EXACT-set match: a coaching record with 10 keys fails against an 11-field literal →
`application_workflow_integrity` on every coaching record. The contract cannot hold both
"absence means authored" and "the closed literal gains `derived`". **Fix:** pick one — (a) record
`derived` on EVERY packet (`true` for verdicts, `false` for coaching) and make the discriminator
`derived === true`, with the literal at 11 fields; or (b) keep "absence = authored" and make the
field-set check conditional (gate-shaped → 11 fields incl. `derived`; coaching → the current 10).
Note (a) also changes the OQ3 answer (feedbackId/dedup) since `derived: false` is now present on
coaching.

**Hole B3 (the revision-loop seam `workflow-revision.mjs` is never cited or amended).** The
revision node stores `feedback: packets` (application.mjs:6966) — the `_workflowRevisionFeedbackRows`
rows. On read, `normalizeWorkflowRevision` validates each packet with an exact schema
`['feedbackId','feedbackDigest','eventSeq','feedback']` (workflow-revision.mjs:120) and each body
with `['summary','findings']` (:60). Carrying `derived` through to the packets (D3's own
requirement) and/or a gate-shaped `{gate,detail}` body BOTH fail `normalizeWorkflowRevision` →
`workflow_revision_invalid`. GREEN-4 ("a derived:true verdict packet in the revision set no longer
throws") is therefore unreachable without amending `workflow-revision.mjs`, which the contract never
mentions. **Fix:** amend `workflow-revision.mjs` — packet schema to allow `derived`, and `feedbackBody`
to accept a gate-shaped body (or branch the revision flow to keep verdict packets out of the
revision record's `feedback` list and render them only in the objective).

**Hole B4 (read-back instability) and B5 (legacy records):** as stated under D1. The D3 "IFF …
equals the candidate-scoped `debugGateRefusal` projection" check is not stable across event-log
growth, and pre-hardening records brick the read. Both must be pinned in D3.

### D4 — SOUND (with one internal contradiction)

**What is sound:**
- **Facade/MCP/web surface constancy holds for the new code.** `stateFailureCode`
  (mcp-northbound.mjs:206) passes any `application_*` code through unchanged — the new
  `application_workflow_feedback_gate_unbound` rides the wire typed. The web facade's `application_*`
  fallthrough (web-northbound.mjs:201-203) likewise preserves the code (HTTP 400, lane-crafted
  message). All three surfaces reach `sendWorkflowFeedback` through the same command dispatch
  (application.mjs:12288, :12578), so refusal {code, message} is identical across surfaces.
- **GP7/GP8 (message rides only if lane-crafted) is satisfied by construction.** Every refusal the
  contract introduces is a static `applicationError(...)` literal (the existing
  `'Workflow feedback is invalid'`-style strings and the to-be-added gate_unbound message); no
  caller byte is echoed into any message. The new code is not in the message-carrying set beyond its
  lane-authored message, and the pushed `{gate, detail}` is the already-sanitized hub projection.
- **`run.debug`'s failure leg is untouched** (application.mjs:993-1010 is only read by the new
  admission site).

**Contradiction B6 (D3 vs D4/GREEN-5 on the #79 push bytes).** D3 requires "The `gate_verdict` push
item carries `derived: true`", but the push contract's `gate_verdict` item (worker-delivery-push-
contract.md:294, 315-323) carries NO `derived` field today — the existing discriminator is the
`wrapHubDerived` wrapper's `provenance: 'hub-derived'` (:159). Adding `derived: true` to the item
CHANGES the push bytes, which D4/GREEN-5 pin as unchanged ("#79's `gate_verdict` push bytes are
unchanged"). **Fix:** pick one — (a) the worker discriminates via the existing
`wrapHubDerived.provenance === 'hub-derived'` marker and D3 is reworded to not add a `derived`
field to the wire item; or (b) `derived: true` is added to the push item AND D4/GREEN-5 are amended
to allow that one byte addition.

---

## 3. Consumer-path audit

- **#79 push (the judged worker) — SOUND, no back door.** The `gate_verdict` item is derived
  `debugGateRefusal(events.filter(e => e.worker === workerId))` from the worker's own stream
  (push-contract.md:315-323), keyed `gate:${event.seq}` (:294), and NEVER reads `run.feedback`
  records. A caller-authored verdict cannot reach the worker through the push, independent of the
  admission fix. The only interplay is B6 (whether the push item gains `derived`).
- **Planner's revision loop — HOLE (B3).** The four crash sites the contract identifies
  (application.mjs:1781, :1789, :6860, :10574) are accurate and the D3 branch fixes them. But the
  revision RECORD's `feedback: packets` (application.mjs:6966) is re-validated by
  `normalizeWorkflowRevision` on every read (workflow-revision.mjs:59-77, :119-131), which rejects
  both the `derived` key and the gate-shaped body. The contract fixes the render path but not the
  record path. No OTHER lane feeds the revision loop (only `APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND`
  records via `_workflowRevisionFeedbackRows`, application.mjs:6789-6807).

---

## 4. Refusal vocabulary — verdicts

| code | verdict |
|------|---------|
| `application_workflow_feedback_gate_unbound` (new) | **SOUND** — typed refusal, preserved on MCP (mcp-northbound.mjs:206) and web (web-northbound.mjs:201-203); nothing recorded; nothing worker-visible. Message lane-crafted (static `applicationError` string); GP7/GP8 satisfied. |
| `application_workflow_feedback_invalid` (incl. caller-supplied `derived`) | **SOUND** — closed-schema rejection via `exactObject` (:1597, :1656); RED-2 holds. |
| `application_workflow_feedback_anchor_invalid` | **SOUND** — coaching-only; gate-shaped skips anchors (:1686). |
| `application_workflow_feedback_unavailable` | **SOUND** — non-workflow / no-Candidate refusal at :6733-6743, before D1; GREEN-1 holds. |
| `application_workflow_integrity` | **HOLE** — the extended D3 check is unstable (B4) and legacy records brick the read (B5); per-record degradation + a legacy migration step must be pinned. |

## 5. Acceptance pins — verdicts

| Pin | verdict |
|-----|---------|
| RED-1 (forged verdict refuses `gate_unbound`, no record, no worker reach) | **SOUND** once B1 is fixed; with the snippet as written it trivially passes (everything refuses) but for the wrong reason. |
| RED-2 (provenance forge refuses `invalid`) | **SOUND** — verified at :1597/:1656. |
| GREEN-1 (DG-1b shape pin preserved) | **SOUND** — D1 placement after `_isWorkflowRun` (:6733) keeps the non-workflow refusal code ≠ `invalid`. |
| GREEN-2 (validated-or-replaced) | **BROKEN** — B1 makes `derived` always `null` on a workflow run, so a real-referent submission REFUSES instead of validating/replacing; and `feedbackDigest`/fields amendments are un-pinned pending B2. |
| GREEN-3 (coaching path unchanged) | **SOUND** — coaching normalization untouched; UNTRUSTED framing preserved. |
| GREEN-4 (consumer safety, no crash) | **BROKEN** — B3: a derived verdict packet cannot live in the revision record's `feedback` list without amending `workflow-revision.mjs`. |
| GREEN-5 (surface constancy) | **CONTRADICTION** — B6: `derived: true` on the push item changes push bytes that GREEN-5 pins unchanged. |

## 6. Open questions — verdicts

- **OQ1 (gate-name mismatch on a real referent → replace):** SOUND as a call, but it compounds B4 —
  the replace decision must be re-verified at read time against the SAME source event the record was
  bound to, or the "replace" and the read-back check disagree. Revisit as part of the B4 fix.
- **OQ2 (verdict-line prose):** SOUND — implementation freedom is appropriate; the pin is the branch
  and a distinct line, which is fine.
- **OQ3 (`derived` vs `feedbackId`):** SOUND while `derived` is deterministic IFF gate-shaped —
  but note the determinism is about the RECORD's own `feedback` (fixed at admission), while the
  read-back CHECK is what is unstable (B4). If B2 fix (a) is chosen (`derived: false` on coaching),
  the dedup claim needs a one-line revisit.

---

## 7. Final — **NOT FOLD-READY**

**Blockers (what / why / concrete fix):**

1. **B1 — D1 reads a nonexistent field (`candidate.verification.worker`).** The Candidate's
   `verification` is the closed verdict projection (application.mjs:10508-10514) with no `worker`;
   worker/workerSeq live at `candidate.evidence.verification` (:6264-6267). As written, `derived` is
   always `null` and GREEN-2 is impossible. **Fix:** D1 snippet and G4 must use
   `candidate.evidence.verification.worker` / `.workerSeq`; correct the G4 anchor to `:6247-6252`.
2. **B2 — D3 is internally contradictory on the closed field literal.** "Coaching records carry NO
   `derived` key" vs "the closed literal at application.mjs:6360-6362 gains `derived`" are mutually
   unsatisfiable against the exact-set check at :6380. **Fix:** pin one model — record `derived`
   on every packet (`true`/`false`) with `derived === true` as the discriminator, OR keep absence =
   authored and make the field-set check conditional on gate-shape.
3. **B3 — the revision-loop seam `workflow-revision.mjs` is unaddressed.** The revision record's
   `feedback` list is re-validated by `normalizeWorkflowRevision` (workflow-revision.mjs:59-77,
   :119-131) which rejects both the `derived` key and a `{gate,detail}` body — GREEN-4 is
   unreachable. **Fix:** amend `workflow-revision.mjs` (allow `derived` on the packet; accept a
   gate-shaped body in `feedbackBody`), and bind the digest check at application.mjs:6905 to the
   amended packet shape.
4. **B4 — the D3 read-back integrity check is not replay-stable.** `debugGateRefusal` takes the
   latest gate-refusal (`.at(-1)`, application.mjs:999); the task stream grows after admission, so
   the read-back projection diverges from the admission projection and the "IFF equals the
   candidate-scoped projection" check throws `application_workflow_integrity` on honest records.
   **Fix:** bind the record to the source gate event's `seq` (the #79 `gate:${event.seq}` precedent)
   and re-project THAT event at read time (or verify the payload is a projection of some real gate
   event on the task stream).
5. **B5 — legacy records are unhandled.** Pre-hardening gate-shaped records (the forge's own output)
   and pre-hardening coaching records (no `derived`) fail the hardened read and brick the entire
   feedback read surface with one throw. **Fix:** pin a migration/expiry step and make the extended
   integrity check degrade per-record rather than throw for the map.
6. **B6 — D3 and D4/GREEN-5 contradict on the #79 push bytes.** D3 adds `derived: true` to the push
   item; the push shape today carries only the `wrapHubDerived` `provenance: 'hub-derived'` marker
   (push-contract.md:159), and GREEN-5 pins the push bytes unchanged. **Fix:** either discriminate
   via the existing `provenance` marker (no byte change) or explicitly amend D4/GREEN-5 to allow the
   `derived: true` addition.

Once B1-B6 are resolved (the fixes are mechanical except B4's seq-binding, which is the substantive
one), the contract's underlying design — hub-validated-or-refused gate admission at the
verified-Candidate step, closed-shape coaching, a server-set provenance discriminator, and per-record
consumer branches — is SOUND and the forge surface (G1) is genuinely closed.
