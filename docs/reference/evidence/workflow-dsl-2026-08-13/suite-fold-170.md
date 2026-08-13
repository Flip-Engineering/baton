[attempt: 9a41555b-7511-4937-9e10-ae29e227eea8 suite-fold-170]
# suite-fold-170 — instruction → resolution map (the #170 DSL suite harden per blueteam-170.md §4)

Date: 2026-08-13 · Target: `impl/test/workflow-dsl-red.test.mjs` (in place) · Authority: `workflow-dsl-contract.md` v2 FOLDED · Blue-team: `blue-team-2026-08-13-b/blueteam-170.md` (7 fold instructions in its §4, all applied).

## 0. What this fold did

Applied all seven `blueteam-170.md` §4 instructions to the suite, in place. Four NEW capability rows
(P11 answer-decisions, P12 symlink-escape, P13 bare-harvest/false-steering, S6 code-family scan) and
three repairs (R1 widened, P6 facade scoped, S5 shared-module accepted). RED honesty preserved: every
new row fails at HEAD at the named stage `workflow_dsl_compile_missing` (the compiler module
`impl/src/workflow-dsl.mjs` is absent), the 5 PIN rows stay green, and the repaired rows stay red at
their named stages. The verbatim suite header line `[attempt: ea57954b-95c1-4918-a494-41b0249738ee
row-suite-170]` is untouched.

## 1. Measured splits (split-twice, run from the repo root)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 35 | 5 | 30 | 5 PIN rows green; 30 capability rows red (26 original + 4 new) |
| Run 2 | 35 | 5 | 30 | identical split (stable) |

Baseline before the fold was 31 · 5/26 (per `suite-draft-notes.md` and the suite's own declared
record). The fold adds 4 red capability rows — 35 · 5/30, no PIN row moved, no green row appeared.

## 2. Instruction → resolution map

1. **`answerDecisions` behavioral row** (finding 1) — **DONE.** New `P11 capability [answer-decisions]`
   compiles `answerDecisions "q1" "opt1"` + a second `answerDecisions "q2" "opt2"` and asserts
   `ir.steering.answerDecisions` deep-equals `{ policy: { q1: 'opt1', q2: 'opt2' } }` — the
   repeatable-accumulation leg. The totality claim is now behavioral (fed through `compileWavefile`),
   not registry-only (P4 lists the name; P11 proves the lowering). RED at `workflow_dsl_compile_missing`.

2. **Symlink-escape row** (finding 2) — **DONE.** New `P12 capability [symlink-escape]` creates a
   `harvest` path that is a symlink resolving outside `repoRoot`. With `repoRoot` provided it asserts
   `workflow_harvest_invalid` (line 8, `field: 'harvest.paths[0]'`); with `repoRoot` omitted the same
   text compiles clean (`harvest.paths` deep-equals `[{ path: 'escape' }]`). This is the ONLY pin that
   exercises B3's realpath containment (S1's static disjunction cannot). RED at `workflow_dsl_compile_missing`.

3. **S5 shared-module drift** (finding 3) — **DONE (accepted, per the contract).** S5 now detects the
   form: if the compiler carries an inline `=` assignment for any closed constant, it asserts
   byte-identity with the interpreter's inline declarations (as before); otherwise it accepts the
   shared-module form by asserting the compiler source names `IDEMPOTENCY_PATTERN`, `MAX_MEMBERS`,
   `MESSAGE_KINDS`, `SCRATCHPAD_KINDS` (an import). The contract sanctions both forms (S5 / OQ2), so
   acceptance is the contract-faithful choice; the "strike the alternative" horn was rejected. RED at
   `workflow_dsl_compile_missing`.

4. **P6 facade leg repair** (finding 4) — **DONE.** The facade assertion is now
   `/waves[\s\S]{0,400}compile/u` — scoped to the `waves` accessor and accepting both property
   (`compile:`) and method-shorthand (`compile(text) {}`) spellings. The old `/\bcompile\s*:/u` was
   over-broad (any `compile:` anywhere) and under-broad (missed shorthand). Still red at
   `surfaces-parity-cli` (the first failing surface leg).

5. **R1 widen** (finding 5) — **DONE.** R1 now drives three distinct unknown names — `memberr`,
   `harnes`, `signalOnMembersDonee` — each asserted with `field: <name>` and the same closed-list
   `expected: '<closed directive list>'`. A single-token special case can no longer green the row. RED
   at `workflow_dsl_compile_missing`.

6. **Compiler-source code-family scan** (finding 6) — **DONE.** New `S6 capability [code-family]`
   extracts every `workflow_*` string literal from the compiler source and asserts each is within the
   closed 5-code family — the compiler-facing twin of PIN-B (whose negative leg scans the interpreter,
   not the compiler). See the judgment call below for the `workflow_objective_ref_invalid` leg. RED at
   `workflow_dsl_compile_missing`.

7. **Bare-harvest + false-steering probe** (finding 7) — **DONE.** New `P13 capability
   [harvest-steering-forms]` compiles `approveOnAdvertisedPlan false`, `claimOnStall false`, and a bare
   `harvest reports/out.md`, asserting the two `false` booleans and `harvest.paths` deep-equals
   `[{ path: 'reports/out.md' }]` (no `mustContain` key). RED at `workflow_dsl_compile_missing`.

## 3. Judgment calls + conflict resolutions (recorded)

- **S5 (contract governs).** The blue-team's finding 3 offered "accept the shared form OR strike it";
  the contract sanctions BOTH forms, so the shared form is accepted, not struck. The detection
  (`/(?:IDEMPOTENCY_PATTERN|MAX_MEMBERS|MESSAGE_KINDS|SCRATCHPAD_KINDS)\s*=/` present → inline, else
  shared) treats the two forms as all-or-nothing; a mixed impl (some inline, some imported) is treated
  as inline and must satisfy byte-identity for all four, so it is still rejected — no drift escapes.
  The "both modules import the SAME shared module" claim is not byte-verified (no shared-module
  filename is pinned by the contract); the shared branch is a name-presence source-scan, which is
  exactly the blue-team's fix text.

- **S6 render-time leg (contract governs).** The blue-team said "within the closed 5-code family"; the
  contract §3 additionally says the render-time code `workflow_objective_ref_invalid` is NOT emitted by
  the compiler (objectiveRef existence/containment/byte-bound stay at the interpreter's render). S6
  therefore asserts the compiler's literals ⊆ the 5-code family AND adds the negative leg
  `!src.includes("'workflow_objective_ref_invalid'")`. The 5-family check honors the instruction; the
  negative leg honors the contract (which governs). The string-inclusion negative leg inherits the same
  comment-false-positive risk PIN-B already accepts — consistent precedent.

- **P12 symlink-escape `expected` leg.** The contract pins the CODE (`workflow_harvest_invalid`) and
  the gating (with/without `repoRoot`) but §3 names only the lexical path-class `expected`
  (`'non-empty path in the repo path class'`) — the realpath symlink-escape `expected` is unspecified.
  The row pins `code`, `line`, and `field: 'harvest.paths[0]'` exactly and the `expected` leg loosely
  (`/outside|escape|contain|repo/u`); the gating legs (refusal-with-repoRoot / compiles-without) carry
  the B3 proof, and a compiler that skips the containment check fails the `assert.ok(caught)` leg.

- **Watchdog (`stallMs 60_000`).** N/A — the suite (including the four new rows) is fully synchronous
  (no timers, no awaited I/O beyond the dynamic compiler import), so no stall watchdog is dead code.
  Consistent with the blue-team's own §2 law re-check note.

- **Row naming.** New behavioral/emission rows land in the P-series (P11/P12/P13) and the new static
  source-scan row in the S-series (S6), keeping P = emission/gating, R = refusal, S = source-scan.

## 4. RED honesty

Every capability row — original and new — fails at HEAD at a named stage: the 30 compiler-dependent
rows at `workflow_dsl_compile_missing`, the 6 surface/registry/source-scan rows (P6/P8/P9/P10/OQ6/R10)
at their own named stages, and the 5 PIN rows green at `interpreter-json-only`,
`closed-refusal-vocabulary`, `closed-field-sets`, `schemaVersion-fixed`, `mcp-lane-crafted-detail`.
No fold edit made any row green at HEAD; the fold only widened the teeth.

## 5. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```

## 6. Incremental pass — re-verification (same worktree, clean working tree)

Re-run after the fold was written, on the clean two-deliverable working tree. Split-twice again, plus a
stage audit of every failing row.

### 6.1 Measured splits (fresh)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

| Run | tests | pass | fail |
|---|---|---|---|
| Run 1 | 35 | 5 | 30 |
| Run 2 | 35 | 5 | 30 |

Identical to the §1 record — the fold is stable and deterministic.

### 6.2 RED-honesty stage audit (every row at its named stage)

- **5 PIN rows green** — `interpreter-json-only`, `closed-refusal-vocabulary`, `closed-field-sets`,
  `schemaVersion-fixed`, `mcp-lane-crafted-detail`.
- **24 capability rows red at `workflow_dsl_compile_missing`** — P1–P5, P7, P11, P12, P13, R1–R9,
  S1–S6 (the compiler module is absent).
- **6 capability rows red at their own named stage** — P6 `surfaces-parity-cli`, P8
  `generated-docs-render`, P9 `mcp-triple-specDsl`, P10 `web-triple-specDsl`, OQ6
  `registry-seam-compile-row`, R10 `head-seam-compile`.

24 + 6 = 30 red rows; none red for the wrong reason; no new green row.

### 6.3 Seven-instruction status (re-confirmed)

1. P11 `[answer-decisions]` behavioral + repeatable-accumulation — present, red.
2. P12 `[symlink-escape]` B3 gating (refusal-with-repoRoot / compiles-omitted) — present, red.
3. S5 shared-module form accepted — present, red.
4. P6 facade scoped to `/waves[\s\S]{0,400}compile/u` — present, red.
5. R1 widened to `memberr`/`harnes`/`signalOnMembersDonee` — present, red.
6. S6 compiler code-family scan (+ contract §3 render-time negative leg) — present, red.
7. P13 bare-`harvest` + `false`-steering forms — present, red.

All seven landed; the sacred `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]` header
line remains verbatim.
