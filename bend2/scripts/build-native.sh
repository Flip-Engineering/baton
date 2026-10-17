#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
entry_path=$(CDPATH= cd -- "$(dirname -- "$entry")" && pwd -P)/$(basename -- "$entry")
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
generated=${BEND_GENERATED_C:-}
if [ -z "$generated" ] && [ -n "${BATON2_MAIN_GENERATED_C:-}" ] &&
   [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  generated=$(python3 "${BATON2_MAIN_C_VERIFIER:?}" select \
    --source "$root" --compiler "$compiler" \
    --proof "${BATON2_MAIN_GENERATED_C_PROOF:?}" \
    --proof-sha256 "${BATON2_MAIN_GENERATED_C_PROOF_SHA256:?}" \
    --bound-root "${BATON2_MAIN_GENERATED_C_ROOT:?}" \
    --generated-c "$BATON2_MAIN_GENERATED_C" \
    --output "$output.main-c-reuse.json")
fi
if [ -n "$generated" ]; then
  cp "$generated" "$output.c"
else
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
if [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  python3 "$root/tools/cgen-clang-parallel/build_native.py" \
    --source "$output.c" --output "$output" \
    --entry "$root/bend2/src/host/native-entry.c" \
    --cc "${CC:-clang}" --ccache "${BATON2_CCACHE:-}"
  if [ -f "$output.build.json" ]; then
    python3 "$root/.github/scripts/reuse-native-main.py" verify-build \
      --receipt "$output.build.json" --source "$output.c" \
      --entry "$root/bend2/src/host/native-entry.c" --output "$output"
  fi
elif [ -n "${BATON2_CCACHE:-}" ]; then
  "$BATON2_CCACHE" "${CC:-clang}" -O1 -pthread -c "$output.c" -o "$output.o"
  "${CC:-clang}" -O1 -pthread "$output.o" -lsqlite3 -lm -o "$output"
else
  "${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm -o "$output"
fi
printf '%s\n' "$output"
