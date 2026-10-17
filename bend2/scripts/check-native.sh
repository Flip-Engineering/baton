#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
if python3 --version 2>/dev/null; then
  PYTHON3=python3
else
  PYTHON3=/usr/bin/python3
fi
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
BEND_NO_TELEMETRY=1 "$compiler" bend2/src/coordinator/laws.bend --check-only
sh bend2/scripts/build-native.sh
sh bend2/scripts/build-native.sh bend2/test/process.bend .scratch/bend2/process-test
sh bend2/scripts/build-native.sh bend2/test/codex-proxy.bend .scratch/bend2/codex-proxy-test
sh bend2/scripts/build-native.sh bend2/test/instance.bend .scratch/bend2/instance-test
sh bend2/scripts/build-native.sh bend2/tests/git.bend .scratch/bend2/git-test
.scratch/bend2/git-test
sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
.scratch/bend2/land-test
"$PYTHON3" bend2/scripts/check-native-parallel.py "$PYTHON3"
sh bend2/scripts/build-native.sh bend2/test/account-credits.bend .scratch/bend2/account-credits-test
.scratch/bend2/account-credits-test
