# Operator ergonomics and lifecycle audit

Reviewed 2026-09-13 against commit `9fdbb2f7`. Read-only; no source changed.
Test contract: `node --test impl/test/omp-native-features.test.mjs` → exit 0.

---

## 1. Command surface: what exists and where

`APPLICATION_COMMAND_DEFINITIONS` (`application.mjs:173`) is the authoritative table for
commands reachable over web, MCP, and the generic `application.command()` port. Additional
direct-port commands are dispatched in `_commandDispatch` (`application.mjs:12853`) before
the table check. Key entries relevant to the self-build lifecycle:

| Command | Port | Effect |
|---|---|---|
| `run.start` | table | Start a run |
| `run.inspect` | table | Read current run view (depth: outline/index/section/item/content/evidence) |
| `run.follow` | table | One-shot event-driven wait (see §4) |
| `run.episode` | table | Read a result topic chapter |
| `run.workstreams` | table | List workstream roles |
| `run.workstream.notify` | table | Send message to a specific role |
| `run.workstream.stop` | table | Stop one member by role |
| `run.act` | table | Execute an advertised run action |
| `run.answer` | table | Answer a pending request (covers approvals, questions, decisions, checkpoint acts) |
| `run.wait` | table | Block until a condition (`settled`/`terminal`) |
| `run.stop` | table | Stop the whole run |
| `run.recover` | table | Trigger state recovery |
| `run.steer` | **direct port only** | Worker-targeted steer (see §2.1) |
| `run.attention.watch` | direct port only | Internal attention+run composite (see §2.2) |

---

## 2. Verified findings

### 2.1 `run.steer`: not absent, but surface-restricted

**Evidence:** `application.mjs:12906–12910` dispatches `run.steer` directly to
`this.steer(args, principal)` before the `APPLICATION_COMMAND_DEFINITIONS` validator runs.
The comment reads: "run.steer is deleted from every surface (web/cli/mcp/application.commands);
the direct command port stays as the deprecated compat authority behind the embedded
BatonRun.steer method."

`steer()` at `application.mjs:13702` normalizes the request, authorizes it, finds the named
worker in `coordinator.list()`, and calls `coordinator.send(target.id, request.message, mode,
{ expectedFence: target.fence })`. It requires a live worker by exact `target` ID and a
current fence; it fails with `application_worker_not_found` if the worker is absent.

**Actual failure boundary:**
- **CLI**: `application-cli.mjs:1933` throws `'steer was deleted at the M5 alias sunset; use run send'` — the CLI never calls the application.
- **MCP / web**: `run.steer` absent from `APPLICATION_COMMAND_DEFINITIONS` and not exposed.
- **Embedded `application.command('run.steer', args)`**: dispatches and works.
- **`BatonRun.steer(target, message, options)`** (`application-client.mjs:1280`): calls
  `application.command('run.steer', ...)` — works in embedded code, but has no CLI or MCP
  equivalent.

**Structural problem:** `run.steer` requires caller-supplied `target` (worker ID) and carries
`reason` — fields that belong to the coordinator's internal view of membership, not to an
operator who only knows a run ID and a role name. `run.workstream.notify` uses role-based
addressing and is the documented replacement. An operator using the embedded SDK who calls
`run.steer()` gets a live but undocumented direct port; one using CLI or MCP gets a typed
refusal with no migration path.

### 2.2 `run.attention.watch` is a working direct port, not a missing command

`application.mjs:12875` dispatches `run.attention.watch` to `this.attentionWatch(args,
principal)` before the table check. It is reachable via `application.command(...)` in embedded
code. The production-cli-convergence visualization uses it directly at
`production-cli-convergence.mjs:313`. It is not in `APPLICATION_COMMAND_DEFINITIONS` and is
not exposed over MCP or web. An embedded orchestrator can call it directly.

### 2.3 Checkpoint actions appear only in the run inspect outline

`claim_turn`, `nudge_turn`, and `wait_turn` are `run.act` actions. Their `pauseId` is
server-derived and changes with each pause record; callers cannot supply it directly.

**Path to invoke:** call `run.inspect({ depth: 'outline' })`, find the action with
`kind === 'claim_turn'` in the returned actions array, then call
`run.act({ runId, actionId: descriptor.actionId, inputs: {} })`.

`BatonRun.act('claim_turn', {})` (`application-client.mjs:1111`) does this automatically:
it re-inspects if the current outline lacks the action, then dispatches. The CLI command
`baton run do RUN_ID ACTION_ID` is the equivalent — `ACTION_ID` comes from the outline.

`run.answer` is a CLI alias for the same dispatch (`application-semantics.mjs:816`):
`baton run answer RUN_ID REQUEST_ID` maps to `run.answer` which routes to `run.act` internally.

There is no `baton run checkpoints RUN_ID` shortcut. An operator who does not know to read
the outline will not discover that a checkpoint is actionable.

### 2.4 `run.follow` is event-driven, not a poll loop

`application.follow()` (`application.mjs:8384`) calls
`coordination.waitAfter(view.cursor, remaining, { signal })` (`coordination-store.mjs:9331`)
which registers a waiter in `_appendWaiters` (`coordination-store.mjs:763`). The waiter is
woken when a new event is appended to the coordination log
(`coordination-store.mjs:1964`). It does not poll. If events appear before the deadline, the
call returns immediately with them; otherwise it returns at the deadline with `timedOut: true`
in the `follow` field.

**`BatonRun.follow()`** (`application-client.mjs:951`) is an async generator wrapping
`changes()`, which calls the run's `continuation` command (also event-driven internally).

**`BatonRun.followOnce(options)`** (`application-client.mjs:957`) is a single-shot call to
`run.follow` directly. Required fields:
```js
await run.followOnce({ afterCursor: number, timeoutMs: number }); // signal optional
```
Both `afterCursor` and `timeoutMs` are validated as safe integers; missing or non-integer
values throw a client error. This is the wave driver's preferred wake primitive
(`wave-driver.mjs` uses it per-member per iteration).

**`BatonRun.wait()`** (`application-client.mjs:904`) is distinct: it executes the
`continuation` from the last response object, not `run.wait`. It is useful for consuming
the server-suggested next request, not for blocking on a known condition.

### 2.5 `BatonRun.episode()` returns a facade, not a result

`run.episode()` (`application-client.mjs:892`) returns a `BatonEpisode` instance, not a
promise. Reading a topic requires a method call on the facade:

```js
const ep = run.episode();            // factory — no network call
await ep.result();                   // reads run.episode, topic: result
await ep.verification();             // reads run.episode, topic: verification
await ep.output();                   // reads run.episode, topic: output (content detail)
```

For a role-specific workstream episode:
```js
const ws = run.workstreams().open('implementer');
// BatonWorkstream has notify() and stop(), but no episode() method directly
// Use run.episode directly:
await run._command('run.episode', { runId: run.id, topic: 'result', role: 'implementer' });
```

`BatonEpisode` (`application-client.mjs:708`) takes an optional role and generation in
its constructor, set via `run.workstreams().open(role).episode()` if that path exists, or
directly via `new BatonEpisode(run, role, generation)`.

### 2.6 `runs.start(objective, options)` signature

```js
const run = await baton.runs.start(objective, {
  exact: { harness: 'omp', model: 'deepseek/deepseek-flash', effort: 'high' },
  resultIntent: 'change',   // 'change' | 'read_only_evidence'; default 'change'
  scope: ['impl/src'],      // array of path strings, optional
  profile: 'default',       // optional
});
```

`objective` is a plain string (required). Options fields: `runId`, `resultIntent`, `profile`,
`scope`, `model`, `harness`, `effort`, `exact`, `driverKind`, `waveId`, `waveRole`,
`waveStart`. `exact` and manual `model/harness/effort` are mutually exclusive
(`application-client.mjs:148`). `model` and `effort` must appear together if either is present.

### 2.7 Structural problem: 47k-line coordinator/application/store triad

`coordinator.mjs` (15k lines), `application.mjs` (13.8k), `coordination-store.mjs` (18k) are
mixed-concern: admission, projection, recovery, and effects run in the same process and compete
for the same async queues. Noted in docs/40:

> Repeated store scans and large snapshot/projection work can obstruct the same process that
> services controls.

Three extraction seams with bounded scope:

**`PausedTurnRegistry`**: `_pausedTurns` is a `Map` with a reserve/commit/rollback protocol
(`coordinator.mjs:2151, 2255`). It does not touch the log or adapters. It can be extracted
as a standalone class, making `claimTurn` / `nudgeTurn` / `waitTurn` each a 10-line
orchestration call rather than procedures that inline the reservation.

**`TrustGate` module**: `_runTrustGate`, `_claimLivenessPreflight`, `_captureTrustWorktree`,
and `_referee` share a cohesive contract (capture → scope check → verify → record). They
currently share coordinator-internal state. Extracting them with a
`run(handle, task, workerResult) → { outcome, checkpoint }` surface would make `claimTurn`'s
body a composable pipeline rather than a 60-line entangled procedure.

**Read-only projection layer**: `pausedTurnStatus`, `providerSilenceAttention`, and the
`_buildView` / `_followPage` family do not write state. They currently share the coordinator's
async admission queue. A read model that receives only the event log copy and the live handle
projection would let observation calls bypass the mutation queue entirely.

These are bounded extractions with no external-interface changes, verifiable against the
existing test suite.

---

## 3. Self-build lifecycle: exact paths

### Start

```
baton run OBJECTIVE [--exact omp/MODEL@EFFORT] [--scope PATH]
```
Embedded: `baton.runs.start(objective, { exact: { harness, model, effort } })`

### Observe

```
baton run show RUN_ID --depth outline      # current state + available actions
baton run progress RUN_ID --follow         # streaming (cursor-advancing, event-driven)
```
Embedded one-shot: `await run.followOnce({ afterCursor: cursor, timeoutMs: 30_000 })`
Embedded generator: `for await (const view of run.follow()) { ... }`

`run.follow` wakes on log-append events, not on a timer. A long `timeoutMs` does not poll.

### Steer an active worker (mid-turn)

```
baton run notify RUN_ID ROLE MESSAGE [--nudge|--now|--turn]
```
Embedded: `await application.command('run.workstream.notify', { runId, role, message, delivery: 'nudge' })`

For semantic-recipient send without a role:
```
baton run send RUN_ID MESSAGE
```
Embedded: `await run.act('send', { message, delivery: 'nudge' })`

`BatonRun.steer()` works in embedded code (direct port at `application.mjs:12909`) but
requires exact worker ID and fence via `target`, not a role name. Not available from CLI or MCP.

### Accept a paused checkpoint

```
baton run show RUN_ID --depth outline          # find claim_turn action_id
baton run do RUN_ID <action_id>                # claim_turn: runs trust gate
# OR:
baton run answer RUN_ID <request_id>           # same dispatch via run.answer alias
```
Embedded: `await run.act('claim_turn', {})`   — re-inspects if needed, then dispatches

To continue without accepting: `await run.act('nudge_turn', { message: 'Continue.' })`

### Read the result

```
baton run result RUN_ID                        # run.episode topic: result
baton run episode RUN_ID verification          # verifier outcome
```
Embedded: `await run.episode().result()`       — facade → method call → network

### Recover after a verification failure

```
baton run show RUN_ID --depth outline          # check for retry_verification or resume_work actions
baton run retry RUN_ID --reason REASON         # retry on pinned checkpoint (requires prior verifier result)
baton run resume RUN_ID --reason REASON        # resume from preserved progress checkpoint
```
Both appear in the outline only when their preconditions hold. Neither is callable without
the server having set the correct task state first.

### Stop and close

```
baton run stop RUN_ID                          # stops the run, reaps its workers
# The deployment lifetime is owned by the process that started `baton serve`.
# There is no `baton deployment close` CLI verb.
```
Embedded: `await run.stop('Completed.')`  — then the embedding program closes the deployment.

`deployment.close` is wired as a surface capability at `production-convergence.mjs:331`, not
as a CLI-reachable command. An agent driving a run does not call it.

---

## 4. Test contract

`impl/test/omp-native-features.test.mjs` pins six behavioral facts about `OmpRpcCli`:
six tests, six passes, exit 0.

The pins defend the 2026-09-12 finding that argv suppression (`--no-skills`, `--no-extensions`,
etc.) was false containment. `buildOmpRpcArgs` at `omp-rpc.mjs:91` encodes this as a verified
law. Real containment is the runtime's same-UID private HOME, worktree cwd, and projected
credentials (`runtime-isolation.mjs`), not argv flags.
