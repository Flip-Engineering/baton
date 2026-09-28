#!/bin/sh
set -eu
project=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$project"
export BEND_NO_TELEMETRY=1
compiler=${BEND:-"$project/.bend/bin/bend"}
if [ "$("$compiler" version)" != 'bend 2.0.25' ]; then
  echo 'Set BEND to a Bend 2.0.25 executable.' >&2
  exit 1
fi
if [ "$#" -gt 1 ]; then
  echo 'Usage: build-native.sh [output-path]' >&2
  exit 1
fi
output=${1:-.scratch/bend2-v2/coordinator}
mkdir -p "$(dirname -- "$output")"
# The entry is fixed so every supported build includes its law imports.
"$compiler" bend2/src/coordinator/main.bend -o "$output"
