# Independent review: seat1 round-3 commit 1e5eb5b09f

Reviewed commit `1e5eb5b09f957d49b662909c195a0ed568a0e8f3` ("Cut shared-arm
key cost with a span hint plus equality"), file
`round2/compiler-src/bend2/comp.ts` sha256
`3891083b818c42c2ed1aaa6544ee3651a7228615bbbf0b0608a88b4308e74853`,
against the pinned base `comp.ts a2a949ae7f1c8520d8a112aa505b4c5440baad861dc912e410bfb501369112bc`.

The sibling working tree at `../1` currently has an uncommitted `comp.ts`
(`7cc3394b45f6139011bf8141eff917497cbd5991171ca87ec449d66cf1894ba6`). Its only
functional difference from the commit is the busy-equal branch (see F2). The
review below covers the committed file; the working-tree edit is the narrow
inline-fallback correction the assignment asks about.

## Verdict

The reuse gate is structurally sound on the executed evidence. A deliberately
maximal hint collision (every arm with the same layouts in one bucket) still
produces correct C: `arm_eq` decides every reuse. Generated C matches the
pinned baseline on the four protected U32/Nat fixtures, and the repro argv
matrix is identical (18 cases, 0 diffs). Two concrete equality gaps remain in
`arm_eq`, and the busy-equal path is safe but should take the conservative
inline fallback that is currently uncommitted.

## Findings

### F1 (medium): `arm_eq` ignores binder quantities and `Ann.T`

`arm_eq` (`comp.ts:3162`) is the only reuse gate. Its `Lam` case
(`comp.ts:3195`) compares the opened bodies but not `x.q`; its `Let` case
(`comp.ts:3202`) compares values and bodies but not `x.q`; its `Ann` case
(`comp.ts:3223`) drops `T`. `All` (`:3253`), `Sub` (`:3241`), `Typ` (`:3236`),
`Qua` (`:3239`) and `Hol` (`:3240`) are handled, and the default (`:3263`)
returns false, so the reported Typ/Qua/Hol work is correct.

`Let.q` is semantic: `let_live` (`comp.ts:801`) reads `t.q` to decide whether
each let binding is emitted and freed. Two closed arms whose bodies are
alpha-equal but whose let quantities differ (for example a `-x = v` copy and a
`x = v` copy at different match columns) pass `arm_eq`; the shared spin is
emitted with the first site's quantities, so the later site can free or keep
the binding differently. The checked `Ann.T` is also ignored and is read by
`ty_peel` when the spin body is emitted, so a type difference that changes
erasure or layout is invisible to the gate. `Lam.q` is part of the equality
term as well, although emission reads the binder quantity from the type; it
should be compared for consistency. None of these facets is in the hint base,
which holds only `ks`, `lay.ks` and the arm names. The executed fixtures did
not exercise a quantity or annotation difference.

Requested correction: compare `q` in the `Lam` and `Let` cases (the `All` case
already compares it with `JSON.stringify`), and compare `Ann.T` with `go`, or
document why the checker guarantees identical quantities and annotations for
terms that reach the same hint.

### F2 (low): busy representative path

Committed loop (`comp.ts:3281`):

```ts
for (const rep of reps) {
  if (!fl.armBusy.has(rep.name) && arm_eq(rep.term, h)) {
    emit_arm_call(fl, rep, av, dst);
    return true;
  }
}
```

A busy equal representative is skipped and the code creates another
representative. Measured on `minimal.bend` with the committed file:
`BUSY_UNEQ=2184`, `BUSY_EQ=0`, `HIT=1458`, `NEW=214`. Boundedness: `armBusy`
holds the stack of spins whose bodies are being emitted; a nested arm is a
proper subterm of every busy ancestor. Structural alpha-equality preserves
size and shape, so a finite acyclic arm cannot contain a proper subterm equal
to itself. A nested equal-to-busy occurrence is therefore impossible; every
busy skip is an unequal term, which the equality gate would reject anyway.
Generation descends into proper subterms, so depth is bounded by term depth
and representatives by distinct closed arms. The argument assumes acyclic
HTerms; a cycle would already hang `term_force`/`arm_eq`.

The uncommitted working-tree change returns false on a busy equal rep:

```ts
if (arm_eq(rep.term, h)) {
  if (fl.armBusy.has(rep.name)) {
    return false;
  }
  ...
}
```

That is the conservative inline fallback and restores the previous
behavior if an equal nested occurrence ever appears. Recommend committing it.

### F3 (informational): hint bucket scan

The hint (`arm_hint`, `comp.ts:3132`) keeps only outer spans/kinds, the
innermost body span and the layouts. Hint buckets hold representatives; the
scan is linear in the bucket. In `minimal.bend` the largest prior bucket was
41, with 214 new representatives and no unequal-hint collision (`UNEQ=0`).
A program that gives many unequal closed terms the same spans, kinds and
layouts would scan a longer bucket per site; correctness still rests on
`arm_eq`. The collapse test below shows correctness under maximal collisions.

### F4 (minor): unreachable arm segment

`emit_arm_shared` pushes the arm's segment to `fl.segs` (`comp.ts:3293`) in
addition to pushing the spin source. The segment is not referenced by its
`FID_ARM_N`; the reach pass drops it. The four `FID_ARM_*` `WL_CASE` entries in
the emitted `minimal` C are closure segments created inside spins
(`FID_ARM_68_C71` etc.), not duplicated arm bodies. No emitted duplication was
found; removing the `fl.segs.push` would avoid creating the dead segment.

## Verified points

- Deliberate hint collision: `arm_hint` replaced by a constant in a scratch
  copy (`patches/collapse-arm-hint.patch`), so every arm with the same
  argument/result layouts shares a bucket. The committed compiler still
  executes correctly: `nat_pattern_deep` 306n, `u32_table_bitvar`
  `2496 2397`, `word_match_cover_key`
  `2139095040 2143289344 0 0 2139095040 2143289344`, `match_default` 0n,
  `minimal` argv `host`.
- Nested spin declaration order: 107 prototypes, 107 definitions, no missing
  or extra; 766 calls to spins defined later in the file; 0 self calls;
  clang-19 builds every generated C.
- Closed-arm provenance: the `term_uses` guard (`comp.ts:3273`) rejects open
  arms (`OPEN=0` in `minimal`); the call passes exactly the arm's `av` words
  in the hint's layout order.
- Executed C on the four protected fixtures matches the pinned baseline:
  `nat_pattern_deep` 306n, `u32_table_bitvar` `2496 2397`,
  `word_match_cover_key` `2139095040 2143289344 0 0 2139095040 2143289344`,
  `match_default` 0n.
- Check-only passes the four protected fixtures with the committed compiler.
- Repro argv: 18 cases over the four repro fixtures, identical stdout and
  exit status between the committed compiler and the pinned baseline.

## Evidence

- `evidence/executed-c.txt`: baseline vs committed outputs and the collapse
  outputs.
- `evidence/arm-trace.txt`: arm event counts, bucket size, prototype counts.
- `patches/trace-arm-events.patch`: logging-only instrumentation used for the
  counts.
- `patches/collapse-arm-hint.patch`: the deliberate maximal-collision test.

No full Main, no recovery-helper build, and no clang of the giant entry were
run. The generated C executions are the four protected fixtures and the repro
binaries.
