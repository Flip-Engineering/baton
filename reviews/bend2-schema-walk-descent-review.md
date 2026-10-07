# Bend 2.0.25 walk shape: what the termination check accepts

This records the walk shape that passes the pin's termination check, with the imports seat's
evidence, and the read-only review of the schema seat's iteration 15
(`worktrees/integration-schema-muse-20261006/bend2/src/context/codec-schema.bend`). No schema source
was modified.

## What the check accepts

`docs/bend2/reference/upstream/WONTFIX.txt` ("The termination check reads arguments left to right
(#770)") and the guide's *Recursion and Termination* section give the rule: in a self-call the
arguments are read left to right, each is passed through unchanged until one is a strict subterm of
its parameter, and the arguments after it are unconstrained.

Three consequences bound the design of a recursive walk:

1. A value built at the call site (`Ctor{...}`) never decreases, whichever parameter it stands for.
2. `let x = ...` followed by `match x:` is refused ("a match heads a def body, not a term"), so a
   computed scrutinee needs its own definition.
3. Nested matches on parameters follow declaration order. Matching a later parameter and then an
   earlier one is refused ("a match on a parameter or field (this name is a def or a consumed binder:
   give the value its own def)"); matching a later parameter first is accepted.

## The shape that passes (codec-wire.bend, this branch)

- One self-recursive definition whose **first parameter is the descending operand** and whose
  continuation mode is a **later parameter**: `def wire_value_text(+v: Codec.RawValue, +mode: String)
  -> String`. The body matches `v` first and nests the mode match inside the two container arms.
- Every self-call hands back a part of `v` as argument 1 — `head`, `tail`, `value`, `rest` — and the
  mode follows it: `wire_value_text(head, "value")`, `wire_value_text(tail, "items")`,
  `wire_value_text(rest, "members")`.
- Constructor arms whose result is mode-independent call non-recursive helpers that take the mode
  first: `wire_mode_close`, `wire_atom_text`, `wire_nil_text` and `wire_empty_arr_text` for the
  encoder, `wire_atom_ok` and `wire_ok_nil` for the value rule. The arm count stays one per
  constructor, with the mode split only inside the container arms.
- Entry points stay non-recursive: `def wire_value(+v) = wire_value_text(v, "value")`.
- `wire_value_ok(+v, +mode)` uses the same shape.
- A closed mode type works where a mistyped position must be unrepresentable: declare the mode as
  Data and let the helpers match it. codec-wire keeps the mode as `String` because the two
  continuation names are transport text the JSON encoder already spells.

## Evidence

Remote runner `atari-homelab`, bend 2.0.25 (`sha256
d9c0dad1f77be6a13dd8dcc16aef4f59047a956a2744f25d5c220cb8de384693`), clang-19.

| Evidence | Result |
|---|---|
| `baton-imports-deepseek-20261006/r15-final/evidence.json` | exit 0; `codec-wire.bend` and `codec-convert.bend` "All terms check." at archive sha256 `6a9fbf5f394a05fb7f225aa4a754927317bea0ace9496da129bec37a3c14e609` |
| `check-zz-probe` in the same run | status 0; the 34 equivalence laws hold by reduction |
| `r14-native-probe/evidence.json` | exit 0; 34 comparisons `ok`, "probe: all comparisons agree" |

The equivalence probe keeps the pre-restructure formulation verbatim, marked `@unsafe` because its
parameter order fails the check, and states for 17 raw values × 4 modes × both functions that the
shipped walk returns the same text and the same verdict. The probe is not checked in.

## Findings: the schema seat's iteration 15

`json_walk(work: JsonWork)` (line 521) matches `work`, and all 7 of its self-calls pass a constructed
wrapper: `json_walk(JwValue{head})`, `json_walk(JwValue{val})`, `json_walk(JwItems{tail})`,
`json_walk(JwMembers{members})`, `json_walk(JwMembers{tail})`. `JsonWork` (line 95) holds only
`Codec.RawValue` fields, so no subterm of `work` has type `JsonWork` and no self-call can decrease
argument 1.

`schema_walk(+defs: SchemaDefs, work: SchemaWork)` (line 551) has the same shape: argument 1
(`defs`) is unchanged in all 15 self-calls and argument 2 is a constructed `WValue{…}`,
`WFields{…}`, `WArrayItems{…}` or `WDictValues{…}`. The `JsonWork` finding applies to `SchemaWork` by
the same argument.

The remainder of the file is structurally sound. The scan that reports 35 findings against the root
copy of `codec-schema.bend` — forward references, named constructor terms, incomplete `Bool.pick`
calls and one nested-match order defect — reports 0 against this copy.

### The rewrite that keeps its semantics

1. `json_walk(+value: Codec.RawValue, +mode: JsonMode)` with
   `type JsonMode is Data: JmValue{} JmItems{} JmMembers{}`; match `value` first and the mode inside
   each arm; recursive calls pass `head`, `tail` or `val` first.
2. `schema_walk(+defs: SchemaDefs, +form: SchemaForm, +input: Codec.RawValue)`. The form is the
   shrinker and precedes the input, so `schema_walk(defs, fields, input_obj_members_or(input,
   Codec.Rnil{}))` passes argument 1 unchanged, argument 2 a part of the matched form, and the
   computed input after it, which the check allows. The present signature pairs the form with the
   input in `SchemaWork`, so the input-driven calls (`array_head_or`, a definition body read from
   `defs`) have no expressible position.
3. The vocabulary stays closed: the mode and the form are Data types, so an unsupported position
   still cannot be built, and helpers that take the mode first hold the mode-independent results.

### One condition label to confirm

`keys_unique` (line 141) returns `False` for a member spine that is neither `Rpair` nor `Rnil`, so
`JwValue`'s `Robj{members}` arm answers `SvRefused{"duplicateKey"}` for such a spine while its
`JwMembers` arm would answer `wrongKind`. A decoded tree always carries a well-formed spine, so the
point concerns a constructed input to `json_admit` and the `wrongKind` arm of `JwMembers`, which no
call site reaches. Confirm which condition a constructed malformed spine should report and whether
that arm is intended to stay.
