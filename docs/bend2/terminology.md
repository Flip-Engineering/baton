# Baton2 terminology

The coordinator records agent responsibilities, Ensemble membership and
capability-specific Sections in SQLite. These names appear in its commands,
JSON results and harness instructions. The [architecture](architecture.md)
describes session, message and Git operations.

## Names

| Name | Meaning | Runtime interface |
| --- | --- | --- |
| Principal Conductor | The main orchestrator. | `role ID principal-conductor` for a parentless agent. |
| Associate Conductor | A suborchestrator. | `role ID associate-conductor` for an agent with a parent. |
| Ensemble | A coordinated team. | `ensemble ID OWNER [loose\|tight]` and `ensemble-member`. |
| Section | A capability-specific subgroup of an Ensemble. | `section ENSEMBLE SECTION OWNER CAPABILITY` and `section-member`. |
| Player | An individual agent, including an agent with a Conductor responsibility. | `players` and `player ID`. |
| Orchestra | The whole coordinated system represented by a coordination database. | `orchestra`. |

## Players and Conductors

A Player works through a native harness session. Conductors recruit Players,
give guidance, review reports and changes, and coordinate landings. A Conductor
can also perform implementation or review work.

`role ID principal-conductor` requires a session with no parent.
`role ID associate-conductor` requires a session with a parent. The coordinator
derives the displayed Conductor tier from the recorded parentage. Existing
`conductor` assignments retain that behavior. An unassigned session has the
`player` role. `role ID operator` identifies a parentless human operator session.
The database can contain several Principal Conductors.

`players` includes ordinary Players and both Conductor tiers, with their
recorded routes, workspaces, pending input and latest reports. It excludes
explicit operator identities. `player ID` reads one agent's recorded binding;
`session ID` can also inspect an operator. Stored presence establishes a
recorded session, and `worktree ID` reads its current Git state.

A logical session ID associates messages, parentage and workspaces. A native
session ID identifies the harness conversation. Session IDs are chosen by the
caller; existing identifiers such as `root`, `lead` and `worker` remain valid.
Saved native identities, pending messages and acceptance receipts keep their
original values. The input spelling `workers` retains its previous subordinate
roster for existing callers; first-party help and tools use `players`.

## Ensembles and Sections

An Ensemble records its Conductor owner, loose or tight coupling and member
Players. New Ensembles use loose coupling. A Player can belong to several
Ensembles. [Messaging](messaging.md) defines hierarchy routes and peer routes
through explicit tight Ensemble membership.

A Section records a capability label and members within one Ensemble. Its
owner is the Ensemble's recorded owner. Section members must already belong
to that Ensemble; removing Ensemble membership removes the corresponding
Section memberships. The same Section ID can be used in different Ensembles.
For example:

```sh
baton2 state.db ensemble delivery principal
baton2 state.db ensemble-member delivery principal player-a add
baton2 state.db section delivery validation principal 'native protocol review'
baton2 state.db section-member delivery validation principal player-a add
baton2 state.db section delivery validation
```

Section membership identifies capability-specific work. Messaging admission
uses recorded parentage, Conductor responsibility and Ensemble coupling.

## Orchestra and shared knowledge

`orchestra` reads the database's Players, operators, Ensembles, Sections and
execution state and pending counts in one snapshot. Separate databases have
separate coordination state.

Worker knowledge includes the session's authored findings and findings explicitly
promoted to it. Group knowledge uses the recorded Ensemble owner's holdings.
Universal knowledge uses the Principal Conductor's holdings. `knowledge` reads
all findings for discovery; `knowledge-scope` selects these holdings. Typed items
and authored relationships connect observations, decisions, corrections and
their evidence references.

Promotion notifies the destination scope owner. That owner decides which
Ensembles, Sections or Players receive further task messages. The
[shared knowledge workflow](knowledge-context-2026-09-29.md) describes recording,
retrieval, evidence review and promotion.
