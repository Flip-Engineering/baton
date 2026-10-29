#!/bin/sh
# Check one Bend entry through the selected shared compilation queue.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'usage: check-entry.sh ENTRY.bend' >&2
  exit 2
fi
entry=$1
compiler=${BEND:-"$root/.bend/bin/bend"}
if [ ! -x "$compiler" ]; then
  compiler="$root/node_modules/.bend/bin/bend"
fi
BEND=$compiler
export BEND
. "$root/bend2/scripts/queue-entry.sh"
driver=${BATON2_NATIVE_QUEUE_DRIVER:-"$root/.github/scripts/queue-native-checks.py"}
exec "${PYTHON3:-python3}" "$driver" compiler bend "$entry" --check-only
