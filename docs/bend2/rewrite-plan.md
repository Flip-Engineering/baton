# Bend2 implementation plan

[MANDATE.md](MANDATE.md) defines the goal and
[target-architecture.md](target-architecture.md) defines the first design.
The implementation starts from `cf28f0cf`, with the new design applied, and
excludes the rejected parity work at `7b0a6dfc`.

## Requested seats

The root recruits these two implementation seats. The design lead implements
the coordinator and composes the working slice.

| Seat | Scope | First result |
|---|---|---|
| `bend2-native1` | `bend2/src/harness/`, `bend2/src/host/process.*`, corresponding tests and minimal native harness extension | One real subscription worker starts and resumes; its report starts a turn in the attached root's native UI. Return exact native session and delivery evidence. |
| `bend2-git1` | `bend2/src/git/`, corresponding tests | Create a branch and worktree, prepare a committed worker change for landing, compare selected test failures with the target, and advance the target safely. Exercise a conflict and a target move. |
| `bend2-architect2` | Coordinator, persistence binding, command client, build entry point, design and integration | Connect recruitment, reports, parent wake and landing in one native executable. Run the assembled slice. |

Implementation seats agree on the smallest typed calls required by the working
slice. Cross-module values name session IDs, message IDs, workspaces, commit IDs
and observed outcomes. Propose interface changes immediately when implementation
finds a simpler form. Keep application decisions in Bend2 and host calls in
small C bindings.

## First slice

1. Verify the installed toolchain and native harness interfaces. The native seat
   first demonstrates unsolicited delivery into an existing root session. Select
   the first root/worker harness pair from those actually available on subscription
   login and record the pair. Claude Code, Codex and OMP each need their own live
   attachment exercise as support is added.
2. Build the coordinator with transactional worker and message records. Connect
   `attach`, `recruit`, `guide`, `report`, `status` and `stop` to the first adapter.
   Deliver automatic turn-end output to the parent, including a failed worker turn.
3. Recruit a real worker to make a useful repository improvement with a behavioral
   check. Receive its full report in the native root session, inspect its change,
   and invoke `land`. Observe the resulting target commit and run the check there.
4. Restart the service with a report awaiting delivery and verify delivery after
   reconnection. Verify that a failed worker leaves its dirty work available and
   that repeating a landing request retains one result.

The root's evidence includes the executable invocation, selected and observed
routes, native session identifiers, delivered report ID, worker commit, target
before and after, and check output. Record evidence from the run as a contribution;
these observations create no ongoing bookkeeping requirement.

## Verification and continued use

Provide a native build command and a small integration command for the new
runtime. Run production host effects in the native executable. Test libraries
through dedicated entry points. The existing `run-checks.mjs` command exercises
the earlier probes and is optional reference verification.

After the first slice, use Baton to implement another real task. Add the remaining
harness attachments and address failures observed in that use. Evaluate usability
by whether the root can recruit, guide, receive questions and reports, and land
work from its native session without manual recovery of lost work or messages.
