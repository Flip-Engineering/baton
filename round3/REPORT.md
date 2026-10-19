# Round 3: shared-term key cost reduction (issue #776)

Status: this head passes the three repro gates and the protected tests below.
It adds the quantity, annotation, binder-key and Ref.b corrections. Candidate
`round2/compiler-src/bend2/comp.ts` sha256
`cfe7865fee3d9d45bf692370d8cf8ce033195c86fa84f799d66ac734d2618760`.

## Equality totality fix (evaluator review of 1e5eb5b09f)

`arm_eq` previously ended in `default: return true`, so `Sub` and `All` terms
were accepted as equal without comparison; `match_flatten`/`body_sub` can
leave `Sub` in an arm body, and a hint collision could then share a
value-distinct arm. `arm_eq` is now total:

- `Sub{i,v,f}` is rejected: its `i` is a substitution index, not a de Bruijn
  binder, and binding it can alias a probe or a binder with the same number.
- `All{q,k,i,A,B}` compares the quantity, `A`, and the two bodies applied to
  a `Var` with a synthetic key below every real index (`-2 - d`), at
  depth + 1.
- `Qnt`, `Rfl` and `Efq` compare equal (no fields); every other unknown kind
  returns false. No reuse is authorized by the hint.
- A representative that matches but is being emitted returns false (inline
  fallback) instead of creating another spin, so reentrant generation stays
  bounded, as in the round-2 path.

Repro gates measured at this head with the pinned `bend.ts`, `main.ts` and
`base.bend`:

| Fixture | C bytes | sha256 | Wall | Peak RSS |
| --- | ---: | --- | ---: | ---: |
| minimal | 513,186 | `06a5ad6e...` | 10.6 s | 695 MB |
| five-overlap | 528,878 | `b7b0b85b...` | 65.8 s | 4.57 GB |
| pr890-shaped | 528,767 | `f411f8c4...` | 51.2 s | 3.96 GB |

Minimal is below 1,000,000 B and pr890-shaped below 2,000,000 B; five-overlap
matches the round-3 value. The three binaries build with clang-19 and print
`host` / `two` / `13` / `14` / `four` / `other` for the argv cases; an empty
argv exits 2. The four protected Nat/U32 fixtures emit byte-identical C to
base and execute `306n`, `2496 2397`, the word match output and `0n`. The
carrier, annotation-sharing, binder-key and Ref.b tests are in the next
section.

Pinned compiler: `bend.ts 93c2a43d...fcaeb85`, `comp.ts a2a949ae...69112bc`,
`main.ts 53ce8e48...12eb07d`, `base.bend e5639663...b99d798`. Round 2 commit
`178f01fbba` is the previous candidate (full `arm_hash` + `arm_eq` at every
site).

## Quantity, annotation and binder-key equality (issue #776 follow-up)

`arm_eq` compares `Lam.q`, every element of `Let.q`, `Ann.T` and `Ref.b`. The
reasons differ by field:

- `Ann.T` is read by emission: `ty_peel` carries it into `emit_body`,
  `ty_ann` reads it for a call spine, and `ty_all` opens its binders. Two
  arms with different annotations can emit different code.
- `Ref.b` is the bang marker. `term_spine` records it as `bang`,
  `emit_body` uses it to refuse a fused call, and `emit_jump` emits the
  offload task path. The two fixtures below emit different C with and
  without the marker.
- `Lam.q` is not read by the emitter; emission takes the binder quantity
  from the type through `ty_all`. It is compared because it is part of the
  term and the equality is total over the term.
- `let_live` reads only `Let.q.length`: it iterates `t.q` to index the bound
  values and does not read the tags. The element comparison keeps the
  equality total and the lengths aligned.
- `All` uses a synthetic binder key below every real index (`-2 - d`) and
  applies both bodies to a `Var` with that key. Keying on `d` aliased a
  probe whose index equals the comparison depth. `Sub` is rejected: its `i`
  is a substitution index, not a de Bruijn binder, and the body cannot be
  renamed without rebuilding higher-order terms. An arm carrying a `Sub`
  does not share.
- `ADT.r` stays out: it is the checker's remaining-constructor refinement.
  `book_adt` reads it to filter the constructor list used for default-arm
  existence; layouts (`lay_of`, `lay_node`) and calls key on `k` and the
  type arguments. Comparing it changed the five-overlap C from 528,878 to
  540,581 bytes with identical outputs.

A repeated copy keeps the same annotation object. `arm_eq` skips the type
traversal when `x.T === ya.T`: in an instrumented five-overlap run 1,526,534
of 3,000,000 annotation comparisons were object-equal. Five-overlap emits
528,878 B (hash
`b7b0b85b08e3f44d8bb2dd2309b35dacfeb616a57ae19168a4812d57d3384316`) in 56.8 s
at 5.13 GB peak RSS. The four protected Nat/U32 fixtures emit byte-identical C
and execute `306n`, `2496 2397`, the word match output, and `0n`.

Fixtures: `round3/fixtures/quant_ann_match.bend` and
`round3/fixtures/quant_ann_collision.bend`. A literal prefix duplicates each
row at every character column, so `emit_arm_shared` scans the arm bodies that
carry `Lam.q`, `Let.q` and `Ann.T`. Both fixtures emit the same C and outputs
on base `50e84c98` and this head: 4,871,155 B and 4,871,103 B, outputs
`2`/`7`/`9` and `3`/`7`/`9` for argv `--host-process-keeper a b`, `a b` and
`x`. Command:

```
COMPILER_DIR/bin/bun --smol COMPILER_DIR/bend2/main.ts round3/fixtures/quant_ann_match.bend -o out.c
clang-19 -std=c11 -O1 -w out.c -lm -lpthread -o out
./out --host-process-keeper a b   # 2 (collision: 3)
./out a b                         # 7
./out x                           # 9
```

Protected annotation-sharing test: `round3/tests/arm_eq_ann_share.ts` loads
`round3/fixtures/arm_eq_ann_share.bend` twice, changes one duplicated Mat
arm's `Ann.T` quantity from Lone to Many in the second load, and compares the
emitted C. The change is layout-neutral. Base `50e84c98` exits 1: every
mutation compiles to the same 511,757 B, because base `arm_eq` ignores
`Ann.T`. This head exits 0: the plain C is 511,757 B and the mutated C is
512,918 B, a separate spin. The mutated C builds with clang-19 and prints
`host`/`two`/`other` for the three argv cases. Command:

```
COMPILER_DIR/bin/bun --smol round3/tests/arm_eq_ann_share.ts COMPILER_DIR
```

Binder-key test: `round3/tests/arm_eq_binder_key.ts` appends a temporary
`export { arm_eq }` to a copy of `COMPILER_DIR/bend2/comp.ts`, builds
`Lam z. All k. z` and `Lam z. All k. k`, and runs each case in a fresh
process so the Lam binder takes probe index 1. No other probe allocation
precedes it. The same script checks the `Ann.T` analogue and a same-term
control. On `119a3076` the All case and the Ann.T analogue compare equal and
the test exits 1; on this head both compare unequal and the control compares
equal. Command:

```
COMPILER_DIR/bin/bun --smol round3/tests/arm_eq_binder_key.ts COMPILER_DIR
```

`COMPILER_DIR` must be writable: the test writes and removes
`bend2/comp.arm_eq_test.ts`. It imports the repository `bend.ts`
(byte-identical to the pinned file) for terms and loads only `comp.ts` from
`COMPILER_DIR`.

Ref.b sharing regression: `round3/tests/arm_eq_ref_bang_share.ts` loads
`round3/fixtures/arm_eq_ann_share.bend`, copies the path to one call-head Ref
in the second copy of the duplicated arm group `431:448:Lam`, and sets
`b = true` there. The bang marker also joins the file's bang set, so the whole
C changes in both lanes; the sharing decision is the arm-spin count.

- Base `50e84c98`: 214 to 214 spins (shares), C 511,757 to 511,738 B, sha256
  `24b464ef70da79d15ee912b78c9db58bad4f86e02a91588f18057b7ef187bc83`.
- This head: 214 to 218 spins (separate spins), C 511,757 to 512,899 B,
  sha256 `20747c0830e8fc34d57db886dd08682760590d786210bfbd8fa25f1d250acfdd`.

Both mutated C files build with clang-19 and print `host` / `two` / `other`
for argv `--host-process-keeper a b`, `a b` and `x`, exit 0. The test exits 0
when the arm-spin count grows and 1 when it does not; base exits 1. Command:

```
COMPILER_DIR/bin/bun --smol round3/tests/arm_eq_ref_bang_share.ts COMPILER_DIR
```

Supporting variants: `round3/fixtures/ref_bang_plain.bend` and
`ref_bang_marked.bend` are the same program except `deep(5n)` and `deep!(5n)`.
The plain C is 84,810 B (hash `877f8e3b...`) and the marked C is 84,739 B
(hash `185329de...`); both execute `5`. Base and this head emit identical C
per variant. These show the marker changes the emitted program; the sharing
test above is the gate regression.

Limit: no source program in this checkout changes runtime output between base
and head. The `ann_share` mutation changes the emitted spin set; the Ref.b
mutation changes the emitted spin set and the file's bang set, so C differs
in both lanes and the test compares arm-spin counts. The base review's 168
`Ann.T`-divergent hits are not explained here; on the unmutated fixtures in
this checkout base and head emit identical C.

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
