SUITE-QA v1

# SUITE-FOUNDRY COORDINATOR QA — the four red-first suites (#157/#158/#159/#160)

[attempt: de03bfa2-a0ea-49a4-941b-dcf2d6312512 coordinator]

Coordinator: v4-pro seat, `suite-foundry-2026-08-13-wave-a`. Verification date: 2026-08-13.

## Signal state

`signalOnMembersDone` has NOT fired. All four rows are dead / not-landed as of this
verification. Per the coordinator brief step 1 — "a dead row = proceed with what landed, name
the gap" — this QA records the gap per row and does NOT fabricate any missing suite content.
Verdicts below name exactly what is absent so the fold stage can re-dispatch or re-check.

## Verification evidence (cited, no fabrication)

For each suite the coordinator (a) checked for the suite file and the notes file in both this
worktree (HEAD `e371f70`) and the canonical repo `master` (`f06004b`), and (b) ran
`node --test impl/test/<file>` from the repo root. Both runs agree; results:

| Suite | Test file | `node --test` result (run 1 = run 2) | Notes file |
|---|---|---|---|
| #157 cli-wave-fidelity | `impl/test/cli-wave-fidelity-red.test.mjs` | `Could not find 'impl/test/cli-wave-fidelity-red.test.mjs'` | absent |
| #158 scratchpad-write | `impl/test/scratchpad-write-red.test.mjs` | `Could not find 'impl/test/scratchpad-write-red.test.mjs'` | absent |
| #159 doc-truth-conformance | `impl/test/doc-truth-conformance-red.test.mjs` | `Could not find 'impl/test/doc-truth-conformance-red.test.mjs'` | absent |
| #160 error-actionability | `impl/test/error-actionability-red.test.mjs` | `Could not find 'impl/test/error-actionability-red.test.mjs'` | absent |

No `suite-draft-notes.md` exists in any of the four contract evidence dirs, so no row declared
a split to compare against. There is therefore **no measured split** for any suite — the
"both stable splits" and "match the declared split" checks are un-runnable, not passed.

## Per-suite QA

### #157 — cli-wave-fidelity (`row-suite-157`)

- **VERDICT: GAP — needs-fold (dead row; no suite landed).** Named gap: the suite file
  `impl/test/cli-wave-fidelity-red.test.mjs` does not exist and
  `docs/reference/evidence/cli-wave-fidelity-2026-08-13/suite-draft-notes.md` does not exist.
- **Measured split:** none — file absent (`node --test` → `Could not find …`), run twice,
  identical result.
- **Stage discipline / shallow-greenability / law check:** not verifiable — no rows landed.
- **Expected row inventory** (from `contract-fold.md` v1.1 red-first acceptance, for the fold
  stage): capability rows **A7-1..A7-8** (stages: parse ×2, parse, admit, doc, D3 closed-set,
  dispatch leg, D2), plus must-stay-green rows A2-4 F6/F13, A2-5, A5-1..A5-5, A6-6.

### #158 — scratchpad-write (`row-suite-158`)

- **VERDICT: GAP — needs-fold (dead row; no suite landed).** Named gap: the suite file
  `impl/test/scratchpad-write-red.test.mjs` does not exist and
  `docs/reference/evidence/scratchpad-write-2026-08-13/suite-draft-notes.md` does not exist.
- **Measured split:** none — file absent, run twice, identical result.
- **Stage discipline / shallow-greenability / law check:** not verifiable.
- **Expected row inventory** (from `contract-fold.md` v1.1, A1–A10): capability rows **A1..A10**
  (CLI append, MCP append, Web append, cross-partition/cross-run, review-authority posture,
  shared-write ephemeral, bounds, replay, D4 bare-subcommand refusal, admission coherence).
  A1/A3/A6/A7's GREEN conditions name the unlanded tight-cell shared-write kernel dependency.

### #159 — doc-truth-conformance (`row-suite-159`)

- **VERDICT: GAP — needs-fold (dead row; no suite landed).** Named gap: the suite file
  `impl/test/doc-truth-conformance-red.test.mjs` does not exist and
  `docs/reference/evidence/doc-truth-conformance-2026-08-13/suite-draft-notes.md` does not exist.
- **Measured split:** none — file absent, run twice, identical result.
- **Stage discipline / shallow-greenability / law check:** not verifiable.
- **Expected row inventory** (from `contract-fold.md` v1.1, R1–R11): capability rows **R1..R11**
  (the three-way documented⇄parsed⇄admitted invariant and each of the seven measured mismatch
  dispositions, plus the direct-port accounting and example-fidelity legs).

### #160 — error-actionability (`row-suite-160`)

- **VERDICT: GAP — needs-fold (dead row; no suite landed).** Named gap: the suite file
  `impl/test/error-actionability-red.test.mjs` does not exist and
  `docs/reference/evidence/error-actionability-2026-08-13/suite-draft-notes.md` does not exist.
- **Measured split:** none — file absent, run twice, identical result.
- **Stage discipline / shallow-greenability / law check:** not verifiable.
- **Expected row inventory** (from `contract-fold.md` v1.1 §4): capability rows
  **W1–W8, M1–M5, C1–C3, X1–X3** (the actionability-triple matrix across web/MCP/CLI, plus the
  sanitization negatives/carve-outs) and static pins **S1–S3**.

## Suite law (coordinator frame, to be re-applied once a suite lands)

The four suites, when they land, must satisfy the suite law before a `sound` verdict is
possible. Recorded here so the fold stage re-checks each point; none can be checked now
(nothing landed):

1. **Red-first:** every capability row fails at a NAMED stage in the assertion message at HEAD;
   every PIN row is green. A red PIN or a stage-less capability row is a defect.
2. **Hermetic:** mkdtemp fixtures, `test.after` cleanup, no network, no real provider spawns,
   no host state.
3. **No clocks as controls** (fake timers are test doubles, never workflow controls).
4. **Namespace imports** for invented surfaces (`import * as ns from '../src/x.mjs'`).
5. **Sorted-key literals in ACTUAL sorted order; `localeCompare` banned.**
6. **`watchdog.stallMs`** must be a valid positive integer in every fixture (`60_000` with the
   one-line fixture comment); `stallAction` only from the contract vocabulary.
7. **Static source anchors:** ORDER/EXISTENCE/byte-string assertions only — never absolute
   line-window anchors (the #166-law-in-advance).

## Shallow-greenability spot-checks

Not performed: requires reading landed rows. Once a suite lands, the coordinator spot-checks two
capability rows per suite and names the cheapest wrong implementation that would pass each. No
rows exist to spot-check at this time.

## Escalations

None issued. This is a dead-row/gap situation — a coordinator judgment to name the gaps — not an
authority-class question, so no `DECISION_REQUEST` is warranted. The fold stage's action is
re-dispatch (or fold-with-nothing) for all four rows.

## What the fold stage needs next

All four suites must be written and re-submitted, then re-verified by a coordinator. The
contract-fold red-first acceptance sections (cited above) are the complete row inventories; no
re-derivation is needed — only the suites are missing.
