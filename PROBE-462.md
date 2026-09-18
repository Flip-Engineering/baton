# PROBE-462 — seat environment and participants page, as observed

Probe seat `probe-462`, lane worktree `ws-3ac160a8ecae1fdb40d82a6e9779f9bc`, base `bb5640bd`
(the served commit). Two read-only observations; no source or test file was touched. Observed
2026-09-18 ~13:03–13:05 UTC.

## 1. (#462) The seat's own process environment

Command (`node` child of this seat's process; it inherits the seat environment):

```
node -e 'console.log(Object.keys(process.env).filter(k=>k.startsWith("BATON_")).sort().join("\n"))'
```

Every `BATON_`-prefixed name present — 7 total (names only; values never read or printed):

```
BATON_SWARM_BRIDGE_FRAME_BYTES=<set>
BATON_SWARM_BRIDGE_PARTICIPANT_ID=<set>
BATON_SWARM_BRIDGE_RUN_ID=<set>
BATON_SWARM_BRIDGE_SWARM_ID=<set>
BATON_SWARM_BRIDGE_TOKEN=<set>
BATON_SWARM_BRIDGE_URL=<set>
BATON_SWARM_CLIENT=<set>
```

The five handoff variables, explicitly:

```
BATON_INCARNATION=unset
BATON_PREDECESSOR_INCARNATION=unset
BATON_PREDECESSOR_PID=unset
BATON_PREDECESSOR_COMMIT=unset
BATON_REINCARNATION_TARGET=unset
```

Reading: a process this incarnation spawned carries none of the five; the seat environment
holds only the swarm-bridge plumbing names. That is the #462 landing observed from the
spawned side (the declaration is consumed by the incarnation it names and is not handed to
the processes that incarnation spawns, commit `b3486836`).

## 2. (#464) `swarm.view` participants page

```
node "$BATON_SWARM_CLIENT" swarm.view '{"projection":"participants"}'
```

exit 0; total answer byte length (raw stdout): **494693 bytes**.

- Participant rows returned: **24**
- `page`, verbatim:

```json
{"cursor":null,"next":"swarm-page:full:24","total":39,"served":24,"ceiling":{"lane":"wire.frame","class":"substrate","value":1048576,"unit":"bytes"}}
```

- Rows carrying a `workspace` object: 24.
- Rows carrying a `workspace.commits` array: **0** — no row has a `commits` key at all; the
  page publishes `commitsTotal` in its place.
- One row's `commitsTotal`: seat `omp-429`, `workspace.commitsTotal` = **1241**
  (workspaceId `ws-53bd704afdd64c00a9ba7f576db0e9ea`).
- One row's role fields: seat `omp-429` —
  `role` = `"Your full brief is a FILE in your own worktree root: .baton-brief/BRIEF.md (read it first, in full, and follow it exactly; the objective here is only this point"`
  (160 chars), `roleBytes` = **574**, `roleRef` = `{"kind":"swarm.participant_joined","seq":144283}`.

Extra measured on the same answer (not asked, recorded because it bears on the page's cost):
the 24 rows' `brief` fields sum to 421920 bytes of the 471164-byte `participants` array — the
largest per-row field on the page, ~17.6 KB per seat. `role` sums to 3888 bytes (160 chars
each), `scope` 3045, `workspace` 9744.

### `swarm.view` with no arguments

```
node "$BATON_SWARM_CLIENT" swarm.view
```

exit 0; total answer byte length (raw stdout): **368327 bytes**.

- `projection`: `"contributions"`
- `narrowed`: `{"from":"full","to":"contributions","reason":"bridge-frame"}`
- Top-level keys of the answer: `swarmId, purpose, status, closedReason, actor, seq, ts,
  baseCommit, policy, caller, availableActions, admission, actionTargets, updates,
  deployment, cursor, projection, contributions, reviews, narrowed` — no `participants` key.

Reading: the default (no projection) answer on this 39-participant swarm is the narrowed
contributions slice, and it never refused; the participants slice is served only when named,
paged at 24 of 39 rows.
