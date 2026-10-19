# Round 2: typed emitter-side default-continuation sharing (issue #776)

Status: gates pass. The four PR890 repro gates and the five-overlap literal
fixture all shrink by two orders of magnitude, the emitted C executes the same
outputs on the small Nat/U32 fixtures and the repro argv cases, and the
compiler diff is one file (`comp.ts`). Candidate `comp.ts` sha256
`bf12ab86841311316af96f80663327cdfa307fa50be86ab41e1e7748ecc663f5`.

Pinned compiler (guard-combined-37b29f3-20261018):
`bend.ts 93c2a43deeb82c15683e4e25bbc5dec5ac3edff9f54e09acc0975e290fcaeb85`,
`comp.ts a2a949ae7f1c8520d8a112aa505b4c5440baad861dc912e410bfb501369112bc`,
`main.ts 53ce8e48c7540db6c3e66133a7c7eb270d6f64813fe10a631fd50d22112eb07d`,
`base.bend e5639663177f2de93ef34867c029698aa4e68a98d46629f0b15452b67b99d798`.
`bend.ts`, `main.ts` and `base.bend` in `compiler-src/` are byte-identical to
the pinned files. `effs/` is the 72-file directory from consumer 27629713 and
`bin/bun` is copied unchanged.

## Semantic diff (`round2/compiler-src/bend2/comp.ts`, 1 file, 222 diff lines)

1. `File` gains `arms` (key to emitted spin) and `armBusy` (keys being
   emitted); `file_new` initializes them.
2. `arm_hash` and `arm_eq` (inserted before `emit_match`, reference line 3121):
   a canonical key of the arm term where binders become relative depths and
   free variables first-occurrence positions, plus a structural alpha-equality
   check. The key is the *whole* term, not a span or an inner body.
3. `emit_arm_shared` and `emit_arm_call`: a closed arm body whose key matches
   an emitted one reuses that spin; otherwise its body is emitted once as a
   spin over its parameter layouts. The key includes argument layouts and the
   result layout. A key hit requires `arm_eq`; a key currently being emitted
   is emitted inline instead (`armBusy`), so a spin never calls itself.
4. `emit_match`'s arm emission (reference line 3186): arguments are computed
   once (`const av = [...fs(), ...rest]`) and `emit_arm_shared` runs before the
   inline `emit_body` fallback.

Preserved: first-row-wins ordering; guard/literal exclusions; `patt_mark`/`xq`
and `xs` quantity joins; match arity slicing; `emit_lits`/`emit_lits`
`lits_rows`/`emit_nats` are untouched; character literal matching stays flat
SCon matching. Sharing only applies to terms with no free probes
(`term_uses(fl, h).length === 0`), so no captured value is ever taken from one
site and used at another.

No diagnostic code remains: `grep BEND_MF_TRACE|BEND_EM_TRACE|BEND_ARM_DBG`
over the candidate returns nothing.

## 1. Typing first (`--check-only`)

Candidate output byte-compared with the pinned compiler's output:

| Fixture | Base | Candidate |
| --- | --- | --- |
| `round2/fixtures/five-overlap.bend` (literal `--host-process-keeper` 3-token, 2-, 13-, 14-, 4-token, final error) | exit 0 | exit 0, identical |
| `repro/minimal.bend` | exit 0 | exit 0, identical |
| `repro/pr890-shaped.bend` | exit 0 | exit 0, identical |
| `repro/control-two-long.bend` | exit 0 | exit 0, identical |
| `repro/control-literal-two.bend` | exit 0 | exit 0, identical |
| `tests/flatten/list_ctor_004.bend` | exit 0 | exit 0, identical |
| `tests/compile/string_match_sparse.bend` | exit 0 | exit 0, identical |

`check_only_pass: true`. No failing fixture.

## 2. Same-source C

Fixture `five-overlap.bend` sha256
`c0e32928b13d2f73ae14fab6cda288738736c1e0cb2bf784c5ed5f6b1311af2c`.

| Fixture | Base bytes | After bytes | Base lines | After lines | Base WL_CASE | After WL_CASE | Base wall | After wall | Base RSS | After RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| five-overlap | 33,992,175 | 509,855 | 432,223 | 10,867 | 7,658 | 14 | 65.4 s | 134.0 s | 5,002 MB | 7,815 MB |
| minimal | 5,215,600 | 500,203 | 77,836 | 10,464 | 1,404 | 14 | 9.73 s | 19.9 s | 961 MB | 969 MB |
| pr890-shaped | 31,392,684 | 507,974 | 429,444 | 10,798 | 9,048 | 14 | 52.0 s | 117.3 s | 4,627 MB | 5,307 MB |
| control-two-long | 102,122 | 94,669 | 3,769 | 3,766 | 27 | 14 | 0.44 s | 0.47 s | 104 MB | 111 MB |
| control-literal-two | 170,585 | 141,082 | 5,971 | 5,234 | 84 | 14 | 0.90 s | 0.96 s | 150 MB | 146 MB |

Gates (`check.py`, candidate): minimal 500,203 <= 1,000,000; pr890-shaped
507,974 <= 2,000,000; control-two-long 94,669 <= 300,000; control-literal-two
141,082 <= 300,000. All four pass. Candidate C hashes:
`minimal 8d9868d449f406961af7e16f970aed52d9af7896188457bfb225c00f59f60420`,
`pr890-shaped d7ec155bd2e89a76d0ec28ee12af8f61992aca18e45f55f49e20a28af7881a3f`,
`five-overlap 1b7d224a7642489f3bdc83bf729c47ef697cf541eb0805373504696edfd628bd`,
`control-two-long 5c72f5d0a875e7dad4c6336f4b7a8b422ff8ffe8fce16b3a45ad36c5e64b1215`,
`control-literal-two e62bbcf189251191e585141af48d8c62bf58f67f90cf871d7d5bdb271b67ed6b`.

Every generated C is internally consistent: every `arm_N(` call has an
`INLINE`/`FAR` definition, no spin calls itself, and names are unique per file
(104/115/17/43/119 spins for minimal/pr890-shaped/control-two-long/
control-literal-two/five-overlap).

Compile cost is the known limit: about 2x the wall time and higher peak RSS on
the long fixtures, from `arm_hash` plus the alpha-equality check over the full
arm term at each duplicated site.

## 3. Executed generated C (clang-19, small fixtures)

The four requested Nat/U32 fixtures: the candidate emits byte-identical C to
the pinned compiler (sharing does not fire on them), both lanes compile with
`clang-19 -O1 -w ... -lm -lpthread`, and both execute the expected output:

| Fixture | Base stdout/exit | Candidate stdout/exit | Expected |
| --- | --- | --- | --- |
| `nat_pattern_deep` | `306n`, 0 | `306n`, 0 | `306n` |
| `u32_table_bitvar` | `2496 2397`, 0 | `2496 2397`, 0 | `2496 2397` |
| `word_match_cover_key` | `2139095040 2143289344 0 0 2139095040 2143289344`, 0 | same | same |
| `match_default` | `0n`, 0 | `0n`, 0 | `0n` |

Executed generated C for the repro fixtures (both lanes compiled with
clang-19; the baseline pr890-shaped 31 MB C is the only large compile):

| Fixture | argv | Base stdout/exit | Candidate stdout/exit |
| --- | --- | --- | --- |
| minimal | `--host-process-keeper a b` | `host`, 0 | `host`, 0 |
| minimal | `a b` | `two`, 0 | `two`, 0 |
| minimal | (none) | empty, 2 | empty, 2 |
| pr890-shaped | `--host-process-keeper a b` | `host`, 0 | `host`, 0 |
| pr890-shaped | 13 names | `13`, 0 | `13`, 0 |
| pr890-shaped | (none) | empty, 2 | empty, 2 |
| control-two-long | 13 names | `13`, 0 | `13`, 0 |
| control-two-long | 14 names | `14`, 0 | `14`, 0 |
| control-two-long | (none) | empty, 2 | empty, 2 |
| control-literal-two | `x a` | `x`, 0 | `x`, 0 |
| control-literal-two | `a b` | `two`, 0 | `two`, 0 |
| control-literal-two | (none) | empty, 2 | empty, 2 |

Binary sizes: minimal 2,087,392 -> 1,139,840 B; pr890-shaped 8,980,216 ->
1,143,856 B. Interpreter runs of the same argv cases agree as well.

## 4. Results

`round2/RESULTS.json`: `before_c_bytes` 5,215,600, `after_c_bytes` 500,203,
`check_only_pass` true, `compiler_tests_pass` true, `focused_entry_check` true.
`focused_entry_check` covers `five-overlap.bend`.

## Limits

- No full Main, no recovery-helper build, no push. The giant entry was not
  compiled beyond its 509,855-byte C; clang was used on the small fixtures and
  the repro C only.
- Type/layout safety rests on the key (whole alpha-canonical term, argument
  layouts, result layout) plus the requirement that the arm has no free
  probes. The full-term equality check is what keeps distinct continuations
  with the same inner body or source span apart.
- The sharing adds compile time and memory on the long fixtures (see the
  table).
