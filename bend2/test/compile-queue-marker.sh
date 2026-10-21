#!/bin/sh
# The heavy lock is released when the command writes the compile marker, while
# the key lock, attempt and test ownership continue. The fake compiler writes
# the marker and then sleeps, so a second request can compile concurrently.
# Requires the built queue executable at BATON2_COMPILE_QUEUE_BIN.
set -u

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
QUEUE=${BATON2_COMPILE_QUEUE:-$ROOT/bend2/scripts/compile-queue.sh}
[ -f "$QUEUE" ] || { printf 'missing queue launcher: %s\n' "$QUEUE" >&2; exit 2; }
if [ -z "${BATON2_COMPILE_QUEUE_BIN:-}" ] || [ ! -x "$BATON2_COMPILE_QUEUE_BIN" ]; then
  printf 'Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable\n' >&2
  exit 2
fi

BASE=${BATON_COMPILE_QUEUE_ROOT:-/var/tmp/baton2-compile-queue}
[ -d "$BASE" ] || { printf 'missing shared queue parent: %s\n' "$BASE" >&2; exit 2; }
T=$(mktemp -d "$BASE/marker-test-$(id -u)-XXXXXX") || exit 2
chmod 775 "$T" || exit 2
trap 'rm -rf -- "$T"' EXIT
STATE=$T/state
mkdir -p "$STATE" "$T/src/bend2/src" || exit 2
chmod 775 "$STATE" || exit 2
printf 'import Base\ndef main() -> IO(Unit): IO.pure(Unit,Unit{})\n' > "$T/src/bend2/src/fixture.bend"
FAKE=$T/fake-compiler

cat > "$FAKE" <<'EOF'
#!/bin/sh
set -u
tag=fake
out=''
marker_sleep=0
prev=''
for arg in "$@"; do
  case $prev in
    --tag) tag=$arg ;;
    --marker-sleep) marker_sleep=$arg ;;
  esac
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
if [ "$marker_sleep" != 0 ]; then
  if [ -n "${BATON_COMPILE_QUEUE_COMPILED:-}" ]; then
    printf 'compiled\n' > "$BATON_COMPILE_QUEUE_COMPILED"
  fi
  sleep "$marker_sleep"
fi
[ -n "$out" ] && printf 'artifact-%s' "$tag" > "$out"
exit 0
EOF
chmod +x "$FAKE"

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }

run_job() { # result tag marker_sleep
  BATON_COMPILE_QUEUE_ROOT=$STATE sh "$QUEUE" -- run --kind cc --state-root "$STATE" \
    --cwd "$T" --source-root "$T" --compiler "$FAKE" --linker "$FAKE" \
    --version fake-version --artifact "result=$1" --option "tag=$2" \
    -- "$FAKE" --tag "$2" --marker-sleep "$3" -o "$1"
}

run_job "$T/a.result" a 10 > "$T/a.out" 2> "$T/a.err" &
A=$!
marker=''
i=0
while [ "$i" -lt 100 ]; do
  marker=$(find "$STATE/keys" -path '*/runs/*/compiled' -type f 2>/dev/null | head -n 1)
  [ -n "$marker" ] && break
  sleep 0.1
  i=$((i + 1))
done
if [ -n "$marker" ]; then pass 'compile marker observed'; else bad 'compile marker was not written'; fi

start=$(date +%s)
if run_job "$T/b.result" b 0 > "$T/b.out" 2> "$T/b.err"; then
  elapsed=$(( $(date +%s) - start ))
  if [ "$elapsed" -lt 6 ]; then
    pass 'second job ran while the first command held only its key lock'
  else
    bad "second job waited ${elapsed}s for the first command"
  fi
else
  cat "$T/b.err" >&2
  bad 'second job failed'
fi

if wait "$A"; then
  pass 'first job completed after its test sleep'
else
  cat "$T/a.err" >&2
  bad 'first job failed'
fi
[ -s "$T/a.result" ] && pass 'first artifact published' || bad 'first artifact missing'
[ -s "$T/b.result" ] && pass 'second artifact published' || bad 'second artifact missing'

exit "$fail"
