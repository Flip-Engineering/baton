# Native construction and assignment proposal for #671

Status: source-grounded proposal for six independent reviews before effect implementation.
The concise read repair has its own candidate and qualification gates. This document
adds no runtime permission and does not change the historical control or semantic
specification verdicts.

## Ordinary operations

Preserve existing forms. Propose these extended forms:

```text
ensemble ENSEMBLE OWNER COUPLING [--section SECTION CAPABILITY]...
recruit PLAYER PARENT HARNESS MODEL EFFORT REPO BRANCH PATH BASE
  --role player|associate-conductor
  [--ensemble ENSEMBLE OWNER]...
  [--section ENSEMBLE OWNER SECTION]...
  [--command EXECUTABLE --log OUTPUT_LOG]
  [--start INPUT_ID TASK_FILE]
dispatch-task INPUT_ID SENDER PLAYER TASK_FILE
  [--command EXECUTABLE --log OUTPUT_LOG]
```

Each invocation produces one native result. Repeated groups have fixed arity;
quoted values remain complete values. Reject unknown options, repeated singleton
options, incomplete groups and invalid role/coupling values before effects.
Normalize identical Section declarations; conflicting declarations for the same
Ensemble/Section key refuse. Extended recruit requires explicit role and parent.
Legacy recruit without extension options retains its current behavior.

An Ensemble declaration requires an existing Conductor owner. Its explicit
coupling and explicitly named Section capabilities set those existing values;
omitted Sections and memberships remain unchanged. A conflicting existing owner
refuses the whole operation. Ownership does not add membership.

Recruit adds one assignment and its explicit responsibility. Named Ensembles and
Sections must already exist. `--section E OWNER S` requests both membership in E
and membership in S. Owners are explicit per group and may differ from PARENT.
Membership additions are idempotent; omitted memberships remain unchanged.
A matching existing assignment preserves parent, native identity and workspace.
An existing role different from the requested role refuses; the result names the
ordinary role operation for an intentional change. This extended retry does not
silently reverse a promotion. Existing standalone role admission is unchanged.

Repeated ordinary recruit operations with explicit parents create siblings or
nested Associates. Existing start/attach and role operations establish the initial
Principal, who can directly own an Ensemble. The same operations build multi-Player
Sections and critic Ensembles. Installed help must expose these cases. No implicit
parent is derived from a previous invocation.

## Complete structural admission

Baseline `Store.commit` surrounds command SQL with `BEGIN IMMEDIATE` and `COMMIT`;
`host/sqlite.c` rolls back actual SQL errors. Existing role, Ensemble, Section and
assignment helpers return refusal rows. Concatenating them can commit earlier
changes even when a later helper refuses. `Store.refused` examines returned text
after commitment. See `coordinator/store.bend:13-34`, `commands.bend:139-153` and
`commands.bend:223-265`, source baseline `98fbfe03`.

Normalize the complete request before SQL execution. In the existing transaction,
materialize one connection-local TEMP decision containing admission and the first
failing condition before any structural write. Its predicates evaluate stored
facts and normalized proposed facts, including the proposed child's parent and
role. Every write and the final result use this frozen decision. The TEMP object
is discarded with the connection; it is not a retained operation record.

Factor shared admission predicates from the actual existing helpers where needed.
All new writes use the same role, ownership, assignment and membership rules.
Requested Ensemble membership satisfies the same request's Section prerequisite.
Existing grouping operations' stopped-session behavior remains unchanged. Receiver
and task launch retain their existing active-session admission as separately
requested effects. Emit one final success/refusal row and classify every new
refusal code as nonzero. Actual SQL errors roll back the entire structural set.

A late invalid Section must preserve preexisting coupling, capabilities, role and
membership values. Tests compare complete relevant rows, since equal counts alone
do not establish preservation. Re-evaluating a guard after each mutation requires
an invariance proof; this proposal uses the frozen decision directly.

## Git, registration and startup boundaries

1. Parse and preflight the whole request, including assignment conflicts, roles,
   referenced owners/Sections, repository/base and requested executable/log/task
   prerequisites. Validate proposed child facts without registering it early.
2. Create the Git branch/worktree for a new assignment using existing Git creation.
3. Revalidate live structural facts and register assignment, role, memberships and
   any receive endpoint together in the transaction described above.
4. For requested startup, commit receive input and initiate delivery, or initiate
   the existing direct-turn path. Return the actual completed boundaries.

These are dependencies between effects; independent preflight reads can run
concurrently. Factor Recruit's self-printing `IO(Unit)` helpers into typed internal
results so the outer operation prints one answer. `recruit.bend:46-72` currently
creates Git work before registration. Git failure may leave partial artifacts;
registration failure after Git success retains the branch/path and resolved base.
Report those facts or an unknown artifact outcome. Existing files are preserved.
An unregistered occupied path is not automatically adopted on retry.

An existing assignment takes the existing registered-workspace path. Its stored
coordinates must match, and actual Git state must be inspected before claiming
usability. A successful assignment does not prove startup happened. A known static
startup refusal is caught in preflight; a later race or host failure returns the
committed structure and the remaining action.

## Harness selection and replay

Share one native startup function between recruit's `--start` and `dispatch-task`.
Recorded harness selects receive for Codex/OMP and direct turn for Muse/Claude.
Receiver configuration reuses `Control.configured_endpoint`, identity checks and
`receiver_admitted` (`control.bend:90-124`). Command and log must be supplied as a
pair. An existing compatible receive endpoint can be used without that pair;
a differing registered endpoint is a conflict requiring explicit receiver change.

Muse/Claude require command/log for each direct startup because no reusable direct
endpoint is recorded. Configuration without startup refuses for these harnesses.
Preserve their existing input limits; this operation does not add live steering.
A task file is required for detached direct startup; `-` refuses. The direct path
validates and later rereads a file (`control.bend:206-243`, `turn.bend:463-474`);
its result identifies a validated file reference, not committed immutable task
bytes. Receive startup retains the complete ordinary input body and identity.

For recruit startup, the sender is explicit PARENT. For dispatch-task it is SENDER.
Validate the actual task route before effects, using the proposed child where
needed. Recruitment itself retains admission of any registered parent; startup
can separately refuse a parent without the required message route. No automatic
parent promotion is introduced. Direct dispatch-task adds this wrapper route
check; existing dispatch-turn has no sender argument.

Before a repeated startup, inspect retained input, execution and turn identity.
Conflicting receive input refuses through the existing exact-message predicate.
An active attempt or unresolved launch outcome never implicitly starts another
process. Return its retained identity and native inspection operation. A terminal
record supplies its actual status/report only when retained and read. Review must
verify that each harness's existing records can distinguish the implemented retry
cases; inability to settle a launch returns `outcomeUnknown`, not a success or an
automatic retry. Structural retries and startup retries are separate decisions.

## Results and MCP

Use a native typed result with refusal, configuration-complete, startup-initiated
and partial-failure variants. Relevant fields identify operation/subject, committed
structure, workspace phase and retained coordinates, registration phase, chosen
route, endpoint configuration, input or validated-file identity, launch disposition
and returned PID. Completion is `notObserved` unless terminal evidence was read.
Stable error code, failing stage, condition and next native operation accompany
nonzero refusal/partial results. Ensemble configuration omits inapplicable process
fields. A PID establishes launch initiation, not readiness, receipt or work success.

Extend existing MCP ensemble with Section declarations and recruit with explicit
role, parent, memberships and optional startup/configuration. Add matching
`baton2_dispatch_task`. Each maps to one native invocation and preserves typed
partial-failure content. JSON-to-argv translation performs no structural mutation.
Both surfaces expose the same required values, effects and retry limits. Existing
MCP forms keep their defaults; extended recruit requires explicit parent/role.

## Registered implementation handoff

The measured secondary synthesis worktree is preserved as the source author's
worktree. Root's `root-native-worktree-resolution-scope-671` selects substantive
handoff into registered `semantic-controls-interfaces-research`: it reviews,
applies and qualifies the author's commits in its recorded branch. Synthesis
retains integration review responsibility. Current `worktree PLAYER` and
`land-checked PLAYER REPO TARGET CHECK FILES` then resolve the actual candidate.
No secondary-worktree registration, new model actor or assignment rewrite is
proposed for this case. Root retains final landing authority.

## Acceptance and source limits

All six reviewers assess this exact proposal before effect implementation. Then
operative laws bind actual parse/admission/result functions; host tests establish
Git, SQLite and process effects. Required cases include late structural refusal,
SQL rollback, exact retry/conflict, cross-parent membership, ownership without
membership, occupied paths, registration failure after Git success, startup
failure after structure/input commitment, active and uncertain launch retry,
complete partial-error MCP output, and actual native landing of the reviewed
registered branch. Root's target/candidate regression and accepted receive
composition gates remain in force.

Installed cold qualification permits a high-level task and required installation,
workspace and harness values. Agents must discover construction steps through
product help/briefing; retain interventions and cite the product surface used.
Separate assignments may proceed concurrently. Actual tree construction, dispatch
and retained report retrieval must be observed; help inspection alone is not an
execution result.

This proposal draws on retained reports
`semantic-controls-structure-research-671-construction-1`, its correction
`semantic-controls-structure-research-671-correction-2`, and
`semantic-controls-interfaces-construction-peer-671-1`. The researcher originals
remain unchanged. The correction withdrew a stopped-role restriction and repaired
a partial-commit counterexample; the author selected frozen admission over the
remaining unproved guard-invariance claim. No construction host effects or cold
qualification have been executed for this proposal.
