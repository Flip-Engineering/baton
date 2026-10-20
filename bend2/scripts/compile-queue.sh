#!/bin/sh
# Thin invocation only. The queue behavior lives in
# bend2/src/host/compile-queue.bend and its host effects.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/../.." && pwd -P)
if [ -n "${BATON2_COMPILE_QUEUE_BIN:-}" ]; then
  if [ ! -x "$BATON2_COMPILE_QUEUE_BIN" ]; then
    printf 'compile-queue: selected executable is missing or not executable: %s\n' "$BATON2_COMPILE_QUEUE_BIN" >&2
    exit 2
  fi
  exec "$BATON2_COMPILE_QUEUE_BIN" "$@"
fi
for candidate in \
  ${BATON2_PREFIX:+"$BATON2_PREFIX/bin/baton-compile-queue"} \
  "$here/baton-compile-queue" \
  "$root/.scratch/bend2/compile-queue" \
  "$root/.scratch/bend2/baton-compile-queue"; do
  [ -n "$candidate" ] || continue
  if [ -x "$candidate" ]; then
    exec "$candidate" "$@"
  fi
done
printf 'compile-queue: missing Bend2 queue executable; set BATON2_COMPILE_QUEUE_BIN or build bend2/src/host/compile-queue.bend with the normal native build\n' >&2
exit 2
