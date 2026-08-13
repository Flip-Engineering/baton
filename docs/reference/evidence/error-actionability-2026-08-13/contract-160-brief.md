# #160 CONTRACT BRIEF — error actionability as a gate law (the #41 pattern, enforced)

You are drafting the implementation contract for issue #160: every refusal on every surface
carries (a) the typed code, (b) the offending field/class where one exists, (c) a next action
or graceful path — and the conformance gate PROVES it, so a refusal shipped without the
triple fails the suite.

## Read first (in order)

1. `docs/reference/evidence/control-surface-audit-2026-08-13/control-surface-audit.md` §2 #2
   (the measured destruction inventory) + the three row reports' error-quality sections.
2. The issue: `gh issue view 160`. The pattern source: `gh issue view 41`.
3. The transport edges where detail dies TODAY (verify each, cite file:line): the web
   `dispatchFailure` swallow families (incl. the `workflow_*` → generic 400 mapping,
   `web-northbound.mjs`); the MCP `validateArguments` catch + the `stateFailureCode`
   allowlist (`mcp-northbound.mjs`); `_authorize`'s four-precondition collapse to 403
   (`application.mjs:3215` area); the CLI's `cli_transport_failed` swallow
   (`application-cli.mjs:1924`).
4. The conformance machinery this rides: `impl/scripts/surface-conformance.mjs` +
   `impl/scripts/surface-divergence-ledger.json` (how novel divergence is detected today).
5. Idioms for the suite: `impl/test/control-surface-truth-red.test.mjs`.

## The contract must answer

- **D1 — the actionability triple, closed.** The exact shape of a compliant refusal per
  surface (code / field-or-class / next-action), with the sanitization law (never values,
  never secrets — the #41 sanitization posture) and the honest-absence case (some refusals
  HAVE no field — name the class honestly instead).
- **D2 — the refusal-family inventory.** The closed family list per surface (the validator
  refusals, the dispatch swallows, the authorize collapse, the transport failures, the
  workflow_* family, the coaching size family) — each mapped to its current destruction
  point and its compliant target shape.
- **D3 — the conformance enforcement.** How the gate proves it: a red-first suite driving
  each refusal family on each transport asserting the triple (the suite's invented seams),
  PLUS the static side (a scanner over the transport-edge catch sites — shape-only per the
  scanners law). Where the check lives (suite vs conformance main).
- **D4 — the repair inventory.** The named destruction points become the fix list (each with
  its exact repair), sequenced so the suite flips green family-by-family.
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form (ground truths → decisions → refusal vocabulary → red-first acceptance →
open questions); every citation verified this session (NUL discipline: `grep -an`/`sed -n` on
`application.mjs` + `coordination-store.mjs`); no clocks; no redesign of what the audit found
SOUND. Deliverable: `docs/reference/evidence/error-actionability-2026-08-13/error-actionability-contract.md`
ONLY.
