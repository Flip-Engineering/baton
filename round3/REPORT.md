# Round 3: shared-term key cost reduction (issue #776)

Status: gates pass, compile wall is now at or below the pinned baseline, and
`arm_eq` is a total structural equality. Candidate
`round2/compiler-src/bend2/comp.ts` sha256
`7cc3394b45f6139011bf8141eff917497cbd5991171ca87ec449d66cf1894ba6`.

## Equality totality fix (evaluator review of 1e5eb5b09f)

`arm_eq` previously ended in `default: return true`, so `Sub` and `All` terms
were accepted as equal without comparison; `match_flatten`/`body_sub` can
leave `Sub` in an arm body, and a hint collision could then share a
value-distinct arm. `arm_eq` is now total:

- `Sub{i,v,f}` compares `v` (a pattern through `patt_eq` with the same
  bound/free-variable discipline, or a term through `go`), binds `i` on both
  sides at the current depth, compares `f` at depth + 1, and unbinds.
- `All{q,k,i,A,B}` compares the quantity, `A`, and the two bodies applied to
  a binder `Var` at the current depth, at depth + 1.
- `Qnt`, `Rfl` and `Efq` compare equal (no fields); every other unknown kind
  returns false. No reuse is authorized by the hint.
- A representative that matches but is being emitted returns false (inline
  fallback) instead of creating another spin, so reentrant generation stays
  bounded, as in the round-2 path.

Re-verified after the fix: the four repro gates and the five-overlap C are
byte-identical to the values below (hashes unchanged); `nat_pattern_deep`
emits 110,771 B and executes `306n` with clang-19; `u32_table_bitvar`
`2496 2397`, `word_match_cover_key` and `match_default` unchanged; repro argv
outputs unchanged. Gate C hashes: minimal
`06a5ad6eafeeb49ffde3d52a4229a942d754bedca880d8fbe10c606ed11ceb30`,
pr890-shaped
`f411f8c4dbb3db3a07878ffe0d7a562a36951d89ed3f1200d23826367bb8fd6b`,
five-overlap
`b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`,
control-two-long
`fa56e094194d4ab26c1a098addaec301c8ba964643cf8c5ba50cf254f41e11cf`,
control-literal-two
`03256cfa0d1b510fbb8e3edf19ebbe9742d45c8de94be8e2e60dd4e72ceb3d64`; Nat
fixtures: nat_pattern_deep
`1333cb537122c753028f86cd366e5a063ed06812b7c30b23d5bd8b7ce935fe85`,
u32_table_bitvar
`a94a327ba27ec2c6ddd756b940c4d52b5e49c0755d84391a2264b84a9e57cf81`,
word_match_cover_key
`a07e5b0a1da29a8edfc2e370b034f85bd9764880dd05f14054cb4170f5692785`,
match_default
`d5a4b87bca0fb04b31e3da5c6032909250ec5dbd18451f148c355d1522cbef5f`.

Pinned compiler: `bend.ts 93c2a43d...fcaeb85`, `comp.ts a2a949ae...69112bc`,
`main.ts 53ce8e48...12eb07d`, `base.bend e5639663...b99d798`. Round 2 commit
`178f01fbba` is the previous candidate (full `arm_hash` + `arm_eq` at every
site).

## What changed from 178f01fbba

1. **`arm_hash` removed; `arm_hint` added.** The hash walked the whole term on
   the *first* occurrence of every alpha class; profiling showed 12.4 s of the
   ~20 s compile in those first-per-class hashes (each giant continuation cost
   ~58 ms). The new hint is cheap: the kinds and source spans of the outer
   three nodes, the innermost body's span, and the argument/result layouts. It
   only narrows the candidate list.
2. **Reuse is decided by structural alpha-equality** (`arm_eq` unchanged, with
   the full whole-term traversal, `Typ`/`Qua`/`Hol` cases added). No hash key
   can authorize a reuse, so a hint collision cannot share two different
   terms; a hint miss only loses sharing.
3. **Hint buckets hold representatives.** `File.armHints` maps a hint to the
   list of emitted representatives `{term, name, lay, ks}`; `armSeq` names the
   spins. A candidate scans only the representatives of its hint bucket with
   `arm_eq`.
4. **Forward declarations for spins.** A spin can call one joined later (a
   nested spin is pushed before its caller's body is joined). The Spins block
   now emits `static <signature>;` for every live spin before the
   definitions. This fixes a clang-19 implicit-declaration failure that the
   round-2 hash grouping never exposed but the hint grouping does.
5. `armBusy` now holds spin names (a representative being emitted is emitted
   inline instead of called), so no spin calls itself.

Preserved: first-row-wins, guard/literal exclusions, `patt_mark`/`xq` and `xs`
quantity joins, arity slicing, `emit_lits`/`lits_rows`/`emit_nats`, flat SCon
character matching. Sharing still requires `term_uses(fl, h).length === 0`.
No diagnostic code remains.

## 1. Typing (`--check-only`, byte-compared with the pinned compiler)

Identical output and exit 0 for `round2/fixtures/five-overlap.bend`, the four
`repro/*.bend` fixtures, `tests/flatten/list_ctor_004.bend` and
`tests/compile/string_match_sparse.bend` (7/7). `check_only_pass: true`.

## 2. Same-source C

| Fixture | Base bytes | Round-3 bytes | Base lines | R3 lines | Base WL_CASE | R3 WL_CASE | Base wall | R3 wall | Base RSS | R3 RSS |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| five-overlap | 33,992,175 | 528,878 | 432,223 | 11,461 | 7,658 | 25 | 65.4 s | 56.8 s | 5,002 MB | 4,574 MB |
| minimal | 5,215,600 | 513,186 | 77,836 | 10,772 | 1,404 | 17 | 9.7 s | 8.8 s | 961 MB | 801 MB |
| pr890-shaped | 31,392,684 | 528,767 | 429,444 | 11,480 | 9,048 | 28 | 52.0 s | 42.8 s | 4,627 MB | 4,442 MB |
| control-two-long | 102,122 | 103,698 | 3,769 | 4,220 | 27 | 27 | 0.4 s | 0.4 s | 104 MB | 101 MB |
| control-literal-two | 170,585 | 150,092 | 5,971 | 5,420 | 84 | 17 | 0.9 s | 0.8 s | 150 MB | 148 MB |

Gates (`check.py`): minimal 513,186 <= 1,000,000; pr890-shaped 528,767 <=
2,000,000; control-two-long 103,698 <= 300,000; control-literal-two 150,092 <=
300,000. All pass. The C is 2-4% larger than 178f01fbba (coarser hint grouping)
and the compile is 1.5-2.3x faster; RSS is lower than both baseline and
178f01fbba.

vs 178f01fbba: minimal 500,203 -> 513,186 B, 20.4 -> 8.8 s, 935 -> 801 MB;
five-overlap 509,855 -> 528,878 B, 134.0 -> 56.8 s, 7,815 -> 4,574 MB;
pr890-shaped 507,974 -> 528,767 B, 117.3 -> 42.8 s, 5,307 -> 4,442 MB.

Candidate C hashes: minimal
`06a5ad6eafeeb49ffde3d52a4229a942d754bedca880d8fbe10c606ed11ceb30`,
pr890-shaped
`f411f8c4dbb3db3a07878ffe0d7a562a36951d89ed3f1200d23826367bb8fd6b`,
five-overlap
`b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`,
control-two-long
`fa56e094194d4ab26c1a098addaec301c8ba964643cf8c5ba50cf254f41e11cf`,
control-literal-two
`03256cfa0d1b510fbb8e3edf19ebbe9742d45c8de94be8e2e60dd4e72ceb3d64`. Every C is internally consistent:
every `arm_N`/`spin_N` call has a definition, static prototypes precede the
Spins block, no spin calls itself.

## 3. Executed generated C (clang-19)

Nat/U32 fixtures, candidate vs pinned baseline, both compile and run:

| Fixture | Base | Candidate | Expected |
| --- | --- | --- | --- |
| `nat_pattern_deep` | `306n`, 0 | `306n`, 0 | `306n` |
| `u32_table_bitvar` | `2496 2397`, 0 | `2496 2397`, 0 | `2496 2397` |
| `word_match_cover_key` | `2139095040 2143289344 0 0 2139095040 2143289344`, 0 | same, 0 | same |
| `match_default` | `0n`, 0 | `0n`, 0 | `0n` |

Repro argv, generated binaries, both lanes identical (stdout/exit): minimal
`host`/`two`/empty-2; pr890-shaped `host`/`13`/empty-2; control-two-long
`13`/`14`/empty-2; control-literal-two `x`/`two`/empty-2.

End-to-end throughput on the repro argv workloads, 100 runs each, generated
binaries (process startup dominates):

| Binary | Base ms/run | Candidate ms/run |
| --- | ---: | ---: |
| minimal `--host-process-keeper a b` | 56.80 | 57.40 |
| minimal `a b` | 56.05 | 55.88 |
| pr890-shaped 13 names | 59.16 | 56.51 |
| control-two-long 13 names | 57.34 | 58.25 |
| control-two-long 14 names | 58.16 | 57.59 |
| control-literal-two `x a` | 58.05 | 58.98 |
| control-literal-two `a b` | 57.37 | 59.13 |

Differences are within the ~57 ms process-startup noise; the shared-spin call
on fallback paths is not measurable at process granularity.

## 4. Results

`round3/RESULTS.json`: `before_c_bytes` 5,215,600, `after_c_bytes` 513,186,
`check_only_pass` true, `compiler_tests_pass` true, `focused_entry_check` true
(`five-overlap.bend`).

## Limits

- No full Main, no recovery-helper build, no push. Clang was used on the four
  Nat/U32 fixtures and the repro C only.
- A hint miss loses sharing (more C) but cannot change meaning; a hint hit is
  always verified by whole-term `arm_eq`. The hint is not a key.
- Compile wall is now below the pinned baseline on the long fixtures; the C is
  2-4% larger than the 178f01fbba full-hash grouping.
