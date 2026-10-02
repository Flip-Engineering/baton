# Baton terminology

These names describe coordination responsibilities and task organization in
Baton. Task briefs and shared context assign the responsibilities and describe
the groups. The [current architecture](architecture.md) describes their existing
session, message and Git operations.

## Naming legend

| Name | Meaning |
| --- | --- |
| Principal Conductor | The main orchestrator. |
| Associate Conductor | A suborchestrator. |
| Ensemble | A coordinated team. |
| Section | A capability-specific subgroup. |
| Player | An individual agent. |
| Orchestra | The whole coordinated system. |

## Coordination responsibilities

A Player works through a native harness session. A Principal Conductor is the
Player responsible for coordinating the overall work under the operator's
direction. An Associate Conductor is a Player responsible for coordinating
delegated work. Conductors recruit Players, give guidance, review reports and
changes, and coordinate landings. A Player may perform implementation or review
work while also carrying a Conductor responsibility.

Conductor responsibilities are assigned in the task brief or shared context.
The session's `parent` field records message routing and parentage. A Principal
Conductor's session can have `parent=null`. A human operator session can also
have `parent=null`; it remains an operator identity. Read the assigned agent
responsibility to identify a Conductor.

Existing documentation and commands use these labels:

| Existing label | Role mapping |
| --- | --- |
| `root`, when assigned to the main agent orchestrator | Principal Conductor. |
| `lead`, when assigned to an agent coordinating delegated work | Associate Conductor. |
| `worker`, when assigned to an individual agent | Player, which may also carry a Conductor responsibility. |

These labels remain valid command arguments and example session IDs. A logical
session ID associates messages, parentage and workspaces. A native session ID
identifies the harness conversation. Role names are descriptions carried in
briefs and shared context; runtime records retain their existing identifiers.

## Groups and shared context

An Ensemble brief states its purpose, member Players and coordination owner.
A Section identifies an Ensemble's capability-specific subgroup, such as
implementation, validation or documentation. The Orchestra comprises the
coordinated system's Conductors, Players, Ensembles and Sections. Group
descriptions use the existing sessions and parent links to identify the agents
and their coordination responsibilities.

A declared knowledge scope ID is an existing logical session ID, and that
session owns the scope. An Ensemble brief can name its coordinating Player's
session as its shared scope. Knowledge visibility follows the stored parent
links and explicit promotions: a shared scope includes its owner, the owner's
immediate parent and the owner's subtree. Section membership is described in
the brief; knowledge visibility continues to follow those session relationships.

The destination scope owner reviews evidence, promotes a finding and chooses
which Ensemble or Section members receive further task messages. The
[shared knowledge workflow](knowledge-context-2026-09-29.md) describes recording,
retrieval, promotion and owner notification.
