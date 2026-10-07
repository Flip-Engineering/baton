# #67 CONTRACT BRIEF — the stall watchdog: from structurally inert to evidence-armed

You are drafting the implementation contract for issue #67 (the stall watchdog is structurally
inert and escapable). Read fully, in order: (1) the issue — `gh issue view 67` (the three
red-team receipts with anchors); (2) the receipts —
`docs/reference/evidence/trust-gate-steering-2026-08-02/redteam-semantics.md` (A7) and
`redteam-authority.md` (TG1/6b); (3) the machinery: `impl/src/application-deployment.mjs` (the
`watchdog.stallMs = DEFAULT_BUDGET.wallMin * 60_000` wiring), `impl/src/coordinator.mjs` (the
any-event re-arm at :8314-8317 via :11089; the blocked-vs-working status at :7903 — line anchors
drifted, re-verify), `impl/src/coordination-store.mjs` (the 128-entry note cap); (4) the TG2
distinct-digest precedent (trust-gate-steering contract — progress-evidence re-arming) and the
landed #10 waitingOn vocabulary (`baecb18` — blocked_interaction / waitingOn now exist as
first-class states; the watchdog's semantics must compose with them, not fight them).

## The contract must decide (with the operator's control law in front of you)

**THE CONTROL LAW (operator, campaign):** controls are eval-able, constructive, or
conversational — NEVER clocks or turn-limits as workflow gates; time-based windows handicap
legitimate slow work. A stall watchdog is a LIVENESS bound, not a workflow gate — but the
contract must show the line: the watchdog may only ever declare "no evidence of progress," never
"too slow." Every bound it pins is measured in evidence units (distinct digests, receipts,
events), with time as the coarse outer backstop only.

- **D: decouple the stall budget from the wall budget.** The stall budget today equals the whole
  node budget (:1710). Pin the decoupling: a deployment-level stall budget that is strictly
  smaller, separately configured, and honestly disclosed (what it measures: no-progress
  evidence, not speed).
- **D: progress-evidence re-arming.** Kill the any-event re-arm: only PROGRESS-EVIDENCE events
  re-arm (a changed in-scope digest per TG2's class, a landed diff, a verification result, an
  orchestrator steer). A chatty idler (128 one-char notes, heartbeats, status noise) does NOT
  re-arm. Enumerate the re-arming event classes by name; everything else is silence.
- **D: the blocked-status escape.** A worker parked on a blocking question with `deadlineAt:
  null` exits 'working' and parks forever. With #10 landed, the honest state is
  `waitingOn: {kind: 'interaction'}` — the contract must decide whether the watchdog watches
  waiting-on-interaction workers (a NEVER-answered question is a stall of the orchestrator, not
  the worker — pin whose stall it is), and the blocking-interaction default when deadlineAt is
  null (the orchestrator's attention inbox is the escalator; pin the surface).
- **D: the kill ladder.** What happens at stall-declared: escalate (attention inbox) →
  claim/nudge → reap — the constructive order, each step receipted, no silent kills.
- **Refusal/observability vocabulary + acceptance pins (red-first)** per the decisions.

## Laws + deliverable

Ring-2 form. No clocks as controls (above); every citation re-verified at the CURRENT HEAD;
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #64,
#10, #55 (the three-waves incident), #7. Deliverable: ONLY
`docs/reference/evidence/stall-watchdog-2026-08-07/stall-watchdog-contract.md` (v1.0 DRAFT with
the verification HEAD).
