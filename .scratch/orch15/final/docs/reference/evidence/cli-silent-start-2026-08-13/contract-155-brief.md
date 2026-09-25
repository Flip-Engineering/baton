# #155 CONTRACT BRIEF — kill the CLI silent reinterpretation (unknown `run <verb>` → run.start)

You are drafting the implementation contract for issue #155: the CLI routes any unrecognized
`run <verb>` into `parseStart`, so `baton run shwo` compiles a real `run.start` with `"shwo"`
as the objective — a typo on the operator surface launches a real Run with real provider
spend (`application-cli.mjs:1578` area, per the #147 audit's `surface-audit-cli.md` §3 E-1).

## Read first (in order)

1. The issue: `gh issue view 155`. The audit evidence:
   `docs/reference/evidence/control-surface-audit-2026-08-13/surface-audit-cli.md` (§3 E-1,
   §6 F-1 — the ranked finding) and the synthesis §2 #3.
2. The parse seam: `impl/src/application-cli.mjs` — the `run` branch's fall-through into
   `parseStart` (cite the exact lines, verified this session), and the CONTRAST: the `waves`
   branch's refusal (`cli_command_unavailable` naming the closed subverb set — the model to
   mirror, `:1384` area).
3. The CLI grammar's own law sources: `impl/CLI.md` (the generated verb inventory the
   refusal must match), the parse-tests idiom (`grep -ln "parseBatonCli" impl/test/*.mjs` —
   read one for fixture style).
4. `docs/36-unified-control-grammar.md` — the grammar doctrine this belongs to.

## The contract must answer

- **D1 — the closed verb set + the refusal.** The exact `run` subverb inventory at HEAD
  (verify against the parser, not the doc), the refusal shape (`cli_command_unavailable`
  naming the closed set, mirroring the `waves` branch byte-style), and the exit-code
  consequence (the audit's F-8 taxonomy note — which bucket does this land in, and is that
  consistent?).
- **D2 — the legitimate-free-text boundary.** `run start`-style invocations with a real
  objective keep working byte-identically — where exactly is the line between "verb
  position" and "objective text"? (The parser's own grammar decides; pin it.) Any
  compatibility alias that MUST keep parsing (check the alias map) is named.
- **D3 — the surface-teaching half.** The refusal teaches: the closed set + the nearest
  suggestion where one exists (edit-distance-1 only, never a guess) — or explicitly defer the
  suggestion half with a stated reason.
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session; no clocks; no redesign of what
the audit found SOUND. Deliverable:
`docs/reference/evidence/cli-silent-start-2026-08-13/cli-silent-start-contract.md` ONLY.
