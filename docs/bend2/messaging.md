# Messaging

Messages address logical session IDs. A message retains its ID, sender,
recipient, kind, complete body and acceptance receipt. The coordinator checks
the route before admitting a new public message. `message-file` uses the same
admission path as `message`.

## Routes

| Sender and recipient | Admission |
| --- | --- |
| Conductor to any descendant | Allowed. |
| Subordinate agent to its immediate parent | Allowed. |
| Subordinate agent to a more distant ancestor | Refused. |
| Peers sharing an explicitly tight Ensemble | Allowed. |
| Conductor peers sharing a tight Ensemble | Allowed when they have the same hierarchy depth. |
| Peers with loose coupling or no shared tight membership | Refused. |
| Operator and a top-level Conductor | Allowed in both directions. |

Peer routes connect agents that are neither ancestors nor descendants of one
another. Tight membership cannot let a subordinate skip its immediate parent.
Different immediate parents do not prevent explicit peer membership. Conductors
at depth zero can also belong to the same tight Ensemble.

An Ensemble has a declared Conductor owner, a coupling value and explicit
members. Its owner may be a member. A session can belong to several Ensembles;
a shared tight membership grants a peer route. Conductor peers require equal
depth even when their membership is explicit. The operator identity is separate
from peer membership.

Roles and coupling are stored in the existing SQLite database. A session with
no role assignment is a Player. A Conductor with no parent is displayed as a
Principal Conductor; a Conductor with a parent is displayed as an Associate
Conductor. Explicit tier assignments require the matching parentage.
An operator assignment requires a session with no parent (`parent=NULL`).
That parent value alone grants no operator route.

## Configuration

After attaching or recruiting the sessions, declare their responsibilities:

```sh
baton2 state.db role root principal-conductor
baton2 state.db role lead associate-conductor
baton2 state.db role operator operator
baton2 state.db role lead
```

Create an Ensemble with loose coupling:

```sh
baton2 state.db ensemble implementation lead
baton2 state.db ensemble-member implementation lead player-a add
baton2 state.db ensemble-member implementation lead player-b add
baton2 state.db ensemble implementation
```

The two-argument declaration creates or updates a loose Ensemble. Explicitly
enable peer coordination when the task requires it:

```sh
baton2 state.db ensemble implementation lead tight
baton2 state.db message review-request player-a player-b question 'Review the shared interface.'
```

Change coupling or remove membership for subsequent messages:

```sh
baton2 state.db ensemble implementation lead loose
baton2 state.db ensemble-member implementation lead player-b remove
```

The Ensemble ID retains its owner. Membership names registered agents; operator
identities remain outside these peer groups. `role SESSION` and `ensemble ID`
read the current declarations.

Sections group capability-specific members of an Ensemble. Section membership
uses its Ensemble owner and existing member records. Public peer routes use
explicit tight Ensemble membership; knowledge visibility uses session scopes.
See [terminology](terminology.md) for Section and Orchestra controls.

## Reports and retained input

`ask`, `ask-file` and `report` address the sender's recorded immediate parent.
Native questions and completion reports use that same parent relationship.
Recovery, stop results and knowledge notices retain their existing internal
constructors. Recovery input and destination-owner promotion notices can be
self-addressed internal events. Choosing their message kind on the public
`message` command does not grant a self-addressed route.

An exact retry of an accepted message ID returns its retained result. The ID,
sender, recipient, kind and body must all match. Previously accepted messages
remain pending and deliverable after a role, coupling or membership change.
The policy change governs new admission. Receipts and message bodies remain
retained.

A refused new route stores no message and invokes no recipient endpoint. The
refusal names its sender and recipient and directs the caller to inspect roles
and membership or send through its immediate Conductor.

## Native delivery

A pending committed message to a non-stopped recipient invokes its endpoint
when one is registered. Reports and questions for a stopped recipient record
a handoff to its parent when it has one; unavailable parent delivery returns
a refusal. Already receipted messages require no further delivery. Active
retained receive leaves unaccepted input pending; after native exit it checks
for input to start the next turn. Pending input remains in the inbox until
acceptance is recorded.

The OMP Player turn path accepts guidance during a native turn at response,
completed-message and tool-event boundaries. Guidance during a silent operation
waits for the next such event. Codex, OMP, Muse and Claude Code retained receive can start the next
turn from pending input. An interactive Claude Conductor's delivery uses Channels. The
[architecture](architecture.md)
describes their protocol and recovery boundaries.

Ensemble membership selects which peer messages may be sent. Messages still
address individual sessions. The Conductor sends separate messages to members
when a finding or instruction needs several recipients. Knowledge visibility
continues to follow its recorded session scopes and explicit promotions.

## Laws and trust

The coordinator entry imports laws over the actual role, membership, route,
admission and refusal functions. Native builds verify those laws. Runtime tests
exercise the public CLI, stored messages, receipts and endpoint invocation;
SQLite execution and host effects retain their external assumptions.

The local CLI accepts declared session identities. Agents share the user's
filesystem and database access. The routing contract checks those declared
identities and recorded relationships. It does not authenticate a hostile
caller who can choose another sender ID or edit the database.
