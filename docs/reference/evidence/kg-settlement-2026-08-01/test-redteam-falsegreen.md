# KG settlement red-first suite false-green review

## Scope and verdict vocabulary

This review covers the ten KS groups (18 `node:test` cases) in
`impl/test/kg-settlement-red.test.mjs:1-13,118-397` against the folded v1.0
contract in
`docs/reference/evidence/kg-settlement-2026-08-01/kg-settlement-decisions.md:8-134`.
It is an adequacy review, not an implementation review.

- **VACUOUS** means a concrete implementation can violate the behavior named by
  the row and still make its assertions green.
- **STAGED-RED** means today's row fails before it reaches the behavior named by
  the row. A staged row may also contain latent false-green assertions; those are
  called out explicitly.
- **SOUND** means no such wrong-green implementation or wrong-stage failure was
  found. There are no SOUND groups in this suite.

The suite's own standard is stronger than ordinary red-first coverage: every row
must fail for the named missing API, dispatch, enforcement, or hook and become
green only for the contract implementation
(`impl/test/kg-settlement-red.test.mjs:11-13`). KS9 expressly declares itself
green before and after, so the file contradicts that standard internally
(`impl/test/kg-settlement-red.test.mjs:376-385`).

## Executive verdict

**Overall verdict: UNSOUND AS A RED-FIRST GATE.** Seven groups are
STAGED-RED (KS2, KS4, KS5, KS6, KS7, KS8, KS10); three are VACUOUS (KS1,
KS3, KS9); none is SOUND. The current run reaches only one green case, KS9.
The other cases collapse onto three front-door gaps: the missing D1 helper used
by the hand-built fixture (`impl/test/kg-settlement-red.test.mjs:86-114`), the
unknown `settlement` policy supplied by every ritual fixture
(`impl/test/kg-settlement-red.test.mjs:494-503`; current closed policy at
`impl/src/wave-driver.mjs:31-53,67-78`), and the first unavailable command in
KS3's fail-fast loop (`impl/test/kg-settlement-red.test.mjs:206-214`).

The 18-case audit is:

| Test case | Verdict | Present/false-green reason |
|---|---|---|
| KS1 pair/brief | VACUOUS | Receipt fields are checked, not the two-event atomic batch. |
| KS1 closed input/actor | STAGED-RED | Missing method produces `TypeError` before either rejection contract. |
| KS1 mandatory/replay | STAGED-RED | Missing method prevents the replay assertions. |
| KS2 expired | STAGED-RED | Fixture dies while creating D1 task. |
| KS2 parent inactive | STAGED-RED | Fixture dies while creating D1 task. |
| KS2 foreign session | STAGED-RED | Fixture dies while creating D1 task. |
| KS2 positive control | STAGED-RED | Fixture dies while creating D1 task. |
| KS3 four dispatches | VACUOUS | “Any outcome except unavailable” accepts throws, no-ops, and wrong methods. |
| KS3 liveMethod | VACUOUS | Raw source substring is not a semantic dispatch assertion. |
| KS4 ritual | STAGED-RED | Policy validation fails before the member or hook runs. |
| KS4 `none` | STAGED-RED | Policy validation fails before zero-write behavior is observed. |
| KS4 honest-empty | STAGED-RED | Policy validation fails before zero-write behavior is observed. |
| KS5 re-drive | STAGED-RED | First drive fails policy validation; the second drive is never reached. |
| KS6 sweep | STAGED-RED | Fixture dies before `sweepSettlementLeases` is called. |
| KS7 promote | STAGED-RED | Hand-built D1 setup dies before application dispatch. |
| KS8 lanes | STAGED-RED | Policy validation fails before lane selection; link and plan are absent anyway. |
| KS9 surfaces | VACUOUS | It is green by design and its source search misses derived MCP exposure and CLI. |
| KS10 framing | STAGED-RED | Fixture dies before the frame assertion; the asserted frame is not in v1.0. |

Those stage points follow directly from the helper call sites and ordering:
`settlementFixture` calls `createAndClaimSettlementTask` first
(`impl/test/kg-settlement-red.test.mjs:86-95`), `ritualWave` constructs the
policy-bearing wave driver before `run()` (`impl/test/kg-settlement-red.test.mjs:494-503`),
and KS7 performs its manual D1 call before invoking `application.command`
(`impl/test/kg-settlement-red.test.mjs:314-342`).

## Cross-cutting findings

### Fixture authority: `settlementFixture`

`settlementFixture` does not prove D2/D3 wiring. It directly creates the parent
task, locally recomputes the lease identity and digest input, directly issues the
lease, directly posts and closes a board item, and locally derives the candidate
Finding id (`impl/test/kg-settlement-red.test.mjs:86-114`). Thus KS2, KS6, and
KS10 can green when `knowledge.settlement_lease` is absent, when it accepts a
caller-authored session, when the wave hook never creates a candidate, or when
the application cannot route either operation. The contract assigns lease
materialization and principal-derived session binding to
`knowledge.settlement_lease` (`kg-settlement-decisions.md:37-41`) and assigns the
note-to-board path to the wave hook (`kg-settlement-decisions.md:73-80`).

The primitive setup is legitimate only for narrowly labelled store tests. It
cannot be cited as integration evidence. Split it into:

1. a `primitiveAdmissionFixture` used only to test
   `admitWorkflowFinding`; and
2. an `applicationSettlementFixture` that calls
   `application.command('knowledge.settlement_lease', {waveId}, principal)`,
   obtains candidacy by running the real settle-window hook, and uses only the
   command's returned coordinates.

That split also prevents the test from sharing the implementation's lease-id
formula. The current test duplicates that formula at
`impl/test/kg-settlement-red.test.mjs:96-106`, while the contract requires the
identity to be server-derived and stable (`kg-settlement-decisions.md:18-21,38-41`).

### KS5 re-drive: second hook pass or upstream deduplication

KS5 proves only that aggregate state remains at one after a second top-level
`ritualWave` call (`impl/test/kg-settlement-red.test.mjs:278-290`). It never
asserts that the settlement hook was entered twice, that the second entry list
was non-empty, that a second elevate/lease/board attempt occurred, or that the
second receipt reports idempotent replay.

The harness makes the false green especially concrete. It reuses the first
context, uses the same unsalted objective and same wave idempotency key
(`impl/test/kg-settlement-red.test.mjs:494-511`), while the driver documents that
unsalted identical members opt into cross-wave run sharing
(`impl/src/wave-driver.mjs:287-307`) and the wave derives stable identity from
that key (`impl/src/wave.mjs:172-180`). The first driver call always closes the
wave after settle (`impl/src/wave-driver.mjs:669-675`); close stops every member
(`impl/src/wave.mjs:451-486`), and stop cleanup reaps both worker and shared
scratchpad partitions (`impl/src/coordination-store.mjs:13391-13443`). A second
hook can therefore see no eligible source entry and do nothing. An
implementation with completely non-idempotent settlement writes still passes
if upstream terminal-run/scratchpad dedup prevents those writes from being
attempted.

Concrete fix: test the contract's crash walk, not a completed-wave replay.
Inject a failure after candidacy step 1 and separately after step 2, before
`wave.close`; attach/re-drive the still-open same wave; instrument the settlement
hook or command facade and assert two hook entries with the same non-empty
source entry ids. Then assert the second pass returns the same shared entry id,
lease id, board item id, and event coordinates and adds zero duplicate events.
The contract explicitly requires stable identity and crash walks 1+2
(`kg-settlement-decisions.md:124-132`).

### KS7 teardown ownership

At black-box level KS7 does distinguish command teardown from test teardown:
between the first `knowledge.promote` call and the completion/revocation
assertions, the test performs no direct teardown (`impl/test/kg-settlement-red.test.mjs:340-348`).
The setup calls create, issue, post, and close only
(`impl/test/kg-settlement-red.test.mjs:319-337`), so a green state transition at
lines 344-346 would be attributable to the command.

It does not, however, prove the resumable three-step act. The only retry occurs
after a fully successful command (`impl/test/kg-settlement-red.test.mjs:350-355`);
a monolithic admit/revoke/complete implementation with no crash recovery passes.
The contract requires independently idempotent steps and recovery from a crash
after any step (`kg-settlement-decisions.md:30-35`). Add pre-command assertions
that the task is working and the lease active, assert the exact admit → revoke →
complete event ordering and command-owned idempotency keys, then inject one-shot
failures after admit and after revoke and reissue the same command key.

There is also a latent staged failure: the direct call omits `rawPrincipal`
(`impl/test/kg-settlement-red.test.mjs:340-342`), but `application.command`
normalizes that argument before dispatch (`impl/src/application.mjs:11767-11792`)
and the normalizer requires exactly actor/principal/session
(`impl/src/application.mjs:955-960`). Pass `principal('wave-owner')` explicitly
and acquire the lease through the command so its session is actually derived
from that principal, as D2 requires (`kg-settlement-decisions.md:37-41`).

### Staged-red contamination

The suite presently cannot establish “fails for the right reason” for any row
that depends on `settlementFixture`: the helper's first D1 call precedes expiry,
parent, session, sweep, and framing behavior
(`impl/test/kg-settlement-red.test.mjs:86-114,168-199,296-307,392-397`). Make
fixture construction use already-shipped lower-level primitives for primitive
rows, or guard each prerequisite with a separately named test and skip dependent
rows with an explicit dependency reason; do not count a fixture exception as the
row's red evidence.

Likewise, the ritual cases all supply `settlement` at driver construction
(`impl/test/kg-settlement-red.test.mjs:494-503`), and the current closed policy
rejects unknown fields before the run (`impl/src/wave-driver.mjs:31-53,67-78`).
Once the policy field lands, KS4/KS5/KS8 can reveal later gaps; their current red
does not exercise elevation, candidacy, re-drive, or lane selection. Record a
per-test expected failure code/stage during red-first development, or land the
policy-acceptance row separately before treating downstream reds as evidence.

### Contract requirements with no effective row

Several folded requirements have no assertion that can fail specifically for
their violation:

- Neither `scratchpad.elevate` nor `scratchpad.settle` has a positive
  application-to-coordinator mapping test. KS3 accepts any non-unavailable
  outcome from invalid empty arguments (`impl/test/kg-settlement-red.test.mjs:206-214`),
  although D2 names exact methods (`kg-settlement-decisions.md:25-30`).
- No row proves `knowledge.settlement_lease` derives all session authority from
  the calling principal, returns its closed coordinate shape, or replays by
  `waveId`; the shared fixture authors those values itself
  (`impl/test/kg-settlement-red.test.mjs:79-83,96-106`) despite D2 making all
  three properties normative (`kg-settlement-decisions.md:37-41`).
- No row makes the driver's `claimed` flag disagree with durable task status, so
  a hook that never re-reads the store passes. The contract explicitly requires
  the store status rather than that flag (`kg-settlement-decisions.md:69-72`),
  while the current driver maintains `claimed` as separate in-memory state
  (`impl/src/wave-driver.mjs:238-255,469-470`).
- No row proves the v0.9 shared-partition settle was removed. The folded
  contract requires scratch facts to remain live through the review window
  (`kg-settlement-decisions.md:86-90`), but KS4 checks no note fact liveness
  (`impl/test/kg-settlement-red.test.mjs:238-248`). A hook that calls
  `scratchpad.settle` and expires the note fact can still pass.
- No row proves ritual candidacy remains merely observed rather than being
  auto-admitted. D5 forbids auto-admission (`kg-settlement-decisions.md:113-118`),
  but KS4 never queries for absence of a `workflow.admitted` Finding
  (`impl/test/kg-settlement-red.test.mjs:243-254`).
- No row checks `settlement.errors` shape, the eight-error bound, receipt and
  terminal-outline agreement, or close-after-refusal behavior
  (`kg-settlement-decisions.md:81-84`). KS8's only assertions concern shared
  entries and board count (`impl/test/kg-settlement-red.test.mjs:367-372`).
- No row checks that terminal member runs are stopped only after ritual events.
  The ordering is acceptance-critical (`kg-settlement-decisions.md:95-99,124-129`),
  while all ritual assertions inspect only final projections
  (`impl/test/kg-settlement-red.test.mjs:233-254`).

## Row-by-row audit

### KS1 — atomic settlement-task API

**VERDICT: VACUOUS** (with staged second and third cases).

The first case checks a projected working task and only that the objective
*contains* the wave id (`impl/test/kg-settlement-red.test.mjs:121-135`). A fake
API that calls ordinary create/claim separately, emits extra events, accepts
arbitrary pinned identities, or sets objective to attacker prose plus `WAVE_ID`
passes. D1 instead requires exactly one two-event batch, exact hub-fixed
objective, a closed three-field request, and pinned task/run identities
(`kg-settlement-decisions.md:12-21`). The existing recovery API shows the
assertable pair invariants—two adjacent events, shared batch id/count, indexes
0/1, same timestamp, and bound claim key
(`impl/src/coordination-store.mjs:12141-12166`)—and the store exposes event reads
for such assertions (`impl/src/coordination-store.mjs:8578-8581`).

The negative case tries only one extra field (`objective`) and one wrong actor
(`worker`) (`impl/test/kg-settlement-red.test.mjs:137-147`). An implementation
that accepts another extra field or an `operator:*` actor still greens despite
the closed fields and orchestrator-only rule (`kg-settlement-decisions.md:14-18`).
The replay case compares only `result` and one event sequence
(`impl/test/kg-settlement-red.test.mjs:149-161`), not replay-exact pair contents,
changed-payload conflict, or same identity under a different key.

Concrete fix: assert the exact two-event batch and exact objective
`settlement task for wave ${WAVE_ID}`; assert returned task id/run id/version and
closed brief; parameterize every non-orchestrator actor and representative extra
field; reject mismatched task/run wave suffixes; deep-compare both replayed
events and task; add same-key/different-request conflict and different-key/same-
identity cases.

### KS2 — admission lease enforcement

**VERDICT: STAGED-RED.**

All four cases fail in D1 fixture construction before calling admission
(`impl/test/kg-settlement-red.test.mjs:168-199` through helper line 92). Once
unstaged, the negative codes are useful primitive checks, but the session case
changes principal id, session id, and authority digest simultaneously
(`impl/test/kg-settlement-red.test.mjs:185-190`). A wrong gate that validates
only any one of those three fields passes. The contract requires all three plus
expiry, parent liveness, and admission-open state
(`kg-settlement-decisions.md:42-49`), and acceptance also names revoked leases
(`kg-settlement-decisions.md:130-134`); revoked and run-stopping cases are absent.

Concrete fix: use the split primitive fixture, mutate each session coordinate
one at a time, and add revoked and run-stopping cases. Add a separate
application-level lease test proving caller session derivation; the manual
session/lease construction at `impl/test/kg-settlement-red.test.mjs:96-106`
cannot prove it.

### KS3 — application dispatch and registry live method

**VERDICT: VACUOUS.**

The dispatch row accepts every result except the single code
`application_command_unavailable` (`impl/test/kg-settlement-red.test.mjs:206-214`).
A handler that throws `TypeError`, always returns success, routes all four names
to one wrong method, trusts caller actor/session fields, or performs no mutation
passes. Because the loop fails on its first unavailable command, today's red
does not even execute evidence for the other three names. D2 requires four
specific coordinator mappings and server-derived orchestrator/principal
authority (`kg-settlement-decisions.md:25-41`).

The registry row source-slices between two string occurrences and checks only a
substring (`impl/test/kg-settlement-red.test.mjs:217-220`). A comment, duplicate
literal, or dead registry object can satisfy it while dispatch still calls
`promoteKnowledgeNode`; the present registry demonstrates that metadata and
live dispatch are separate (`impl/src/application-semantics.mjs:1480-1487` and
`impl/src/application.mjs:11767-11885`).

Concrete fix: make four independent tests with valid fixtures and a spy
coordinator. Assert exact called method, normalized arguments, server-derived
auth/session, mutation/result, and no alternate method call. Import and inspect
the exported semantic registry object for the metadata assertion; do not parse
source text.

### KS4 — settle-window ritual

**VERDICT: STAGED-RED.**

All three cases stop at policy validation before the hook
(`impl/test/kg-settlement-red.test.mjs:227-271,494-503`; current rejection at
`impl/src/wave-driver.mjs:67-78`). Once unstaged, the main case still permits
wrong implementations: detail need only contain the short note, no title is
checked, no pinned idempotency key is checked, no candidate Finding is queried,
no lease session is checked, no elevation disposition/fence is checked, no
terminal outline is checked, and no pre-close ordering is observed
(`impl/test/kg-settlement-red.test.mjs:233-254`). Each is a v1.0 acceptance
requirement (`kg-settlement-decisions.md:69-84,95-99,124-134`).

The `settlement:none` case checks only absence of settlement-relation tasks and
uses `?? 0`, allowing the required receipt field to be missing; it never checks
that note elevation, board writes, or other ritual events are absent
(`impl/test/kg-settlement-red.test.mjs:257-265`). The honest-empty case likewise
checks only task count and one receipt field, not the contract's zero ritual
ledger writes (`impl/test/kg-settlement-red.test.mjs:267-271` versus
`kg-settlement-decisions.md:59-61`).

The full-text assertion has a particularly direct false green: its note is
shorter than the 120-byte title ceiling
(`impl/test/kg-settlement-red.test.mjs:228-231`), so an implementation that puts
the truncated title into `detail` instead of the full note passes the
`detail.includes(...)` check (`impl/test/kg-settlement-red.test.mjs:243-247`).
That is exactly the stub-grounding failure the fold says the full detail must
prevent (`kg-settlement-decisions.md:76-80`).

Concrete fix: use a long multibyte/control-character note and assert exact
byte-bounded title and exact bounded detail; inspect event auth keys for
`board.candidacy:<waveId>:<sharedEntryId>`; query the observed candidate Finding;
assert shared fence/dispositions, lease session, terminal outline fields, and
ritual-before-stop event sequence. For `none` and empty, diff the full event log
against a non-ritual baseline and require the receipt's explicit numeric zero
without `??`.

### KS5 — exactly-once re-drive

**VERDICT: STAGED-RED**, with a decisive latent false green.

Today's first call fails before any wave starts
(`impl/test/kg-settlement-red.test.mjs:282-284,494-503`). Even after that stage is
fixed, the completed-wave second call can pass through upstream run/scratchpad
dedup without a second non-empty hook pass; it asserts only final item and lease
counts (`impl/test/kg-settlement-red.test.mjs:285-289`). The concrete crash-walk
fixture and hook-entry/id replay assertions specified in the cross-cutting KS5
section are required.

### KS6 — TTL sweep

**VERDICT: STAGED-RED.**

The row dies in D1 setup before the optional direct sweep call
(`impl/test/kg-settlement-red.test.mjs:296-301`). It calls the store API itself,
so a wave driver that never performs the required step-0 sweep still passes.
It does not assert revocation reason, the ≤16 bound, idempotency, scratch-fact
expiry, or admitted-candidate preservation; `state !== 'closed'` even permits an
incorrect reopened item (`impl/test/kg-settlement-red.test.mjs:302-307`). D3
requires a driver-triggered, bounded, independently idempotent sweep with reason
`review_window_expired`, task cancellation, candidate retirement, and fact
expiry (`kg-settlement-decisions.md:63-67`).

Concrete fix: seed 17 expired settlement bundles plus one admitted control via
an authority-appropriate fixture, trigger a new ritual wave (not the store
method), and assert exactly 16 processed on one pass; exact revoked reason,
cancelled task, dropped candidate, expired scratch fact; admitted control
unchanged; next pass finishes the remainder; third pass adds no events.

### KS7 — promote teardown and retry

**VERDICT: STAGED-RED.**

The manual D1 call at lines 319-322 currently prevents the command at lines
340-342 from running. The row does attribute successful teardown to the command,
but it does not test interruption between its three independently idempotent
steps, and it omits the required principal argument. Apply the pre-state,
principal, exact-event-order, and two crash-injection fixes in the cross-cutting
KS7 section. Also use an explicit same idempotency key on both attempts; the
contract makes that retry identity normative (`kg-settlement-decisions.md:30-35`).

Final-state assertions also do not prove “promotes exactly the candidate.” The
test finds any node whose trigger is `workflow.admitted`, without asserting its
id, `DerivedFrom` edge, or evidence against `candidateFindingId`
(`impl/test/kg-settlement-red.test.mjs:337-348`). A wrong command that creates one
unrelated verified Finding, revokes before admitting, and completes the task
passes. The retry only requires a truthy return and one such node, not a replay
receipt (`impl/test/kg-settlement-red.test.mjs:350-355`), while acceptance pins
the exact candidate, teardown ordering, and idempotent replay
(`kg-settlement-decisions.md:130-134`).

### KS8 — typed ritual refusal and D4 lanes

**VERDICT: STAGED-RED.**

The row fails at policy construction before elevation
(`impl/test/kg-settlement-red.test.mjs:362-372,494-503`). Its title claims doubt,
link, and plan behavior, but its writes contain only a doubt and note and its
assertions mention neither link nor plan (`impl/test/kg-settlement-red.test.mjs:362-372`).
It also contains no not-ready refusal despite D3 requiring that typed refusal to
be recorded (`kg-settlement-decisions.md:69-72`) and no disposition assertion
despite D4 requiring skipped dispositions (`kg-settlement-decisions.md:101-111`).

Concrete fix: include one valid note, plan, doubt, and link; assert shared kinds
are exactly note+plan, plan has no fact/Finding/item, doubt+link each have an
`orchestrator_skipped` disposition, and only note candidates. Add a separate
nonterminal-task row that forces `scratchpad_settlement_not_ready`, asserts one
bounded `{member,step,code}` receipt error and terminal outline error, and proves
close still occurs (`kg-settlement-decisions.md:81-84`).

### KS9 — embedded-only surface honesty

**VERDICT: VACUOUS.**

The source-text search looks only for four underscore literals inside
`mcp-northbound.mjs`, and the second assertion pins the unrelated capability
array exactly (`impl/test/kg-settlement-red.test.mjs:379-385`). MCP tools are
actually derived from registry rows whose `surfaces` include `mcp`
(`impl/src/mcp-northbound.mjs:69-72,543-561`). A wrong change from
`surfaces:['embedded']` to `['embedded','mcp']` in the semantic row exposes the
tool dynamically without adding any searched literal to that file; KS9 remains
green. The row never inspects the CLI command set, which is the structural CLI
gate (`impl/src/application-cli.mjs:15-25,1791-1799`), and never exercises the
recursive-context rejection implemented separately from
`RUN_ORCHESTRATOR_CAPABILITIES` (`impl/src/application.mjs:11793-11800`). D2
requires all three absences (`kg-settlement-decisions.md:50-55`).

Concrete fix: assert each semantic registry row has exactly the embedded
surface; assert the exported/generated MCP tool-name set and `CLI_WEB_COMMANDS`
exclude all four; call each command with valid arguments under a nested session
context and require `run_orchestrator_command_forbidden`; check set exclusion,
not exact equality, for capabilities. Keep this as a regression suite, or pair
it with the positive embedded dispatch rows; do not count a green-before-and-
after test as red-first evidence.

### KS10 — UNTRUSTED candidacy framing

**VERDICT: STAGED-RED.**

The row dies in D1 fixture setup before reading the board
(`impl/test/kg-settlement-red.test.mjs:392-396`). Its fixture directly posts the
title, so even a driver that never sanitizes worker notes can pass
(`impl/test/kg-settlement-red.test.mjs:107-112`). More fundamentally, v1.0 pins
title control stripping and full-detail grounding
(`kg-settlement-decisions.md:73-80`) and explicitly makes trust-gate changes a
non-goal (`kg-settlement-decisions.md:113-120`), but it does not define the exact
`frame` string asserted at `impl/test/kg-settlement-red.test.mjs:396`. The raw
store `boardSnapshot` currently returns board/fence/items/claims/reports only
(`impl/src/coordination-store.mjs:13836-13846`); the test does not exercise an
application “admission review” read path despite its title.

Concrete fix: remove KS10 from this contract suite unless v1.0 is amended with a
closed framing requirement. If amended, create the item through the real ritual
from a control-character-bearing worker note, read it through the actual review
surface, and assert the frame there plus exact sanitized title. Do not satisfy
the row by globally decorating raw store items.

## Concrete remediation matrix

| Priority | Fixture/assertion/row change | Repairs |
|---|---|---|
| P0 | Split primitive and application-authority fixtures; stop locally deriving lease identity. | KS2, KS6, KS7, KS10 |
| P0 | Replace KS5 completed-wave replay with two pre-close crash walks and assert second non-empty hook invocation. | KS5 |
| P0 | Replace KS3 negative-code smoke checks with four valid, spied dispatch tests. | KS3 |
| P0 | Add principal + before-state + fail-after-admit/fail-after-revoke tests. | KS7 |
| P1 | Assert atomic event-pair shape, exact objective/identity, closed fields, and replay conflicts. | KS1 |
| P1 | Assert full ritual event authority/order, title/detail, Finding, session, dispositions, outlines, and literal zero fields. | KS4 |
| P1 | Trigger sweep through the driver with 17 expired, one admitted, facts, exact reasons/states, and replay. | KS6 |
| P1 | Add link/plan and a separate typed-not-ready row. | KS8 |
| P1 | Test generated MCP/CLI registries and nested dispatch behavior, not source substrings. | KS9 |
| P1 | Remove KS10 or first amend the contract and exercise the real review surface. | KS10 |

## Verification

Mandated command, run from the assigned worktree:

```text
node --test impl/test/kg-settlement-red.test.mjs
```

Observed process exit code: **0** (the deployment contract's expected exit). TAP
result: **18 tests, 1 pass, 17 fail**; KS9 is the sole pass. That exit-code result
verifies execution of the requested command, not adequacy or semantic greenness
of the suite. The report is the only repository change; no `impl/` file was
modified.
