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

## 10. Continuation: per-file armHints, fixed-point passes, capture accounting

Reviewed pins (both present in the consolidation object store):

| Target | Commit | `comp.ts` sha256 | bytes / lines |
| --- | --- | --- | --- |
| Published production tip | `55fb5c28cb` | `982aa9b9f6b737b55075008d9db672e2b67ecc882480d9d83717dba0e76e8c36` | 210,838 / 7,048 |
| Main-integration port (f38) | `5ddcd98a` | `1fa4be27…1b75644` | 221,374 / 7,384 |
| Main-integration port (e8d5) | `cd80b1a6` | `1fa4be27…1b75644` | 221,374 / 7,384 |

The production tip includes `ADT.r` (`da753a093e`), `Ref.b` (`8fc792aab4`)
and the busy-equal inline fallback (`55fb5c28cb`). Both integration tips carry
the same capture/arm-sharing code at shifted line numbers (`capture_order`
3296, `capKs` 3358, `armHints.set` 3384, `compile_def` 3544,
`emission_defs` 3694); the extra lines are main-based code, not a different
sharing implementation. The task's `226c3eee` pin is `da753a093e`, not the
published tip; the exact published pin is `982aa9b9`.

### Topic 1: per-file armHints retention

`File` carries `armSeq`, `armBusy`, `armHints` (`production-tip.ts:124-126`);
an `ArmRep` is `{term, name, lay, ks, caps}` (`:151`). `file_new` initializes
the map (`:1613`). A representative is appended at `:3065-3069`
(`arm_<seq>`, `rec`, `armHints.set`), the busy set at `:3070`, cleared at
`:3099`. `compile_def` resets `fresh`, `brwl`, `rest` and `armBusy` only
(`:3228`), so `armHints` persists across every definition in the pass.

Retention:

- `term` is a reference to the arm `HTerm` from the definition's checked body;
  the same tree is already retained by `cb.book.tlds[k].h`. The map does not
  copy term trees.
- Per representative the additional objects are the `ArmRep` object, the
  `reps` array slot, the hint string (spans/kinds/layouts; tens to hundreds of
  bytes), `ks` and `caps` arrays, and references to `lay`/`Probe` objects that
  are shared with the book/environment.
- The map is freed when the pass's `File` becomes unreachable after
  `compile_book` builds the fills and returns; `armSeq` is just a number.

Per-definition clearing is semantics-safe: a cross-definition hit requires the
same hint, the same layout/word counts and `arm_eq` (`:3050-3055`); clearing
only removes candidates, so the fallback is a new spin or inline emission. It
would bound the map and free the hint strings/arrays per definition, but it
would not free the term trees, because the book retains them. The plausible
RSS impact is therefore the map metadata (a few tens of MB at thousands of
representatives), not the 25->51.7 GiB climb in the perf sample. This topic
cannot alone explain the allocation-dominated profile.

### Topic 2: fixed-point pass duplication

`BEND_FACTS_ONLY_FIRST` is off by default (`production-tip.ts:43-44`).
`stable_defs` and `emission_defs` are computed once before any pass
(`:3374-3375`); `pass` creates a fresh `File`, fills the cid map for every
ADT, calls `compile_def` for every definition, runs `facts_lend`, and counts
lines/units/spins (`:3379-3412`).

With the default, only the real loop runs:

```ts
do {
  was = facts();
  fl = pass(emission_defs, false);
} while (was !== facts());
```

(`production-tip.ts:3428-3432`). Each iteration re-emits the whole book and
retains all `seg.lines`, spin source, tables, constants and fresh maps; only
the last `File` is used for the output, and the previous pass's `File` is
garbage. That duplicated emission is the main per-pass allocation, and it can
repeat until `own/hot/stat` stabilize.

If `BEND_FACTS_ONLY_FIRST=1`, the dry loop runs
`pass(done_defs(cb).reverse(), true)` until stable (`:3418-3426`), with a
fresh definition list per iteration, and then the real loop uses the
`emission_defs` computed before the dry loop. `emit_arm_shared` returns false
in dry (`:3039`), so the dry passes inline the shared arms while the real pass
shares them. The comment claims the dry passes compute the same facts as
emission; the sharing asymmetry means that claim needs proof when sharing
changes `hot`/`stat` (the spin and inline paths bind/emit under different
`dst`/`uses`/`spares` contexts). The real loop still converges on facts, but
the definition order is not recomputed after the dry loop and the dry work is
additional. Under the default the asymmetry is latent, not active.

### Topic 3: capture sharing and ownership accounting

`capture_order` (`production-tip.ts:2990-3008`) walks the term's first-use
order, using `fl.uses` by probe index and skipping probes absent from scope.
`emit_arm_shared` computes `u = term_uses(h)` and `caps`, and falls back
inline when any used probe lacks a capture (`:3036-3039`). `capKs` flattens
the captures' layouts (`:3043`); `capWs` flattens the capture words at either
the hit path (`:3056-3060`) or the new-spin path (`:3100-3104`), each doing

```ts
const use = term_use(u, p);
fl.uses.set(p, { ...b, n: b.n - use + 1 });
return val_own(fl, bind_pop(fl, p));
```

The `use` uses move into the spin; `+1` reserves the single use of the value
passed to the call; `bind_pop` transfers ownership for the call. This mirrors
`emit_clo`'s capture accounting (`:2645-2649`). Inside the new spin the
captures are bound with `bind_uses(..., [h], b.A, false)` (`:3086-3090`), so
the spin's copied uses map carries the same `use` count.

Checked paths:

- `capture_order` deduplicates by probe index; a probe cannot appear twice in
  `caps`.
- The busy check is before the `capWs` loop (`:3055`), so a busy equal
  representative returns inline without consuming captures.
- The hit path passes the current site's captures; the rep stores only
  `Probe[]` for the count check. Positional correctness relies on the
  alpha-equality `arm_eq` and the identical first-use order of the two terms;
  no path passes a rep's own capture values or re-binds them.
- A missing capture is caught by the `u.length > caps.length` gate before any
  consumption.

No remaining source path was found that duplicates or drops a capture value.
The residual risk is the alpha-order assumption: `arm_eq` maps free variables
by first occurrence and `capture_order` walks runtime children; the two
traversals agree for the shared kinds, but a future change to either traversal
must preserve that correspondence.

### Baseline correlation (uncertain)

The perf sample (`knowledge-record:084b34f11911c8ac3bf8205c89b76fab`) shows
~26% anonymous JIT, ~30% kernel anonymous-page allocation/fault handling and
RSS 25->51.7 GiB over ~4.5 minutes, with no source attribution.

- Topic 2 (repeated full emission passes) is the most plausible
  allocation-heavy source among the three: each pass allocates the full C
  text, spin sources, tables and maps; repeated passes multiply that and the
  page-clearing profile is consistent with large string/heap allocation and
  GC. It is not proof: the loop may converge in one or two passes.
- Topic 1 (armHints metadata) can allocate the map/arrays/strings, but the
  term trees are shared with the book, so it cannot plausibly account for
  tens of GiB; per-definition clearing would not free the trees.
- Topic 3 (capture accounting) performs small per-call allocations and the
  sharing reduces emitted code; it cannot plausibly produce an
  allocation-dominated profile on its own.

The sample is one second of a long compile on a different pinned build
(`2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`, source `5df034e6`), so none
of these attributions is verified. A future queue-gated measurement should
record pass count, per-pass byte/line/spin totals, and armHints size/clear
impact.

### Queue-held measurement additions

The lane items in section 7 are unchanged. Add, when the #970 queue lands:
pass count per fixture (diagnostic pass.begin/end), armHints map size and
resident set with and without per-definition clearing, dry-vs-real fact
counts with `BEND_FACTS_ONLY_FIRST=1`, and a capture-accounting assertion
(sum of caller bind counts before/after a shared call equals the inspected
expectation).

## 11. Design reconciliation: `!def` narrowing and the dry gate

Source-only analysis for the main-integration candidate. No build, no
benchmark, no measured-regression claim. Baseline is `comp.ts` sha256
`dc33f3a0…` (7,310 lines, present at `e8d5ac89`); candidate is `comp.ts`
sha256 `1fa4be27…` (7,384 lines, e8d5 tip `cd80b1a6`, also f38 tip
`5ddcd98a`). The e8d5 branch is the merge candidate; the 55fb production
lineage is not analysed.

### Verified-fact corrections

- The baseline does not gate only on `term_uses`. Baseline `emit_arm_shared`
  starts at :3290; the closed-arm test is :3291-3293; the
  `has_segment_jump` guard is :3294-3303. The candidate keeps the same guard
  at :3348-3354. The guard is present in both trees; nothing here regresses
  it.
- `arm_eq` differs only in the `ADT` case: baseline :3249-3257 ignores
  `x.r`; candidate :3252-3260 requires equal `r` length and set membership.
  The `Ref` case is identical in both (:3196-3199 baseline, :3199-3202
  candidate), so there is no `Ref.b` difference between these two files.
- The candidate's dry passes return before the hint lookup
  (candidate :3344); baseline dry passes execute the hint, `arm_eq`, busy
  test and `emit_arm_call`, while retaining only the spin source behind
  `if (!fl.dry)` (baseline :3339-3348; candidate :3406-3415).

### Q1: Is `!def` required for capture-aware correctness?

No. For a closed arm, `term_uses(fl, h)` is empty, so `u = []` (:3355) and
`capture_order` returns `caps = []` (:3356). The capture path then reduces
to the baseline path:

- `capKs` is empty; `base` is built from `avKs`, `lay.ks` and `lay.arms`
  (:3358-3362). The joined hint gains a leading empty component, so it is a
  different bucket key from baseline, but every widened closed arm uses the
  same construction, so the bucket partitions closed arms consistently.
- The rep check requires `rep.ks.length === avKs.length`,
  `rep.caps.length === 0` and `arm_eq` (:3367-3377). With the candidate's
  stricter `ADT.r` equality this is a subset of baseline matches, so it can
  only split reps, never mis-share.
- The busy check (:3370) returns inline before any capture consumption; the
  coverage test `(u.length >> 1) > caps.length` (:3357) is false for a
  closed arm.
- `capWs` is empty, so `emit_arm_call` (:3427-3436) passes
  `["e", o, ...av words]`, the same argument list and `ent.lay`/`ent.ks` as
  baseline (baseline :3355-3363). The new-spin path binds no captures,
  builds `ks` as `avKs`, uses the same segment layout and emits the same
  body (:3380-3424; baseline :3319-3352).

The `!def` test is therefore scoping: it targets default and literal arms.
Closed non-default sharing can be preserved through the capture path with
no new semantics.

### Q2: Recommended gate structure and C-size effect

| Option | Behaviour | Assessment |
| --- | --- | --- |
| (a) drop `!def` | every arm reaches the capture path | restores closed sharing and adds sharing for open non-default arms, which baseline inlined; larger blast radius and possible wrapper overhead for single-use open arms |
| (b) two scopes | baseline closed path plus capture path | two hint formats and, if the baseline equality is reused, the weaker `ADT.r` equality that the fix removed; not recommended |
| (c) keep narrowing | closed non-default arms inline | loses the baseline size reduction; no new sharing |
| (d) closed-only widening | run one capture path; return inline when `!def` and `u.length !== 0` | restores exactly the baseline closed sharing (`caps = []`), keeps open non-default arms inline as baseline, and keeps one equality and one hint builder |

Recommendation: (d). Compute `u = term_uses(fl, h)` before the scope test
and use `if (!def && u.length !== 0) return false`, keeping the existing
guard order (segment jump, coverage, hint, rep/equality, busy, consume,
call). This is the narrowest change that recovers the five-overlap
reduction without exercising capture ownership on arm classes the baseline
never shared. Option (a) is acceptable only if the qualification includes
open non-default arms and confirms size; option (b) reintroduces a
correctness-relevant equality split; option (c) is safe but forfeits the
size fix.

Fixture estimate (source, not measured):

- `round2/fixtures/five-overlap.bend`: the retained 7658 -> 25 `WL_CASE`
  measurement came from sharing closed non-default arms. Under (c) those
  arms inline again, so `WL_CASE` and bytes rise toward the pre-sharing
  level. This is the fixture that must be measured for (d) and (c).
- `minimal.bend`, `pr890-shaped.bend`, `control-two-long.bend`,
  `control-literal-two.bend`: their top-level non-default cases bind
  captures, so baseline inlined them; (c) does not change them, while the
  candidate shares their open defaults. Flattened literal-prefix rows can
  still be closed; only measurement can size that contribution.
- `focused_literal.bend`, `string_match_sparse`, `word_match_cover_key`,
  `u32_table_bitvar`, `nat_pattern_deep`: literal arms use the `lit|` bucket
  and still share; U32/Nat matches use the `emit_lits`/`emit_nats`/
  `lits_rows` table path and do not reach `arms2` sharing. Expected
  unchanged under (c), except any closed non-default structural arms.
- The measured headroom at round 3 was minimal 513,186 B, pr890-shaped
  528,767 B, control-two-long 103,698 B, control-literal-two 150,092 B
  against gates 1,000,000 / 2,000,000 / 300,000 B. Controls have the least
  headroom, so a five-overlap-scale regression is the case to watch.

### Q3: Dry-gate reconciliation

`file_new` spreads the carb object (`...cb`, candidate :1917-1919), so
`fl.own`, `fl.hot`, `fl.stat` and `fl.sites` are the same objects as the
carb sets; every pass, dry or real, mutates the surviving facts.
`emission_defs` is computed before the dry loop from `done_defs(cb)`
(candidate :3693-3694), and `done_defs` filters only on `done_live`
(:1902-1905), not on own/hot/stat. Consequences:

- `sites` cannot change: it is built in `carb_book` (:1649) and read at
  :2920; no pass writes it.
- Which definitions are emitted cannot change: the list is every live
  definition, fixed before the dry loop; the dry `File` is discarded, and
  the reachability pass runs on the final real `File`.
- `INLINE`/`FAR` cannot change through dry: spins are pushed only when
  `!fl.dry` (candidate :3406; baseline :3339), so the `SPIN_FAR` test is
  decided only in real passes.
- `own`, `hot` and `stat` can differ: inline versus shared emission changes
  the segment context, and these sets feed `brw_of` (:1335-1340, cleared
  each pass at :3703), `facts_hot` (:2080-2135), static-constructor
  selection (:1257-1272), `CID_HOT_T` (:3642) and `BLK_SHR` (:3829). The
  real fixed point still converges, and the final pass is internally
  consistent because it emits definitions and calls from the same fact
  state, but the monotone union includes the dry contributions, so
  baseline and candidate can settle on different fact sets and therefore
  different static/hot/borrow choices when `BEND_FACTS_ONLY_FIRST=1`.

With `BEND_FACTS_ONLY_FIRST` off (the default), the dry loop never runs, so
the candidate's early-out cannot affect emitted C. The divergence matters
only for the env-gated path, and the comment at :3753-3755 ("These passes
compute the same monotone facts as emission") is then inaccurate.

Recommendation: restore baseline dry behaviour in the shared path
(execute hint/equality/busy/`emit_arm_call`, retain only the spin source
behind `if (!fl.dry)`) so the dry facts model the real sharing strategy and
the comment holds. If the team keeps the early-out, correct the comment and
carry the dry-versus-real measurement below; the default path is
unaffected either way.

### Q4: Interaction of widened sharing with the existing guards

Required order: segment-jump, coverage, hint, rep/`arm_eq`, busy, capture
consumption, call. The current candidate already has this order except for
the scope/dry return at :3344; (d) moves only the scope test after
`term_uses`.

- `ADT.r` strictness can only reduce matches; it cannot mis-share.
- Busy returns inline before any capture is consumed, so a nested reuse of
  the same arm leaves the caller's binds intact.
- `has_segment_jump` stays before hint lookup and rep creation, so no spin
  is created for a jumping arm.
- The `lit|` prefix separates literal buckets from structural buckets. A
  term used at both a literal and a structural site gets two reps and two
  spins; that is duplicate code, not incorrect sharing.
- With (a), open non-default arms would newly exercise capture ownership;
  with (d) they stay inline, so the only newly shared class is the closed
  one, which is baseline-equivalent. No new ordering hazard was found.

### Queue-held measurement additions

Qualification must include captured open/default arms and closed non-default
controls, with dry-versus-real fact comparison:

1. `round2/fixtures/five-overlap.bend` under (c) and (d): C bytes,
   `WL_CASE`, spin count, sha256; the retained 7658 -> 25 count is the
   comparison point.
2. The repro gates (`minimal`, `pr890-shaped`, `control-two-long`,
   `control-literal-two`) under (c) and (d) to confirm the source estimate
   that their open non-default arms are unchanged.
3. One fixture with a captured open default arm and one with a closed
   non-default arm, each emitted with and without `BEND_FACTS_ONLY_FIRST=1`;
   record dry and real `own/hot/stat` sizes per pass, `CID_HOT_T`/`BLK_SHR`,
   and final C bytes/sha256.
4. A capture-accounting assertion across a widened shared call (sum of
   caller bind counts before/after equals the inspected expectation).
