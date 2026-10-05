# Ordinary direct startup repair for #672

Status: concrete proposal for whole-critic assessment before runtime edits.
Author: semantic-controls-next. Source baseline is the direct path inspected at
71695806 and the retained process implementation inherited from 98fbfe03. The
active receive successor remains independently owned and unaccepted. Application
must preserve its final observation and normalization changes.

## Measured failure and scope

Tracked test 920f9430, `bend2/test/direct-start-boundary.py`, executes ordinary
`turn` and `dispatch-turn` using fresh Muse and Claude fixtures. The qualified
log `/tmp/controls-next-direct-boundary-qualified.log` records two failures for
each harness. A completed turn ID silently replays its report after executable,
task and log changes. After selective observer death, another turn starts and
replaces the execution row while the original endpoint remains responsive. The
same second turn refuses while the original observer holds the session lock.
The retained report is `controls-next-671-direct-measured-audit-root-1`.

These measurements select two required changes: retained exact request identity,
and retained ownership of the direct child across observer loss. The common
entry must establish them for both existing commands. Structural construction at
71695806 configures Git and grouping independently. Future construction startup
and semantic startup compose this ordinary primitive after its qualification.

Keep OMP, Codex, Muse and Claude support, including supported resume behavior.
No optional-start-only implementation is introduced. This proposal does not
approve runtime implementation or claim the unmeasured failure windows pass.

## Request identity and storage

Add one `direct_requests` table to the existing coordination database. Its key is
the public turn ID. It retains session, versioned immutable request JSON, attempt
directory, phase, native outcome, result-message ID and notification disposition.
This row is required after a later execution replaces the per-session
`executions` pointer: exact retries of an older completed ID still need its
original request. An executions-only column cannot retain that history.
No task selection, queue ordering, new worker registry or scheduling API is added.

Request equality compares normalized values field by field, not only a digest:

- session, recorded harness and parent/report recipient;
- resolved harness executable, model, effort, absolute workspace and output path;
- absolute supplied task path and the exact captured task bytes;
- explicit native-resume argument when supplied to ordinary `turn`;
- the resolved native-resume value and adapter argv/input used by this attempt.

For `dispatch-turn`, native resume is selected from the recorded session only
on initial admission and is then retained. A matching retry uses that saved
selection; a native identity observed during completion does not change the
original request. Current requested model, effort, workspace, harness, command,
task and output must still match. For `turn`, changing its explicit resume value
is a conflict. Report-recipient changes cannot silently redirect an old result.

Canonical absolute paths remove relative-path ambiguity. Executable identity is
the resolved pathname, not a claim that external code at that pathname is
immutable. The task is captured once and both admission and invocation use those
bytes. Muse receives a private immutable task copy in the attempt directory;
its original supplied path remains part of request identity. Preserve Unicode,
empty values and literal arguments. Reject values the existing host argv cannot
represent before admission.

A matching completed request returns its retained result. A differing field
returns exit 2, `direct-request-conflict`, naming the field and original request.
An old report without a direct request row returns `direct-history-unbound` for
an attempted start/replay; ordinary `delivery ID` still retrieves it. Existing
history must not be retroactively bound to a newly supplied request.

`executions` remains the current per-session process projection. An unresolved
execution, including a legacy direct execution with no directory, cannot be
replaced by a different turn. Its typed refusal names the existing attempt and
ordinary inspection. Refusal does not claim that a lost observer's endpoint has
exited. A historical notification may remain owned after native exit while a
new turn runs; it remains attached to its original direct request.

## Common entry and admission boundary

Introduce `Direct.begin(request, mode)` where mode is foreground or detached.
Both `Turn.run` and `Control.dispatch_turn` call it. Internal recovery calls
`Direct.recover(database, requestId, directory)` and consumes immutable bootstrap
input, never a newly supplied task. Remove the current detached `turn` wrapper
launch from `dispatch_turn`; its public answer follows the retained handoff.

1. Resolve and validate the complete request without process effects. A retained
   request is checked first: an exact active retry reads that attempt, and a
   conflicting request refuses. For a new request acquire the canonical session
   guard, then recheck historical identity, current execution and terminal stop.
   The transactional admission repeats these checks to close concurrent races.
2. Prepare the existing retained-process keeper with the normalized immutable
   bootstrap request and adapter launch configuration. The prepared keeper holds
   the inherited guard, control endpoint, output spool and recovery invocation.
   It cannot invoke the harness before a separate start grant. Its readiness
   answer reports `prepared`, with no native PID.
3. The attached observer commits admission in one SQLite transaction. Recheck
   session assignment, exact request identity, stopped state and unresolved
   execution. Insert the immutable request and update the current execution only
   on successful admission. The request row and execution pointer commit together.
   This transaction is the authoritative admission decision.
4. The observer sends an idempotent start grant for that exact request to the
   same keeper. Recovery reads the same committed row before repeating a grant.
   A refusal cancels the prepared keeper without invoking the endpoint and
   returns the typed refusal. The keeper does not need SQLite access.
5. Foreground execution observes the retained child. Detached execution transfers
   observation to the direct recovery entry and receives its attachment
   acknowledgement before reporting accepted startup. A lost public reply is
   reconciled from the same request and keeper. It does not authorize a second
   endpoint. The caller's PID is not the handoff result.

A prepared manifest is immutable bootstrap input, not a second admission store.
The coordinator already knows the attempt directory before retain. The manifest
carries the request and recovery arguments needed for the original authorized
invocation to finish admission after caller loss. A surviving recovery observer
may perform step 3 when no decision exists, subject to the same revalidation.
A retained rejection prevents a delayed original observer from reversing it.

Before a keeper exists, caller loss leaves no admitted execution and cannot have
invoked the endpoint. After keeper preparation, its disconnect recovery owns
finishing admission or reporting refusal. After admission, caller/observer loss
must continue that admitted request. These are different barrier tests. No timer
or missing PID is evidence that the endpoint never ran.

## Retained-process changes

Extend the existing `ProcessChild` host implementation with these proposed forms:

```text
prepare(directory, launch, bootstrap, guard, recovery) -> Prepared(handle)
start(handle, requestIdentity) -> Started | AlreadyStarted | StartFailed | Unknown
state(handle) -> Prepared | Starting | Running | Exited | Unknown
```

The actual Bend types include structured errors and retained attempt identity.
Use the existing keeper, manifest, control socket, spool, guard transfer and
attach machinery. Existing `retain` callers keep their eager-start behavior;
prepared direct manifests have an explicit version/mode. `BR_READY` continues
to mean observer attachment. Add a separate start operation and state response.

The live keeper serializes grants. Before the one native spawn it records a
start-attempt marker and latches the decision. Repeated grants return the same
state and never spawn again, including after a lost reply. Never recreate a
keeper and replay a start after an uncertain spawn. A known host no-spawn error
is retained as such; missing post-spawn PID/birth data is `Unknown`.

Complete keeper setup that can precede spawn before accepting a grant. If a
post-spawn setup operation fails, the still-live keeper retains the returned
child identity, closes owned input and observes/reaps the child while publishing
the failure. It cannot take the current generic setup-error exit and abandon the
child. Signal a child only through verified owned identity. Fault injection must
exercise each remaining post-spawn setup error.

For selective observer loss, the keeper keeps the child, output and status and
starts direct recovery. A recovery spawn failure or recovery child exit before
attach keeps that responsibility. Add attempt-local retry on the keeper's existing
poll loop, with a bounded retry interval and no terminal retry-count cutoff;
record each error and cancel further retries only after attachment or completed
custody transfer. At most one recovery child may be in flight. This retries only
observation of this already-owned attempt; it cannot choose or start another task.

Keeper loss is separate. A surviving observer retains its guard descriptor and
uses the existing birth-qualified orphan observation when available. If the
spawn outcome or final status is unknowable, retain `Unknown`, prohibit effect
replay and deliver an uncertainty notice to the actual owner. A replacement
observer cannot claim `waitpid` custody of an orphan it did not parent. A notice
must say which observation and process facts are unavailable. Simultaneous loss
of keeper and every observer is not proven by this composition; whole-critic
assessment must evaluate that boundary explicitly, without silently narrowing
root's required selective-loss guarantee.

## Adapters, results and owed notification

Factor argv and initial-input generation from the four existing adapters so both
direct modes invoke the same harness-specific configuration. The keeper sends
captured initial input once. Use the accepted receive successor's observation
and terminal normalization functions without rewriting their interpretation.
Direct recovery replays retained output idempotently under the original ID.

The existing missing-resume fallback needs an explicit retained sub-attempt.
Permit it only after the first child is observed exited and the existing
adapter-specific no-conversation refusal is established. Record that transition
once and retain the fresh child with its own directory and custody. An unknown
outcome never authorizes this fallback. Preserve the ordinary recovery report
and workspace-state prompt; test both first-refusal and second-child recovery.

Commit native exit, final result and exact owed report IDs before releasing the
session execution guard. Guard release and keeper completion are distinct: the
keeper remains responsible for finishing notification after native exit. Direct
recovery must therefore remain available after guard release until notification
completion, even though the current generic recovery probe suppresses released
attempts. Subsequent execution-pointer changes do not erase the historical owner.

Use ordinary `Delivery` for the actual report and stopped-parent handoff. Expose
a structured delivery disposition from the real delivery call: acknowledged,
endpoint completed, unavailable or failed, plus the actual message/recipient and
any handoff ID. An empty endpoint currently returns success without invoking a
recipient; that value cannot complete this obligation. A committed pending row,
launched PID or receipt meaning only input acceptance does not establish review.

Only an actual native delivery result or accepted transfer of notification
responsibility permits final keeper acknowledgement. On failure, direct recovery
retains the owed IDs and retries their ordinary delivery under the same
attempt-local continuation. It does not re-execute the original harness. The
native session/request inspection reports notification failure separately from
native exit. Receipt arrival may settle delivery; task review remains separate.
Test a parent that sends new work while notification is being delivered so guard
release does not create a cycle or erase the older notification responsibility.

## Inspection, ownership and qualification

Add ordinary `turn-status ID [--pretty]` and its thin MCP reader. It returns the
request identity, process state, result/report IDs, owned directory and current
notification disposition. An exact active retry returns this same information.
Help and all harness briefings distinguish accepted start, observed exit,
uncertainty and delivery. The installed cold test must discover this route and
recover a selective observer-loss fixture without external JSON selectors.

Controls-next owns this proposal and, after approval, the new direct module,
request predicates/laws and direct host fixtures on
`codex/baton2-semantic-controls-next-20261005`. Receive currently retains exclusive
active `turn.bend` edits in audit-native, including consume threading and entry
callers. Direct integration waits for its frozen handoff and preserves those
functions. The interfaces Player owns shared parser/main/MCP/help/briefing edits
and final #671 source. Explicit function/file handoffs precede shared edits.
Controls-next also owns the proposed ProcessChild extension on its own branch
within the existing structure Section; no other host editor is authorized by
this proposal. Quality owns independent reviews; root owns combined
gates, landing and normal installation. No actor or workspace reassignment is
required. The intentionally failing direct test remains outside the read candidate.

Required host cases include the two measured cases on all four adapters; same-ID
concurrent equality/conflict; historical retry after later turns; task mutation;
caller loss before preparation, after readiness, after admission and after grant;
lost grant reply; delayed recovery/original observer races; known no-spawn;
selective observer loss during output and notification; recovery launch and
pre-attach failure; keeper post-spawn setup failures and keeper loss; terminal
stop winning admission; resume fallback; exact notification handoff and parent
new-work response. Fixture endpoints independently record their own effects.
Assert retained identities, output, status and delivery, not only process counts.

Operative laws bind actual request comparison, transactional claim/refusal,
worker validation and state transitions. Host tests bind the real keeper paths
and ordinary command entry. Preserve target-versus-candidate regression checks,
full harness coverage and accepted receive tests. Proposal assessment precedes
runtime edits; candidate review and installed acceptance remain separate gates.
