#!/bin/sh
[ "${1:-}" = -- ] && shift
exec /tmp/check-queue.sh "$@"
