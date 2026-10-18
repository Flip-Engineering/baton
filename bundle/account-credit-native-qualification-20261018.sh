#!/bin/sh
# Frozen root qualification script for the native API-key account boundary.
#
# Run as root:
#   systemd-run --scope --slice=baton2-build.slice \
#     -p MemoryMax=16G -p MemorySwapMax=0 -- \
#     /var/tmp/baton-account-main2af-20261018/bundle/account-credit-native-qualification-20261018.sh
#
# The script refuses outside baton2-build.slice, with nonzero swap, or without
# the admitted full-Main receipt the pinned build guard requires. It builds the
# native api-key helper, builds the coordinator through the admitted guard,
# runs the 17 account-fallback behavior tests, and runs the native C8
# credential-safety fixture. No hosted CI and no unadmitted Main.
set -eu

ROOT=/var/tmp/baton-account-main2af-20261018
BEND=/run/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-27629713-20261018/bin/bend
CC=clang-19
PYTHON3=${PYTHON3:-python3}
OUT="$ROOT/.scratch/account-credit-native-root-check"

refuse() {
  printf 'refused: %s\n' "$1" >&2
  exit 78
}

[ -x "$BEND" ] || refuse "compiler is not executable: $BEND"
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
[ "$maximum" -le 17179869184 ] 2>/dev/null || refuse "memory.max exceeds 16 GiB: $maximum"
[ "$swapmaximum" = 0 ] || refuse "memory.swap.max is not zero: $swapmaximum"
ulimit -v unlimited || refuse "address-space limit could not be lifted"
[ "$(ulimit -v)" = unlimited ] || refuse "address-space limit remains capped"
[ -n "${BATON2_ADMISSION_RECEIPT:-}" ] || refuse "BATON2_ADMISSION_RECEIPT is required for the admitted Main build"
[ -f "$BATON2_ADMISSION_RECEIPT" ] || refuse "admitted Main receipt is absent: $BATON2_ADMISSION_RECEIPT"

rm -rf "$OUT"
mkdir -p "$OUT"
printf 'cgroup=%s\nmemory.max=%s\nmemory.swap.max=%s\nreceipt=%s\n' "$cgroup" "$maximum" "$swapmaximum" "$BATON2_ADMISSION_RECEIPT" > "$OUT/envelope.txt"
"$BEND" version > "$OUT/bend-version.txt" 2>&1 || refuse "compiler version query failed"
[ "$(cat "$OUT/bend-version.txt")" = 'bend 2.0.25' ] || refuse "compiler version is not bend 2.0.25"

cd "$ROOT"
printf 'root=%s\nbend=%s\ncc=%s\n' "$ROOT" "$BEND" "$CC" > "$OUT/receipt.txt"

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/harness/api-key-exec.bend .scratch/bend2/api-key-exec > "$OUT/helper-build.stdout" 2> "$OUT/helper-build.stderr"; then
  helper=0
else
  helper=$?
fi
printf 'helper build exit=%s\n' "$helper" | tee -a "$OUT/receipt.txt"
[ "$helper" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/api-key-spec.bend .scratch/bend2/api-key-spec > "$OUT/spec-build.stdout" 2> "$OUT/spec-build.stderr"; then
  specbuild=0
else
  specbuild=$?
fi
printf 'api-key-spec build exit=%s\n' "$specbuild" | tee -a "$OUT/receipt.txt"
[ "$specbuild" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" BATON2_ADMISSION_CGROUP="$cg" BATON2_ADMISSION_RECEIPT="$BATON2_ADMISSION_RECEIPT" sh bend2/scripts/build-native.sh > "$OUT/main-build.stdout" 2> "$OUT/main-build.stderr"; then
  main=0
else
  main=$?
fi
printf 'main build exit=%s\n' "$main" | tee -a "$OUT/receipt.txt"
[ "$main" -eq 0 ] || exit 1

if /usr/bin/time -v "$PYTHON3" bend2/test/account-credits.py -v > "$OUT/account-credits.stdout" 2> "$OUT/account-credits.stderr"; then
  behaviors=0
else
  behaviors=$?
fi
printf 'account-credits exit=%s\n' "$behaviors" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 17 tests' "$OUT/account-credits.stderr" || { printf 'behavior-count=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '^OK' "$OUT/account-credits.stderr" || { printf 'behavior-verdict=not-ok\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$behaviors" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_API_KEY_SPEC="$ROOT/.scratch/bend2/api-key-spec" "$PYTHON3" bend2/test/api-key-spec.py > "$OUT/api-key-spec.stdout" 2> "$OUT/api-key-spec.stderr"; then
  spec=0
else
  spec=$?
fi
printf 'api-key-spec exit=%s\n' "$spec" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 7 tests' "$OUT/api-key-spec.stderr" || { printf 'spec-tests=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '^OK' "$OUT/api-key-spec.stderr" || { printf 'spec-tests=not-ok\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$spec" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_API_KEY_EXEC="$ROOT/.scratch/bend2/api-key-exec" node --test bend2/test/api-key-exec.test.mjs > "$OUT/api-key-exec.stdout" 2> "$OUT/api-key-exec.stderr"; then
  safety=0
else
  safety=$?
fi
printf 'api-key-exec exit=%s\n' "$safety" | tee -a "$OUT/receipt.txt"
grep -q '# pass 6' "$OUT/api-key-exec.stdout" || { printf 'credential-safety=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '# fail 0' "$OUT/api-key-exec.stdout" || { printf 'credential-safety=failed\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$safety" -eq 0 ] || exit 1

printf 'result=pass\n' | tee -a "$OUT/receipt.txt"
