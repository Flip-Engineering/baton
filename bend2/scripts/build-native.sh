#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
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
  echo 'This native binding requires Bend 2.0.25.' >&2
  exit 1
fi
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
"$compiler" "$entry" -o "$output.c"
"${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm -o "$output"
printf '%s\n' "$output"
