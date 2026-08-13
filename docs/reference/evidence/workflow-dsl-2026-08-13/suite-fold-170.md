[attempt: 289f9cf0-8413-4888-8632-0b5292555e3e suite-fold-170]
# suite-fold-170 — the blue-team §4 fold of the #170 workflow-DSL red-first suite

Date: 2026-08-13 · Target: `impl/test/workflow-dsl-red.test.mjs` (in place) · Authority:
`docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (v2 FOLDED — governs on
conflict) · Blue-team: `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-170.md` §4 (7
instructions) · Fold law: RED honesty preserved, split-twice, the suite's own `[attempt: …]` header
line untouched, suite law holds (hermetic, no clocks, no absolute line-window anchors, sorted-key
literals, `localeCompare` banned).

## The fold — instruction → resolution map

| # | Blue-team §4 instruction | Resolution | Suite anchor |
|---|---|---|---|
| 1 | add the `answerDecisions` behavioral row (incl. the repeatable-accumulation leg) | **FOLDED** — new capability row `[answerDecisions]`: compiles `answerDecisions "q1" "opt1"` + `answerDecisions "q2" "opt2"` (a second repeat) and asserts `steering.answerDecisions.policy` deep-equals `{q1:'opt1', q2:'opt2'}` — accumulation, never overwrite. RED at `workflow_dsl_compile_missing`. | `[answerDecisions]` |
| 2 | add the symlink-escape row (pins the B3 gating itself) | **FOLDED** — new capability row `[symlink-escape]`: `symlinkSync(outside, join(repoRoot,'escape'))`; `harvest escape` refuses `workflow_harvest_invalid` (code + line 2 + field `harvest.paths[0]`) with `repoRoot`, and compiles to `{path:'escape'}` when `repoRoot` is omitted (lexical-only pass). RED at `workflow_dsl_compile_missing`. | `[symlink-escape]` |
| 3 | resolve the S5 shared-module drift | **FOLDED (accept)** — S5 now branches: **inline form** → byte-compare all four constants (`IDEMPOTENCY_PATTERN`, `MAX_MEMBERS`, `MESSAGE_KINDS`, `SCRATCHPAD_KINDS`) to the interpreter; **shared-module form** → assert the compiler references all four names AND imports `IDEMPOTENCY_PATTERN` from a shared closed-constants module that the interpreter ALSO imports (single-source, so the byte-equal leg holds by construction). Acceptance preferred — the contract S5 sanctions both forms. | S5 |
| 4 | repair P6's facade leg | **FOLDED** — replaced the over/under-broad `/\bcompile\s*:/` with `/waves[\s\S]{0,400}compile/`, scoped to the `waves` accessor and accepting both the property (`compile: …`) and method-shorthand (`compile(text) {}`) spellings. | P6 |
| 5 | widen R1 to 2–3 distinct unknown-directive names | **FOLDED** — R1 drives `memberr`, `harnes`, `signalOnMembersDonee`, each asserted in `field` with the SAME closed-list `expected: '<closed directive list>'` (kills a single-token hardcode). | R1 |
| 6 | add the compiler-source code-family scan (PIN-B twin) | **FOLDED** — new capability row `[compiler-code-family]`: every `'workflow_*'` literal in `workflow-dsl.mjs` is within the closed 5-code family (no 6th code), and the four admission codes the R-rows pin must be present. RED at `workflow_dsl_compile_missing`. | `[compiler-code-family]` |
| 7 | probe the bare `harvest <path>` form and the explicit `false` steering forms | **FOLDED** — new capability row `[steering-harvest-variants]`: `approveOnAdvertisedPlan false` / `claimOnStall false` lower to `false` (not the bare `true` default); `harvest reports/a.md` emits `{path}` (no `mustContain`); `harvest … mustContain "B"` emits `{path, mustContain}`. RED at `workflow_dsl_compile_missing`. | `[steering-harvest-variants]` |

## Judgment calls (recorded)

1. **Symlink-escape `expected` leg is shape-pinned, not literal-pinned.** The contract §3 pins
   `expected: 'non-empty path in the repo path class'` for the LEXICAL path-class escape only
   (NUL/absolute/backslash/`..`); the realpath containment (D1/D2/B3) is a separate check with no
   distinct `expected` literal in the contract. The row pins `code`/`line`/`field` exactly and asserts
   the triple SHAPE (non-empty `expected` + `detail === {line, field, expected}`) rather than inventing
   a contract string the impl was never asked to produce. (The interpreter's own phrasing is
   "resolves outside the repository root (symlink escape)" — `workflow-interpreter.mjs:325`.)
2. **S5 shared-module acceptance.** In the shared-module form the byte-compare leg is unprovable from
   the compiler source alone (the constants live in the shared module), so the row proves single-source
   instead: the compiler imports `IDEMPOTENCY_PATTERN` from a module path the interpreter ALSO contains
   (both live in `impl/src/`, same relative path). All four constant NAMES must still be referenced by
   the compiler. This aligns the suite with the contract's "OR both modules import one shared
   closed-constants module" — no contract text was struck or rewritten.
3. **Compiler code-family scan positive leg.** Beyond the blue-team's negative "no 6th code" ask, the
   row asserts the four admission codes are present so a silent compiler (zero `workflow_*` literals)
   cannot pass vacuously. `workflow_objective_ref_invalid` stays in the allowed family (interpreter
   render-time; the compiler never emits it) — allowed, not required.
4. **watchdog.stallMs 60_000 — N/A.** The suite (and all four new rows) is fully synchronous
   (`mkdtempSync`/`symlinkSync`/`rmSync`, no timers, no awaited I/O beyond the dynamic import), so no
   stall watchdog is introduced; the blue-team's own law re-check (§2) reached the same conclusion for
   the suite as it stood.
5. **Preserved the suite's `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]` header line
   verbatim** (suite law) — only the ROW INVENTORY and SPLIT RECORD comments were updated to reflect the
   four new rows and the new totals.

## Split record (split-twice, from the repo root, after the fold)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 35 | 5 | 30 | 5 PIN rows green; 30 capability rows red |
| Run 2 | 35 | 5 | 30 | identical split (stable) |

Baseline before the fold: **31 tests, 5 pass / 26 fail.** The fold adds 4 capability rows (all RED at
`workflow_dsl_compile_missing`) and keeps the 5 PIN rows green — no row became greenable; every
capability row still fails at a named stage.

## RED honesty

Every new row is RED at HEAD at the named stage `workflow_dsl_compile_missing` (the compiler module
`impl/src/workflow-dsl.mjs` is absent); the 5 PIN rows remain green at their named stages. The fold
hardens the suite (behavioral `answerDecisions`, B3 containment, compiler code-family) without greening
any row.

## Escalations

None. No authority-class ambiguity arose: all seven blue-team §4 instructions were concrete, and the
one accept-vs-strike choice (S5) was pre-resolved by the brief itself ("Prefer acceptance; the contract
sanctions both forms") — accepted, not escalated.

## Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
