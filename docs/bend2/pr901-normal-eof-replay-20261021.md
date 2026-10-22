# PR901 normal-EOF replay failure, 2026-10-21

This record preserves the qualification evidence for the required
46,123,112-byte normal-EOF replay and the canonical combined build.

## Source and build identity

- Combined branch: `codex/pr869-pr901-current-main-integration-20261021`
- Combined head: `942b6075c437b0eea831350a4e15f75f30a3b9df`
- Combined tree: `b8719c5af625ac2919ce15e846da952c5551aa9d`
- Base: `c021089a622ccd278443cad3296c2328500c3fd8`
- Compiler: `bend 2.0.25`, release
  `2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019`
- C compiler: `/usr/bin/clang-19`, Ubuntu clang 19.1.1
- Build manifest:
  `.scratch/pr869-pr901-942b6075c/build-manifest.txt`

Canonical compile-queue keys and artifacts:

| Step | Key | Artifact |
| --- | --- | --- |
| recovery C generation | `bdcf222c2cd6fa5ffae18089036779bb33caaa15e821da31ce6f89f357d9d4af` | `observer-recovery.c`, sha256 `a10fa6601b742ede55460c181e568af78d0e750ff90a32e29c23cd17dafa6939` |
| fixture C generation | `d72ba99f0624259909a961f417bbe714a734b628bffe84e5787cd5c6de3882db` | `monitor-fixture.c`, sha256 `6be85be25b8de1b54a4998203c758bec8c9267d60a6b9a5e51948d608473e322` |
| recovery C compile | `67ade17670941d9173f4ba37e7870dc6a37da80effb75d8fe943e031d5d545c1` | `observer-recovery`, 8,199,248 bytes, sha256 `ba9dd3f52615a34b8b3a7f4aa1333bedd4f562427356519ea1ce018cc9e769c6` |
| fixture C compile | `3fa6031ad7495b095a8c61e5e9fcca6f62dfdfaed4bb52a92b6c31198d14c8c3` | `monitor-fixture`, 1,421,536 bytes, sha256 `9703c04c449e669898957e2d5c4dd992a8e6d71cfd6a2d764044b1f3779c9c55` |

The recovery and fixture compile results record `verified=1`, `status=completed`
and `exit=0`. Check-only returned `status=0` for
`bend2/src/coordinator/main.bend`, `bend2/test/monitor-fixture.bend` and
`bend2/test/observer-recovery-entry.bend`.

## Spool fixture

- Path:
  `/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/recovery-output-fixture-20261018/stdout.bin`
- Size: 46,123,112 bytes
- sha256: `87020b044a82014a8a4ef8166249be7a6012986f8f232c3868887f09bb521772`
- 260,199 newline-terminated lines.
- The final 687 bytes start at offset 46,122,425 and are NUL bytes without a
  trailing newline.
- The largest line is 999,176 bytes at offset 15,116,967 and starts with
  `{"type":"agent_end",...}`.

## Required replay result

Command, run from the combined worktree with the canonical binaries:

```sh
KEEP_OBSERVER_FIXTURE=1 python3 \
  .scratch/pr901-proof/run-spool-proof.py \
  --root /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/pr869-current-main-integration-20261020 \
  --fixture /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/pr869-current-main-integration-20261020/.scratch/pr869-pr901-942b6075c/monitor-fixture \
  --coordinator /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/pr869-current-main-integration-20261020/.scratch/pr869-pr901-942b6075c/observer-recovery \
  --spool /mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/recovery-output-fixture-20261018/stdout.bin \
  --receipt .scratch/pr901-proof/proof-receipt.json \
  --stdout .scratch/pr901-proof/proof.stdout \
  --stderr .scratch/pr901-proof/proof.stderr
```

The test failed after 0.843 seconds. The test assertion was:

```text
AssertionError: 13598 != 46123112 : normal EOF did not commit the final spool cursor
```

Observed recovery process:

- Return code: 1
- stderr: `Operation not permitted`
- stdout: empty
- Last observed `rchar`: 629,375
- Last observed `syscr`: 652
- `read_bytes`: 0
- `wchar`: 256
- `syscw`: 22
- Final checkpoint offset: 13,598
- Final custody offset: 13,598

The preserved attempt directory contains
`attempt/checkpoint-error` with
`state rejected by the observer; replaying from the beginning`.
The checkpoint state is `output: 13598`, `output_done: false`,
`terminal: ""`.

## Full observer-monitor suite

The combined worktree ran:

```sh
python3 bend2/test/observer-monitor.py -v
```

Result: 10 tests, 8 failures, 2 errors, 228.800 seconds, exit 1.
The log is `.scratch/pr869-pr901-942b6075c/tests.stderr`.

Required test failure:
`test_protected_spool_replays_to_normal_eof_with_unknown_monitor_custody`
reported `13598 != 46123112`.

Other failures on the same build:

- `test_spanned_agent_end_monitor_keeps_unknown_custody`: recovery stderr
  contained `Operation not permitted`.
- `test_unknown_status_monitor_advances_once_and_keeps_owed_input`: cursor
  not persisted; recovery exited with status `-9`.
- `test_codex_large_assistant_frame_stays_spanned_through_report`:
  checkpoint offset `0 != 8388608`.
- `test_codex_large_failed_terminal_replaces_legacy_checkpoint`: checkpoint
  `codex_log` held a span token instead of the legacy assistant value.
- `test_codex_large_failed_terminal_stays_spanned_through_report`:
  checkpoint offset `0 != 8388608`.
- `test_concurrent_observers_advance_the_cursor_once`: checkpoint offset
  `0 != 13`.
- `test_fframes_absent_native_partial_output_preserves_unknown_custody`:
  checkpoint offset `0 != 36`.
- `test_quiet_spool_awake_span_wakes_for_delayed_stdout`: recovery timed out
  after 30 seconds.
- `test_refused_resume_text_stays_an_incomplete_observation`: recovery timed
  out after 60 seconds.

## Direct recovery reproduction

Running the canonical recovery against the preserved attempt:

```sh
observer-recovery --recover-observer <attempt>/state.db parent <observer>
```

returned 1 and printed `Operation not permitted` in 0.2 seconds. No spool
`pread64` occurred before the failure.

`strace` recorded a `flock` on the session lock file returning `EAGAIN`
immediately before the `EPERM` exit. `gdb` stopped at `io_fail` with code 1
from `baton_process_pack`; `baton_process_acknowledge_run` was reached.

The direct cause is the monitor-only guard in
`bend2/src/host/process-spawn.c::baton_process_call`:

```c
if(retained->observer_only &&
   (call->kind==BP_WRITE || call->kind==BP_CLOSE || call->kind==BP_SIGNAL ||
    call->kind==BP_RELEASE || call->kind==BP_ACK ||
    call->kind==BP_INSTANCE_START || call->kind==BP_INSTANCE_CANCEL ||
    call->kind==BP_INSTANCE_COMMIT || call->kind==BP_INSTANCE_REPLAY)) {
  call->error=EPERM;return;
}
```

The guard includes `BP_INSTANCE_REPLAY`. Follow-up runtime tracing of the
canonical binary recorded `BP_OBSERVER_RECOVERY`, `BP_INSTANCE_STATE`,
`BP_INSTANCE_INPUT_WITNESS`, `BP_ACK` and `BP_INSTANCE_RETIRE`. No
`BP_INSTANCE_REPLAY` or `BP_READ_SPAN` call occurred. The recovery skipped
retained output in the gone-native branch. The direct `EPERM` is the host
refusal of `BP_ACK` and `BP_INSTANCE_RETIRE` for the monitor-only handle. The
earlier `BP_INSTANCE_REPLAY` attribution was not observed in that run.

## Historic and auxiliary evidence

Historic public `f65d3dd785fb7d56a40bb64271a7f65f52c6de30` evidence: the
46,123,112-byte replay timed out at 900 seconds after 5.34 GB of reads and
about 5.47 MB of spool progress. `f65d3dd78` lacks the `messages_pending`
partial index. Commit `a5f6f66de` (issue #943) adds that index on current
main.

A retained 14,793,221-byte normal-EOF replay passed in 717.232 seconds with
6,688,000,000 `rchar` bytes, 2,199,701 `syscr` and a mid-run cursor of
7,970,000 bytes. The receipt is
`retained/pr949-focused-qualified-20261019/tmp/pr949-spool-14m-eof-receipt.json`.
That test used a different fixture, database and recovery binary, so linear
scaling to 46,123,112 bytes is an estimate.

## Limits

The required 46,123,112-byte replay did not reach normal EOF on the combined
build. No source fix was applied. The failure occurs before the large terminal
frame is reached. The gone-native branch skipped retained output, and the
monitor-only handle then failed its `BP_ACK` and `BP_INSTANCE_RETIRE` host
calls with `EPERM`. The session-lock `EAGAIN` observation is recorded and is
not the terminating operation. The historic f65 timeout and the current early
failure have different observable causes.
