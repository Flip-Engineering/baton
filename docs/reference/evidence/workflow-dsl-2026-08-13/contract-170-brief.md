# #170 CONTRACT BRIEF — the workflow-spec DSL (line-oriented authoring surface over the closed spec)

PRIORITY: HIGH (operator, 2026-08-13). You are drafting the implementation contract for issue
#170: a small line-oriented DSL that lowers to the EXACT closed #114 spec — the interpreter's
`admitSpec` input stays the IR; the DSL is the authoring surface. The operator's asks (twice):
"a scripted-dynamic workflow through the baton surface — a DSL or literally anything better
than this one-off ad-hoc."

## Read first (in order)

1. The issue: `gh issue view 170` (the sketch grammar + the design laws). The interpreter's
   closed shapes you must cover TOTALLY: `impl/src/workflow-interpreter.mjs` — `SPEC_FIELDS`,
   `MEMBER_FIELDS`, the steering field set with their exact value shapes
   (`approveOnAdvertisedPlan` bool, `nudgeOnCheckpoint {message}`, `messageOnSpawn {kind, body}`,
   `elevateWhenNotes {kinds, maxEntries}`, `answerDecisions {policy}`, `signalOnMembersDone
   {roles, message}`, the harvest `{paths: [{path, mustContain}]}`, the idempotency-key
   pattern). Every one must be expressible in the DSL or the gap is a blocker.
2. The admission + surface paths the DSL rides: `waves run <spec>` on the CLI
   (`application-cli.mjs:1327`), `waves_run` on the bus, `baton_waves_run` on MCP, and
   `runWorkflow` (spec|specPath) in-process.
3. The error-actionability law the parser obeys: `gh issue view 160` (every parse refusal
   names the field/line/expected shape).
4. The grammar doctrine: `docs/36-unified-control-grammar.md`; the suite idiom for a grammar
   lane: `impl/test/wave-grammar-red.test.mjs`.
5. The two JSON-pain witnesses: `docs/reference/evidence/contract-foundry-2026-08-13/workflow.json`
   (the foundry spec — count the repeated paths) and the #153 comment (the scope-as-string
   refusal that cost three resident restarts).

## The contract must answer

- **D1 — the grammar, closed and total.** The full line grammar (wave/member/scope/steering/
  harvest directives), the comment and continuation rules, the closed field vocabulary
  mirroring the interpreter's, and the exact lowering to the canonical spec JSON — including
  the round-trip pin (`waves.compile` emits the precise object `admitSpec` accepts).
- **D2 — the parse discipline.** The parser is a pure function of the text (no eval, no
  imports, no file reads except the explicit specPath load); every refusal carries
  `{line, field, expected}` (the #160 triple); the sniffing rule (how `waves run` tells DSL
  from JSON — first-token, honest, never guessy).
- **D3 — defaults without magic.** Wave-level `scope` default with per-member override; no
  deeper inheritance. Aliases: `flash` etc. — are harness/model aliases allowed (verify what
  the route admission accepts verbatim; if aliases exist, they are closed and named)?
- **D4 — the surfaces.** The identical DSL text accepted on CLI/bus/MCP/facade (#159
  doctrine); the generated-docs row; `waves.compile` as the inspectable seam.
- **Refusal vocabulary + red-first acceptance pins + open questions**, per campaign form.

## Laws

Ring-2 contract form; every citation verified this session (NUL discipline on
`application.mjs` + `coordination-store.mjs`); no clocks; no redesign of the interpreter's
closed spec (the DSL lowers TO it; it does not extend it). Deliverable:
`docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` ONLY.
