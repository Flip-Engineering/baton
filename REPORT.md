# Literal-string match expansion: default-continuation sharing (issue #776)

Status: failed candidate. The change is type-correct and the sharing fires, but
the emitted C for the required fixture is byte-identical, so
`before_c_bytes == after_c_bytes == 208376`. The evaluator returns
`accepted:false`. Evidence and the exact reason follow.

Candidate: `compiler-src/` (copy of Bend 2.0.25 consumer 27629713 `bend2/` plus
`bin/bun` and `bin/bend`). Reference tree is read-only; nothing outside this
worktree was edited. No clang, no full Main build, no recovery-helper build, no
push.

## Exact diff from the reference `bend2/`

Reference: `.../bend2/` at consumer 27629713 (`bend.ts` 3947 lines, `comp.ts`
6737 lines, `main.ts` 784 lines). `main.ts` is unchanged
(`53ce8e48c7540db6c3e66133a7c7eb270d6f64813fe10a631fd50d22112eb07d`,
the reference hash).

### `bend.ts` (sha256 `259e8691dc3af26890a41443edfe98461420001bf0029a32d7d6b67bb8be513e`)

- Line 324: `Case` gains an optional stable row origin:
  `{ p: Patt[]; f: Body; o?: number }`.
- Line 2735: `body_sub`'s Match rows carry `o: case_origin(row)`.
- Lines 2750-2810 (inserted after reference 2748): `Alt`, `case_origin`, and
  `alt_wrap`; `match_flatten` gains an optional `alt` argument.
- Line 2843: the PVar-column rows keep the origin.
- Lines 2867-2899 (reference 2802-2824): the constructor-split rows keep the
  origin, and the split gates and threads `alt` into the `pt` recursion.

Mechanism: when a constructor split is entered from the previous split's first
field (`alt.cur` equals the scrutinee variable id), the fallback rows `ds` are
the same origin rows in the same order, all `PVar`, and the column has no
sibling constructor, the nested default rebuilds the previous constructor value
from the current scrutinee plus the stored path fields and applies the ancestor
flattened default through `Sub`, instead of re-flattening `ds`.
Preserved: first-row-wins order; PVar/PCtr-only matching; `parse_patt`/
`lit_full` literal expansion; `patt_mark`/`xq` and `xs` quantities; `m.e`/`vars`
slicing and `Lam` wrapping; `emit_lits`/`lits_rows`/`emit_nats` (reuse only on
one-constructor columns with all-PVar fallbacks).

### `comp.ts` (sha256 `dfaa2274462528af415e185437c6120033d2481dc46751e63b139e31aa712172`)

- Line 123: `File.clom: Map<string, string>`; initialized at line 1606.
- Lines 2335-2348 (`emit_clo`): the emitted closure segment is memoized by the
  lowered body (`term_lower`, spans and `Ann` dropped) plus the capture layout.
  A hit builds a fresh closure node over this site's words and reuses the
  segment.

## Proof, in the required order

### 1. Typing first (`--check-only`)

| Fixture | Base | Candidate |
| --- | --- | --- |
| `fixtures/literal_dispatch.bend` (21/13/4/2-character literal dispatch, keeper Bool dispatch, `String.eq` + `Bool.pick` form) | exit 0 | exit 0, identical output |
| `tests/flatten/list_ctor_004.bend` | exit 0 | exit 0, identical output |
| `tests/compile/string_match_sparse.bend` | exit 0 | exit 0, identical output |

Full check-only sweeps, base output byte-compared with candidate output:

| Sweep | Files | Differences |
| --- | --- | --- |
| `tests/flatten/*.bend` | 240 | 0 |
| `tests/compile/*.bend` | 119 | 0 |

No fixture fails. Evidence under `proof/`.

### 2. Same-source C generation (the failed measurement)

Fixture: `fixtures/focused_literal.bend` (one 21-character literal case,
2-, 13- and 4-character siblings, default row, runtime argument so the dispatch
emits; leaves are pure stubs).

| Metric | Base (consumer bend) | Candidate |
| --- | --- | --- |
| C bytes | 208376 | 208376 |
| C sha256 | `5e489889f215596a7e99645a1d2d94399c6bf13be187e47264767243942f2296` | same |
| `WL_CASE` occurrences | 16 | 16 |
| Wall time (3 runs) | 3.35 s, 3.31 s, 3.52 s | 3.07 s, 3.20 s, 3.00 s |
| Peak RSS (3 runs) | 314880, 362280, 327632 KB | 318452, 322080, 312628 KB |

Supporting canonical test, `tests/compile/string_match_sparse.bend`: 294188 C
bytes base, 294187 candidate (1 byte), wall 4.53/4.79 s -> 4.47/4.79 s, peak
RSS 435396/472012 KB -> 494452/464548 KB.

Where the `emit_clo` memo fires it does reduce the emitted segment count:
`tests/compile/eta_closure_body.bend` goes from 86701 C bytes and 18 `WL_CASE`
segments to 86402 bytes and 17 segments, and still passes `--check-only`.

### 3. Why the required fixture does not shrink

Instrumented runs (trace code removed from the submitted candidate) measured
that the sharing does fire: of 2056 fallback recursions in
`fixtures/literal_dispatch.bend`, `alt_ok` held 732 times and `alt_wrap`
returned a rebuilt continuation 732 times. It still does not change the C:
`term_lower`/`term_higher` and the checker rebuild the substituted continuation
into one copy per use site, so the emitted default arms remain distinct
objects and `emit_match` emits them inline. The `emit_clo` memo cannot reach
them because they are not closures. The emitted C was therefore byte-identical
in every run (same sha256, 208376 B, 16 `WL_CASE`).

The trace numbers from the earlier seat run remain: 8883 `match_flatten` calls,
2056 fallback recursions, 40 emitted default copies in `literal_dispatch.c`,
and `tests/compile/string_match_sparse.bend` at 294188 base C bytes.

## Results

`RESULTS.json` (sha256
`f4cf9ff6b6780fcb71c78049db08adec59924c96b6e42a15bd7b8e70e7ccf5fc`):
`before_c_bytes` 208376, `after_c_bytes` 208376, `check_only_pass` true,
`compiler_tests_pass` true, `focused_entry_check` true. The equal byte counts
mean the evaluator yields `accepted:false`; no reduction is claimed.

## Limits

- The sharing is semantically sound and type-checks everywhere measured, but it
  does not survive checking to emission, so it cannot deliver the required C
  reduction in this form.
- A working fix needs the shared continuation to survive as one emitted
  segment, for example an emitter-side shared arm segment keyed by the source
  body, or a Let-bound continuation whose applications the checker keeps.
- No clang and no runtime execution were run; no behavioural or binary-size
  claim is made.
- The literal-character 32-bit binder construction (issue #892) is out of
  scope; `emit_lits`/`lits_rows` were not changed.
