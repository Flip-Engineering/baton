# Phase 10.1 — spawn/stop reconciliation

Status: **specification pinned after executable re-verification; implementation pending**.

This spec is an erratum and extension to `spec/phase10/system-completion.md`. SC1 made session
spawn asynchronous while resolving the task worktree, and SC4 serialized sends, but neither
contract reconciled those waits with the existing two-phase stop state machine. The result is a
single defect cluster: authority can finalize a stop while work is still queued to start, and a
later continuation can revive or orphan that work.

The current failures were re-run against `f966e66` with zero-quota fakes on 2026-07-10. Evidence:
`docs/handoff/evidence/phase10.1-reverification.md`.

## SC12 — spawn is a reserved, cancellable lifecycle

For a worker id, `spawn()` MUST reserve the worker synchronously, before its first `await`.
Another spawn for the same worker while that reservation exists MUST resolve `{ok:false}` and
MUST NOT create a second child. The reservation is released exactly once when spawn refuses or
is promoted to a registered live session.

While spawn is waiting for `worktreeReady`, both `interrupt(worker)` and `kill(worker)` MUST cancel
the reservation and emit the matching confirmed-stop event. When readiness later resolves, the
cancelled spawn MUST refuse without creating a child. There is no interval in which a child exists
but neither the pending-spawn reservation nor the live-session registry owns it.

After every asynchronous boundary and immediately before child creation, spawn MUST re-check
cancellation. Once a child is created, all later failure paths MUST reap that child and remove its
session before returning a refused Ack.

Red obligations:

- delayed `worktreeReady` + kill, then readiness resolution, creates zero children;
- the same scenario with interrupt creates zero children;
- two same-worker spawns sharing delayed readiness create one child and one refusal;
- every adapter leaves no pending reservation after refusal, success, or stop.

## SC13 — terminal task state is monotonic across spawn refusal

`cancelled` joins `completed` and `failed` as a terminal task status. `_onSpawnRefused` MUST be a
no-op when a stop is in progress, the handle is dead/idle after a confirmed stop, or the task is
already terminal. A user cancellation MUST never become `failed`, and a confirmed stop MUST never
be followed by a fabricated `lifecycle.crashed{phase:'spawn'}`.

A genuine spawn refusal for a still-working task MUST append exactly one durable
`lifecycle.crashed{phase:'spawn'}` and replay to `failed`.

Red obligations:

- kill racing a refused handshake remains `cancelled` before and after replay;
- refusal without a stop logs the durable crash event and replays to `failed`;
- duplicate refusal notification does not append a second crash.

## SC14 — queued delivery cannot cross a stop boundary

At delivery-slot acquisition, `_deliver` MUST reject unless both the worker and its task are live.
`stopping`, `idle`, `dead`, and every terminal task status reject before calling the adapter.
This guard is evaluated after earlier sends settle, not only when `send()` is called.

The adapter Ack is authoritative: `{ok:false}` MUST be returned as a failed delivery and MUST NOT
append a successful `control.send`/`control.nudge`/`control.steer` event. A queued send that loses
to interrupt or kill cannot start another turn or run the trust gate for the cancelled task.

Red obligations:

- A holds the send slot, B queues, interrupt confirms, A releases: B never reaches the adapter;
- the same scenario with kill never delivers B;
- an adapter `{ok:false}` is not logged as a successful delivery.

## SC15 — rejected spawn and refused spawn are one failure channel

The coordinator MUST normalize both a resolved `{ok:false}` and a rejected/throwing spawn promise
through `_onSpawnRefused`. A thrown spawn cannot remain `working`; it produces the same durable,
replayable failure as a refused Ack unless SC13 says a concurrent stop already owns the terminal
state.

## SC16 — failed setup owns child teardown

For Codex app-server, failure of `initialize`, `thread/start`, or the first `turn/start` MUST kill
the child and remove the session before `spawn()` resolves `{ok:false}`. Claude and Grok carry the
same invariant for every post-child setup failure. A refused spawn Ack means no process remains.

## SC17 — story completion is derived from lifecycle facts

The story fold records whether an exited worker crashed. `lifecycle.crashed` is not rendered or
counted as done. A clean `lifecycle.exited` counts as done regardless of unrelated warnings.

`lastVerdict` belongs to one turn and MUST be cleared by the next `lifecycle.turn_started`.
A working worker cannot be counted simultaneously as active and done from a stale verdict.

## SC18 — session wall-time budgets are enforced

When `spawn(..., {timeoutMs})` receives a positive timeout, every session adapter MUST arm a timer
for that worker. Expiry emits one observable `lifecycle.crashed{phase:'timeout'}` and reaps the
child. Natural exit, explicit interrupt/kill, spawn refusal, and replacement MUST clear the timer.
No timer is invented when `timeoutMs` is absent.

This closes the phase-10 regression only. Token/USD threshold policy and the governance watchdog
remain phase-11 work; SC18 does not broaden into that backlog.

## SC19 — phase-10 claims are mutation-locked

SC1d's test MUST assert the durable spawn crash event, not only in-memory status. SC8 MUST pin the
exact eight-verb maps for ClaudeSessionCli, CodexAppServerCli, and GrokAcpCli. These are explicit
value assertions, not shape-only assertions.

## SC20 — safety gate before recursive dogfooding

The full zero-quota suite and a fresh adversarial review MUST close SC12–SC19 with no unresolved
critical or major correctness finding before any real vendor capstone begins. Only then may Baton
drive real Baton-repository micro-tasks through `createDriver()`.
