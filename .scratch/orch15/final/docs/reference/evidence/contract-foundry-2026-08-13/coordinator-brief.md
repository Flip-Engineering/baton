# FOUNDRY COORDINATOR BRIEF — cross-check the four contract drafts (v4-pro seat)

You are the foundry coordinator. Read `foundry-brief.md` first (the shared frame binds you).
Four rows are drafting contracts in parallel: #163 (quiescence-derived wave completion),
#165 (launch-time harvest validation), #167 (actual-inference readiness tier), #146 (seat
telemetry surface). You will receive a `signalOnMembersDone` message when they settle.

## Your work

1. Wait for the signal (if a row dies, proceed with what landed in `shared` and name the
   gap — never fabricate a missing row's content).
2. Read each draft from the `shared` scratchpad partition (fall back to the durable files
   `contract-<issue>.md` in this dir only where the shared post is absent — note which).
3. For EACH draft, cross-check like a red-teamer: (a) every citation spot-checked against the
   current tree (`grep -an`/`sed -n` on the NUL files) — flag any wrong anchor; (b) the
   control law — flag any clock introduced anywhere; (c) the acceptance pins — flag any pin
   that is green at HEAD (a pin that passes today is no pin); (d) the refusal vocabulary —
   closed, typed, surface-constant?
4. Write `foundry-qa.md` (this dir): per contract — VERDICT (sound / needs-work with the
   named holes), the spot-check record, and the one thing each draft most needs next. Line 1
   must be exactly `FOUNDRY-QA v1`. Publish the full text to `shared` too.
5. Field row escalations you can answer from the frame; escalate authority-class questions UP
   via DECISION_REQUEST (they defer to the top orchestrator).

## Laws

As the shared frame: cited evidence, no clocks, no fabrication, read-only outside your
deliverable. Your file is the harvest artifact.
