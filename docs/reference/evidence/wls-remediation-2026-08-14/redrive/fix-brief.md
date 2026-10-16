# FIX BRIEF — row-fix: the waves_list roster projection's per-member full-log scans

You are the fix row for the waves_list scaling defect. At HEAD the projection helpers
`_runWaveRole` / `_runWaveRoute` (and siblings) in `impl/src/application.mjs` each call
`this.driver.coordination.events()` per member runId — waves_list over a fat log (87k events)
times out the bus command budget (503 `temporarily_unavailable`), leaving the orchestrator
blind exactly when the fleet is biggest.

**The fix:** build the projection's lookup ONCE per invocation — a single pass over the event
log building the runId → { role, route, waveId } maps (the steering-registered records), then
serve every member from the maps. Same output shape, same honesty (event-log-derived, no
clocks, no caching across invocations that could go stale — per-invocation build only).
NUL discipline: application.mjs is NUL-bearing — `grep -an`/`sed -n` only, never a whole-file
read, and don't disturb the NUL bytes. Additive-only. localeCompare banned; sorted-key literals
ACTUAL order.

**Acceptance (verify before you finish):**
1. `node --test impl/test/waves-list-scaling-red.test.mjs` — GREEN (the WLS-1 pin: bounded log
   reads per invocation).
2. Adjacents green-unchanged: `wave-observability-red` 30/30 · `workflow-as-data-red` 30/30 ·
   `workflow-dsl-red` 35/35 · `workflow-dsl-package-red` 12/12.
3. Write `docs/reference/evidence/wls-remediation-2026-08-14/redrive/fix-notes.md`: the mechanism, the
   before/after call counts (instrumented), anything not green and why. Your `[attempt: <salt>
   <role>]` line VERBATIM in the notes' first five lines.
