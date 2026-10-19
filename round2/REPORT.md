# Match-default sharing, round 2

Pinned compiler: bend.ts `93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85`,
comp.ts `a2a949ae7f1c8520d8a112aa505b4c5440baad861dc912e410bfb501369112bc`,
main.ts `53ce8e48c7540db6c3e66133a7c7eb270d6f64813fe10a631fd50d22112eb07d`,
base.bend `e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798`.
Reproducer commit `87703d2df22780f46cf16756ce2c24c3fe4b9f78`.

The candidate changes only `bend.ts` and `comp.ts` under `round2/compiler-src/bend2/`;
`main.ts`, `base.bend`, `effs/` and the bun binary are the pinned inputs.
No trace or diagnostic code remains.

## Mechanism

`bend.ts` gives every match row a stable numeric origin and tags each flattened
constructor-split default with a span shared by every split of the same fallback
row set. The term shape, row order, binder quantities, row slicing and literal
expansion are unchanged; only `Case.o` and the default's span are added.

`comp.ts` keeps a per-definition map keyed by
`(fallback origin, type key, capture layout, argument layouts)`. The first
default arm with a key is emitted as a spin whose parameters are the arm's
captured words and its scrutinees. Later arms with the same key call that spin
with their own captured words. A different type or layout creates a new key, so
no sharing crosses a type or layout boundary.

`emit_lits` treats a default arm whose fallback-origin marker equals the
already-covered default's marker as covered by that default, which stops the
per-bit-depth default leaves for one character word. The existing coverage
mapping still constructs the covered instance; the U32 table path is otherwise
untouched.

The sharing key is `(fallback origin, term_key(term_lower(default type)),
ordered capture layouts, ordered argument layouts)`. It never uses variable ids
or untyped alpha-equivalence. A different type or layout produces a different
key, so a default is not shared across a type or layout boundary.

Preserved invariants: first-row-wins row order; guard and literal exclusions;
binder quantities (`patt_mark`, `xq`, the `xs` joins); match arity and scrutinee
slicing; `emit_lits`, `lits_rows` and `emit_nats` table behavior (the U32 table
fixture checks byte-identically); character literal semantics through flat
`SCon` matching, including `IO.args`-fed dispatch.

The five-overlap fixture uses `IO.write`/`IO.die` leaves and the shape order
literal-3, 2, 13, 14, 4, error. Its own pinned baseline is 33,992,046 B /
432,223 lines; the root-reported 54,730,033 B / 600,231 lines belongs to a
different fixture body, so the two baselines are not compared directly.

## Candidate diff against the pinned compiler

`bend.ts`

- 322: `Case` gains `o?: number` (row origin).
- 2732: `body_sub` preserves `o`.
- 2747-2760: `MARK_KEYS`, `ORIGIN_MARK`, `origin_seq`; marker comment.
- 2780-2782: rows without an origin are tagged at a split.
- 2794: the variable-column path preserves `o`.
- 2818-2819: `ps` rows for constructor and variable rows preserve `o`.
- 2831-2847: fallback origins form a key; the flattened default's span is the
  shared marker for that key.

`comp.ts`

- 126-127: `File.clom`, `File.dflt`.
- 1914: `file_new` initializes them.
- 3083: `emit_lits`'s walk carries the covered default's marker.
- 3094-3114: `emit_lits` compares the default marker with the covered marker.
- 3127-3208: `emit_shared_default` (spin construction, key, call site).
- 3264-3281: `emit_match` tries the shared default for every level body.
- 3315: `compile_def` clears `clom` per definition.

## Check-only

Both compilers ran `--check-only` with `BEND_NO_TELEMETRY=1`. The outputs are
byte-identical for every fixture.

| fixture | result | output |
| --- | --- | --- |
| `round2/fixtures/five-overlap.bend` | pass | identical |
| `repro/minimal.bend` | pass | identical |
| `repro/pr890-shaped.bend` | pass | identical |
| `repro/control-two-long.bend` | pass | identical |
| `repro/control-literal-two.bend` | pass | identical |
| `tests/flatten/dead_residue_elision_004.bend` | pass | identical |
| `tests/compile/string_match_sparse.bend` | pass | identical |

## Same-source C

The pinned compiler and the candidate compiled the same file. Wall time and peak
RSS are from `/usr/bin/time -v`.

| fixture | before bytes / lines | after bytes / lines | before wall / RSS | after wall / RSS | before / after `WL_CASE` |
| --- | --- | --- | --- | --- | --- |
| five-overlap | 33,992,046 / 432,223 | 493,026 / 8,139 | 55.28 s / 4,769,288 KiB | 31.20 s / 3,943,124 KiB | 7658 / 16 |
| minimal | 5,215,600 / 77,836 | 270,581 / 5,408 | 10.01 s / 899,512 KiB | 5.30 s / 747,904 KiB | 1404 / 16 |
| pr890-shaped | 31,392,684 / 429,444 | 465,981 / 7,873 | 55.16 s / 4,659,608 KiB | 28.09 s / 3,368,344 KiB | 9048 / 16 |
| control-two-long | 102,122 / 3,769 | 109,402 / 3,824 | 0.45 s / 108,644 KiB | 0.45 s / 101,456 KiB | 27 / 16 |
| control-literal-two | 170,585 / 5,971 | 94,356 / 3,627 | 0.92 s / 144,200 KiB | 0.67 s / 129,952 KiB | 84 / 16 |

Gates: minimal 270,581 <= 1,000,000; pr890-shaped 465,981 <= 2,000,000;
control-two-long 109,402 <= 300,000; control-literal-two 94,356 <= 300,000.
After is smaller than before on five-overlap, minimal and pr890-shaped.

`control-two-long` is the one fixture above its baseline: 109,402 B against
102,122 B. That is the shared-default result (the no-literal control gains the
origin tagging but has no literal default to share), and it remains below the
300,000 B gate.

`round2/out/measure.json` holds the measured values.

## Runtime and argv equivalence

Both compilers interpreted each repro fixture for the same argv (no clang, no
full Main, no recovery-helper build). Eighteen cases over the four repro
fixtures produced identical stdout and exit status in every case, including the
literal host-keeper case, the 13- and 14-element cases, the 4-element case in
five-overlap, and the refusal path.

The emitted C itself was not executed. Runtime equivalence was run through both
compilers' interpreters on the same sources: 18 cases, 0 stdout or exit-status
differences.

## Limits

The emitted C was not compiled; no clang was available for this bounded round.
The runtime comparison is the pinned compiler's interpreter on the same sources.
The sharing rule keys on origin, type and layouts, and was exercised on the
reproducer shapes and the two canonical fixtures above. A default whose body
changes without a change in those keys would not be shared by this rule.
