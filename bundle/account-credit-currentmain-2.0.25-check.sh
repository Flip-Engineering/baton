#!/bin/sh
# Root qualification script for the account-credit current-main port.
#
# Run as root from any directory. The script records the current cgroup memory
# settings and observed swap use without imposing a memory or swap limit.
#
# The script runs the three pinned module checks, builds and runs the focused
# fixture, compares its output with the frozen expected output, and records exit
# codes, peak RSS and observed swap use for each step.
set -eu

ROOT=/var/tmp/baton-account-main2af-20261018
BEND=/run/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-27629713-20261018/bin/bend
CC=clang-19
EXPECTED="$ROOT/bundle/account-credit-fixture-expected.txt"
OUT="$ROOT/.scratch/account-credit-currentmain-root-check"

refuse() {
  printf 'refused: %s\n' "$1" >&2
  exit 78
}

[ -x "$BEND" ] || refuse "compiler is not executable: $BEND"
[ -f "$EXPECTED" ] || refuse "expected fixture output is absent: $EXPECTED"

cgroup=$(sed -n 's/^0:://p' /proc/self/cgroup)
[ -n "$cgroup" ] || cgroup=unavailable
cg="/sys/fs/cgroup$cgroup"
maximum=unavailable
swapmaximum=unavailable
if [ -r "$cg/memory.max" ]; then maximum=$(cat "$cg/memory.max") || maximum=unreadable; fi
if [ -r "$cg/memory.swap.max" ]; then swapmaximum=$(cat "$cg/memory.swap.max") || swapmaximum=unreadable; fi
ulimit -v unlimited || refuse "address-space limit could not be lifted"
[ "$(ulimit -v)" = unlimited ] || refuse "address-space limit remains capped"

rm -rf "$OUT"
mkdir -p "$OUT"
printf 'cgroup=%s\nmemory.max=%s\nmemory.swap.max=%s\n' "$cgroup" "$maximum" "$swapmaximum" > "$OUT/envelope.txt"
"$BEND" version > "$OUT/bend-version.txt" 2>&1 || refuse "compiler version query failed"
[ "$(cat "$OUT/bend-version.txt")" = 'bend 2.0.25' ] || refuse "compiler version is not bend 2.0.25"

metric() {
  awk -F': ' '/Maximum resident set size|^[[:space:]]*Swaps:/{gsub(/^[[:space:]]+/,"",$1); print $1"="$2}' "$1"
}

check_one() {
  src=$1
  name=$(basename "$src")
  if /usr/bin/time -v "$BEND" --check-only "$src" > "$OUT/$name.stdout" 2> "$OUT/$name.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf 'check %s exit=%s\n' "$name" "$rc" | tee -a "$OUT/receipt.txt"
  metric "$OUT/$name.stderr" | tee -a "$OUT/metrics.txt"
  [ "$rc" -eq 0 ] || return 1
}

cd "$ROOT"
printf 'root=%s\nbend=%s\ncc=%s\n' "$ROOT" "$BEND" "$CC" > "$OUT/receipt.txt"
check_one bend2/src/coordinator/accounts.bend
check_one bend2/test/account-credits.bend
check_one bend2/src/coordinator/subscription-fallback.bend

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/account-credits.bend "$OUT/account-credits-test" > "$OUT/build.stdout" 2> "$OUT/build.stderr"; then
  build=0
else
  build=$?
fi
printf 'build fixture exit=%s\n' "$build" | tee -a "$OUT/receipt.txt"
metric "$OUT/build.stderr" | tee -a "$OUT/metrics.txt"
[ "$build" -eq 0 ] || exit 1

if /usr/bin/time -v "$OUT/account-credits-test" > "$OUT/fixture.stdout" 2> "$OUT/fixture.stderr"; then
  fixture=0
else
  fixture=$?
fi
printf 'run fixture exit=%s\n' "$fixture" | tee -a "$OUT/receipt.txt"
metric "$OUT/fixture.stderr" | tee -a "$OUT/metrics.txt"
[ "$fixture" -eq 0 ] || exit 1

if diff -u "$EXPECTED" "$OUT/fixture.stdout" > "$OUT/fixture.diff"; then
  printf 'fixture-output=identical\n' | tee -a "$OUT/receipt.txt"
else
  printf 'fixture-output=different\n' | tee -a "$OUT/receipt.txt"
  exit 1
fi

printf 'result=pass\n' | tee -a "$OUT/receipt.txt"
