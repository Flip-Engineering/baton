#!/bin/sh
# Run one Bend2 frontend check through the compile queue check kind.
#
# The check kind holds the host heavy lock for the child's lifetime and
# computes the source closure for the entry. The launcher declares stdout and
# stderr as check artifacts; the queue publishes both, including empty stderr.
# The child helper is declared as an input, so its bytes enter the request key.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/../.." && pwd -P)

if [ "${1:-}" = --check-only ]; then
  shift
fi
if [ "$#" -ne 1 ]; then
  echo "usage: check-bend.sh [--check-only] FILE" >&2
  exit 2
fi
entry=$1

compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
if [ ! -x "$compiler" ]; then
  echo 'Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.' >&2
  exit 1
fi

queue="$root/bend2/scripts/compile-queue.sh"
[ -f "$queue" ] || {
  echo "The host compile queue entry is unavailable: $queue" >&2
  exit 1
}
if [ -n "${BATON2_COMPILE_QUEUE_BIN:-}" ] && { [ ! -f "${BATON2_COMPILE_QUEUE_BIN}" ] || [ ! -x "${BATON2_COMPILE_QUEUE_BIN}" ]; }; then
  echo "The selected compile queue executable is missing or not executable: $BATON2_COMPILE_QUEUE_BIN" >&2
  exit 1
fi
state=${BATON_COMPILE_QUEUE_ROOT:-}
case "$state" in
  /*) ;;
  *)
    echo 'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute compile-queue state directory.' >&2
    exit 1
    ;;
esac
if [ ! -d "$state" ]; then
  if ! mkdir -p "$state"; then
    echo "The compile-queue state root is missing and cannot be created: $state" >&2
    exit 1
  fi
fi
if [ ! -w "$state" ] || [ ! -x "$state" ]; then
  echo "The compile-queue state root is not writable: $state" >&2
  exit 1
fi
export BATON_COMPILE_QUEUE_ROOT="$state"
export BEND_NO_TELEMETRY=1

entry_path=$(readlink -f -- "$entry" 2>/dev/null || printf '%s' "$entry")
case "$entry_path" in
  "$root"/*) ;;
  *)
    echo "check-bend.sh: the entry is outside the source root: $entry" >&2
    exit 2
    ;;
esac
entry=${entry_path#"$root"/}

helper="$here/check-bend-child.sh"
[ -x "$helper" ] || {
  echo "check-bend.sh: the check helper is unavailable: $helper" >&2
  exit 1
}

scratch=$(mktemp -d "${TMPDIR:-/tmp}/bend-check.XXXXXXXX")
cleanup() {
  status=$?
  trap - EXIT
  rm -rf -- "$scratch" || {
    printf 'check-bend scratch cleanup failed; retained %s\n' "$scratch" >&2 || true
  }
  exit "$status"
}
trap cleanup EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
out=$scratch/stdout
err=$scratch/stderr

status=0
sh "$queue" run --kind check --state-root "$state" --cwd "$root" --root "$root" \
  --source-root "$root" --entry "$entry" --compiler "$compiler" \
  --input "$helper" \
  --artifact "stdout=$out" --artifact "stderr=$err" \
  --option frontend=check -- \
  sh "$helper" "$compiler" "$entry" "$out" "$err" || status=$?
if [ "$status" -eq 0 ]; then
  cat "$out"
  cat "$err" >&2
fi
exit "$status"
