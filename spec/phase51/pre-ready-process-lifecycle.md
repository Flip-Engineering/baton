# Phase 51 pre-ready provider process lifecycle and exact reap — 2026-07-13

## Why this phase exists

Phase 50's recursive post-fix matrix proved exact harness/model/effort routing and a complete GLM
worker lifecycle, but Codex initialization and both Grok authentication attempts failed before
their adapters emitted the existing worker-origin `lifecycle.spawned` event. Baton therefore knew
that the allocations and ownership scopes were cleaned up, but its durable worker ledger could not
name the setup-process PIDs or prove each PID-specific close. `lifecycle.spawned` currently means
the provider wire is ready enough to expose a native session/thread; overloading it with mere OS
process creation would destroy that useful distinction.

The source audit also finds a sharper race: Codex and Grok keep `_pendingSpawns` live while setup
RPCs run. A kill during that interval can take the pre-child synthetic-confirmation path even after
a child exists. Setup refusal can also let the coordinator remove worktree/runtime ownership before
the signalled child has emitted close. Phase 51 makes native process existence, provider readiness,
stop authority, and resource reap four separately evidenced facts.

This phase covers the shipped session product adapters: `ClaudeSessionCli` (and its
`GlmSessionCli` subclass), `CodexAppServerCli`, and `GrokAcpCli`. The retained one-shot compatibility
tier receives the same process events where it owns a real child. Mock workers never fabricate an
OS PID. A future generic ACP/Gemini adapter must implement this contract before joining the product
tier. No homelab or external project-manager integration is added.

## Contracts

### PL1 — closed lifecycle vocabulary

Every owned real child emits exactly one worker-origin `lifecycle.process_started` immediately
after successful OS spawn and before initialize/session/turn I/O. Its exact payload is:

```json
{"schemaVersion":1,"generation":1,"pid":123,"processGroupId":123,"phase":"initializing"}
```

Every started child emits exactly one worker-origin `lifecycle.process_closed` from the OS
`close` path, before any close-derived `kill.confirmed`, `lifecycle.exited`, or
`lifecycle.crashed` event. Its exact payload is:

```json
{"schemaVersion":1,"generation":1,"pid":123,"processGroupId":123,"code":null,"signal":"SIGKILL","ready":false}
```

`pid` and `processGroupId` are positive safe integers and are equal because every current child is
a detached process-group leader. `generation` is a positive coordinator-selected integer. `code`
is a safe integer or null, `signal` is a bounded signal name or null, and `ready` records whether a
worker-origin provider-ready `lifecycle.spawned` occurred for that generation. Events expose no
argv, cwd, environment, credential, prompt, response, stderr, or provider payload.

An OS spawn error that never obtains a positive PID emits no fake start/close pair. The existing
bounded spawn-refusal/crash channel remains authoritative for that case.

### PL2 — process existence is not provider readiness

`lifecycle.process_started` means only that an OS child/group exists. The existing worker-origin
`lifecycle.spawned` remains the provider-ready fact and still carries the wire session/thread ID,
provider-observed model/effort when available, and PID. Process state advances monotonically from
`initializing` to `ready` to `closed`; authentication refusal, initialize timeout, or session-start
failure may close directly from `initializing`.

No process event may establish model/effort observation, session identity, successful route use,
turn acceptance, report production, or native concurrency. Those claims retain their existing
stronger evidence.

### PL3 — coordinator-selected generation and exact correlation

The coordinator increments a per-worker process generation before each initial spawn or native
recovery attempt and passes it to the adapter. The adapter echoes it on both events. A start must
match the current generation and may not replace an active process. A close must match the exact
generation, PID, and process-group ID of the current process. Duplicate, stale, future, malformed,
or cross-worker events are refused as attribution and cannot close or replace current authority.

The operational log retains a bounded payload-key/type shape digest plus safe correlation fields,
never the untrusted raw provider payload, and records a policy violation when possible.
Current-process attribution remains unchanged and Baton initiates a safe kill for an invalid event
from an otherwise live worker. An authoritative-log failure poisons ordinary control but preserves
the existing emergency reap path.

### PL4 — bounded public process projection

Authenticated/direct orchestrator status exposes one closed `processRef` only:

`generation`, `pid`, `processGroupId`, `state`, `ready`, `startedSeq`, and `closedSeq`.

`state` is exactly `initializing | ready | closed | unconfirmed_after_restart`. `closedSeq` is null
until close. The projection contains no executable, arguments, paths, environment, auth material,
provider frames, or error prose. Web and MCP keep their existing observe/control authorization and
size ceilings; Phase 51 adds no unauthenticated endpoint.

### PL5 — setup failure retains ownership until close

After a child exists, any authentication, initialization, session creation/load, thread creation,
or first-turn dispatch failure signals the owned process group and returns the same bounded failed
spawn outcome. The coordinator records the task failure but retains runtime scope, worktree,
branch, and worker ownership until the exact process is closed or the existing forced-stop deadline
fires. A fast close racing the refused-spawn Ack is idempotent and cannot strand a waiter or cause
premature cleanup.

Automatic setup-failure teardown is proven by exact process-start/process-close correlation. It is
not mislabeled as a user-requested kill when no such command occurred.

### PL6 — kill during initialization is a real two-phase stop

If a session already owns a child, `kill(worker)` must address that session even while its setup
promise remains pending. The pre-child synthetic `kill.confirmed{phase:'spawn'}` path is permitted
only when no child was ever created. Once `lifecycle.process_started` exists, the adapter signals
the process group and `kill.confirmed` can arise only after the exact matching OS close.

Concurrent initialize/session RPC rejection and late spawn-refusal handling cannot overwrite the
cancelled task, duplicate terminal facts, revive delivery, remove a later generation, or leak the
child. Repeated kill shares the same waiter and remains idempotent.

### PL7 — close ordering and cleanup proof

For deliberate kill, the per-worker order is:

1. coordinator `kill.requested`;
2. matching `lifecycle.process_closed`; and
3. durable coordinator `kill.confirmed`, after adapter Ack and close confirmation converge.

Only then do runtime scope, worktree, branch, and stop-waiter ownership disappear. The process
leader and process group must both be gone. A confirmed interrupt retains process and writer
authority because its reusable session remains alive. A forced-stop deadline records
`unconfirmed_after_restart` and may remove bounded task/runtime allocations, but it cannot release
writer authority; a later ordinary or emergency `kill()` retries the native reap until the exact
close arrives. Unexpected natural/crash closure similarly records the matching process close
before its terminal lifecycle event. `driver.close()`/`closeAsync()` cannot release the writer
while an owned started generation lacks exact close or cleanup remains pending.

### PL8 — recovery and replay honesty

Replay reconstructs the latest exact process generation and its start/ready/close evidence. During
transactional recovery/follow-up admission, a sanitized policy-origin `lifecycle.process_ready`
event persists only generation/PID/group readiness; provider session identity stays buffered until
admission succeeds. A started generation without a durable close becomes
`unconfirmed_after_restart`, never live merely because its historical PID is present. Its
historical `ready` bit remains available for exact late-close correlation without claiming a live
transport. Native reattachment allocates generation+1, must still be open when admission commits,
and must close independently. Stale close from generation N cannot affect generation N+1, and
rejected recovery identity cannot pivot the durable session reference.

Process events remain operational evidence; they do not invent a live transport after restart.
The existing native session-recovery handshake remains the only authority to regain control.

### PL9 — adapter parity and legacy honesty

Claude/GLM, Codex, and Grok session adapters implement identical event shapes and ordering around
their different wire handshakes. The one-shot `CliAdapter` tier emits the pair around its child and
close path when live execution is enabled. Adapters without a real child, unsupported adapters,
and pre-child cancellation emit neither event. Cards do not claim a new control verb.

Exact harness/model/effort selection remains independent of process telemetry. In particular,
process start proves that the selected harness executable launched, not that the requested model or
effort was accepted or observed.

### PL10 — bounds, non-disclosure, and failure atomicity

Only the closed schemas above are accepted. Unknown fields, invalid generations/PIDs/group IDs,
oversized signals, impossible ready/state transitions, and mismatched close facts do not mutate
`processRef`. Public projections and retained evidence are scanned for credential values and
provider payloads. Logging or coordination failure cannot be converted into a successful control
result; emergency native kill remains available and cleanup remains best effort under poison.

### PL11 — red-to-green and recursive proof

Zero-quota tests use real fixture subprocesses to prove:

- start-before-I/O and exact close for Claude/GLM, Codex, Grok, and the one-shot tier;
- Codex/Grok authentication/initialize/session refusal before provider readiness still has an
  exact PID/group close and no early resource cleanup;
- kill during a blocked setup RPC reaches the real process group, receives close then confirmed
  kill, preserves terminal monotonicity, and fully reaps;
- public direct/web/MCP process projections are closed and auth-protected;
- malformed, duplicate, cross-generation, replay, and authoritative-write cases fail safely; and
- canonical `npm test` remains green.

Recursive evidence then uses Baton itself from a clean commit with exact project-key GLM
`glm-4.7`/low, exact Codex `gpt-5.6-sol`/low, and concurrent Grok 4.5/Grok Build attempts. It records
process-start separately from provider-ready, current authentication truth, real-time native
overlap only if both groups are simultaneously alive, explicit kill requests, exact close and kill
confirmation, and full worktree/branch/runtime/writer restoration. A red provider route is useful
evidence and never rewritten as a pass.

### PL12 — retained full-system scope

Phase 51 closes only pre-ready native process observability and the setup-stop/reap race. It does
not claim generic ACP/Gemini/OpenCode adapters, deeper provider session recovery/fork/rewind/
checkpoint semantics, daemon/HTTP MCP, WebSocket parity, operator takeover, quota/seat governance,
OpenTelemetry, Playbook/Skill promotion, recall feedback, contradiction UX, Scratch REPL/Bench,
retention/compaction/export, Vantage, Evidence Ladder, Skill Forge/computer use,
Cartographer/Quartermaster, deeper AST/CST/SCIP/CPG/IR/semantic delta, true semantic merge,
behavioral fingerprints, or conditional e-graph research. Every item remains in the full goal.

## Red tests

1. Each real adapter emits exactly one closed start/close pair with the same generation/PID/group;
   start precedes any provider-ready fact and close precedes every close-derived terminal.
2. Fixture Codex and Grok setup refusals never emit provider-ready but do expose and reap their
   exact child/group before runtime/worktree ownership disappears.
3. Killing Codex/Grok while setup is blocked cannot take the pre-child synthetic confirmation;
   the real group dies, close and confirmed kill are ordered, retries are idempotent, and late
   refusal cannot replace cancellation.
4. Claude/GLM natural completion and deliberate kill preserve the same pair and ordering; one-shot
   compatibility workers do likewise without expanding their verb cards.
5. Direct, authenticated web, and authenticated MCP status expose only the closed processRef;
   unauthenticated or wrong-scope callers retain existing refusal.
6. Duplicate start, mismatched PID/group/generation close, future/stale events, and invalid shapes
   cannot mutate current process authority; the live process is stopped safely.
7. Replay marks an unclosed historical generation unconfirmed and a new recovery generation is
   independent; an old close cannot close the new process.
8. Append/coordination poison still permits emergency kill/reap, including retry of a
   dead-but-unconfirmed forced disposition, and never reports ordinary success.
9. Interrupt retains writer authority; forced stop cannot release it; a second ordinary or
   emergency kill can obtain a late exact close and finish cleanup.
10. Recovery that observes the expected provider identity but closes before commit is refused;
    rejected recovery persists only sanitized readiness and cannot rewrite session identity.

## Acceptance gate

Phase 51 closes only when PL1–PL12 are implemented, focused/adjacent/canonical tests pass,
adversarial findings are dispositioned, recursive Baton evidence is retained, every owned process
and repository/runtime resource is reaped, credentials are absent from Git/evidence, and all later
goal scope remains mechanically visible with homelab integration explicitly excluded.
