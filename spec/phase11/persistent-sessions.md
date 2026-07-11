# Phase 11.1 — persistent sessions, follow-up turns, resume, and fork

The session adapters already survive more than one turn. These contracts make that capability
real through the public driver and define the persistence boundary without pretending every vendor
has identical semantics.

## PS1 — a verified session remains reusable

After a natural turn is independently verified, the task result is terminal for that turn but the
session handle may remain idle and attached. `send(worker, content, 'turn')` reopens the same pinned
delegation, bumps the coordinator turn epoch, clears only the current result/verdict projection,
and dispatches a native next turn on the same session/process. It is allowed after completed or
failed verification and after a confirmed soft interrupt, but never after kill, crash, timeout,
or unattached replay.

## PS2 — every follow-up is admitted before state commits

The coordinator changes idle/terminal state to working only after the adapter returns
`Ack{ok:true}`. Refusal or exception restores the prior result/status and logs no successful turn.
One worker serializes follow-up admission with ordinary send/steer operations. A follow-up uses the
same immutable Brief unless a future explicit refinement command creates a new task contract.

## PS3 — interrupt-with-follow-up is coordinator-visible

`interrupt(worker, then)` records `then` in the stop waiter. Once the interrupt Ack and matching
confirmation both arrive, the coordinator reopens the task before the adapter's automatic
follow-up begins. Without `then`, the turn is cancelled and the attached session becomes idle.
Kill always discards pending follow-up. A newer stop supersedes an older follow-up.

## PS4 — turns are fenced and independently verified

Coordinator turn generations are authoritative. Each adapter wire epoch is mapped to the current
coordinator epoch at `lifecycle.turn_started`; late terminal/question/approval events from an older
turn are logged as stale and cannot run the trust gate, block the new turn, or overwrite its
result. Every accepted turn receives a fresh capture, verification sandbox, verdict, router
observation, and model attribution.

## PS5 — native session identity is public and durable

Wire-observed Claude `sessionId`, Codex `threadId`, and Grok `sessionId` become a typed `sessionRef`
on handle/result/events/replay. The reference includes vendor, kind, id, persistence posture, and
observation source. It is never inferred from a client-generated placeholder.

## PS6 — resume and fork are explicit spawn policies

`spawn(..., {session:{mode,id,lastTurnId?}})` supports `new`, `resume`, and `fork` when the card
declares them. Claude maps resume/fork to `--resume ID [--fork-session]`; Codex maps to
`thread/resume`/`thread/fork`; Grok maps resume to `session/load`. Grok's documented
`x.ai/session/fork` and rewind surface remain carded `planned` until their exact installed wire
schemas are pinned and fixture-tested; Baton must not advertise them as native merely because the
vendor has them. Unsupported combinations fail typed before allocation. Fork creates a new
task/session identity and never aliases the parent worker's mutable state.

## PS7 — restart recovery is honest before it is automatic

Replay restores session references but does not claim control until an adapter proves reattachment.
`recover(worker, {timeoutMs?,context?})` attempts bounded native resume/rejoin when explicitly
requested, records success/failure, and only then changes `orphaned` to working. The fresh
handshake must report exactly the persisted native session identity; mismatch, refusal, exception,
or timeout kills the untrusted transport and leaves the handle orphaned. PID identity requires a
birth token or native session handshake; a replayed numeric PID alone is never signalled because
of PID reuse.

## PS8 — worktree and fork coherence

Resume requires a durable context containing at least the exact worktree and its owner task, then
validates repository/base/branch/worktree ownership before dispatch. Fork receives a new worktree
and explicit parent-session/refinement edge. Vendor history resume never
silently restores file changes into the main checkout; rewinds/forks distinguish conversational
history from filesystem state and are independently verified after the next turn.

## Safety gate

PS1-PS5 require fake-backed driver tests for Claude, Codex, and Grok. PS6-PS8 require protocol
fixture coverage before provider probes. Live proof must show a verified first turn, a public
follow-up on the same native session and PID, a second independent verification, then confirmed
kill/reap. Native resume/fork probes follow only after persisted references and worktree-coherence
checks are green.
