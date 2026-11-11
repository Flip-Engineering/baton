# Qualification recorder disk-full repair

## Observed failure

The native hierarchy qualification at `839e3bd2` failed after disk-full errors.
OMP reported session persistence errors with `ENOSPC`. Retained native stdout
ended before later persisted native completions; terminal frames and completion
receipts were incomplete. The controlled tests below reproduce forwarding loss
from capture-write `ENOSPC` in the original driver. [Issue #651](https://github.com/Flip-Engineering/baton/issues/651)
records this recorder defect.

The failed run retains its database snapshot, native conversation files, partial
streams and useful DeepSeek and Muse commits. Its closure status remains
`failed`. Independent inspection verified owned process absence. The DeepSeek,
Muse and final Kimi wrapper and child exit codes and completion times remain
unknown. The host failure report and process closure do not establish native
Principal completion or checked landings.

## Repair

The repair was committed at `434ff901` and consolidated at `2a3581cd` in
[accept-kimi-hierarchy.py](../../bend2/scripts/accept-kimi-hierarchy.py).
`native_wrapper` handles local capture and process-receipt write errors, marks
recording incomplete and continues forwarding actual child stdout. It waits for
the child's natural completion. An incomplete recording makes the wrapper and
qualification fail even when the child exits successfully. Receipt updates remain
best effort when storage is unavailable.

The initial process receipt is written before child launch. If that write fails,
the wrapper starts no child. `successful_receipts` requires complete recording
and successful wrapper and child completion.

## Controlled evidence

The final retained provider-free execution of
[NativeRecording and HierarchyHistory](../../bend2/test/accept-kimi-hierarchy.py)
passed 12 tests. A real Python child waits for stdin handshakes triggered by
forwarded stdout frames before emitting its terminal frame. Controlled
frame-capture, event-capture and post-launch
process-receipt failures preserve all three stdout frames and natural child
exit zero, while qualification is refused. The prelaunch receipt failure case
verifies that no child starts.

The same recording fixture against the original `839e3bd2` driver failed all
three post-launch cases with `ENOSPC`. Its prelaunch refusal case passed. This
negative control executed two test methods with three failing subcases.

The retained receipts are identified below. Raw native streams and private logs
remain local.

| Receipt | SHA-256 |
| --- | --- |
| `verified-helper-tests.process.json` | `4c29feda2f047bb9f4427ef0945a26d9cfaa32360ac822183572356e3462ad4a` |
| `baseline-enospc-negative-control.process.json` | `b0a3fc7aa6532c47ea449c20411a472ccb30f344045a180dbb6d4e0d8a04d9c0` |
| `independentfailure-review-v2.json` | `1b4606dec6204f474def1227e049a5ee4d5a39d1ad3d197d8dd95e340d8610eb` |
| `failure-closure.json` | `816b08eeab251131dbcee1253a73028fdc5e7fecf213fac912e78a6e6921f11b` |

## Acceptance boundary

This evidence covers qualification recording and failed-run closure. Provider
session persistence, native receive supervision, keeper loss and host restart
require their own measurements. The failed hierarchy remains failed; fresh
native qualification and exact-tree build, law checks and native checks remain
separate acceptance gates.
