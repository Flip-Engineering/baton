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
sh bend2/scripts/build-native.sh bend2/tests/git.bend .scratch/bend2/git-test
.scratch/bend2/git-test
sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
.scratch/bend2/land-test
failed=0
unqualified=0
for test in bend2/test/*.py; do
  printf '%s\n' "$test"
  status=0
  "$PYTHON3" "$test" || status=$?
  if [ "$status" -eq 0 ]; then
    continue
  fi
  if [ "$status" -eq 2 ]; then
    unqualified=$((unqualified + 1))
    printf '%s\n' "unqualified ($status): $test" >&2
  else
    failed=$((failed + 1))
    printf '%s\n' "failed ($status): $test" >&2
  fi
done
node_status=0
node --test bend2/test/git-series.mjs || node_status=$?
if [ "$node_status" -ne 0 ]; then
  failed=$((failed + 1))
  printf '%s\n' "failed ($node_status): bend2/test/git-series.mjs" >&2
fi
if [ "$failed" -ne 0 ]; then
  printf '%s\n' "check-native: $failed driver(s) failed; every driver ran, see the output above." >&2
  exit 1
fi
if [ "$unqualified" -ne 0 ]; then
  printf '%s\n' "check-native: $unqualified driver(s) reported unqualified; every driver ran, see the output above." >&2
  exit 2
fi
