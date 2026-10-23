#!/bin/sh
# Shared compile queue behavior with fake compiler commands. No Bend, clang or
# cc process runs. Set BATON2_COMPILE_QUEUE_BIN to the built queue executable;
# the test invokes the public launcher so the bootstrap path is exercised too.
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
QUEUE=${BATON2_COMPILE_QUEUE:-$ROOT/bend2/scripts/compile-queue.sh}
[ -f "$QUEUE" ] || { printf 'missing queue launcher: %s\n' "$QUEUE" >&2; exit 2; }
if [ -z "${BATON2_COMPILE_QUEUE_BIN:-}" ] || [ ! -x "$BATON2_COMPILE_QUEUE_BIN" ]; then
  printf 'Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable\n' >&2
  exit 2
fi
case "${BATON_COMPILE_QUEUE_ROOT:-}" in
  /*) ;;
  *) printf 'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute queue state directory\n' >&2; exit 2 ;;
esac

T=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-test.XXXXXX") || exit 2
trap 'rm -rf -- "$T"' EXIT
STATE=$BATON_COMPILE_QUEUE_ROOT
if [ ! -e "$STATE" ]; then
  (umask 0007; mkdir -p -m 2770 "$STATE") || exit 2
fi
python3 - "$STATE" <<'PY_STATE' || exit 2
import os, stat, sys
path = sys.argv[1]
info = os.stat(path)
mode = info.st_mode
if not stat.S_ISDIR(mode) or (mode & 0o2770) != 0o2770 or (mode & 0o002):
    print("compile-queue test: state root must be a group-writable setgid directory (mode 2770)", file=sys.stderr)
    sys.exit(2)
PY_STATE
LOG=$T/compiler.log
FAKE=$T/fake-compiler
: > "$LOG"

cat > "$FAKE" <<'EOF'
#!/bin/sh
tag=fake
log=''
out=''
sleep_s=0
fail=0
gpu=0
suffix_sensitive=0
prev=''
for arg in "$@"; do
  case $prev in
    --tag) tag=$arg ;;
    --log) log=$arg ;;
    --sleep) sleep_s=$arg ;;
  esac
  case $arg in
    --fail) fail=1 ;;
    --gpu-build) gpu=1 ;;
    --suffix-sensitive) suffix_sensitive=1 ;;
  esac
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
now() { python3 -c 'import time;print(time.time_ns())'; }
[ -n "$log" ] && printf 'start %s %s %s\n' "$(now)" "$$" "$tag" >> "$log"
if [ "$fail" = 1 ]; then
  printf 'synthetic compiler failure %s\n' "$tag" >&2
  [ -n "$log" ] && printf 'end %s %s %s 3\n' "$(now)" "$$" "$tag" >> "$log"
  exit 3
fi
[ "$sleep_s" = 0 ] || sleep "$sleep_s"
if [ "$gpu" = 1 ]; then
  printf 'gpu-artifact-%s' "$tag" > "$0.gpu"
elif [ "$suffix_sensitive" = 1 ] && [ -n "$out" ]; then
  case "$out" in
    *.c) printf '/* textual C generated for %s */\n' "$tag" > "$out" ;;
    *) printf '\177ELF\002\001\001fake-binary-%s' "$tag" > "$out" ;;
  esac
elif [ -n "$out" ]; then
  printf 'artifact-%s' "$tag" > "$out"
fi
[ -n "$log" ] && printf 'end %s %s %s 0\n' "$(now)" "$$" "$tag" >> "$log"
exit 0
EOF
chmod +x "$FAKE"

mkdir -p "$T/src/bend2/src"
printf 'import Base\ndef main() -> IO(Unit): IO.die(Unit,0,"fixture")\n' > "$T/src/bend2/src/fixture.bend"
printf 'int main(void){return 0;}\n' > "$T/input.c"

# A queue job whose key, entry and compiler have no recorded peak runs only when
# no other such job runs. A compiler of its own gives a test a group of its own.
# A state root of its own for a test that needs nothing recorded.
fresh_state() {
  (umask 0007; mkdir -p -m 2770 "$T/state-$1")
  printf '%s\n' "$T/state-$1"
}

fresh_fake() {
  [ -x "$T/fake-$1" ] || { cp "$FAKE" "$T/fake-$1"; printf '# %s\n' "$1" >> "$T/fake-$1"; chmod +x "$T/fake-$1"; }
  printf '%s\n' "$T/fake-$1"
}

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }
count_starts() { (grep -c '^start' "$LOG" 2>/dev/null || true); }

run_cc() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT="${CQ_STATE:-$STATE}" sh "$QUEUE" run --kind cc --source-root "$T" --state-root "${CQ_STATE:-$STATE}" --cwd "$T" --compiler "${CQ_FAKE:-$FAKE}" --linker "${CQ_FAKE:-$FAKE}" --version fake-version \
    --input "$T/input.c" --artifact "binary=$out" --receipt "$out.receipt" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" --log "$LOG" -o "$out" "$T/input.c" "$@" >"$T/$(basename "$out").out" 2>"$T/$(basename "$out").err"
}

cc_key() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT="${CQ_STATE:-$STATE}" sh "$QUEUE" key --kind cc --source-root "$T" --state-root "${CQ_STATE:-$STATE}" --cwd "$T" --compiler "${CQ_FAKE:-$FAKE}" --linker "${CQ_FAKE:-$FAKE}" --version fake-version \
    --input "$T/input.c" --artifact "binary=$out" --option "test=$tag" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" --log "$LOG" -o "$out" "$T/input.c" "$@"
}

run_cgen() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT="${CQ_STATE:-$STATE}" sh "$QUEUE" run --kind cgen --state-root "${CQ_STATE:-$STATE}" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "${CQ_FAKE:-$FAKE}" \
    --artifact "c.c=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" --log "$LOG" -o "$out" "$@" >"$T/$(basename "$out").out" 2>"$T/$(basename "$out").err"
}

cgen_key() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT="${CQ_STATE:-$STATE}" sh "$QUEUE" key --kind cgen --state-root "${CQ_STATE:-$STATE}" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "${CQ_FAKE:-$FAKE}" \
    --artifact "c.c=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" --log "$LOG" -o "$out" "$@"
}

# A quoted include that names a directory fails during closure reads before execution.
mkdir "$T/local.h"
printf '#include "local.h"\nint main(void){return 0;}\n' > "$T/input.c"
: > "$LOG"
if run_cc closure-directory "$T/closure-directory-output"; then
  bad 'directory include passed closure validation'
else
  pass 'directory include failed source closure'
fi
[ "$(count_starts)" = 0 ] && pass 'failed source closure did not start the fake compiler' || bad 'failed source closure started the fake compiler'
printf 'int main(void){return 0;}\n' > "$T/input.c"

# A release-root compiler identity walks nested release files. Host list_dir
# returns newline-terminated rows, so this checks the terminal empty row too.
RELEASE="$T/compiler-release"
mkdir -p "$RELEASE/bin" "$RELEASE/bend2/nested/deeper"
printf '#!/bin/sh\nexit 0\n' > "$RELEASE/bin/bend"
printf '#!/bin/sh\nexit 0\n' > "$RELEASE/bin/bun"
chmod +x "$RELEASE/bin/bend" "$RELEASE/bin/bun"
printf 'export default 1;\n' > "$RELEASE/bend2/main.ts"
printf 'export const nested = 1;\n' > "$RELEASE/bend2/nested/deeper/module.ts"
release_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" \
  --compiler "$RELEASE/bin/bend" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/release-output" --option 'test=release-walk' \
  -- "$FAKE" -o "$T/release-output" "$T/input.c" 2>"$T/release-key.err") || release_key=''
[ -n "$release_key" ] && pass 'nested release identity completed with terminal directory row' \
  || { cat "$T/release-key.err" >&2; bad 'nested release identity failed'; }
printf 'export const nested = 2;\n' > "$RELEASE/bend2/nested/deeper/module.ts"
release_key_changed=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" \
  --compiler "$RELEASE/bin/bend" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/release-output" --option 'test=release-walk' \
  -- "$FAKE" -o "$T/release-output" "$T/input.c" 2>"$T/release-key-changed.err") || release_key_changed=''
[ -n "$release_key" ] && [ -n "$release_key_changed" ] && [ "$release_key" != "$release_key_changed" ] \
  && pass 'nested release contents affect compiler identity' \
  || { cat "$T/release-key-changed.err" >&2; bad 'nested release content was not bound to identity'; }

# Identical concurrent cc requests.
: > "$LOG"
run_cc ident "$T/ident1" & p1=$!
run_cc ident "$T/ident2" & p2=$!
wait "$p1" || bad 'identical cc first requester failed'
wait "$p2" || bad 'identical cc second requester failed'
[ "$(count_starts)" = 1 ] && pass 'identical cc shared one execution' || bad "identical cc starts=$(count_starts)"
[ -f "$T/ident1" ] && [ -f "$T/ident2" ] && cmp -s "$T/ident1" "$T/ident2" \
  && pass 'identical cc artifacts match' || bad 'identical cc artifacts differ'
grep -Fx "artifact-binary=$T/ident1" "$T/ident1.receipt" \
  && pass 'first requester receipt records its artifact binding' || bad 'first requester receipt artifact binding differs'
grep -Fx "artifact-binary=$T/ident2" "$T/ident2.receipt" \
  && pass 'waiting requester receipt records its artifact binding' || bad 'waiting requester receipt artifact binding differs'
# Successful results store bare artifact names and retain the declared bytes.
ident_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/ident1" --option 'test=ident' \
  --token tok-ident1 -- "$FAKE" --tag ident --log "$LOG" -o "$T/ident1" "$T/input.c")
printf 'artifact=binary\tfile\t' > "$T/artifact-row-prefix"
grep -F "$(cat "$T/artifact-row-prefix")" "$STATE/keys/$ident_key/completed/result" \
  && pass 'completed result records bare artifact name' || bad 'completed result artifact row missing'
[ "$(cat "$STATE/keys/$ident_key/completed/artifacts/binary")" = 'artifact-ident' ] \
  && pass 'completed result retains named artifact bytes' || bad 'completed artifact bytes missing'

# Artifact names are relative paths used under the attempt and cache roots.
invalid_artifact=0
sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "../escape=$T/escape" --token invalid-artifact \
  -- "$FAKE" -o "$T/escape" "$T/input.c" >/dev/null 2>&1 || invalid_artifact=$?
[ "$invalid_artifact" = 2 ] && pass 'artifact traversal rejected' || bad "artifact traversal exit $invalid_artifact"

# A request must use the configured host state root.
mismatch_rc=0
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$T/other-root" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/mismatch" --token mismatch-root \
  -- "$FAKE" -o "$T/mismatch" "$T/input.c" >/dev/null 2>&1 || mismatch_rc=$?
[ "$mismatch_rc" = 2 ] && pass 'state root mismatch rejected' || bad "state root mismatch exit $mismatch_rc"

# Missing and unusable host roots fail before a request is published.
missing_root_rc=0
env -u BATON_COMPILE_QUEUE_ROOT sh "$QUEUE" run --kind cc --source-root "$T" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/missing-root" --token missing-root \
  -- "$FAKE" -o "$T/missing-root" "$T/input.c" >/dev/null 2>&1 || missing_root_rc=$?
[ "$missing_root_rc" = 2 ] && pass 'missing state root rejected' || bad "missing state root exit $missing_root_rc"
printf 'not a directory\n' > "$T/not-a-root"
unusable_root_rc=0
env -u BATON_COMPILE_QUEUE_ROOT sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$T/not-a-root" \
  --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version --input "$T/input.c" --artifact "binary=$T/unusable-root" \
  --token unusable-root -- "$FAKE" -o "$T/unusable-root" "$T/input.c" >/dev/null 2>&1 || unusable_root_rc=$?
[ "$unusable_root_rc" = 2 ] && pass 'unusable state root rejected' || bad "unusable state root exit $unusable_root_rc"

# A declared but missing queue executable fails closed in the launcher.
missing_queue_rc=0
BATON2_COMPILE_QUEUE_BIN="$T/absent-queue" sh "$QUEUE" status --state-root "$STATE" \
  >/dev/null 2>&1 || missing_queue_rc=$?
[ "$missing_queue_rc" = 2 ] && pass 'missing queue executable rejected' || bad "missing queue executable exit $missing_queue_rc"

# cc requests require compiler, linker and version.
missing_cc=0
sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" \
  --input "$T/input.c" --artifact "binary=$T/missing-cc" -- \
  "$FAKE" -o "$T/missing-cc" "$T/input.c" >/dev/null 2>&1 || missing_cc=$?
[ "$missing_cc" = 2 ] && pass 'cc request without linker/version rejected' || bad "missing cc identity exit $missing_cc"

# Reuse.
# Cached results may contain forward-compatible fields that this version does
# not inspect. Keep enough of them to exercise linear result-row filtering.
n=1
while [ "$n" -le 64 ]; do
  printf 'future-field-%s=value-%s\n' "$n" "$n" >> "$STATE/keys/$ident_key/completed/result"
  n=$((n + 1))
done
before=$(count_starts)
run_cc ident "$T/reuse" || bad 'reuse request failed'
after=$(count_starts)
[ "$before" = "$after" ] && pass 'completed result reused' || bad "reuse starts $before -> $after"
[ "$(cat "$T/reuse")" = "artifact-ident" ] && pass 'reused artifact bytes match' || bad 'reused artifact differs'
grep -Fx "artifact-binary=$T/reuse" "$T/reuse.receipt" \
  && pass 'reused receipt records the bare artifact binding' || bad 'reused receipt artifact binding differs'

# Copying an artifact must work under an ordinary pre-existing output parent.
mkdir -p "$T/ordinary-output"
chmod 755 "$T/ordinary-output"
run_cc ordinary "$T/ordinary-output/program" || bad 'ordinary output directory request failed'
[ "$(cat "$T/ordinary-output/program")" = "artifact-ordinary" ] \
  && pass 'ordinary caller output directory accepted' || bad 'ordinary output directory copy failed'

# The staged executable writes its GPU sidecar beside argv[0]. The queue must
# capture the nested artifact path and copy it back to the requested location.
: > "$LOG"
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$FAKE" --artifact "inputs/fake-compiler.gpu=$T/fake-compiler.gpu" \
  --option 'gpu-sidecar=once' --token gpu-sidecar \
  -- "$FAKE" --tag gpu --log "$LOG" --gpu-build \
  >"$T/gpu.out" 2>"$T/gpu.err" \
  && pass 'nested GPU sidecar request completed without a receipt' || bad 'nested GPU sidecar request failed without a receipt'
[ "$(cat "$T/fake-compiler.gpu" 2>/dev/null)" = 'gpu-artifact-gpu' ] \
  && pass 'nested GPU sidecar copied to ordinary output path' || bad 'nested GPU sidecar missing'
[ "$(count_starts)" = 1 ] && pass 'GPU sidecar fake command ran once' || bad 'GPU sidecar fake command count differs'

# A producer selects its output format from the staged filename suffix.
# The suffixless artifact emits ELF and must fail before a completed cache row;
# preserving .c through staging emits text C and may complete.
: > "$LOG"
wrong_c_key=$(sh "$QUEUE" key --kind cgen --state-root "$STATE" --cwd "$T/src" --root "$T/src" \
  --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$FAKE" \
  --artifact "c=$T/suffixless.c" --option 'test=suffix-sensitive' \
  --token tok-suffixless -- "$FAKE" --tag suffix-sensitive --log "$LOG" --suffix-sensitive -o "$T/suffixless.c")
wrong_c_rc=0
sh "$QUEUE" run --kind cgen --state-root "$STATE" --cwd "$T/src" --root "$T/src" \
  --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$FAKE" \
  --artifact "c=$T/suffixless.c" --option 'test=suffix-sensitive' \
  --token tok-suffixless -- "$FAKE" --tag suffix-sensitive --log "$LOG" --suffix-sensitive -o "$T/suffixless.c" \
  >"$T/suffixless.out" 2>"$T/suffixless.err" || wrong_c_rc=$?
[ "$wrong_c_rc" != 0 ] && pass 'binary cgen output rejected' || bad 'binary cgen output was accepted'
grep -Fq 'compile-queue: cgen artifact c must be nonempty text C with a .c suffix' "$T/suffixless.err" \
  && pass 'binary cgen failure kept its diagnostic' || bad 'binary cgen failure diagnostic missing'
[ ! -f "$STATE/keys/$wrong_c_key/completed/result" ] && pass 'binary cgen output not cached as completed' || bad 'binary cgen output entered completed cache'
: > "$LOG"
run_cgen suffix-sensitive "$T/suffix-good.c" --suffix-sensitive || bad 'suffix-preserving cgen request failed'
grep -Fxq '/* textual C generated for suffix-sensitive */' "$T/suffix-good.c" \
  && pass 'artifact .c suffix reached suffix-sensitive producer' || bad 'producer did not emit C for staged .c suffix'
"$QUEUE" status --state-root "$STATE" --key "$(cgen_key suffix-sensitive "$T/suffix-good.c" --suffix-sensitive)" >/dev/null 2>&1 \
  && pass 'text C cgen result is queryable' || bad 'text C cgen result missing'

# Identical concurrent cgen requests.
: > "$LOG"
run_cgen cgen "$T/cgen1" & c1=$!
run_cgen cgen "$T/cgen2" & c2=$!
wait "$c1" || bad 'identical cgen first requester failed'
wait "$c2" || bad 'identical cgen second requester failed'
[ "$(count_starts)" = 1 ] && pass 'identical cgen shared one execution' || bad "identical cgen starts=$(count_starts)"
[ "$(cat "$T/cgen1")" = "$(cat "$T/cgen2")" ] && pass 'identical cgen artifacts match' || bad 'identical cgen artifacts differ'

# Distinct cgen requests without a recorded peak run one at a time.
: > "$LOG"
( CQ_STATE=$(fresh_state serial); run_cgen serial1 "$T/serial1" --sleep 1 ) & s1=$!
( CQ_STATE=$(fresh_state serial); run_cgen serial2 "$T/serial2" --sleep 1 ) & s2=$!
wait "$s1" || bad 'serial first requester failed'
wait "$s2" || bad 'serial second requester failed'
python3 - "$LOG" <<'PY' && pass 'distinct cgen without history serialized' || bad 'distinct cgen intervals overlap'
import sys
rows=[]
for line in open(sys.argv[1]):
    parts=line.split()
    if len(parts)>=3 and parts[0] in ('start','end'):
        rows.append((parts[2],parts[0],int(parts[1])))
intervals={}
for tag,kind,ts in rows:
    intervals.setdefault(tag,{})[kind]=ts
values=[(v['start'],v['end']) for v in intervals.values() if 'start' in v and 'end' in v]
for i in range(len(values)):
    for j in range(i+1,len(values)):
        if values[i][0] < values[j][1] and values[j][0] < values[i][1]:
            sys.exit(1)
PY

assert_serialized() {
  python3 - "$LOG" <<'PY'
import sys
rows=[]
for line in open(sys.argv[1]):
    parts=line.split()
    if len(parts)>=3 and parts[0] in ('start','end'):
        rows.append((parts[2],parts[0],int(parts[1])))
intervals={}
for tag,kind,ts in rows:
    intervals.setdefault(tag,{})[kind]=ts
values=[(v['start'],v['end']) for v in intervals.values() if 'start' in v and 'end' in v]
if len(values) < 2:
    sys.exit(2)
for i in range(len(values)):
    for j in range(i+1,len(values)):
        if values[i][0] < values[j][1] and values[j][0] < values[i][1]:
            sys.exit(1)
PY
}

# Distinct cc requests without a recorded peak run one at a time.
: > "$LOG"
( CQ_STATE=$(fresh_state cc-serial); run_cc cc1 "$T/cc1" --sleep 1 ) & q1=$!
( CQ_STATE=$(fresh_state cc-serial); run_cc cc2 "$T/cc2" --sleep 1 ) & q2=$!
wait "$q1" || bad 'first cc requester failed'
wait "$q2" || bad 'second cc requester failed'
assert_serialized && pass 'distinct cc without history serialized' || bad 'distinct cc intervals overlap'

# A cgen job and a cc job without a recorded peak share the one slot for jobs
# without history.
: > "$LOG"
( CQ_STATE=$(fresh_state mixed); run_cgen mixed-cgen "$T/mixed.c" --sleep 1 ) & m1=$!
( CQ_STATE=$(fresh_state mixed); run_cc mixed-cc "$T/mixed-bin" --sleep 1 ) & m2=$!
wait "$m1" || bad 'mixed cgen requester failed'
wait "$m2" || bad 'mixed cc requester failed'
assert_serialized && pass 'cgen and cc serialized together' || bad 'cgen and cc intervals overlap'

# The retained reference launcher and the installed native queue share the
# admission rule. Run their distinct cgen requests, which have no recorded
# peak, concurrently and assert the compiler intervals do not overlap.
REFERENCE=${BATON_COMPILE_QUEUE_REFERENCE:-}
if [ -n "$REFERENCE" ] && [ -x "$REFERENCE" ]; then
  : > "$LOG"
  CROSS_FAKE=$(fresh_fake cross)
  CROSS_STATE=$(fresh_state cross)
  ( CQ_FAKE=$CROSS_FAKE; CQ_STATE=$CROSS_STATE; run_cgen cross-native "$T/cross-native.c" --sleep 1 ) & n1=$!
  BATON_COMPILE_QUEUE_ROOT="$CROSS_STATE" "$REFERENCE" run --kind cgen --state-root "$CROSS_STATE" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$CROSS_FAKE" \
    --artifact "c.c=$T/cross-reference.c" --option test=cross-reference \
    -- "$CROSS_FAKE" --tag cross-reference --log "$LOG" -o "$T/cross-reference.c" --sleep 1 \
    >"$T/cross-reference.out" 2>"$T/cross-reference.err" & n2=$!
  wait "$n1" || bad 'native cross-launcher requester failed'
  wait "$n2" || bad 'reference cross-launcher requester failed'
  assert_serialized && pass 'native and reference jobs without history serialized' \
    || bad 'native and reference compiler intervals overlap'
else
  printf 'SKIP reference launcher not configured: set BATON_COMPILE_QUEUE_REFERENCE\n'
fi

# Shared failure and retry.
: > "$LOG"
run_cc failure "$T/failure1" --fail & f1=$!
run_cc failure "$T/failure2" --fail & f2=$!
r1=0; r2=0
wait "$f1" || r1=$?
wait "$f2" || r2=$?
[ "$r1" != 0 ] && [ "$r2" != 0 ] && pass 'failure reached both requesters' || bad "failure exits $r1,$r2"
grep -q 'synthetic compiler failure' "$T/failure1.err" && grep -q 'synthetic compiler failure' "$T/failure2.err" \
  && pass 'failure diagnostics shared' || bad 'failure diagnostics missing'
[ "$(count_starts)" = 1 ] && pass 'failure shared one execution' || bad "failure starts=$(count_starts)"
# A failed result with exit=0 is still an error; malformed result exit codes fail closed.
zero_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/zero-exit" --option 'test=zero-exit' -- \
  "$FAKE" --tag zero-exit --log "$LOG" -o "$T/zero-exit" "$T/input.c")
mkdir -p "$STATE/keys/$zero_key/runs/zero-exit"
cat > "$STATE/keys/$zero_key/runs/zero-exit/result" <<EOF
status=failed
exit=0
kind=cc
key=$zero_key
finished_ns=1
detail=zero exit must fail
EOF
zero_rc=0
sh "$QUEUE" wait --state-root "$STATE" --key "$zero_key" >"$T/zero-exit.out" 2>"$T/zero-exit.err" || zero_rc=$?
[ "$zero_rc" = 1 ] && pass 'zero exit in failed result maps to one' || bad "zero exit fallback $zero_rc"
grep -Fq "execution failed key=$zero_key exit=0" "$T/zero-exit.err" \
  && pass 'zero exit diagnostic retains persisted fields' || bad 'zero exit diagnostic missing persisted fields'

malformed_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/malformed-exit" --option 'test=malformed-exit' -- \
  "$FAKE" --tag malformed-exit --log "$LOG" -o "$T/malformed-exit" "$T/input.c")
mkdir -p "$STATE/keys/$malformed_key/runs/malformed-exit"
cat > "$STATE/keys/$malformed_key/runs/malformed-exit/result" <<EOF
status=failed
exit=invalid
kind=cc
key=$malformed_key
finished_ns=1
detail=malformed exit must fail
EOF
malformed_rc=0
sh "$QUEUE" wait --state-root "$STATE" --key "$malformed_key" >"$T/malformed-exit.out" 2>"$T/malformed-exit.err" || malformed_rc=$?
[ "$malformed_rc" = 1 ] && pass 'malformed result exit maps to one' || bad "malformed exit fallback $malformed_rc"
grep -Fq "execution failed key=$malformed_key exit=invalid" "$T/malformed-exit.err" \
  && pass 'malformed result diagnostic retains persisted fields' || bad 'malformed result diagnostic missing persisted fields'

wrapped_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/wrapped-exit" --option 'test=wrapped-exit' -- \
  "$FAKE" --tag wrapped-exit --log "$LOG" -o "$T/wrapped-exit" "$T/input.c")
mkdir -p "$STATE/keys/$wrapped_key/runs/wrapped-exit"
cat > "$STATE/keys/$wrapped_key/runs/wrapped-exit/result" <<EOF
status=failed
exit=256
kind=cc
key=$wrapped_key
finished_ns=1
detail=wrapped exit must fail
EOF
wrapped_rc=0
sh "$QUEUE" wait --state-root "$STATE" --key "$wrapped_key" >"$T/wrapped-exit.out" 2>"$T/wrapped-exit.err" || wrapped_rc=$?
[ "$wrapped_rc" = 1 ] && pass 'out-of-range result exit maps to one' || bad "out-of-range exit fallback $wrapped_rc"
grep -Fq "execution failed key=$wrapped_key exit=256" "$T/wrapped-exit.err" \
  && pass 'out-of-range diagnostic retains persisted fields' || bad 'out-of-range diagnostic missing persisted fields'
before=$(count_starts)
run_cc failure "$T/retry" --fail || true
[ "$(count_starts)" -gt "$before" ] && pass 'failed attempt retried' || bad 'failed attempt not retried'

# Cancellation.
: > "$LOG"
run_cc cancelcase "$T/cancelcase" --sleep 30 & k=$!
key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/cancelcase" --option 'test=cancelcase' \
  -- "$FAKE" --tag cancelcase --log "$LOG" -o "$T/cancelcase" "$T/input.c" --sleep 30)
i=0
while [ "$i" -lt 200 ]; do
  (grep -q '^start' "$LOG" 2>/dev/null) && break
  i=$((i + 1))
  sleep 0.05
done
sh "$QUEUE" cancel --state-root "$STATE" --key "$key" --token tok-cancelcase >/dev/null 2>&1
krc=0
wait "$k" || krc=$?
[ "$krc" = 130 ] && pass 'cancellation returned 130' || bad "cancellation exit $krc"
[ "$(count_starts)" = 1 ] && pass 'cancellation stopped after one execution' || bad "cancel starts=$(count_starts)"

# Cancel the final requester while its supervisor waits behind another key.
# The supervisor must publish a terminal result without starting the command.
: > "$LOG"
CANCEL_FAKE=$(fresh_fake queued-cancel)
CANCEL_STATE=$(fresh_state queued-cancel)
( CQ_FAKE=$CANCEL_FAKE; CQ_STATE=$CANCEL_STATE; run_cc occupies-queue "$T/occupies-queue" --sleep 3 ) & blocker=$!
i=0
while [ "$i" -lt 200 ]; do
  (grep -q '^start' "$LOG" 2>/dev/null) && break
  i=$((i + 1))
  sleep 0.05
done
qkey=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$CANCEL_FAKE" --linker "$CANCEL_FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/queued-cancel" --option 'test=queued-cancel' \
  -- "$CANCEL_FAKE" --tag queued-cancel --log "$LOG" -o "$T/queued-cancel" "$T/input.c")
( CQ_FAKE=$CANCEL_FAKE; CQ_STATE=$CANCEL_STATE; run_cc queued-cancel "$T/queued-cancel" ) & queued=$!
i=0
while [ "$i" -lt 200 ]; do
  [ -f "$CANCEL_STATE/keys/$qkey/active" ] && break
  i=$((i + 1))
  sleep 0.05
done
[ -f "$CANCEL_STATE/keys/$qkey/active" ] && pass 'queued supervisor published cancellable ownership' || bad 'queued supervisor never became visible'
BATON_COMPILE_QUEUE_ROOT="$CANCEL_STATE" sh "$QUEUE" cancel --state-root "$CANCEL_STATE" --key "$qkey" --token tok-queued-cancel >"$T/queued-cancel.cancel" 2>&1 || bad 'queued cancellation command failed'
wait "$blocker" || bad 'queue blocker failed'
qrc=0
wait "$queued" || qrc=$?
[ "$qrc" != 0 ] && pass 'queued canceled requester received terminal failure' || bad 'queued canceled requester succeeded'
[ "$(grep -c '^start' "$LOG" 2>/dev/null || true)" = 1 ] && pass 'canceled queued command never started' || bad 'canceled queued command started'

# One owner withdraws; another owner keeps the shared execution.
: > "$LOG"
run_cc owner "$T/ownerA" --sleep 2 & o1=$!
sleep 0.3
run_cc owner "$T/ownerB" --sleep 2 & o2=$!
sleep 0.5
ownkey=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/ownerA" --option 'test=owner' \
  -- "$FAKE" --tag owner --log "$LOG" -o "$T/ownerA" "$T/input.c" --sleep 2)
sh "$QUEUE" cancel --state-root "$STATE" --key "$ownkey" --token tok-ownerA >/dev/null 2>&1
o2rc=0
wait "$o2" || o2rc=$?
[ "$o2rc" = 0 ] && pass 'remaining owner completed after one withdrew' || bad "remaining owner exit $o2rc"
[ "$(count_starts)" = 1 ] && pass 'owner withdrawal kept one execution' || bad "owner withdraw starts=$(count_starts)"
wait "$o1" 2>/dev/null || true

# Requester loss with a surviving requester.
: > "$LOG"
run_cc loss "$T/loss1" --sleep 2 & l1=$!
sleep 0.3
run_cc loss "$T/loss2" --sleep 2 & l2=$!
sleep 0.3
kill -9 "$l1" 2>/dev/null || true
lrc=0
wait "$l2" || lrc=$?
[ "$lrc" = 0 ] && pass 'surviving requester completed' || bad "survivor exit $lrc"
[ "$(count_starts)" = 1 ] && pass 'requester loss shared one execution' || bad "loss starts=$(count_starts)"

# A live or uncertain active record refuses a fresh admission.
: > "$LOG"
livekey=$(cc_key live "$T/live")
(umask 0007; mkdir -m 2770 -p "$STATE/keys/$livekey")
live_start=$(awk '{print $22}' "/proc/$$/stat")
printf 'pid=%s\nstarttime=%s\nkind=cc\nsetsid=1\nstarted_ns=0\n' "$$" "$live_start" > "$STATE/keys/$livekey/active"
if run_cc live "$T/live"; then bad 'live active admitted'; else pass 'live active refused'; fi
grep -q 'refusing a fresh admission' "$T/live.err" && pass 'live active diagnostic reported' || bad 'live active diagnostic missing'
[ "$(count_starts)" = 0 ] && pass 'live active did not start a compiler' || bad "live active starts=$(count_starts)"
rm -f "$STATE/keys/$livekey/active"

: > "$LOG"
unckey=$(cc_key uncertain "$T/uncertain")
(umask 0007; mkdir -m 2770 -p "$STATE/keys/$unckey")
printf 'pid=%s\n' "$$" > "$STATE/keys/$unckey/active"
if run_cc uncertain "$T/uncertain"; then bad 'uncertain active admitted'; else pass 'uncertain active refused'; fi
grep -q 'uncertain' "$T/uncertain.err" && pass 'uncertain active diagnostic reported' || bad 'uncertain active diagnostic missing'
[ "$(count_starts)" = 0 ] && pass 'uncertain active did not start a compiler' || bad "uncertain active starts=$(count_starts)"
rm -f "$STATE/keys/$unckey/active"

# One configured host state root: a relative configured root is refused and
# an absolute one is used without --state-root.
if env BATON_COMPILE_QUEUE_ROOT=relative/path sh "$QUEUE" key --kind cc --source-root "$T" --cwd "$T" \
    --compiler "$FAKE" --linker "$FAKE" --version fake-version \
    --input "$T/input.c" --artifact "binary=$T/rootref" \
    -- "$FAKE" -o "$T/rootref" "$T/input.c" >"$T/rootref.out" 2>"$T/rootref.err"; then
  bad 'relative BATON_COMPILE_QUEUE_ROOT accepted'
else
  pass 'relative BATON_COMPILE_QUEUE_ROOT refused'
fi
env BATON_COMPILE_QUEUE_ROOT="$STATE" sh "$QUEUE" key --kind cc --source-root "$T" --cwd "$T" \
  --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/rooted" \
  --option 'test=rooted' -- "$FAKE" -o "$T/rooted" "$T/input.c" >"$T/rooted.out" 2>"$T/rooted.err" \
  && pass 'absolute BATON_COMPILE_QUEUE_ROOT used without --state-root' \
  || bad 'absolute BATON_COMPILE_QUEUE_ROOT refused'

# The ccache executable bytes enter the cc toolchain identity.
printf '#!/bin/sh\nexit 0\n' > "$T/ccache-one"; chmod +x "$T/ccache-one"
printf '#!/bin/sh\nexit 1\n' > "$T/ccache-two"; chmod +x "$T/ccache-two"
key_none=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T/src" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/ccache-out" -- \
  "$FAKE" -o "$T/ccache-out" "$T/input.c")
key_ccache_one=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T/src" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/ccache-out" -- \
  "$FAKE" --ccache "$T/ccache-one" -o "$T/ccache-out" "$T/input.c")
key_ccache_two=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T/src" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/ccache-out" -- \
  "$FAKE" --ccache "$T/ccache-two" -o "$T/ccache-out" "$T/input.c")
key_ccache_equal=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T/src" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/ccache-out" -- \
  "$FAKE" --ccache="$T/ccache-one" -o "$T/ccache-out" "$T/input.c")
[ "$key_none" != "$key_ccache_one" ] && pass 'ccache executable changes the key' || bad 'ccache executable kept the key'
[ "$key_ccache_one" != "$key_ccache_two" ] && pass 'ccache bytes change the key' || bad 'ccache bytes kept the key'
[ "$key_none" != "$key_ccache_equal" ] && pass 'ccache= form changes the key' || bad 'ccache= form kept the key'

ccache_extra_key() {
  sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T/src" --compiler "$FAKE" \
    --linker "$FAKE" --version fake-version --input "$T/input.c" \
    --artifact "binary=$T/ccache-out" "$@" -- \
    "$FAKE" --ccache "$T/ccache-one" -o "$T/ccache-out" "$T/input.c"
}
printf 'compiler_check = content\n' > "$T/ccache-config-one"
printf 'compiler_check = mtime\n' > "$T/ccache-config-two"
config_one_sha=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$T/ccache-config-one")
config_two_sha=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$T/ccache-config-two")
key_config_one=$(ccache_extra_key --option "ccache-config-sha=$config_one_sha")
key_config_two=$(ccache_extra_key --option "ccache-config-sha=$config_two_sha")
[ "$key_config_one" != "$key_config_two" ] && pass 'ccache config digest changes the key' || bad 'ccache config digest kept the key'
key_env_one=$(ccache_extra_key --option 'ccache-env=CCACHE_COMPILERCHECK=content')
key_env_two=$(ccache_extra_key --option 'ccache-env=CCACHE_COMPILERCHECK=mtime')
[ "$key_env_one" != "$key_env_two" ] && pass 'ccache environment option changes the key' || bad 'ccache environment option kept the key'

# Source identity changes the key.
key1=$(cgen_key keyfile "$T/keyfile")
printf 'def extra() -> Unit: Unit{}\n' >> "$T/src/bend2/src/fixture.bend"
key2=$(cgen_key keyfile "$T/keyfile")
[ "$key1" != "$key2" ] && pass 'source change changes the key' || bad 'source change kept the key'
printf 'import Base\ndef main() -> IO(Unit): IO.die(Unit,0,"fixture")\n' > "$T/src/bend2/src/fixture.bend"

# Explicit scalar options override defaults and reach execution and key.
echo '=== explicit configuration ===' | tee -a "$T/results.txt"
explicit_key() { # compiler root
  sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --root "$2" \
    --compiler "$1" --linker "$1" --version fake-version \
    --input "$T/input.c" --artifact "binary=$T/explicit" \
    --option 'test=explicit' \
    -- "$1" --tag explicit --log "$LOG" -o "$T/explicit" "$T/input.c"
}
k1=$(explicit_key "$FAKE" "$T")
k1b=$(explicit_key "$FAKE" "$T")
[ -n "$k1" ] && [ "$k1" = "$k1b" ] && pass 'explicit key is stable' || bad 'explicit key unstable'
cp "$FAKE" "$T/fake-compiler-2"
printf '\n# variant\n' >> "$T/fake-compiler-2"
chmod +x "$T/fake-compiler-2"
k2=$(explicit_key "$T/fake-compiler-2" "$T")
[ "$k1" != "$k2" ] && pass 'explicit compiler reaches key' || bad 'compiler ignored in key'
k3=$(explicit_key "$FAKE" "$T/other-root")
[ "$k1" != "$k3" ] && pass 'explicit root reaches key' || bad 'root ignored in key'
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" \
  --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "probe=$T/probe" \
  -- sh -c 'pwd > cwd-probe; printf x > "$1"' sh "$T/probe" >/dev/null 2>&1 \
  && pass 'explicit run options accepted' || bad 'explicit run failed'
[ -f "$T/cwd-probe" ] && pass 'explicit cwd reaches execution' || bad 'cwd ignored in execution'
[ -d "$STATE/keys" ] && pass 'explicit state root used' || bad 'state root ignored'

# The native runtime consumes its own -- delimiter. The public launcher adds
# that boundary so the queue still receives its command delimiter and argv.
# This command records argv without treating runtime-reserved options as flags.
capture="$T/runtime-argv.capture"
expected="$T/runtime-argv.expected"
recorder="$T/argv-recorder"
cat > "$recorder" <<'EOF'
#!/bin/sh
: > "$BATON2_TEST_CAPTURE_ARGV"
out=''
prev=''
for arg in "$@"; do
  printf '%s\n' "$arg" >> "$BATON2_TEST_CAPTURE_ARGV"
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
[ -n "$out" ] && printf 'argv-recorder-artifact' > "$out"
EOF
chmod +x "$recorder"
export BATON2_TEST_CAPTURE_ARGV="$capture"
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" \
  --compiler "$recorder" --linker "$recorder" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/runtime-argv-output" \
  --token tok-runtime-argv --option test=runtime-argv -- \
  "$recorder" --tag runtime-argv --log "$LOG" -o "$T/runtime-argv-output" \
  "$T/input.c" --help --gpu-build --threads 9 --gpu off -- \
  >"$T/runtime-argv.out" 2>"$T/runtime-argv.err" \
  && pass 'runtime reserved arguments reached the command' || bad 'runtime argv command failed'
unset BATON2_TEST_CAPTURE_ARGV
# command is the queue's immutable execution receipt. It records staged
# input/output paths and every argument in execution order.
receipt=$(find "$STATE/keys" -type f -path '*/runs/*/command' \
  -exec grep -lF -- "$recorder" {} + | head -n 1)
if [ -n "$receipt" ]; then
  tail -n +2 "$receipt" > "$T/runtime-argv.receipt-args"
fi
if [ -n "$receipt" ] && cmp -s "$T/runtime-argv.receipt-args" "$capture"; then
  pass 'recorded argv matches the staged command receipt in order'
else
  bad 'recorded argv differs from the staged command receipt'
fi
printf '%s\n' --help --gpu-build --threads 9 --gpu off -- > "$expected"
tail -n 7 "$capture" > "$T/runtime-argv.tail"
cmp -s "$expected" "$T/runtime-argv.tail" \
  && pass 'runtime reserved options and literal -- preserved in order' \
  || bad 'runtime reserved options or literal -- changed'
[ -s "$T/runtime-argv-output" ] \
  && pass 'argv recorder published its declared binary' || bad 'argv recorder output missing'

# Adoption spawns the guard through the runtime delimiter. A run request is
# held at its key lock while the external process is adopted. The external fake
# compiler stays alive briefly; the guard must dispatch with its argv intact
# and publish the adopted result and artifact.
adopt_artifact="$T/adopt-artifact"
mkdir -p "$T/bend2"
: > "$T/bend2/main.ts"
adopt_hold_output="$T/adopt-hold-output"
adopt_hold_key=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" \
  --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$adopt_hold_output" --option 'test=adopt-hold' \
  -- "$FAKE" --tag adopt-hold --log "$LOG" -o "$adopt_hold_output" "$T/input.c")
mkdir -p "$STATE/keys/$adopt_hold_key"
(
  flock -x 9 || exit 1
  sleep 15
) 9>"$STATE/keys/$adopt_hold_key/lock" &
adopt_lock_pid=$!
sleep 1
run_cc adopt-hold "$adopt_hold_output" --sleep 3 >"$T/adopt-hold.out" 2>"$T/adopt-hold.err" &
adopt_run_pid=$!
(cd "$T" && "$FAKE" "$T/bend2/main.ts" input.c --tag adopt --log "$LOG" \
  -o "$adopt_artifact" --sleep 5) &
adopt_pid=$!
adopt_out=$(sh "$QUEUE" adopt --pid "$adopt_pid" --state-root "$STATE" \
  --artifact "binary=$adopt_artifact" 2>"$T/adopt.err") \
  && pass 'adoption admitted the external compiler' || bad 'adoption admission failed'
printf '%s\n' "$adopt_out" | grep -q '^adopted=1$' \
  && pass 'adoption dispatched the guard' || bad 'adoption did not dispatch the guard'
adopt_key=$(printf '%s\n' "$adopt_out" | sed -n 's/^key=//p')
kill "$adopt_lock_pid" 2>/dev/null || true
wait "$adopt_lock_pid" 2>/dev/null || true
wait "$adopt_pid" 2>/dev/null || true
adopt_wait=0
while [ ! -f "$STATE/keys/$adopt_key/completed/result" ] && [ "$adopt_wait" -lt 40 ]; do
  sleep 0.5
  adopt_wait=$((adopt_wait + 1))
done
if [ -f "$STATE/keys/$adopt_key/completed/result" ]; then
  grep -q '^external=1$' "$STATE/keys/$adopt_key/completed/result" \
    && pass 'guard published the external result' || bad 'guard result is not external'
  grep -q '^verified=1$' "$STATE/keys/$adopt_key/completed/result" \
    && pass 'guard verified the adopted artifact' || bad 'guard adoption is unverified'
  grep -qF -- '--tag' "$STATE/keys/$adopt_key/completed/result" \
    && pass 'guard recorded the preserved command argv' || bad 'guard command argv was not preserved'
  cmp -s "$STATE/keys/$adopt_key/completed/artifacts/binary" "$adopt_artifact" \
    && pass 'guard published the adopted artifact bytes' || bad 'guard artifact differs'
  grep -Eq '^external-inputs-sha256=[0-9a-f]{64}$' "$STATE/keys/$adopt_key/completed/result" \
    && pass 'guard bound every adopted input in one result field' || bad 'guard input binding digest missing'
  adopt_keydir="$STATE/keys/$adopt_key"
  guard_pid=$(sed -n 's/^pid=//p' "$adopt_keydir/adoption")
  guard_start=$(sed -n 's/^starttime=//p' "$adopt_keydir/adoption")
  if (
    exec 9>"$adopt_keydir/lock"
    exec 8>"$STATE/heavy.lock"
    sh "$QUEUE" __guard "$adopt_keydir" "$guard_pid" "$guard_start" binary "$adopt_artifact"
  ) >"$T/adopt-guard-valid" 2>&1; then
    pass 'guard accepted the unchanged multi-input adoption record'
  else
    bad 'guard rejected the unchanged multi-input adoption record'
  fi
  python3 - "$adopt_keydir/adoption" <<'PY_TAMPER'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
lines = path.read_text().splitlines()
indices = [i for i, line in enumerate(lines) if line.startswith("input=")]
if len(indices) < 2:
    raise SystemExit("adoption fixture did not record multiple inputs")
fields = lines[indices[1]].split("\t")
if len(fields) != 3:
    raise SystemExit("second adoption input row is malformed")
fields[2] = "0" * 64
lines[indices[1]] = "\t".join(fields)
path.write_text("\n".join(lines) + "\n")
PY_TAMPER
  guard_status=0
  if (
    exec 9>"$adopt_keydir/lock"
    exec 8>"$STATE/heavy.lock"
    sh "$QUEUE" __guard "$adopt_keydir" "$guard_pid" "$guard_start" binary "$adopt_artifact"
  ) >"$T/adopt-guard-tampered" 2>&1; then
    guard_status=0
  else
    guard_status=$?
  fi
  if [ "$guard_status" -eq 1 ] \
    && grep -Fxq 'compile-queue: completed result is not a verified adoption record' "$T/adopt-guard-tampered"; then
    pass 'guard rejected tampering with a non-first adopted input'
  else
    bad 'guard did not reject tampered non-first adopted input'
  fi
else
  bad 'guard did not publish the adopted result'
fi
wait "$adopt_run_pid" 2>/dev/null || true

# Memory admission. Peaks are recorded for every run and history is seeded
# relative to the memory the host has now: a large job needs more than half of
# what the rule can grant, so a second large job waits while a small job fits
# beside the first one. A run that lasts longer than one sample interval records
# the growth of memory used outside the queue; the tests below set it to a known
# value.
ident_peak=$(sed -n 's/^peak_kb=//p' "$STATE/keys/$ident_key/peak" 2>/dev/null || true)
[ -n "$ident_peak" ] && [ "$ident_peak" -gt 0 ] 2>/dev/null \
  && pass 'run recorded the peak memory of its key' || bad 'run did not record the peak memory of its key'
ls "$STATE"/peaks/* >/dev/null 2>&1 \
  && pass 'run recorded the peak of its compiler and entry group' || bad 'run did not record the group peak'
if [ -r /proc/meminfo ]; then
  sh "$QUEUE" status --state-root "$STATE" > "$T/status.out"
  grep -q '^memory total_kb=' "$T/status.out" \
    && pass 'status reports the memory the rule works from' || bad 'status omits memory'
  mem_avail=$(awk '/^MemAvailable:/{print $2}' /proc/meminfo)
  # The rule reserves the recorded growth of memory used outside the queue.
  printf 'growth_kb=%s\n' 1024 > "$STATE/outside-growth"
  room=$((mem_avail - 1024))
  if [ "$room" -lt 131072 ]; then
    printf 'SKIP memory admission: %s kB available beyond the reserve\n' "$room"
  else
    large=$((room * 7 / 10))
    ADMIT_FAKE=$(fresh_fake admission)
    for tag in adm-large1 adm-large2 adm-small; do
      case $tag in adm-small) kb=64 ;; *) kb=$large ;; esac
      case $tag in adm-large1) sleep_for=8 ;; *) sleep_for=1 ;; esac
      k=$(CQ_FAKE=$ADMIT_FAKE; cc_key "$tag" "$T/$tag" --sleep "$sleep_for")
      (umask 0007; mkdir -p -m 2770 "$STATE/keys/$k")
      printf 'peak_kb=%s\n' "$kb" > "$STATE/keys/$k/peak"
    done
    : > "$LOG"
    ( CQ_FAKE=$ADMIT_FAKE; run_cc adm-large1 "$T/adm-large1" --sleep 8 ) & a1=$!
    i=0
    while [ "$i" -lt 200 ] && ! grep -q 'adm-large1' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
    ( CQ_FAKE=$ADMIT_FAKE; run_cc adm-large2 "$T/adm-large2" --sleep 1 ) & a2=$!
    i=0
    while [ "$i" -lt 200 ]; do
      sh "$QUEUE" status --state-root "$STATE" > "$T/status.out"
      grep -q '^waiting ' "$T/status.out" && break
      i=$((i + 1)); sleep 0.05
    done
    ( CQ_FAKE=$ADMIT_FAKE; run_cc adm-small "$T/adm-small" --sleep 1 ) & a3=$!
    wait "$a1" || bad 'first large requester failed'
    wait "$a2" || bad 'second large requester failed'
    wait "$a3" || bad 'small requester failed'
    python3 - "$LOG" <<'PY' && pass 'small job ran beside a large job and a second large job waited' || bad 'admission order is wrong'
import sys
at = {}
for line in open(sys.argv[1]):
    parts = line.split()
    if len(parts) >= 4 and parts[0] in ('start', 'end'):
        at[(parts[3], parts[0])] = int(parts[1])
if not (at[('adm-small', 'start')] < at[('adm-large1', 'end')]):
    sys.exit('the small job did not start while the first large job ran')
if not (at[('adm-large2', 'start')] >= at[('adm-large1', 'end')]):
    sys.exit('the second large job started while the first large job ran')
PY
  fi
else
  printf 'SKIP memory admission: no /proc/meminfo\n'
fi

# One compiler and entry with different commands, such as a type check and a full
# C generation, need different memory and record peaks in different groups. The
# same command with a different option and output path shares a group.
GROUP_FAKE=$(fresh_fake group)
group_run() { # name extra...
  name=$1
  shift
  sh "$QUEUE" run --kind cgen --state-root "$STATE" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$GROUP_FAKE" \
    --artifact "c.c=$T/group-$name.c" --option "test=group-$name" \
    -- "$GROUP_FAKE" "$@" -o "$T/group-$name.c" >"$T/group-$name.out" 2>"$T/group-$name.err"
}
group_files() { ls "$STATE/peaks" | grep -c -E '^[0-9a-f]{64}$' || true; }
groups_before=$(group_files)
group_run same-one || bad 'group request one failed'
group_run same-two || bad 'group request two failed'
group_run other --check-only || bad 'group request three failed'
groups_after=$(group_files)
[ $((groups_after - groups_before)) = 2 ] \
  && pass 'commands that differ record separate group peaks; the same command shares one' \
  || bad "group peaks added: $((groups_after - groups_before)), expected 2"

# Without a recorded growth of memory used outside the queue the rule starts one
# job at a time, whatever the recorded peaks. The first run longer than one
# sample interval records the growth, and later jobs with recorded peaks run
# together.
if [ -r /proc/meminfo ]; then
  STATE_OG=$T/state-outside-growth
  (umask 0007; mkdir -m 2770 "$STATE_OG")
  OG_FAKE=$(fresh_fake outside-growth)
  og_run() { # tag sleep
    BATON_COMPILE_QUEUE_ROOT=$STATE_OG sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE_OG" --cwd "$T" \
      --compiler "$OG_FAKE" --linker "$OG_FAKE" --version fake-version --input "$T/input.c" \
      --artifact "binary=$T/$1" --option "test=$1" \
      -- "$OG_FAKE" --tag "$1" --log "$LOG" -o "$T/$1" "$T/input.c" --sleep "$2" >"$T/$1.out" 2>"$T/$1.err"
  }
  og_key() {
    BATON_COMPILE_QUEUE_ROOT=$STATE_OG sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE_OG" --cwd "$T" \
      --compiler "$OG_FAKE" --linker "$OG_FAKE" --version fake-version --input "$T/input.c" \
      --artifact "binary=$T/$1" --option "test=$1" \
      -- "$OG_FAKE" --tag "$1" --log "$LOG" -o "$T/$1" "$T/input.c" --sleep "$2"
  }
  for tag in og-a og-b og-c og-d; do
    case $tag in og-a|og-b) og_sleep=3 ;; *) og_sleep=8 ;; esac
    k=$(og_key "$tag" "$og_sleep")
    (umask 0007; mkdir -p -m 2770 "$STATE_OG/keys/$k")
    printf 'peak_kb=64\n' > "$STATE_OG/keys/$k/peak"
  done
  : > "$LOG"
  og_run og-a 3 & o1=$!
  i=0
  while [ "$i" -lt 200 ] && ! grep -q 'og-a' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
  og_run og-b 3 & o2=$!
  wait "$o1" || bad 'outside growth: first requester failed'
  wait "$o2" || bad 'outside growth: second requester failed'
  assert_serialized && pass 'jobs with recorded peaks run one at a time until a growth is recorded' \
    || bad 'jobs ran together without a recorded growth'
  grep -q '^growth_kb=[0-9][0-9]*$' "$STATE_OG/outside-growth" 2>/dev/null \
    && pass 'a run longer than one sample interval recorded the growth of outside use' \
    || bad 'no growth recorded'
  : > "$LOG"
  og_run og-c 8 & o3=$!
  i=0
  while [ "$i" -lt 200 ] && ! grep -q 'og-c' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
  og_run og-d 8 & o4=$!
  wait "$o3" || bad 'outside growth: third requester failed'
  wait "$o4" || bad 'outside growth: fourth requester failed'
  assert_serialized && bad 'jobs with recorded peaks stayed serialized after a growth was recorded' \
    || pass 'jobs with recorded peaks run together once a growth is recorded'
fi

# A command that exits without writing a declared artifact ends with a failure
# record that names the artifact.
: > "$LOG"
missing_status=0
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" \
  --version fake-version --artifact "binary=$T/missing-output" --option test=missing-artifact \
  -- "$FAKE" --tag missing-artifact >"$T/missing.out" 2>"$T/missing.err" || missing_status=$?
[ "$missing_status" != 0 ] && grep -q 'artifact binary was not written' "$T/missing.err" \
  && pass 'a missing artifact is reported with a terminal failure' \
  || { cat "$T/missing.err" >&2; bad 'a missing artifact ended without a named failure'; }

# An argument that contains newlines reaches the command as one argument.
multi_script='printf "first line\n" > /dev/null
printf "artifact" > "$1"'
multi_status=0
sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" \
  --version fake-version --artifact "binary=$T/multiline-output" --option test=multiline-argument \
  -- /bin/sh -c "$multi_script" _ "$T/multiline-output" >"$T/multiline.out" 2>"$T/multiline.err" || multi_status=$?
[ "$multi_status" = 0 ] && [ "$(cat "$T/multiline-output" 2>/dev/null)" = artifact ] \
  && pass 'a multi-line argument stayed one argument' \
  || { cat "$T/multiline.err" >&2; bad 'a multi-line argument was split'; }

# The same job in two checkouts has one group: checkout paths are replaced by a
# placeholder in the command, whether they start an argument or sit inside it.
for wt in wt-one wt-two; do
  mkdir -p "$T/$wt/bend2/src"
  cp "$T/src/bend2/src/fixture.bend" "$T/$wt/bend2/src/fixture.bend"
done
WT_FAKE=$(fresh_fake worktree)
wt_run() { # checkout
  sh "$QUEUE" run --kind cgen --state-root "$STATE" --cwd "$T/$1" --root "$T/$1" \
    --source-root "$T/$1" --entry bend2/src/fixture.bend --compiler "$WT_FAKE" \
    --artifact "c.c=$T/$1-output.c" --option "test=$1" \
    -- "$WT_FAKE" --tag worktree --note "--path=$T/$1/sub" "$T/$1/bend2/src/fixture.bend" -o "$T/$1-output.c" \
    >"$T/$1.out" 2>"$T/$1.err"
}
groups_before=$(group_files)
wt_run wt-one || bad 'checkout one request failed'
wt_run wt-two || bad 'checkout two request failed'
groups_after=$(group_files)
[ $((groups_after - groups_before)) = 1 ] \
  && pass 'the same job in two checkouts records one group peak' \
  || bad "checkouts added $((groups_after - groups_before)) group peaks, expected 1"

# A job in a group with no recorded peak is bounded by the recorded peaks of its
# kind, so it runs beside others when memory allows. Nothing recorded for its
# kind means one job at a time.
if [ -r /proc/meminfo ]; then
  KIND_FAKE=$(fresh_fake kind-bound)
  kind_run() { # state tag sleep
    BATON_COMPILE_QUEUE_ROOT=$1 sh "$QUEUE" run --kind cgen --state-root "$1" --cwd "$T/src" --root "$T/src" \
      --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$KIND_FAKE" \
      --artifact "c.c=$T/$2.c" --option "test=$2" \
      -- "$KIND_FAKE" --tag "$2" --log "$LOG" -o "$T/$2.c" --sleep "$3" >"$T/$2.out" 2>"$T/$2.err"
  }
  for variant in recorded unrecorded; do
    eval "STATE_$variant=\$T/state-kind-$variant"
    (umask 0007; mkdir -m 2770 "$T/state-kind-$variant" "$T/state-kind-$variant/peaks")
    printf 'growth_kb=0\n' > "$T/state-kind-$variant/outside-growth"
  done
  printf 'peak_kb=64\n' > "$STATE_recorded/peaks/k.cgen"
  : > "$LOG"
  kind_run "$STATE_recorded" kind-a 8 & k1=$!
  i=0
  while [ "$i" -lt 200 ] && ! grep -q 'kind-a' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
  kind_run "$STATE_recorded" kind-b 8 & k2=$!
  wait "$k1" || bad 'kind bound: first requester failed'
  wait "$k2" || bad 'kind bound: second requester failed'
  assert_serialized && bad 'jobs bounded by the peak of their kind ran one at a time' \
    || pass 'jobs in new groups run together when the peak recorded for their kind fits'
  : > "$LOG"
  kind_run "$STATE_unrecorded" kind-c 3 & k3=$!
  i=0
  while [ "$i" -lt 200 ] && ! grep -q 'kind-c' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
  kind_run "$STATE_unrecorded" kind-d 3 & k4=$!
  wait "$k3" || bad 'no kind record: first requester failed'
  wait "$k4" || bad 'no kind record: second requester failed'
  assert_serialized && pass 'jobs run one at a time while nothing is recorded for their kind' \
    || bad 'jobs ran together with nothing recorded for their kind'
fi

# A job whose group has no record is bounded by the peak recorded for the same
# entry and command shape on any compiler, before the peaks of its kind. The
# check of an entry and a full generation of it have different shapes, so a small
# check does not lower the bound of the large generation and a large generation
# does not raise the bound of the check.
if [ -r /proc/meminfo ] && [ "${room:-0}" -ge 131072 ]; then
  STATE_SHAPE=$(fresh_state shape)
  (umask 0007; mkdir -p -m 2770 "$STATE_SHAPE/peaks")
  printf 'growth_kb=0\n' > "$STATE_SHAPE/outside-growth"
  printf 'peak_kb=%s\n' "$((room * 7 / 10))" > "$STATE_SHAPE/peaks/k.cgen"
  for compiler_dir in shape-one shape-two shape-three; do
    mkdir -p "$T/$compiler_dir"
    cp "$FAKE" "$T/$compiler_dir/compiler"
    printf '# %s\n' "$compiler_dir" >> "$T/$compiler_dir/compiler"
    chmod +x "$T/$compiler_dir/compiler"
  done
  shape_run() { # compiler_dir tag command_tag
    BATON_COMPILE_QUEUE_ROOT="$STATE_SHAPE" sh "$QUEUE" run --kind cgen --state-root "$STATE_SHAPE" --cwd "$T/src" --root "$T/src" \
      --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$T/$1/compiler" \
      --artifact "c.c=$T/$2.c" --option "test=$2" \
      -- "$T/$1/compiler" --tag "$3" --log "$LOG" -o "$T/$2.c" --sleep 8 >"$T/$2.out" 2>"$T/$2.err"
  }
  # The first run on the first compiler records a small peak for its shape; the
  # large kind peak bounds it, so it runs alone.
  shape_run shape-one shape-first shape || bad 'shape: first request failed'
  ls "$STATE_SHAPE/peaks" | grep -q '^sh\.cgen\.' \
    && pass 'a run records the peak of its kind, entry and command shape' || bad 'no shape peak was recorded'
  # The same command on a second compiler, twice at once: the small shape peak
  # bounds both and they run together. A command of another shape on a compiler
  # without a record is bounded by the large kind peak, so two of those run one
  # at a time.
  : > "$LOG"
  shape_run shape-two shape-a shape & sa=$!
  shape_run shape-two shape-b shape & sb=$!
  wait "$sa" || bad 'shape: second request failed'
  wait "$sb" || bad 'shape: third request failed'
  assert_serialized && bad 'the same command on a new compiler was bounded by the peak of the kind' \
    || pass 'a job on a new compiler is bounded by the peak of its entry and command shape'
  : > "$LOG"
  shape_run shape-three shape-c control & sc=$!
  shape_run shape-three shape-d control & sd=$!
  wait "$sc" || bad 'shape: fourth request failed'
  wait "$sd" || bad 'shape: fifth request failed'
  assert_serialized && pass 'a command of another shape is bounded by the peak of its kind' \
    || bad 'a command of another shape ran together with its peers'
fi

# backfill raises the kind and key records from the runs already recorded.
rm -f "$STATE/peaks/k.cgen" "$STATE/peaks/k.cc"
sh "$QUEUE" backfill --state-root "$STATE" > "$T/backfill.out" 2>"$T/backfill.err" || bad 'backfill failed'
grep -q '^backfilled runs=[1-9]' "$T/backfill.out" && [ -s "$STATE/peaks/k.cgen" ] && [ -s "$STATE/peaks/k.cc" ] \
  && pass 'backfill restored the kind peaks from recorded runs' \
  || { cat "$T/backfill.out" "$T/backfill.err" >&2; bad 'backfill did not restore the kind peaks'; }

# Jobs without a recorded peak start in the order of their requests.
waiting_count() {
  sh "$QUEUE" status --state-root "$STATE" > "$T/status.out"
  grep -c '^waiting ' "$T/status.out" || true
}
if [ -r /proc/meminfo ] && [ "${room:-0}" -ge 131072 ]; then
  FIFO_FAKE=$(fresh_fake fifo)
  fifo_sleep() { if [ "$1" = 1 ]; then printf 2; else printf 0; fi; }
  for n in 1 2 3 4 5; do
    k=$(CQ_FAKE=$FIFO_FAKE; cc_key "fifo-$n" "$T/fifo-$n" --sleep "$(fifo_sleep $n)")
    (umask 0007; mkdir -p -m 2770 "$STATE/keys/$k")
    printf 'peak_kb=%s\n' "$((room * 7 / 10))" > "$STATE/keys/$k/peak"
  done
  : > "$LOG"
  ( CQ_FAKE=$FIFO_FAKE; run_cc fifo-1 "$T/fifo-1" --sleep 2 ) & fifo_pids=$!
  i=0
  while [ "$i" -lt 200 ] && ! grep -q 'fifo-1' "$LOG" 2>/dev/null; do i=$((i + 1)); sleep 0.05; done
  for n in 2 3 4 5; do
    ( CQ_FAKE=$FIFO_FAKE; run_cc "fifo-$n" "$T/fifo-$n" --sleep 0 ) & fifo_pids="$fifo_pids $!"
    i=0
    while [ "$i" -lt 400 ] && [ "$(waiting_count)" -lt $((n - 1)) ]; do i=$((i + 1)); sleep 0.05; done
  done
  for pid in $fifo_pids; do wait "$pid" || bad 'fifo requester failed'; done
  fifo_order=$(awk '$1 == "start" {print $4}' "$LOG" | tr '\n' ' ')
  [ "$fifo_order" = 'fifo-1 fifo-2 fifo-3 fifo-4 fifo-5 ' ] \
    && pass 'jobs that cannot run together started in request order' || bad "start order was: $fifo_order"
else
  printf 'SKIP start order: no /proc/meminfo or too little memory\n'
fi

exit "$fail"
