# Custody duty correctness review

Reviewer: session `native-critic-duty-correctness` (independent critic, critic Ensemble).
Review base: `fca7af876c8260c32d17f95f3e19bc68ee1bf561`. Review date: 2026-10-07.

## 1. Scope and method

Read-only review of the owner worktree (branch `native-instance-owner-custody`, HEAD
`6fbd75bc5dcf5c88f68343296938774b67f4856d`, a descendant of the review base; the three
owned files are committed and clean there):

- `bend2/src/context/custody-tasks.bend`
- `bend2/test/native-instance-owner/custody-tasks.bend`
- `bend2/test/native-instance-owner/run.py`
- `docs/bend2/shared-owner-task-custody-design.md`, sections 1, 2, 7, 9 and 10.

Host-side citations were verified against `fca7af87` in the reviewer's own worktree
(`bend2/src/host/process-spawn.c`, `bend2/src/coordinator/stop.bend`; `stop.bend` is
byte-identical between the two worktrees, so the fixture's import closure is the same in
both).

All compilation and execution ran on the admitted remote host `atari-homelab` under the
root-authorized exact-source private probe allowance. The exact owner bytes were verified
by sha256 at every transfer step. No compiler ran on the operator laptop. No protected
branch was mutated.

## 2. Reviewed artifact identity

| File | sha256 |
| --- | --- |
| `bend2/src/context/custody-tasks.bend` | `f36c717abd98b783574dd1ba36f9865d580068887eed3834b993cd88c4dc4b7f` |
| `bend2/test/native-instance-owner/custody-tasks.bend` | `a8396804b7f75904700c09f63063300d8c9c6853ef47e05e02b7d0aaf211ee29` |
| `bend2/test/native-instance-owner/run.py` | `cfb78d24d53ba85849bad1b360ac5819e5e9bbc8f0ec2bba5831ffd48cfadfd2` |

## 3. B1 (blocking): the reviewed fixture does not compile

Bend 2.0.25 refuses the fixture with three independent syntax defects.

1. Fixture lines 91 and 94 use `match` as the right-hand side of a `<-` bind
   (`present : Unit <- match rebuilt:` and `+retriednotice : Custody.Duty <- match rebuilt:`).
   Diagnostic: `expected : a term (a match heads a def body, not a term)`, located at line 91.
2. The `do IO<Unit>` block of `checks()` ends with a bind (`completes : Unit <- check(...)`)
   rather than a term. Every working do block in the same file ends with a term expression.
   Diagnostic: `the keyword 'def' cannot head one`, located at the following `def failure` line.
3. Fixture line 100: `+rebuilt : Maybe<Custody.Duty> <- IO.pure(Maybe<Custody.Duty>,...)`.
   A `+` bind annotates a nullary type witness; `Maybe<Custody.Duty>` elaborates to a type,
   so the compiler reports `expected : Data, observed : Type`. The codebase convention binds
   parameterized types without `+` (for example `session-lock.bend:19`,
   `lock : Maybe<U32> <- IO.try(Maybe<U32>,...)`).

Consequence: no runtime evidence (five process modes, four mutation probes) is producible
from the reviewed bytes, and the runner's expected-exits table has never been exercised by
its own author. The build failure occurs before every later check.

## 4. B2 (blocking): seven module laws do not verify

Mechanism, established with minimal probes (`lawprobes/p1`-`p4` in the remote scratch):
the Bend 2.0.25 law checker keeps `for`-quantified variables symbolic. `String.eq(s,s)`
reduces to `String.eq.fin(String.cmp(s,s))` and stops there; `U32.is_eq(n,n)` behaves the
same. Unused quantified variables are harmless. A `Bool.pick` whose condition is such a
stuck equality cannot equal a concrete value, and two picks whose conditions differ
structurally are unequal even when they denote the same decision.

Laws the compiler proved failing, in discovery order:

1. `attempt_validation_reads_the_attempt_record_not_the_slot` — claims
   `Done{open_duty(owner,attempt)}` while `check_attempt` stays stuck on
   `owner_eq(owner,owner)`.
2. `owner_check_decides_on_binding_and_token` — the law's pick carries the bare condition
   `String.eq(token_of(owner_of(duty)),token)`; the implementation's condition is the full
   `Bool.and(String.eq(binding,...),String.eq(token,token))`, and the checker cannot
   identify the two.
3. `a_failed_continuation_retains_its_error_and_the_owed_flags` — the
   `Bool.not(String.eq(errors_of(...),""))` conjunct is undecidable for a symbolic `error`.

The original forms of these four laws have the same defect and were restyled before the
compiler reached them: `slot_check_accepts_the_current_generation` and
`a_differing_attempt_is_refused_as_unknown` (stuck eq-self claims against concrete
outcomes), `slot_check_decides_on_generation_equality` and
`a_replaced_slot_refuses_a_superseded_generation` (simplified pick conditions).

Required correction: restate the seven laws with decidable formulations — concrete
witnesses, the pattern the rebuild and record laws already use. A structural mirror of the
implementation body would restate the code it claims to verify and pins nothing.

## 5. Runtime and mutation evidence (probe build)

To separate the syntax failures from the module's behavior, the review ran the full
fixture on a labeled probe tree: the module's decision functions are byte-identical to the
reviewed module; the fixture's three syntax defects are corrected minimally; the seven
laws of B2 are restated with concrete witnesses. The probe work is recorded in the remote
scratch (`probe/probe-fixture.patch-description.txt`, `probe/probe-fixture.diff`, commits
`50380e72` through `30c0c44`). The reviewed bytes are untouched. This probe is a
diagnostic, not the author's fix.

Results on the probe build, all recorded with full output and completion records under
`evidence-9/`:

- `laws` mode: exit 0. All 27 checks pass, including
  `released-not-acknowledged-rebuilds-open-ok`, `ack-without-marker-keeps-duty-open-ok`,
  `closed-duty-retains-its-errors-ok`, `failed-settlement-survives-ack-ok`,
  `unacknowledged-fulfilled-rebuilds-open-ok`, and `notice-retry-completes-retirement-ok`.
- Process modes: `die` exit 23, `try` exit 24, `stopped` exit 2, `result` exit 0 — the
  runner's expected table holds.
- Mutations (module source mutated in fresh scratch copies, `bend --check-only`):
  1. `acknowledged-drops-duties`: refused, exit 1, diagnostic names
     `acknowledged_attempt_with_owed_notice_stays_a_duty`. Recorded by the runner.
  2. `ref-open-wake`: refused, exit 1, but the diagnostic names
     `acknowledged_attempt_with_owed_notice_stays_a_duty`. The mutation refutes both
     rebuild laws and the compiler reports the first in definition order; the runner
     asserts the targeted name and aborts (`run.py:209`).
  3. `wrong-attempt-accepted`: refused, exit 1, names
     `a_differing_attempt_is_refused_as_unknown` (manual run).
  4. `settlement-fail-clears`: refused, exit 1, names
     `a_failed_settlement_survives_host_acknowledgment` (manual run).

R1 (runner defect): mutation diagnostic attribution must be order-independent. One
mutation refuting several laws is refused correctly, and the refusal evidence exists, but
the runner's strict targeted-name check discards it.

## 6. Property verdicts

### Property 1 — historical duties: PASS with one counterexample (M1)

Verified components: `check_attempt` never reads a slot (its body references only the
duty's owner and attempt records and the queried owner and attempt; the runtime check
`attempt-check-after-slot-replacement-ok` passes). A settled Fail retains its error text
(`keep_error` appends only on `RefFail`) and never fulfills the wake or the ACK
(`fulfilled` is true only for `RefDone`; runtime checks
`failed-delivery-settles-and-leaves-wake-owed-ok`, `settlement-retry-retains-error-ok`,
`notice-retry-retains-enumerated-errors-ok`). The released-not-acknowledged window
rebuilds as an open duty: `br_recovery` returns an empty recovery when the `released`
marker exists (`process-spawn.c:1094-1097`, verified at `fca7af87`), and
`rebuild(acknowledged=False, ...)` yields `ack_owed=True` with an open `ack` reference;
runtime check `released-not-acknowledged-rebuilds-open-ok`.

Counterexample M1 — `rebuild` mis-records a wake debt for an attempt that never completed:

1. `open_duty(owner, a)` records `wake_owed=False`. The module comment states the
   invariant: no wake is owed before the attempt completes; `seal_completion` is the
   transition that creates the debt.
2. The owner restarts while attempt `a` is still running. Enumeration supplies
   `acknowledged=False`, `native=RefOpen`, `delivery=RefOpen`, `settle=RefOpen`,
   `continuation=RefOpen` (design section 12 step 2 rebuilds open duties for exactly this
   state, so this is the intended flow, not a misuse path).
3. `rebuild(a,owner,False{},RefOpen{},RefOpen{},RefOpen{},RefOpen{},"")` returns
   `Some{Duty{..., wake_owed=True{}, ...}}`.

`rebuild_decided` computes `wake_owed = Bool.not(fulfilled(delivery))` unconditionally.
The rebuilt duty carries a parent-wake debt although no completion was sealed and no
sealed report exists, and the same evidence state built by `open_duty` records
`wake_owed=False`: the two constructors disagree on identical evidence. Duty retirement is
unaffected (`duty_open` is true either way); the recorded flag misstates delivery
responsibility to any consumer of `wake_owed_of`. No fixture check and no mutation covers
a `native=RefOpen` rebuild (the `window` check uses `RefDone{"enumerated"}`).

Required correction: gate the wake flag on the native outcome being settled, for example
`Bool.and(Bool.not(ref_open(native)), Bool.not(fulfilled(delivery)))`, or state and pin
the host precondition that `rebuild` is invoked only for attempts whose native outcome the
enumeration records as settled, and add a fixture check with `native=RefOpen`.

### Property 2 — slot versus attempt validation: PASS

`check_slot` reads only `Slot` fields and governs only active-slot decisions.
`check_attempt` takes no slot parameter; the law quantifies slots without using them, and
the runtime check passes after a replacement. `attempt_eq` compares the attempt's recorded
admission generation; that is attempt-record content, and historical validation never
reads the current slot generation. Two observations, both contract-consistent:
`check_slot` reports a session mismatch and a generation mismatch with the same
`StaleSlot{generation}` refusal, as its comment documents; `advance_slot` names the new
slot without validating the session argument against the current slot, so the design's
`stop.bend` handoff row should state the host ordering rule (validate with `check_slot`
before `advance_slot`).

### Property 3 — wake claims: PASS

No function in the module takes a wake, a replay, or a slot as input, and none derives
input receipt, consuming attempt, or native startup from one. The law
`rebuild_makes_no_input_receipt_claim` pins the separation on the recording side, and the
runtime checks `rebuild-acknowledged-is-empty-ok` and
`unacknowledged-fulfilled-rebuilds-open-ok` agree with it. M1 is the inverse derivation (a
wake debt recorded without completion evidence) and is reported under property 1.

### Property 4 — duty completion: PASS

Closed-while-error-retained: `a_fulfilled_settlement_closes_the_completed_duty` and the
runtime check `closed-duty-retains-its-errors-ok`. Ack-without-marker staying owed:
`an_ack_without_marker_evidence_keeps_the_responsibility`, `rebuild`'s
`ack_owed=Bool.not(acknowledged)`, and runtime checks `ack-without-marker-keeps-duty-open-ok`
and `unacknowledged-fulfilled-rebuilds-open-ok`. Failed continuation changing no
responsibility: `record_continuation` writes only the continuation reference; the flags and
other results pass through unchanged, and the runtime checks
`failed-notice-keeps-wake-owed-ok` and `notice-retry-completes-retirement-ok` agree.

Observation: `record_settle` and `record_delivery` clear conjunctively with the previous
owed flag. A Fail recorded after a clearing Done leaves the responsibility cleared while
the retained reference shows the Fail and the error text stays readable. This is reachable
only by a host call after fulfillment and matches the stated clearing rule; the author
should confirm the host never records a retry after fulfillment.

### Property 5 — design doc sections 1, 2, 7, 9, 10: PASS with required corrections (D1)

Verified against `fca7af87` source:

- Release and ACK are distinct keeper steps. `BR_RELEASE` requires `exited`, closes
  `keeper->lock`, and writes the `released` marker (`process-spawn.c:719-724`). `BR_ACK`
  requires `exited` and `released`, writes the `acknowledged` marker, marks the keeper
  finishing, and unlinks the stdout spool (`process-spawn.c:725-731`). Marker writes are
  exclusive (`br_file`, `O_EXCL`, `process-spawn.c:183-186`), and only the release and ACK
  paths treat an existing marker as success (`process-spawn.c:604-605`).
- `br_recovery` suppresses recovery at the `acknowledged`, `released`,
  `native-start-error`, or missing `launch` markers (`process-spawn.c:1094-1097`), which is
  the doc's §2 claim about the released-not-acknowledged window; the module keeps that
  attempt an open duty with the acknowledgment owed, and the runtime check passes.
- §7: `baton_children` is a process-local array (`process-spawn.c:27`) and handles increase
  monotonically for the life of the process (`call->handle=(u32)baton_child_count++`,
  `process-spawn.c:1250`).
- Queued wake versus consuming attempt (§2): the module contains no decision that derives a
  consuming attempt from the active slot, and the law pins the recording side.
- Database policy (§1): the doc states one canonical selected path, a checked physical
  identity at binding time, database-level owner exclusion, and explicit refusal of
  multiply-linked or replaced database files. The module keeps binding identity opaque
  (`OwnerInstance.binding` is host-supplied text; the header defers the binding policy to a
  separate module), which matches the stated boundary.

Required doc corrections (D1):

1. §2 lists "the four tracked results (delivery, settle, ACK, continuation)"; the module
   tracks five and seals the native outcome through `seal_completion`/`record_native`.
2. §9's proposed `Custody.rebuild` surface omits the `continuation` and `errors`
   parameters the module requires.
3. §9 states a parent wake clears when a delivery result names the original report ID; the
   module's `Duty` carries no sealed-report identity and `record_delivery` clears on any
   `Done` result. Either carry the report identity in the duty and check it, or state the
   host-side correlation precondition explicitly (§10 requires the correlation; the module
   cannot enforce it as built).
4. §2's accepted wake that fails before any attempt exists ("empty attempt list") has no
   representation in the module (`Duty` requires an `Attempt`); the design should name the
   structure that holds that state.

## 7. Required corrections, summary

- Fixture (B1): hoist the two bind-position matches into def bodies, close the `checks()`
  do block with a term, and bind the parameterized rebuild result without `+` behind a
  single-consuming helper.
- Module laws (B2): restate the seven laws with decidable formulations.
- Module decision (M1): gate the rebuild wake flag on the native outcome being settled, or
  state and pin the host precondition, and cover `native=RefOpen` in the fixture.
- Runner (R1): attribute mutation refusals order-independently.
- Design doc (D1): apply the four corrections above.

## 8. Remote execution record

- Host: `atari-homelab` (100.67.190.58), Linux x86-64, 64 cores, load near 27 during the
  runs. Scratch root: `~/baton-critic-custody-fixture-20261007`.
- Exact-source assembly commit `6f5a041c` (bend2 tree at `fca7af87` plus the three owned
  files, hashes above, verified on the remote after transfer). Probe commits `50380e72`
  through `30c0c44`. Evidence directories `evidence-1` through `evidence-9`, manual
  mutation directories `mut-ref-open-wake`, `mut-wrong-attempt-accepted`,
  `mut-settlement-fail-clears`, law probes `lawprobes/p1`-`p4`. Each launch and completion
  is recorded as JSON with exit status; stdout and stderr are retained per child.
- Toolchain: bend 2.0.25 (`~/baton2-worker-20261006/bend/bin/bend`, hash recorded in
  `evidence-9/identity.json`), clang 19 (`/usr/lib/llvm-19/bin/clang`), python3 3.12.3,
  `libsqlite3` present. The runner asserts the exact bend version string itself.
- Required command for the author's admitted run after applying the corrections, reported
  and not executed by this review beyond the authorized private probe:
  `python3 bend2/test/native-instance-owner/run.py --bend <bend-2.0.25> --output <fresh-dir>`
  with `CC` set to the admitted clang, expecting build exit 0; `laws` exit 0 with all 27
  checks; `die` 23; `try` 24; `stopped` 2; `result` 0; and four mutation verdicts each
  naming their targeted law.

Scope limits: this review covers the named module, fixture, runner, and design sections.
Sections 3-6 and 8 of the design doc were read only where they overlap the reviewed
sections. No claim is made about runtime completion of the shared owner.
