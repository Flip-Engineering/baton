#!/bin/sh
# Bootstrap launcher for the packaged Bend compiler.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
exec "$root/bin/bun" --smol "$root/bend2/main.ts" "$@"
