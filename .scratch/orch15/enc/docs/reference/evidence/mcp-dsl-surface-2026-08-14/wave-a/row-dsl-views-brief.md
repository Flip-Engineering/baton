# ROW BRIEF — row-dsl-views: fleet state speaks the wavefile grammar + sinceSeq deltas

Issue #227 item 3 (#208 cross-ref). Deliverable: implementation + red-first pin.

## Anchors

- impl/src/mcp-northbound.mjs:1906+ — baton_waves_list/progress dispatch; progress args are
  {waveId, cursor:int} (application.mjs _normalizeWaveProgress :12107).
- The wavefile grammar: 'wave <key>' header, member blocks (harness/model/effort/scope/
  objectiveRef/report), policy lines (compileWavefile in the interpreter seam).

## Contract (closed)

1. baton_waves_progress gains an optional sinceSeq: when present, the response carries only
   member transitions/attention at seq > sinceSeq plus the new nextSinceSeq — a delta, not
   a page. Default (absent) behavior byte-stable back-compat.
2. baton_waves_list rows gain a wavefileView: the settled wave projects to compilable DSL
   text (header + member roster + policy block) so a harness reads fleet state as the same
   artifact it fires. Round-trip pin: compileWavefile(wavefileView) admits.
3. Red-first pins impl/test/wave-dsl-views-red.test.mjs: (a) a sinceSeq progress call
   returns only post-seq transitions (RED: no sinceSeq arg exists); (b) a settled wave's
   wavefileView re-compiles (RED: no view field).

## Measured traps (orchestrator's near-miss, 2026-08-14 — pin these)

The orchestrator attempted this row directly and REVERTED in favor of this wave; the draft
carried a #210-class read bug the row must avoid by construction:

1. **NEVER call `eventsView()` (no args) for the ledger cursor/length** — it copies the
   whole world per call. The store needs (or already has) an O(1) cursor/length accessor;
   use it, and PIN its use (a test asserting the delta path makes zero full-ledger copies).
2. The delta filter (`seq > sinceSeq`) rides a slice — verify `eventsView(from)` returns a
   tail slice or an iterator, and bound the response (`events.slice(-64)` + `truncated`).
3. The WLS-1 single-pass index pattern is the precedent for any per-wave filtering.

## Hard bounds
Additive; projection-only (no new store writes); batteries green.
