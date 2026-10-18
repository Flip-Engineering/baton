#!/bin/sh
# Build the focused knowledge entry and run the behavior fixture through it.
# The entry serves its own fixture owner and dispatches the coordinator commands
# the fixture uses, so the behavior suite does not need a full Main generation.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
if python3 --version 2>/dev/null; then
  PYTHON3=python3
else
  PYTHON3=/usr/bin/python3
fi
sh bend2/scripts/build-native.sh bend2/test/focused-knowledge.bend .scratch/bend2/focused-knowledge
BATON2_EXE="$root/.scratch/bend2/focused-knowledge" "$PYTHON3" bend2/test/knowledge.py "$@"
