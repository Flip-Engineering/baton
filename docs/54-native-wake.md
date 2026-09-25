# 54 — Native wake: seats receive wake events, seats never fetch them (issue #529)

Design direction: 2026-09-20. Status: proposed. This document supersedes the two prior attempts
(the external harness tool wrapping `baton deployment watch --follow`, and the native
`baton deployment watch --timeout-ms` CLI verb), both rejected because they required an agent to
invoke, hold open, and re-arm a bounded wait. The operator's constraint: a wake is given to a seat
at its boundary, the way a composed brief or a durable ledger row is given. A wake is not a verb.

## 1. What already delivers information to a seat without a verb

Two mechanisms already give a seat information it did not request:

**The composed brief.** When a seat is recruited, `_composeRecruitBrief` (swarm-runtime.mjs:6675)
reads the coordination ledger's fold and builds the `## Swarm situation` section: peers, their
checkpoints and claims, contribution counts, published contracts, committed history, route usage,
and parked guidance. The seat receives this text as part of its invocation context. It reads the
world as it is at recruitment time.

**Parked guidance (#337).** When `swarm.guide` addresses a one-shot seat whose harness takes no
mid-turn delivery, the message parks as a durable `swarm.guidance_parked` row. At the seat's
next exec or `--resume-from` successor's recruitment, `_composeRecruitBrief` reads the undelivered
parks, embeds them in the `## Swarm situation` section, and marks each delivered
(`swarm.guidance_delivered`). The seat reads the guidance as part of its brief. It called no verb.

Both mechanisms share a structural property: Baton owns the seat's invocation lifecycle — it
composes the brief, spawns the harness process, and passes the text as the prompt. Anything the
coordinator writes into the brief is given to the seat at its boundary. The seat never requests it.

## 2. What wake events are

The deployment wake stream (wake-stream.mjs:120, `WAKE_CLASS_TABLE`) derives every wake row from
one coordination ledger row (or one live deployment observation) through a closed class table.
The complete set of wake classes at HEAD:

**Swarm-scoped:** `recruited`, `left`, `assigned`, `work_updated`, `coupling_updated`,
`context_updated`, `contribution_recorded`, `contribution_integrated`, `reviewed`, `note`,
`knowledge`, `closed`, `refused`, `queued`, `dead`, `reroute_proposed`,
`resume_decision_required`.

**Deployment-scoped:** `incarnation_changed`, `turn_reported`, `paused`, `attention`, `root_owed`, `guidance_delivered`,
`integrated`, `checkpoint`, `capacity_pressure`, `resident_lifecycle`.

Each class carries a `subject` (the entity it concerns), a `terminal` flag (whether the consumer
is expected to act), and a `next` field (the command that acts on a terminal wake).

Today's consumers of the wake stream are all pull or subscribe forms:

| form | surface | who initiates |
|---|---|---|
| push | `baton deployment watch --follow` | the operator, in a terminal |
| push | `GET /v1/wakes` (SSE) | the caller, by opening the connection |
| push | loopback WebSocket binding | the caller, by upgrading |
| push | MCP `baton_wakes_subscribe` | the model, by calling the tool |
| pull | `baton deployment wakes-since` | the operator, in a terminal |
| pull | MCP `baton_wakes_since` | the model, by calling the tool |

Every form requires the consumer to take an action: open a connection, call a tool, run a
command. The wake stream's data is the same in every form. What is missing is a delivery path
where the seat takes no action.

## 3. Design: brief-composed wake events for managed seats

### 3.1 The mechanism

Extend `_composeRecruitBrief` with a `## Recent wake events` block. When a seat is recruited
(including a `--resume-from` successor), the brief composition reads the wake frames derived from
the coordination ledger since a reference point and renders them into the brief's Swarm situation
section, after the existing parked-guidance block.

The reference point is:

- For a `--resume-from` successor: the predecessor's last checkpoint seq on the coordination
  ledger (the `seq` of the last `driver.recorded` row the predecessor wrote). The successor
  reads what happened AFTER the predecessor's last observation.
- For a first seat (no predecessor): the swarm's own creation seq. The seat reads every wake
  event the swarm has produced.
- Bounded by the same `brief.situation.bytes` budget that the contracts block uses (issue #489):
  newest first, each row kept whole, the remainder counted with the read that answers it named
  (`run.package.read` or `baton deployment wakes-since`).

Each rendered wake line names the class, the seq, the timestamp, the subject, and for terminal
classes the `next` command:

```
## Recent wake events (since seq 24100)
- [seq 24474 · contribution_recorded · ts 2026-09-21T00:09:58.938Z · contribution-9e387e4c]: ds-wake-lead recorded a contribution
- [seq 24200 · recruited · ts 2026-09-20T23:15:00.000Z · ds-wake-lead]: ds-wake-lead joined the swarm
```

The block renders only wake events whose scope matches the seat's swarm (swarm-scoped events
for this swarm) plus deployment-scoped events whose subject concerns this seat's run or worker.
It carries no frames for other swarms — the sibling situation block already names those seats.

### 3.2 Why this is the parked-guidance pattern

The mechanism is structural: durable ledger rows exist, the brief composition reads them, the
seat receives the result. The wake events are already on the ledger (they are the rows the
`WAKE_CLASS_TABLE` classifies). The brief composition already reads the ledger for peers,
contributions, and contracts. Adding a wake-events block extends the same derivation to name
what HAPPENED since a reference point, in addition to what the world LOOKS LIKE now.

The seat calls no verb. It receives the wake events the same way it receives parked guidance:
through the brief Baton composed for it.

### 3.3 Delivery marking

Each wake event composed into a brief is marked with a `swarm.wake_composed` row (analogous to
`swarm.guidance_delivered`) naming the seat that received it, the wake's ledger seq, and the
brief that carried it. A later successor's brief reads only events past the highest composed seq,
so a wake is delivered exactly once across the seat's lineage.

The marking is optional for the initial landing. A simpler approach reads the predecessor's last
checkpoint seq directly and derives the window from the ledger without marking individual events.
The marking becomes useful when a seat has multiple successors (a split), because each successor
needs its own delivery record.

## 4. Design: auto-subscription for MCP-connected sessions

### 4.1 The mechanism

When a swarm seat's MCP session is established (the bridge connection at
mcp-northbound.mjs:2950), the deployment auto-subscribes the session to the wake stream filtered
by the seat's swarm. The session receives `notifications/baton/wake` frames during the turn
without calling `baton_wakes_subscribe`.

The auto-subscription configuration is a property of the seat's recruitment, declared by the
deployment as part of the seat's bridge configuration:

```javascript
{
  autoWake: {
    kinds: null,        // null = all classes; or a list of class names
    swarms: [swarmId],  // the seat's own swarm
    participants: null,  // null = all participants; or a list
  }
}
```

When the bridge connection is established, the deployment reads the seat's auto-subscription
configuration and calls the existing `wakeSubscribe` path internally (the same code path
`baton_wakes_subscribe` uses, but without a tool call). The session immediately begins
receiving matching wake frames as `notifications/baton/wake`.

The seat can still call `baton_wakes_subscribe` to add narrower filters, and
`baton_wakes_unsubscribe` to remove them, including the auto-subscription. The explicit tools
remain available. The auto-subscription is the default for sessions that take no action.

### 4.2 For non-swarm MCP sessions (root sessions)

An MCP session that connects without a swarm bridge token (an operator's IDE session, a root
orchestrator's MCP connection) is auto-subscribed to the deployment-wide wake stream: all
classes, all swarms, no participant filter. The session receives every wake event the deployment
produces.

The operator can narrow this by calling `baton_wakes_unsubscribe` on the auto-subscription and
creating a more specific one. But the default is: connect, receive everything.

The auto-subscription reaches a session that is already running a turn: the frames arrive as
notifications and the session reads them while it works. An MCP notification alone starts no turn
in an idle session — see §4.3.

### 4.3 Turn-starting delivery (issue #564)

An MCP notification is read inside a running turn; an idle session stays idle until something else
starts it. Measured on 2026-09-22: a root session with the deployment MCP bridge connected
received no turn from the wake frames, and work that waited only on the root — an unreviewed
contribution no seat could review, a `needsFromOthers` item naming the root, a seat holding for
the root — sat for hours. In the same period the Codex bridge started a turn in the same class of
session with a cross-session message to `/tmp/cc-socks/<pid>.sock`.

Issue #564 adds three pieces:

- A root-addressed wake class whose frames say that an item waits on the root. The classes in §2
  read the same for every consumer, so a root subscription cannot tell "this needs you" from
  "this is a record".
- A turn-starting delivery path per harness. Each root-addressed item is delivered once, and the
  delivery is marked with a durable row in the §3.3 shape: the root session that received the
  wake, and the wake's ledger seq.
- A capability report: the doctor names, per harness, how a turn starts in one of its sessions or
  that no channel exists, and the deployment view reports a root-addressed wake that reached no
  session as attention.

## 5. The hard case: a human root without an MCP session

A human operating from a shell (no IDE, no MCP connection) has no notification channel. Baton
cannot push to them because Baton does not own their process. Three practical arrangements exist:

**Terminal feed.** `baton deployment watch --follow` in a separate terminal prints one JSON
frame per wake as it lands. The human reads it. This is not a model verb; it is a human
activity. The human decides when to look and when to act. The feed is the existing attachment
surface (#294), and it works today.

**Sub-orchestrator seat.** The human's orchestration work runs through a recruited sub-orchestrator
seat. That seat is Baton-managed and receives wake events through the brief (§3) or through MCP
auto-subscription (§4). The human reads the sub-orchestrator's state on demand
(`baton swarm view`) and directs it with `swarm.guide`. The sub-orchestrator reacts to wakes;
the human reads results. The wake delivery is genuine push to the sub-orchestrator; the human
operates at a higher level where reads-on-demand are appropriate.

**Reads-on-demand.** The human reads `baton swarm view` (the current fold) or
`baton deployment wakes-since` (the bounded page) when they want to check. This is observation,
not orchestration. A human who checks periodically is doing the thing humans do. No mechanism
is needed to "wake" them; the wake events are durable on the ledger whenever they choose to look.

### 5.1 Recommendation

The sub-orchestrator pattern is the practical answer for real orchestration. A human who needs
to react to every wake event in real time is doing continuous orchestration work, and that work
runs through a Baton-owned seat (a recruited sub-orchestrator) that receives genuine push. The
human's role is to direct and review, not to be a wake consumer. When the orchestration work is
in a Baton-owned seat, the seat receives wakes through §3 and §4, and the question of how to
wake the human dissolves: the seat is woken, and the human reads its output.

For the human who watches casually, the terminal feed and reads-on-demand are sufficient. No new
mechanism is needed.

## 6. What changes in the code

### 6.1 Brief composition (§3)

**File:** `impl/src/swarm-runtime.mjs`, `_composeRecruitBrief`.

Add a block after the parked-guidance block (line 6866) that:
1. Reads the reference seq (predecessor's last checkpoint, or swarm creation seq).
2. Calls the existing `wakeClassFor` derivation on every ledger row since that seq.
3. Filters to swarm-scoped events for this swarm plus deployment-scoped events for this seat's run.
4. Renders each matching event as a line in the `## Recent wake events` block.
5. Respects the `brief.situation.bytes` budget (newest first, remainder counted).

**File:** `impl/src/limits.mjs`.

Add a registry row for `brief.wake_events.items` — the ceiling on how many wake lines the
situation section carries. A reasonable default is the same as the contracts block's budget.

### 6.2 MCP auto-subscription (§4)

**File:** `impl/src/mcp-northbound.mjs`, bridge session initialization.

When a session's bridge connection is authenticated and the session's authority includes `observe`:
1. Read the seat's auto-subscription configuration (default: the seat's swarm, all classes).
2. Call the internal `wakeSubscribe` path with the derived filter.
3. Record the auto-subscription ID on the session so it can be released on session close.

For non-swarm sessions (root operator sessions): auto-subscribe to the deployment-wide stream.

**File:** `impl/src/swarm-runtime.mjs`, recruit path.

Add an `autoWake` field to the seat's participant row, derived from the recruiter's specification
or a deployment default. The field is read at bridge-session initialization time.

### 6.3 Existing surfaces unchanged

The explicit `baton_wakes_subscribe`, `baton_wakes_unsubscribe`, and `baton_wakes_since` tools
remain available. The `baton deployment watch --follow` CLI remains available. The
`baton swarm watch` bounded wait remains available. No existing surface is removed or changed.

## 7. Test plan

1. **Brief wake block.** A recruited seat's brief contains a `## Recent wake events` block naming
   the wake events since the base. A `--resume-from` successor's brief contains only events
   since the predecessor's last checkpoint. A successor never receives the same event the
   predecessor's brief already carried.

2. **Auto-subscription.** An MCP session connected via a swarm bridge receives
   `notifications/baton/wake` frames for its swarm immediately after connection, without calling
   `baton_wakes_subscribe`. A root MCP session receives deployment-wide frames.

3. **Existing surfaces unchanged.** The explicit subscribe/unsubscribe/since tools, the CLI feed,
   and the swarm watch bounded wait continue to work after these changes.

4. **Budget bound.** The wake-events block in the brief respects the situation byte budget. A swarm
   with many events carries the newest up to the bound and counts the remainder.

## 8. Implementation sequence

1. The brief wake-events block (§6.1): extend `_composeRecruitBrief`, add the registry row,
   write the test suite.
2. The MCP auto-subscription (§6.2): extend the bridge session initialization, add the
   participant-row field, write the test suite.
3. Documentation: update `docs/39-swarm-runtime.md` §"Waking the orchestrator" with the native
   wake mechanism.
