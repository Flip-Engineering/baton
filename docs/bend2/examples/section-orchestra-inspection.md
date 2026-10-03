# Section and Orchestra inspection

This guide shows how to inspect the coordination hierarchy and how to group
capability-specific work in a Section under an Ensemble. Commands use the
public argument order `"$B2" "$DB" COMMAND ARGS`. The JSON values below come
from actual coordinator output against an isolated fixture database holding
sessions `guide-lead`, `guide-a`, and `guide-b`. That fixture is separate
from the shared run database. The shared run's `naming-validation` grouping
is configured and inspected by the Associate Conductor in response to a
separate `naming-group-request` question, and its output is recorded with
the live run.

## Inspecting Players and roles

`players` lists every registered agent session: ordinary Players and both
Conductor tiers, with routes, workspaces, pending input, and latest reports.
`player ID` reads one agent row. `role ID` reads the responsibility recorded
for one session:

```json
{"session": "guide-lead", "kind": "player", "role": "principal-conductor"}
{"session": "guide-a", "kind": "player", "role": "player"}
```

A Principal Conductor is a Conductor session with no parent. It directs the
run: it recruits Players, gives guidance, reviews reports and changes, and
coordinates landings. An Associate Conductor is a Conductor session with a
recorded parent. It runs a delegated part of the run and reports to its
parent. `role ID principal-conductor` requires a session with no parent;
`role ID associate-conductor` requires a session with a parent. A session
with no role assignment is a Player.

Explicit operator identities stand outside the Player roster. `role ID
operator` requires a session with no parent, and `session ID` reads an
operator row. `orchestra` returns one stored-state snapshot with `players`,
`operators`, and `ensembles`, where each Ensemble nests its Sections.

## Example grouping

Create an Ensemble with loose coupling. The two-argument form records the
owner and declares loose coupling:

```sh
"$B2" "$DB" ensemble guide-team guide-lead
"$B2" "$DB" ensemble-member guide-team guide-lead guide-a add
"$B2" "$DB" ensemble-member guide-team guide-lead guide-b add
```

Create a capability Section under the Ensemble owner, and add a member that
already belongs to the Ensemble:

```sh
"$B2" "$DB" section guide-team validation guide-lead 'native protocol review'
"$B2" "$DB" section-member guide-team validation guide-lead guide-a add
```

Read the Section and the Ensemble:

```json
{"ensemble": "guide-team", "id": "validation", "capability": "native protocol review", "members": ["guide-a"]}
```

```json
{"id": "guide-team", "owner": "guide-lead", "coupling": "loose", "members": ["guide-a", "guide-b"], "sections": [{"ensemble": "guide-team", "id": "validation", "capability": "native protocol review", "members": ["guide-a"]}]}
```

`orchestra` nests the same Section inside its Ensemble entry, beside the
full `players` and `operators` lists.

Sections identify capability-specific work within one Ensemble. Message
admission follows recorded parentage and explicit Ensemble coupling: a
Conductor reaches any descendant, a subordinate reaches its immediate parent,
and peer routes require shared tight Ensemble membership. Knowledge
retrieval follows recorded session scopes: a shared scope includes its
owner, the owner's immediate parent, and the owner's subtree, with
visibility through stored parent links and explicit promotions.

Removing Ensemble membership removes that member's Section memberships
within the same Ensemble. Pending messages, acceptance receipts, branches,
and workspaces remain available, and the changed coupling governs only new
admission.

The full naming contract is in [terminology](../terminology.md), the routing
and scope rules are in [messaging](../messaging.md), and the command
reference is in [bend2 README](../../../bend2/README.md).
