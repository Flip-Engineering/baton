#!/bin/sh
# Run the independent halt-semantics probe on an admitted remote runner.
#
# Usage: sh run.sh --bend <bend-executable> --output <fresh-dir> [--root <checkout>]
#
# The probe builds once and runs each mode serially. Raw stdout, raw stderr and
# the actual exit status of every child are retained in the output directory,
# and the same JSON summary is printed to stdout for the caller to capture.
set -eu

bend=""
output=""
root="$(CDPATH= cd -- "$(dirname -- "$0")/../../.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --bend) bend="$2"; shift 2 ;;
    --output) output="$2"; shift 2 ;;
    --root) root="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$bend" ] || { echo "--bend is required" >&2; exit 2; }
[ -n "$output" ] || { echo "--output is required" >&2; exit 2; }
[ -e "$output" ] && { echo "refusing existing output directory: $output" >&2; exit 2; }
mkdir -p "$output"

bend="$(CDPATH= cd -- "$(dirname -- "$bend")" && pwd)/$(basename -- "$bend")"
cc_bin="${CC:-cc}"

probe="$root/bend2/test/native-critic-boundary-scope/halt-probe.bend"
manifest="$output/src.manifest"
( cd "$root" && find bend2/src -type f | LC_ALL=C sort | xargs sha256sum ) > "$manifest"

sha() { sha256sum "$1" | awk '{print $1}'; }

{
  echo "bend_path=$bend"
  echo "bend_version=$("$bend" version)"
  echo "bend_sha256=$(sha "$bend")"
  echo "cc=$cc_bin"
  echo "cc_version=$("$cc_bin" --version | head -1)"
  echo "uname=$(uname -srm)"
  echo "probe_sha256=$(sha "$probe")"
  echo "src_manifest_sha256=$(sha "$manifest")"
  echo "src_files=$(wc -l < "$manifest")"
} > "$output/identity.txt"
cat "$output/identity.txt"

export BEND="$bend" CC="$cc_bin"
binary="$output/halt-probe"
( cd "$root" && sh bend2/scripts/build-native.sh bend2/test/native-critic-boundary-scope/halt-probe.bend "$binary" ) \
  > "$output/build.stdout" 2> "$output/build.stderr"
echo "build_exit=0"
echo "binary_sha256=$(sha "$binary")"

summary="$output/summary.jsonl"
: > "$summary"
status=0
for mode in die-23 die-41 try-24 try-19 stopped result-25 done; do
  set +e
  ( cd "$root" && "$binary" "$mode" ) > "$output/$mode.stdout" 2> "$output/$mode.stderr"
  code=$?
  set -e
  stdout=$(tr '\n' '|' < "$output/$mode.stdout")
  echo "mode=$mode exit=$code stdout=$stdout" | tee -a "$summary"
done

echo "runner_complete=1"
