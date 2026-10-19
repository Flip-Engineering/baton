#!/bin/sh
# Focused current-main account-credit qualification.
#
# Root runs this once in a finite 16 GiB zero-swap service from the exact clean
#   systemd-run --scope --slice=baton2-build.slice \
#     -p MemoryMax=16G -p MemorySwapMax=0 -- \
#     env EXPECTED_HEAD=REPLACE_WITH_EXACT_COMMIT \
#     /mnt/nvme4tb/ci-runners/baton2-native-homelab/home/worktrees/accounts-oneuse-currentmain-20261019/bundle/account-credit-currentmain-16g-20261019.sh
#
# Replace EXPECTED_HEAD with the exact clean checkout commit before running.
#
# The script also pins the tested source to ac326067, requires a clean worktree,
# and exports BATON2_ADMISSION_CGROUP from the admitted unit cgroup.
#
# The script refuses outside baton2-build.slice, with nonzero swap, or with a
# memory ceiling other than 16 or 24 GiB. It checks the three account modules,
# builds and runs the focused account fixture, builds the native helpers and
# runs the focused behavior, binding, spec and credential-safety tests. It does
# not build Main and makes no provider call.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
BEND=${BEND:-/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-27629713-20261018/bin/bend}
CC=${CC:-clang-19}
NODE=${NODE:-/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/bin/node}
PYTHON3=${PYTHON3:-python3}
OUT=${OUT:-"$ROOT/.scratch/account-credit-currentmain-16g-$(date -u +%Y%m%dT%H%M%SZ)"}
SOURCE_PIN=ac326067a75e004a85e16f988b8e1dfb52921424
EXPECTED_HEAD=${EXPECTED_HEAD:-}

refuse() {
  printf 'refused: %s\n' "$1" >&2
  exit 78
}
[ -n "$EXPECTED_HEAD" ] || refuse "EXPECTED_HEAD must name the exact clean checkout commit"

[ -x "$BEND" ] || refuse "compiler is not executable: $BEND"
[ -x "$NODE" ] || refuse "node is not executable: $NODE"
cgroup=$(sed -n 's/^0:://p' /proc/self/cgroup)
case "$cgroup" in
  */baton2-build.slice/*) ;;
  *) refuse "not inside baton2-build.slice: $cgroup" ;;
esac
cg="/sys/fs/cgroup$cgroup"
export BATON2_ADMISSION_CGROUP="$cg"
[ -r "$cg/memory.max" ] || refuse "memory.max is unreadable: $cg"
[ -r "$cg/memory.swap.max" ] || refuse "memory.swap.max is unreadable: $cg"
maximum=$(cat "$cg/memory.max")
case "$maximum" in
  17179869184|25769803776) ;;
  *) refuse "memory.max must be exactly 16 or 24 GiB, observed $maximum" ;;
esac
[ "$(cat "$cg/memory.swap.max")" = 0 ] || refuse "memory.swap.max is not zero"
ulimit -v unlimited || refuse "address-space limit could not be lifted"
[ "$(ulimit -v)" = unlimited ] || refuse "address-space limit remains capped"
[ ! -e "$OUT" ] || refuse "output directory already exists: $OUT"
mkdir -p "$OUT"
printf 'cgroup=%s\nmemory.max=%s\nmemory.swap.max=0\n' "$cgroup" "$maximum" > "$OUT/envelope.txt"
"$BEND" version > "$OUT/bend-version.txt" 2>&1 || refuse "compiler version query failed"
[ "$(cat "$OUT/bend-version.txt")" = 'bend 2.0.25' ] || refuse "compiler version is not bend 2.0.25"
"$NODE" --version > "$OUT/node-version.txt" 2>&1 || refuse "node version query failed"

cd "$ROOT"
HEAD=$(git rev-parse HEAD)
[ -z "$(git status --porcelain)" ] || refuse "worktree is not clean: $(git status --porcelain | tr '\n' ' ')"
git merge-base --is-ancestor "$SOURCE_PIN" "$HEAD" || refuse "HEAD $HEAD does not contain source pin $SOURCE_PIN"
if ! git diff --quiet "$SOURCE_PIN" -- bend2/harness/api-key-exec.bend bend2/harness/claude-credit-observe.bend bend2/test/account-credits-focused.py bend2/test/account-credits.bend bend2/test/api-key-exec.test.mjs bend2/test/api-key-exec-test-entry.bend bend2/test/account-binding-smoke.bend bend2/test/account-binding-smoke.py bend2/test/api-key-spec.bend bend2/test/api-key-spec.py bend2/test/account-credits-entry.bend bend2/harness/claude-credit-observe.py bend2/src/coordinator/accounts.bend bend2/src/coordinator/subscription-fallback.bend bend2/scripts/build-native.sh; then
  refuse "tested source differs from pin $SOURCE_PIN"
fi
if [ -n "$EXPECTED_HEAD" ] && [ "$HEAD" != "$EXPECTED_HEAD" ]; then
  refuse "HEAD $HEAD differs from EXPECTED_HEAD $EXPECTED_HEAD"
fi
printf 'root=%s\nsource_pin=%s\nhead=%s\nstatus=%s\nbend=%s\ncc=%s\nnode=%s\n' "$ROOT" "$SOURCE_PIN" "$HEAD" "$(git status --porcelain | wc -l)" "$BEND" "$CC" "$NODE" > "$OUT/receipt.txt"

for src in bend2/src/coordinator/accounts.bend bend2/test/account-credits.bend bend2/src/coordinator/subscription-fallback.bend; do
  name=$(basename "$src")
  if "$BEND" --check-only "$src" > "$OUT/$name.stdout" 2> "$OUT/$name.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf 'check %s exit=%s\n' "$name" "$rc" | tee -a "$OUT/receipt.txt"
  [ "$rc" -eq 0 ] || exit 1
done

if env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh bend2/test/account-credits.bend "$OUT/account-credits-test" > "$OUT/account-fixture-build.stdout" 2> "$OUT/account-fixture-build.stderr"; then
  build=0
else
  build=$?
fi
printf 'account-fixture build exit=%s\n' "$build" | tee -a "$OUT/receipt.txt"
[ "$build" -eq 0 ] || exit 1
"$OUT/account-credits-test" > "$OUT/account-fixture-1.stdout" 2> "$OUT/account-fixture-1.stderr"
"$OUT/account-credits-test" > "$OUT/account-fixture-2.stdout" 2> "$OUT/account-fixture-2.stderr"
diff -u "$OUT/account-fixture-1.stdout" "$OUT/account-fixture-2.stdout" > "$OUT/account-fixture.diff"
lines=$(wc -l < "$OUT/account-fixture-1.stdout")
printf 'account-fixture lines=%s output=deterministic sha256=%s\n' "$lines" "$(sha256sum "$OUT/account-fixture-1.stdout" | awk '{print $1}')" | tee -a "$OUT/receipt.txt"
# The checked-in 45-line expected file is historical evidence and is preserved.
# The current fixture is pinned to 80 output lines: 79 "fixture-account ...: ok"
# checks plus the final "fixture-accounts-ok" line. Keep the recorded output at
# $OUT/account-fixture-1.stdout for adoption as the next golden.
[ "$lines" -eq 80 ] || refuse "fixture output lines=$lines, expected 80"
ok_lines=$(grep -c '^fixture-account .*: ok$' "$OUT/account-fixture-1.stdout" || true)
[ "$ok_lines" -eq 79 ] || refuse "fixture ok checks=$ok_lines, expected 79"
grep -q '^fixture-accounts-ok$' "$OUT/account-fixture-1.stdout" || refuse "fixture final marker is absent"
[ "$(tail -n 1 "$OUT/account-fixture-1.stdout")" = 'fixture-accounts-ok' ] || refuse "fixture final marker is not last"
printf 'account-fixture checks=%s final=ok\n' "$ok_lines" | tee -a "$OUT/receipt.txt"

build_one() {
  entry=$1
  out=$2
  if env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh "$entry" "$out" > "$out-build.stdout" 2> "$out-build.stderr"; then
    rc=0
  else
    rc=$?
  fi
  printf 'build %s exit=%s\n' "$entry" "$rc" | tee -a "$OUT/receipt.txt"
  [ "$rc" -eq 0 ] || exit 1
}

build_one bend2/harness/api-key-exec.bend "$OUT/api-key-exec"
build_one bend2/harness/claude-credit-observe.bend "$OUT/claude-credit-observe"
build_one bend2/test/account-binding-smoke.bend "$OUT/account-binding-smoke"
build_one bend2/test/api-key-spec.bend "$OUT/api-key-spec"
build_one bend2/test/account-credits-entry.bend "$OUT/account-credits-entry"
build_one bend2/test/api-key-exec-test-entry.bend "$OUT/api-key-exec-test-entry"

if env BATON2_CREDIT_OBSERVE="$OUT/claude-credit-observe" "$PYTHON3" bend2/test/claude-credit-observe.py > "$OUT/observe.stdout" 2> "$OUT/observe.stderr"; then observe=0; else observe=$?; fi
printf 'observe fixture exit=%s\n' "$observe" | tee -a "$OUT/receipt.txt"
[ "$observe" -eq 0 ] || exit 1

if env BATON2_ACCOUNT_BINDING_SMOKE="$OUT/account-binding-smoke" BATON2_API_KEY_EXEC="$OUT/api-key-exec" "$PYTHON3" bend2/test/account-binding-smoke.py > "$OUT/binding-smoke.stdout" 2> "$OUT/binding-smoke.stderr"; then binding=0; else binding=$?; fi
printf 'binding smoke exit=%s\n' "$binding" | tee -a "$OUT/receipt.txt"
[ "$binding" -eq 0 ] || exit 1

if env BATON2_API_KEY_SPEC="$OUT/api-key-spec" "$PYTHON3" bend2/test/api-key-spec.py > "$OUT/api-key-spec.stdout" 2> "$OUT/api-key-spec.stderr"; then spec=0; else spec=$?; fi
printf 'api-key-spec exit=%s\n' "$spec" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 9 tests' "$OUT/api-key-spec.stderr" || exit 1
grep -q '^OK' "$OUT/api-key-spec.stderr" || exit 1
[ "$spec" -eq 0 ] || exit 1

if env BATON2_ACCOUNT_ENTRY="$OUT/account-credits-entry" BATON2_API_KEY_EXEC="$OUT/api-key-exec" "$PYTHON3" bend2/test/account-credits-focused.py -v > "$OUT/account-focused.stdout" 2> "$OUT/account-focused.stderr"; then focused=0; else focused=$?; fi
printf 'account-focused exit=%s\n' "$focused" | tee -a "$OUT/receipt.txt"
grep -q 'Ran 32 tests' "$OUT/account-focused.stderr" || exit 1
grep -q '^OK$' "$OUT/account-focused.stderr" || exit 1
[ "$focused" -eq 0 ] || exit 1

if env BATON2_API_KEY_EXEC="$OUT/api-key-exec" BATON2_API_KEY_EXEC_TEST="$OUT/api-key-exec-test-entry" "$NODE" --test --test-reporter=tap bend2/test/api-key-exec.test.mjs > "$OUT/api-key-exec.stdout" 2> "$OUT/api-key-exec.stderr"; then safety=0; else safety=$?; fi
printf 'api-key-exec exit=%s\n' "$safety" | tee -a "$OUT/receipt.txt"
grep -q '# pass 13' "$OUT/api-key-exec.stdout" || exit 1
grep -q '# fail 0' "$OUT/api-key-exec.stdout" || exit 1
[ "$safety" -eq 0 ] || exit 1

printf 'result=pass\n' | tee -a "$OUT/receipt.txt"
