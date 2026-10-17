# ROW — #159 conformance core: the pinned reds go green

The surface-conformance gates (impl/test/surface-conformance-red.test.mjs +
doc-truth-conformance-red.test.mjs) currently fail 11 rows — THE pinned roster for #159.
Run them first; every row below maps to its named red.

Deliverable (red-first — the reds EXIST; your job is green):
1. R1 + R4 (run.watch documented-but-unparsed / silent reinterpretation): the CLI needs
   a real `baton run watch RUN_ID` parse branch dispatching run.watch; bare
   `run watch` refuses value-required (never silently reinterprets).
2. R3 + R9 (answer-schema decision): the answer schemas must be decision-free and the
   guard must cover fleet_run_answer — a renamed/refused answer form refuses
   invalid_arguments on both consumers.
3. R5 + R11 (example honesty): every served row's Example AND taught Verb compile
   through the real parser; committed artifact counts match admission + parser dispatch.
4. R7 (facade-ports-unledgered): every CLI_WEB_COMMANDS name is web-admitted or ledgered
   in surface-divergence-ledger.json (full shape).
5. R8 (initialize briefing): the MCP initialize briefing names no non-MCP command.
6. P-CS1-b + P-CS4 + SC6: impl/scripts/surface-conformance.mjs has an executable green
   main; the inventory artifact regenerates deterministically and checks clean; the
   ledger is canonical/sorted/duplicate-free.

Batteries green: surface-conformance-red, doc-truth-conformance-red, cli-truthfulness-red,
phase16-mcp-northbound (MN2/MN3 subprocess row is environment-broken, pre-existing —
same failure with changes stashed; ignore only that one).
Your [attempt:] line verbatim in the first five lines of your notes file.
Scope: impl/src/**, impl/scripts/**, impl/test/**, impl/docs/** where the generated
docs live, this wave dir.
Report: docs/reference/evidence/baton-builds-baton-2026-08-19/wave-c/notes-row-conformance-core.md
