#!/bin/sh
set -u
W=/mnt/nvme4tb/ci-runners/baton2-native-homelab/retained/baton-consolidation-review-20261017/worktrees/frontend-check-custody-20261021
Q=/var/tmp/baton2-compile-queue/compile-queue-runner
R=/mnt/nvme4tb/ci-runners/baton2-native-homelab/home/.local/share/bend2/releases/2.0.25-f5185e38-pr967-pr968-e5c4efd-20261019
T=$(mktemp -d /tmp/native-contract.XXXXXX)
chmod 700 "$T"
mkdir -p "$T/rel"
cp -a "$R/." "$T/rel/"
chmod -R u+w "$T/rel/bin" "$T/rel/bend2" 2>/dev/null
printf '#!/bin/sh\necho "check ok"\nexit 0\n' > "$T/rel/bin/bend"
chmod +x "$T/rel/bin/bend"
mkdir -p "$T/state"
chmod 2770 "$T/state"
mkdir -p "$T/root/bend2/scripts" "$T/src"
printf 'def main() -> IO(U32):\n  IO.pure(U32, 1)\n' > "$T/src/f.bend"
printf 'def main() -> IO(U32):\n  IO.pure(U32, 1)\n' > "$T/root/f.bend"
cp "$W/bend2/scripts/compile-queue.sh" "$T/root/bend2/scripts/compile-queue.sh"
git -C "$W" show b4274718cc:bend2/scripts/check-bend.sh > "$T/root/bend2/scripts/check-bend.sh"
git -C "$W" show b4274718cc:bend2/scripts/check-bend-child.sh > "$T/root/bend2/scripts/check-bend-child.sh"
chmod +x "$T/root/bend2/scripts/check-bend.sh" "$T/root/bend2/scripts/check-bend-child.sh"
echo "== environment =="
echo "worktree=$W"
echo "native_queue=$Q"
echo "state_root=$T/state mode=$(stat -c '%a' "$T/state")"
echo "launcher=b4274718cc:bend2/scripts/check-bend.sh (the withdrawn frontend check path)"
echo
echo "== 1. old launcher under native cgen verification =="
( cd "$T/root" && BATON2_COMPILE_QUEUE_BIN="$Q" BATON_COMPILE_QUEUE_ROOT="$T/state" BEND="$T/rel/bin/bend" \
  sh "$T/root/bend2/scripts/check-bend.sh" --check-only f.bend ) > "$T/launcher.out" 2>&1
echo "launcher status=$?"
sed -n '1,6p' "$T/launcher.out"
find "$T/state" -name result -exec grep -E '^detail=' {} \; | sort -u | head -3
echo
echo "== 2. native cgen artifact contract (direct requests) =="
probe() {
  label=$1; name=$2; script=$3
  BATON_COMPILE_QUEUE_ROOT="$T/state" timeout 30 "$Q" -- run --kind cgen \
    --state-root "$T/state" --cwd "$T/src" --root "$T/src" --source-root "$T/src" \
    --entry f.bend --compiler "$T/rel/bin/bend" \
    --artifact "$name=$T/dest-$label" --option "contract=$label" \
    -- sh -c "$script" sh "$T/dest-$label" > "$T/$label.out" 2>&1
  echo "[$label name=$name] status=$?"
  grep -E 'cgen artifact|execution failed' "$T/$label.out" | head -2
}
probe nosuffix out 'printf "int x;\n" > "$1"'
probe empty out.c ': > "$1"'
probe valid out.c 'printf "int probe;\n" > "$1"'
probe binary out.c 'printf "\177ELF\000" > "$1"'
echo "valid artifact bytes=$(wc -c < "$T/dest-valid") content=$(tr '\n' ' ' < "$T/dest-valid")"
echo
echo "== 3. unwritten declared artifacts =="
BATON_COMPILE_QUEUE_ROOT="$T/state" timeout 30 "$Q" -- run --kind cgen \
  --state-root "$T/state" --cwd "$T/src" --root "$T/src" --source-root "$T/src" \
  --entry f.bend --compiler "$T/rel/bin/bend" \
  --artifact "stdout=$T/never-out" --artifact "stderr=$T/never-err" --option contract=unwritten \
  -- true > "$T/unwritten.out" 2>&1
echo "unwritten status=$?"
sed -n '1,4p' "$T/unwritten.out"
echo
echo "== 4. helper key binding =="
key() {
  BATON_COMPILE_QUEUE_ROOT="$T/state" timeout 30 "$Q" -- key --kind cgen \
    --state-root "$T/state" --cwd "$T/src" --root "$T/src" --source-root "$T/src" \
    --entry f.bend --compiler "$T/rel/bin/bend" \
    --artifact "out.c=$T/dest-key" --option contract=key "$@"
}
printf 'helper one\n' > "$T/helper"
K1=$(key --aux "$T/helper")
K2=$(key --input "$T/helper")
printf 'helper two\n' > "$T/helper"
K3=$(key --aux "$T/helper")
K4=$(key --input "$T/helper")
echo "aux-one   $K1"
echo "aux-two   $K3"
echo "input-one $K2"
echo "input-two $K4"
echo "aux_bytes_change_same_key=$([ "$K1" = "$K3" ] && echo yes || echo no)"
echo "input_bytes_change_same_key=$([ "$K2" = "$K4" ] && echo yes || echo no)"
printf 'def main() -> IO(U32):\n  IO.pure(U32, 2)\n' > "$T/src/f.bend"
K5=$(key --input "$T/helper")
echo "entry-changed $K5 source_same=$([ "$K4" = "$K5" ] && echo yes || echo no)"
printf '#!/bin/sh\necho changed\n' > "$T/rel/bin/bend"
K6=$(key --input "$T/helper")
echo "compiler-changed $K6 provenance_same=$([ "$K5" = "$K6" ] && echo yes || echo no)"
