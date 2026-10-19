#!/bin/sh
# Focused fixture for bend2/scripts/bend-launch-guard.sh.
# The compiler stub records invocations and creates requested C outputs.
set -eu

here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
guard="$here/../scripts/bend-launch-guard.sh"
temp=$(mktemp -d)
trap 'rm -rf "$temp"' EXIT HUP INT TERM

mkdir -p "$temp/bin" "$temp/bend2"
cp "$guard" "$temp/bin/bend"
chmod 0755 "$temp/bin/bend"
cat > "$temp/bin/bun" <<'STUB'
#!/bin/sh
printf '%s\n' "$*" >> "$BUN_STUB_LOG"
out=
prev=
for arg in "$@"; do
  if [ "$arg" = version ]; then printf 'bend 2.0.25\n'; exit 0; fi
  if [ "$prev" = -o ]; then out=$arg; fi
  prev=$arg
done
if [ -n "$out" ]; then
  printf '%s\n' "$*" >> "$CGEN_STUB_LOG"
  printf '/* stub */\n' > "$out"
fi
exit 0
STUB
chmod 0755 "$temp/bin/bun"
printf '// stub compiler entry\n' > "$temp/bend2/main.ts"
export BUN_STUB_LOG="$temp/calls.log"
export CGEN_STUB_LOG="$temp/cgen.log"

calls() { if [ -f "$BUN_STUB_LOG" ]; then wc -l < "$BUN_STUB_LOG"; else echo 0; fi; }

before=$(calls)
"$temp/bin/bend" bend2/test/tiny.bend -o "$temp/focused.c"
[ "$(calls)" = "$((before + 1))" ] || { echo "FAIL focused compiler invocation"; exit 1; }
[ -f "$temp/focused.c" ] || { echo "FAIL focused output missing"; exit 1; }
echo "PASS focused_entry_without_admission_environment"

before=$(calls)
BATON2_ADMISSION_CGROUP=/unavailable BATON2_ADMISSION_RECEIPT=/unavailable   "$temp/bin/bend" bend2/src/coordinator/main.bend -o "$temp/main.c"
[ "$(calls)" = "$((before + 1))" ] || { echo "FAIL Main compiler invocation"; exit 1; }
[ -f "$temp/main.c" ] || { echo "FAIL Main output missing"; exit 1; }
echo "PASS Main_entry_without_admission_environment"

before=$(calls)
"$temp/bin/bend" --check-only bend2/src/coordinator/main.bend
[ "$(calls)" = "$((before + 1))" ] || { echo "FAIL check-only compiler invocation"; exit 1; }
echo "PASS check_only_invokes_packaged_compiler"

echo "PASS all launch-guard fixtures"

mkdir -p "$temp/tmp-backing"
ln -s "$temp/tmp-backing" "$temp/tmp-alias"

cat > "$temp/tmp-bend" <<'BEND'
#!/bin/sh
if [ "$1" = version ]; then printf 'bend 2.0.25\n'; exit 0; fi
[ -d "$TMPDIR" ] || { echo "missing isolated TMPDIR=$TMPDIR" >&2; exit 10; }
[ "$TMP" = "$TMPDIR" ] && [ "$TEMP" = "$TMPDIR" ] || exit 12
[ -z "${EXPECT_TMP_BASE:-}" ] || case "$TMPDIR" in "$EXPECT_TMP_BASE"/baton2-build.*) ;; *) echo "TMPDIR escaped configured base: $TMPDIR" >&2; exit 13;; esac
[ "$(stat -c '%a' "$TMPDIR" 2>/dev/null || stat -f '%Lp' "$TMPDIR")" = 700 ] || exit 11
: > "$TMPDIR/bend-tmp-probe"
if [ "${BEND_HOLD:-0}" = 1 ]; then
  python3 -c 'import subprocess; print(subprocess.Popen(["sleep", "90"], start_new_session=True).pid)' > "$BEND_CHILD_PID"
  printf '%s\n' "$TMPDIR" > "$TMPDIR_RECEIPT"
  exec sleep 2
fi
out=
while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift 2;; *) shift;; esac; done
[ -n "$out" ] || exit 2
if [ "${BEND_EMIT_SHARD_FIXTURE:-0}" = 1 ]; then
  cat > "$out" <<'C'
#include <stddef.h>
#define WL_SPIN(x) {
#define WL_SPUN(x) }
#define WL_OPEN(x) {
// Spins
// =====
// Work
// ====
// Segments
// ========
  WL_CASE(FID_A)
  {
    int x = 0;
  }}
// Requests
// ========
int main(void) { return 0; }
C
else
  printf '/* stub */\n' > "$out"
fi
BEND
cat > "$temp/tmp-cc" <<'CC'
#!/bin/sh
if [ "$1" = --version ]; then printf 'clang version 19.1.7\n'; exit 0; fi
[ -d "$TMPDIR" ] || { echo "missing isolated TMPDIR=$TMPDIR" >&2; exit 10; }
[ "$TMP" = "$TMPDIR" ] && [ "$TEMP" = "$TMPDIR" ] || exit 12
: > "$TMPDIR/cc-tmp-probe"
if [ "${CC_FAIL:-0}" = 1 ]; then
  printf '%s\n' "$TMPDIR" > "$TMPDIR_RECEIPT"
  exit 19
fi
out=
prev=
for a in "$@"; do if [ "$prev" = -o ]; then out=$a; fi; prev=$a; done
[ -n "$out" ] || exit 2
: > "$out"
CC
chmod 0755 "$temp/tmp-bend" "$temp/tmp-cc"
status=0
BEND_EMIT_SHARD_FIXTURE=1 BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/src/coordinator/main.bend "$temp/main-native-build" \
  >"$temp/main-native-build.out" 2>"$temp/main-native-build.err" || status=$?
[ "$status" = 0 ] || { echo "FAIL Main build-native status=$status"; cat "$temp/main-native-build.err"; exit 1; }
[ -f "$temp/main-native-build.c" ] || { echo "FAIL Main build-native generated C missing"; exit 1; }
[ -f "$temp/main-native-build" ] || { echo "FAIL Main build-native binary missing"; exit 1; }
echo "PASS build_native_Main_runs_without_memory_admission"
: > "$temp/tmp-backing/unrelated-keep"
status=0
TMPDIR="$temp/tmp-alias" BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-build" \
  >"$temp/tmp-build.out" 2>"$temp/tmp-build.err" || status=$?
[ "$status" = 0 ] || { echo "FAIL isolated scratch build status=$status"; cat "$temp/tmp-build.err"; exit 1; }
[ -f "$temp/tmp-build" ] || { echo "FAIL isolated scratch build output"; exit 1; }
[ -z "$(find "$temp/tmp-backing" -mindepth 1 ! -name unrelated-keep -print -quit)" ] || { echo "FAIL build scratch directory was retained"; find "$temp/tmp-backing" -mindepth 1 -maxdepth 2 -print; exit 1; }
[ -f "$temp/tmp-backing/unrelated-keep" ] || { echo "FAIL unrelated scratch sibling was removed"; exit 1; }
echo "PASS build_scratch_is_private_and_cleans_only_owned_directory"
status=0
(unset TMPDIR; BATON2_SCRATCH_ROOT="$temp/tmp-alias" EXPECT_TMP_BASE="$temp/tmp-alias" \
  BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-configured-build") \
  >"$temp/tmp-configured-build.out" 2>"$temp/tmp-configured-build.err" || status=$?
[ "$status" = 0 ] || { echo "FAIL configured scratch build status=$status"; cat "$temp/tmp-configured-build.err"; exit 1; }
[ -f "$temp/tmp-configured-build" ] || { echo "FAIL configured scratch build output"; exit 1; }
[ -z "$(find "$temp/tmp-backing" -mindepth 1 ! -name unrelated-keep -print -quit)" ] || { echo "FAIL configured scratch child was retained"; exit 1; }
echo "PASS configured_scratch_root_used_without_TMPDIR"
printf '%s' "$temp/tmp-alias" > "$temp/scratch-root.conf"
status=0
(unset TMPDIR BATON2_SCRATCH_ROOT; BATON2_SCRATCH_CONFIG="$temp/scratch-root.conf" \
  EXPECT_TMP_BASE="$temp/tmp-alias" BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-file-configured-build") \
  >"$temp/tmp-file-configured-build.out" 2>"$temp/tmp-file-configured-build.err" || status=$?
[ "$status" = 0 ] || { echo "FAIL file-configured scratch build status=$status"; cat "$temp/tmp-file-configured-build.err"; exit 1; }
[ -f "$temp/tmp-file-configured-build" ] || { echo "FAIL file-configured scratch build output"; exit 1; }
[ -z "$(find "$temp/tmp-backing" -mindepth 1 ! -name unrelated-keep -print -quit)" ] || { echo "FAIL file-configured scratch child was retained"; exit 1; }
echo "PASS host_scratch_root_config_used_without_newline"
: > "$temp/empty-scratch-root.conf"
status=0
(unset TMPDIR BATON2_SCRATCH_ROOT; BATON2_SCRATCH_CONFIG="$temp/empty-scratch-root.conf" \
  EXPECT_TMP_BASE=/tmp BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-empty-config-build") \
  >"$temp/tmp-empty-config-build.out" 2>"$temp/tmp-empty-config-build.err" || status=$?
[ "$status" = 0 ] || { echo "FAIL empty config fallback status=$status"; cat "$temp/tmp-empty-config-build.err"; exit 1; }
[ -f "$temp/tmp-empty-config-build" ] || { echo "FAIL empty config fallback output"; exit 1; }
echo "PASS empty_host_scratch_config_falls_back_to_tmp"
status=0
TMPDIR="$temp/tmp-alias" TMPDIR_RECEIPT="$temp/failed-scratch.path" CC_FAIL=1 \
  BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-build-failed" \
  >"$temp/tmp-build-failed.out" 2>"$temp/tmp-build-failed.err" || status=$?
[ "$status" = 19 ] || { echo "FAIL scratch failure status=$status"; cat "$temp/tmp-build-failed.err"; exit 1; }
failed_scratch=$(cat "$temp/failed-scratch.path")
[ -d "$failed_scratch" ] || { echo "FAIL failed build scratch was removed before inspection"; exit 1; }
[ -f "$failed_scratch/cc-tmp-probe" ] || { echo "FAIL failed build scratch receipt content"; exit 1; }
echo "PASS failed_build_scratch_preserved_for_cleanup_review"
status=0
TMPDIR="$temp/tmp-alias" BEND_HOLD=1 BEND_CHILD_PID="$temp/hold-child.pid" \
  TMPDIR_RECEIPT="$temp/hold-scratch.path" BEND="$temp/tmp-bend" CC="$temp/tmp-cc" \
  sh "$here/../scripts/build-native.sh" bend2/tests/land.bend "$temp/tmp-build-held" \
  >"$temp/tmp-build-held.out" 2>"$temp/tmp-build-held.err" &
wrapper_pid=$!
for attempt in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
  [ -s "$temp/hold-child.pid" ] && [ -s "$temp/hold-scratch.path" ] && break
  sleep 0.1
done
[ -s "$temp/hold-child.pid" ] && [ -s "$temp/hold-scratch.path" ] || { echo "FAIL held compiler did not start"; kill "$wrapper_pid" 2>/dev/null || true; exit 1; }
held_child=$(cat "$temp/hold-child.pid")
held_scratch=$(cat "$temp/hold-scratch.path")
ps -o pid,ppid,pgid,stat,command -p "$wrapper_pid,$held_child" >"$temp/held-processes.before"
kill -TERM "$wrapper_pid"
status=0
wait "$wrapper_pid" || status=$?
[ "$status" -eq 143 ] || { echo "FAIL wrapper TERM status=$status"; kill "$held_child" 2>/dev/null || true; exit 1; }
kill -0 "$held_child" 2>/dev/null || { echo "FAIL TERM unexpectedly ended compiler child"; cat "$temp/held-processes.before"; ps -o pid,ppid,pgid,stat,command -p "$wrapper_pid,$held_child" || true; exit 1; }
[ -d "$held_scratch" ] || { echo "FAIL interrupted build scratch was removed"; kill "$held_child" 2>/dev/null || true; exit 1; }
[ -f "$temp/tmp-backing/unrelated-keep" ] || { echo "FAIL TERM removed unrelated scratch sibling"; kill "$held_child" 2>/dev/null || true; exit 1; }
kill "$held_child" 2>/dev/null || true
echo "PASS interrupted_build_preserves_scratch_while_child_runs"

echo "PASS all launch-guard fixtures"

before=$(calls)
"$temp/bin/bend" version >"$temp/version.out"
grep -q '^bend 2.0.25$' "$temp/version.out" || { echo "FAIL version output"; exit 1; }
[ "$(calls)" = "$((before + 1))" ] || { echo "FAIL version compiler call"; exit 1; }
echo "PASS version_query_allowed"
