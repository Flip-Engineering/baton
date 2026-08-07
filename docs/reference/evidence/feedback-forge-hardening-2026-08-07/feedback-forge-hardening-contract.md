# Issue #73 — run.feedback must be hub-minted, never caller-authored (the forged-verdict lane)

- **Issue:** #73 — a {gate, detail} payload on `run.feedback` is accepted with shape-only
  validation, so any observe/control principal can durably record a FORGED trust-gate verdict
  about a Candidate — steering the planner's revision loop (and, once rendered, the re-driven
  worker's next brief). The verdict the worker receives must be hub-minted (derived from the
  durable ledger), never caller-authored.
- **Date:** 2026-08-07
- **Status:** v1.0 DRAFT — implementation contract (Ring-2 form, acceptance pins red-first)
- **Verification HEAD:** `985fc75e07fe56e24a909cc5285a2e2c74069565` (this worktree's
  effective-tree snapshot). Every `file:line` citation below was re-verified with
  `grep -an`/`sed -n` at the verification HEAD. Both `application.mjs` and
  `coordination-store.mjs` are NUL-bearing (3 NUL bytes each — verified
  `tr -cd '\000' < file | wc -c`); `coordinator.mjs` is clean. All three were read by
  grep/sed only, per campaign discipline.
- **Brief:** `contract-73-brief.md` (this directory) — read fully. The issue body was
  unavailable at drafting time (`gh` is not authenticated in this worktree), so the brief's own
  decisions carry the requirements; the red-team receipt (`trust-gate-steering-2026-08-02/
  redteam-authority.md` Attack 3 TG4) and the landed machinery carry the anchors.

**Cross-references (not re-specified here):** #64 (`trust-gate-steering-decisions.md` — the
TG4 decision that `run.feedback` is NOT the verdict lane, and the red-team amendment that
worker-bound verdicts must be HUB-MINTED), DG-1 (`verifier-diagnostics.mjs` + the `run.debug`
failure leg — the hub-derived {gate, detail} projection this contract reuses verbatim), #79
(`worker-delivery-push-contract.md` — the sanitized `gate_verdict` push to the worker, the
consumer of honest verdicts), #61 (the trust-gate steering epic — the worker never learns why
until the #79 push). Each is cited at the decision it touches. This contract owns only the
`run.feedback` admission surface and its two consumers' machine-readable discriminator.

---

## 1. Ground truths (re-verified at HEAD `985fc75`)

| # | Ground truth | Verified anchor |
|---|--------------|-----------------|
| G1 | **`run.feedback` admits caller-authored {gate, detail} with shape-only validation.** `sendWorkflowFeedback` normalizes via `normalizeWorkflowFeedback`, which routes the gate-cause form to `normalizeGateCauseFeedback`. That function checks SHAPE ONLY: `gate` is a member of `DEBUG_GATE_CODES`, `detail` is closed-shaped (scope → `{digests, counts}` with HEX64-or-null digests and non-negative integer counts; red_green/coverage → `{tail}` re-sanitized; route_mismatch/forbidden_effect/unknown → `{}`). **Nothing binds the {gate, detail} to any real gate event.** The normalized payload is recorded via `recordDriver` with `source` `authenticated_user`. | `application.mjs:1594-1643` (`normalizeGateCauseFeedback`), `:945-948` (`DEBUG_GATE_CODES`), `:1645-1652` (`normalizeWorkflowFeedback` gate dispatch), `:6746-6749` (source), `:6778-6782` (recordDriver) |
| G2 | **The shape boundary / discriminator is the top-level `gate` string.** `normalizeWorkflowFeedback` dispatches on `typeof value.gate === 'string'` → the gate-cause form; otherwise → the coaching form (`{summary, findings}`, closed kinds/severities, 1..32 findings, `SECRET_SHAPED_TEXT`-guarded). This boundary is the one the contract pins — a caller's submission is EITHER gate-shaped (→ hub-minted or refused) OR coaching (→ authored). | `application.mjs:1645-1648` (dispatch), `:1657-1682` (coaching normalization), `:328-331` (`SECRET_SHAPED_TEXT` lives at `:327`) |
| G3 | **The hub-minted precedent (DG-1) exists and is the ledger projection to reuse.** `run.debug` derives `{gate, detail}` from durable per-worker events: `debugGateRefusal` projects the LATEST trust-gate/verifier refusal (`error` with `payload.phase === 'trust_gate'`, or `verify.reverified` with `accept === false`), maps the live code via `debugGateFromLiveCode`, and derives digests+counts / a re-sanitized tail via `debugGateDetail` — NEVER path strings. `debug()` authorizes `run.inspect` (capabilities `['observe']`) and scopes per-worker events the same way `_debugMember` does: `driver.log.read(workerId).filter(e => e.runId === runId && e.taskId === taskId)`. | `application.mjs:993-1010` (`debugGateRefusal`), `:949-956` (`debugGateFromLiveCode`), `:958-990` (`debugGateDetail`), `:11279-11294` (`debug`), `:11284` (`run.inspect` authorize), `:11300-11308` (`_debugMember` events filter); `verifier-diagnostics.mjs:26` (`sanitizeVerifierDiagnosticText` — reused verbatim, no parallel redaction path) |
| G4 | **The verified Candidate carries the worker binding against which a submission must be validated.** `_workflowCandidates` gives each accepted Candidate `taskId`, `verification.worker`, `verification.workerSeq`, `changedPaths`, `resultSha`, `retainedResultRef`, `candidateId` — the `verification` fields are bound to the accepted `verify.reverified` event on that worker's stream. This is the coordination record the contract validates against. | `application.mjs:6225-6296` (`_workflowCandidates`; worker/workerSeq at `:6248-6253`) |
| G5 | **The durable record and its read-back integrity re-check.** `sendWorkflowFeedback` builds `source` (authenticated_user), `target` (Candidate binding), `feedbackId = feedback:${digest({repoId, runId, planDigest, definitionDigest, source, target, feedback})}`, and records `APPLICATION_WORKFLOW_FEEDBACK_RECORD_KIND` (`'application.workflow_feedback_recorded'`) via `recordDriver`. `_workflowFeedback` re-validates on read: closed field set, source/prefix key sets, `feedbackDigest === digest(core)`, `digest(normalized) === digest(core.feedback)`, Candidate anchoring, ceiling 64. | `application.mjs:6717-6790` (`sendWorkflowFeedback`; feedbackId `:6761-6765`; recordDriver `:6778-6782`), `:51` (kind constant), `:6346-6423` (`_workflowFeedback`; fields `:6360-6362`; ceiling `:6353-6355`; `digest(normalized) !== digest(core.feedback)` `:6389`) |
| G6 | **The #79 push is the worker-facing consumer of honest verdicts.** The `gate_verdict` push item is keyed `gate:${event.seq}` and derived from the worker-scoped projection `debugGateRefusal(events.filter(e => e.worker === workerId))` — the same source events and the same sanitizer, NEVER a run-wide reuse — framed `wrapHubDerived` (`provenance: 'hub-derived'`) inside the `[attention/untrusted]` frame. | `worker-delivery-push-contract.md:294, 317-323, 158-159`; `debugGateRefusal` `application.mjs:993-1010` |
| G7 | **The planner's revision loop is a second consumer, and today it CRASHES on a gate-shaped packet.** The revision flow reads feedback packets via `_workflowRevisionFeedbackRows` (returns `{feedbackId, feedbackDigest, eventSeq, feedback}` — it DROPS every other packet field), then: `_workflowRevisionEligibility` runs `packets.some((packet) => packet.feedback.findings.some(...))` — a gate-shaped packet has no `findings`, so this is a TypeError; `renderWorkflowRevisionObjective` runs `packet.feedback.findings.map(...)` and `packet.feedback.summary` — TypeError / `undefined` on a gate-shaped packet; the `feedback` view-section renderer reads `packet.feedback.summary` — renders `undefined`. A forged gate-shaped record therefore does not merely steer — it can crash the planner loop and the feedback read surface. | `application.mjs:6789-6807` (`_workflowRevisionFeedbackRows`), `:6860` (`packet.feedback.findings.some`), `:1780-1795` (`renderWorkflowRevisionObjective`; `:1781`, `:1789`), `:10574` (`packet.feedback.summary`) |
| G8 | **The DG-1b red pin asserts the SHAPE contract.** `diagnostics-red.test.mjs:356-406` emits a real trust-gate error on the worker stream, reads the derived diagnosis via `run.debug`, submits the same `{gate, detail}` through `run.feedback` on a NON-workflow run, and asserts the shape is accepted (any refusal code EXCEPT `application_workflow_feedback_invalid` — the non-workflow run refuses at the workflow gate after normalization with `application_workflow_feedback_unavailable`). The #73 hardening must keep this green while closing the referent gap. | `diagnostics-red.test.mjs:356-406`; the workflow-gate refusal `application_workflow_feedback_unavailable` at `application.mjs:6733-6735` |
| G9 | **The admission path sits AFTER the workflow gate.** `sendWorkflowFeedback` checks `_isWorkflowRun` (`:6733`), finds the verified Candidate by `role` (`:6740`), runs `assertWorkflowFeedbackAnchors` (`:6745`), and only then builds `source`/`target` (`:6746`, `:6750`). The hub-minted validation must slot at the verified-Candidate step, so a non-workflow run still refuses `application_workflow_feedback_unavailable` first (G8 stays green). | `application.mjs:6733-6745` (`_isWorkflowRun` `:6733`, candidate lookup `:6740`, anchors `:6745`) |
| G10 | **The durable event log is the replay source.** `recordDriver` appends `driver.recorded` events to the store's `_events` array; the snapshot exposes `lastSeq`. A provenance flag is replay-derivable iff it is a pure function of those durable events. | `coordination-store.mjs:13178-13182` (`recordDriver` → `_append('driver.recorded', ...)`), `:1444/:1512/:1590` (`_events.push`), `:11626` (snapshot `lastSeq: this._events.length`) |

---

## 2. The forge surface (synthesis)

The write hole (G1): any principal holding `run.feedback` capabilities — `['control', 'observe']`
(`application.mjs:181`) — can durably record a gate-shaped `{gate, detail}` with **no ledger
referent**. `normalizeGateCauseFeedback` validates shape only: `gate` in the enum, digests
HEX64-or-null, counts non-negative, tails re-sanitized. Nothing ties the payload to a real gate
event. That is exactly the red-team's attack: "Nothing binds the feedback's {gate, detail} to
any real gate event. Any observe/control principal can durably record a FORGED gate verdict
about a candidate … and the revision path consumes feedback rows … so a forged verdict steers
not only the re-driven worker but the PLANNER's revision loop" (`redteam-authority.md:231-236`).

The two victims:

1. **The planner's revision loop** — consumes the forged record as a feedback packet (G7). Today
   that is a **crash** (`packet.feedback.findings.some`, `packet.feedback.summary`), not just
   steering. If the render were made gate-aware without the provenance discriminator, the forged
   `{gate, detail}` would be rendered into the revision objective and steer the re-driven
   worker's next brief.
2. **The durable record itself** — a verdict is mis-attributed to an `authenticated_user` source
   (G1/G5), so any later consumer that trusts a `run.feedback` record as verdict evidence is
   reading a caller-authored claim, not a hub-minted fact.

The worker-bound channel that #79 built (`gate_verdict`, keyed `gate:${event.seq}`) is already
ledger-derived and never reads `run.feedback` records (G6) — the forge does not reach the worker
through the push. It reaches the worker through the **revision objective** (the TG4-sanctioned
planner-owned next-brief channel, `trust-gate-steering-decisions.md:115-131`) once the render is
gate-aware. This contract closes the source: no caller-authored gate-shaped record is ever
admitted, so no consumer — crash-prone today or gate-aware tomorrow — ever sees one.

The deliberate non-use is on the record: TG4 pinned `run.feedback` is NOT the verdict lane
("caller-authored forgery surface … its hardening is a separate issue"
`trust-gate-steering-decisions.md:121-122, 167`), and the red-team amendment demands
"Worker-bound verdicts must be HUB-MINTED … principal-authored {gate, detail} run.feedback must
NEVER be presented to a worker as a gate verdict (mark it `claim`, or exclude the gate-cause
form from worker-bound channels entirely)" (`redteam-authority.md:246-249`). This contract is
that separate issue: it makes the gate-cause form hub-validated-or-refused at admission, and
gives both consumers a machine-readable `derived: true` discriminator.

---

## 3. Decisions

### D1 — The hub-minted rule: REFUSE when there is no ledger referent; validated-or-replaced when there is one

At the verified-Candidate step in `sendWorkflowFeedback` (G9), the hub derives the
candidate-scoped gate projection — the SAME source events and the SAME sanitizer the `run.debug`
failure leg and #79's push use (G3/G6), never a run-wide reuse:

```
const workerId = candidate.verification.worker;                 // G4
const events = workerId
  ? this.driver.log.read(workerId)
      .filter((event) => event.runId === current.goal.runId
        && event.taskId === candidate.taskId)                   // G3 _debugMember scope
  : [];
const derived = debugGateRefusal(events);                       // null when no real gate event
```

- **No ledger referent** (`derived === null`) → **REFUSE by name** with the new typed code
  `application_workflow_feedback_gate_unbound` (D4). Pin: **refuse, never replace** — the
  rationale is below.
- **A ledger referent exists** (`derived !== null`) → the STORED `feedback` is the DERIVED
  payload `{gate: derived.gate, detail: derived.detail}`, never the caller's bytes. If the
  caller's payload byte-matches the derived payload it is **validated**; if it differs it is
  **REPLACED** by the derived payload. Either way the packet carries `derived: true` (D3). The
  caller's authored `{gate, detail}` is never silently accepted — it never becomes the stored
  verdict.

**Why refuse (not replace) when there is no ledger referent:**

1. **Replacement is only honest when there is something honest to replace with.** The derived
   payload is a pure projection of a real gate event. With no ledger referent, "replacing" would
   mean the hub fabricating a verdict — the exact forgery class #73 closes.
2. **A fabricated "derived" payload would corrupt the provenance field the contract adds.** A
   no-referent submission replaced with a derived-looking payload would carry `derived: true` on
   a verdict that never happened — the field would lie, and every consumer (D3) would trust it.
3. **"Never silently accepted" is satisfied loudly.** A typed refusal tells the caller the gate
   had no referent and nothing was attached. A silent substitution (or a no-op) would let the
   caller misread the outcome as their verdict having been recorded.
4. **The gate-cause form's legitimacy is wholly ledger-derived** (G3). A submission that is
   shape-valid but referent-invalid is a distinct failure class — deserving a distinct code, so
   the caller learns the specific defect (no gate event on the Candidate's task stream), not a
   generic shape error.

**Why replace (not refuse) when a referent exists but the caller's bytes differ:** the caller's
intent — "attach this Candidate's real gate verdict" — is preserved honestly: the record stores
the true derived `{gate, detail}` and `derived: true` keeps the provenance truthful. The caller
cannot forge content either way (their bytes are discarded); a byte-equality requirement would
make the gate-cause form unusable, since only the ledger (via `run.debug`) can produce the exact
digests.

**Placement:** the validation sits at the verified-Candidate step (G9), AFTER `_isWorkflowRun`
(`application.mjs:6733-6735`) — so a non-workflow run still refuses
`application_workflow_feedback_unavailable` first and the DG-1b pin (G8) stays green.

### D2 — The legitimate-caller path: coaching text only; the discriminator stays the top-level `gate` string

A control/observe principal can still send free-form coaching through `run.feedback`: the
`{summary, findings}` form (G2) — authored prose, closed kinds/severities, 1..32 findings,
`SECRET_SHAPED_TEXT`-guarded, path/line anchors validated against the exact Candidate delta
(`assertWorkflowFeedbackAnchors`, `application.mjs:1683-1694`), UNTRUSTED-framed on delivery
(cross-ref #79 `wrapProse`/`[attention/untrusted]` — do not re-spec the seam). That form is
unchanged and rides as authored coaching. **A principal can never author a gate-shaped verdict.**

The discriminator is pinned as the existing one: `typeof value.gate === 'string'`
(`application.mjs:1648`). Gate-shaped → D1 (hub-validated-or-replaced, or refused). Non-gate-
shaped → coaching (authored).

**Provenance is not caller-settable.** The `derived` key is outside the gate-cause closed schema
(`['gate', 'detail']`, `application.mjs:1598`) and the coaching closed schema
(`['summary', 'findings']`, `:1657`); `exactObject` rejects unknown keys, so a caller supplying
`derived` (of either value) refuses `application_workflow_feedback_invalid`. The provenance
field (D3) is hub-set only, after admission validation.

### D3 — Consumer safety: a `derived: true` provenance field, replay-derivable

**The field.** The stored feedback packet (the `driver.recorded` payload) carries a top-level
`derived` boolean, sibling of `feedback`/`source`/`target` (the closed field literal at
`application.mjs:6360-6362` is amended to include `derived`; the amended literal, ACTUAL source
order, becomes `['definitionDigest', 'derived', 'feedback', 'feedbackId', 'planDigest',
'prefix', 'repoId', 'runId', 'schemaVersion', 'source', 'target']`). Hub-minted verdict records
carry `derived: true`; coaching records carry NO `derived` key. Presence-with-true is the
machine-readable discriminator; absence means authored.

**Replay-derivable.** The flag is a pure function of the durable ledger. `_workflowFeedback`'s
integrity check (`application.mjs:6389` `digest(normalized) !== digest(core.feedback)`) is
extended to require: `derived === true` IFF the packet's `feedback` is gate-shaped AND its
`{gate, detail}` equals the candidate-scoped `debugGateRefusal` projection (G3/G10). Two replays
over the same `_events` derive the same flag; the store's replay reconstructs the identical
projection (`coordination-store.mjs:1444/1512/1590`, `:11626`).

**Consumers branch on it:**

- **The #79 push (judged worker).** The `gate_verdict` push item carries `derived: true`; the
  authored-coaching attention items carry none (cross-ref #79 D1/D6 — do not re-spec the seam).
  The worker machine-distinguishes hub-derived verdicts from authored coaching by the field.
- **The planner's revision loop.** `_workflowRevisionFeedbackRows` (`application.mjs:6789-6807`)
  must carry `derived` through to the revision packets (today it drops every packet field except
  `feedbackId`/`feedbackDigest`/`eventSeq`/`feedback`). `_workflowRevisionEligibility` must NOT
  run the `.findings.some(...)` contradiction check on a `derived: true` packet
  (`:6860` — a verdict packet is evidence, not a contradiction signal). `renderWorkflowRevisionObjective`
  must render a `derived: true` packet as a distinct verdict line from its `{gate, detail}` and
  exclude it from the `.findings`/`.summary` paths (`:1781`, `:1789` — the TypeError today).
  The `feedback` view-section renderer must not emit a bare `undefined` summary for a verdict
  packet (`:10574`).

### D4 — Refusal vocabulary and surface constancy

**New typed code:** `application_workflow_feedback_gate_unbound` — a caller-authored
`{gate, detail}` naming a gate with **no real gate event** on the Candidate's task stream (no
ledger referent). Nothing is recorded; nothing reaches the worker.

**Provenance forge refusal:** a caller-supplied `derived` key → `application_workflow_feedback_invalid`
(closed-schema rejection — no new code; D2).

**Surface constancy:** `run.debug`'s failure leg (DG-1, `application.mjs:993-1010`), the #79
`gate_verdict` push shape (`worker-delivery-push-contract.md:294, 317-323`), and the coaching
path are unchanged. Only the gate-cause admission gains referent validation (D1) + the
provenance field (D3), and the two consumers gain the `derived` branch (D3).

---

## 4. Refusal vocabulary

| code | when | recorded? | worker-visible? |
|------|------|-----------|-----------------|
| `application_workflow_feedback_gate_unbound` | **NEW.** Caller-authored `{gate, detail}` with no ledger referent — no real gate event on the Candidate's task stream (D1) | no | no |
| `application_workflow_feedback_invalid` | shape violation — including a caller-supplied `derived` key (D2) | no | no |
| `application_workflow_feedback_anchor_invalid` | coaching finding anchors outside the exact Candidate delta | no | no |
| `application_workflow_feedback_unavailable` | non-workflow run / no verified Candidate (G9) | no | no |
| `application_workflow_integrity` | read-back integrity failure in `_workflowFeedback` | n/a | n/a |

---

## 5. Acceptance pins (red-first)

- **RED-1 — the forged-verdict refusal (the issue's headline).** On a WORKFLOW run with a
  verified Candidate whose task stream has NO gate-failure event (no `error` with
  `phase: 'trust_gate'`, no `verify.reverified` with `accept: false`), a caller submits
  `{gate: 'scope', detail: {digests: {changedPathsDigest: <HEX64>, inScopeChangedPathsDigest:
  <HEX64>, outOfScopeChangedPathsDigest: <HEX64>}, counts: {changedPathCount: 1,
  inScopeChangedPathCount: 0, outOfScopeChangedPathCount: 1}}}` through `run.feedback`. The
  command REFUSES `application_workflow_feedback_gate_unbound`; no `driver.recorded` event of
  kind `application.workflow_feedback_recorded` is appended; `_workflowFeedback` returns the
  pre-submission records; the revision objective and #79 push carry no verdict; the caller's
  bytes are never stored.
- **RED-2 — the provenance forge refuses.** A caller submits `{gate: 'scope', detail: {...},
  derived: true}` (or `derived: false`) → `application_workflow_feedback_invalid`; the
  `derived` field is hub-set only, never caller-set.
- **GREEN-1 — DG-1b shape pin preserved.** `diagnostics-red.test.mjs:356-406` stays green: on a
  NON-workflow run, the gate-shaped payload passes normalization and refuses at the workflow
  gate with a code other than `application_workflow_feedback_invalid` (D1 placement after
  `_isWorkflowRun`).
- **GREEN-2 — validated-or-replaced.** On a WORKFLOW run where the Candidate's task stream HAS a
  real gate event (e.g. the worker hit a scope gate failure, then retried and passed), a caller
  submits the byte-matching `{gate, detail}` → accepted; the stored packet's `feedback` is the
  DERIVED `{gate, detail}` with `derived: true`; `_workflowFeedback` integrity passes
  (`feedbackDigest` covers `derived`). A mismatched submission (fabricated digests, or a
  different `gate`) → accepted but the stored payload is REPLACED by the derived one,
  `derived: true`, never the caller's bytes.
- **GREEN-3 — the coaching path.** `{summary, findings}` coaching on the same Candidate →
  recorded with `derived` absent; the planner loop and the `feedback` section render it exactly
  as today; delivery stays UNTRUSTED-framed (cross-ref #79).
- **GREEN-4 — consumer safety, no crash.** A `derived: true` verdict packet in the revision set
  no longer throws: `_workflowRevisionEligibility` returns a state without evaluating
  `.findings.some` on the verdict packet; `renderWorkflowRevisionObjective` renders it as a
  distinct verdict line; the `feedback` section renders a non-`undefined` summary.
- **GREEN-5 — surface constancy.** `run.debug`'s failure leg and #79's `gate_verdict` push bytes
  are unchanged; the coaching shape is unchanged; only the gate-cause admission and the two
  consumers' `derived` branch differ from today.

---

## 6. Open questions

- **OQ1 — gate-name mismatch on a real referent.** When a real gate event exists but the caller's
  `gate` names a DIFFERENT gate than the derived one (e.g. caller says `'red_green'`, derived
  says `'scope'`), D1 replaces with the derived payload. A stricter variant would refuse
  `application_workflow_feedback_gate_unbound` on gate-name mismatch too, treating the caller's
  `gate` as a hard assertion. Replace is pinned because the caller's intent ("attach this
  Candidate's verdict") is preserved honestly and `derived: true` keeps the record truthful;
  revisit if a caller-submitted `gate` must be a hard assertion.
- **OQ2 — the verdict line prose.** The exact text `renderWorkflowRevisionObjective` emits for a
  `derived: true` packet (gate, code, message, sanitized detail) is left to implementation; the
  pin is the branch (no `.findings`/`.summary` access on verdict packets) and a distinct verdict
  line, not the prose.
- **OQ3 — `derived` vs `feedbackId`.** `feedbackId` (`application.mjs:6761-6765`) does not
  include `derived`; since `derived` is deterministic IFF gate-shaped (D3), there is no dedup
  ambiguity. If future provenance fields are added, revisit whether `feedbackId` should cover
  provenance.
