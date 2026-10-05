#!/bin/sh
# The compilation database names this script as the compiler for src/main.c.
# The script writes the marker file next to itself and then exits, so the
# marker records that the database's driver was executed.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
printf '%s' 'driver-executed' > "$dir/driver-ran.marker"
exec /usr/bin/true
