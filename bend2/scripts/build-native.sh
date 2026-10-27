#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
native_compile() {
  compile_kind=$1
  shift
  if [ -n "${BATON2_NATIVE_QUEUE_DRIVER:-}" ]; then
    python3 "$BATON2_NATIVE_QUEUE_DRIVER" stage "$compile_kind" "$@"
  else
    "$@"
  fi
}
if [ -n "${TMPDIR:-}" ]; then
  scratch_base=$TMPDIR
elif [ -n "${BATON2_SCRATCH_ROOT:-}" ]; then
  scratch_base=$BATON2_SCRATCH_ROOT
elif [ -r "${BATON2_SCRATCH_CONFIG:-/etc/baton/scratch-root}" ]; then
  IFS= read -r scratch_base < "${BATON2_SCRATCH_CONFIG:-/etc/baton/scratch-root}" || :
  [ -n "$scratch_base" ] || scratch_base=/tmp
else
  scratch_base=/tmp
fi
case "$scratch_base" in
  /*) ;;
  *) scratch_base="$root/$scratch_base" ;;
esac
build_scratch=$(mktemp -d "$scratch_base/baton2-build.XXXXXXXX")
cleanup_build_scratch() {
  status=$?
  trap - EXIT
  if [ "$status" -eq 0 ]; then
    if ! rm -rf -- "$build_scratch"; then
      printf 'build scratch cleanup failed; retained %s\n' "$build_scratch" >&2 || true
    fi
  else
    printf 'build scratch retained after status %s: %s\n' "$status" "$build_scratch" >&2 || true
  fi
  exit "$status"
}
trap cleanup_build_scratch EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
TMPDIR=$build_scratch
TMP=$build_scratch
TEMP=$build_scratch
export TMPDIR TMP TEMP
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
. "$root/bend2/scripts/queue-entry.sh"
generated=
if [ "$recovery" = 1 ]; then
  if [ -n "${BEND_GENERATED_C:-}" ]; then
    printf '%s\n' '{"error":"unverified-recovery-generated-c","entry":"focused recovery C requires a reuse proof"}' >&2
    exit 78
  fi
  if [ -n "${BATON2_RECOVERY_C_PROOF:-}" ]; then
    generated=$(python3 "$root/.github/scripts/reuse-native-recovery.py" select \
      --source "$root" --compiler "$compiler" \
      --proof "$BATON2_RECOVERY_C_PROOF" \
      --proof-sha256 "${BATON2_RECOVERY_C_PROOF_SHA256:?}" \
      --generated-c "${BATON2_RECOVERY_GENERATED_C:?}" \
      --generator-root "${BATON2_RECOVERY_C_GENERATOR_ROOT:?}" \
      --output "$output.recovery-c-reuse.json")
  fi
else
  generated=${BEND_GENERATED_C:-}
fi
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
  sh "$root/bend2/scripts/bend-lineage-guard.sh" "$compiler"
  native_compile bend "$compiler" "$entry" -o "$output.c"
fi
if grep -Fq '#include "persistent-path.h"' "$output.c"; then
  persistent_header_dir=$(dirname "$output.c")
  persistent_header="$persistent_header_dir/persistent-path.h"
  expected_persistent_header=$(readlink -f "$root/bend2/src/host/persistent-path.h")
  if [ -e "$persistent_header" ] || [ -L "$persistent_header" ]; then
    if [ "$(readlink -f "$persistent_header")" != "$expected_persistent_header" ]; then
      echo "generated C input resolves persistent-path.h to an unexpected file: $persistent_header" >&2
      exit 1
    fi
  else
    ln -s "$expected_persistent_header" "$persistent_header"
  fi
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
    --cflag=-O1 --cflag=-pthread --cflag=-I"$root/bend2/src/host" --main-rename \
    --link-extra "$root/bend2/src/host/native-entry.c" \
    --link-flags="$native_link_flags" \
    --max-aggregate-rss-mb 0 --build-only
  if [ -n "${BATON2_CCACHE:-}" ]; then
    set -- "$@" --ccache "$BATON2_CCACHE"
  fi
  native_compile cc python3 "$root/tools/cgen-clang-parallel/build_and_measure.py" "$@"
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
    */bend2/harness/usage-read.bend) extra_libs=-lcurl ;;
  esac
  storage_test_flag=
  case "$entry_path" in
    */bend2/tests/storage.bend) storage_test_flag="-DBATON_STORAGE_TEST_PROC" ;;
    */bend2/tests/storage-cargo.bend) storage_test_flag=-DBATON_STORAGE_CARGO_TEST ;;
  esac
  native_compile cc "${CC:-clang}" -O1 -pthread -I "$root/bend2/src/host" $storage_test_flag "$output.c" -lsqlite3 -lm $extra_libs -o "$output"
fi
printf '%s\n' "$output"
