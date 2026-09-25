# COORDINATOR BRIEF — no-clock-followons-2026-08-14 wave-a (#163 follow-ons)

Two implementation rows completing the #163 no-clock law inside the wave driver. You verify
the rows' deliverables and write verify-notes.md carrying NOCLOCK-FOLLOWONS-VERIFY v1.
Acceptance authority: the rows' named red-first pins run green at their HEAD, plus the
quiescence-completion battery (15/15) and the wave-driver suites unchanged.

Context (handoff 2026-08-14, docs/handoff/2026-08-14-v20-state.md): #163 killed hardCapMs and
replaced it with quiescence DERIVED from observed cadence — quiet window max(2x observed gap,
8x poll). Two fixed clocks survive in the driver: the wave-level stallTimeoutMs (20min fixed
production default) and settleTimeoutMs (5s fixed), and the quiescence leg-b reads members
that only emit tool calls (no checkpoints) as silent because the liveness marker is the
cursor-stripped STATUS view, not activity. Do not edit source yourself; the rows do.
