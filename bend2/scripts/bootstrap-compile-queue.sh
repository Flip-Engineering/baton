#!/bin/sh
# One-time pinned bootstrap of the Bend2 compile queue executable. It builds
# only bend2/src/host/compile-queue.bend, using the reference shell queue at
# commit 97a95949 as the queue for this build. Normal builds keep using
# bend2/scripts/compile-queue.sh with the installed executable; this route
# never builds anything else.
set -eu
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
root=$(CDPATH= cd -- "$here/../.." && pwd -P)
ref=97a95949
blob=42764862d6dcc07d36fc0f50709f236de7ba8ccb
output=${1:-"$root/.scratch/bend2/compile-queue"}
actual=$(git -C "$root" rev-parse "$ref:bend2/scripts/compile-queue.sh")
if [ "$actual" != "$blob" ]; then
  printf 'compile-queue bootstrap: reference blob is %s, expected pinned blob %s\n' "$actual" "$blob" >&2
  exit 1
fi
tmp=$(mktemp -d "${TMPDIR:-/tmp}/compile-queue-bootstrap.XXXXXX")
trap 'rm -rf -- "$tmp"' EXIT HUP INT TERM
git -C "$root" show "$ref:bend2/scripts/compile-queue.sh" > "$tmp/compile-queue.sh"
chmod +x "$tmp/compile-queue.sh"
BATON2_COMPILE_QUEUE_BIN="$tmp/compile-queue.sh" \
  sh "$root/bend2/scripts/build-native.sh" "$root/bend2/src/host/compile-queue.bend" "$output"
