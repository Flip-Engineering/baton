#!/usr/bin/env bash
set -euo pipefail
if [[ $# != 1 ]]; then
    echo 'usage: install.sh QUALIFIED_QUEUE_BINARY' >&2
    exit 2
fi
readonly candidate=$(realpath -- "$1")
readonly source_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
readonly state=/var/tmp/baton2-compile-queue
[[ -x $candidate && -x $state/compile-queue-runner ]]
readonly staged=$(mktemp "$state/.compile-queue-runner.XXXXXXXX")
trap 'rm -f -- "$staged"' EXIT
install -m 0775 "$candidate" "$staged"
install -m 0775 "$source_root/bend2/scripts/run-workload.py" "$state/run-workload.py"
mv -fT -- "$staged" "$state/compile-queue-runner"
sha256sum "$state/compile-queue-runner" "$state/run-workload.py"
