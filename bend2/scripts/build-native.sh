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
mkdir -p .scratch/bend2
"$compiler" bend2/src/coordinator/main.bend -o .scratch/bend2/coordinator.c
"${CC:-clang}" -O1 -pthread .scratch/bend2/coordinator.c -lsqlite3 -lm -o .scratch/bend2/baton2
printf '%s\n' "$root/.scratch/bend2/baton2"
