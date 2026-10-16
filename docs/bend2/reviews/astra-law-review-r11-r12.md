# Astra law review of revisions 11 and 12

**Verdict: revise each entry.** Revision 11 does not capture the operator's concern about
mandatory administrative work and restrictions on agent capability. Revision 12 adds useful
subjects, but its models leave the decisions that establish their inputs and enforce their
outputs unconstrained. Every submitted model checks, and every recorded negative control fails
as reported. Executable implementations in this review violate each proposed ban while retaining
its checked laws.

| Entry | Verdict | Required change |
|---|---|---|
| Revision 11 | Revise | Prove independence through observation, selection and the complete landing decision; define failure identity and unjudged results; separately enforce test policy. |
| G1, record independence for all work decisions | Revise | Define administrative annotations and authenticated semantic inputs; quantify over the actual decision and transition composition; add positive behavior requirements. |
| G2, no required agent act except resource or authority acquisition | Revise | Specify legitimate prerequisites and actual enabling effects; reconcile semantic input and orchestrator decisions with revision 10; prohibit administrative prerequisites across all continuation paths. |
| 12a, magnitude and clock | Revise | Cover admission inputs and subsequent transitions; distinguish actual external failures, cancellation and invalid requests; preserve owed work and data. |
| 12b, derived catalogs | Revise | Cover complete discovery, authenticated operator policy and actual serving; correct the #440 attribution. |
| 12c, orchestrator authority | Revise | Derive authority from actual scoped relationships; cover dispatch and all management actions; preserve legitimate self and delegated actions. |
| Ban-to-law table | Revise | Separate model coverage from application obligations and repository rules; retain the unresolved whole-mandate issue. |

Independent review by `bend2-astra-review16`, 2026-09-25 UTC. Adoption remains the operator's
decision. Reviewed base: `770e89e323cf13537b72ffb271936c43eab84d4f` on `bend2-rewrite`.
This combined review supersedes the recommendations in the
[initial revision 11 review](astra-law-review-r11.md) where revision 12 changes their policy
premises. In particular, that review's reference to M-10's physical-bound exception describes
the approved policy before this proposed revision; it does not approve the exception's retention.
The original review and its executable probes remain supporting evidence.

## Independent re-verification

I used the supplied Bend 2.0.25 compiler at
`/Users/wahargis/Development/Experiments/baton-resident/.baton/wt/ws-bb964de517ed7cdcfb2ab5bf2ed09021/node_modules/.bend/bin/bend`,
reference `bendlang/bend@a4952426`. Its SHA256 was verified before use:
`3850c7cd281a687715a181ad6a2ecdef041704f320ea2b4304cf9e802309203c`.
Every invocation sets `BEND_NO_TELEMETRY=1`; temporary files stay under the review directory.

Reviewed file digests are in [source-sha256.txt](astra-r11-r12-probes/source-sha256.txt).
The four models each print `All terms check.` with `--check-only`, exit 0. Their runs exit 0
and print exactly:

```text
no-ledger: the gate reads only observations; both laws checked.
no-ceiling: the decision ignores magnitude and clock; law checked.
derived-catalog: served routes follow observation; law checked.
orchestrator-authority: an orchestrator holds every management act; law checked.
```

These messages are outputs written by the examples. The proof evidence is the checked quantified
law definitions. The messages add no execution-provenance guarantee.

Run both reproducibility drivers from the repository root:

```sh
python3 docs/bend2/reviews/astra-r11-probes/reproduce.py /absolute/path/to/bend
python3 docs/bend2/reviews/astra-r11-r12-probes/reproduce.py /absolute/path/to/bend
```

The new [driver](astra-r11-r12-probes/reproduce.py) applies every revision 12 evidence diff to an
unchanged copy, checking each removed span before replacement. The resulting diagnostics match
the evidence files, including line numbers. The transcripts strip trailing horizontal whitespace
from diagnostic excerpts. [Revision 11 re-execution](astra-r11-r12-probes/r11-verification.txt)
is byte-identical to the original review transcript.
[Combined verification](astra-r11-r12-probes/verification.txt) records the new probes and controls.

| Recorded control | Expected / observed | Proof and line | Exit |
|---|---|---|---|
| 11 A: listed failure | False / True | `gate_reads_only_observations`:105 | 1 |
| 11 B: pin zero | True / False | Same:100 | 1 |
| 11 B: positive branch first | True / False | Same:94 | 1 |
| 11 C: every change failure blocks | True / False | Same:92 | 1 |
| 12a A: size ceiling | Refused / Admitted | `decision_ignores_magnitude_and_clock`:75 | 1 |
| 12a B: waiting deadline | Refused / Waiting | Same:68 | 1 |
| 12a C: derived ceiling | Refused / Admitted | Same:114 | 1 |
| 12b A: table alone | False / True | `served_follows_observation`:54 | 1 |
| 12b B: table intersects observation | False / True | Same:55 | 1 |
| 12c A: parent lacks stop | False / True | `orchestrator_holds_management`:72 | 1 |
| 12c B: parent lacks integrate | False / True | Same:73 | 1 |

There is no mismatch in the submitted models or their recorded controls. Control failures are
proof failures, not failed runtime assertions. The new driver deliberately includes negative
probes; its own process exit is not a substitute for inspecting each reported compiler exit.

The required deployment command was attempted once, using executable `npm`, argv
`["test", "--prefix", "impl"]`, worktree-root cwd and `shell=false`. It completed with exit 1:
6533 passed, 451 expected red, 9 unexpected failures, no stale expectations and no hung files.
The runner reported insufficient host memory and proceeded without a verification lease.
[The recorded summary](astra-r11-probes/npm-suite-summary.txt) names every unexpected failure.
I have not classified all nine as environmental. This run was made at the revision 11 base;
`git diff 13051813 770e89e3 -- impl` is empty. I did not repeat the suite after adding review
files, following the orchestrator's instruction to attempt it once and avoid pursuing host or
baseline failures. This contribution does not claim a green deployment gate.

## Does the proposal capture the operator's concern?

No. The concern includes a runtime making agents maintain administrative declarations before
useful work can proceed, narrowing their granted ability to perform that work, and repository
checks that require edits merely because code membership changed. Revision 11 proves a comparison
rule after a caller has already supplied outcomes and selected tests. It addresses none of the
other decisions and cannot judge the purpose of a test it receives.

G1 and G2 are useful proposed application properties, with material qualifications below.
Neither phrase is yet a theorem over Baton. Both can be encoded as quantified laws at this pin
once their inputs, effects and transition relations are defined. The supplied examples establish
that the necessary equality and finite-case proof mechanisms exist. The missing work is the
semantic contract and its connection to the implementation.

### G1: independence from administrative annotations

[g1.bend](astra-r11-r12-probes/g1.bend) proves, for six work-act constructors, every observed
decision input and every record:

```text
decide(act, observed_allowed, notes) == decide(act, observed_allowed, 0n)
```

It checks and runs with `True{}`. A direct control changes the positive-record case to False;
the same proof fails with expected False and observed `observed_allowed`. This is a genuine
quantified noninterference property in the model.

It has two distinct limitations. First,
[g1-always-deny.bend](astra-r11-r12-probes/g1-always-deny.bend) implements every decision as False,
discharges the same law, and runs with `False{}` even when observed allowance is True. Record
independence permits an entirely obstructive runtime. Adding G2 with no required agent act
does not change that result. Positive admission, authority, wake and continuation requirements
remain necessary.

Second, [g1-smuggle.bend](astra-r11-r12-probes/g1-smuggle.bend) computes the supposed observed
allowance from the record before calling the lawful function. It checks and prints
`[True{}, False{}]`. Calling a value an observed fact does not establish its provenance. A test
can genuinely observe that a census pin differs and still impose the prohibited obligation.

The phrase "any record agents maintain about their own work" is also too broad. Source changes,
work requests, cancellation, evidence of completed effects, and authenticated grants or reviews
can be represented by records and legitimately affect decisions. A record of an actual effect
is not automatically an administrative annotation. The classification must be stated by the
semantic contract, and its producers must be covered by the proof or declared host assumptions.

**Exact replacement for G1:**

> For the same validated semantic request, authenticated authority, observed resources and
> external events, changing administrative annotations about work cannot change the runtime's
> selected checks, derived decision inputs, admission, refusal, management permissions, required
> prerequisites, or continuation transitions. Administrative annotations include expected-failure
> allowances, convergence declarations, incidental code censuses and status declarations with no
> corresponding semantic effect. The runtime derives decision inputs from the specified sources.
> The complete composition, including source selection and dispatch, satisfies this independence.

Quantify over the actual state and event projection, not only the inner Boolean helper. For
effectful code the comparison must preserve relevant events, enabled actions and terminal
results; equality of one final verdict leaves indefinite administrative waits possible. Define
and retain each domain's positive behavior law. These are review requirements, not a claim that
the six-constructor probe implements the complete runtime.

### G2: administrative prerequisites

[g2.bend](astra-r11-r12-probes/g2.bend) proves that every returned prerequisite is admitted by a
classification containing NoAct, Resource and Authority, with Bookkeeping forbidden. It checks
and prints `NoAct{}`. Making the required act Bookkeeping causes a False/True proof failure.

[g2-label.bend](astra-r11-r12-probes/g2-label.bend) classifies both acquiring a socket and rewriting
a census as Resource. Its quantified law checks and the census call prints `g2.Resource{}`.
The classification alone proves no resource acquisition. A resource prerequisite needs an
actual resource and enabling transition; authority needs an authenticated grant and scope.

The literal G2 also excludes legitimate semantic input. A request may omit which repository to
change, require a user decision, or await an awake orchestrator's choice of further work. These
acts need not acquire a resource or a new authority. Revision 10 explicitly permits waiting on
a woken orchestrator. [g2-orchestrator-wait.bend](astra-r11-r12-probes/g2-orchestrator-wait.bend)
checks the two current classifications and prints `[True{}, False{}]`: revision 10 classifies
the orchestrator as woken; G2's administrative-act category is forbidden. The probe identifies
the classification boundary, not a theorem that every orchestrator decision is bookkeeping.
Calling every decision authority acquisition would make G2 ineffective.

**Exact replacement for G2:**

> For a valid authorized work request with its required semantic inputs, the runtime imposes no
> agent-maintained status, census, convergence or completion declaration as a prerequisite for
> admission or continued execution. A blocked continuation names the actual missing resource,
> authority, semantic input, or explicit operator/orchestrator decision that enables it. Each
> prerequisite has a specified enabling effect; administrative maintenance cannot satisfy that
> description merely by receiving a resource or authority label. The runtime preserves the
> continuation and wakes the responsible party as required by revision 10. When the prerequisite
> is satisfied, the runtime makes progress without a separate administrative acknowledgment.

This is a proposed policy refinement requiring operator adoption. If the operator intends the
literal resource-or-authority-only rule, record that it removes some waits revision 10 admits
and specify how incomplete requests and orchestrator choices are handled. Do not claim that
literal G2 follows from revision 10. A temporal progress claim also needs stated scheduler and
host assumptions; an external party may never supply an input.

### What remains a repository rule

A law over application behavior cannot determine whether an inventory document, a reduction
record's mechanical count, or a required contributor report is useful. Those documents can
change without changing any application transition. Their maintenance policy belongs in
AGENTS.md. The same applies to prohibiting incidental count or source-line assertions in test
code as a repository practice. A theorem receiving a test outcome cannot infer that test's
intent or independent specification.

If a runtime reads an inventory, count assertion or declaration to choose checks or refuse work,
that use has application semantics and belongs within G1/G2's composition. A syntactic checker
could prove a narrower property of a closed set of repository files; it would still need a
policy distinguishing valid protocol assertions from incidental membership assertions. Neither
an application theorem nor a scanner can derive that distinction from the presence of a number.

Use this repository rule alongside the application laws:

> Do not require hand-maintained expected-failure allowances, convergence lists, incidental
> code-member totals or source-position pins to accompany functional changes. Do not require
> redundant declarations of facts that the runtime or tooling can derive directly. Tests may
> assert independently specified behavior, including protocol constants and functional fixtures.
> Inventories used by tooling derive from their sources and retain a stated coverage requirement.
> Historical measurements in review records are evidence and create no requirement to keep their
> totals synchronized with later source changes.

This reaches the administrative pattern described by the operator. It does not claim that all
structure, state records, authentication checks or independent verification reduce capability
without benefit. Their actual semantic obligations must be justified and kept as small as the
operation requires.

## Revision 11: counterexamples and answers to its four questions

Two complete importing gates read stored definitions and retain both original checked laws:

| Probe | Action | Actual run output |
|---|---|---|
| [forge-outcomes.bend](astra-r11-probes/forge-outcomes.bend) | A stored positive record replaces the real passing target result with Failed. | `[True{}, False{}]` |
| [select-tests.bend](astra-r11-probes/select-tests.bend) | A stored positive record selects an empty test list from the same failing-change/passing-target input. | `[True{}, False{}]` |
| [census-test.bend](astra-r11-probes/census-test.bend) | Executes a census equality, then compares its accurate outcomes. | `True{}`: the census change blocks. |

All check and run with exit 0. A control importing a model with a false proof fails at that
proof, confirming that import did not skip checking it. These examples expose the missing
application boundary; they do not falsify equality for the fixed supplied values quantified by
the laws. A further control reads the record and returns the same result in both branches; after
splitting the proof appropriately, both law types check. The law prohibits dependence, not reads.

1. **Is it a law?** The two equalities are laws of the example implementation. The repository-wide
   ban is not discharged by them. Their guarantees are fixed-input comparison and OR over a
   supplied selection. Control C also shows that differential acceptance is an additional policy:
   that control reads no record and still fails.

2. **Can only the runner construct Outcome?** Not through the current public datatype or an
   ordinary import. [forge-import](astra-r11-probes/forge-import.bend) checks and constructs
   `runner.Failed{}`. `private type` is rejected. An open `law Outcome: Data` leaves a TODO;
   [opaque-fill](astra-r11-probes/opaque-fill.bend) fills it from the importing module with Bool
   and fabricates True. An empty datatype has no usable safe inhabitants; a foreign producer is
   unverified, and [empty-eliminate](astra-r11-probes/empty-eliminate.bend) proves True equals
   False for every inhabitant, demonstrating the vacuity. There is a narrower positive result:
   [scoped-runner](astra-r11-probes/scoped-runner.bend) checks a consumer universally over an
   abstract outcome type and supplies runner/observer operations. Its concrete Bool forgery
   [scoped-forge](astra-r11-probes/scoped-forge.bend) fails with expected O, observed Bool.
   This can constrain a safe consumer; the trusted provider, actual execution, freshness and
   invocation identity remain obligations. The positive probe deliberately uses a constant
   runner. Even sound construction control does not prevent the empty-selection counterexample.

3. **Does it cover the named JavaScript cases?** Failed/Absent blocks a new failing test. There
   is no test or file identity, failure kind, or NoVerdict constructor. The corresponding
   expressibility probes fail at the pin. An unjudged run cannot faithfully be represented as
   an absent test or a judged failure. The JavaScript manifest gate at this base does not
   implement the proposed target comparison.

4. **Can a failing test fail differently without blocking?** Yes: Failed/Failed always allows.
   Assertion failure and file hang collapse together. Define comparable failure identity and
   explicitly acknowledge its resolution limit; even two failures with the same stable code can
   have different underlying defects.

**Exact changes:** retain the model as a partial encoding and replace its scope claim with:
"For fixed supplied outcomes and a fixed supplied selection, the gate equals `breaks` for every
explicit record argument, and landing is the OR of those comparisons. Provenance, completeness,
test policy and application composition remain open." Apply G1 to the real selector, adapters
and landing implementation, with immutable tree, test-definition, attempt and completion binding.

Use an explicit comparison policy: "A judged landing blocks when a failure with the change has
no matching failure identity on the target. Target absence contributes no matching failure.
An unjudged target is reported as unjudged and supplies no matching failure. An unjudged change
cannot authorize landing. Every selected invocation must be accounted for." Define identity by
file, test where available, failure kind and specified stable semantic code; keep variable paths
and timings in diagnostics. This refines the proposed Failed/Failed rule and needs operator
adoption. Protect selection and test-contract changes from authorizing omission of their own
failures. Add controls for both supplied bypasses, mismatched failure kinds, missing verdicts
and test selection. Enforce the repository test-policy clause separately.

## Revision 12: adversarial implementations

Every file below imports the unchanged proposed model and retains its checked law. Each checks
and runs with exit 0. The table abbreviates imported constructor namespaces; the transcript
contains exact stdout.

| Entry and probe | Violation admitted by the composition | Run output |
|---|---|---|
| 12a [a-inputs.bend](astra-r11-r12-probes/a-inputs.bend) | Size is translated into false authority or unavailable resources before the lawful call; positive sizes are refused or wait indefinitely. | `[Admitted{}, Refused{}, Waiting{}]` |
| 12a [a-timer.bend](astra-r11-r12-probes/a-timer.bend) | An independent elapsed-time callback changes the lawful Waiting result to Refused. | `[Waiting{}, Refused{}]` |
| 12b [b-exclusion.bend](astra-r11-r12-probes/b-exclusion.bend) | A stored allowlist entry supplies the operator-exclusion argument. | `[True{}, False{}]` |
| 12b [b-discovery.bend](astra-r11-r12-probes/b-discovery.bend) | A stored candidate list omits an observed route before `served` is called. | `[[0n, 1n], [0n]]` |
| 12c [c-relation.bend](astra-r11-r12-probes/c-relation.bend) | A caller supplies Leads for an unrelated actor; self-integrate and self-recruit also show the matrix's restrictions. | `[False{}, True{}, False{}, False{}]` |
| 12c [c-dispatch.bend](astra-r11-r12-probes/c-dispatch.bend) | The dispatcher adds a second false permission after the lawful parent-stop grant. | `[True{}, False{}]` |

The Boolean input and output boundaries are substantive gaps. They do not make the checked
equalities false. Describing them as open application obligations is accurate; describing the
models as excluding these implementations is not.

## Answers to revision 12's six questions

### 1. Law or tested behavior?

Each submitted equality is quantified over the complete stated domain and discharged at the pin.
12a ranges over arbitrary natural size and elapsed values plus both flags. 12b covers all flag
values. 12c covers every constructor of its relation and action types. These are laws of the
models. A passing example run is not what establishes them. Their normative statements exceed
those domains in the ways demonstrated above. Keep each application obligation open and each
entry proposed until its specification is corrected; passing the model alone is insufficient
to accept the broader wording.

### 2. What legitimate cases does removing the physical-bound exception leave unhandled?

A measured resource requirement legitimately depends on job size. Insufficient memory can make
large work wait while small work runs. A provider context limit or a kernel path limit can make
a particular representation impossible. The model fixes `available` and `authorized` while
varying size and time, so it neither prohibits legitimate derived availability nor proves that
a fictitious size ceiling has not been placed inside that flag.

The provider/kernel distinction is coherent only with an explicit result model. Observed external
refusal is a real event, not proof that the requested logical work can never be completed through
another valid representation or route. A known platform limit can justify choosing a shorter
socket path or another representation before invoking the failing operation. The platform limit
must have identified provenance; observing a memory quantity is legitimate even when using it as
an arbitrary terminal cutoff is forbidden. A transient memory shortage needs retained intent and
resumption on resource change. Permanent impossibility and host failure cannot promise eventual
completion. The runtime may itself lack resources to persist a new request.

The statement "refused only for lack of authority" also omits malformed requests and unsupported
semantic operations. Scope the admission law to valid supported requests and represent actual
external failures separately. Authority can expire at time of effect under M-8. A blanket
time-invariance claim must not keep using expired authority. Size- or age-aware scheduling can
also be legitimate without terminating work solely because of magnitude or elapsed time.

**Exact 12a replacement:** "For valid supported requests under valid authority, the runtime
admits work when its measured resources are available and retains it pending while those
resources are unavailable. Administrative magnitude or elapsed-time bounds cannot reject,
truncate, discard, or terminalize that work. Measured resource requirements may determine
availability and representation. Actual provider or host failures are reported with their
observed cause and disposition; they cannot be fabricated from a runtime deadline. Explicit
cancellation, revoked authority and the work's specified stopping condition have separate
transitions. Pending work retains its owner, owed data and continuation."

Removing M-10's exception should not remove its protection of remainders, queued work or owed
data. Carry those clauses into the revised statement and relate them to M-4, M-5 and M-17.
Bind both authority and availability to their actual derivations, and verify the transition
composition. This is compatible with removing predeclared terminal limits without prohibiting
the representation of physical facts.

### 3. Does ignoring a time parameter exclude independent timers?

No; `a-timer` is the counterexample. A state value alone also permits an event to terminalize
it for the wrong reason. The required law constrains the transition and its evidence.
[a-transition.bend](astra-r11-r12-probes/a-transition.bend) demonstrates the additional shape:
for every state, `step(state, Tick{}) == state`. It checks and runs with `Pending{}`. A control
that changes Tick to ExternalFailed fails at the Pending proof case. This proves the mechanism
is expressible at the pin. This illustrative law preserves the whole small state; a production
law can preserve work disposition while allowing telemetry and retry scheduling to change.

Completion, cancellation and external-failure constructors must be bound to actual events.
Renaming a timer event ExternalFailure recreates the classification problem. Constrain every
terminal transition, including callbacks and error adapters. Model attempts separately from
the durable work request so a transport timeout can leave an unresolved attempt without falsely
declaring the operation failed or losing its continuation.

### 4. Are operator exclusions meaningfully different from a hand-maintained table?

They are extensionally different parameters in the proved equality. They have the same Bool
representation and no source identity. `b-exclusion` proves the separation does not authenticate
policy; `b-discovery` proves it does not establish complete discovery. The declared Candidate
type is not used to quantify over an actual discovered catalog.

**Exact 12b replacement:** "For a successfully observed harness/credential catalog, the served
route set equals the complete set supported by that harness and credential state after applying
the authenticated operator's route policy. Programmer-maintained availability tables cannot add
routes, restrict discovery, alter observations, or suppress serving. Missing or failed discovery
is reported explicitly and is not asserted to be an empty catalog."

Define route identity, adapter support, discovery completeness, credential scope and policy
provenance. Distinguish advertised routes from temporary scheduling eligibility and exhausted
quota. An explicit operator allowlist is legitimate policy; it must not be confused with an
implementation's invented availability list. Prove the set equality through discovery, policy
application and the serving adapter. Host catalog authenticity remains a stated assumption.

### 5. Does full orchestrator authority conflict with M-8?

It can coexist with M-8 as a scoped authority rule. The current `Leads{}` argument does not
establish a real relationship, generation, valid grant, or time-of-effect authorization. The
runtime must derive those facts and use them at the effect. `c-dispatch` additionally shows why
a grant matrix cannot prove that the operation is usable.

The negative half is too strong: "No act ... over a seat the actor does not lead" would forbid
legitimate self actions and independent delegated review or guidance. Recruitment creates a new
seat, so requiring an existing Leads relationship to that target needs a defined prospective
scope. Integration acts on a contribution and target branch, not simply a subordinate seat.
A lead's own contribution must also be landable within its authority. The model permits self
stop alone. A root's authority over descendants needs a defined relation if it extends past
direct children. Six enumerated verbs do not automatically cover every management operation.

**Exact 12c replacement:** "A valid orchestrator delegation carries every management capability
needed for its delegated work scope, including recruit, guide, stop, review, integrate and resume.
The runtime derives that scope and actor relationship from authenticated current authority and
enforces it at dispatch and effect. Resource identity, generation, revocation and time-of-effect
checks satisfy M-8. Self actions and explicit scoped delegations remain valid sources of
authority. No actor can exercise an action beyond its valid scope."

Define each action's target and the full management-action universe. Cover prospective recruits,
the lead's own work, authorized reviewers and the root. Full capability does not abolish the
semantic preconditions for an action, such as an independently verified landing. Those
preconditions must themselves satisfy G1/G2 and cannot conceal a missing grant. Add controls for
forged relationship, stale authority and dispatcher suppression, plus positive cases for
self-work and delegated review.

### 6. Is the ban-to-law table complete and correct?

It is a useful inventory, with these required corrections:

| Table subject | Correct placement and limitation |
|---|---|
| No pause, idle or truncation | Revision 10 covers waits on parties Baton wakes; M-17 and revised 12a carry continuation and cutoff obligations. A woken-party label alone proves neither delivery nor progress. |
| Administrative work | G1/G2 for runtime decision and prerequisite composition; AGENTS.md for repository maintenance. Revision 11 covers one comparison rule only. Explicitly include agent-authored change declarations used to gate check selection, as addressed by #582. |
| Agent wake and asynchronous acceptance | M-13 and M-12 remain appropriate, with their host-effect obligations. Acceptance alone does not ensure eventual execution. |
| Limits | Revised 12a must retain M-10's data-preservation scope; label the removal of the physical-bound exception as a new policy decision. |
| Catalogs and routing | Revised 12b covers observation and honoring operator policy. The current provider/model choices are configuration; the obligation to honor those choices is application behavior. Correct #440's attribution. |
| Lead authority | Revised 12c and M-8, with actual delegation and effect boundaries. Whole-mandate assignment is a distinct unresolved subject. |
| Working rules | Filing findings and documenting blockers are process rules. "Do not hand-slice work" can also concern the runtime's assignment and delegation model; retain M-15's explicit deferred status until the forbidden behavior is defined. Do not classify that entire subject as necessarily outside application behavior. |
| Writing and non-operative inventories | AGENTS.md and document review. Mechanical reduction-record counts are historical evidence only. |

## Review of the evidence and motivations

I inspected the cited local commit objects, master AGENTS.md at `c66098c1`, the proposal and
trace, and issue bodies and comments through GitHub's public API because this seat's `gh` could
not authenticate. The following distinguishes inspected implementation from reported incidents
and new policy choices.

### Revision 11

The evidence establishes maintenance cost and exemptions for recorded failures. It does not
establish that all stored expectations, resource counts or protocol constants are harmful.

- At master `c66098c1`, the failure manifest contains 417 entries and 161 converged files. At
  the reviewed rewrite base the unchanged impl contains 451 and 173. Qualify counts by commit.
  They are measurements in this review, with no synchronization requirement.
- The #565/#566 chronology matters. `d1288fd9` introduced the MCP regression and added no
  manifest rows. `c71329c` subsequently added 27 allowances while preparing the #565 repair;
  its message and [#566](https://github.com/Flip-Engineering/baton/issues/566) report those
  failures on target `65c913f0` too. The proposed differential policy would also admit that
  repair. Control A assumes a passing target and does not reconstruct that re-pin. Earlier
  green-gate causation remains unresolved in the issue. Correct the evidence accordingly;
  distinguish introduction of the defect, later exemption, and repair acceptance.
- `78123579` stabilized fixture-leak identities and added 125 observed leaking files to the
  manifest. Its gate history is a commit report, not a replay performed here. Stable failure
  identity remains necessary for a differential gate.
- `83c40b4e` repaired only two stale SI6 counts after a functional landing. `5df1acf5` removed
  SI6 and CORPUS_COUNTS and added the AGENTS ban. `c66098c1` removed five further tests' count
  assertions. These support the specific maintenance complaint in
  [#579](https://github.com/Flip-Engineering/baton/issues/579); claims about every functional
  change needing its own re-pin exceed this evidence.
- SI6 also asserted target-set coverage. Removing its incidental totals does not establish
  that the useful coverage property is preserved. Verify source coverage directly. A test of a
  protocol field length, a functional fixture or an actual resource quantity remains legitimate.
- [#580](https://github.com/Flip-Engineering/baton/issues/580) requests removal of the manifest
  and target comparison. Both reviewed bases still contain the manifest gate. Describe that
  enforcement as pending. AGENTS' target-pass wording also needs explicit extension for newly
  introduced failing tests whose target test is absent.

### 12a

- [#258](https://github.com/Flip-Engineering/baton/issues/258) and the shared-custody audit
  support the productive worker's default 100M-token stop on 2026-09-13. That issue's remedy
  makes defaults notify-only and still allows explicit owner hard-stop policy and derived
  physical constraints. It does not independently establish revision 12's universal ban.
- The `goal-plan.mjs` schema contains the listed policy limits. The precise 4244-byte brief
  rejected by a 4096-byte policy on 2026-09-20 was not independently corroborated in the cited
  sources inspected here. The reviewed deployment derives maxTextBytes from the run.objective
  frame limit; it is not a current universal 4096-byte default. Commit `3e06ad64` documents a
  related older fixed-limit brief problem. Attach the specific incident record and label its
  date and policy context. Identify the current default separately.
- [#541](https://github.com/Flip-Engineering/baton/issues/541) supports the historical 2 s
  queue wait, load threshold and CLI timeout complaint. Commit `bc2e4fcd` removes the former
  host load/queue refusals; the inspected source reports resource observations. Later issue
  direction requests immediate durable acceptance and automatic delivery. Do not present all
  three historical mechanisms as simultaneously current at this review base. The issue's
  general ruling also retains a physical-bound exception. The cited September 20 quotation
  needs its original record and its scope; the newly relayed operator direction supports
  proposing removal now, not silently rewriting the older policy's history.
- [#583](https://github.com/Flip-Engineering/baton/issues/583) reports a stop answering
  `coordinator_run_stop_incomplete` at 90 seconds and completing later. The inspected code
  corroborates the mechanism: `application-deployment.mjs` sets maxWorkers 64 and timeoutMs
  90,000; `runtime-effects.mjs` races stop attempts with a deadline and throws that code.
  `issue500-deployment-capacity.test.mjs` pins those values. This is direct evidence for a
  transition-level obligation, which the proposed scalar decision law does not cover. The
  later successful stop is reported issue evidence, not a live reproduction in this review.

### 12b

- [#549](https://github.com/Flip-Engineering/baton/issues/549) reports the eight-model cache
  and two-entry table, including a September 24 cache observation. The manual Astra addition
  in `0b6c6334` dates to September 22; separate that edit's date from the later observation.
  This is evidence for incomplete static discovery, not a live observation of every supported
  harness by this reviewer.
- The claim "#440 already derives omp routes from credential files" is wrong if it means
  runtime catalog discovery. [#440](https://github.com/Flip-Engineering/baton/issues/440) fixes
  a test fixture; `a21bd055` changes only `impl/test/route-truth.test.mjs`. It derives fixture
  credentials from routes declared by the test. Correct the proposal to identify it as a
  credential-fixture precedent, and cite actual discovery implementation for runtime claims.
- #549 also explicitly calls for an operator per-harness allow rule and restricts the Codex
  choice to the gpt-6 series. A ban on every hand-authored list would contradict that policy.
  The source of the policy and what it controls are the relevant distinction.

### 12c and the broader table

The stop-grant incident is supported by contribution
`contribution-7073ae820a93e04c2ba3bb3205a7d28f`, seq 28057, item `stop-grant-gap`.
The orchestrator reported that its available actions omitted swarm.stop and asked the root to
stop its parked seat or grant the verb. A current participant read also shows no stop permission;
the contribution supplies the historical report. This is evidence of a capability gap. It does
not establish that only a direct parent may perform every management act.

The whole-scope direction is preserved in `docs/bend2/MANDATE.md`; the September 21 ruling is
a normative instruction. It does not justify suppressing valid delegated or self authority.
The existing M-15 deferral and its design notes expressly leave whole-mandate admission undefined.
The new table should preserve that unresolved boundary.

[#582](https://github.com/Flip-Engineering/baton/issues/582) broadens the audit beyond the
landing manifest to inventories, snapshots, exceptions and count pins. Its September 25
clarification removes an author-maintained typed change declaration: the scanner selects gates
directly. This is an application-relevant prerequisite that revision 11 does not cover.
The issue also explicitly retains protocol assertions, functional fixtures, vendored digests
and authority-related digests. Those exceptions support the semantic distinction proposed above.
[#529](https://github.com/Flip-Engineering/baton/issues/529) supports M-13's automatic wake
obligation. Neither that obligation nor asynchronous acceptance alone rules out administrative
prerequisites or missing management capabilities.

## Scope of the verdict and changes required before adoption

Keep revisions 11 and 12 proposed and record `revise` for each entry, linked to this review.
Use the replacement statements and table corrections above. Retain checked model equalities
as explicitly limited results. Add actual selector, observation, authority, resource, discovery,
dispatch and transition composition obligations to the trace; do not describe them as discharged.
The counterexamples supplied here must be rejected by those strengthened obligations, with
positive controls for legitimate protocol assertions, measured resources, operator policy,
semantic input and scoped delegated actions.

The evidence supports removing the identified administrative mechanisms and restrictive defaults.
It does not prove that every number, stored record, declaration or boundary is the same defect.
G1/G2 plus positive behavior laws can formalize the runtime portion of the concern. Repository
maintenance rules and the judgment that a process creates needless work remain explicit review
policy. No application law can prove that every future development rule is productive.

This contribution changes only review records and review probes. It certifies the reported
model checks and counterexamples at the pinned compiler. It does not certify the current
JavaScript implementation, a green deployment suite, or any landing outcome.
