# Baton application CLI

`baton` is the normal shell surface for the shared Run application. It does not expose worker
kernel choreography.

## Verb inventory

The ordinary CLI principal inventory is the generated table below — produced from the executable
per-profile inventory (parser + web-client whitelist + host-local ops), never a hand list.
Call `baton help` / `baton help run` for live topic text. Orchestration waves stay embedding-only
(`openBaton` → `baton.waves`); the worker scratchpad is embedding/projection-only, never a CLI verb.

### Canonical operation inventory (generated from the ordinary CLI principal)

The rows below are rendered by `impl/scripts/render-surface-docs.mjs` from the executable
ordinary-CLI inventory. The conformance suite fails if they drift from served truth.

<!-- BEGIN GENERATED: cli-verb-inventory (impl/scripts/render-surface-docs.mjs) -->

| Operation | Profile | CLI verb | Example |
|---|---|---|---|
| `application.help` | `ordinary` | `baton help` | `baton help` |
| `evidence.search` | `ordinary` | `baton evidence search` | `baton evidence search SWARM_ID --query TEXT` |
| `run.answer` | `ordinary` | `baton run answer` | `baton run answer RUN_ID REQUEST_ID --text TEXT` |
| `run.approve` | `ordinary` | `baton run approve` | `baton run approve RUN_ID --plan DIGEST` |
| `run.attention.watch` | `ordinary` | `baton run attention watch` | `baton run attention watch RUN_ID --kind member_terminal --cursor 0` |
| `run.board.post` | `ordinary` | `baton run board post` | `baton run board post RUN_ID --board BOARD --title TEXT` |
| `run.board.read` | `ordinary` | `baton run board read` | `baton run board read RUN_ID --board BOARD` |
| `run.debug` | `ordinary` | `baton run debug` | `baton run debug RUN_ID` |
| `run.do` | `ordinary` | `baton run do` | `baton run do RUN_ID ACTION_ID` |
| `run.evidence` | `ordinary` | `baton run evidence` | `baton run evidence RUN_ID` |
| `run.knowledge.seed` | `ordinary` | `baton run knowledge seed` | `baton run knowledge seed RUN_ID --type Finding --grounding observed --body TEXT` |
| `run.list` | `ordinary` | `baton run list` | `baton run list` |
| `run.member.send` | `ordinary` | `baton run member send` | `baton run member send RUN_ID ROLE TEXT` |
| `run.member.stop` | `ordinary` | `baton run member stop` | `baton run member stop RUN_ID ROLE` |
| `run.member.view` | `ordinary` | `baton run member view` | `baton run member view RUN_ID` |
| `run.message.receipt` | `ordinary` | `baton run message receipt` | `baton run message receipt MESSAGE_ID` |
| `run.message.send` | `ordinary` | `baton run message send` | `baton run message send RUN_ID --kind inform --body TEXT` |
| `run.recover` | `ordinary` | `baton run recover` | `baton run recover RUN_ID` |
| `run.resume` | `ordinary` | `baton run resume` | `baton run resume RUN_ID --reason R` |
| `run.retry` | `ordinary` | `baton run retry` | `baton run retry RUN_ID --reason R` |
| `run.review` | `ordinary` | `baton run review` | `baton run review RUN_ID --exact codex/gpt-5.6-sol@low --reason R` |
| `run.scratchpad.elevate` | `ordinary` | `baton run scratchpad elevate` | `baton run scratchpad elevate RUN_ID --task TASK_ID --entries JSON` |
| `run.scratchpad.read` | `ordinary` | `baton run scratchpad read` | `baton run scratchpad read RUN_ID --scope shared --cursor 0` |
| `run.send` | `ordinary` | `baton run send` | `baton run send RUN_ID TEXT` |
| `run.start` | `ordinary` | `baton run` | `baton run "Ship it" --model gpt-5.6-sol --effort low` |
| `run.stop` | `ordinary` | `baton run stop` | `baton run stop RUN_ID` |
| `run.view` | `ordinary` | `baton run view` | `baton run view RUN_ID` |
| `run.watch` | `ordinary` | `baton run watch` | `baton run watch RUN_ID` |
| `swarm.capture` | `ordinary` | `baton swarm capture` | `baton swarm capture SWARM_ID reviewer CONTRIBUTION_ID` |
| `swarm.check` | `ordinary` | `baton swarm check` | `baton swarm check SWARM_ID reviewer CONTRIBUTION_ID CHECK_ID` |
| `swarm.create` | `ordinary` | `baton swarm create` | `baton swarm create "Ship the release"` |
| `swarm.guide` | `ordinary` | `baton swarm guide` | `baton swarm guide SWARM_ID reviewer "Focus on the tests"` |
| `swarm.list` | `ordinary` | `baton swarm list` | `baton swarm list` |
| `swarm.recruit` | `ordinary` | `baton swarm recruit` | `baton swarm recruit SWARM_ID reviewer "Review the change"` |
| `swarm.stop` | `ordinary` | `baton swarm stop` | `baton swarm stop SWARM_ID reviewer "Work complete"` |
| `swarm.update` | `ordinary` | `baton swarm update` | `baton swarm update SWARM_ID swarm.contribution_recorded --payload "finding"` |
| `swarm.view` | `ordinary` | `baton swarm view` | `baton swarm view SWARM_ID` |
| `swarm.watch` | `ordinary` | `baton swarm watch` | `baton swarm watch SWARM_ID` |
| `waves.attach` | `ordinary` | `baton waves attach` | `baton waves attach WAVE_ID --members JSON` |
| `waves.compile` | `ordinary` | `baton waves compile` | `baton waves compile path/to/spec.dsl` |
| `waves.list` | `ordinary` | `baton waves list` | `baton waves list` |
| `waves.progress` | `ordinary` | `baton waves progress` | `baton waves progress WAVE_ID --cursor 0` |
| `waves.run` | `ordinary` | `baton waves run` | `baton waves run path/to/spec.json` |
| `waves.send` | `ordinary` | `baton waves send` | `baton waves send RUN_ID --message TEXT` |
| `waves.start` | `ordinary` | `baton waves start` | `baton waves start --members JSON` |
| `waves.stop` | `ordinary` | `baton waves stop` | `baton waves stop RUN_ID --reason TEXT` |

<!-- END GENERATED: cli-verb-inventory -->


## Top-level verbs

Every verb `baton` serves at its first token, rendered by `impl/scripts/render-surface-docs.mjs` from
the parser's own `CLI_TOP_LEVEL_VERBS` table — the same rows `baton --help` teaches and the
unknown-verb refusal names, so the three can never disagree about the verb set again.

<!-- BEGIN GENERATED: cli-top-level-verbs (impl/scripts/render-surface-docs.mjs) -->

| Top-level verb | Parser argv | Serves |
|---|---|---|
| `baton doctor` | `doctor` | Read-only connection diagnosis from local files; `--check` also verifies the resident authority. |
| `baton serve` | `serve` | Host the resident for this checkout: serve authenticated HTTP over an owner-only socket, self-check, and publish the connection. |
| `baton setup` | `setup` | Install an explicit-network connection profile (schema-v1 HTTPS deployments). |
| `baton route HARNESS/MODEL@EFFORT` | `route mock/model-a@low` | Resolve one exact route tuple against the served registry. |
| `baton credentials install kimi` | `credentials install kimi` | Install the Kimi provider credential interactively; credentials are never CLI arguments. |
| `baton top` | `top` | The operator seat: a live human view over runs and swarms (docs/38). |
| `baton run` | `run view RUN_ID` | Start a Run from an objective, or observe, steer, review, adopt and export one (`baton help run`). |
| `baton review OBJECTIVE` | `review objective --exact mock/model-a@low --exact mock/model-b@low` | The objective-first read-only preset: one reviewer/challenger Workflow on two exact routes. |
| `baton explore OBJECTIVE` | `explore objective` | The single-route read-only evidence preset. |
| `baton swarm` | `swarm list` | Create, staff, guide and read living swarms (`baton help swarm`). |
| `baton evidence search` | `evidence search` | Search the deployment’s evidence and contributions by swarm, participant, kind, path or free text. |
| `baton deployment watch` | `deployment watch --follow` | Attach to the deployment wake stream and print one JSON frame per coordination row. |
| `baton waves` | `waves list` | Run, compile, start, stop and inspect workflow waves. |
| `baton runs list` | `runs list` | List the Runs this authenticated connection may observe. |
| `baton help [TOPIC]` | `help` | Render one help topic; `baton --help` is the application overview. |
| `baton application help [TOPIC]` | `application help` | The application help verb, spelled under its own noun. |
| `baton surface` | `surface` | List, describe and invoke the unified capability surface (`baton surface --help`). |

<!-- END GENERATED: cli-top-level-verbs -->

## Drive a living swarm

`baton swarm` recruits participants, publishes findings, and lets agents DECLARE the coupling
between them. Coupling is a record the swarm keeps honest — it informs the view, the attention
rows, and the `swarm watch --follow` wake feed; nothing stops a worker.

```sh
# Declare a dependency between units of work: W2 waits for W1's accepted contribution
baton swarm update SWARM_ID swarm.work_updated \
  --payload '{"workId":"work-integration","objective":"Integrate W1","status":"open","dependsOn":[{"workId":"work-discovery"}]}'

# ...or wait for an accepted contribution that references a named artifact
baton swarm update SWARM_ID swarm.work_updated \
  --payload '{"workId":"work-integration","objective":"Integrate W1","dependsOn":[{"artifact":"artifact:iface"}]}'

# Declare a synchronization point on a group; members arrive; the lead releases it
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"sync-freeze","coupling":"synchronization","action":"declare","groupId":"impl","name":"interface-freeze"}'
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"sync-freeze","coupling":"synchronization","action":"arrive"}'
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"sync-freeze","coupling":"synchronization","action":"release","reason":"interface frozen"}'

# Claim the shared checkout for one exclusive writer; release ends the window
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"writer-impl","coupling":"writer","action":"declare","participantId":"builder-a"}'
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"writer-impl","coupling":"writer","action":"release","reason":"turn done"}'

# Declare the group failure policy: independent peers continue, dependents are told
baton swarm update SWARM_ID swarm.coupling_updated \
  --payload '{"couplingId":"policy-impl","coupling":"failure","action":"declare","groupId":"impl","policy":"independent"}'

# Read the declared truth: waitsOn per work item, couplings with arrivals/awaiting, attention
baton swarm view SWARM_ID
baton swarm watch SWARM_ID --follow

# ...or bounded: wait for one wake class (or the deadline) and print the view that woke it
baton swarm watch SWARM_ID --timeout-ms 30000 --wake-class closed
```

Refusals name what is missing: a dependency on unknown work (`work_not_found`), a ring of waits
(`work_dependency_cycle`, naming the ring), a second writer over one checkout
(`swarm_writer_conflict`, naming the current writer), a writer claim over a participant with no
recorded checkout (`swarm_writer_workspace_unrecorded` — a claim that names no resource cannot
enforce exclusivity), an arrival by a non-member (`swarm_not_a_member`). Arrivals are rows —
`{participantId, actor, seq, ts}` — so "who arrived, and when" is answered by the view; a release
records the ACTOR as `releasedBy` (the member that released, or the acting orchestrator's
principal label), never the seat the request happened to name. When a member leaves with its
session still running, the view's `member_left_session_live` attention row names the responsible
party (the recruiter, then the creator) and the reclaiming operation
(`swarm stop SWARM_ID PARTICIPANT_ID`).

### Guidance, checkout custody, and refusals

`baton swarm view` projects what each participant was told and where it works, and every projected
row carries the `seq` and `ts` of the coordination event that wrote it. `--projection` names the
slice to answer with — `full` (the default, the whole record), `outline` (the frame alone),
`participants`, `contributions`, `attention`, `guidance` or `workspace` — and `baton swarm watch`
takes the same flag, so a caller reads the part it needs instead of the whole record. `updates`
sits beside `availableActions` and lists each update kind this caller may send NOW with the
permission that admits it; the payload shapes ride `full` only (and `baton swarm update --help`).
A participant row shows the guidance addressed to it, its live checkout custody, the `route`
(`{harness, model, effort}`) and `scope` it was recruited under, and `lastRefusal` while a refusal
of its own stands uncleared:

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

`baton swarm guide` returns the lane receipt row it wrote — `guide: { seq, ts, messageId }` — so the
sender can watch for the participant's next turn instead of guessing the message landed.

A refused mutation is durable: the runtime records a `swarm.operation_refused` driver row naming the
command, the update event, the refusal code, the offending field when the refusal named one, and the
RULE that refused it — and, for the refusals the native bridge raises before dispatch, the same row
with the participant the token names. Swarm state never folds it, and `baton swarm watch` wakes on
it with `"event": { "kind": "driver.recorded", "payloadKind": "swarm.operation_refused" }`. A
refused read records nothing. The participant's own row carries the refusal as
`lastRefusal: { seq, command, code, field }` until a later operation of the same command succeeds.

```json
{ "kind": "swarm.operation_refused", "swarmId": "swarm-40e643e96fd1edcd", "command": "swarm.update",
  "event": "swarm.work_updated", "code": "work_not_found", "field": null, "rule": null, "participantId": "builder-a" }
```

### Waiting on one check

`baton swarm check SWARM_ID PARTICIPANT_ID CONTRIBUTION_ID CHECK_ID --follow` admits the check and
then observes the swarm's own feed until THIS check's verdict row appears, printing it:

```json
{
  "schemaVersion": 1,
  "swarmId": "swarm-40e643e96fd1edcd",
  "participantId": "reviewer-a",
  "contributionId": "contribution:9f21",
  "checkId": "check:api-surface",
  "verdict": {
    "reviewerId": "reviewer-a", "decision": "comment",
    "reason": "Check check:api-surface: passed for 4b8f1c…; cleanup released.",
    "actor": "web:reviewer-a:session", "seq": 214, "ts": "2026-09-14T06:02:11.004Z"
  },
  "check": { "passed": true, "sha": "4b8f1c…", "attempt": { "cleanup": { "state": "released" } } }
}
```

The verdict is the durable `reviews[CONTRIBUTION_ID]` row whose reason names the check, so it is
read back exactly as the resident wrote it (the `check` receipt beside it is the runtime's own
return value). A check whose verification outlives the CLI's own request bound is therefore still
observed instead of lost: the client answers `cli_command_pending` with the operation key and this
same observation route, never a network fault. When the swarm is closed and nothing in it is alive,
the follow ends with `"verdict": null` rather than waiting for an event that can no longer come.


### Host verb inventory (generated from the parser)

The host verbs below are the CLI verbs no application command on the wire card carries — doctor,
serve, setup, route, credentials, top. The block is rendered by `impl/scripts/render-surface-docs.mjs`
from the parser's own host-verb table, and the conformance suite fails if it drifts from served
truth. Each row is resolved live by `parseBatonCli` in `impl/test/host-verb-inventory.test.mjs`.

<!-- BEGIN GENERATED: cli-host-verb-inventory (impl/scripts/render-surface-docs.mjs) -->

| Host verb | Parser argv | Serves |
|---|---|---|
| `baton doctor` | `doctor` | Read-only connection diagnosis from local files; `--check` also verifies the resident authority. |
| `baton serve` | `serve` | Host the resident for this checkout: serve authenticated HTTP over an owner-only socket, self-check, and publish the connection. |
| `baton setup` | `setup` | Install an explicit-network connection profile (schema-v1 HTTPS deployments). |
| `baton route HARNESS/MODEL@EFFORT` | `route mock/model-a@low` | Resolve one exact route tuple against the served registry. |
| `baton credentials install kimi` | `credentials install kimi` | Install the Kimi provider credential interactively; credentials are never CLI arguments. |
| `baton top` | `top` | The operator seat: a live human view over runs and swarms (docs/38). |

<!-- END GENERATED: cli-host-verb-inventory -->

## Connect to a resident authenticated Web host
For ordinary local use, start Baton from the repository:

```sh
baton serve
```

This creates one stable deployment identity and fresh resident incarnation, serves authenticated
HTTP over an owner-only Unix-domain socket, self-checks readiness/card/session authority, and only
then publishes the Git-common selector plus owner-private profile/token. No URL, origin, socket,
token, timeout, capacity, or budget is an ordinary argument. `connectBaton({repo})`, the CLI, and
other orchestrators discover that authority automatically.

`SIGINT`/`SIGTERM` (and `SIGHUP`) start a drain, and the drain narrates itself — one line each,
in order, on stderr:

```
baton serve: signal received; draining 2 participants (SIGTERM)
baton serve: web admission closed (closed); draining the fleet
baton serve: drain converged; 2 of 2 participant(s) stopped
```

The receipt line is the FIRST line of a drain and names the participants this process owns
(`runs.list` `resources.ownedCount`, the coordinator's own local-resource ownership projection —
the exact target set the fleet drain stops); `signal received; nothing to drain` when it owns
none, and `… (count unavailable: <code>)` when that read itself refuses, never a fabricated
count. A drain that outlives `webDrainMs` (the Web-leg grace this host declares) also says so, so
a long drain is visibly alive instead of silent.

The DRAIN's own deadline governs, and it is the coordinator's `drainPolicy.timeoutMs` — the
existing derivation (90 s at the zero-assembly deployment seam, configurable through
`createDriver({drainPolicy})`), never a second host constant. At that deadline the host names
what it was still waiting on *before* it stops waiting — the drain's own
`detail.waitingOn` / `detail.reason`:

```
baton serve: drain did not converge; waiting on w-1 (local_resources:worktree+process:running), reason deadline, deadline 90000ms
baton serve: exit non-zero; application_host_shutdown_failed — drain did not converge: waiting on w-1 (…)
```

Exit status is 0 exactly when the drain converged, non-zero (with that named wait) when it did
not; an idle host exits as soon as the drain converges, without waiting out any deadline. On
every exit path — converged or not — the publication is withdrawn BEFORE the leases are asserted:
the selector, the private profile and token, and the socket are removed even when the drain did
not converge or the lease was disturbed, so no published coordinate ever points at an exiting (or
exited) process. A disturbed lease is still reported, as `application_host_lease_lost`, after the
withdrawal.

### `baton doctor` refusals for a resident

`baton doctor` reads only local files — selector, private profile, the published owner fields
(`ownerPid`/`ownerPidStart`), the socket's mode — and never opens the token. It therefore names
the resident's actual state instead of leaving it to a connect attempt:

| Diagnosis | When | Remedy it names |
|---|---|---|
| `cli_resident_gone` | the process that published this connection is no longer running (or its pid was reused) — including a `SIGKILL` that left the socket file behind | `baton serve` |
| `cli_resident_unresponsive` | the publishing process IS alive but the socket is not there (or is unsafe): it has not finished publishing | `baton doctor` (wait for it), `baton setup` for an unsafe socket |
| historical `stale_authority` | a profile from before the owner fields, or a liveness this platform cannot prove | `baton serve` |

```json
{ "schemaVersion": 1, "state": "stale", "code": "cli_resident_gone",
  "message": "the resident that published this connection is gone: pid 4711 published deployment deployment-… incarnation instance-… at … and is no longer running; start it again with baton serve",
  "detail": { "ownerPid": 4711, "ownerState": "stale", "publishedAt": "…", "deploymentId": "…", "incarnation": "…", "profile": "resident-…", "transport": "local", "socket": "absent" },
  "next": [{ "action": "recover", "command": "baton serve" }] }
```

A Unix-socket transport has no network: none of these refusals, and none of `baton serve`'s exit
lines, reports a connection fault the operator is asked to debug as one.

Explicit authenticated network deployments retain the schema-v1 setup convention. Their
repository selector is:

```json
{ "schemaVersion": 1, "profile": "progressive", "repoId": "repo-a" }
```

at `.git/baton/connection.json` for a normal checkout, or the corresponding
`baton/connection.json` below the resolved Git common directory for a linked worktree. The user
connection profile lives at `$XDG_CONFIG_HOME/baton/connections/progressive.json` (or
`~/.config/baton/connections/progressive.json`):

```json
{
  "schemaVersion": 1,
  "url": "https://baton.example.test",
  "origin": "https://control.example.test",
  "tokenFile": "progressive.token"
}
```

`tokenFile` is relative to the profile unless absolute. Both the profile and token are bounded,
owner-only, regular non-symlink files owned by the current UID where the platform exposes it. The
repository configuration and user profile never contain the token. Baton discovers the repository
from the current directory upward and shares the selector across linked worktrees.

For compatibility, setting all of `BATON_URL`, `BATON_ORIGIN`, `BATON_REPO_ID`, and `BATON_TOKEN`
selects the legacy environment authority. A partial set is rejected and is never merged with files.

Then use the same command bus as the browser and MCP:

```sh
baton doctor
baton doctor --check
baton explore 'Summarize the failing boundary and report evidence' \
  --exact codex/gpt-5.6-sol@low
baton review 'Audit this change for correctness and integration risks' \
  --exact codex/gpt-5.6-sol@high --exact grok/grok-4.5@medium
baton run start 'Implement the accepted design' --exact codex/gpt-5.6-sol@low
baton run approve RUN_ID --plan PLAN_DIGEST
baton run status RUN_ID --wait 30s
baton run send RUN_ID 'Check the failing boundary.' --nudge
baton run interrupt RUN_ID --reason 'Pause this turn for operator review.'
baton run show RUN_ID
baton run show RUN_ID --depth index
baton run show RUN_ID --depth section --section execution
baton run progress RUN_ID --follow
baton run events RUN_ID --follow
baton run output RUN_ID --to work --follow
baton run evidence RUN_ID
baton run adopt RUN_ID --reason 'Select the preserved independently inspected result.'
baton run review RUN_ID --exact glm/glm-5.2@xhigh \
  --reason 'Obtain independent semantic evidence before integration.'
baton run integrate RUN_ID --strategy ff-only \
  --reason 'Integrate the adopted independently reviewed result.'
baton run stop RUN_ID --reason 'Operator cancelled this Run.'
baton run export RUN_ID DIR
baton run do RUN_ID ACTION_ID --inputs '{"key":"value"}'
baton help run
baton credentials install kimi
```

`baton run OBJECTIVE` and `baton run start OBJECTIVE` are the same start form; both accept
`--exact HARNESS/MODEL@EFFORT` or the `--model/--effort` (plus disambiguating `--harness`)
manual pair, with optional `--profile`, `--run-id`, and `--scope`. The ordinary zero-assembly
deployment defines the single profile `default`, so `--profile` is normally omitted; naming an
undefined profile is refused `application_profile_not_found`. `baton run do` drives any advertised
RunView action by its `actionId`. When no connection exists yet, `baton doctor` offers
`baton serve` (ordinary) before `baton setup` (explicit network deployments).

`baton review` is the ordinary objective-first independent-review preset. Its two exact routes
become the fixed `reviewer` and `challenger` roles of one isolated, operator-selected Workflow.
Use the connected JavaScript `workflow(objective, {team})` surface only when advanced caller-named
team composition is needed. Both forms retain the complete harness/model/effort tuple; neither
accepts budgets, storage ceilings, worker/task/fence coordinates, or receipt paths.

`baton doctor --check` now includes the deployment's sanitized repository, verifier, dependency,
and per-exact-route readiness. The connected JavaScript client exposes the same data through
`doctor()`, `routes()`, and `route({harness, model, effort})`, so route selection does not require
opening the deployment factory. `baton route HARNESS/MODEL@EFFORT` selects the identical sanitized
row for CLI orchestration.

### Refusals from the connection authority

Both connection codes carry a typed cause, the field or path the client judged, the rule it
violated and the remedy that fixes it — the same triple in the printed `detail`, in the MCP
bridge's forwarded refusal, and in `baton doctor`:

```json
{
  "code": "cli_config_invalid",
  "message": "the resident repository connection was published by a different commit: its semantic-registry digest differs from this CLI's; the resident publishes 3f9c…a1 but this CLI carries 8b2d…07; use the CLI of the commit the resident runs, or restart the resident from this checkout",
  "field": "registryDigest",
  "detail": {
    "cause": "repository_selector_registry_digest_drift",
    "field": "registryDigest",
    "rule": "the resident repository connection was published by a different commit: its semantic-registry digest differs from this CLI's",
    "remedy": "use the CLI of the commit the resident runs, or restart the resident from this checkout",
    "residentRegistryDigest": "3f9c…a1", "cliRegistryDigest": "8b2d…07"
  }
}
```

`baton doctor` prints the same refusal beside its outline for a publication it judged unusable, and
its `next` names the remedy instead of `baton setup` — protocol drift after a `git pull` is the
expected case, and `baton setup` cannot repair it. The table is enumerable: the
`CLI_CONNECTION_CAUSES` export lists every typed cause the client can refuse a connection or its
configuration with, and `cliConnectionCauseRow(cause)` reads one row (code, field, rule, remedy).

When a command outlives the CLI's own request bound while the deployment still answers, the client
refuses `cli_command_pending` with the operation key and the row that will carry the verdict
(`detail.observe.command` / `detail.observe.row`) rather than reporting a network fault; a command
that never reached the deployment keeps the honest `cli_transport_failed`.

### Fleet routes

The zero-assembly deployment registers these route families (`baton doctor` for live readiness):

<!-- BEGIN GENERATED: cli-fleet-routes (impl/scripts/render-surface-docs.mjs) -->

| Harness | Model(s) | Efforts | Ready when |
|---|---|---|---|
| `codex` | `gpt-5.6-sol` | minimal/low/medium/high/xhigh | `~/.codex/auth.json` present |
| `kimi-code` | `kimi-code/k3` | low/high/max | kimi credential files present with a ready authentication state |
| `grok` | `grok-4.5` | low/medium/high | `~/.grok/auth.json` present with a ready authentication state |
| `claude-code` | `claude-opus-4-6` | low/medium/high/xhigh/max | bounded version + auth status probes |
| `muse` | `muse-spark-1.3-contributor` | low/medium/high/xhigh/max | a muse login (`muse login`, the OS keyring; keyring-less hosts fall back to `TBH_CREDENTIAL_BACKEND=file muse login`) |
| `omp` | `deepseek/deepseek-flash` | low/high/max | `~/.omp/agent/agent.db` present, repo `deepseek_key.json` present, and `omp models --json` defining the model and effort |
| `omp` | `deepseek/deepseek-v4-pro[1m]` | low/medium | `~/.omp/agent/agent.db` present, repo `deepseek_key.json` present, and `omp models --json` defining the model and effort |
| `omp` | `zai/glm-5.3-flash` | low/high/max | `~/.omp/agent/agent.db` present, repo `glm_key.json` present, and `omp models --json` defining the model and effort |
| `claude-code` (provider kimi, conditional) | `kimi-k3[1m]` | max | the private kimi-through-claude credential present |

<!-- END GENERATED: cli-fleet-routes -->

The omp rows ride the omp (OhMyPi) harness as first-class providers: omp dials the provider
directly, with no Anthropic-compatible translation, and each member's isolated home receives the
operator's own `~/.omp/agent` tree HOME-relative — exactly omp's native resolution.
`deepseek/deepseek-flash` (the provider's canonical V4 Flash API name) is the primary,
economically efficient model and the adapter-configured default; `deepseek/deepseek-v4-pro[1m]`
precedes its unpublished update, so it stays an explicit low/medium opt-in and is never a default.

Admission and readiness are the observed facts this table documents, never a declaration:
`baton doctor` admits the codex, muse, grok, kimi-code and omp families only when their ambient
credential fact is present (the omp family's is `~/.omp/agent/agent.db`; the claude-code rows are
built-in and probe at readiness time), and an omp route whose provider key file is absent —
`deepseek_key.json` for `deepseek/*` routes, `glm_key.json` for `zai/*` routes, both gitignored at
the repository root and provisioned 0600 — reads blocked with that file named, never ready and
never a construction failure. The retired Anthropic-compatible `deepseek`/`glm` session tiers
stay constructible only through an explicit `advanced.routes` configuration. The table above
renders from the served registry and the deployment's own readiness contract, so it cannot
disagree with what the deployment serves or gates. Pinned by
`impl/test/deepseek-routes-red.test.mjs` (DS-1..DS-4) and `impl/test/route-truth.test.mjs`.


`run adopt` first reads `run.evidence` and binds the exact displayed manifest/result coordinates;
it does not inspect a disposable worktree, merge, checkout, or publish. Use
`--idempotency-key KEY` when an external caller needs stable retry identity. Provider credentials
are not CLI fields. `run send` and `run interrupt` resolve the current semantic recipient inside
Baton; ordinary callers never supply a worker ID or fence. Interrupt ends only that provider turn
and preserves the Run/worktree for continuation, while `run stop` closes dispatch authority and
reaps the whole Run subtree. Worker steering is `run send` (and `run interrupt` for turn-scoped
stops); the deleted `steer` verb was sunset at the M5 alias migration and refuses with corrective
naming.

Routine mutations and status return a compact machine-readable outline: objective, phase, current
progress, exact requested/resolved/observed route, attention, action outcome, and next expansion.
Internal budgets, ceilings, task/worker IDs, fences, policy attestations, and full lifecycle
chapters stay hidden. `run show` follows the same progressive cascade as the application:
`outline` (default) → `index` → `section` → `item`, with `content` for Context result chunks and
execution progress/events/output, and `evidence` for exact provenance. The three Run stream
commands manage opaque continuation, response, and wait policy inside Baton. Normalized events
exclude provider payloads; output is an explicit opt-in and every item is marked
`contentTrust: untrusted_provider`. Section/item selectors are required only at the corresponding
depth.

`run review` selects one deployment-allowed exact
`harness/model/effort` reviewer route. `run integrate` first refreshes `run.evidence`, binds that
manifest digest, and invokes only the profile-allowed local integration strategy; it never pushes,
publishes, or deploys.

## Own a Web deployment

`baton serve` is the normal zero-assembly owner-local host. It returns only a non-secret outline
and never falls back to cleartext TCP or a wildcard bind.

`baton serve CONFIG_MODULE` is the advanced explicit-network compatibility seam. It loads a deployment factory exporting `default` or
`createBatonWebHost()`. It may return a `BatonWebHost` or these already policy-bound authorities:

```js
export default async function createBatonWebHost() {
  return {
    application, // BatonApplication
    server,      // createAuthenticatedWebServer(northbound, TLS/proxy policy)
    shutdownPrincipal: {
      actor: 'host:production',
      principalId: 'host',
      sessionId: 'host-process',
    },
    listen: { host: '127.0.0.1', port: 8443 },
    webDrainMs: 5000,
  };
}
```

The config owns deployment policy; the host owns lifecycle. `SIGINT`, `SIGTERM`, listener close,
and listener error close Web admission first and then call the host-only
`application.shutdown`. Remote clients cannot invoke that fleet-wide authority. The drain narrates
itself under the same contract as `baton serve` (see
[Connect to a resident authenticated Web host](#connect-to-a-resident-authenticated-web-host)): the
receipt line names the participants this host owns at the signal, the drain's stages follow, the
drain's own deadline names `detail.waitingOn` / `detail.reason` before the host stops waiting, and
the exit is 0 exactly when the drain converged.

Cursor `--follow`, exact recovery, materialized result export, and bounded multi-node Workflow
operations use the same application authority rather than a second fleet controller.
