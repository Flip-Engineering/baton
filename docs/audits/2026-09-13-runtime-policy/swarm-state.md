# Swarm state — implementation audit

Module: `impl/src/swarm-state.mjs`  
Tests: `impl/test/swarm-state.test.mjs`  
Author: baton native worker (claude-sonnet-4-6)  
Date: 2026-09-13  
Test result: 74/74 pass, 0 fail, 0 cancelled

## Purpose

Extracted deterministic event fold for durable Baton swarm state, compatible with
`CoordinationStore` transaction snapshots and replay. Follows the coordination-lane
pattern established in `orchestrator-plan.mjs`: a caller-owned mutable `Map` is the
projection surface; fold functions produce frozen immutable replacement rows; no
external effects occur in replay.

Root hooks `validateSwarmEvent` and `foldSwarmEvent` to the same durable coordination
log. This module owns the fold, not the log.

## Exports

### `SWARM_EVENT_KINDS: Set<string>` (frozen)

The 11 recognized event kind strings. A fold or validate call with an unknown kind
throws immediately.

### `SWARM_WORK_STATUSES: string[]` (frozen)

`['open', 'completed', 'cancelled']` — the open disposition set for work items.
Free-evolving; `null` means no disposition has been set yet.

### `SWARM_ASSIGNMENT_STATUSES: string[]` (frozen)

`['active', 'released']` — assignment lifecycle states. No session mutation implied.

### `SWARM_REVIEW_DECISIONS: string[]` (frozen)

`['accept', 'reject', 'comment']` — append-only review observations on a contribution.

### `SwarmRefusal extends Error`

Thrown by `validateSwarmEvent` and `readSwarm` for caller-correctable shape errors.
Fields: `message`, `code: string`, `detail: object | null`.

### `SwarmIntegrityError extends Error`

Thrown by `foldSwarmEvent` when an event cannot be applied to the current state — a
bad log event, referential integrity failure, duplicate creation, or version conflict.
Fields: `message`, `code: string`.

### `validateSwarmEvent(kind, payload): void`

Shape-only validation before committing an event to the durable log. No state access.
Throws `SwarmRefusal` on invalid input. All 11 event kinds are validated.

Called by the write lane before appending. The fold enforces referential integrity
at replay time; shape validation here lets callers surface correctable errors early.

### `foldSwarmEvent(swarms: Map, event: object): void`

Applies one event to the `swarms` projection. Mutates the outer `Map` with a frozen
replacement swarm row. Throws `SwarmIntegrityError` if the event cannot be folded.

`event` shape: `{ kind, payload, actor?, seq?, ts? }`.
- `actor` is attributed to `context_updated` rows.
- `seq` is attributed to `participant_bound` bindings and `contribution_reviewed` entries.

Pure over `(swarms, event)`: the same event sequence always produces the same projection.
Two independent folds of the same log produce byte-identical `swarmSnapshot` output.

### `readSwarm(swarms: Map, id: string): SwarmState`

Returns the live swarm row. Throws `SwarmRefusal` (`code: 'swarm_not_found'`) if the
swarm does not exist.

### `swarmSnapshot(swarms: Map): { swarms: SwarmSnapshot[] }`

Deterministic serializable projection of all swarms. Swarms sorted by `swarmId`;
within each swarm all keyed collections (`participants`, `groups`, `work`, `assignments`,
`context`, `contributions`, `reviews`) are sorted by their primary key. Live and
replay snapshots deep-equal and JSON-stringify-equal.

## State shape

### Swarm row (frozen)

```
{
  swarmId: string,
  purpose: string,
  status: 'open' | 'closed',
  closedReason: string | null,
  participants: { [participantId]: ParticipantRow },
  groups:       { [groupId]:       GroupRow        },
  work:         { [workId]:        WorkRow         },
  assignments:  { [assignmentId]:  AssignmentRow   },
  context:      { [key]:           ContextRow      },
  contributions:{ [contributionId]:ContributionRow },
  reviews:      { [contributionId]:ReviewEntry[]   },
}
```

### ParticipantRow (frozen)

```
{
  participantId: string,
  role:          string | null,   // optional organizational role
  parentId:      string | null,   // optional native child relationship
  runId:         string | null,   // root-minted stable run identity (before dispatch)
  permissions:   string[] | null, // runtime-authorized delegation scope, retained as facts
  status:        'active' | 'left',
  leftReason:    string | null,
  bindings:      BindingEntry[],  // append-only history of native bindings
}
```

`status: 'active'` is organizational membership, not proof of a native process running.
A participant's identity and history are retained after `participant_left`.

### BindingEntry (frozen, appended via `swarm.participant_bound`)

```
{
  workerId:  string,
  taskId:    string,
  sessionId: string | null,
  seq:       number | null,  // event.seq for ordering
}
```

### GroupRow (frozen)

```
{
  groupId:  string,
  purpose:  string | null,
  members:  string[],  // current participantIds — must exist in swarm.participants
  version:  number,    // 1-based, bumped on every group_updated
}
```

Groups are mutable and overlapping. `expectedVersion` is the current version before
the update (0 for first creation); version conflict throws `SwarmIntegrityError`.

### WorkRow (frozen)

```
{
  workId:    string,
  objective: string,
  status:    'open' | 'completed' | 'cancelled' | null,
  version:   number,
}
```

Work evolves freely. `status: null` means no disposition set. Closure of work is
independent of participant status, assignments, or swarm closure.

### AssignmentRow (frozen)

```
{
  assignmentId:  string,
  participantId: string,
  workId:        string,
  status:        'active' | 'released',
  version:       number,
}
```

Several live assignments per participant and many participants per work are allowed.
`released` does not imply the work is done or the participant has left.

### ContextRow (frozen)

```
{
  key:     string,
  body:    string | object,  // plain text or JSON; objects are deep-frozen
  groupId: string | null,    // scoped group context (group must exist in swarm)
  version: number,
  actor:   string | null,    // event.actor attribution
  seq:     number | null,    // event.seq attribution
}
```

Shared context is available to newcomers. Group-scoped context requires the group to
exist. Version conflicts (optional `expectedVersion` CAS) throw `SwarmIntegrityError`.

### ContributionRow (frozen)

```
{
  contributionId: string,
  participantId:  string,
  workId:         string | null,
  body:           any | null,   // plain text or JSON; objects are deep-frozen
  refs:           string[] | null,
}
```

Contributions are plain findings, references, or code pins. No mandatory artifact
shape. Contribution identity is stable and does not change on review.

### ReviewEntry (frozen, appended via `swarm.contribution_reviewed`)

```
{
  reviewerId: string | null,
  decision:   'accept' | 'reject' | 'comment',
  reason:     string | null,
  seq:        number | null,
}
```

Reviews are append-only. Opposing reviews are both retained. No last-review erasure.
A contribution review does not close the contributor, work, group, or swarm.

## Event fold summary

| Event | Preconditions | Effect |
|---|---|---|
| `swarm.created` | swarmId absent | Add frozen empty swarm row |
| `swarm.participant_joined` | swarm exists; participantId absent; parentId (if given) exists | Add frozen participant row, status=active, empty bindings |
| `swarm.participant_bound` | swarm exists; participant exists | Append frozen binding to participant.bindings |
| `swarm.participant_left` | swarm exists; participant exists | Replace row with status=left, leftReason set |
| `swarm.group_updated` | swarm exists; all members in participants; expectedVersion matches if given | Create/replace group row, version++  |
| `swarm.work_updated` | swarm exists; status (if given) is a valid disposition; expectedVersion matches if given | Create/replace work row, version++ |
| `swarm.assignment_updated` | swarm exists; participant exists; work exists; expectedVersion matches if given | Create/replace assignment row, version++ |
| `swarm.context_updated` | swarm exists; body not null; groupId (if given) exists; expectedVersion matches if given | Create/replace context row, version++, attribute actor/seq |
| `swarm.contribution_recorded` | swarm exists; participant exists; workId (if given) exists; contributionId absent | Add frozen contribution row |
| `swarm.contribution_reviewed` | swarm exists; contribution exists; decision is valid | Append review entry (never replace) |
| `swarm.closed` | swarm exists; status=open | Replace row with status=closed, closedReason set |

## Design decisions

**No arbitrary caps.** No hard limits on participant count, group size, work items,
assignments, contributions, or reviews. Resource policy belongs to the deployment, not
the fold.

**Participant membership is organizational, not process-tied.** `status: 'active'`
means the participant has joined and not explicitly left. It is not proof that a native
process is running. `participant_bound` records the current native binding separately.

**`participant_left` does not cascade.** Assignments, groups, and context are not
automatically updated when a participant leaves. Explicit events handle those changes.

**`swarm.closed` is organizational closure only.** It never implies process cleanup,
assignment completion, or group disbanding. Useful work and history are retained.

**`expectedVersion` is a CAS check, not a mandatory field.** If omitted, the fold
applies the event unconditionally (version still bumps). If provided, it must equal
the current version (0 for a not-yet-created row); a mismatch throws
`SwarmIntegrityError('version_conflict')`.

**Reviews are append-only.** Every `swarm.contribution_reviewed` event appends to the
review list. There is no mechanism to remove or replace a prior review. The fold
preserves all opposing reviews.

**Referential integrity is enforced at fold time.** `validateSwarmEvent` validates
shape only (no state access). Cross-swarm references fail naturally because the fold
checks only the addressed swarm's participants, groups, and work maps.

**`context.body` and `contribution.body` accept any non-null value.** String bodies
pass through unchanged. Object bodies are deep-cloned with `JSON.parse(JSON.stringify)`
before freezing to prevent shared mutation.

**`runId` and `permissions` on participants.** Root mints a stable `runId` and records
the join event before dispatch so membership can be consulted without race. The fold
stores these as facts; it does not enforce any semantics on `permissions` values.

## Integration contract for root

Root supplies `swarms` as a `Map` to both `foldSwarmEvent` and `swarmSnapshot`. The
same `swarms` Map that `CoordinationStore` maintains for other projection lanes can be
extended to include swarm rows, or a dedicated Map can be maintained in parallel.

Root calls `validateSwarmEvent(kind, payload)` on the write path before appending to
the coordination log. Root calls `foldSwarmEvent(swarms, event)` from the store's
replay loop for every event whose kind is in `SWARM_EVENT_KINDS`. The fold is pure
over the event sequence; order is the coordination log's guarantee.

`SwarmIntegrityError` from `foldSwarmEvent` should be treated as a poisoned projection
(consistent with the plan-object lane precedent). `SwarmRefusal` from
`validateSwarmEvent` or `readSwarm` is a caller-correctable error.

## Verification

```
node --test impl/test/swarm-state.test.mjs
```

Exit 0, 74 tests, 0 failures. Test coverage includes:
- Evolving empty swarm / `readSwarm` / frozen rows
- Duplicate creation and double-close rejection
- Recruitment, regrouping, overlapping roles, overlapping group membership
- `parentId` referential integrity (same-swarm only)
- `participant_bound` binding history
- Group version conflicts
- Shared context version conflicts (CAS and free-bump paths)
- Work dispositions and version conflicts
- Several live assignments per participant; many participants per work
- Persistent reviewer in concurrent assignments
- Accepted contribution with author still active
- Opposing reviews both retained
- Deterministic replay (byte-identical snapshot)
- Sorted snapshot keys
- Invalid cross-swarm references refused
- Unknown identities refused
- No arbitrary participant/contribution caps
- Exported constants shape
- Full lifecycle `swarmSnapshot` shape
