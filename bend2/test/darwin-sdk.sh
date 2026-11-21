#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P)
cd "$root"
work=${1:-"$root/.scratch/bend2/darwin-sdk-tests"}
mkdir -p "$work"
work=$(cd "$work" && pwd -P)
run=$(mktemp -d "$work/run.XXXXXXXX")
TMPDIR="$run" sh bend2/scripts/build-native.sh bend2/test/darwin-sdk.bend "$run/darwin-sdk-test"
"$run/darwin-sdk-test" "$run" "$run/darwin-sdk-test"
