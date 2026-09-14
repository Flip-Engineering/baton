# Baton MCP — external-consumption guide (descriptor-first)

Run Baton as a standard MCP subprocess with a declarative deployment descriptor. The
descriptor is READ ONCE at open and immutable for the server's life; edits require a restart.
Parse failures name the field and the constraint, never the value.

## Connect

```sh
node impl/scripts/mcp-stdio.mjs /absolute/path/to/baton-mcp.json
```

A bounded closed JSON descriptor:

```json
{
  "repo": "/absolute/path/to/your/repository",
  "deploymentRoot": ".baton/mcp-deployment",
  "routes": [
    {
      "harness": "glm",
      "model": "glm-5.2",
      "effort": "high",
      "credential": { "kind": "file", "ref": "glm_key.json" }
    }
  ],
  "surface": "application",
  "principal": {
    "userId": "operator",
    "capabilities": ["control", "observe", "approve", "emergency_stop", "settlement"]
  },
  "quotas": {
    "wavesPerWindow": 8,
    "membersPerWindow": 64
  }
}
```

- `repo` — the repository root the deployment serves. File credential `ref`s are repo-relative
  AND containment-checked (must resolve inside the repo, no symlinks out). Env credential refs
  name environment variables (`kind: "env"`); keychain refs name items (`kind: "keychain"`).
  Secret MATERIAL is never in the descriptor, and env-sourced secret VALUES join the same
  redaction class as file-sourced ones at every projection.
- `routes` — the deployment profile's exact `{harness, model, effort}` tuples. Wave members are
  admitted ONLY against these (the deployment profile's routes and scopes).
- `surface` — `application` (the ordinary surface: runs, waves, decisions, settlement) is the
  documented default. `advanced`/`combined` are explicit kernel-control deployments.
- `principal` — the fixed host identity. `settlement` capability is NEVER defaulted: it enables
  `knowledge.settlement_lease` on this principal (single-orchestrator posture — see below).

The value every tool call passes as `repoId` is the descriptor's `repo` string, verbatim — the
server derives no other spelling, and a call naming anything else is refused. The server states
that value itself: the `initialize` greeting carries `Served repoId: <repo>` ("pass this exact
value as repoId on every tool call"), so a client learns the coordinate from the server instead of
guessing it. The wire examples below use the same placeholder as the descriptor above; substitute
your own absolute repository path. A connection that BINDS the coordinate instead (the resident
bridge) derives it per call and refuses a supplied `repoId`; its greeting states the same
`Served repoId:` value with the server-derived wording, and its tool schemas carry no `repoId`.

The legacy config FACTORY MODULE path stays for advanced deployments (a `.mjs` path is treated
as a module exporting `default`/`createMcpServer()`), but the descriptor is the documented
default and the distribution story is npx-from-git (`private: true`, no registry publication).

## Wire it into your harness

Any MCP-capable harness spawns the server as a stdio subprocess pointed at the descriptor:

**Claude Code** (`.mcp.json` in your project, or `~/.claude.json` for user scope):

```json
{
  "mcpServers": {
    "baton": {
      "command": "node",
      "args": ["/absolute/path/to/baton/impl/scripts/mcp-stdio.mjs", "/absolute/path/to/baton-mcp.json"]
    }
  }
}
```

**Kimi Code** (`~/.kimi-code/config.toml`):

```toml
[mcp_servers.baton]
command = "node"
args = ["/absolute/path/to/baton/impl/scripts/mcp-stdio.mjs", "/absolute/path/to/baton-mcp.json"]
```

**Codex / generic MCP clients**: the same stdio pair (`node <mcp-stdio.mjs> <descriptor.json>`)
under the client's server configuration idiom.

On `initialize` the server answers with the Flip greeting and the surface-orientation
instructions line, and that greeting names the served `repoId` (`Served repoId: <repo>`) — the one
value every tool call takes, stated by the server so it never has to be guessed.
`baton_deployment_doctor` is the quota-free route-picking prerequisite — call it before starting
work, passing the greeted coordinate verbatim. The descriptor's `surface: "application"` (the
documented default) serves the ordinary inventory below; `combined` adds the
board/package/REPL/knowledge families for kernel-control deployments.

## Read readiness

`baton_deployment_doctor` is quota-free, rebuilt per call (never open-time cached), and carries
credential posture as metadata ONLY — source kind and expiry class, never token material. It is
the route-picking prerequisite: call it before starting work.

## Orchestrate a wave

The wave-ergonomics tools are the ordinary agent workflow. Wave members are detached — the start
response returns `{waveId, members: [{role, runId}]}`; live handles never cross the transport.
Every wave tool takes the repository coordinate first (`repoId`).

- `baton_waves_start` — start a detached wave.
- `baton_waves_progress` — page member progress with cursors.
- `baton_waves_send` and `baton_waves_stop` — steer or stop ONE member by runId.
- `baton_waves_list` and `baton_waves_run` — page the wave list and compile a wave spec.
- `baton_decision_answer` — answer a pending decision.

1. **Start** — `baton_waves_start` debits quota PER MEMBER, not per call. Each member rides the
   deployment profile's exact-route admission; a route outside the profile refuses with the typed
   route code:

   ```json
   { "repoId": "/absolute/path/to/your/repository", "idempotencyKey": "ik-1", "members": [{ "role": "alpha", "objective": "probe" }] }
   ```

2. **Page progress** — `baton_waves_progress` returns members paginated ≤16 per page with an
   explicit `{cursor, nextCursor}`. Every member is a bounded projection
   (`{role, phase, progressClass, attention, knowledge}`) — never an oversized frame, and never
   a cached one: each read is rebuilt from live state:

   ```json
   { "repoId": "/absolute/path/to/your/repository", "waveId": "wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "cursor": "c1" }
   ```

3. **List and run** — `baton_waves_list` pages waves by cursor, and `baton_waves_run` compiles a
   wave spec against the interpreter's closed validation:

   ```json
   { "repoId": "/absolute/path/to/your/repository", "cursor": "c1" }
   ```

   ```json
   { "repoId": "/absolute/path/to/your/repository", "spec": "wave:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }
   ```

4. **Answer decisions** — `baton_decision_answer` enforces the repository coordinate BEFORE the
   interaction read: a cross-repo requestId refuses `application_interaction_not_found`
   identically to an unknown one (no existence leak). A late answer returns the DISTINCT typed
   outcome `{result: "already_resolved", resolvedBy}` — a late answerer must NOT re-spawn work:

   ```json
   { "repoId": "/absolute/path/to/your/repository", "idempotencyKey": "ik-2", "runId": "run:r1", "requestId": "req-1", "answer": { "optionId": "opt-1" } }
   ```

5. **Steer or stop** — `baton_waves_send` / `baton_waves_stop` are LIVE on the members' runIds;
   `baton_waves_attach` returns those runIds, and re-attach IS the resume path. The attach
   response carries `harvestReplayed: true` when the wave's detached record already settled; key
   outcome accounting on `resultSha`, never `outcomes.length` (the store never double-admits):

   ```json
   { "repoId": "/absolute/path/to/your/repository", "runId": "run:r1", "message": "hello" }
   ```

   ```json
   { "repoId": "/absolute/path/to/your/repository", "runId": "run:r1", "reason": "probe" }
   ```

6. **Harvest** — a host that dies mid-wave leaves its runs live and steerable via re-attach; an
   MCP host that never re-attaches leaves the wave to the drivers' own stall machinery.

## Admit knowledge

The four settlement ops work through MCP behind the S-2 `sessionAuthority` envelope.

- `baton_scratchpad_elevate` elevates terminal scratchpad entries into a board candidacy.
- `baton_scratchpad_settle` settles the shared scratchpad partition with explicit skips.
- `baton_knowledge_promote` admits one candidate Finding (the envelope is REQUIRED).
- `baton_knowledge_settlement_lease` mints the wave settlement lease (settlement capability).

- `baton_knowledge_promote` REQUIRES the envelope bound to the settlement lease — presenter
  authentication is the lease's session binding (XB), validated exactly as `admitBoardCommand`
  does. The session gate precedes any idempotent replay: a replayed admit with a foreign/expired
  session refuses with `run_orchestrator_session_mismatch`, never a replay shortcut.
- `baton_knowledge_settlement_lease` derives the session from the host's FIXED principal and is
  enabled ONLY when the descriptor's principal carries an explicit `settlement` capability class
  (never defaulted). **Trust posture:** an MCP host IS one orchestrator authority; multi-principal
  MCP hosts must NOT enable this tool.

**Where these run.** The four settlement tools are descriptor-deployment tools: they are served by
a descriptor-driven MCP server whose principal carries the `settlement` capability class. The
resident bridge (`baton serve` + `baton-mcp-web`) does NOT admit them — they are host-local kernel
operations — so a bridge-attached client never sees them in its `tools/list`, and calling one over
the bridge refuses at the dispatch guard as an unknown tool. Settlement happens on the deployment
that owns the runs, never over a borrowed bridge session.

## Tool inventory

<!-- BEGIN GENERATED: mcp-tool-inventory (impl/scripts/render-surface-docs.mjs) -->

| Operation | Profile | MCP tool | Annotation |
|---|---|---|---|
| `application.help` | `ordinary` | `baton_application_help` | idempotent |
| `run.answer` | `ordinary` | `baton_decision_answer` | idempotent |
| `deployment.doctor` | `ordinary` | `baton_deployment_doctor` | idempotent |
| `application.help` | `ordinary` | `baton_help` | idempotent |
| `knowledge.promote` | `kernel` | `baton_knowledge_promote` | idempotent |
| `knowledge.settlement_lease` | `kernel` | `baton_knowledge_settlement_lease` | idempotent |
| `run.do` | `ordinary` | `baton_run_act` | destructive |
| `run.attention.watch` | `ordinary` | `baton_run_attention_watch` | idempotent |
| `run.do` | `ordinary` | `baton_run_do` | destructive |
| `run.view` | `ordinary` | `baton_run_episode` | idempotent |
| `run.view` | `ordinary` | `baton_run_inspect` | idempotent |
| `run.knowledge.seed` | `ordinary` | `baton_run_knowledge_seed` | idempotent |
| `run.member.send` | `ordinary` | `baton_run_member_send` | idempotent |
| `run.member.stop` | `ordinary` | `baton_run_member_stop` | destructive |
| `run.member.view` | `ordinary` | `baton_run_member_view` | idempotent |
| `run.message.receipt` | `ordinary` | `baton_run_message_receipt` | idempotent |
| `run.message.send` | `ordinary` | `baton_run_message_send` | effectful |
| `run.scratchpad.append` | `ordinary` | `baton_run_scratchpad_append` | idempotent |
| `run.scratchpad.elevate` | `ordinary` | `baton_run_scratchpad_elevate` | idempotent |
| `run.scratchpad.read` | `ordinary` | `baton_run_scratchpad_read` | idempotent |
| `run.start` | `ordinary` | `baton_run_start` | idempotent |
| `run.stop` | `ordinary` | `baton_run_stop` | destructive |
| `run.view` | `ordinary` | `baton_run_view` | idempotent |
| `run.member.view` | `ordinary` | `baton_run_workstreams` | idempotent |
| `run.list` | `ordinary` | `baton_runs` | idempotent |
| `scratchpad.elevate` | `kernel` | `baton_scratchpad_elevate` | idempotent |
| `scratchpad.settle` | `kernel` | `baton_scratchpad_settle` | idempotent |
| `swarm.capture` | `ordinary` | `baton_swarm_capture` | idempotent |
| `swarm.check` | `ordinary` | `baton_swarm_check` | idempotent |
| `swarm.create` | `ordinary` | `baton_swarm_create` | idempotent |
| `swarm.guide` | `ordinary` | `baton_swarm_guide` | idempotent |
| `swarm.list` | `ordinary` | `baton_swarm_list` | idempotent |
| `swarm.recruit` | `ordinary` | `baton_swarm_recruit` | idempotent |
| `swarm.stop` | `ordinary` | `baton_swarm_stop` | destructive |
| `swarm.update` | `ordinary` | `baton_swarm_update` | idempotent |
| `swarm.view` | `ordinary` | `baton_swarm_view` | idempotent |
| `swarm.watch` | `ordinary` | `baton_swarm_watch` | idempotent |
| `waves.attach` | `ordinary` | `baton_waves_attach` | idempotent |
| `waves.compile` | `ordinary` | `baton_waves_compile` | idempotent |
| `waves.list` | `ordinary` | `baton_waves_list` | idempotent |
| `waves.progress` | `ordinary` | `baton_waves_progress` | idempotent |
| `waves.run` | `ordinary` | `baton_waves_run` | idempotent |
| `waves.send` | `ordinary` | `baton_waves_send` | idempotent |
| `waves.start` | `ordinary` | `baton_waves_start` | idempotent |
| `waves.stop` | `ordinary` | `baton_waves_stop` | destructive |
| `run.member.send` | `ordinary` | `baton_workstream_notify` | idempotent |
| `run.member.stop` | `ordinary` | `baton_workstream_stop` | destructive |

<!-- END GENERATED: mcp-tool-inventory -->

## Unified surface tools

Six `baton_surface_*` meta tools ship beside the direct inventory on every production-wrapped
deployment (`application`, `advanced`, and `combined`). They project the unified capability
catalog — Baton's control, observation, telemetry, communication, task-management, knowledge,
diagnostics/environment, and notification authorities — over one envelope that carries
`retryable` and `action` fields in its refusals:

- `baton_surface_catalog` — the capabilities available to THIS deployment profile.
- `baton_surface_describe` — one capability: its live schema and posture.
- `baton_surface_invoke` — invoke a capability by name, routed through the authority it already has.
- `baton_surface_snapshot` — one composed read: card, readiness, workers, telemetry.
- `baton_surface_watch` — the composed notification loop (run follow + attention watch + decisions).
- `baton_surface_visualize` — a bounded visual model (overview/topology/timeline/telemetry).

They are additive: the direct tools stay the primary surface. What a deployment can reach is
decided by its profile — the catalog names it, and `baton_surface_invoke` routes each capability
to the authority that carries it or refuses with the profile-restricted code. Kernel-control
(`fleet_*`) tools are advertised on `advanced`/`combined` surfaces only: an ordinary surface's
`tools/list` never carries a tool its own dispatch guard would refuse, and the meta tools are
where a non-kernel profile reaches a kernel capability when its principal holds the capability
class for it.

## Declare coupling in a swarm

The `baton_swarm_update` tool carries every domain update, including the declared coupling
records (docs/39 §Declared coupling). Coupling is a record the swarm keeps honest — it informs
the `baton_swarm_view` result, the attention rows, and the `baton_swarm_watch` wake; nothing
stops a worker. Payload examples (each with a caller `idempotencyKey`):

```jsonc
// A dependency between units of work (swarm.work_updated): W2 waits for W1's accepted
// contribution — or for an accepted contribution referencing a named artifact
{"event": "swarm.work_updated", "payload": {"workId": "work-integration", "objective": "Integrate W1", "status": "open", "dependsOn": [{"workId": "work-discovery"}]}}
{"event": "swarm.work_updated", "payload": {"workId": "work-integration", "objective": "Integrate W1", "dependsOn": [{"artifact": "artifact:iface"}]}}

// A synchronization point: the group arrives at it and is released from it
{"event": "swarm.coupling_updated", "payload": {"couplingId": "sync-freeze", "coupling": "synchronization", "action": "declare", "groupId": "impl", "name": "interface-freeze"}}
{"event": "swarm.coupling_updated", "payload": {"couplingId": "sync-freeze", "coupling": "synchronization", "action": "arrive"}}            // you arrive; participantId defaults to you
{"event": "swarm.coupling_updated", "payload": {"couplingId": "sync-freeze", "coupling": "synchronization", "action": "release", "reason": "interface frozen"}}

// An exclusive writer over a shared checkout; release ends the window
{"event": "swarm.coupling_updated", "payload": {"couplingId": "writer-impl", "coupling": "writer", "action": "declare", "participantId": "builder-a"}}
{"event": "swarm.coupling_updated", "payload": {"couplingId": "writer-impl", "coupling": "writer", "action": "release", "reason": "turn done"}}

// A group failure policy: independent peers continue when a member is gone, dependents are told
{"event": "swarm.coupling_updated", "payload": {"couplingId": "policy-impl", "coupling": "failure", "action": "declare", "groupId": "impl", "policy": "independent"}}
```

`baton_swarm_view` shows each work item's `waitsOn` (`{workId|artifact, settled, evidence}`),
the `couplings` records (`arrivals` as `{participantId, actor, seq, ts}` rows, `awaiting`,
`departed`, `arrived`, `released`, `releasedBy` — the ACTOR that released, never the named seat), and
attention rows naming what needs an act: `group_member_gone` (with the `dependentWork` told),
`coupling_writer_gone` (naming the release), and `member_left_session_live` — which names the
responsible party for a departed member's still-running session (the recruiter, then the
creator) and the reclaiming operation (`baton_swarm_stop`).

## Guidance, checkout custody, and refusals

`baton_swarm_view` projects what each participant was told and where it works, and every projected
row carries the `seq` and `ts` of the coordination event that wrote it. A participant row shows the
guidance addressed to it and its live checkout custody:

```json
{
  "participantId": "builder-a",
  "seq": 41, "ts": "2026-09-14T05:41:02.113Z",
  "workspaceId": "ws-6f1c2a9e0d4b4c7f8a1e2b3c4d5e6f70",
  "guidance": [
    { "seq": 39, "ts": "2026-09-14T05:40:58.002Z", "from": "orchestrator", "messageId": "message:9b2f1c" }
  ],
  "workspace": { "physicalOwnerId": "ws-6f1c2a9e0d4b4c7f8a1e2b3c4d5e6f70", "shared": true, "holderCount": 2 }
}
```

`baton_swarm_guide` returns the lane receipt row it wrote — `guide: { seq, ts, messageId }` — so the
sender can watch for the participant's next turn instead of guessing the message landed.

A refused mutation is durable: the runtime records a `swarm.operation_refused` driver row naming the
command, the update event, the refusal code, the offending field when the refusal named one, and the
participant it concerns. Swarm state never folds it, and `baton_swarm_watch` wakes on it with
`"event": { "kind": "driver.recorded", "payloadKind": "swarm.operation_refused" }`. A refused read
records nothing.

```json
{ "kind": "swarm.operation_refused", "swarmId": "swarm-40e643e96fd1edcd", "command": "swarm.update",
  "event": "swarm.work_updated", "code": "work_not_found", "field": null, "participantId": "builder-a" }
```


## CLI

`baton` stays the human/operator thin client. MCP is the primary agent-facing surface; the CLI
surfaces the same commands for operators who prefer a terminal.
