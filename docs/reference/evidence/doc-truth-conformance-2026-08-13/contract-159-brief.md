# #159 CONTRACT BRIEF — doc-truth ↔ admission conformance (the class-killer)

You are drafting the implementation contract for issue #159: the generated surface docs teach
verbs the parsers/admission refuse, and the conformance gate compares renderer output to
committed docs but NEVER compares inventory to admission. The defect inventory is measured:
`run watch` advertised-but-dead; a stale `run steer` doc row; `CLI_WEB_COMMANDS` whitelisting
facade ports the web refuses; MCP `initialize` pointing at the non-MCP `context.briefing`;
`{decision}` advertised-but-refused by `applicationAnswerSchema`; `MCP.md` wave examples
omitting the required `repoId`; `webBusNames()` undercounting the direct-port wave verbs
(`surface-conformance.mjs:378-384` derives web from `APPLICATION_COMMAND_DEFINITIONS` only).

## Read first (in order)

1. The issue: `gh issue view 159`. The audit: `docs/reference/evidence/
   control-surface-audit-2026-08-13/control-surface-audit.md` §2 #7 + §1.4 (the
   reconciliation notes — the undercount instance that skewed a row's conclusion).
2. The conformance machinery: `impl/scripts/surface-conformance.mjs` (collect, classify,
   the divergence ledger), `impl/scripts/render-surface-docs.mjs` (the generated blocks),
   `impl/scripts/surface-inventory-artifact.json` (the committed artifact).
3. The three admission sources of truth: `web-northbound.mjs` (WAVE_WEB_ENTRIES +
   APPLICATION_COMMAND_DEFINITIONS + the web admit map), `application-cli.mjs`
   (CLI_WEB_COMMANDS + the parser branches), `mcp-northbound.mjs` (the tool allowlist).
4. The #153 instance (the wave that caught one): `gh issue view 153` + its comment (the
   three follow-ons).
5. Idioms: `impl/test/control-surface-truth-red.test.mjs`, `impl/test/wave-grammar-red.test.mjs`.

## The contract must answer

- **D1 — the three-way invariant.** Documented ⇄ parsed ⇄ admitted, per surface: every
  documented verb parses and admits; every admitted verb is documented; every parser branch
  either admits or refuses with the closed-set naming. Where the check lives (the
  conformance main vs a suite) and how it derives each side mechanically (no hand-maintained
  lists — that is today's bug).
- **D2 — the direct-port accounting.** The web inventory must count the direct-port verbs
  (WAVE_WEB_ENTRIES and kin) — fix `webBusNames()`'s derivation or add the second source;
  the contract picks and says why.
- **D3 — the measured mismatches become the fix list.** Each of the seven named instances
  (above) gets its disposition: wire it, retire it, or document the refusal — with the
  red-first pin that keeps it fixed.
- **D4 — MCP.md/CLI.md example fidelity.** Examples in generated docs must be executable
  shapes (the missing `repoId` class) — how the renderer/conformance proves that.
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline on
`application.mjs` + `coordination-store.mjs`); no clocks. Deliverable:
`docs/reference/evidence/doc-truth-conformance-2026-08-13/doc-truth-conformance-contract.md`
ONLY.
