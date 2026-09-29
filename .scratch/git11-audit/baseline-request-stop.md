# Baseline for the coordinator request/stop review (bend2-git11)

Read-only, at the published `4676778a64ca1c8652f7f8c743bd007502292b30`. Prepared ahead of the
composed tip the root will send. No contribution published for this: it is reconnaissance, not a
finding.

## Stop side: nothing exists yet

A qualified search for `"stop"`, `"cancel"`, `"reply"` and `"interrupt"` across every
`bend2/src/coordinator/*.bend` returns zero hits. The command surface has no stop or cancel verb,
which matches issue #639 (missing session stop/cancel) and the corrected `target-architecture`
claim that killing a receive observer is not an operator stop procedure.

So the upcoming work introduces the first stop path. Review questions for the candidate:

1. Which verb carries it, and does it reach the keeper's `control_signal`, which signals
   `kill(-native_pid, sig)` — the native's own process group, since `br_spawn` sets
   `POSIX_SPAWN_SETPGROUP` with pgroup 0?
2. Does it preserve native and output ownership: the status file, `BR_EXIT`, the release and the
   acknowledgement that the keeper owns?
3. At the moment of a resource refusal, does it follow an actual refusal and the descriptor-close
   events the runtime already has, with no arbitrary cutoff and no new framework?

## Request side: the existing callers

`Root.after` (coordinator/root.bend) dispatches `Report`, `Ask`, and `Message` to `deliver`, and
`Observe` with a terminal event to `deliver` with the terminal condition. `deliver` reads the
recipient's endpoint argv from the store and runs it through `Process.run`, so the writer waits on
the process it spawned; a non-zero exit or a spawn failure answers a failure naming the log and the
pending inbox.

Laws already over that path, in coordinator/laws.bend:

| Law | Subject |
|---|---|
| `m13_report_invokes_the_registered_endpoint` | `Root.after(C.Report{...}) == Root.deliver(...)` |
| `m13_ask_invokes_the_registered_endpoint` | `Root.after(C.Ask{...}) == Root.deliver(...)` |
| `m13_message_invokes_the_registered_endpoint` | `Root.after(C.Message{...}) == Root.deliver(...)` |
| `m13_terminal_event_invokes_the_registered_endpoint` | `Root.after(C.Observe{...}) == Root.deliver(db,id,C.terminal(event),saved)` |
| `m12_no_delivery_owes_no_wait` | a command owing no delivery answers from its own committed result |
| `m12_absent_receiver_answers_at_once` | no registered endpoint answers at once |

`Ask` is stored as kind `question` with the recipient taken from the sender's recorded parent
(commands.bend). Guidance is a `message` of kind `guidance`; the OMP supervisor injects it as
`steer` frames under the M-13 frame laws (`m13_every_frame_is_a_boundary_for_a_reading_harness`,
`m13_omp_text_update_is_not_a_guidance_boundary`, `m13_omp_terminal_event_is_a_guidance_boundary`).

## What the new keeper controls change

`control_write` writes into the retained native's stdin **without replacing its observer**;
`control_signal` signals the retained group. Together they are the primitives a production request
(retained OMP native reply) and a production stop would use. At `0dcea66e` both are called only
from `bend2/test/process.bend`, so the candidate is where the production callers appear.

## Coverage-header watch item for the candidate

The same class of item I recorded for `4676778a`: `coordinator/laws.bend`'s per-entry rows claim to
name the functions the module and its imports are stated over, so new request/stop callers and any
new laws must appear in the M-13 and M-8 rows (and the M-10/M-17 rows still owe the `4676778a`
additions, which the root deferred to the #639/#641 slice). Check the header against the laws in
the candidate.
