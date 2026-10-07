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
for test in bend2/test/*.py; do
  printf '%s\n' "$test"
  case "$test" in
    bend2/test/context-codec.py)
      compiler=${BEND:-"$root/.bend/bin/bend"}
      if [ ! -x "$compiler" ]; then
        compiler="$root/node_modules/.bend/bin/bend"
      fi
      evidence=$(mktemp -d "$root/.scratch/bend2/context-codec-check.XXXXXX")
      "$PYTHON3" "$test" --bend "$compiler" --out "$evidence/collection"
      ;;
    *) "$PYTHON3" "$test" ;;
  esac
done
node --test bend2/test/git-series.mjs
node --test \
  bend2/context/bend2/acquisition.test.mjs \
  bend2/context/bend2/frontend-adapter.test.mjs \
  bend2/context/bend2/native-provider.test.mjs \
  bend2/context/bend2/source-binding.test.mjs \
  bend2/context/bend2/worktree-capture.test.mjs
