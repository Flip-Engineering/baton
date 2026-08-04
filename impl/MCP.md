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

The legacy config FACTORY MODULE path stays for advanced deployments (a `.mjs` path is treated
as a module exporting `default`/`createMcpServer()`), but the descriptor is the documented
default and the distribution story is npx-from-git (`private: true`, no registry publication).

## Read readiness

`baton_deployment_doctor` is quota-free, rebuilt per call (never open-time cached), and carries
credential posture as metadata ONLY — source kind and expiry class, never token material. It is
the route-picking prerequisite: call it before starting work.

## Orchestrate a wave

The wave-ergonomics tools are the ordinary agent workflow. Wave members are detached — the start
response returns `{waveId, members: [{role, runId}]}`; live handles never cross the transport.

- `baton_waves_start` — start a detached wave.
- `baton_waves_progress` — page member progress with cursors.
- `baton_waves_send` and `baton_waves_stop` — steer or stop ONE member by runId.
- `baton_decision_answer` — answer a pending decision.

1. **Start** — `baton_waves_start` with `{idempotencyKey, members: [{role, objective, exact,
   scope}]}`. Quota is debited PER MEMBER, not per call. Each member rides the deployment
   profile's exact-route admission; a route outside the profile refuses with the typed route code.
2. **Page progress** — `baton_waves_progress` with `{waveId, cursor}` returns members paginated
   ≤16 per page with an explicit `{cursor, nextCursor}`. Every member is a bounded projection
   (`{role, phase, progressClass, attention, knowledge}`) — never an oversized frame, and never
   a cached one: each read is rebuilt from live state.
3. **Answer decisions** — `baton_decision_answer` with `{runId, requestId, answer}`. The
   repository coordinate is enforced BEFORE the interaction read: a cross-repo requestId refuses
   `application_interaction_not_found` identically to an unknown one (no existence leak). A late
   answer returns the DISTINCT typed outcome `{result: "already_resolved", resolvedBy}` — a late
   answerer must NOT re-spawn work.
4. **Resume-steer** — `baton_waves_attach` returns the members' runIds. `baton_waves_send` /
   `baton_waves_stop` are LIVE on those runIds afterward — that IS the resume path. The attach
   response carries `harvestReplayed: true` when the wave's detached record already settled; key
   outcome accounting on `resultSha`, never `outcomes.length` (the store never double-admits).
5. **Harvest** — a host that dies mid-wave leaves its runs live and steerable via re-attach; an
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
| `run.scratchpad.elevate` | `ordinary` | `baton_run_scratchpad_elevate` | idempotent |
| `run.scratchpad.read` | `ordinary` | `baton_run_scratchpad_read` | idempotent |
| `run.start` | `ordinary` | `baton_run_start` | idempotent |
| `run.stop` | `ordinary` | `baton_run_stop` | destructive |
| `run.view` | `ordinary` | `baton_run_view` | idempotent |
| `run.member.view` | `ordinary` | `baton_run_workstreams` | idempotent |
| `run.list` | `ordinary` | `baton_runs` | idempotent |
| `scratchpad.elevate` | `kernel` | `baton_scratchpad_elevate` | idempotent |
| `scratchpad.settle` | `kernel` | `baton_scratchpad_settle` | idempotent |
| `waves.attach` | `ordinary` | `baton_waves_attach` | idempotent |
| `waves.progress` | `ordinary` | `baton_waves_progress` | idempotent |
| `waves.send` | `ordinary` | `baton_waves_send` | idempotent |
| `waves.start` | `ordinary` | `baton_waves_start` | idempotent |
| `waves.stop` | `ordinary` | `baton_waves_stop` | destructive |
| `run.member.send` | `ordinary` | `baton_workstream_notify` | idempotent |
| `run.member.stop` | `ordinary` | `baton_workstream_stop` | destructive |

<!-- END GENERATED: mcp-tool-inventory -->

## CLI

`baton` stays the human/operator thin client. MCP is the primary agent-facing surface; the CLI
surfaces the same commands for operators who prefer a terminal.
