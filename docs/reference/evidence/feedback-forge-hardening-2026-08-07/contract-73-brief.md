# #73 CONTRACT BRIEF — run.feedback must be hub-minted, never caller-authored (the forged-verdict lane)

You are drafting the implementation contract for issue #73 (run.feedback accepts caller-authored
{gate, detail} with shape-only validation — a forged trust-gate verdict can steer the judged
worker AND the planner's revision loop). Read fully, in order: (1) the issue — `gh issue view 73`
+ the red-team receipt it cites (`docs/reference/evidence/trust-gate-steering-2026-08-02/redteam-authority.md`
TG4); (2) the admission path today: `application.mjs:1420-1468` area (grep -an — NUL file) — the
shape-only validation of caller-authored {gate, detail}; (3) the hub-minted precedent: DIAG
DG-1's `run.debug` derives {gate, detail} from the ledger (digests-only honesty —
`verifier-diagnostics.mjs`); the TG4 deliberate non-use of run.feedback as the verdict lane
(`ac5bd80`); (4) the #79 worker-delivery-push contract v1.1 (the sanitized verdict push to the
worker — the consumer of honest verdicts; this contract hardens the SOURCE).

## The contract must decide

- **The hub-minted rule.** A {gate, detail} payload on run.feedback is validated-or-replaced
  against the coordination record BEFORE admission: the gate must name a REAL gate event from
  the durable ledger (derived, the way run.debug derives it) — a caller-authored verdict with no
  ledger referent refuses by name (a new typed code) or is REPLACED by the derived payload
  (never silently accepted). Pin which (refuse vs replace), and why.
- **The legitimate-caller path.** What CAN a control/observe principal still send through
  run.feedback (free-form coaching text — never gate-shaped)? The shape boundary: feedback that
  is gate-shaped must be hub-derived; feedback that is not gate-shaped rides as authored
  coaching with the UNTRUSTED frame. Pin the discriminator.
- **The consumer safety.** The judged worker (#79's push) and the planner's revision loop must
  be able to distinguish a hub-derived verdict from authored coaching machine-readably (a
  `derived: true` provenance field, replay-derivable).
- **Refusal vocabulary + acceptance pins (red-first)** — the forged-verdict refusal (a
  caller-authored {gate, detail} naming a gate with no ledger referent refuses by name, never
  reaches the worker), the legitimate-coaching path, the provenance field, surface-constancy.

## Laws + deliverable

Ring-2 form. No clocks; every citation verified (`grep -an`/`sed -n` on the two NUL files);
sorted-key literals ACTUAL order; `localeCompare` banned. Cross-reference (do not re-spec): #64
(TG4), DG-1, #79, #61. Deliverable: ONLY
`docs/reference/evidence/feedback-forge-hardening-2026-08-07/feedback-forge-hardening-contract.md`
(v1.0 DRAFT with the verification HEAD).
