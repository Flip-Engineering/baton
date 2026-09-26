#!/bin/sh
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$root"
sh bend2/scripts/build-native.sh
sh bend2/scripts/build-native.sh bend2/test/process.bend .scratch/bend2/process-test
sh bend2/scripts/build-native.sh bend2/tests/git.bend .scratch/bend2/git-test
.scratch/bend2/git-test
sh bend2/scripts/build-native.sh bend2/tests/land.bend .scratch/bend2/land-test
.scratch/bend2/land-test
python3 -m unittest discover -s bend2/test -p '*.py'
