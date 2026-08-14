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

## Hard bounds
Additive; projection-only (no new store writes); batteries green.
