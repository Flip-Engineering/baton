# #157 CONTRACT BRIEF — CLI wave ghosts + interpreter-wave registry fidelity

You are drafting the implementation contract for issue #157: two surface-honesty defects in
one lane. (a) `waves.send` and `waves.stop` are CLI ghost rows — the registry/docs claim
them, the parser refuses them; web and MCP carry both. (b) The wave registry projection
under-reports interpreter-run (`waves.run`) waves: `waves list` shows roster entries with
null phase/progressClass for interpreter members (observed live on the #147 wave), while
driver-launched waves project correctly.

## Read first (in order)

1. The issue: `gh issue view 157`. The audit evidence: `docs/reference/evidence/
   control-surface-audit-2026-08-13/surface-audit-cli.md` (§1.2, §6 F-3) and the live
   registry record (the #147 wave's null-phase roster — the audit synthesis §1.3 carries the
   table).
2. The CLI parse side: `impl/src/application-cli.mjs` — the `waves` branch (the closed set
   list/progress/start/attach/run + its refusal), and the input schemas that ALREADY exist
   for send/stop (find them — the audit says the schemas exist and only the parse branches
   are missing).
3. The registry fidelity side: the wave registry fold (`coordination-store.mjs`
   `wave.started` fold, `grep -an`) vs the interpreter's member admission path
   (`workflow-interpreter.mjs` — how its members register, or don't, with the registry
   projection). The D3 seat-map row just landed (#74): the interpreter-seam route recovery
   rides the steering-registered record — the null-phase gap is its neighbor.
4. Idioms: `impl/test/wave-observability-red.test.mjs` (the registry's own suite).

## The contract must answer

- **D1 — the CLI wave verbs, complete.** `baton waves send` / `baton waves stop` parse
  branches using the existing schemas; the closed-set refusal updated; the generated docs
  row (#142 — regenerate, never hand-edit).
- **D2 — the registry fidelity law.** An interpreter-run wave's members project phase +
  progressClass identically to driver waves (or the projection honestly says why it can't —
  choose; the answer is almost certainly "project them" since the member runs exist in the
  same store). Pin where the hydration happens.
- **D3 — the ghost-prevention pin.** A row proving every documented CLI wave verb parses AND
  dispatches (the #159 doctrine's CLI instance).
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline on
`application.mjs` + `coordination-store.mjs`); no clocks. Deliverable:
`docs/reference/evidence/cli-wave-fidelity-2026-08-13/cli-wave-fidelity-contract.md` ONLY.
