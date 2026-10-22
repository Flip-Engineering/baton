# Match arm capture sharing

## Scope

This report describes a candidate change to the Bend 2.0.25 C generator in
`bend2/compiler/upstream/comp.ts`. The candidate changes match arm emission. The generated C,
the runtime ABI and the CLI ABI keep their current shape.

The candidate is covered by the tests named in Evidence. The branch records no Cgen size or build-time
measurement.

## Problem

`emit_match` emits each arm body at the arm's column. The flattener duplicates an arm body into
several columns when the arm's free probes have the same use structure and layouts. Each copy
carries the same operations and produces a separate machine-code function.

## Representation

`ArmRep` records one emitted body: the term, the generated function name, the result
layout, the parameter kinds and the captured probes.

`File` carries three fields:

- `armSeq`: the next body number.
- `armBusy`: body names currently being emitted.
- `armHints`: candidate bodies keyed by a shape and layout string.

`file_new` initializes the fields. `emit_arm_shared` adds a body name to `armBusy` before it emits the
body and removes the name after.
`armHints` persists across definitions so a body can serve equal arms in different definitions. The
body depends on captured values and its own term, so the definition that first emits it does not
constrain the later callers.

## Candidate selection

`arm_hint` builds a string from the source span and node kind of the first three terms, skipping `Ann`
and `Lam` wrappers, followed by the span and node kind of the innermost term. The hint narrows the
candidate list. `arm_eq` decides reuse.

`arm_eq` compares two terms structurally:

- `Var`: a bound variable matches by binder distance; a free variable matches another free variable
  in the same first-use order.
- `Lam`: compares the quantifier tag (an absent quantifier differs from an explicit one), binds the
  parameter, and compares the bodies.
- `Let`: compares the value count, the quantifier tags, the values, and the bodies with the pattern
  variables bound.
- `App`, `Rwt`, `Eql`, `Min`, `Typ`: compares every child.
- `Ctr`: compares the kind, the arity and every child.
- `Mat`: compares the kind and both children.
- `Ann`: compares the expression and the annotated type. An identical annotation object is equal
  without traversal.
- `ADT`: compares the kind, the arity, every child, and the remaining-constructor set `r`.
- `Ref`: compares the kind and the bang flag.
- `Hol`: compares the kind. `Qua`: compares the quantifier tag.
- `Lit`: compares the literal value as JSON.
- `All`: compares the quantifier, the domain, and the body under a synthetic binder.
- `Sub`: always unequal. Its index is a substitution index, not a binder, so an arm that contains one is
  never shared.
- `Qnt`, `Rfl`, `Efq`: no child terms; equal.
- The default case returns false. A new term form falls back to inline emission until `arm_eq`
  handles it.

The comparison is alpha-equality. The hint can group unequal arms; `arm_eq` rejects them.

## Capture order

`capture_order` walks the arm term in first-use order. It records each free probe that
`term_uses` counts and that has a binding in `fl.uses`. The list fixes the spin parameter order and
the call argument order.

The spin parameter kinds are `capKs ++ avKs`; `capKs` comes from each capture binding's layout,
`avKs` from the arm's value arguments.

A free probe without a binding in `fl.uses` cannot become a parameter. `emit_arm_shared` compares
the distinct free probe count with the capture count. A difference selects inline emission, which
keeps the name bound. The shared body receives every free probe as a capture.

## Body and call

`emit_arm_shared` is called for every arm of a match. It shares a body when the arm is a default (`def`:
the last arm with an empty condition, or a literal default) or when the arm has no free probes. Any
other arm returns false and keeps the inline path. The other arms keep their guards in `emit_chain`.

The first arm in a family emits a body. The body has the capture parameters and the arm's value
parameters. For each capture, `bind_uses` binds the spin parameter to the capture's binding, using
the arm term for the use count and the binding's tail flag. The body's return layout is the arm's
`dst` layout, or the segment's return layout when the arm has no destination. `emit_body` fills the
body. The body is appended to `fl.spins` with an `INLINE` or `FAR` marker.

`emit_arm_call` emits a local `Term o[N]` and a call to the body. A zero result returns
zero from the enclosing function. A nonzero result writes the arm's destination.

The arm captures are owned once for the call. The binding count for each capture becomes
`b.n - use + 1`: the arm's `use` uses are replaced by one call argument. The capture call arguments
are emitted after the body is restored, so they read the outer binding state.

The body emits under `fl.armBusy`; a recursive arm that reaches the same body while it is active
keeps the inline path.

## Call sites

`emit_match` builds the arm values once and passes them to `emit_arm_shared`. The default
arm is the last level with an empty condition. A body that is not emitted falls back to `emit_body`
with the same values.

The `Spins` section emits a `static` prototype for every body before the definitions.
The prototype strips the `INLINE`/`FAR` marker. Definitions follow the prototypes. All bodies are
visible in the file.

## Unchanged behavior

- The `Efq` and `IO.OP` refusal path keeps its guard.
- An arm with free probes that is not a default arm keeps the inline body.
- An arm with a capture missing from `fl.uses` keeps the inline body.
- An arm with a different layout, parameter count or capture count keeps the inline body.
- An arm with an unequal term keeps the inline body.
- The ABI, the CLI and the runtime are unchanged.

## Risks and limits

- The branch records no Cgen size or build-time measurement.
- `arm_eq` is hand-written over the term union. A missing field can merge unequal arms. The default
  case and the tests should cover new term forms.
- `capture_order` depends on `term_kids`; a probe that `term_uses` counts and `term_kids` misses
  causes the count guard to select inline emission.
- `armHints` persists across definitions. Reuse across definitions depends on the capture values
  and the body term; the key includes the capture and result layouts.
- The body's C signature uses the layout kinds. A capture with a wider C type than its use requires
  passes one value.
- The candidate does not estimate the generated C reduction. The Cgen comparison measures it.

## Evidence

- First candidate: source commit `4967a877d3` on base `76681ac97`.
- Ported onto main by `fix/compiler776-capture-main-integration-e8d5-20261020` (16 commits on main
  `e8d5ac89`). The `arm_eq` and literal default code in this document is the version in that
  branch, not the version in `4967a877d3`.
- Tests: `bend2/test/compiler-arm-sharing.py` runs the Bun compiler on `bend2/compiler/upstream` and the
  fixtures in `bend2/test/compiler/fixtures`.
