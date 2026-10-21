#!/bin/sh
# Child half of check-bend.sh. The queue substitutes the artifact paths for
# the declared stdout and stderr destinations and stages this helper as an
# input.
set -u
compiler=$1
entry=$2
out=$3
err=$4
"$compiler" "$entry" --check-only >"$out" 2>"$err"
status=$?
cat "$err" >&2
exit "$status"
