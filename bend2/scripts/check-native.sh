#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
if python3 --version 2>/dev/null; then
  PYTHON3=python3
else
  PYTHON3=/usr/bin/python3
fi
"$PYTHON3" bend2/test/queue-native-checks.py
"$PYTHON3" bend2/test/bootstrap-compile-queue-cancel.py
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
. "$root/bend2/scripts/queue-entry.sh"
(
  ulimit -s unlimited 2>/dev/null || true
  if [ -n "${BATON2_NATIVE_QUEUE_DRIVER:-}" ]; then
    BEND_NO_TELEMETRY=1 BUN_JSC_maxPerThreadStackUsage="${BUN_JSC_maxPerThreadStackUsage:-67108864}" \
      "$PYTHON3" "$BATON2_NATIVE_QUEUE_DRIVER" compiler bend \
      bend2/src/coordinator/laws.bend --check-only
  else
    BEND_NO_TELEMETRY=1 BUN_JSC_maxPerThreadStackUsage="${BUN_JSC_maxPerThreadStackUsage:-67108864}" \
      "$compiler" bend2/src/coordinator/laws.bend --check-only
  fi
)
sh bend2/scripts/build-native.sh
sh bend2/scripts/build-native.sh bend2/test/stop-hook-entry.bend .scratch/bend2/stop-hook-entry
"$PYTHON3" bend2/test/sqlite-read-reuse.py
BATON2_EXE="$root/.scratch/bend2/baton2" "$PYTHON3" bend2/test/stop.py \
  Stop.test_retained_dsh_stop_preserves_work_and_exits_native_and_tool \
  Stop.test_explicit_force_reconciles_dsh_attempt_after_observer_loss
"$PYTHON3" bend2/test/package-receiver-layout.py
"$PYTHON3" bend2/test/omp-completion-extension.py
"$PYTHON3" bend2/test/package-licenses.py
"$PYTHON3" bend2/test/record-native-checks.py
sh bend2/test/bend-launch-guard.sh
sh bend2/scripts/build-native.sh bend2/test/process.bend .scratch/bend2/process-test
"$PYTHON3" bend2/test/custody-adopt.py
"$PYTHON3" bend2/test/start-gate.py
"$PYTHON3" bend2/test/observer-monitor.py
sh bend2/scripts/build-native.sh bend2/test/instance.bend .scratch/bend2/instance-test
sh bend2/scripts/build-native.sh bend2/tests/git.bend .scratch/bend2/git-test
.scratch/bend2/git-test
sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
.scratch/bend2/land-test
sh bend2/scripts/build-native.sh bend2/tests/storage.bend .scratch/bend2/storage-test
case "$(uname -s)" in
  Linux)
    # The reference-scan and Cargo fixtures read the Linux proc filesystem and
    # Linux mount identity. Other platforms keep the production
    # unknown:non-linux answer, which preserves every candidate.
    BATON2_STORAGE_TEST="$root/.scratch/bend2/storage-test" "$PYTHON3" bend2/test/storage-process-refs.py
    ;;
  *)
    echo "storage reference fixtures run on Linux only; running the native storage checks" >&2
    .scratch/bend2/storage-test
    ;;
esac
sh bend2/scripts/build-native.sh bend2/tests/storage-cargo.bend .scratch/bend2/storage-cargo-test
case "$(uname -s)" in
  Linux)
    BATON2_STORAGE_CARGO_TEST="$root/.scratch/bend2/storage-cargo-test" \
    BATON2_TEST_CARGO="${BATON2_TEST_CARGO:-$(command -v cargo || printf '%s/.cargo/bin/cargo' "$HOME")}" \
    BATON2_TEST_RUSTC="${BATON2_TEST_RUSTC:-$(command -v rustc || printf '%s/.cargo/bin/rustc' "$HOME")}" \
    "$PYTHON3" bend2/test/storage-cargo.py
    ;;
  *)
    echo "Cargo release fixture runs on Linux only; Darwin validation not performed here" >&2
    ;;
esac
sh bend2/scripts/build-native.sh bend2/src/coordinator/storage-focused.bend .scratch/bend2/storage-focused
if .scratch/bend2/storage-focused > /dev/null 2>&1; then
  echo "storage-focused accepted no arguments" >&2
  exit 1
fi
"$PYTHON3" bend2/test/stage-storage-clean.py
sh bend2/scripts/build-native.sh bend2/test/subscription-profiles.bend .scratch/bend2/subscription-profiles-test
.scratch/bend2/subscription-profiles-test
sh bend2/scripts/build-native.sh bend2/test/focused-reads.bend .scratch/bend2/focused-reads
BATON2_EXE="$root/.scratch/bend2/focused-reads" "$PYTHON3" bend2/test/observed-usage.py
BATON2_EXE="$root/.scratch/bend2/focused-reads" "$PYTHON3" bend2/test/harness-inventory.py
sh bend2/scripts/build-native.sh bend2/test/knowledge-behavior.bend .scratch/bend2/knowledge-behavior-test
BATON2_EXE="$root/.scratch/bend2/knowledge-behavior-test" "$PYTHON3" bend2/test/knowledge-behavior.py
sh bend2/scripts/build-native.sh bend2/harness/api-key-exec.bend .scratch/bend2/api-key-exec
sh bend2/scripts/build-native.sh bend2/test/api-key-spec.bend .scratch/bend2/api-key-spec
BATON2_API_KEY_SPEC="$root/.scratch/bend2/api-key-spec" "$PYTHON3" bend2/test/api-key-spec.py
sh bend2/scripts/build-native.sh bend2/test/account-credits-entry.bend .scratch/bend2/account-credits-entry
BATON2_ACCOUNT_ENTRY="$root/.scratch/bend2/account-credits-entry" "$PYTHON3" bend2/test/account-credits-focused.py
sh bend2/scripts/build-native.sh bend2/harness/claude-credit-observe.bend .scratch/bend2/claude-credit-observe
BATON2_CREDIT_OBSERVE="$root/.scratch/bend2/claude-credit-observe" "$PYTHON3" bend2/test/claude-credit-observe.py
sh bend2/scripts/build-native.sh bend2/harness/usage-read.bend .scratch/bend2/usage-read
"$PYTHON3" bend2/test/usage-read-codex.py "$root/.scratch/bend2/usage-read"
BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" BATON2_CREDIT_OBSERVE="$root/.scratch/bend2/claude-credit-observe" BATON2_USAGE_READ="$root/.scratch/bend2/usage-read" "$PYTHON3" bend2/test/native-helper-install.py
sh bend2/scripts/build-native.sh bend2/test/zai-quota.bend .scratch/bend2/zai-quota-test
.scratch/bend2/zai-quota-test
sh bend2/scripts/build-native.sh bend2/test/codex-rate-limits.bend .scratch/bend2/codex-rate-limits-test
.scratch/bend2/codex-rate-limits-test
sh bend2/scripts/build-native.sh bend2/test/usage-windows-store.bend .scratch/bend2/usage-windows-store-test
rm -f .scratch/bend2/usage-windows-store.db
.scratch/bend2/usage-windows-store-test .scratch/bend2/usage-windows-store.db
sh bend2/scripts/build-native.sh bend2/test/usage-hold-error-text.bend .scratch/bend2/usage-hold-error-text-test
rm -f .scratch/bend2/usage-hold-error-text.db
.scratch/bend2/usage-hold-error-text-test .scratch/bend2/usage-hold-error-text.db
sh bend2/scripts/build-native.sh bend2/test/usage-live-reads.bend .scratch/bend2/usage-live-reads-test
rm -f .scratch/bend2/usage-live-reads.db .scratch/bend2/usage-live-reads.db.answer
.scratch/bend2/usage-live-reads-test .scratch/bend2/usage-live-reads.db bend2/test/fake-usage-read
sh bend2/scripts/build-native.sh bend2/test/clear-stop-quota.bend .scratch/bend2/clear-stop-quota-test
clear_stop_quota_db=$(mktemp "$root/.scratch/bend2/clear-stop-quota.XXXXXXXX")
rm -f "$clear_stop_quota_db"
(
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '
    clear_stop_quota_test_status=$?
    trap - EXIT
    clear_stop_quota_shutdown_status=0
    .scratch/bend2/clear-stop-quota-test --instance-shutdown "$clear_stop_quota_db" || clear_stop_quota_shutdown_status=$?
    if [ "$clear_stop_quota_shutdown_status" -ne 0 ]; then
      printf "clear-stop-quota owner shutdown failed (exit %s) for %s\n" "$clear_stop_quota_shutdown_status" "$clear_stop_quota_db" >&2
    fi
    if [ "$clear_stop_quota_test_status" -ne 0 ]; then
      exit "$clear_stop_quota_test_status"
    fi
    exit "$clear_stop_quota_shutdown_status"
  ' EXIT
  .scratch/bend2/clear-stop-quota-test "$clear_stop_quota_db"
)
sh bend2/scripts/build-native.sh bend2/test/quota-backoff-dedupe.bend .scratch/bend2/quota-backoff-dedupe-test
quota_backoff_db=$(mktemp "$root/.scratch/bend2/quota-backoff-dedupe.XXXXXXXX")
rm -f "$quota_backoff_db"
(
  trap 'exit 129' HUP
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap '
    quota_backoff_test_status=$?
    trap - EXIT
    quota_backoff_shutdown_status=0
    .scratch/bend2/quota-backoff-dedupe-test --instance-shutdown "$quota_backoff_db" || quota_backoff_shutdown_status=$?
    if [ "$quota_backoff_shutdown_status" -ne 0 ]; then
      printf "quota-backoff-dedupe owner shutdown failed (exit %s) for %s\n" "$quota_backoff_shutdown_status" "$quota_backoff_db" >&2
    fi
    if [ "$quota_backoff_test_status" -ne 0 ]; then
      exit "$quota_backoff_test_status"
    fi
    exit "$quota_backoff_shutdown_status"
  ' EXIT
  .scratch/bend2/quota-backoff-dedupe-test "$quota_backoff_db"
)
sh bend2/scripts/build-native.sh bend2/test/usage-windows-wake.bend .scratch/bend2/usage-windows-wake-test
rm -f .scratch/bend2/usage-windows-wake.db
.scratch/bend2/usage-windows-wake-test .scratch/bend2/usage-windows-wake.db bend2/test/fake-wake-marker
sh bend2/scripts/build-native.sh bend2/test/usage-windows-wake-path.bend .scratch/bend2/usage-windows-wake-path-test
rm -f .scratch/bend2/usage-windows-wake-path.db
.scratch/bend2/usage-windows-wake-path-test .scratch/bend2/usage-windows-wake-path.db
sh bend2/scripts/build-native.sh bend2/test/route-change-identity.bend .scratch/bend2/route-change-identity-test
rm -f .scratch/bend2/route-change-identity.db
.scratch/bend2/route-change-identity-test .scratch/bend2/route-change-identity.db
sh bend2/scripts/build-native.sh bend2/test/quota-exhaustion-reset.bend .scratch/bend2/quota-exhaustion-reset-test
rm -f .scratch/bend2/quota-exhaustion-reset.db
.scratch/bend2/quota-exhaustion-reset-test .scratch/bend2/quota-exhaustion-reset.db
sh bend2/scripts/build-native.sh bend2/test/stop-dsh.bend .scratch/bend2/stop-dsh-test
BATON2_STOP_DSH_FIXTURE="$root/.scratch/bend2/stop-dsh-test" "$PYTHON3" bend2/test/stop-dsh.py
BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" "$PYTHON3" bend2/scripts/check-native-parallel.py "$PYTHON3"
sh bend2/scripts/build-native.sh bend2/test/omp-home-preflight.bend .scratch/bend2/omp-home-preflight-test
BATON2_EXE="$root/.scratch/bend2/omp-home-preflight-test" "$PYTHON3" bend2/test/omp-home-preflight.py
sh bend2/scripts/build-native.sh bend2/test/launch-store.bend .scratch/bend2/launch-store-test
BATON2_EXE="$root/.scratch/bend2/launch-store-test" "$PYTHON3" bend2/test/launch-store.py
sh bend2/scripts/build-native.sh bend2/test/launch-store-retained.bend .scratch/bend2/launch-store-retained-test
BATON2_EXE="$root/.scratch/bend2/launch-store-retained-test" "$PYTHON3" bend2/test/launch-store-retained.py
"$PYTHON3" bend2/test/native-dispatch-runtime.py
"$PYTHON3" bend2/test/check-install-dispatch-runtime.py
sh bend2/scripts/build-native.sh bend2/test/dsh-player.bend .scratch/bend2/dsh-player-test
BATON2_EXE="$root/.scratch/bend2/dsh-player-test" "$PYTHON3" bend2/test/dsh-player.py
# The canary and the hook test use the official dsh when DSH_CLI names it or dsh is on PATH.
BATON2_EXE="$root/.scratch/bend2/dsh-player-test" "$PYTHON3" bend2/test/dsh-canary.py
BATON2_EXE="$root/.scratch/bend2/dsh-player-test" "$PYTHON3" bend2/test/dsh-hooks.py
BATON2_STOP_HOOK_FIXTURE="$root/.scratch/bend2/stop-hook-entry" "$PYTHON3" bend2/test/stop-hook-entry.py
sh bend2/scripts/build-native.sh bend2/test/dsh-retained.bend .scratch/bend2/dsh-retained-test
BATON2_EXE="$root/.scratch/bend2/dsh-retained-test" "$PYTHON3" bend2/test/dsh-retained.py
"$PYTHON3" bend2/test/dsh-worker.py
sh bend2/scripts/build-native.sh bend2/test/dsh-turn.bend .scratch/bend2/dsh-turn-test
BATON2_EXE="$root/.scratch/bend2/dsh-turn-test" "$PYTHON3" bend2/test/dsh-turn.py
sh bend2/scripts/build-native.sh bend2/test/agy-player.bend .scratch/bend2/agy-player-test
BATON2_EXE="$root/.scratch/bend2/agy-player-test" "$PYTHON3" bend2/test/agy-player.py
sh bend2/scripts/build-native.sh bend2/test/agy-retained.bend .scratch/bend2/agy-retained-test
BATON2_EXE="$root/.scratch/bend2/agy-retained-test" "$PYTHON3" bend2/test/agy-retained.py
sh bend2/scripts/build-native.sh bend2/test/agy-turn.bend .scratch/bend2/agy-turn-test
BATON2_EXE="$root/.scratch/bend2/agy-turn-test" "$PYTHON3" bend2/test/agy-turn.py
sh bend2/scripts/build-native.sh bend2/test/account-retained.bend .scratch/bend2/account-retained-test
BATON2_EXE="$root/.scratch/bend2/account-retained-test" "$PYTHON3" bend2/test/account-retained.py
sh bend2/scripts/build-native.sh bend2/test/account-credits.bend .scratch/bend2/account-credits-test
.scratch/bend2/account-credits-test
sh bend2/scripts/build-native.sh bend2/test/account-binding-smoke.bend .scratch/bend2/account-binding-smoke
BATON2_ACCOUNT_BINDING_SMOKE="$root/.scratch/bend2/account-binding-smoke" BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" "$PYTHON3" bend2/test/account-binding-smoke.py
