#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
entry_path=$(readlink -f -- "$entry" 2>/dev/null || printf '%s' "$entry")
focused=${BATON2_RECEIVE_FOCUSED:-}
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
if [ "$focused" = 1 ] && [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  printf '{"error":"build-mode-conflict","condition":"focused-native-entry-with-main","entry":"%s"}\n' "$entry_path" >&2
  exit 78
fi
if [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ] &&
   { [ -z "${BATON2_ADMISSION_CGROUP:-}" ] || [ -z "${BATON2_ADMISSION_RECEIPT:-}" ]; }; then
  printf '{"error":"build-admission-required","condition":"default-full-main-without-admission","entry":"%s","output":"%s","cgroup":"%s","receipt":"%s"}\n' \
    "$entry_path" "$output" "${BATON2_ADMISSION_CGROUP:-}" "${BATON2_ADMISSION_RECEIPT:-}" >&2
  exit 78
fi
if [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  compiler_path=$(readlink -f -- "$compiler" 2>/dev/null || printf '%s' "$compiler")
  case "$compiler_path" in
    */bin/bend) ;;
    *) printf '{"error":"build-admission-required","condition":"compiler-not-guarded","compiler":"%s"}\n' "$compiler_path" >&2; exit 78 ;;
  esac
  grep -q 'build-admission-required' "$compiler_path" 2>/dev/null || {
    printf '{"error":"build-admission-required","condition":"compiler-not-guarded","compiler":"%s"}\n' "$compiler_path" >&2
    exit 78
  }
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
  if [ -n "${BATON2_CCACHE:-}" ]; then
    "$BATON2_CCACHE" "${CC:-clang}" -O1 -pthread -Dmain=baton2_runtime_main -c "$output.c" -o "$output.o"
  else
    "${CC:-clang}" -O1 -pthread -Dmain=baton2_runtime_main -c "$output.c" -o "$output.o"
  fi
  "${CC:-clang}" -O1 -pthread bend2/src/host/native-entry.c "$output.o" -lsqlite3 -lm -o "$output"
elif [ "$focused" = 1 ]; then
  if [ -n "${BATON2_CCACHE:-}" ]; then
    "$BATON2_CCACHE" "${CC:-clang}" -O1 -pthread -Dmain=baton2_runtime_main -c "$output.c" -o "$output.o"
  else
    "${CC:-clang}" -O1 -pthread -Dmain=baton2_runtime_main -c "$output.c" -o "$output.o"
  fi
  "${CC:-clang}" -O1 -pthread -DBATON2_RECEIVE_FOCUSED bend2/src/host/native-entry.c "$output.o" -lsqlite3 -lm -o "$output"
else
  "${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm -o "$output"
fi
printf '%s\n' "$output"
