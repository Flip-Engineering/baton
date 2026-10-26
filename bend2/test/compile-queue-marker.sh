#!/bin/sh
# Marker case: the first command writes the compile marker and remains alive;
# the second command, which has no recorded peak, runs while the first is alive
# and unfinished because the marker ended the first command's admission claim.
# No-marker case: the first command writes no marker and remains alive; the
# second supervisor becomes active but its command cannot start until the first
# exits, because neither job has a recorded peak and only one such job runs at a
# time. Synchronization files, not elapsed thresholds, decide both cases.
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
if [ -n "${BATON_COMPILE_QUEUE_TEST_EVIDENCE:-}" ]; then
  trap 'printf "evidence=%s\n" "$T"' EXIT
else
  trap 'rm -rf -- "$T"' EXIT
fi
STATE=$T/state
mkdir -p "$STATE" "$T/src/bend2/src" || exit 2
chmod 775 "$STATE" || exit 2
printf 'import Base\ndef main() -> IO(Unit): IO.pure(Unit,Unit{})\n' > "$T/src/bend2/src/fixture.bend"
FAKE=$T/fake-compiler

cat > "$FAKE" <<'EOF'
#!/bin/sh
set -u
tag=job
out=''
marker=0
marker_written=''
first_alive=''
first_finished=''
first_observed=''
check=''
second_started=''
prev=''
for arg in "$@"; do
  case $prev in
    --tag) tag=$arg ;;
    --marker) marker=$arg ;;
    --marker-written) marker_written=$arg ;;
    --first-alive) first_alive=$arg ;;
    --first-finished) first_finished=$arg ;;
    --first-observed) first_observed=$arg ;;
    --check) check=$arg ;;
    --second-started) second_started=$arg ;;
  esac
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
if [ -n "$first_alive" ]; then
  : > "$first_alive"
fi
if [ -n "$second_started" ] && [ -z "$first_alive" ]; then
  : > "$second_started"
fi
if [ "$marker" = 1 ] && [ -n "${BATON_COMPILE_QUEUE_COMPILED:-}" ]; then
  printf 'compiled\n' > "$BATON_COMPILE_QUEUE_COMPILED"
  if [ -n "$marker_written" ]; then
    : > "$marker_written"
  fi
fi
if [ -n "$check" ]; then
  i=0
  while [ ! -e "$check" ] && [ "$i" -lt 400 ]; do
    sleep 0.05
    i=$((i + 1))
  done
  if [ -e "$check" ]; then
    if [ -e "$second_started" ]; then
      printf 'concurrent\n' > "$first_observed"
    else
      printf 'blocked\n' > "$first_observed"
    fi
  else
    printf 'timeout\n' > "$first_observed"
  fi
fi
if [ -n "$first_finished" ]; then
  : > "$first_finished"
fi
[ -n "$out" ] && printf 'artifact-%s' "$tag" > "$out"
exit 0
EOF
chmod +x "$FAKE"

fail=0
pass() { printf 'PASS %s\n' "$1"; }
bad() { printf 'FAIL %s\n' "$1" >&2; fail=1; }
wait_file() {
  path=$1
  i=0
  while [ ! -e "$path" ] && [ "$i" -lt 400 ]; do
    sleep 0.05
    i=$((i + 1))
  done
  [ -e "$path" ]
}

run_job() { # result tag extra...
  result=$1
  tag=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT=${CQ_STATE:-$STATE} sh "$QUEUE" -- run --kind cc --state-root "${CQ_STATE:-$STATE}" \
    --cwd "$T" --source-root "$T" --compiler "${CQ_FAKE:-$FAKE}" --linker "${CQ_FAKE:-$FAKE}" \
    --version fake-version --artifact "result=$result" --option "tag=$tag" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" "$@" -o "$result"
}

job_key() { # result tag extra...
  result=$1
  tag=$2
  shift 2
  BATON_COMPILE_QUEUE_ROOT=${CQ_STATE:-$STATE} sh "$QUEUE" -- key --kind cc --state-root "${CQ_STATE:-$STATE}" \
    --cwd "$T" --source-root "$T" --compiler "${CQ_FAKE:-$FAKE}" --linker "${CQ_FAKE:-$FAKE}" \
    --version fake-version --artifact "result=$result" --option "tag=$tag" \
    -- "${CQ_FAKE:-$FAKE}" --tag "$tag" "$@" -o "$result"
}

# Marker case.
marker_a=$T/marker-a.result
marker_b=$T/marker-b.result
run_job "$marker_a" marker-a --marker 1 --marker-written "$T/marker-a.marker" \
  --first-alive "$T/marker-a.alive" --first-finished "$T/marker-a.finished" \
  --first-observed "$T/marker-a.observed" --check "$T/marker-a.check" \
  --second-started "$T/marker-b.started" > "$T/marker-a.out" 2> "$T/marker-a.err" &
A=$!
wait_file "$T/marker-a.alive" && pass 'marker first command started' || bad 'marker first command did not start'
wait_file "$T/marker-a.marker" && pass 'compile marker written' || bad 'compile marker not written'

run_job "$marker_b" marker-b --marker 0 --second-started "$T/marker-b.started" \
  > "$T/marker-b.out" 2> "$T/marker-b.err" &
B=$!
if wait_file "$T/marker-b.started"; then
  if [ -e "$T/marker-a.alive" ] && [ ! -e "$T/marker-a.finished" ]; then
    pass 'second command ran while the first was alive and unfinished'
  else
    bad 'second command ran after the first completed'
  fi
else
  bad 'second command did not start while the marker was released'
fi
: > "$T/marker-a.check"
wait "$A" || bad 'marker first command failed'
[ "$(cat "$T/marker-a.observed" 2>/dev/null)" = concurrent ] \
  && pass 'first observed the concurrent second' || bad 'first did not observe the concurrent second'
wait "$B" || bad 'marker second command failed'
[ -s "$marker_a" ] && pass 'marker first artifact published' || bad 'marker first artifact missing'
[ -s "$marker_b" ] && pass 'marker second artifact published' || bad 'marker second artifact missing'

# No-marker case. The state root of the marker case has recorded peaks by now;
# a state root of its own has none.
CQ_STATE=$T/state-no-marker
mkdir -p "$CQ_STATE" || exit 2
chmod 775 "$CQ_STATE" || exit 2
plain_a=$T/no-marker-a.result
plain_b=$T/no-marker-b.result
run_job "$plain_a" no-marker-a --marker 0 \
  --first-alive "$T/no-marker-a.alive" --first-finished "$T/no-marker-a.finished" \
  --first-observed "$T/no-marker-a.observed" --check "$T/no-marker-a.check" \
  --second-started "$T/no-marker-b.started" > "$T/no-marker-a.out" 2> "$T/no-marker-a.err" &
A=$!
wait_file "$T/no-marker-a.alive" && pass 'no-marker first command started' || bad 'no-marker first command did not start'
key=$(job_key "$plain_b" no-marker-b --marker 0 --second-started "$T/no-marker-b.started")
if [ -n "$key" ]; then
  pass 'no-marker second key computed'
else
  bad 'no-marker second key missing'
fi
run_job "$plain_b" no-marker-b --marker 0 --second-started "$T/no-marker-b.started" \
  > "$T/no-marker-b.out" 2> "$T/no-marker-b.err" &
B=$!
if wait_file "$CQ_STATE/keys/$key/active"; then
  if [ -e "$T/no-marker-a.alive" ] && [ ! -e "$T/no-marker-a.finished" ] && [ ! -e "$T/no-marker-b.started" ]; then
    pass 'second request was active but did not start while the first job without history ran'
  else
    bad 'second request started or the first completed before the check'
  fi
else
  bad 'no-marker second supervisor did not become active'
fi
: > "$T/no-marker-a.check"
wait "$A" || bad 'no-marker first command failed'
[ "$(cat "$T/no-marker-a.observed" 2>/dev/null)" = blocked ] \
  && pass 'first observed the blocked second' || bad 'first did not observe the blocked second'
wait "$B" || bad 'no-marker second command failed'
wait_file "$T/no-marker-b.started" && pass 'no-marker second started after the first finished' || bad 'no-marker second never started'
[ -s "$plain_a" ] && pass 'no-marker first artifact published' || bad 'no-marker first artifact missing'
[ -s "$plain_b" ] && pass 'no-marker second artifact published' || bad 'no-marker second artifact missing'

exit "$fail"
