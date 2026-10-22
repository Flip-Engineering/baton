#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
entry=${1:-bend2/src/coordinator/main.bend}
output=${2:-.scratch/bend2/baton2}
mkdir -p "$(dirname -- "$output")"
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
queue="$root/bend2/scripts/compile-queue.sh"
[ -f "$queue" ] || {
  echo "The host compile queue entry is unavailable: $queue" >&2
  echo 'Run bend2/scripts/bootstrap-compile-queue.sh once to build the queue executable.' >&2
  exit 1
}
if [ -n "${BATON2_COMPILE_QUEUE_BIN:-}" ] && { [ ! -f "${BATON2_COMPILE_QUEUE_BIN}" ] || [ ! -x "${BATON2_COMPILE_QUEUE_BIN}" ]; }; then
  echo "The selected compile queue executable is missing or not executable: $BATON2_COMPILE_QUEUE_BIN" >&2
  exit 1
fi
queue_state=${BATON_COMPILE_QUEUE_ROOT:-}
case "$queue_state" in
  /*) ;;
  *)
    echo 'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute compile-queue state directory.' >&2
    exit 1
    ;;
esac
if [ ! -d "$queue_state" ]; then
  if ! mkdir -p "$queue_state"; then
    echo "The compile-queue state root is missing and cannot be created: $queue_state" >&2
    exit 1
  fi
fi
if [ ! -w "$queue_state" ] || [ ! -x "$queue_state" ]; then
  echo "The compile-queue state root is not writable: $queue_state" >&2
  exit 1
fi
export BATON_COMPILE_QUEUE_ROOT="$queue_state"
cc=${CC:-clang}
cc_linker=
cc_version=
cc_identity() {
  if [ -z "$cc_version" ]; then
    cc_linker=${LD:-}
    if [ -z "$cc_linker" ]; then
      cc_linker=$("$cc" -print-prog-name=ld 2>/dev/null) || {
        echo "The C compiler did not report its linker identity: $cc" >&2
        exit 1
      }
    fi
    if [ -z "$cc_linker" ]; then
      echo "The C compiler did not report its linker identity: $cc" >&2
      exit 1
    fi
    if ! command -v "$cc_linker" >/dev/null 2>&1 && [ ! -x "$cc_linker" ]; then
      echo "The C linker is unavailable: $cc_linker" >&2
      exit 1
    fi
    cc_output=$("$cc" --version 2>/dev/null) || {
      echo "The C compiler did not report its version: $cc" >&2
      exit 1
    }
    cc_version=$(printf '%s' "$cc_output" | tr '\n' ' ')
    if [ -z "$cc_version" ]; then
      echo "The C compiler did not report its version: $cc" >&2
      exit 1
    fi
  fi
}
mode=plain
if [ "$router" = 1 ]; then
  mode=router
elif [ "$focused" = 1 ]; then
  mode=focused
elif [ "$recovery" = 1 ]; then
  mode=recovery
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
  sh "$root/bend2/scripts/bend-lineage-guard.sh" "$compiler"
  sh "$queue" run --kind cgen --state-root "$queue_state" --cwd "$root" --root "$root" \
    --source-root "$root" --entry "$entry" --compiler "$compiler" \
    --artifact "c.c=$output.c" -- "$compiler" "$entry" -o "$output.c"
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
  ccache_config=
  ccache_env=none
  if [ -n "${BATON2_CCACHE:-}" ]; then
    if [ -n "${CCACHE_CONFIGPATH:-}" ]; then
      if [ ! -f "$CCACHE_CONFIGPATH" ] || [ ! -r "$CCACHE_CONFIGPATH" ]; then
        echo "The ccache config is unreadable: $CCACHE_CONFIGPATH" >&2
        exit 1
      fi
      ccache_config=$CCACHE_CONFIGPATH
    elif [ -n "${CCACHE_DIR:-}" ] && [ -f "$CCACHE_DIR/ccache.conf" ] && [ -r "$CCACHE_DIR/ccache.conf" ]; then
      ccache_config=$CCACHE_DIR/ccache.conf
    fi
    ccache_env=$(env | LC_ALL=C sort | grep '^CCACHE_' | grep -v '^CCACHE_DIR=' | grep -v '^CCACHE_LOGFILE=' | grep -v '^CCACHE_CONFIGPATH=' | tr '\n' ' ')
    [ -n "$ccache_env" ] || ccache_env=none
  fi
  ccache_config_sha=none
  if [ -n "$ccache_config" ]; then
    ccache_config_sha=$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$ccache_config") || {
      echo "The ccache config could not be hashed: $ccache_config" >&2
      exit 1
    }
  fi
  cc_identity
  set -- sh "$queue" run --kind cc --state-root "$queue_state" --cwd "$root" --root "$root" \
    --source-root "$root" \
    --compiler "$cc" --linker "$cc_linker" --version "$cc_version" \
    --input "$output.c" \
    --input "$root/bend2/src/host/native-entry.c" \
    --aux "$root/tools/cgen-clang-parallel/build_and_measure.py" \
    --aux "$root/tools/cgen-clang-parallel/shard_emitted_c.py" \
    --artifact "binary=$native_binary" \
    --artifact "outdir=$native_binary.parallel" \
    --option "mode=$mode" \
    --option "ccache-env=$ccache_env" \
    --option "ccache-config-sha=$ccache_config_sha" \
    -- python3 "$root/tools/cgen-clang-parallel/build_and_measure.py" "$@"
  "$@"
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
  cc_identity
  sh "$queue" run --kind cc --state-root "$queue_state" --cwd "$root" --root "$root" \
    --source-root "$root" \
    --compiler "$cc" --linker "$cc_linker" --version "$cc_version" --input "$output.c" \
    --artifact "binary=$output" -- \
    "${CC:-clang}" -O1 -pthread "$output.c" -lsqlite3 -lm $extra_libs -o "$output"
fi
printf '%s\n' "$output"
