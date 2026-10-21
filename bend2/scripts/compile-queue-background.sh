#!/bin/sh
# Start one shared-queue run in the background and return its durable key.
# The caller can read messages and later continue with:
#   compile-queue.sh wait --state-root STATE --key KEY
# The background queue process remains the live owner until the supervisor
# exits, writes the receipt and removes the owner token.
set -eu

if [ "$#" -lt 3 ]; then
  printf 'usage: compile-queue-background.sh OUTPUT_DIR -- QUEUE_RUN_ARGS...\n' >&2
  exit 2
fi

root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
queue=${BATON2_COMPILE_QUEUE:-$root/bend2/scripts/compile-queue.sh}
[ -f "$queue" ] || { printf 'missing queue launcher: %s\n' "$queue" >&2; exit 2; }
if [ -z "${BATON2_COMPILE_QUEUE_BIN:-}" ] || [ ! -x "$BATON2_COMPILE_QUEUE_BIN" ]; then
  printf 'Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable\n' >&2
  exit 2
fi

output=$1
shift
[ "${1:-}" = "--" ] && shift
mkdir -p "$output" || exit 2

key=$(sh "$queue" key "$@") || exit $?
printf '%s\n' "$key" > "$output/key"
nohup sh "$queue" run "$@" >"$output/stdout" 2>"$output/stderr" &
pid=$!
printf '%s\n' "$pid" > "$output/pid"
printf 'key=%s\npid=%s\n' "$key" "$pid"
