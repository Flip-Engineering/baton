# ROW — #241: harvest_miss must carry the member's checkpoint sha

Measured (wave-h): a row completed work_completed with resultSha 9d3d766fa4 (the
checkpoint exists and is pinned) but its declared report missed harvest — the settle
receipt showed harvest_miss with NO pointer to the recoverable work. Recovery required
ledger archaeology.

Deliverable (red-first):
1. RED pin impl/test/harvest-recovery-red.test.mjs: a settle outcome whose harvest
   misses (code harvest_miss) while the member outcome carries a resultSha must surface
   that sha on the harvest row (name the field recoverySha; keep resultSha on the member
   outcome). The miss sites are workflow-interpreter.mjs:826 (absent path — today
   nulls resultSha), :836, :839. Pin at least the absent-path case.
2. Fix: the miss rows carry the MEMBER OUTCOME's resultSha through as recoverySha (the
   work is not lost; the pin is the pointer). Absent-path miss with a member resultSha
   surfaces recoverySha; no member sha → recoverySha:null (never invented).
3. GREEN + workflow/interpreter batteries.

Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/test/**, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-b/notes-row-harvest-recovery.md
