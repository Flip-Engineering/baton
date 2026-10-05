#!/bin/sh
# The project .clangd names this script through --query-driver. A provider that
# honors target configuration executes it and the marker appears; the adapter
# disables automatic configuration loading and query-driver execution, so the
# marker must stay absent.
dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 1
printf '%s' 'driver-executed' > "$dir/driver-ran.marker"
exec /usr/bin/true
