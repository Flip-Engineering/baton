#!/bin/sh
# Produce immutable CLI read captures for attempt_exit_records.py.
#
# Every path is supplied by the caller. This script has no default CLI, no
# default database and no default output directory, so a remote run cannot pick
# up a laptop path by omission. The output directory must not already exist, so
# an interrupted or earlier capture set stays in place.
#
# Usage: capture-cli-reads.sh CLI DATABASE OUT_DIR SESSION_LIST
#   CLI           the admitted read CLI executable, recorded by path and hash
#   DATABASE      the exact database the reads name
#   OUT_DIR       a fresh directory for this capture set
#   SESSION_LIST  one session id per line, from attempt_exit_records.py --list-sessions
#
# For each read the script writes <name>.stdout, <name>.stderr and <name>.exit,
# plus capture.txt with the identity header and one "<name><TAB><exit>" line.
set -eu

if [ "$#" -ne 4 ]; then
  echo "usage: capture-cli-reads.sh CLI DATABASE OUT_DIR SESSION_LIST" >&2
  exit 2
fi

cli=$1
database=$2
out=$3
sessions=$4

[ -n "$cli" ] || { echo "capture: CLI path is empty" >&2; exit 2; }
[ -n "$database" ] || { echo "capture: database path is empty" >&2; exit 2; }
[ -n "$out" ] || { echo "capture: output directory is empty" >&2; exit 2; }
[ -x "$cli" ] || { echo "capture: CLI is not executable: $cli" >&2; exit 2; }
[ -f "$database" ] || { echo "capture: database does not exist: $database" >&2; exit 2; }
[ -f "$sessions" ] || { echo "capture: session list does not exist: $sessions" >&2; exit 2; }
if [ -e "$out" ]; then
  echo "capture: refusing to reuse an existing directory: $out" >&2
  exit 2
fi

hash_tool=sha256sum
command -v "$hash_tool" >/dev/null 2>&1 || hash_tool="shasum -a 256"
cli_sha=$($hash_tool "$cli" | awk '{print $1}')

mkdir -p "$out"
{
  printf 'cli=%s\n' "$cli"
  printf 'cli_sha256=%s\n' "$cli_sha"
  printf 'database=%s\n' "$database"
  printf 'captured_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'host=%s\n' "$(hostname)"
  printf 'uname=%s\n' "$(uname -srm)"
  printf '# name\texit\n'
} > "$out/capture.txt"

read_one() {
  name=$1
  shift
  status=0
  "$cli" "$database" "$@" > "$out/$name.stdout" 2> "$out/$name.stderr" || status=$?
  printf '%s\n' "$status" > "$out/$name.exit"
  printf '%s\t%s\n' "$name" "$status" >> "$out/capture.txt"
}

read_one players players

while IFS= read -r session; do
  case "$session" in
    ''|'#'*) continue ;;
  esac
  read_one "turns-$session" turns "$session"
done < "$sessions"

echo "capture: wrote $out"
