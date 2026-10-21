#!/bin/sh
# Thin invocation only. The queue behavior lives in
# bend2/src/host/compile-queue.bend and its host effects.
set -eu
# Accept the separator used by callers invoking a Bend executable directly.
case "${1:-}" in --) shift ;; esac
for candidate in \
  ${BATON2_COMPILE_QUEUE_BIN:+"$BATON2_COMPILE_QUEUE_BIN"} \
  ${BATON2_COMPILE_QUEUE:+"$BATON2_COMPILE_QUEUE"} \
  ${BATON2_PREFIX:+"$BATON2_PREFIX/bin/baton-compile-queue"}; do
  [ -n "$candidate" ] || continue
  # Retained launcher paths can select this script through BATON2_COMPILE_QUEUE.
  [ "$candidate" -ef "$0" ] && continue
  if [ -x "$candidate" ]; then
    exec "$candidate" -- "$@"
  fi
done
printf 'compile-queue: missing Bend2 queue executable; set BATON2_COMPILE_QUEUE_BIN or BATON2_COMPILE_QUEUE, or install bin/baton-compile-queue\n' >&2
exit 2
