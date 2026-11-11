#!/bin/sh
set -u
W=/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-consolidation-review-20261017/worktrees/frontend-check-custody-20261021
Q=/tmp/check-queue.sh
ADAPTER=/tmp/check-adapter.sh
NATIVE=/var/tmp/baton2-compile-queue/compile-queue-runner
RELEASE=/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019
cd "$W"
T=$(mktemp -d /tmp/check-kind.XXXXXX)
chmod 700 "$T"
state="$T/state"; mkdir -p "$state"
fixtures="$W/.scratch/check-proof"; mkdir -p "$fixtures"
for n in a b c d e f g; do
  printf 'def main() -> IO(U32):\n  IO.pure(U32, %s)\n' "$(printf '%d' "'$n")" > "$fixtures/$n.bend"
done
log="$T/calls.log"; : > "$log"
stub="$T/stub"
cat > "$stub" <<'STUB'
#!/bin/sh
inode=$(stat -c '%d:%i' "$BATON_COMPILE_QUEUE_ROOT/cgen.lock")
printf 'start %s %s %s %s\n' "$(date +%s%N)" "$$" "$inode" "$*" >> "$PROOF_LOG"
[ -z "${PROOF_PIDFILE:-}" ] || printf '%s\n' "$$" > "$PROOF_PIDFILE"
if [ "${PROOF_TERM:-0}" = 1 ]; then exec sleep "${PROOF_SLEEP:-0}"; fi
printf 'stdout %s\n' "$*"
if [ "${PROOF_STDERR:-1}" = 1 ]; then printf 'stderr %s\n' "$*" >&2; fi
sleep "${PROOF_SLEEP:-0}"
printf 'end %s %s\n' "$(date +%s%N)" "$$" >> "$PROOF_LOG"
exit "${PROOF_EXIT:-0}"
STUB
chmod +x "$stub"
probe() { if flock -n "$state/cgen.lock" -c true 2>/dev/null; then echo free; else echo held; fi; }
run_check() {
  tag=$1; entry=$2
  BATON2_COMPILE_QUEUE_BIN="$ADAPTER" BATON_COMPILE_QUEUE_ROOT="$state" BEND="$stub" \
    PROOF_LOG="$log" PROOF_SLEEP="${PROOF_SLEEP:-0}" PROOF_EXIT="${PROOF_EXIT:-0}" \
    PROOF_TERM="${PROOF_TERM:-0}" PROOF_STDERR="${PROOF_STDERR:-1}" \
    PROOF_PIDFILE="${PROOF_PIDFILE:-}" \
    sh "$W/bend2/scripts/check-bend.sh" --check-only "$entry" >"$T/$tag.out" 2>"$T/$tag.err"
}
key_check() {
  helper=$1; entry=$2; support=$3
  BATON_COMPILE_QUEUE_ROOT="$state" "$Q" key --kind check --state-root "$state" \
    --cwd "$W" --root "$W" --source-root "$W" --entry "$entry" --compiler "$stub" \
    --input "$helper" --input "$support" \
    --artifact "stdout=$T/key.out" --artifact "stderr=$T/key.err" \
    --option frontend=check -- \
    sh "$helper" "$stub" "$entry" "$T/key.out" "$T/key.err"
}
echo "== environment =="
echo "worktree=$W"
echo "check_queue=$Q (disposable reference-shell queue with the check kind contract)"
echo "state_root=$state"
echo "stub=$stub"
echo
echo "== 1. serialization of two checks (distinct entries) =="
PROOF_SLEEP=2 PROOF_PIDFILE="$T/pidA" run_check A .scratch/check-proof/a.bend & pA=$!
i=0; while [ "$i" -lt 300 ] && ! grep -q '^start ' "$log" 2>/dev/null; do i=$((i+1)); sleep 0.1; done
echo "during A: probe=$(probe)"
PROOF_SLEEP=2 run_check B .scratch/check-proof/b.bend & pB=$!
statusA=0; wait "$pA" || statusA=$?
statusB=0; wait "$pB" || statusB=$?
echo "A status=$statusA B status=$statusB"
echo "after A and B: probe=$(probe)"
echo
echo "== 2. coalescing of identical checks =="
before=$(grep -c 'check-proof/c.bend' "$log" 2>/dev/null || true)
PROOF_SLEEP=1 run_check C1 .scratch/check-proof/c.bend & pC1=$!
PROOF_SLEEP=1 run_check C2 .scratch/check-proof/c.bend & pC2=$!
statusC1=0; wait "$pC1" || statusC1=$?
statusC2=0; wait "$pC2" || statusC2=$?
starts=$(grep -c 'check-proof/c.bend' "$log" 2>/dev/null || true)
echo "C1 status=$statusC1 C2 status=$statusC2 child_starts=$starts"
echo "C1 stdout=$(tr '\n' ' ' < "$T/C1.out")"
echo "C2 stdout=$(tr '\n' ' ' < "$T/C2.out")"
echo
echo "== 3. error path and lock release =="
statusErr=0; PROOF_EXIT=1 run_check ERR .scratch/check-proof/d.bend || statusErr=$?
echo "error status=$statusErr probe=$(probe)"
echo "error stderr tail=$(tail -1 "$T/ERR.err")"
echo
echo "== 4. terminal path and lock release =="
PROOF_TERM=1 PROOF_SLEEP=30 PROOF_PIDFILE="$T/pidE" run_check TERM .scratch/check-proof/e.bend & pE=$!
i=0; while [ "$i" -lt 400 ] && [ ! -s "$T/pidE" ]; do i=$((i+1)); sleep 0.1; done
child=$(cat "$T/pidE" 2>/dev/null || true)
echo "during TERM: probe=$(probe) child=${child:-none}"
[ -n "$child" ] && kill -TERM "$child" 2>/dev/null || true
statusTerm=0; wait "$pE" || statusTerm=$?
i=0; while [ "$i" -lt 200 ] && [ "$(probe)" = held ]; do i=$((i+1)); sleep 0.05; done
echo "terminal status=$statusTerm probe_after_release=$(probe) waited_ms=$((i*50))"
echo
echo "== 5. empty stderr success =="
statusEmpty=0; PROOF_STDERR=0 run_check EMPTY .scratch/check-proof/f.bend || statusEmpty=$?
echo "empty status=$statusEmpty stderr_bytes=$(wc -c < "$T/EMPTY.err") stdout=$(tr '\n' ' ' < "$T/EMPTY.out")"
fkey=$(grep -l 'stdout .scratch/check-proof/f.bend' "$state"/keys/*/completed/artifacts/stdout 2>/dev/null | head -1 | sed 's#/completed/artifacts/stdout##')
if [ -n "$fkey" ]; then echo "published_stderr_bytes=$(wc -c < "$fkey/completed/artifacts/stderr")"; else echo "published_stderr_bytes=not-found"; fi
echo
echo "== 6. request identity binding =="
printf 'helper one\n' > "$T/helper"; printf 'support one\n' > "$T/support"
K1=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
printf 'helper two\n' > "$T/helper"
K2=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
printf 'support two\n' > "$T/support"
K3=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
K4=$(key_check "$T/helper" .scratch/check-proof/a.bend "$T/support")
printf 'helper one\n' > "$T/helper"; printf 'support one\n' > "$T/support"
K5=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
echo "helper-one      $K5"
echo "helper-two      $K2"
echo "support-two     $K3"
echo "entry-a         $K4"
echo "helper_bytes_change_same_key=$([ "$K5" = "$K2" ] && echo yes || echo no)"
echo "support_bytes_change_same_key=$([ "$K2" = "$K3" ] && echo yes || echo no)"
echo "entry_change_same_key=$([ "$K3" = "$K4" ] && echo yes || echo no)"
cp "$stub" "$T/stub.save"
K7=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
printf '\n# compiler provenance change\n' >> "$stub"
K8=$(key_check "$T/helper" .scratch/check-proof/g.bend "$T/support")
cp "$T/stub.save" "$stub"
echo "compiler_change_same_key=$([ "$K7" = "$K8" ] && echo yes || echo no)"
A1=$(BATON_COMPILE_QUEUE_ROOT="$state" "$Q" key --kind check --state-root "$state" --cwd "$W" --root "$W" --source-root "$W" --entry .scratch/check-proof/g.bend --compiler "$stub" --aux "$T/helper" --artifact "stdout=$T/key.out" --artifact "stderr=$T/key.err" --option frontend=check -- sh "$T/helper" g.bend)
printf 'helper two\n' > "$T/helper"
A2=$(BATON_COMPILE_QUEUE_ROOT="$state" "$Q" key --kind check --state-root "$state" --cwd "$W" --root "$W" --source-root "$W" --entry .scratch/check-proof/g.bend --compiler "$stub" --aux "$T/helper" --artifact "stdout=$T/key.out" --artifact "stderr=$T/key.err" --option frontend=check -- sh "$T/helper" g.bend)
echo "aux_bytes_change_same_key=$([ "$A1" = "$A2" ] && echo yes || echo no)"
echo
echo "== 7. a check that writes no declared artifact =="
BATON_COMPILE_QUEUE_ROOT="$state" "$Q" run --kind check --state-root "$state" --cwd "$W" --root "$W" --source-root "$W" --entry .scratch/check-proof/g.bend --compiler "$stub" --artifact "stdout=$T/missing.out" --artifact "stderr=$T/missing.err" --option check=no-result -- true >"$T/no-result.out" 2>&1
echo "no_result_status=$?"
grep -E 'artifact|execution failed' "$T/no-result.out" | head -3
echo
echo "== 8. native identity mechanism (installed queue runner, cgen lane, key only) =="
nstate="$T/nstate"; mkdir -p "$nstate"; chmod 2770 "$nstate"
printf 'def main() -> IO(U32):\n  IO.pure(U32, 8)\n' > "$T/native.bend"
nkey() {
  aux=$1
  BATON_COMPILE_QUEUE_ROOT="$nstate" "$NATIVE" -- key --kind cgen --state-root "$nstate" \
    --cwd "$T" --root "$T" --source-root "$T" --entry native.bend \
    --compiler "$RELEASE/bin/bend" --input "$T/nhelper" --aux "$aux" \
    --artifact "out.c=$T/native-out.c" --option native=key -- true
}
printf 'native helper one\n' > "$T/nhelper"
N1=$(nkey "")
printf 'native helper two\n' > "$T/nhelper"
N2=$(nkey "")
printf 'native helper one\n' > "$T/nhelper"
printf 'aux one\n' > "$T/aux-source"
N3=$(nkey "$T/aux-source")
printf 'aux two\n' > "$T/aux-source"
N4=$(nkey "$T/aux-source")
echo "native_input_one  $N1"
echo "native_input_two  $N2"
echo "native_aux_one    $N3"
echo "native_aux_two    $N4"
echo "native_input_bytes_change_same_key=$([ "$N1" = "$N2" ] && echo yes || echo no)"
echo "native_aux_bytes_change_same_key=$([ "$N3" = "$N4" ] && echo yes || echo no)"
echo
echo "== intervals =="
cat "$log"
echo "== interval check =="
awk '
  $1=="start" { s[$3]=$2; inode[$3]=$4; name[$3]=$5 }
  $1=="end" { e[$3]=$2 }
  END {
    ok=1; n=0
    for (p in s) { n++; S[n]=s[p]; E[n]=e[p]; P[n]=p; I[n]=inode[p]; L[n]=name[p] }
    for (i=1;i<=n;i++) for (j=i+1;j<=n;j++) {
      if (E[i] && E[j] && !(E[i] <= S[j] || E[j] <= S[i])) { printf "OVERLAP %s %s\n", P[i], P[j]; ok=0 }
      if (I[i] != I[j]) { printf "DIFFERENT-LOCK %s %s\n", I[i], I[j]; ok=0 }
    }
    printf "intervals=%d same_lock=%s no_overlap=%s\n", n, (ok?"yes":"no"), (ok?"yes":"no")
  }' "$log"
rm -rf "$fixtures"
