#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
if [ -n "${BEND_GENERATED_C:-}" ]; then
  cp "$BEND_GENERATED_C" "$output.c"
else
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
  "$compiler" "$entry" -o "$output.c"
fi
entry_path=$(CDPATH= cd -- "$(dirname -- "$entry")" && pwd)/$(basename -- "$entry")
if [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  "${CC:-clang}" -O1 -pthread -Dmain=baton2_runtime_main -c "$output.c" -o "$output.o"
  "${CC:-clang}" -O1 -pthread bend2/src/host/native-entry.c "$output.o" -lsqlite3 -lm -o "$output"
else
  "${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm -o "$output"
fi
printf '%s\n' "$output"
