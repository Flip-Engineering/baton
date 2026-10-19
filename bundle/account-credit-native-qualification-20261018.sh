#!/bin/sh
# Frozen root qualification script for the native API-key account boundary.
#
# Run as root:
#   systemd-run --scope --slice=baton2-build.slice \
#     -p MemoryMax=8G -p MemorySwapMax=0 -- \
#     /var/tmp/baton-account-main2af-20261018/bundle/account-credit-native-qualification-20261018.sh
#
# The script refuses outside baton2-build.slice, with nonzero swap, or above
# the 8 GiB memory ceiling. It builds the native api-key helper and the spec and
# account-credits-entry fixtures, runs the 9 spec boundary tests, the 17 focused
# account behavior tests, and the 10 native C8 credential-safety cases. It does
# not build Main. No hosted CI.
#
# NODE names the native Node executable. The default is the installed native
# path below; a bare name is resolved through PATH. A missing or non-executable
# Node fails admission before any build. The default output directory is unique
# per run, so earlier receipts stay at their original paths.
set -eu

ROOT=/var/tmp/baton-account-main2af-20261018
BEND=/run/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-27629713-20261018/bin/bend
CC=clang-19
NODE=${NODE:-/run/baton2-native-homelab/home/.local/bin/node}
PYTHON3=${PYTHON3:-python3}
OUT=${OUT:-"$ROOT/.scratch/account-credit-native-root-check-$(date -u +%Y%m%dT%H%M%SZ)"}

refuse() {
  printf 'refused: %s\n' "$1" >&2
  exit 78
}

[ -x "$BEND" ] || refuse "compiler is not executable: $BEND"
case "$NODE" in
  */*) ;;
  *) resolved=$(command -v "$NODE" 2>/dev/null || true); [ -n "$resolved" ] || refuse "node not found: $NODE"; NODE=$resolved ;;
esac
[ -x "$NODE" ] || refuse "node is not executable: $NODE"
"$NODE" --version >/dev/null 2>&1 || refuse "node version query failed: $NODE"
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
[ "$maximum" -le 8589934592 ] 2>/dev/null || refuse "memory.max exceeds 8 GiB: $maximum"
[ "$swapmaximum" = 0 ] || refuse "memory.swap.max is not zero: $swapmaximum"
ulimit -v unlimited || refuse "address-space limit could not be lifted"
[ "$(ulimit -v)" = unlimited ] || refuse "address-space limit remains capped"

[ ! -e "$OUT" ] || refuse "output directory already exists: $OUT"
mkdir -p "$OUT"
printf 'cgroup=%s\nmemory.max=%s\nmemory.swap.max=%s\n' "$cgroup" "$maximum" "$swapmaximum" > "$OUT/envelope.txt"
"$BEND" version > "$OUT/bend-version.txt" 2>&1 || refuse "compiler version query failed"
[ "$(cat "$OUT/bend-version.txt")" = 'bend 2.0.25' ] || refuse "compiler version is not bend 2.0.25"

cd "$ROOT"
printf 'out=%s\nroot=%s\nbend=%s\ncc=%s\nnode=%s\n' "$OUT" "$ROOT" "$BEND" "$CC" "$NODE" > "$OUT/receipt.txt"
"$NODE" --version > "$OUT/node-version.txt" 2>&1 || refuse "node version query failed: $NODE"

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/harness/api-key-exec.bend .scratch/bend2/api-key-exec > "$OUT/helper-build.stdout" 2> "$OUT/helper-build.stderr"; then
  helper=0
else
  helper=$?
fi
printf 'helper build exit=%s\n' "$helper" | tee -a "$OUT/receipt.txt"
[ "$helper" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/harness/claude-credit-observe.bend .scratch/bend2/claude-credit-observe > "$OUT/observe-build.stdout" 2> "$OUT/observe-build.stderr"; then
  observebuild=0
else
  observebuild=$?
fi
printf 'observe build exit=%s\n' "$observebuild" | tee -a "$OUT/receipt.txt"
[ "$observebuild" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_CREDIT_OBSERVE="$ROOT/.scratch/bend2/claude-credit-observe" "$PYTHON3" bend2/test/claude-credit-observe.py > "$OUT/observe.stdout" 2> "$OUT/observe.stderr"; then
  observe=0
else
  observe=$?
fi
printf 'observe fixture exit=%s\n' "$observe" | tee -a "$OUT/receipt.txt"
[ "$observe" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/account-binding-smoke.bend .scratch/bend2/account-binding-smoke > "$OUT/binding-smoke-build.stdout" 2> "$OUT/binding-smoke-build.stderr"; then
  bindingbuild=0
else
  bindingbuild=$?
fi
printf 'binding smoke build exit=%s\n' "$bindingbuild" | tee -a "$OUT/receipt.txt"
[ "$bindingbuild" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_ACCOUNT_BINDING_SMOKE="$ROOT/.scratch/bend2/account-binding-smoke" BATON2_API_KEY_EXEC="$ROOT/.scratch/bend2/api-key-exec" "$PYTHON3" bend2/test/account-binding-smoke.py > "$OUT/binding-smoke.stdout" 2> "$OUT/binding-smoke.stderr"; then
  bindingsmoke=0
else
  bindingsmoke=$?
fi
printf 'binding smoke exit=%s\n' "$bindingsmoke" | tee -a "$OUT/receipt.txt"
[ "$bindingsmoke" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/api-key-spec.bend .scratch/bend2/api-key-spec > "$OUT/spec-build.stdout" 2> "$OUT/spec-build.stderr"; then
  specbuild=0
else
  specbuild=$?
fi
printf 'api-key-spec build exit=%s\n' "$specbuild" | tee -a "$OUT/receipt.txt"
[ "$specbuild" -eq 0 ] || exit 1

if /usr/bin/time -v env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/account-credits-entry.bend .scratch/bend2/account-credits-entry > "$OUT/entry-build.stdout" 2> "$OUT/entry-build.stderr"; then
  entrybuild=0
else
  entrybuild=$?
fi
printf 'account-entry build exit=%s\n' "$entrybuild" | tee -a "$OUT/receipt.txt"
[ "$entrybuild" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_ACCOUNT_ENTRY="$ROOT/.scratch/bend2/account-credits-entry" "$PYTHON3" bend2/test/account-credits-focused.py -v > "$OUT/account-focused.stdout" 2> "$OUT/account-focused.stderr"; then
  focused=0
else
  focused=$?
fi
printf 'account-focused exit=%s\n' "$focused" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 17 tests' "$OUT/account-focused.stderr" || { printf 'focused-count=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '^OK' "$OUT/account-focused.stderr" || { printf 'focused-verdict=not-ok\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$focused" -eq 0 ] || exit 1

if /usr/bin/time -v env BATON2_API_KEY_SPEC="$ROOT/.scratch/bend2/api-key-spec" "$PYTHON3" bend2/test/api-key-spec.py > "$OUT/api-key-spec.stdout" 2> "$OUT/api-key-spec.stderr"; then
  spec=0
else
  spec=$?
fi
printf 'api-key-spec exit=%s\n' "$spec" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 9 tests' "$OUT/api-key-spec.stderr" || { printf 'spec-tests=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '^OK' "$OUT/api-key-spec.stderr" || { printf 'spec-tests=not-ok\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$spec" -eq 0 ] || exit 1

# The TAP reporter keeps the count assertions stable across the pinned Node
# versions; the default reporter changes their spelling.
if /usr/bin/time -v env BATON2_API_KEY_EXEC="$ROOT/.scratch/bend2/api-key-exec" "$NODE" --test --test-reporter=tap bend2/test/api-key-exec.test.mjs > "$OUT/api-key-exec.stdout" 2> "$OUT/api-key-exec.stderr"; then
  safety=0
else
  safety=$?
fi
printf 'api-key-exec exit=%s\n' "$safety" | tee -a "$OUT/receipt.txt"
grep -q '# pass 10' "$OUT/api-key-exec.stdout" || { printf 'credential-safety=mismatch\n' | tee -a "$OUT/receipt.txt"; exit 1; }
grep -q '# fail 0' "$OUT/api-key-exec.stdout" || { printf 'credential-safety=failed\n' | tee -a "$OUT/receipt.txt"; exit 1; }
[ "$safety" -eq 0 ] || exit 1

printf 'result=pass\n' | tee -a "$OUT/receipt.txt"
