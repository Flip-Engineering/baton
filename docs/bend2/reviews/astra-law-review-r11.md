# Astra law review of revision 11: no bookkeeping ledgers in place of function

**Verdict: revise.** Both model laws check at the requested pin, and every recorded control
reproduces exactly. The laws prove the decision rule over supplied values. They do not establish
the stated ban. Two gates in this review suppress a regression using a stored record while both
laws remain discharged. A third gate executes a census assertion and satisfies both laws. The
motivation supports removing the cited maintenance mechanisms, but its account of the regression
and the proposed replacement needs correction.

Independent review by `bend2-astra-review16`, 2026-09-25 UTC. Adoption remains the operator's
decision. The required changes below are recommendations; this contribution changes no proposed
law, trace entry, application code, or existing example.

Reviewed commit: `130518132e8f23c0f7c8a2df2d58b6c5445544ad` on `bend2-rewrite`.
The motivation on master was inspected at `c66098c1d161d8dfbd120bcf6fb7b050963372cd`.

- `docs/bend2/laws-proposed.md`: SHA256 `a169f666a81620931a6fd1349bf9687b026033d1c8191c3ba3bb703f22010c67`.
- `docs/bend2/laws-trace.md`: SHA256 `d7c7a2b832ff423f111bcba88187fdf11422bb45d584312d5da6ac2abbe6e4e5`.
- `docs/bend2/examples/laws-no-ledger.bend`: SHA256 `7c8d63950b30c128797a61b8d4a69a490e2227ffe0b3f926a2ab9febd3125dde`.
- `docs/bend2/examples/laws-no-ledger.evidence.md`: SHA256 `ce4712a14eb9a9ee34acf50250413c1cd024e5421ae1b412e427bcae21b51048`.

## Independent re-verification

I used the existing compiler at
`/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend`.
Its SHA256 was checked before execution:
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`.
This is the supplied Bend 2.0.25 binary, reference `bendlang/bend@a4952426`.
All Bend invocations used `BEND_NO_TELEMETRY=1`. Host: Darwin arm64.
The binary refuses `--version` as an unknown option; identification here uses its digest.

```text
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ledger.bend --check-only
All terms check.
exit=0
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/examples/laws-no-ledger.bend
no-ledger: the gate reads only observations; both laws checked.
exit=0
```

[reproduce.py](astra-r11-probes/reproduce.py) reconstructs the controls from the unchanged example
and runs all review probes. It checks the compiler digest, writes scratch files within the review
directory, and prints actual outputs and exits. Run from the repository root:

```sh
python3 docs/bend2/reviews/astra-r11-probes/reproduce.py /absolute/path/to/bend
```

The complete final transcript is [verification.txt](astra-r11-probes/verification.txt).
The transcript renderer removes trailing horizontal whitespace from diagnostic source excerpts.
All four recorded control invocations match the evidence file's output, including context and
line numbers:

| Control | Failing case | Expected / observed | Location | Exit |
|---|---|---|---|---|
| A | Positive record, change Failed, target Passed | False / True | `gate_reads_only_observations`, line 105 | 1 |
| B | Record 0, change Failed, target Failed | True / False | Same proof, line 100 | 1 |
| B, positive-record branch first | Positive record, change Passed, target Passed | True / False | Same proof, line 94 | 1 |
| C | Change Failed, target Failed | True / False | Same proof, line 92 | 1 |

There is no mismatch in those checks. B's positive-record branch treats every positive natural
as pin 1. It illustrates a one-test Boolean failure-count check; it does not model a general
member census or arbitrary failure totals.

## Counterexamples that discharge both laws

The first three files below import the unchanged model, including both proof definitions.
Their `--check-only` invocations print `All terms check.` and exit 0. Each stored value is a
checked-in definition. No external runner or file access is needed to demonstrate the missing
constraint. As an import control, `.work/import-control-a.bend` imports the violating control A
and calls its landing function. Checking that importer fails at
`control-a.gate_reads_only_observations`, with False expected and True observed. The importing
program does not bypass checking the imported proof.

### 1. A stored entry supplies the target outcome

[forge-outcomes.bend](astra-r11-probes/forge-outcomes.bend) contains:

```python
def stored_record() -> Nat:
  1n

def target_from_record(record: Nat, actual: M.Outcome) -> M.Outcome:
  match record:
    case 0n: actual
    case 1n+p: M.Failed{}

def gate_from_record(+record: Nat, change: M.Outcome, actual_target: M.Outcome) -> Bool:
  M.landing_blocks(record, [M.Observed{change, target_from_record(record, actual_target)}])
```

`main` submits change Failed and actual target Passed twice, with records 0 and 1:

```text
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/reviews/astra-r11-probes/forge-outcomes.bend
[True{}, False{}]
exit=0
```

The stored entry suppresses the regression by fabricating a target failure. Both laws concern
the value supplied as `target`; neither relates that value to a runner event.

### 2. A stored flag selects which tests reach the gate

[select-tests.bend](astra-r11-probes/select-tests.bend) contains:

```python
def selected(record: Nat, runs: List<M.Observed>) -> List<M.Observed>:
  match record:
    case 0n: runs
    case 1n+p: []

def gate_from_record(+record: Nat, runs: List<M.Observed>) -> Bool:
  M.landing_blocks(record, selected(record, runs))
```

Its stored record is also 1. Its two calls supply the same singleton Failed/Passed observation:

```text
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/reviews/astra-r11-probes/select-tests.bend
[True{}, False{}]
exit=0
```

The flag suppresses the regression through test selection. This counterexample preserves the
outcome values. Runner-exclusive construction would leave it possible. An implementation that
always selects an empty list satisfies the current landing law for every record.

These wrappers are outside the quantified functions. That boundary is the finding: the entry
describes the full gate, but the theorem starts after outcome construction and selection. I am
not claiming to have falsified the proved equality for a fixed pair or list.

### 3. A census pin is executed as a test

[census-test.bend](astra-r11-probes/census-test.bend) runs an equality assertion between a
supplied member count and `stored_pin() = 1n`, converts the assertion to Passed/Failed, and
passes those results to `M.gate`. Target count 1 and change count 2 yield:

```text
$ BEND_NO_TELEMETRY=1 $BEND docs/bend2/reviews/astra-r11-probes/census-test.bend
True{}
exit=0
```

This is an executed assertion of the exact census form the policy bans. Its assertion outcomes
are accurate. Both laws permit the gate to block on them. A theorem about verdict comparison
cannot by itself determine whether a test's asserted property is legitimate.

### 4. Reading a record is compatible with the equality

The reproduction script also generates `.work/read-record.bend`. Its gate is:

```python
def gate(record: Nat, change: Outcome, target: Outcome) -> Bool:
  match record:
    case 0n: breaks(change, target)
    case 1n+p: breaks(change, target)
```

Both law types stay unchanged. The landing proof additionally splits on `record` so the
checker can reduce each branch. Check-only prints `All terms check.`; the run prints `True{}`;
both exit 0. The theorem establishes independence of the returned Boolean from the explicit
record argument. It does not prohibit inspecting that argument. This example reads the record
in the source; it makes no claim about which reads an optimizer retains at runtime.

## Answers to the four review questions

### 1. Is the entry a law under the definition?

The two propositions are quantified theorems over the model's `gate` and `landing_blocks`.
The case proof covers all naturals and all outcome pairs; the list proof is inductive. These
are valid model laws, and their status does not depend on a runtime test's passing output.

The full proposed statement is unproved. Neither theorem quantifies over test discovery,
selection, runner effects, the construction of observations, test assertions, or the actual
`defaultIntegrationGates`. The trace correctly calls the application scope open. Its checked
scope must also explicitly limit record independence to fixed supplied inputs. Quantifying one
`Nat` does not establish that every stored value an implementation can access flows through it.

The controls show that three particular replacements of the inner function violate the
specified Boolean rule. They do not establish the ban on gates, tests, and checks. In particular,
control C reads no record and still fails: the proposed entry combines differential acceptance
policy with a restriction on sources of authority. Those are separate obligations.

### 2. Can Outcome be constructible only by the runner at this pin?

The current named datatype cannot obtain that property from an ordinary module import. An
importer can construct its public variants. There is, however, a useful narrower construction:
a consumer can be checked parametrically over an abstract outcome type and receive its only
outcome-producing operation from a trusted runner. The probes distinguish these cases:

| Probe | Result at the pin | Consequence |
|---|---|---|
| [forge-import.bend](astra-r11-probes/forge-import.bend) imports [runner.bend](astra-r11-probes/runner.bend) and constructs `R.Failed{}` | Check 0; run 0, `runner.Failed{}` | Moving the datatype into a runner module does not restrict construction. |
| [private-runner.bend](astra-r11-probes/private-runner.bend) uses `private type` | Exit 1: expected `def`, `type` or `law` | That visibility syntax is unavailable. |
| [opaque-runner.bend](astra-r11-probes/opaque-runner.bend) declares `law Outcome: Data` and a foreign runner signature | Exit 1: `1 TODO found` | A user-defined open type law is an undischarged obligation. |
| [opaque-forge.bend](astra-r11-probes/opaque-forge.bend) tries `R.Outcome{}` | Exit 1: non-inferrable constructor term | This particular constructor is refused. |
| [opaque-fill.bend](astra-r11-probes/opaque-fill.bend) supplies `def R.Outcome(): Bool` from the importing module | Check 0; run 0, `True{}` | The importer can fill the open type law and fabricate a value. |
| [empty-runner.bend](astra-r11-probes/empty-runner.bend) declares a datatype with no constructors and a foreign runner signature | Exit 0, with the warning that `run` relies on unsafe or foreign code | This declares an empty datatype, with an unverified producer signature. |
| [empty-forge.bend](astra-r11-probes/empty-forge.bend) constructs that empty datatype | Exit 1: expected a declared constructor | There are no constructors. |
| [empty-eliminate.bend](astra-r11-probes/empty-eliminate.bend) proves `True == False` for every value of that empty type | Exit 0, `All terms check.` | The theorem is vacuous. Treating a foreign-produced value as an inhabitant would violate the datatype's meaning. |
| [scoped-runner.bend](astra-r11-probes/scoped-runner.bend) passes a universally quantified consumer to `with_runner` | Check 0; run 0, `True{}` | The consumer can operate through a supplied runner and observer while its representation stays abstract. |
| [scoped-forge.bend](astra-r11-probes/scoped-forge.bend) returns `True{}` at that abstract type | Exit 1: expected `O`, observed `Bool` | A consumer checked for every `O` cannot fabricate that value. |

The foreign signatures are typechecking probes; they provide no host implementation and do not
claim to run tests. Base's opaque host handles are special library facilities. The empty-type
probe is not a sound replacement for one. The module and law rules described in the pinned
[language guide](../reference/upstream/guide/GUIDE.md) agree with the import and open-law probes.

The scoped construction is a viable boundary for a trusted caller in total, safe Bend. It does
not prove which runner was supplied, that the runner executed a test, or that the returned value
belongs to this tree, test, attempt, and invocation. The probe intentionally supplies a runner
that returns a constant. Reuse of an earlier outcome and omission of a test require further
constraints. Host effects and runner authenticity remain explicit assumptions with evidence.

Without those constraints, the current laws guarantee only that supplied values are compared
according to `breaks`, independently of the explicit record parameter, and combined by OR.
They guarantee no execution, freshness, coverage, or provenance.

### 3. Does the specification cover the JavaScript cases?

Only the first case has a direct faithful representation:

- **A new failing test:** `breaks(Failed{}, Absent{})` is True. This matches the proposed policy,
  provided some other component establishes that the test is absent on the target.
- **File-level failures:** `Failed{}` has no file identity or failure kind. A hang, crash,
  fixture leak, and assertion failure all collapse to the same value. The list also carries no
  evidence that its two outcomes name the same file and test. Comparison by file and failure
  type is not represented.
- **Target produced no verdict:** there is no such variant. Mapping it to Absent would make
  change failures block, but would conflate nonexistence with failure to observe. Mapping it to
  Failed would suppress every change failure. Neither mapping is specified or proved.

[semantics.bend](astra-r11-probes/semantics.bend) prints
`[True{}, False{}, False{}, False{}]` for, respectively, Failed/Absent, Failed/Failed,
Absent/Passed, and an empty selection. Check and run both exit 0.
[no-verdict.bend](astra-r11-probes/no-verdict.bend) is refused because `NoVerdict` is not a
constructor. [failure-kind.bend](astra-r11-probes/failure-kind.bend) is refused because Failed
takes zero fields. The transcript records both errors.

The same completeness problem exists for an unjudged change run. The model has no way to
prevent an adapter from emitting an empty list or Absent and obtaining an allowing decision.

At both reviewed commits, `defaultIntegrationGates` still reads the manifest-based verdict;
it does not perform the target rerun. The three cases in the question concern the intended
#580 implementation. No implementation equivalence to that future gate is established here.

### 4. Can an already-failing test fail differently without blocking?

Yes. For every record, `gate(record, Failed{}, Failed{})` is False. A target assertion failure
and a change that hangs the entire file therefore compare equal after this encoding. The
formula requires allowing that pair. It cannot distinguish the causes.

The revised policy should compare failure identities, including file, test identity when
available, and a stable failure kind. A new failure identity should block even when another
failure existed for that test or file. A diagnostic message should remain evidence; making
raw messages part of identity would make temporary paths, timings, and randomized names cause
false differences. Where a family needs a semantic error code to distinguish regressions,
that code and its normalization must be specified and tested. Same-kind failures can still
conceal different defects; the stated guarantee must acknowledge that resolution limit.

This changes the proposed sentence that a test failing on both sides never blocks. It needs
an explicit operator decision. Retaining that sentence requires accepting the limitation and
withdrawing the claim of comparison by failure type.

## Review of the motivations

`gh issue view` could not authenticate on this seat. I read the public issue pages, retrieved
the bodies and all comments through the unauthenticated GitHub API, and inspected the local
commit objects. The following separates what those sources establish from the proposed law's
stronger claims.

1. **The manifest size is accurate for master, with a missing revision qualifier.** At
   `c66098c1`, its JSON has 417 rows and 161 converged files. At reviewed `13051813`, it has
   451 rows and 173 converged files. At `78123579^`, it has 292 rows and 177 converged files;
   `78123579` adds 125 rows and removes 16 converged declarations. These counts were derived
   with `git show` and JSON parsing. The 292 figure in [issue #580](https://github.com/Flip-Engineering/baton/issues/580)
   refers to an earlier state. The evidence should name the revision for every historical count.
   `suite-verdict.mjs` confirms that listed code failures are excused and stale entries cause
   failure. The runner still executes tests; the manifest controls how their results are judged.

2. **The regression predates the #565 repair and its re-pin.** `d1288fd9` changed the MCP
   surface. Its manifest diff removes one row and adds none. `c71329c` subsequently adds the
   27 expected-failure entries while preparing the startup repair. Its commit message says
   those same 27 failures were measured on baseline `65c913f0`. [Issue #566](https://github.com/Flip-Engineering/baton/issues/566)
   likewise says they failed on both that target and the repair branch, and leaves the cause
   of an earlier green-suite report unresolved. [Issue #565](https://github.com/Flip-Engineering/baton/issues/565)
   identifies the deleted seed surface row and requests a startup check. The re-pin excused
   existing regressions; it did not introduce them. A gate implementing the proposed rule
   would also allow the #565 repair with those shared failures. A correctly selected,
   comparable differential run at the original regression could catch newly failing tests;
   that counterfactual is conditional, not an observed result.

3. **Control A is not an exact reconstruction of that re-pin.** Its target passes. The 27
   rows at `c71329c` already failed on the repair's target. Replace the evidence sentence
   identifying A with the #565 event by the qualified chronology above. The cited issue
   reports comparisons for four files around the original regression; it does not show that
   all 27 were passing at its parent or establish why every earlier gate reported green.

4. **The fixture-key problem is supported, but is also a comparison-identity problem.**
   `78123579` changes the failure name from one containing `mkdtemp` paths to a stable name,
   retaining the paths in the message. Its commit reports 121 leak rows among 122 unexpected
   rows in one #566 gate and adds 125 measured leaking files to the manifest. Stable failure
   identity remains necessary for target comparison. The proposed change does not eliminate
   that requirement. Attribute the broad-gate history to the commit's report; no gate history
   was independently replayed in this review.

5. **The count-maintenance cost is demonstrated.** `83c40b4e` only changes two SI6 counts:
   167 to 168 and 281 to 282. The preceding #358 landing had already changed the members and
   left that assertion stale. `5df1acf5` deletes SI6 and `CORPUS_COUNTS` and adds the AGENTS
   policy. `c66098c1` removes count assertions from five tests, including the runtime-api
   literal 47. This supports the specific removal. Claims that every functional change
   needed a re-pin, or that every member-adding change carried its own re-pin commit, exceed
   the evidence; the cited #358 example required a subsequent repair.
   The #579 comment records two #564 refusals whose conflicting paths were the manifest and
   census artifacts. This is direct reported evidence of integration cost.

6. **A useful coverage property was attached to SI6.** The deleted test also compared the
   expected target-file set with `TARGETS`, expressly to catch a dropped target that could
   otherwise regenerate consistently. Its exact member counts were an imprecise and costly
   way to protect coverage. Removing the counts does not prove that the coverage requirement
   is unnecessary or preserved. The remaining source-to-inventory comparisons operate over
   declared targets, and named presence checks protect particular targets. Require evidence
   for the intended target-coverage property before treating the removal as complete evidence
   of equivalent protection.

7. **The removals have different statuses.** [Issue #579](https://github.com/Flip-Engineering/baton/issues/579)
   calls for deriving census artifacts from the tree and removing or replacing pins. The
   cited commits implement the count removals. #580 requests manifest deletion and target
   comparison. The manifest and its verdict logic still exist at both reviewed commits.
   The trace's enforcement wording should identify #580 as pending work, not a completed
   enforcement anchor. Also, AGENTS says blocking requires a target pass, while revision 11
   additionally blocks a failure whose target test is absent. State that extension explicitly.
   The earlier #579 comment proposes keyed-set merging of the manifest; #580's later direction
   removes it. The issue history records a change in remedy and does not establish a general
   impossibility of correct gates that use stored expectations.

The evidence justifies removing hand-maintained allowances for observed failures and accidental
implementation censuses. It does not justify banning all stored expected values or all counts.
A test that executes a protocol encoder and asserts a specified header length is legitimate.
So is checking a limit derived from an observed physical resource, with the derivation and
remainder behavior required by M-10. Functional golden fixtures, expected refusal codes, and
generated inventories can express independently specified behavior. An expected value inside
a test is not sufficient evidence of the prohibited mechanism.

The phrase "no count or census pin" therefore needs a defined scope. A manually updated total
that follows incidental code membership fits the motivating failure. A protocol constant has
an independent specification; a physical bound has an observed derivation. The narrower
reading is consistent with the operator's stated purpose and with M-10. The ban should also
reach count assertions executed as tests, as the census probe demonstrates.

## Exact required changes

1. **Keep revision 11 proposed.** Set its review result to `revise`, linked to this record.
   Replace the model's checked-scope claim in the entry, trace, example header, and evidence
   with: "For fixed supplied outcomes and a fixed supplied selection, the model gate equals
   `breaks` for every explicit record argument, and the landing decision is the OR of those
   comparisons. Outcome provenance, selection completeness, test validity, and the application
   gate are open obligations." Rename the per-test theorem to `gate_equals_breaks` or describe
   its existing name as Boolean record independence. Remove claims that it forbids a read.

2. **Separate the policy from its currently proved subset.** Use this policy text:
   "Hand-maintained allowances for observed test failures and declarations that a test has
   converged must not determine test selection, supplied observations, or landing verdicts.
   Tests must not pin incidental code-member counts or line positions of application code.
   Test expectations may
   state independently specified behavior, including protocol constants. Resource limits must
   retain their measured derivation and satisfy M-10. Generated inventories must be checked
   against their source and their declared coverage requirement."
   Label enforcement of this policy as open. Preserve the two existing model theorems as a
   partial encoding. This wording and the following comparison refinement require adoption.

3. **Replace the Boolean failure policy with an explicit comparison contract.** Use:
   "For a declared test selection, a judged landing blocks when a failure observed with the
   change has no matching failure identity observed on the target. A test absent on the target
   contributes no matching failure. An unjudged target contributes no matching failures and
   is reported as unjudged. An unjudged change run cannot authorize a landing. Every selected
   invocation must be accounted for before the verdict is judged."
   Define failure identity at the chosen resolution: file, test identity when available,
   failure kind, and any specified stable semantic code. Keep raw messages as diagnostics.
   Add explicit `Unjudged` and failure-identity representations; do not overload `Absent`.

4. **Prove the application boundary before claiming the ban as a law of the gate.** Import
   the real selector, comparator, and observation adapter. Bind observations to immutable
   change/target revisions, the selected test identity and definition, invocation, and
   completion status. Require the same admissible selection and comparison normalization on
   both sides. Prove record independence across that composition, including selection and
   adaptation, for fixed legitimate inputs. A scoped abstract runner type can constrain a
   consumer, as the pin probe shows. Record runner authenticity and host execution as external
   obligations, and demonstrate them with adversarial host tests. Constructor privacy alone
   does not establish them. Test selection and test-contract changes need their own protected
   authority boundary so a candidate cannot authorize omission of its failures.

5. **Add adversarial controls at that boundary.** The forged target, omitted test, executed
   census pin, new failing test, unmatched failure kind, unjudged target, and unjudged change
   must have explicit dispositions. The first two supplied bypasses must fail the strengthened
   composition obligation. The census case requires enforcement of the test-policy clause.
   Preserve passing controls for protocol constants and physically derived bounds. Correct
   the historical evidence with the commit-qualified counts, #565/#566 chronology, and pending
   #580 status described above.

## Scope of this verdict

This review verifies the existing model and supplies executable counterexamples to its claimed
coverage. It does not dispute the checked equalities or certify the JavaScript gate. It
recommends a narrower truthful proof claim now and a stronger application obligation before
adoption of the full ban. No real test execution can be inferred from an Outcome constructor.

The deployment verification result is recorded below after the required single suite attempt.
