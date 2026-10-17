# COORDINATOR BRIEF — death-certs-2026-08-14 wave-a (#225)

One implementation row: enrich terminal member events with the death-cert facts (issue #225).
You verify the row's deliverable and write verify-notes.md carrying the line
DEATH-CERTS-VERIFY v1. Acceptance authority: the red-first pin suite the row names, run green
at the row's HEAD, plus the coordinator battery unchanged.

Measurements you cite verbatim (from the coordination ledger, 2026-08-14):
- 18:06:51-18:07:00Z: 11 lifecycle.crashed events, every one envelope-only
  {worker, workerSeq, digest, kind, ts} — zero cause payload.
- All-time: 453 lifecycle.process_closed ledger rows, none carrying a cause-class field
  at the LEDGER surface (the latch's closeFact may hold it — the mapping is the suspect).

Do not edit source yourself. The row does. You read, verify, report.
