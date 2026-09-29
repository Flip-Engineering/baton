# Read-only audit of 0dcea66e, attempt-bound retained process controls (bend2-git11)

Swarm contribution: seq 428460, swarm-bend2-20260924 (contribution-b08cddef42b2e868cc83eecd3622d9ef).
Read-only from the Git object. No build, test or broad gate. Retained extraction: `.scratch/review-0dcea66e`.

## Scope

`0dcea66e` "Add attempt-bound retained process controls". Parent is `08ee671b`, not the published `4676778a`, so it is a branch cut from the earlier ref. Own change, four files:

| File | Change |
|---|---|
| `bend2/src/host/process-spawn.c` | +212 |
| `bend2/src/host/process.bend` | +9 (two effect defs) |
| `bend2/test/process.bend` | +153 (test CLI modes) |
| `bend2/test/retained-control.py` | +378 (six tests) |

`ProcessChild.control_write` / `control_signal` are called only from `bend2/test/process.bend`; no coordinator module calls them and no law names them. The commit adds host primitives plus their tests; production wiring is separate.

## Verified sound

- **Attempt-bound ownership.** Every control frame carries the attempt directory NUL-terminated inside `frame.length`, `strcmp`-checked against `keeper->directory` (`realpath`). ATTACH with a client already present is EBUSY; a wrong directory is EINVAL. Previously any connection became the observer or got EBUSY with no identity check, so a copied manifest could reach another attempt's socket. Test `test_copied_manifest_cannot_control_original_attempt` proves the refusal and that a symlink alias is accepted (both sides realpath).
- **Group-scoped signals.** `br_spawn` passes `POSIX_SPAWN_SETPGROUP` with pgroup 0, so the native is its own group leader; `kill(-native_pid, sig)` targets exactly the attempt's group. Test 5 proves both the native and a forked group child receive SIGUSR1, post-exit signal is ESRCH, post-exit write is refused, and the lock stays held until the controlled completion.
- **PID reservation closes the reuse race.** The native waiter observes the exit with `waitid(...,WEXITED|WNOWAIT)` and does not reap. In the keeper's wake arm the order is: `waitpid` reaps the native, then `keeper->status` and `keeper->exited` are set, then the `status` file is written, then `BR_EXIT` is sent — all in one single-threaded loop iteration, so no control frame is processed between the reap and `exited=1`. An unreaped zombie holds its pgid, so a group signal cannot fall through to a recycled group. Test 6 compiles a C probe against the generated `process-spawn.c` and asserts WNOWAIT → waitpid(17) → ECHILD.
- **Framing under concurrent writers.** All writes share one `keeper->writes` FIFO; each buffer completes before the next; a control write carries a `control` pointer so its reply is deferred to the flush. Test 1 runs one 40 KB observer frame and two 80 KB control frames concurrently and checks byte count and sha256 per frame.
- **Backpressure.** `BR_WRITE` and `BR_CONTROL_WRITE` answer EPIPE at once when `input_closed || exited`. Test 2 proves the refusal with the native's bytes unchanged.
- **Invalid input preserves ownership.** Test 4 sends four malformed frames; each gets a serial-correct error and the observer stays attached.
- **Cleanup.** A control is freed only when `socket < 0 && !pending`; ATTACH moves the socket into `keeper->client` and clears the control's, so no double close; the reply is written before close, so the client sees one 32-byte frame then EOF; the poll arrays are sized and filled from the same list after cleanup.

## Findings

**F1 (corrected; observed in an isolated fixture, not source reasoning).** Retracted: I withdraw the earlier suggestion of a control cap or an idle timeout, which would be a fixed count or time cutoff and is prohibited. Measured behaviour, provider-free fixture, only the fixture child's own `RLIMIT_NOFILE` lowered to 64, no host limit touched, binary built from `0dcea66e`: 120 held control connections opened; the keeper process then gone; observer exit 32 (EPIPE) with `Broken pipe` on stderr; the native still alive and orphaned; the attempt holds no `status`, no `keeper-error`, no `observer-error`, and an empty `keeper.log`; `lock-try` returns `acquired`, so the session lock was released while the native survives; a later control request gets ECONNREFUSED. So the consequence of exhausting descriptors on accept is keeper death with the uncovered lock-released-while-native-survives shape. Honest framing: this is a constructed probe with a lowered limit, an input no real run produces, and per the project rule a constructed probe does not by itself justify a mechanism. Recorded for the root to judge and to file; I propose no mechanism.

**F2.** `keeper.directory` (`realpath`) is never freed, including on `br_keeper` error paths. Lifetime allocation in a per-attempt process.

**F3.** The identity comparison uses the realpath while `br_keeper`'s file writes and `br_manifest_read` use the raw `directory` argument. Same directory in practice.

**F4.** The per-control incoming buffer grows only with bytes the sender delivers (`size > complete` closes); same property as `br_read_commands`. Not a new exposure.

## Limits

No compile and no test run, so the suite's green result is the author's claim. The WNOWAIT argument rests on the POSIX guarantee that an unreaped child keeps its pid and process group; the compiled probe is designed to demonstrate that on this host.
