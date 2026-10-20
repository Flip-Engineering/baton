# Capture sharing port to the current 2.0.25 consumer source

## Lineage

- Old round branch: `baton/compiler-upstream-capture-20261019`
- Old round commit: `9c190a0d74` (source `4967a877d3`, design report `9c190a0d74`)
- Old round base: `f102ffafbd`; its `comp.ts` sha256 is `ad8b8213...` (the 2.0.25 baseline)
- Current public canonical 2.0.25 consumer source: `bend2/comp.ts` sha256
  `b68bfe1a306c1d89d12b07cbd86012cea873c06986cf191270e65941bae4efda`
  (publication 27629713, source commit `27629713d24898cfaa24d8f62352142743518157`, recorded in
  `fork-manifest.json`)
- Current Baton main `e8d5ac89` is a separate revision. It is not present in this worktree and is
  not the port base.
- This branch: `baton/compiler-capture-consumer-20261020`, created from `9c190a0d74`. The port
  commit is the tip of this branch. The old round branch remains unchanged.

## Port contents

- `consumer/bend2/comp.ts`: the current consumer source, unmodified
  (`b68bfe1a...`).
- `ported/bend2/comp.ts`: the current consumer source with the capture-sharing alternative
  (`2641e4a3...`).
- `consumer-capture.patch`: the source diff from `consumer/bend2/comp.ts` to
  `ported/bend2/comp.ts` (`c523fd5d...`). It applies to the consumer tree root with
  `git apply -p1`.

The merge keeps the consumer source's diagnostics, dry facts pass, WeakMap caches, compile book
changes and `diagnostic_join` paths.

The port adds one consumer-specific guard: `emit_arm_shared` returns false when `fl.dry`. The dry
facts pass keeps inline emission and records no arm bodies. The real pass emits the shared bodies,
the forward declarations and the calls.

## Candidate

The candidate is the source-only alternative described in
`docs/design/arm-capture-sharing.md` at `9c190a0d74`, applied to the current consumer source:

- `File` records `armSeq`, `armBusy` and `armHints`.
- `arm_hint` narrows candidates by term shape, span and layout.
- `arm_eq` compares the whole term with alpha-equality over bound and free variables.
- `capture_order` records free probes in first-use order.
- `emit_arm_shared` emits one body per structural family and falls back to inline emission on a
  missing capture, a layout or arity difference, an unequal term, an active body or a dry pass.
- `emit_arm_call` owns each capture once and calls the body.
- `Spins` emits a `static` forward declaration for each `INLINE` or `FAR` body.

## Evidence

- The patch applies to a fresh copy of the current consumer source (`git apply --check -p1`
  succeeded).
- The consumer source and ported source hashes are recorded above.
- No compiler, clang, Cgen, build or test was run. No heavy validation was started.

## Speedup claims

The old closed-arm-only fixture measurements do not measure this port. This packet makes no speedup
claim. The port is source-only and unqualified.

## Remaining concerns

1. The port is not compiled; `arm_eq`, the TypeScript types and the consumer dry-pass integration
   have no compiler check in this packet.
2. `arm_eq` is hand-written over the term union; a missed field can merge unequal arms.
3. `capture_order` relies on `term_kids`; a probe counted by `term_uses` and missed by `term_kids`
   selects inline emission through the count guard.
4. `armHints` persists across definitions in the real pass; cross-definition reuse depends on the
   key and the capture values.
5. The C signature uses layout kinds; a capture with a wider C type than its use passes one value.
6. The final candidate needs review and qualification against this consumer source. The Cgen
   comparison, helper build and runtime qualification remain unrun.

## Review and qualification

The final candidate is `ported/bend2/comp.ts` plus `consumer-capture.patch`. Root reviews and
qualifies it against the current consumer source. The root queue route is the validation path.
