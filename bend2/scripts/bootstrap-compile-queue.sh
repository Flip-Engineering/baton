#!/bin/sh
# One-time bootstrap for the shared compile queue executable.
#
# The bootstrap waits for heavy.lock, which serializes bootstraps with each
# other and with a queue that still uses the lock. Queue jobs do not take
# heavy.lock; the bootstrap registers its memory with the admission rule as a
# running job, so queued jobs count it.
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
sh "$root/bend2/scripts/bend-lineage-guard.sh" "$compiler"
cc=${CC:-clang}
command -v "$cc" >/dev/null 2>&1 || {
  echo "The C compiler is unavailable: $cc" >&2
  exit 1
}
mkdir -p "$(dirname -- "$output")"
state=${BATON_COMPILE_QUEUE_ROOT:-}
case "$state" in
  /*) ;;
  *)
    echo 'Set BATON_COMPILE_QUEUE_ROOT to the shared absolute compile-queue state directory.' >&2
    exit 2
    ;;
esac
[ -d "$state" ] && [ -w "$state" ] && [ -x "$state" ] || {
  echo "The shared compile-queue state root is unavailable: $state" >&2
  exit 2
}
# Keep the request record outside build scratch, including failed attempts.
umask 0007
mkdir -p "$state/bootstrap-runs"
record=$(mktemp -d "$state/bootstrap-runs/XXXXXXXX")
telemetry="$record/telemetry"
scratch=
phase=waiting
child=
process_start() {
  if [ -r "/proc/$1/stat" ]; then
    sed 's/.*) //' "/proc/$1/stat" | awk '{print $20}'
  fi
}
pressure() {
  if [ -r /proc/sys/kernel/random/boot_id ]; then
    printf 'boot_id=%s\n' "$(cat /proc/sys/kernel/random/boot_id)" >> "$telemetry"
  fi
  if [ -r /proc/vmstat ]; then
    sed -n '/^oom_kill /s/^/vmstat=/p' /proc/vmstat >> "$telemetry"
  fi
  if [ -r /proc/meminfo ]; then
    sed -n '/^MemAvailable:/p; /^SwapFree:/p' /proc/meminfo >> "$telemetry"
  fi
  if [ -r /proc/pressure/memory ]; then
    sed 's/^/memory_pressure=/' /proc/pressure/memory >> "$telemetry"
  fi
}
cleanup_bootstrap() {
  status=$?
  trap - EXIT
  printf 'phase=terminal\nlast_phase=%s\nterminal_status=%s\nfinished_ns=%s\n' \
    "$phase" "$status" "$(date +%s%N)" >> "$telemetry"
  pressure
  if [ -n "$child" ] && [ -d "/proc/$child" ]; then
    printf 'retained_child_pid=%s\nretained_scratch=%s\n' "$child" "$scratch" >> "$telemetry"
  else
    [ -z "$scratch" ] || rm -rf -- "$scratch"
  fi
  if [ -n "${BATON_COMPILE_QUEUE_TELEMETRY:-}" ]; then
    if ! cp "$telemetry" "$BATON_COMPILE_QUEUE_TELEMETRY"; then
      printf 'The bootstrap telemetry remains at %s\n' "$telemetry" >&2
    fi
  fi
  # Closing the shell descriptor preserves custody held by a surviving child.
  exec 8>&-
  exit "$status"
}
trap cleanup_bootstrap EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM
printf 'schema=baton-compile-queue-custody-v1\nkind=bootstrap\n' > "$telemetry"
printf 'pid=%s\nstarttime=%s\nentry=%s\ncompiler=%s\ncc=%s\nstarted_ns=%s\n' \
  "$$" "$(process_start "$$")" "$entry" "$compiler" "$cc" "$(date +%s%N)" >> "$telemetry"
pressure
exec 8>"$state/heavy.lock"
lock_inode=$(stat -Lc '%d:%i' /proc/self/fd/8 2>/dev/null || stat -f '%d:%i' "$state/heavy.lock")
printf 'lock_path=%s\nlock_identity=%s\nlock_descriptor=8\nphase=waiting\n' \
  "$state/heavy.lock" "$lock_inode" >> "$telemetry"
flock -x 8
phase=compile
printf 'phase=%s\nacquired_ns=%s\n' "$phase" "$(date +%s%N)" >> "$telemetry"
# Register with the admission rule. The claim file stays locked through
# descriptor 7 while this script or a compiler it started holds the descriptor.
mkdir -p "$state/admission/running" "$state/admission/waiting"
exec 6>"$state/admission/lock"
flock -x 6
claim_ns=$(date +%s%N)
claim=$(printf '%s/admission/running/%020d-%010d' "$state" "$claim_ns" "$$")
exec 7>"$claim"
flock -x -n 7
printf 'pid=%s\nstarttime=%s\nroot=%s\nmeasure=tree\nkey=bootstrap\ngroup=\nexpected_kb=0\nhistory=1\nbackfill=0\nadmitted_ns=%s\n' \
  "$$" "$(process_start "$$")" "$$" "$claim_ns" >&7
exec 6>&-
printf 'admission_claim=%s\n' "$claim" >> "$telemetry"
scratch=$(mktemp -d "${TMPDIR:-/tmp}/baton2-queue-bootstrap.XXXXXXXX")
printf 'scratch=%s\n' "$scratch" >> "$telemetry"
run_phase() {
  "$@" > "$record/$phase.stdout" 2> "$record/$phase.stderr" &
  child=$!
  printf 'child_phase=%s\nchild_pid=%s\nchild_starttime=%s\n' \
    "$phase" "$child" "$(process_start "$child")" >> "$telemetry"
  rc=0
  wait "$child" || rc=$?
  cat "$record/$phase.stdout"
  cat "$record/$phase.stderr" >&2
  child=
  return "$rc"
}
run_phase "$compiler" "$entry" -o "$scratch/compile-queue.c"
phase=link
printf 'phase=%s\n' "$phase" >> "$telemetry"
run_phase "$cc" -O1 -pthread "$scratch/compile-queue.c" -lsqlite3 -lm -o "$output"
phase=done
printf 'phase=%s\n' "$phase" >> "$telemetry"
printf '%s\n' "$output"
