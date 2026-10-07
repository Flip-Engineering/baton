# Custody-task fixture: checks and mutation controls

Scope: the pure decisions in `bend2/src/context/custody-tasks.bend`. This directory
holds the fixture (`custody-tasks.bend`) and its runner (`run.py`). Nothing here
builds or runs on the operator laptop; every compiler check, build and fixture run
happens on a remote runner with an exact source transport.

Source: `05a2a94c9e236ea5a740a7620305c6575332b136`, tree
`7171ea0243be22e4a9c39282ac19937c0b1f5046`. Toolchain: bend 2.0.25, host compiler
clang 19.1.1, Linux x86_64.

## Fixture checks

`run.py` builds the fixture and runs it in five modes. Mode `laws` prints one line
per decision check and exits 1 with the check's own name on stderr when a check
fails; `die`, `try`, `stopped` and `result` re-run the process-halt semantics.

The decision checks added here cover:

- `differing-attempt-refused-as-unknown`, `differing-directory-refused-as-unknown`:
  a differing attempt identity resolves to the typed `Fail{UnknownAttempt{}}`, for a
  differing id and for a differing directory at the same id, session, cutoff and
  generation.
- `rebuild-settled-delivery-clears-the-wake`: `rebuild` over a settled delivery
  reference returns a duty that stays open and owes no wake.
- `all-done-refs-retire-without-errors`: a duty whose five references are all
  `Done` and which owes nothing is closed and retains no error text.
- `advanced-slot-accepts-its-generation`, `attempt-check-after-advance-slot`: after
  `advance_slot` to generation 3, the active slot accepts that generation and
  `check_attempt` still validates a duty admitted at generation 2.

The checks the fixture already carried are unchanged except that
`differing-attempt-refused` is replaced by the two exact-refusal checks above, which
subsume it.

## Mutation controls

`run.py` applies one source mutation at a time to a scratch copy of the module,
rebuilds, and keeps every child's raw stdout, stderr and exit. Three operative
decision sites are mutated.

| mutation | mutated site | gate refusal after baseline stripping | isolation build exit | isolation run exit | first failing check |
| --- | --- | --- | --- | --- | --- |
| `fail-delivery-fulfills-wake` | `fulfilled`: a `RefFail` records fulfillment | `acknowledged_attempt_with_owed_notice_stays_a_duty` | 0 | 1 | `failed-delivery-settles-and-leaves-wake-owed` |
| `ack-cleared-without-marker` | `record_ack`: the recorded reference replaces the marker as clearing evidence | `an_ack_without_marker_evidence_keeps_the_responsibility` | 0 | 1 | `ack-without-marker-keeps-duty-open` |
| `historical-validation-reads-the-slot-generation` | `check_attempt`: validation also compares the duty's admission generation with the generation of the replaced slot | none | 0 | 1 | `attempt-check-after-advance-slot` |

Each mutation is observed twice. The law gate is the module's own compile-time
control; the runtime isolation is the fixture's control, and it is the control that
covers the third mutation, whose law the gate cannot check (see below). Mutation
`fail-delivery-fulfills-wake` changes what fulfillment means, so the gate refuses
several laws and the table records the first one.

The runner re-verifies every owned hash and rebuilds the fixture from the restored
worktree: the restored source produces the same buildable source
(`0ab4a84ad7a1b7b0…`), the same gate result, and all checks pass.

## Law gate

The module declares 22 inline laws. The gate refuses seven of them on the unmutated
source in bend 2.0.25:

```
attempt_validation_reads_the_attempt_record_not_the_slot
owner_check_decides_on_binding_and_token
a_differing_attempt_is_refused_as_unknown
slot_check_accepts_the_current_generation
slot_check_decides_on_generation_equality
a_replaced_slot_refuses_a_superseded_generation
a_failed_continuation_retains_its_error_and_the_owed_flags
```

Each refusal prints an expected and an observed normal form that differ only in
whether a symbolic comparison was discharged, for example:

```
Error:
- expected : Bool.pick(Result<&1, &1, ...Duty>, Bool.and(String.eq.fin(String.cmp(...binding_of(owner), ...binding_of(owner))), ...), Done{...}, Fail{...})
- observed : Done{...Duty{owner, attempt, ...Results{RefOpen{}, ...}, False{}, True{}, True{}, ""}}
Location: ...custody-tasks.attempt_validation_reads_the_attempt_record_not_the_slot
393 | def attempt_validation_reads_the_attempt_record_not_the_slot(owner,attempt,slot,next):
394>|   {==}
```

These laws quantify over symbolic `String` and `U32` values and are proved with a
`{==}` body, so the gate has to discharge `String.eq(String.cmp(x, x))` and
`U32.is_eq(U32.cmp(x, x))` symbolically, which it does not do. A law stated in that
shape cannot be a control for this module until it is restated over structured
inputs or supplied with a proof that matches on constructors, in the style of
`docs/bend2/examples/laws-proof.bend`. The gate refuses the fixture build for the
whole module, so the fixture cannot build at all while those laws are stated this
way.

The runner does not pin that list. It reads each refusal from the compiler's
diagnostic and removes that law to reach a buildable source, so the removal follows
the observed gate and a repaired law stays in force automatically. The baseline
build then carries the other fifteen laws, and a mutation that breaks one of those
is refused by the gate before any removal.

## Fixture defects repaired

The fixture as handed over did not compile on bend 2.0.25. Each repair is required
for the checks above to run, and each was confirmed by a compiler diagnostic on the
remote runner:

- A `match` headed a monadic bind in `checks`; the two matches are now
  `present_check` and `open_duty_or_die` definitions, which a do block binds as
  ordinary annotated binders.
- A do block ended in a binder; `checks` now ends with `return`, and the `failure`
  modes return their `Done` values.
- `IO.pure(Maybe<Custody.Duty>, …)` bound a value of a parameterized type; bend
  2.0.25 rejects a parameterized type argument there (`expected : Data / observed :
  Type`), so `rebuilt_sample` supplies the rebuild result as a definition value.

## Limits

- The module performs no IO, so these checks establish decisions over supplied
  evidence only. They say nothing about the host enumeration that supplies it, the
  owner entry, guard binding or recovery, which remain outside this module.
- The `laws` mode check names are the fixture's own; the module's law statements
  remain the artifact of record for the decision semantics they state.
- Evidence for the recorded run is on the runner under
  `/home/atari2036/native-capability-custody-fixture-05a2a94c/evidence/final/`
  (one launch record, one completion record, and raw stdout and stderr per child),
  with `final.log` and `identity.json` beside it.
