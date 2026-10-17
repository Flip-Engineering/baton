# COORDINATOR BRIEF — verify the waves_list fix (v4-pro seat)

Read `fix-brief.md` (the defect + the fix shape). One row is fixing the waves_list roster
projection's per-member full-log scans. You receive `signalOnMembersDone` when it settles (the
spec watches the row; you are the remaining member — pinned #175 semantics).

## Your work

1. Wait for the signal; then verify on disk (the #174 law: sibling worktrees at `../../wt/ws-*/`;
   silence is not death).
2. Run the acceptance yourself from the repo root: the WLS-1 pin green; the four named
   adjacents green (wave-observability 30/30 · workflow-as-data 30/30 · workflow-dsl 35/35 ·
   workflow-dsl-package 12/12). Then a LIVE check: `baton waves list` against the running
   resident must return the current roster promptly (not a 503) — the resident must be
   restarted onto the fixed code first; if you cannot restart it, note that and verify by the
   suites alone.
3. Write `verify-notes.md` (this dir): VERDICT (sound / needs-fix), the measured splits, the
   live-check outcome. Line 1 must be exactly `WLS-VERIFY v1`. Your `[attempt:]` line verbatim
   in the first five lines. Escalate authority-class questions via DECISION_REQUEST.

## Pin-vacuity guard (added after the #210 eventsView landing)

The eventsView fix (#210) switched the read path off `events()`; WLS-1's spy now counts BOTH
accessors, but on the suite's empty-registry fixture the read count may stay ≤4 for the wrong
reason (no members → no per-member scans; or the command refusing early). Before you verdict
sound: extend the fixture to register several fake wave records (driver.recorded /
APPLICATION_WORKFLOW_RECORD_KIND payloads — see `_workflowDefinitionAncestors` in
application.mjs for the filter shape) so the per-member path genuinely executes, confirm the
pin is RED against the pre-fix tree and GREEN only with the single-pass index, and quote both
runs in verify-notes.md. A pin that never exercised the defect is a failed pin.

## Laws

Cited evidence, no clocks, no fabrication, read-and-run only outside your deliverable.
