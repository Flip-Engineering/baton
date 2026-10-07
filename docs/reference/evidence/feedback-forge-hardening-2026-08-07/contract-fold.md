# #73 FOLD — blocker → change map (v1.0 → v1.1)

Source: `contract-redteam.md` (pass rt-2026-08-07, **NOT FOLD-READY**). Fold target:
`feedback-forge-hardening-contract.md` v1.1. Fold HEAD: `7518367ad5e09eef78c33fd0444c6c89190c3ff8`
(the red-team pass ran at `b2c98f0…`; the only diff between the two trees is unrelated #105
message-budget code at `application.mjs:12752+`, so every anchor was re-grepped at the fold HEAD
before writing and confirmed unchanged).

Verdict folding: all **6 numbered blockers** (B1-B6) resolved with the report's concrete fix; the
**4 citation blockers** (§1.2) re-anchored; open questions **OQ1 RESOLVED** (via B4), **OQ2/OQ3
SOUND** (OQ3 with the B2 one-line dedup revisit). The report's **D1/D2/D4 SOUND** verdicts are
folded as pins into the decisions.

---

## Citation blockers (report §1.2) — all corrected

| # | Blocker (report) | v1.0 anchor (wrong) | v1.1 anchor (re-grepped at fold HEAD) | Where in v1.1 |
|---|---|---|---|---|
| 1 | **G4 nonexistent `verification.worker` (substantive — automatic blocker)** | `_workflowCandidates` gives `verification.worker`/`verification.workerSeq` at `:6248-6253` | the fields are `candidate.evidence.verification.worker` / `.workerSeq` — worker read `application.mjs:6247`, workerSeq `:6248`, `evidenceCore.verification` literal `:6264-6267` (`{worker, workerSeq, verdictDigest, changedPathsDigest}`); the Candidate's `verification` is the closed `_closedVerdictProjection` returned literal `:10508-10514` (NO `worker`/`workerSeq`) | G4 |
| 2 | Minor off-by-one on closed-schema literals | `['gate', 'detail']` at `:1598`, `['summary', 'findings']` at `:1657` | `exactObject(value, ['gate','detail'], …)` at **`:1597`**; `exactObject(input, ['summary','findings'], …)` at **`:1656`** | D2 |
| 3 | Minor range on coaching normalization | `:1657-1682` | the coaching branch opens at **`:1651`** (`const input = typeof value === 'string' …`); span `:1651-1682`. (Re-grep also corrected the report's own `:1653` → `:1651`.) | G2 |
| 4 | G6 scope claim loose ("SAME source events") | "#79's push use … the same source events" | "the same sanitizer and the same `debugGateRefusal` projection function, over the candidate-scoped (run+task) event set" — the #79 push is worker-scoped by design (`debugGateRefusal(events.filter(e => e.worker === workerId))`), the D1 admission run+task-scoped | G6, D1 |

Every other citation the report marked ✓ was re-confirmed at the fold HEAD unchanged.

## Numbered blockers (report §7) — all resolved

| # | Blocker | Concrete fix (from the report) | Change in v1.1 |
|---|---|---|---|
| 1 | **B1 — D1 reads a nonexistent field (`candidate.verification.worker`)** | D1 snippet and G4 must use `candidate.evidence.verification.worker` / `.workerSeq`; correct the G4 anchor to `:6247-6252` | **G4** rewritten (evidence.verification is the binding; `verification` is the closed projection). **D1** snippet reads `candidate.evidence.verification.worker` / `.workerSeq`. As written in v1.0 `derived` was always null and every gate-shaped submission refused vacuously — **RED-1** pin gains the B1 note that the refusal is genuine only with the fix. |
| 2 | **B2 — D3 internally contradictory on the closed field literal** | pin one model — record `derived` on every packet (`true`/`false`, `derived === true` the discriminator), or absence = authored with a conditional field-set check | **Model (a) pinned**: `derived` recorded on EVERY packet (`true` verdict / `false` coaching), `derived === true` the discriminator, NO absence case; the amended literal (ACTUAL source order) is 12 fields: `['definitionDigest', 'derived', 'feedback', 'feedbackId', 'gateEventSeq', 'planDigest', 'prefix', 'repoId', 'runId', 'schemaVersion', 'source', 'target']` — satisfiable against the exact-set check at `application.mjs:6380`. The v1.0 "coaching carries NO `derived`" model is explicitly retired. **GREEN-3** now asserts `derived: false`, `gateEventSeq: null`. **OQ3** gains the one-line dedup revisit. |
| 3 | **B3 — the revision-loop seam `workflow-revision.mjs` unaddressed** | amend `workflow-revision.mjs` (allow `derived` on the packet; accept a gate-shaped body in `feedbackBody`), and bind the digest check at `application.mjs:6905` to the amended packet shape | **D3** consumer bullet rewritten: packet schema `exact(packet, ['feedbackId','feedbackDigest','eventSeq','feedback'])` (`workflow-revision.mjs:120`) gains `derived`; `feedbackBody` (`:59-77`, body schema `['summary','findings']` at `:60`) branches to a gate-shaped `{gate, detail}` body; the `digest(revision.feedback) !== digest(packets)` binding at `application.mjs:6905` covers the amended shape. **GREEN-4** requires the `workflow-revision.mjs` amendment. |
| 4 | **B4 — the D3 read-back check is not replay-stable** | bind the record to the source gate event's `seq` (the #79 `gate:${event.seq}` precedent, push-contract.md:294), store it on the packet, and re-project THAT event at read time (or verify the payload is a projection of SOME real gate event on the task stream) | **D3** "Replay-derivable and seq-bound": the record gains `gateEventSeq` (the `seq` of the gate event the admission projection used; `null` on coaching). The extended integrity check requires `derived === true` IFF gate-shaped AND the stored `{gate, detail}` byte-equals the `{gate, detail}` of `debugGateRefusal([event])` for the task-stream event with `event.seq === packet.gateEventSeq`. The `.at(-1)` latest-projection drift is gone — admission and read-back projections are identical. **D1** gains the "hub-derived, never caller-chosen" pin (cross-run laundering blocked by the `_debugMember` filter `application.mjs:11303-11306`; stale/superseded referents unreachable — the record binds the admission-time source event). **OQ1 RESOLVED** — the replace decision re-verifies against the bound event. |
| 5 | **B5 — legacy records unhandled** | pin a migration/expiry step and make the extended integrity check degrade per-record rather than throw for the map | **D3** "Per-record degradation + legacy migration": a packet failing the extended check is EXCLUDED from the read projection (surfaced through a diagnostics channel), NOT a map-wide `application_workflow_integrity` throw; a deployment step excludes the forge's own shape-only gate-shaped records and re-derives-or-excludes pre-hardening coaching records. **Refusal vocabulary** `application_workflow_integrity` row updated to per-record degradation. |
| 6 | **B6 — D3 vs D4/GREEN-5 contradict on the #79 push bytes** | either discriminate via the existing `wrapHubDerived.provenance === 'hub-derived'` marker (no byte change) or explicitly amend D4/GREEN-5 to allow the `derived: true` addition | **Option (a) pinned**: the `gate_verdict` push item carries NO `derived` field — the wire bytes stay unchanged; the worker machine-distinguishes hub-derived verdicts from authored coaching by the existing `wrapHubDerived.provenance === 'hub-derived'` marker (`worker-delivery-push-contract.md:158-159`). The record-level `derived: true` is the planner's discriminator. **D4** surface constancy and **GREEN-5** explicitly pin the push bytes unchanged; **§2** synthesis and **D3** push bullet reworded. |

## SOUND verdicts folded as pins (report §2 — D1/D2/D4, §3 consumer audit, §4/§5 verdicts)

- **D1 — cross-run verdict laundering is blocked.** Folded into **D1** as the "the referent is
  hub-derived, never caller-chosen" pin: the candidate-scoped projection
  (`event.runId === current.goal.runId && event.taskId === candidate.taskId`,
  `application.mjs:11303-11306`) makes a REAL gate event on a DIFFERENT run/worker unreachable;
  the caller never chooses the referent. Refuse-vs-replace is decidable and ordered correctly
  (`derived === null → gate_unbound`; `derived !== null → validated-or-replaced`); placement after
  `_isWorkflowRun` (`:6733`) keeps **GREEN-1**/**G8** green.
- **D2 — the closed shape is closed; no smuggle through a non-gate field.** Folded into **D2** as
  the "No smuggle through a non-gate field" pin: coaching is stored `{summary, findings}` under a
  closed schema, `assertWorkflowFeedbackAnchors` short-circuits on `feedback.gate !== undefined`
  (`application.mjs:1685`), no consumer parses structured verdicts out of coaching text. The
  report's D2 verdict (SOUND) is folded as-is. **RED-2** unchanged.
- **D4 — facade/MCP/web constancy holds.** Folded into **D4**: `stateFailureCode`
  (`mcp-northbound.mjs:206`) and the web `application_*` fallthrough (`web-northbound.mjs:201-203`)
  carry the new `application_workflow_feedback_gate_unbound` unchanged; all three surfaces reach
  `sendWorkflowFeedback` through the same command dispatch, so refusal `{code, message}` is
  identical. `run.debug`'s failure leg (`application.mjs:993-1010`) is read-only for the new
  admission site.
- **#79 push is SOUND, no back door.** Folded into **G6**/D3: the push derives
  `debugGateRefusal(events.filter(e => e.worker === workerId))` and NEVER reads `run.feedback`
  records — the only interplay is B6, resolved by option (a).

## Open questions (report §6)

- **OQ1 — RESOLVED as a v1.1 blocker** (via B4): the replace decision is re-verified at read time
  against the SAME bound source event (`gateEventSeq`) the record carries — "replace" and the
  read-back check cannot disagree. The red-team's call (SOUND as a call) held; it compounds B4 and
  is resolved there.
- **OQ2 — SOUND, unchanged.** The verdict-line prose is implementation freedom; the pin is the
  branch (no `.findings`/`.summary` access on verdict packets) and a distinct line.
- **OQ3 — SOUND, with the B2 one-line revisit.** `feedbackId` (`application.mjs:6761-6765`) does
  not cover `derived`/`gateEventSeq`; under B2 option (a) `derived: false` is now present on
  coaching, and the dedup claim is revisited (both fields remain admission-deterministic, so no
  dedup ambiguity). If future provenance fields are added, revisit whether `feedbackId` should
  cover provenance.

## What the fold must NOT change (report §7 verdict: the design is SOUND) — preserved intact

- The hub-validated-or-refused gate admission at the verified-Candidate step, and its placement
  AFTER `_isWorkflowRun` (`application.mjs:6733-6735`) — **G8**/**GREEN-1** stay green.
- The closed-schema rejections (`exactObject` at `:1597`/`:1656`) — **RED-2** stays.
- The `feedbackId` dedup shape (`feedback:${digest({…source, target, feedback})}`) — **OQ3**.
- The candidate-scoped `_debugMember` filter (cross-run laundering blocked) — **D1**.
- The authored-coaching path (closed kinds/severities, anchors, UNTRUSTED frame) — **D2**/**GREEN-3**.
- `run.debug`'s failure leg (DG-1) — untouched by the new admission site.
