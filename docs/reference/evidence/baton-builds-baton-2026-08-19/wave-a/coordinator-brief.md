# COORDINATOR BRIEF — baton-builds-baton wave-a (2026-08-19)

Three rows land open seams. You verify each row's deliverable and write
docs/reference/evidence/baton-builds-baton-2026-08-19/wave-a/verify-notes.md
carrying the line BATON-BUILDS-BATON-VERIFY v1 (plus per-row one-line verdicts).
Your role is VERIFICATION ONLY — you write exactly one file (the verify-notes) and
change no code. Rows:
- row-plan-effects (#240): coordinator verification-role plans must not require
  repository_edit (required_effect_absent red-first pin + the plan-shape fix).
- row-harvest-recovery (#241): harvest_miss outcomes carry the member's checkpoint
  sha as the work-recovery hint (red-first pin + the receipt field).
- row-resume-wiring (#201 roadmap): the successor incarnation's orphan re-dispatch —
  orphans() rows + sessionRef drive a resume spawn (--resume id) red-first pin;
  implementation may be seam-level (a coordinator method minting the resume spawn
  intent durably) — full spawn execution is out of scope this wave.
