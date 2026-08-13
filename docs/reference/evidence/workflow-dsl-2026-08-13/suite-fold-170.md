[attempt: 06a967c7-ad7a-4289-9282-93589fde47d2 suite-fold-170]
# #170 suite-fold — the blue-team hardening fold (single-member wave)

- **Row:** `suite-fold-170`. Frame: the seven §4 fold instructions in
  `docs/reference/evidence/blue-team-2026-08-13-b/blueteam-170.md`, applied to
  `impl/test/workflow-dsl-red.test.mjs`. Authority for intent:
  `docs/reference/evidence/workflow-dsl-2026-08-13/workflow-dsl-contract.md` (v2 FOLDED).
- **Verification HEAD:** this worktree's `e371f70` (the suite's own declared HEAD). The suite,
  blue-team report, and contract were materialized from `master` into this worktree for the fold;
  the compiler module `impl/src/workflow-dsl.mjs` remains ABSENT (RED-first preserved).
- **Sacred header:** the suite's verbatim line 2
  `[attempt: ea57954b-95c1-4918-a494-41b0249738ee row-suite-170]` is UNTOUCHED. This file carries
  this fold's own attempt line (line 1, above).

---

## 0. Split record (split-twice, re-run AFTER the edits, from the repo root)

```
node --test impl/test/workflow-dsl-red.test.mjs
```

| Run | tests | pass | fail | Result |
|---|---|---|---|---|
| Run 1 | 35 | 5 | 30 | 5 PIN rows green (PIN-A…PIN-E); 30 capability rows red |
| Run 2 | 35 | 5 | 30 | identical split (stable) |

Pre-fold the split was 31 · 5/26. The fold adds four RED capability rows (P11 answerDecisions,
P12 symlink-escape, P13 false-steering + bare-harvest, S6 compiler code-family) — 31 → 35 rows,
5/26 → 5/30. All 30 red rows fail at their named stages: the 24 compiler-dependent rows
(P1–P5, P7, P11–P13, R1–R9, S1–S6) at `workflow_dsl_compile_missing`, and the 6
surface/registry/source-scan rows (P6 `surfaces-parity-cli`, P8 `generated-docs-render`,
P9 `mcp-triple-specDsl`, P10 `web-triple-specDsl`, OQ6 `registry-seam-compile-row`,
R10 `head-seam-compile`) at their own stages. **RED honesty preserved: no capability row went
green; the five PIN rows stayed green.**

---

## 1. Instruction → resolution map (all seven, binding)

### 1. `answerDecisions` behavioral row → **ADDED P11**

`test('P11 capability [answerDecisions-behavioral] …')`. Compiles
`answerDecisions "q1" "opt1"` + `answerDecisions "q2" "defer"` (a repeat) and asserts
`ir.steering.answerDecisions.policy.q1 === 'opt1'`, `policy.q2 === 'defer'`, and both keys
present via `Object.keys(policy).sort()` — the repeatable-accumulation leg. The totality claim is
now behavioral (P4/S3 stay registry-level; P11 is the compile-time leg finding 1 demanded). The
`"defer"` value also exercises the contract G1 `optionId|text|"defer"` domain. RED at
`workflow_dsl_compile_missing`.

### 2. Symlink-escape row → **ADDED P12**

`test('P12 capability [symlink-escape] …')`. A `symlinkSync(outside, join(dir, 'escape-link'),
'dir')` inside `repoRoot` pointing to a sibling `mkdtemp` outside it; `harvest escape-link` is fed
through `compileWavefile(text, { repoRoot: dir })` and must throw `workflow_harvest_invalid`
(`line 2`, `field 'harvest.paths[0]`), and the SAME text must compile through
`compileWavefile(text)` (no `repoRoot`) to `harvest.paths[0] = { path: 'escape-link' }` — pinning
the B3 gating itself. Premise re-verified this session against the interpreter's `escapesRepo`
logic (a real symlink → `escapesRepo = true`; the benign `reports/a.md` → `false`). RED at
`workflow_dsl_compile_missing`. **Judgment call** — the `expected` leg is asserted only as a
non-empty string, not an exact spelling (see §2).

### 3. S5 shared-module drift → **RESOLVED by ACCEPTANCE (contract-governed)**

`test('S5 capability [constants] …')` now accepts BOTH the contract's S5 forms. The row detects
whether the COMPILER declares all four closed constants inline
(`IDEMPOTENCY_PATTERN`/`MAX_MEMBERS`/`MESSAGE_KINDS`/`SCRATCHPAD_KINDS` each followed by ` = `);
if inline, it asserts byte-identical equality to the interpreter's inline values (the desync bite
is preserved). If NOT inline, it treats the compiler as the shared-module form and asserts the four
constant NAMES are referenced/imported — there is no second source to desync against. The
contract's S5 sanctions both forms ("OR both modules import one shared closed-constants module"),
so **the contract governs: accept both, do not strike the shared-module alternative.** The
blue-team probe (a shared-module import makes the old inline regexes return `undefined` and fail)
is thereby neutralized. RED at `workflow_dsl_compile_missing`.

### 4. P6 facade leg → **REPAIRED**

The facade leg is now scoped to the accessor and accepts both spellings:
`/waves[\s\S]{0,400}compile\s*(?:\(|:)/u` — it matches `compile` within 400 chars of `waves`,
followed by `(` (method-shorthand `compile(text) {}`) or `:` (property `compile: …`). The old
`/\bcompile\s*:/` was both over-broad (any `compile:` in the file) and under-broad (missed
shorthand). Still RED at `surfaces-parity-cli` (the earlier CLI leg fails first).

### 5. R1 widening → **WIDENED to three names**

`test('R1 capability [unknown-directive] …')` now drives `['memberr', 'harnes',
'signalOnMembersDonee']`, each asserted with `field` equal to the exact token and the SAME
closed-list `expected: '<closed directive list>'`. Kills a one-token special case;
`signalOnMembersDonee` also catches a prefix-matching impl. RED at
`workflow_dsl_compile_missing`.

### 6. Compiler-source code-family scan → **ADDED S6**

`test('S6 capability [compiler-code-family] …')` — the compiler-facing twin of PIN-B. Scans
`COMPILER_PATH` for every quoted `workflow_*` literal and asserts each is within the closed 5-code
family (`workflow_spec_invalid`, `workflow_member_invalid`, `workflow_steering_unknown`,
`workflow_harvest_invalid`, `workflow_objective_ref_invalid`) — where a compiler-minted 6th code
would actually live (PIN-B scans only the interpreter). RED at `workflow_dsl_compile_missing`.

### 7. Bare-harvest + `false`-steering probes → **ADDED P13**

`test('P13 capability [steering-false-bare-harvest] …')` compiles
`approveOnAdvertisedPlan false` → `false`, `claimOnStall false` → `false`, and a bare
`harvest reports/a.md` → `{ path: 'reports/a.md' }` (no `mustContain` key). The bare-harvest shape
is also re-pinned by P12's ungated leg. RED at `workflow_dsl_compile_missing`.

---

## 2. Judgment calls recorded

- **P12 `expected` leg (symlink escape).** The contract §3 pins only the path-class `expected`
  (`'non-empty path in the repo path class'`) for `workflow_harvest_invalid`; it does NOT pin a
  spelling for the realpath symlink escape (the interpreter uses a distinct message). Pinning an
  invented spelling would risk rejecting a contract-faithful compiler. Resolution: P12 asserts the
  code, line, field, and the `detail` wire leg exactly, and asserts `expected` is a non-empty
  string only.
- **New-row naming.** P11/P12/P13 continue the behavioral green-pin series (P1–P10) and S6 the
  static source-scan series (S1–S5); both are RED capability rows at HEAD, matching the suite's
  naming idiom.
- **S5 detection threshold.** "Inline form" = all four closed constants declared inline; otherwise
  the shared-module form (names present). A mixed form (some inline, some imported) is treated as
  shared and passes the name-presence check — a permissive choice, since the byte-identical bite is
  only meaningful when there are two inline sources to compare.
- **`localeCompare` / sorted-key law.** No `localeCompare` added; new object literals are
  single-key or compared key-order-free via `deepEqual`/`.sort()` (default sort, matching the
  existing `canonicalJson`/OQ6 idiom).
- **watchdog.stallMs 60_000.** N/A — the suite remains fully synchronous (no new timers/awaited
  I/O beyond the existing dynamic import); no committed fixture was touched, so no watchdog comment
  was required.

## 3. Law re-check (post-fold)

- **Named stages** — yes; every new row carries a named stage in its name and granular `stage[…]`
  in every assertion.
- **Hermetic / no clocks** — yes; `mkdtemp` + `finally` cleanup only, no network, no `Date`.
- **No absolute line-window anchors** — yes; P6's `{0,400}` is a proximity bound (same family as
  P9's `{0,600}`), not a line anchor.
- **Sacred `[attempt: …]` line** — untouched (suite line 2).

## 4. Deployment verification

Executable `"true"`, args `[]`, cwd `"."` — expected exit 0:

```
true   →   exit 0   (verified)
```
