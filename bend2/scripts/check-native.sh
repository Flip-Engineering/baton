#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
if python3 --version 2>/dev/null; then
  PYTHON3=python3
else
  PYTHON3=/usr/bin/python3
fi
sh bend2/scripts/build-native.sh
"$PYTHON3" bend2/test/package-receiver-layout.py
sh bend2/test/bend-launch-guard.sh
sh bend2/scripts/build-native.sh bend2/test/process.bend .scratch/bend2/process-test
"$PYTHON3" bend2/test/custody-adopt.py
"$PYTHON3" bend2/test/observer-monitor.py
sh bend2/scripts/build-native.sh bend2/test/instance.bend .scratch/bend2/instance-test
sh bend2/scripts/build-native.sh bend2/tests/git.bend .scratch/bend2/git-test
.scratch/bend2/git-test
sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
.scratch/bend2/land-test
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
BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" BATON2_CREDIT_OBSERVE="$root/.scratch/bend2/claude-credit-observe" "$PYTHON3" bend2/test/native-helper-install.py
sh bend2/scripts/build-native.sh bend2/test/usage-windows.bend .scratch/bend2/usage-windows-test
.scratch/bend2/usage-windows-test
sh bend2/scripts/build-native.sh bend2/test/usage-windows-long.bend .scratch/bend2/usage-windows-long-test
.scratch/bend2/usage-windows-long-test
sh bend2/scripts/build-native.sh bend2/test/usage-windows-store.bend .scratch/bend2/usage-windows-store-test
rm -f .scratch/bend2/usage-windows-store.db
.scratch/bend2/usage-windows-store-test .scratch/bend2/usage-windows-store.db bend2/test/fake-omp-usage
sh bend2/scripts/build-native.sh bend2/test/usage-windows-wake.bend .scratch/bend2/usage-windows-wake-test
rm -f .scratch/bend2/usage-windows-wake.db
.scratch/bend2/usage-windows-wake-test .scratch/bend2/usage-windows-wake.db bend2/test/fake-wake-marker
sh bend2/scripts/build-native.sh bend2/test/usage-windows-wake-path.bend .scratch/bend2/usage-windows-wake-path-test
rm -f .scratch/bend2/usage-windows-wake-path.db
.scratch/bend2/usage-windows-wake-path-test .scratch/bend2/usage-windows-wake-path.db
BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" "$PYTHON3" bend2/scripts/check-native-parallel.py "$PYTHON3"
sh bend2/scripts/build-native.sh bend2/test/omp-home-preflight.bend .scratch/bend2/omp-home-preflight-test
BATON2_EXE="$root/.scratch/bend2/omp-home-preflight-test" "$PYTHON3" bend2/test/omp-home-preflight.py
sh bend2/scripts/build-native.sh bend2/test/dsh-player.bend .scratch/bend2/dsh-player-test
BATON2_EXE="$root/.scratch/bend2/dsh-player-test" "$PYTHON3" bend2/test/dsh-player.py
sh bend2/scripts/build-native.sh bend2/test/dsh-retained.bend .scratch/bend2/dsh-retained-test
BATON2_EXE="$root/.scratch/bend2/dsh-retained-test" "$PYTHON3" bend2/test/dsh-retained.py
sh bend2/scripts/build-native.sh bend2/test/dsh-turn.bend .scratch/bend2/dsh-turn-test
BATON2_EXE="$root/.scratch/bend2/dsh-turn-test" "$PYTHON3" bend2/test/dsh-turn.py
sh bend2/scripts/build-native.sh bend2/test/account-retained.bend .scratch/bend2/account-retained-test
BATON2_EXE="$root/.scratch/bend2/account-retained-test" "$PYTHON3" bend2/test/account-retained.py
sh bend2/scripts/build-native.sh bend2/test/account-credits.bend .scratch/bend2/account-credits-test
.scratch/bend2/account-credits-test
sh bend2/scripts/build-native.sh bend2/test/account-binding-smoke.bend .scratch/bend2/account-binding-smoke
BATON2_ACCOUNT_BINDING_SMOKE="$root/.scratch/bend2/account-binding-smoke" BATON2_API_KEY_EXEC="$root/.scratch/bend2/api-key-exec" "$PYTHON3" bend2/test/account-binding-smoke.py
