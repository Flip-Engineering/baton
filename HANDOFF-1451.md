# Handoff for #1451

Branch `fix/1451-native-check-dsh-20261105`. Work tree on the homelab: `/mnt/nvme4tb/agent-scratch/baton-laws/repo`. Helper scripts are in `/mnt/nvme4tb/agent-scratch/baton-laws/`.

## Done

Three commits on top of main `01240f4f2`:

1. `a05e063d8` fixes #1454. `rr_refusal_description` returns an empty description for an event that is not valid JSON, so the observer no longer exits with `malformed JSON` when a native ends by signal. `bend2/test/refusal-recovery-focused.bend` adds cases for an empty event, a plain-text event, and a running attempt that ends without an event. The fixture passed on this branch on 2026-11-05.
2. `35639df15` repairs the two DSH cases in `bend2/test/stop.py`. It links a `dsh` fixture, waits for the native identity before reading, asserts every fixture patch matches, and waits for the parent read of the stop report.
3. `291b960e2` is the `package-licenses.py` fix from draft PR #1437, cherry-picked with `-x`.

## Interrupted

None of these have a result:

- the baton2 build;
- the two `stop.py` DSH cases;
- the `laws.bend` check;
- the PR;
- the #1451 update comment.

## Resume

From `/mnt/nvme4tb/agent-scratch/baton-laws/`:

```sh
# baton2 build through the compile queue (priority 10)
./build-entry.sh > baton2.log 2>&1

# the two DSH cases
cd repo && TMPDIR=/mnt/nvme4tb/agent-scratch/baton-laws/tmp \
  BATON2_EXE=$PWD/.scratch/bend2/baton2 \
  python3 bend2/test/stop.py -v \
  Stop.test_retained_dsh_stop_preserves_work_and_exits_native_and_tool \
  Stop.test_explicit_force_reconciles_dsh_attempt_after_observer_loss

# laws.bend check
cd repo && ulimit -s unlimited && BATON2_COMPILE_QUEUE_PRIORITY=10 \
  BEND=/var/tmp/baton2-compile-queue/toolchains/compiler-term-compare-1447-20261105/bend-2.0.25/bin/bend \
  BEND_NO_TELEMETRY=1 BUN_JSC_maxPerThreadStackUsage=67108864 \
  sh bend2/scripts/check-entry.sh bend2/src/coordinator/laws.bend

# PR, once the cases and the laws check pass
gh pr create --repo Flip-Engineering/baton --base main --head fix/1451-native-check-dsh-20261105 \
  --title "Fix the stop.py DSH cases and deliver reports after a native ends by signal" \
  --body "Fixes #1451. Fixes #1454. Includes the commit from #1437."
```

Remove this file before the PR merges. For the #1451 update, list the four causes from the commit messages. The fourth cause is #1454.

## Open scope beyond #1451

- `bend2/scripts/check-native-parallel.py` runs every `bend2/test/*.py` file without per-suite environment. About 20 suites read a `BATON2_*` fixture variable that `check-native.sh` does not set in that step, for example `BATON2_DRAIN_SWEEP_EXE`, `BATON2_DSH_WORKER_NATIVE_EXE` and `BATON2_COMPILE_QUEUE_BIN`. Two suites, `check-schema-maintenance.py` and `check-message-read-index-native.py`, require command-line arguments. Several suites need focused binaries that the step does not copy into its seed. This step fails until it is given that environment or a selection.
- #1445: 87 of 111 `receive.py` tests fail. That suite runs in the same parallel step.
- `complete-native` has not passed on main in the last 40 runs. Further steps after `stop.py` have not been run on this branch.
