#!/bin/sh
# Thin invocation only. The queue behavior lives in
# bend2/src/host/compile-queue.bend and its host effects.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/../.." && pwd -P)
for candidate in \
  ${BATON2_COMPILE_QUEUE_BIN:+"$BATON2_COMPILE_QUEUE_BIN"} \
  ${BATON2_COMPILE_QUEUE:+"$BATON2_COMPILE_QUEUE"} \
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
