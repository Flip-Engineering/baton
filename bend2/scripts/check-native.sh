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
sh bend2/scripts/build-native.sh bend2/test/process.bend .scratch/bend2/process-test
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
"$PYTHON3" bend2/scripts/check-native-parallel.py "$PYTHON3"
sh bend2/scripts/build-native.sh bend2/test/omp-home-preflight.bend .scratch/bend2/omp-home-preflight-test
BATON2_EXE="$root/.scratch/bend2/omp-home-preflight-test" "$PYTHON3" bend2/test/omp-home-preflight.py
