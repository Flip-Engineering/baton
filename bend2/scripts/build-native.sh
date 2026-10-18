#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
entry_path=$(readlink -f -- "$entry" 2>/dev/null || printf '%s' "$entry")
focused=${BATON2_RECEIVE_FOCUSED:-}
router=${BATON2_NATIVE_RECEIVER_ROUTER:-}
recovery=${BATON2_RECOVERY_HELPER:-}
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
if [ "$focused" = 1 ] && [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  printf '{"error":"build-mode-conflict","condition":"focused-native-entry-with-main","entry":"%s"}\n' "$entry_path" >&2
  exit 78
fi
if [ "$router" = 1 ] && [ "$entry_path" != "$root/bend2/src/coordinator/main.bend" ]; then
  printf '{"error":"build-mode-conflict","condition":"receiver-router-without-main","entry":"%s"}\n' "$entry_path" >&2
  exit 78
fi
if [ "$router" = 1 ] && [ "$focused" = 1 ]; then
  printf '{"error":"build-mode-conflict","condition":"receiver-router-with-focused-native-entry","entry":"%s"}\n' "$entry_path" >&2
  exit 78
fi
if [ "$recovery" = 1 ] && [ "$entry_path" != "$root/bend2/src/coordinator/receive-recovery-focused.bend" ]; then
  printf '{"error":"build-mode-conflict","condition":"recovery-helper-without-recovery-entry","entry":"%s"}\n' "$entry_path" >&2
  exit 78
fi
if [ "$recovery" = 1 ] && { [ "$focused" = 1 ] || [ "$router" = 1 ]; }; then
  printf '{"error":"build-mode-conflict","condition":"recovery-helper-with-other-native-entry","entry":"%s"}\n' "$entry_path" >&2
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
  BATON2_ADMISSION_CHECK_ONLY=1 "$compiler" "$entry" -o "$output.c" >/dev/null || exit $?
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
build_native_shards() {
  native_link_flags="-O1 -pthread -lsqlite3 -lm"
  if [ -n "$1" ]; then
    native_link_flags="$native_link_flags $1"
  fi
  case "$output" in
    /*) native_binary=$output ;;
    *) native_binary="$root/$output" ;;
  esac
  set -- --source "$output.c" \
    --outdir "$native_binary.parallel" \
    --binary "$native_binary" \
    --shards 4 --jobs 4 --cc "${CC:-clang}" \
    --cflag=-O1 --cflag=-pthread --main-rename \
    --link-extra "$root/bend2/src/host/native-entry.c" \
    --link-flags="$native_link_flags" \
    --max-aggregate-rss-mb 0 --build-only
  if [ -n "${BATON2_CCACHE:-}" ]; then
    set -- "$@" --ccache "$BATON2_CCACHE"
  fi
  python3 "$root/tools/cgen-clang-parallel/build_and_measure.py" "$@"
}
if [ "$entry_path" = "$root/bend2/src/coordinator/main.bend" ]; then
  if [ "$router" = 1 ]; then
    build_native_shards -DBATON2_NATIVE_RECEIVER_ROUTER
  else
    build_native_shards ""
  fi
elif [ "$focused" = 1 ]; then
  build_native_shards -DBATON2_RECEIVE_FOCUSED
elif [ "$recovery" = 1 ]; then
  build_native_shards -DBATON2_RECOVERY_HELPER
else
  extra_libs=
  case "$entry_path" in
    */bend2/harness/claude-credit-observe.bend) extra_libs=-lcurl ;;
  esac
  "${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm $extra_libs -o "$output"
fi
printf '%s\n' "$output"
