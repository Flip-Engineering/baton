# #164 CONTRACT BRIEF — blind waits fail loud (terminal state + dead authority)

You are drafting the implementation contract for issue #164: wait/poll verbs return empty or
hang to timeout when the truth is already terminal or the caller's authority is dead.
Observed: a 25-iteration pump loop against an expired credential (#148's instance);
`run.wait` on a terminal run waiting out the clock.

## Read first (in order)

1. The issue: `gh issue view 164`. The credential instance: `gh issue view 148`. The pump
   loop's evidence: the friction ledger Appendix D (2026-08-13 rows).
2. The lease-revalidation pattern that already does this RIGHT for recursive reads (the
   RA6/RA7 rows: `run.inspect`/`run.follow` revalidate the recipient lease after wait and
   before projection — find them, cite them, mirror the discipline).
3. The wait/poll verbs' current behavior: `run.wait`, `run_view`'s continuation, `run.follow`,
   the MCP `fleet_run_wait` — where each decides what to return on terminal/dead-authority
   (cite each site).
4. The terminal vocabulary: the run phases + the waitingOn spine (#10) the answers must
   ride.

## The contract must answer

- **D1 — the fail-loud law.** Every wait/poll re-checks authority AND terminality per cycle:
  terminal run → the terminal view with the cause, immediately; dead authority → the typed
  refusal naming the renewal path. Never silence, never the full clock.
- **D2 — the per-verb seam map.** Exactly where each verb gains the check (the revalidation
  point per verb), with the RA6/RA7 pattern as the template.
- **D3 — the honesty edge cases.** A run that terminalizes MID-wait (the wait returns the
  terminal truth, not the timeout it was owed); an authority that expires mid-wait; a run id
  that never existed (unknown ≡ foreign stays byte-identical — the FP-05 law).
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline on
`application.mjs` + `coordination-store.mjs`); no clocks. Deliverable:
`docs/reference/evidence/blind-waits-2026-08-13/blind-waits-contract.md` ONLY.
