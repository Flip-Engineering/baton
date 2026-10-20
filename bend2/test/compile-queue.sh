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
mkdir -p "$STATE" || exit 2
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

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }
count_starts() { (grep -c '^start' "$LOG" 2>/dev/null || true); }

run_cc() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  sh "$QUEUE" run --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
    --input "$T/input.c" --artifact "binary=$out" --option "test=$tag" \
    --token "tok-$(basename "$out")" \
    -- "$FAKE" --tag "$tag" --log "$LOG" -o "$out" "$T/input.c" "$@" >"$T/$(basename "$out").out" 2>"$T/$(basename "$out").err"
}

cc_key() { # tag output extra...
  tag=$1
  out=$2
  shift 2
  sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
    --input "$T/input.c" --artifact "binary=$out" --option "test=$tag" \
    -- "$FAKE" --tag "$tag" --log "$LOG" -o "$out" "$T/input.c" "$@"
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
before=$(count_starts)
run_cc ident "$T/reuse" || bad 'reuse request failed'
after=$(count_starts)
[ "$before" = "$after" ] && pass 'completed result reused' || bad "reuse starts $before -> $after"
[ "$(cat "$T/reuse")" = "artifact-ident" ] && pass 'reused artifact bytes match' || bad 'reused artifact differs'

# A corrupt internal completed result is removed and rebuilt.
reuse_key=$(cc_key ident "$T/reuse")
cached="$STATE/keys/$reuse_key/completed/artifacts/binary"
python3 - "$cached" <<'PY'
import pathlib, sys
path = pathlib.Path(sys.argv[1])
data = path.read_bytes()
path.write_bytes(bytes(byte ^ 0xff for byte in data))
PY
corrupt_before=$(count_starts)
run_cc ident "$T/reuse" || bad 'corrupt cache recovery request failed'
corrupt_after=$(count_starts)
[ "$corrupt_after" -gt "$corrupt_before" ] && pass 'corrupt internal result recompiled' || bad "corrupt cache starts $corrupt_before -> $corrupt_after"
[ "$(cat "$T/reuse")" = "artifact-ident" ] && pass 'recovered artifact bytes match' || bad 'recovered artifact differs'
[ "$(cat "$cached")" = "artifact-ident" ] && pass 'recovered cache artifact restored' || bad 'recovered cache artifact differs'
reuse_before=$(count_starts)
run_cc ident "$T/reuse" || bad 'post-recovery reuse request failed'
[ "$(count_starts)" = "$reuse_before" ] && pass 'recovered result reused' || bad "post-recovery starts $(count_starts)"

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
  && pass 'nested GPU sidecar request completed' || bad 'nested GPU sidecar request failed'
[ "$(cat "$T/fake-compiler.gpu" 2>/dev/null)" = 'gpu-artifact-gpu' ] \
  && pass 'nested GPU sidecar copied to ordinary output path' || bad 'nested GPU sidecar missing'
[ "$(count_starts)" = 1 ] && pass 'GPU sidecar fake command ran once' || bad 'GPU sidecar fake command count differs'

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

# Distinct cc requests serialize under the host lock.
: > "$LOG"
run_cc cc1 "$T/cc1" --sleep 1 & q1=$!
run_cc cc2 "$T/cc2" --sleep 1 & q2=$!
wait "$q1" || bad 'first cc requester failed'
wait "$q2" || bad 'second cc requester failed'
assert_serialized && pass 'distinct cc serialized' || bad 'distinct cc intervals overlap'

# C generation and native C compilation share the same host lock.
: > "$LOG"
run_cgen mixed-cgen "$T/mixed.c" --sleep 1 & m1=$!
run_cc mixed-cc "$T/mixed-bin" --sleep 1 & m2=$!
wait "$m1" || bad 'mixed cgen requester failed'
wait "$m2" || bad 'mixed cc requester failed'
assert_serialized && pass 'cgen and cc serialized together' || bad 'cgen and cc intervals overlap'

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
run_cc occupies-queue "$T/occupies-queue" --sleep 3 & blocker=$!
i=0
while [ "$i" -lt 200 ]; do
  (grep -q '^start' "$LOG" 2>/dev/null) && break
  i=$((i + 1))
  sleep 0.05
done
qkey=$(sh "$QUEUE" key --kind cc --source-root "$T" --state-root "$STATE" --cwd "$T" --compiler "$FAKE" --linker "$FAKE" --version fake-version \
  --input "$T/input.c" --artifact "binary=$T/queued-cancel" --option 'test=queued-cancel' \
  -- "$FAKE" --tag queued-cancel --log "$LOG" -o "$T/queued-cancel" "$T/input.c")
run_cc queued-cancel "$T/queued-cancel" & queued=$!
i=0
while [ "$i" -lt 200 ]; do
  [ -f "$STATE/keys/$qkey/active" ] && break
  i=$((i + 1))
  sleep 0.05
done
[ -f "$STATE/keys/$qkey/active" ] && pass 'queued supervisor published cancellable ownership' || bad 'queued supervisor never became visible'
sh "$QUEUE" cancel --state-root "$STATE" --key "$qkey" --token tok-queued-cancel >"$T/queued-cancel.cancel" 2>&1 || bad 'queued cancellation command failed'
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
mkdir -p "$STATE/keys/$livekey"
live_start=$(awk '{print $22}' "/proc/$$/stat")
printf 'pid=%s\nstarttime=%s\nkind=cc\nsetsid=1\nstarted_ns=0\n' "$$" "$live_start" > "$STATE/keys/$livekey/active"
if run_cc live "$T/live"; then bad 'live active admitted'; else pass 'live active refused'; fi
grep -q 'refusing a fresh admission' "$T/live.err" && pass 'live active diagnostic reported' || bad 'live active diagnostic missing'
[ "$(count_starts)" = 0 ] && pass 'live active did not start a compiler' || bad "live active starts=$(count_starts)"
rm -f "$STATE/keys/$livekey/active"

: > "$LOG"
unckey=$(cc_key uncertain "$T/uncertain")
mkdir -p "$STATE/keys/$unckey"
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

exit "$fail"
