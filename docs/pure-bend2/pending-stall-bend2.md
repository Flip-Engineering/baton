# Pending-input candidates and wake

The coordinator derives pending-input candidates from its recorded database.
`stall` reports every candidate with its recorded state. `stall-wake` drives the
stalled candidates through the existing wake driver. Both commands classify from
recorded database state.

## Recorded state

| Field | Source |
|---|---|
| pending count | `messages` rows with `recipient = session` and `receipt IS NULL` |
| attempt | `executions.id` and `executions.phase` for the session |
| endpoint present | `sessions.endpoint`, using the coordinator's `json_valid` / `json_type` / `json_array_length` check |
| stop | a `session_stops` row for the session |
| wake claim | `wake_claims.state` for the session |

The report reads the claim table when the coordinator schema provides it. A
database without that table reports an empty claim state and classifies no
candidate as `claimed`.

The state is derived again on each invocation from the recorded attempt,
endpoint, stop and claim rows.

## Classification

| State | Recorded evidence |
|---|---|
| `active` | pending input and an attempt whose phase is not `exited` |
| `stalled` | pending input, an `exited` attempt, a present endpoint, no stop and no `claimed` wake claim |
| `blocked` | pending input, an `exited` attempt and no present endpoint |
| `stopped` | a `session_stops` row |
| `claimed` | `wake_claims.state = 'claimed'` |

The stop and claim checks take precedence. The wake command selects only
`stalled` candidates, so a stopped session keeps its explicit stop and a claimed
session remains with its claim. A pending candidate with a live attempt is
`active`.

## Report

```sh
baton2 DATABASE stall
```

The command prints `{"candidates":[...]}`. Each row contains `id`, `pending`,
`attempt` (`id` and `phase`), `endpointPresent` (0 or 1), `owedMessage`,
`stopped` (0 or 1), `claim` (the recorded state or an empty string), and
`state`.

## Wake

```sh
baton2 DATABASE stall-wake
```

The command selects candidates whose state is `stalled` and calls
`Wake.drive_id` once per candidate with its oldest owed message. `Wake.drive_id`
uses `Receive.wake_due`: it takes the session lock, re-reads the pending count,
observes the claim and host custody, and launches the message through the
delivery path. The driver receives only `stalled` candidates. Its claim and custody checks
keep a repeated invocation safe.

## Boundaries

`stall.bend` reads the coordinator database through `Sql.query`. `report` prints
the candidate array. `stall-wake` writes only through `Wake.drive_id`; all process starts go through
that route.

## Focused fixtures

`bend2/src/coordinator/stall-laws.bend` pins the query text, the row object, the
nine-field row transport, empty and malformed line handling, and the wake
address for each state.

`bend2/test/stall.py` creates five live coordinator rows and exercises both
commands:

- an active attempt with owed input renders `active` and is not driven;
- an exited attempt with owed input and a present endpoint renders `stalled`
  and is driven;
- an explicit stop renders `stopped` and remains in `session_stops`;
- an exited attempt with no endpoint renders `blocked` and is not driven;
- an exited attempt with an existing `claimed` wake claim renders `claimed` and
  is not driven.

## Verification

The three-file port at `3e42c349` passed the focused 16 GiB gate on
`385f1a41`:

| Check | Result |
|---|---|
| `--check-only bend2/src/coordinator/stall.bend` | exit 0, `All terms check` with the three foreign-code definitions named |
| `--check-only bend2/src/coordinator/stall-laws.bend` | exit 0, `All terms check` |
| cgroup | `memory.max = 17179869184`, `memory.swap.max = 0`, `rlimit_as = unlimited` |
| peak memory | 7,324,880,896 bytes; no swap |

Receipts are under
`rowsjson-current-main-20261018/run-root-20261018T051013Z` in the retained
assignment directory. The successor commit adds the two CLI commands and the
live fixtures; its focused check receipts are recorded with that run.
