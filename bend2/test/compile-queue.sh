#!/bin/sh
# Shared compile queue behavior with fake compiler commands. No Bend, clang or
# cc process runs. Set BATON2_COMPILE_QUEUE_BIN to the built queue executable;
# the test invokes the public launcher so the bootstrap path is exercised too.
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
QUEUE=${BATON2_COMPILE_QUEUE:-$ROOT/bend2/scripts/compile-queue.sh}
[ -f "$QUEUE" ] || { printf 'missing queue launcher: %s\n' "$QUEUE" >&2; exit 2; }
if [ -z "${BATON2_COMPILE_QUEUE_BIN:-}" ]; then
  printf 'SKIP: set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable\n'
  exit 0
fi

T=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-test.XXXXXX") || exit 2
trap 'rm -rf -- "$T"' EXIT
STATE=$T/state
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
prev=''
for arg in "$@"; do
  case $prev in
    --tag) tag=$arg ;;
    --log) log=$arg ;;
    --sleep) sleep_s=$arg ;;
  esac
  case $arg in
    --fail) fail=1 ;;
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
if [ -n "$out" ]; then
  printf 'artifact-%s' "$tag" > "$out"
fi
[ -n "$log" ] && printf 'end %s %s %s 0\n' "$(now)" "$$" "$tag" >> "$log"
exit 0
EOF
chmod +x "$FAKE"

mkdir -p "$T/src/bend2/src"
printf 'import Base\ndef main() -> IO(Unit): IO.die(Unit,0,"fixture")\n' > "$T/src/bend2/src/fixture.bend"
printf 'int main(void){return 0;}\n' > "$T/input.c"

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }
count_starts() { (grep -c '^start' "$LOG" 2>/dev/null || true); }

run_cc() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  sh "$QUEUE" run --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
    --input "$T/input.c" --artifact "binary=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "$FAKE" --tag "$tag" --log "$LOG" -o "$out" "$T/input.c" "$@" >"$T/$(basename "$out").out" 2>"$T/$(basename "$out").err"
}

run_cgen() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  sh "$QUEUE" run --kind cgen --state-root "$STATE" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$FAKE" \
    --artifact "c=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "$FAKE" --tag "$tag" --log "$LOG" -o "$out" "$@" >"$T/$(basename "$out").out" 2>"$T/$(basename "$out").err"
}

cgen_key() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  sh "$QUEUE" key --kind cgen --state-root "$STATE" --cwd "$T/src" --root "$T/src" \
    --source-root "$T/src" --entry bend2/src/fixture.bend --compiler "$FAKE" \
    --artifact "c=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "$FAKE" --tag "$tag" --log "$LOG" -o "$out" "$@"
}

# Identical concurrent cc requests.
: > "$LOG"
run_cc ident "$T/ident1" & p1=$!
run_cc ident "$T/ident2" & p2=$!
wait "$p1" || bad 'identical cc first requester failed'
wait "$p2" || bad 'identical cc second requester failed'
[ "$(count_starts)" = 1 ] && pass 'identical cc shared one execution' || bad "identical cc starts=$(count_starts)"
[ "$(cat "$T/ident1")" = "$(cat "$T/ident2")" ] && pass 'identical cc artifacts match' || bad 'identical cc artifacts differ'

# Reuse.
before=$(count_starts)
run_cc ident "$T/reuse" || bad 'reuse request failed'
after=$(count_starts)
[ "$before" = "$after" ] && pass 'completed result reused' || bad "reuse starts $before -> $after"
[ "$(cat "$T/reuse")" = "artifact-ident" ] && pass 'reused artifact bytes match' || bad 'reused artifact differs'

# Identical concurrent cgen requests.
: > "$LOG"
run_cgen cgen "$T/cgen1" & c1=$!
run_cgen cgen "$T/cgen2" & c2=$!
wait "$c1" || bad 'identical cgen first requester failed'
wait "$c2" || bad 'identical cgen second requester failed'
[ "$(count_starts)" = 1 ] && pass 'identical cgen shared one execution' || bad "identical cgen starts=$(count_starts)"
[ "$(cat "$T/cgen1")" = "$(cat "$T/cgen2")" ] && pass 'identical cgen artifacts match' || bad 'identical cgen artifacts differ'

# Distinct cgen requests serialize.
: > "$LOG"
run_cgen serial1 "$T/serial1" --sleep 1 & s1=$!
run_cgen serial2 "$T/serial2" --sleep 1 & s2=$!
wait "$s1" || bad 'serial first requester failed'
wait "$s2" || bad 'serial second requester failed'
python3 - "$LOG" <<'PY' && pass 'distinct cgen serialized' || bad 'distinct cgen intervals overlap'
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

# Distinct cc requests overlap.
: > "$LOG"
run_cc parallel1 "$T/parallel1" --sleep 2 & q1=$!
run_cc parallel2 "$T/parallel2" --sleep 2 & q2=$!
wait "$q1" || bad 'parallel first requester failed'
wait "$q2" || bad 'parallel second requester failed'
python3 - "$LOG" <<'PY' && pass 'distinct cc overlapped' || bad 'distinct cc intervals did not overlap'
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
            sys.exit(0)
sys.exit(1)
PY

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
before=$(count_starts)
run_cc failure "$T/retry" --fail || true
[ "$(count_starts)" -gt "$before" ] && pass 'failed attempt retried' || bad 'failed attempt not retried'

# Cancellation.
: > "$LOG"
run_cc cancelcase "$T/cancelcase" --sleep 30 & k=$!
key=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
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

# One owner withdraws; another owner keeps the shared execution.
: > "$LOG"
run_cc owner "$T/ownerA" --sleep 2 & o1=$!
sleep 0.3
run_cc owner "$T/ownerB" --sleep 2 & o2=$!
sleep 0.5
ownkey=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
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

# Explicit scalar options override seeded defaults; repeated lists accumulate.
: > "$LOG"
printf 'int extra(void){return 0;}\n' > "$T/extra.c"
base=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --root "$T" \
  --compiler "$FAKE" --linker "$FAKE" --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base --flag "$T/root-token" -o "$T/config-base" "$T/input.c")
overridden=$(sh "$QUEUE" key --kind bad --kind cc --state-root /nonexistent --state-root "$STATE" \
  --cwd /nonexistent --cwd "$T" --root /nonexistent --root "$T" \
  --compiler "$T/missing" --compiler "$FAKE" --linker "$T/missing" --linker "$FAKE" --version bad --version fake-version --input "$T/input.c" \
  --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base --flag "$T/root-token" -o "$T/config-base" "$T/input.c")
[ "$base" = "$overridden" ] && pass 'explicit scalar options override defaults' \
  || bad 'scalar options did not override seeded defaults'
one_input=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
two_inputs=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --input "$T/extra.c" --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
[ "$one_input" != "$two_inputs" ] && pass 'repeated inputs accumulate' \
  || bad 'repeated inputs were ignored'
one_option=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
two_options=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/config-base" --option first=1 --option second=2 \
  -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
[ "$one_option" != "$two_options" ] && pass 'repeated options accumulate' \
  || bad 'repeated options were ignored'
one_artifact=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/config-base" --option first=1 \
  -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
two_artifacts=$(sh "$QUEUE" key --kind cc --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/config-base" --artifact "extra=$T/extra.out" \
  --option first=1 -- "$FAKE" --tag base -o "$T/config-base" "$T/input.c")
[ "$one_artifact" != "$two_artifacts" ] && pass 'repeated artifacts accumulate' \
  || bad 'repeated artifacts were ignored'
rc=0
sh "$QUEUE" run --kind bad --kind cc --state-root /nonexistent --state-root "$STATE" \
  --cwd /nonexistent --cwd "$T" --root /nonexistent --root "$T" \
  --compiler "$T/missing" --compiler "$FAKE" --linker "$T/missing" --linker "$FAKE" --version bad --version fake-version \
  --input "$T/input.c" --input "$T/extra.c" \
  --artifact "binary=$T/config-run" --option first=1 --option second=2 \
  --token tok-config \
  -- "$FAKE" --tag config --log "$LOG" --flag "$T/root-token" \
  -o "$T/config-run" "$T/input.c" "$T/extra.c" || rc=$?
[ "$rc" = 0 ] && pass 'fake command ran with explicit overrides and repeated inputs/options' \
  || bad "config fake command exit $rc"
[ "$(cat "$T/config-run" 2>/dev/null)" = "artifact-config" ] \
  && pass 'config fake artifact written' || bad 'config fake artifact missing'
[ "$(count_starts)" = 1 ] && pass 'config fake command ran once' \
  || bad "config fake starts=$(count_starts)"

# Source identity changes the key.
key1=$(cgen_key keyfile "$T/keyfile")
printf 'def extra() -> Unit: Unit{}\n' >> "$T/src/bend2/src/fixture.bend"
key2=$(cgen_key keyfile "$T/keyfile")
[ "$key1" != "$key2" ] && pass 'source change changes the key' || bad 'source change kept the key'
printf 'import Base\ndef main() -> IO(Unit): IO.die(Unit,0,"fixture")\n' > "$T/src/bend2/src/fixture.bend"

exit "$fail"
