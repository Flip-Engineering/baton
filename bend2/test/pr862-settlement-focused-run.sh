#!/bin/sh
# Focused runtime qualification for PR862 completion settlement. Run inside the
# root-admitted finite zero-swap cgroup. It builds only this test entry, not
# Main, and calls the production AgentInput.consume_delivered transaction and
# Receive.consume_completed failure gate against a real SQLite database.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
EXPECT=898dcac4fa8ffce42858a77216ea88f8167c27ff
TEST=bend2/test/pr862-settlement-focused.bend
TEST_SHA=34e0b92e93cd2be2a1e4116d79b73efe60f348bc9636d031b4a63f634093d723
OUT=${OUT:-"$ROOT/.scratch/bend2/pr862-settlement-focused"}
BINARY="$OUT/pr862-settlement-focused"
DB="$OUT/state.db"
RECEIPT="$OUT/receipt.json"
BEND=${BEND:?set BEND to the admitted Bend 2.0.25 executable}
CC=${CC:-/usr/lib/llvm-19/bin/clang}

mkdir -p "$OUT"
rm -f "$DB" "$BINARY"
cd "$ROOT"

head=$(git rev-parse HEAD)
[ "$head" = "$EXPECT" ] || {
  echo "source HEAD $head differs from $EXPECT" >&2
  exit 2
}
test_sha=$(sha256sum "$TEST" | cut -d' ' -f1)
[ "$test_sha" = "$TEST_SHA" ] || {
  echo "test SHA $test_sha differs from $TEST_SHA" >&2
  exit 2
}
tree=$(git rev-parse HEAD^{tree})
compiler_sha=$(sha256sum "$BEND" | cut -d' ' -f1)
runner_sha=$(sha256sum "$0" | cut -d' ' -f1)
cgroup=$(awk -F: '$1=="0"{print $3}' /proc/self/cgroup)
memory_max=$(cat "/sys/fs/cgroup$cgroup/memory.max" 2>/dev/null || true)
swap_max=$(cat "/sys/fs/cgroup$cgroup/memory.swap.max" 2>/dev/null || true)
if [ -n "$cgroup" ]; then
  : "${BATON2_ADMISSION_CGROUP:=/sys/fs/cgroup$cgroup}"
  export BATON2_ADMISSION_CGROUP
fi
export BEND_NO_TELEMETRY=1
ulimit -s unlimited 2>/dev/null || true

started=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
build_status=0
env BEND="$BEND" CC="$CC" sh bend2/scripts/build-native.sh "$TEST" "$BINARY" \
  >"$OUT/build.stdout" 2>"$OUT/build.stderr" || build_status=$?
if [ "$build_status" = 0 ]; then
  [ -x "$BINARY" ] || build_status=1
fi
run_status=0
if [ "$build_status" = 0 ]; then
  "$BINARY" "$DB" >"$OUT/run.stdout" 2>"$OUT/run.stderr" || run_status=$?
fi
finished=$(date -u +'%Y-%m-%dT%H:%M:%SZ')
binary_sha=$(sha256sum "$BINARY" 2>/dev/null | cut -d' ' -f1 || true)
pass_line=0
if [ -f "$OUT/run.stdout" ]; then
  pass_line=$(grep -c '^PR862-SETTLEMENT-PASS$' "$OUT/run.stdout" || true)
  [ -n "$pass_line" ] || pass_line=0
fi
status=$build_status
if [ "$status" = 0 ]; then status=$run_status; fi
if [ "$status" = 0 ] && [ "$pass_line" != 1 ]; then status=1; fi

printf '%s\n' \
  "{" \
  "\"source_tree\":\"$tree\"," \
  "\"runner\":\"$0\"," \
  "\"runner_sha256\":\"$runner_sha\"," \
  "\"head\":\"$head\"," \
  "\"test\":\"$TEST\"," \
  "\"test_sha256\":\"$test_sha\"," \
  "\"compiler\":\"$BEND\"," \
  "\"compiler_sha256\":\"$compiler_sha\"," \
  "\"binary\":\"$BINARY\"," \
  "\"binary_sha256\":\"$binary_sha\"," \
  "\"database\":\"$DB\"," \
  "\"cgroup\":\"$cgroup\"," \
  "\"memory_max\":\"$memory_max\"," \
  "\"memory_swap_max\":\"$swap_max\"," \
  "\"started_utc\":\"$started\"," \
  "\"finished_utc\":\"$finished\"," \
  "\"build_exit\":$build_status," \
  "\"run_exit\":$run_status," \
  "\"pass_lines\":$pass_line," \
  "\"status\":$status" \
  "}" >"$RECEIPT"

if [ "$status" != 0 ]; then
  echo "PR862 focused qualification failed; receipt $RECEIPT" >&2
  cat "$OUT/build.stderr" "$OUT/run.stderr" >&2 || true
  exit "$status"
fi
echo "PR862 focused qualification passed; receipt $RECEIPT"
