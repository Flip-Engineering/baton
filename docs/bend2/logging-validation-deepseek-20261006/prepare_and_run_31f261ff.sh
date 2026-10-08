#!/bin/sh
# Extract, build and validate commit 31f261ff on the validation runner.
set -u
R=/home/atari2036/issue686-31f261ff
rm -rf "$R/src"
mkdir -p "$R/src"
tar -xzf /home/atari2036/issue686-31f261ff.tar.gz -C "$R/src" || { echo TAR_FAILED; exit 1; }
cd "$R/src" || { echo CD_FAILED; exit 1; }
export BEND=/home/atari2036/baton-logging-686/toolchain-home/bin/bend
export CC=clang-19
echo "=== build start $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
sh bend2/scripts/build-native.sh > "$R/build.log" 2>&1
rc=$?
echo "=== build end $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$rc ==="
if [ "$rc" -ne 0 ]; then
  echo BUILD_FAILED
  tail -30 "$R/build.log"
  exit 1
fi
tail -3 "$R/build.log"
echo "--- executable identity ---"
sha256sum .scratch/bend2/baton2
echo "--- harness identity ---"
sha256sum "$R/issue686_acceptance_31f261ff.py"
sh "$R/run_31f261ff.sh"
