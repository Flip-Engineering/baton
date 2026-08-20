# ROW BRIEF — row-harvest-recovery: harvest_miss carries the checkpoint sha (#241)

Issue #241. wave-h measured: row-admission-align work_completed with resultSha
9d3d766fa4 (pinned checkpoint exists) but its declared report missed the harvest —
the receipt showed harvest_miss with NO pointer to the recoverable work.

Deliverable: implementation + red-first pin.
1. RED first: impl/test/harvest-recovery-red.test.mjs — a settle outcome whose
   harvest missed (code harvest_miss) while the member outcome carries a
   resultSha must surface that sha on the harvest outcome
   (harvest.resultSha or harvest.recoverySha — name it and pin the exact field).
   Verify RED at HEAD.
2. Fix: workflow-interpreter.mjs harvest outcome assembly — the miss case copies
   the member outcome's resultSha into the harvest row (the work is NOT lost; the
   pin is the pointer).
3. GREEN + wave-driver/interpreter batteries green.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.
