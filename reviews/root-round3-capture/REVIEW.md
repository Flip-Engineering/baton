# Source review: capture-aware production candidate 6c3d8a643e

Scheduling hold honored: no compilation, compiler check, build, Cgen, clang, or
CI was run for this review. All evidence below is source-level.

## Exact pin

| Item | Value |
| --- | --- |
| Canonical public 2.0.25 consumer `comp.ts` | `b68bfe1a306c1d89d12b07cbd86012cea873c06986cf191270e65941bae4efda`, 199,273 B |
| Capture-aware base `port/ported/bend2/comp.ts` (1f018f31f3) | `5eadd57cc44a6a33532860414baa266a315658ffdd164b6f6042ec36b472a7d7`, 7,044 lines |
| Capture patch (1f018f31f3 `port/consumer-capture.patch`) | `b4ac85b8a94d1d6ef099325889f67abd1d160a48e4333f71362eab076fb60fc2` |
| Production candidate `bend2/compiler/upstream/comp.ts` (6c3d8a643e) | `375fdc3b397e52a59d95932eb97c6002fcd3a6c018706023733994fc06c5feb1`, 210,667 B, 7,043 lines |
| Production parent `bend2/compiler/upstream/comp.ts` | `b68bfe1a…` |
| Production diff vs capture base | 319 insertions / 13 deletions |
| Production branch | `fix/compiler776-literal-default-production-20261020` |
| `bend.ts` / `main.ts` / `base.bend` | `93c2a43d…` / `53ce8e48…` / `e5639663…` |

The production commit changes only `bend2/compiler/upstream/comp.ts`.
`bend2/compiler/repl-upstream.provenance.json` and
`repl-upstream.lock.json` at 6c3d8a643e still pin `comp.ts` `b68bfe1a`,
199,273 B. The committed canonical source and its recorded pin disagree.

## 1. arm_eq completeness over the term union

`arm_eq` at `production.ts:2860`. Cases and evidence:

- `Var` alpha/free positions (`2868-2885`), `Ref.k` (`2886`), `Lam`
  quantity `q` and body (`2893-2900`), `Let` value count, every `q`
  element, values and body (`2902-2915`), `App` (`2916`), `Ctr` k/arity/fields
  (`2917-2921`), `Mat` k/h/m (`2922-2925`), `Lit` (`2926`), `Ann` x and
  `T` (`2927-2930`), `Rwt` e/p/f (`2931-2935`), `Eql` a/b/T (`2936-2938`),
  `Min` (`2944`), `Typ` (`2945`), `Qua` (`2946`), `Hol` (`2947`), `Sub`
  pattern/term plus bound body (`2948-2962`), `All` q/A/B (`2963-2971`),
  `Qnt`/`Rfl`/`Efq` true (`2972-2975`), every unknown kind false (`2976`).
- **Gap: `ADT.r` is not compared.** `production.ts:2939-2943` compares
  `k`, parameter count and parameters only. The capture-aware base compares
  `r` length and order-insensitive membership (`capture-base.ts:2939-2944`),
  added deliberately by 1f018f31f3 (“Add literal default bucket and ADT.r
  equality”). The earlier independent source review
  `knowledge-record:c5528d2c210bfe555a7be425261ba4ef` found this exact gap
  in the pre-fix capture patch, and `term_compare EQ` in the public
  `bend.ts` compares `r` length and membership.
- Emission dependency: `Bend.book_adt` filters constructors by `tm.r`
  (`bend-production.ts:996-1006`); `emit_match` takes
  `total = Bend.book_adt(...).c.length` (`production.ts:3138`) and the table
  path does the same (`production.ts:3655`). A term whose `Ann.T` or nested
  ADT differs only in `r` can therefore be shared while the emitted
  default/total logic was built from the first refinement.
- Recommendation: restore the base's `ADT.r` comparison (length plus
  order-insensitive membership). If the literal-default bucket needs to
  share across differing `r`, prove the spin body's emission is independent
  of `r`, or type the segment by `r` in the key. This is the one exact
  completeness gap found; all other term kinds are covered.

## 2. capture_order, term_kids and term_uses coverage

- `term_kids` (`production.ts:838-853`) returns the runtime children:
  `Ann.x`, `Lam` body, live `Let` values and body, `App` head/args,
  non-constant `Ctr` fields, `Mat.h/m`, `Rwt.f`. It deliberately omits
  type-level or erased children (`Ann.T`, `All`, `Eql`, `Typ`, `Min`, `ADT`,
  `Qua`, `Qnt`) and `Sub`.
- `term_uses` (`production.ts:899-913`) is defined through `term_kids`, so
  use coverage and capture traversal are identical by construction.
  `capture_order` (`production.ts:2985-3007`) walks the same children and
  emits only probes with a positive use in the current `fl.uses`; its hit
  order is first use.
- The inline gate `if (Bend.pmap_to_array(u).length > caps.length) return
  false` (`production.ts:3039`) renders inline when any used probe is not in
  scope. This keeps the name bound and is the correct fallback.
- `Sub` is not traversed, but `def_body` raises the checked term with
  `Bend.term_higher` (`production.ts:1482-1488`), whose `Sub` case
  substitutes (`bend-production.ts:740-745`); the emitter's HTerm therefore
  has no `Sub`. The `arm_eq` `Sub` case is defensive. If a future lowering
  leaves `Sub` in an HTerm, `term_kids` must add `[v, f]` and the emitter must
  handle the node; today's pipeline does not.
- `arm_eq` compares more than the capture traversal (types, evidence,
  annotations). Those nodes are erased and carry no runtime words, so
  alpha-equality plus the identical live-child order preserves the capture
  correspondence. No runtime capture gap found.

## 3. Cross-definition armHints reuse

- `File.armHints` (`production.ts:126`), initialized in `file_new`
  (`:1613`). `compile_def` resets `armBusy` but not `armHints`
  (`production.ts:3216-3223`), so representatives persist across definitions
  within one emission pass.
- The hit gate (`production.ts:3046-3055`) requires the hint (capture, argument
  and result layouts), equal capture/argument word counts and `arm_eq` on the
  whole term. A cross-definition hit passes the current site's capture and
  argument words; the spin has no definition-local state. Semantically safe
  under the equality gate.
- Cost: every representative retains its term and capture probes for the
  remainder of the pass. On a large book this is a memory-retention surface
  (the root's RSS concern); clearing `armHints` per definition or including
  the definition in the key trades cross-definition reuse for bounded memory.
  The queued measurement should record the resident set with and without the
  cross-definition map.

## 4. C signature layout widths for captures

- `Kind = "w32" | "w64" | "box"` (`production.ts:52`).
- `lay_c` (`production.ts:1103-1105`): `w32 -> u32`, otherwise `Term`;
  `Term` is `typedef u64 Term` (`production.ts:3982`). So `w64` and `box`
  are 64-bit scalars, `w32` is a 32-bit scalar.
- Spin parameters are `capKs` followed by `avKs` (`production.ts:3060-3063`).
  The source signature uses `lay_c(k)` for each
  (`production.ts:3080-3086`); the call passes the capture words and the
  argument own words (`emit_arm_call`, `production.ts:3104-3114`). Capture
  words come from `val_own` on the popped bind and use the bind's layout, so
  parameter kinds and call words agree.
- All parameters are scalars. x86_64 SysV passes them in registers then on
  the stack; there are no aggregates, so no hidden-pointer or aggregate
  layout concern. `w32` arguments are converted to `u32` by the call, which
  is the layout's intended truncation.
- Prototypes: every live spin gets `static <signature>;` before the Spins
  block (`production.ts:3494-3500`), stripped of the `INLINE`/`FAR` macro and
  the opening brace. On the host, `INLINE` is `static inline`
  (`production.ts:3874`), which matches the static prototype. On the Metal
  branch `INLINE` is `inline` (`production.ts:3856`), so a static prototype
  would conflict there; this review's lane is x86_64, where the prototypes
  match.

## 5. fl.dry dry-pass integration

- `emit_arm_shared` returns false when `fl.dry` (`production.ts:3034`), so the
  facts-only dry passes inline every shared arm while the real pass shares
  it.
- The facts loop runs dry passes until `own/hot/stat` stop changing
  (`production.ts:3414-3419`); the real loop then emits with
  `emission_defs`, which was computed before the dry loop
  (`production.ts:3364-3368`), and repeats until the facts stop changing
  (`production.ts:3420-3423`).
- The dry inline path and the real spin path bind captures differently
  (`bind_uses` inside the spin versus the caller's live uses). This can change
  emission-derived `hot`/`stat` facts, while the definition order is not
  recomputed between the dry and real loops. Source-level, this is an
  asymmetry that needs instrumentation in the queued measurement: compare the
  fact counts of a dry pass and a real pass at the same definition set, and
  verify the final real pass does not change `facts()` after the retained
  pass. No Cgen was run.

## 6. Emitted-C expectations, x86_64/clang-19

- Each shared arm emits one `arm_<n>` spin and a matching
  `static Term arm_<n>(Env e, THR Term* o, <capture params>, <arg params>);`
  forward declaration before any spin definition. The definition is
  `INLINE Term arm_<n>(...)` (host: `static inline`).
- Call arity is `captures + arguments`; the first two C parameters are
  `Env e, THR Term* o`; the rest are the flattened capture and argument word
  kinds (`u32` or `Term`).
- The spin body begins with `u32 wpoll = 0`, zero-initialized result words,
  `seg_take` parameter reads from `r0..`, `WL_SPIN`, the body, `break`, then
  writes `o[j]` and returns 1. It has no frame; all captures and arguments
  are function parameters.
- The literal route uses `arm_body_hint` buckets
  (`production.ts:3010-3030`) and the `lit` flag from `emit_lits`
  (`production.ts:2778-2790`); ordinary constructor arms are inlined
  (`def` gate at `production.ts:3034`, call site `3178-3184`). The final
  default of a match uses `arm_hint`.
- clang-19 C11 sees only scalar prototypes and definitions; the static
  forward declarations resolve the later-spin call order. A build expects no
  implicit declarations.

## 7. Pending measurement plan (do not run until issue #970 queue lands)

Compiler package: `bend2/compiler/upstream/` at 6c3d8a643e with `comp.ts`
`375fdc3b…`, `bend.ts` `93c2a43d…`, `main.ts` `53ce8e48…`, `base.bend`
`e5639663…`, the 72 `effs/` files, and `bin/bun` (Bun 1.3.14).
Baseline: canonical public consumer `comp.ts` `b68bfe1a…` with the same
`bend.ts`, `main.ts`, `base.bend`, `effs/`, and bun.

For each fixture:
`focused_literal.bend` (`fixtures/focused_literal.bend`),
`round2/fixtures/five-overlap.bend`,
`tests/compile/string_match_sparse.bend`,
`tests/flatten/list_ctor_004.bend`,
`tests/compile/nat_pattern_deep.bend`,
`tests/compile/u32_table_bitvar.bend`,
`tests/compile/word_match_cover_key.bend`,
`tests/compile/match_default.bend`:

1. `--check-only` with `BEND_NO_TELEMETRY=1`; byte-compare baseline and
   candidate stdout/stderr/exit.
2. Emit C to distinct files; record bytes, lines, `WL_CASE` count and
   sha256 for both lanes.
3. `/usr/bin/time -v` for wall and peak RSS on both lanes.
4. Compile the small emitted C with `clang-19 -std=c11 -O0 <file> -lpthread
   -lm -o <bin>` and run the fixture's argv matrix; compare stdout and exit
   to the baseline. The protected fixtures use their expected outputs
   (`306n`, `2496 2397`, the word-match output, `0n`).
5. Enforce the repro gates if the three repro fixtures are included:
   minimal <= 1,000,000 B, pr890-shaped <= 2,000,000 B, controls <= 300,000 B.
6. Instrument one pass to compare the dry `own/hot/stat` facts with the real
   pass, and report the `armHints` resident-set difference with and without
   per-definition clearing.

No compilation request has been issued; these measurements are pending the
shared queue.

## 8. Existing knowledge consulted

`knowledge search` found the capture-port findings and no record matching
`PR944119a` in the visible scope. Relevant records:

- `knowledge-record:c5528d2c210bfe555a7be425261ba4ef`: capture patch review;
  one exact equality gap at `ADT.r`; `term_compare EQ` compares `r` length and
  membership.
- `knowledge-record:2f4100291175a712c31f042786e74c1f`: neither alternative
  alone shares literal defaults; B needs the literal body bucket, A the
  capture-aware base.
- `knowledge-record:5e74bc8e843792ba2a22713af25b7a90`,
  `cf7d208c86493612170346ce8803f9c0`,
  `7530ef2e6db07867ee6d462b872269bd`: port lineage and the canonical consumer
  base.

No port work was duplicated.

## 9. Follow-up verification (branch head da753a093e)

The production branch advanced after 6c3d8a643e. Verified commits:
`06ac2436f1` (capture port) → `6c3d8a643e` (literal route, the reviewed
pin) → `da753a093e` (head, ADT.r equality).

| Item | 6c3d8a643e | da753a093e |
| --- | --- | --- |
| `comp.ts` sha256 | `375fdc3b…` | `226c3eee84352fc18d2d42b9e5e91797ef051a21592cf98e7ff54132ab679db0` |
| bytes / lines | 210,667 / 7,043 | 210,755 / 7,045 |
| ADT.r equality | absent | present at `production-adtfix.ts:2939-2945` |
| provenance/lock `comp.ts` pin | `b68bfe1a`, 199,273 B | `b68bfe1a`, 199,273 B (stale) |

The da753a093e diff against 6c3d8a643e is exactly the two ADT.r lines,
plus the source-only fixture `bend2/test/compiler/arm_eq_adt_r.ts`. The
fixture imports `comp.ts` after appending `export { arm_eq }`, builds two
`Lam/Ann/ADT` terms that differ only in `r`, and expects `arm_eq = false`.
It was not run (no compiler checks under the #970 hold).

Correction to the team record `knowledge-record:e2108c1561ea08e4f63007562a0b3643`:
the claim that `r` “is not read by comp.ts” is inaccurate. `comp.ts` calls
`Bend.book_adt` in `emit_match` (`production-adtfix.ts:3138`, `:3655`), and
`book_adt` filters constructors by `tm.r` (`bend-production.ts:996-1006`).
The ADT.r equality is emission-relevant, not merely structural, so the
da753a093e hunk is required.

### Remaining gap: Ref.b is not compared

`arm_eq`'s `Ref` case is `return x.k === (y as Of<"Ref">).k`
(`production-adtfix.ts:2892`). `Ref.b` is the bang marker and is
codegen-relevant: `term_spine` builds `bang: (c as Of<"Ref">).b`
(`production-adtfix.ts:823`), `carb_book` adds the name to `cb.bangs`
(`:1537`), the flat decision reads `ck.bang` (`:1549`, `:1576`), and
`emit_fuse` sets `fl.seg.fork ||= bang` (`:2136-2138`). Two arm bodies that
differ only in a bang reference therefore compare equal; a hint collision
could share the non-bang body for a bang call (or the reverse). The public
`term_compare EQ` ignores `b` for type equality, but this gate authorizes
emission sharing. Recommendation: compare `(x.b ?? false) === (y.b ?? false)`
in the `Ref` case. No fixture with a duplicated bang-reference arm was found
in the reviewed set, so this is structural, not observed.

### Pin/package still stale

Both 6c3d8a643e and da753a093e leave
`bend2/compiler/repl-upstream.provenance.json` and
`repl-upstream.lock.json` pinning `comp.ts` `b68bfe1a`, 199,273 B. The
committed upstream source is `226c3eee…`, 210,755 B at head. Acceptance is the
capture-aware path/pin/package; the pin must be regenerated or the candidate
is incomplete for deployment.

The pending measurement plan in section 7 applies to the head with the
`comp.ts:226c3eee` pin; no measurement has been run.
