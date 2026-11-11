#!/bin/sh
# Frozen root qualification script for the account-credit current-main port.
#
# Run as root, from any directory:
#   systemd-run --scope --slice=baton2-build.slice \
#     -p MemoryMax=8G -p MemorySwapMax=0 -- \
#     /var/tmp/baton-account-main2af-20261018/bundle/account-credit-currentmain-2.0.25-check.sh
#
# The script refuses outside the baton2-build.slice scope or with a nonzero
# memory.swap.max. It runs the three pinned module checks, builds and runs the
# 45-line focused fixture, compares the fixture output with the frozen previous
# output, and records exit codes, peak RSS and swap for each step.
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
case "$cgroup" in
  */baton2-build.slice/*) ;;
  *) refuse "not inside baton2-build.slice: $cgroup" ;;
esac
cg="/sys/fs/cgroup$cgroup"
[ -r "$cg/memory.max" ] || refuse "memory.max is unreadable: $cg"
[ -r "$cg/memory.swap.max" ] || refuse "memory.swap.max is unreadable: $cg"
maximum=$(cat "$cg/memory.max")
swapmaximum=$(cat "$cg/memory.swap.max")
[ "$maximum" != max ] || refuse "memory.max is unbounded"
[ "$maximum" -gt 0 ] 2>/dev/null || refuse "memory.max is invalid: $maximum"
[ "$maximum" -le 8589934592 ] 2>/dev/null || refuse "memory.max exceeds 8 GiB: $maximum"
[ "$swapmaximum" = 0 ] || refuse "memory.swap.max is not zero: $swapmaximum"
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
  swaps=$(awk -F': ' '/^[[:space:]]*Swaps:/{print $2}' "$OUT/$name.stderr")
  [ "$swaps" = 0 ] || return 1
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
build_swaps=$(awk -F': ' '/^[[:space:]]*Swaps:/{print $2}' "$OUT/build.stderr")
[ "$build_swaps" = 0 ] || exit 1

if /usr/bin/time -v "$OUT/account-credits-test" > "$OUT/fixture.stdout" 2> "$OUT/fixture.stderr"; then
  fixture=0
else
  fixture=$?
fi
printf 'run fixture exit=%s\n' "$fixture" | tee -a "$OUT/receipt.txt"
metric "$OUT/fixture.stderr" | tee -a "$OUT/metrics.txt"
[ "$fixture" -eq 0 ] || exit 1
fixture_swaps=$(awk -F': ' '/^[[:space:]]*Swaps:/{print $2}' "$OUT/fixture.stderr")
[ "$fixture_swaps" = 0 ] || exit 1

if diff -u "$EXPECTED" "$OUT/fixture.stdout" > "$OUT/fixture.diff"; then
  printf 'fixture-output=identical\n' | tee -a "$OUT/receipt.txt"
else
  printf 'fixture-output=different\n' | tee -a "$OUT/receipt.txt"
  exit 1
fi

printf 'result=pass\n' | tee -a "$OUT/receipt.txt"
