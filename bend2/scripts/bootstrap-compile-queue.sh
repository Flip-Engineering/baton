#!/bin/sh
# One-time bootstrap for the shared compile queue executable.
#
# This is the only supported pre-queue compilation. It builds exactly
# bend2/src/host/compile-queue.bend to the requested output and accepts no
# entry or command arguments. Normal builds use build-native.sh through the
# installed queue. Run this once per host or installation prefix.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
if [ "$#" -gt 1 ]; then
  echo 'usage: bootstrap-compile-queue.sh [OUTPUT]' >&2
  exit 2
fi
output=${1:-.scratch/bend2/compile-queue}
case "$output" in
  /*) ;;
  *) output="$root/$output" ;;
esac
entry="$root/bend2/src/host/compile-queue.bend"
[ -f "$entry" ] || {
  echo "The queue source is unavailable: $entry" >&2
  exit 1
}
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
if [ ! -x "$compiler" ]; then
  echo 'Bend is unavailable. Set BEND to an installed Bend 2.0.25 executable.' >&2
  exit 1
fi
export BEND_NO_TELEMETRY=1
if [ "$("$compiler" version)" != 'bend 2.0.25' ]; then
  echo 'This queue bootstrap requires Bend 2.0.25.' >&2
  exit 1
fi
cc=${CC:-clang}
command -v "$cc" >/dev/null 2>&1 || {
  echo "The C compiler is unavailable: $cc" >&2
  exit 1
}
mkdir -p "$(dirname -- "$output")"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/baton2-queue-bootstrap.XXXXXXXX")
cleanup_bootstrap() {
  status=$?
  trap - EXIT
  rm -rf -- "$scratch"
  exit "$status"
}
trap cleanup_bootstrap EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
sh "$root/bend2/scripts/bend-lineage-guard.sh" "$compiler"
"$compiler" "$entry" -o "$scratch/compile-queue.c"
"$cc" -O1 -pthread "$scratch/compile-queue.c" -lsqlite3 -lm -o "$output"
printf '%s\n' "$output"
