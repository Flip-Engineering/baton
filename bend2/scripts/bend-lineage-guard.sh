#!/bin/sh
# Refuse a compiler from a fork line this tree did not pin.
#
# Every Baton fork line answers "bend 2.0.25", so build-native.sh's version
# check passes for all of them and cannot notice that BEND was pointed at a
# different line. A release carries fork-manifest.json beside bin/, and its
# source_commit names the line; bend2/toolchain/runtime-pin.txt names the line
# a build must use. A selector that only execs the real compiler is followed
# once, because that is the shape an operator installs at ~/.local/bin/bend.
#
# A compiler with no manifest anywhere is the stock upstream release, which is
# a legitimate development compiler; it is reported as unverified and allowed.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
compiler=${1:?usage: bend-lineage-guard.sh <compiler>}
pin="$root/toolchain/runtime-pin.txt"

if [ ! -f "$pin" ]; then
  echo "bend-lineage: no runtime pin at $pin" >&2
  exit 1
fi

want_commit=
want_release=
want_cache=
require_cache=0
while IFS= read -r line; do
  case $line in
    ''|'#'*) continue ;;
  esac
  key=${line%%=*}
  value=${line#*=}
  case $key in
    lineage_commit) want_commit=$value ;;
    release_name) want_release=$value ;;
    cache_ts_sha256) want_cache=$value ;;
    require_cgen_cache) require_cache=$value ;;
  esac
done < "$pin"

if [ -z "$want_commit" ]; then
  echo "bend-lineage: $pin names no lineage_commit" >&2
  exit 1
fi

# Look beside the compiler, then one directory up (a release keeps its
# manifest at <release>/fork-manifest.json, next to bin/). If neither has one
# and the compiler is a selector, follow its single exec target once.
manifest=
dir=
probe=$compiler
hops=0
while [ "$hops" -le 2 ] && [ -z "$manifest" ]; do
  here=$(dirname -- "$probe")
  up=$(dirname -- "$here")
  if [ -f "$here/fork-manifest.json" ]; then
    manifest="$here/fork-manifest.json"
    dir=$here
    break
  fi
  if [ -f "$up/fork-manifest.json" ]; then
    manifest="$up/fork-manifest.json"
    dir=$up
    break
  fi
  target=$(sed -n 's/^exec "\([^"]*\)".*/\1/p' "$probe" 2>/dev/null | head -n 1)
  if [ -n "$target" ] && [ -x "$target" ] && [ "$target" != "$probe" ]; then
    probe=$target
    hops=$((hops + 1))
    continue
  fi
  break
done

if [ -z "$manifest" ]; then
  echo "bend-lineage: $compiler records no fork line (no fork-manifest.json); it cannot be verified against $want_commit, so it is assumed to be upstream Bend 2.0.25" >&2
  exit 0
fi

got_commit=$(sed -n 's/^[[:space:]]*"source_commit":[[:space:]]*"\([^"]*\)".*/\1/p' "$manifest" | head -n 1)
if [ -z "$got_commit" ]; then
  echo "bend-lineage: $manifest records no source_commit, so it cannot name its line" >&2
  exit 1
fi
if [ "$got_commit" != "$want_commit" ]; then
  echo "bend-lineage: $manifest is fork line $got_commit, and this tree pins $want_commit${want_release:+ ($want_release)}" >&2
  exit 1
fi

cache="$dir/bend2/cache.ts"
if [ -f "$cache" ]; then
  if [ -n "$want_cache" ]; then
    got_cache=$(sha256sum "$cache" | cut -d' ' -f1)
    if [ "$got_cache" != "$want_cache" ]; then
      echo "bend-lineage: $cache is $got_cache, and this tree pins $want_cache" >&2
      exit 1
    fi
  fi
  exit 0
fi

if [ "$require_cache" = 1 ]; then
  echo "bend-lineage: $manifest is the pinned line without the emitted-C cache, and the pinned release${want_release:+ $want_release} has it" >&2
  exit 1
fi
echo "bend-lineage: notice: $manifest carries no emitted-C cache; the pinned release${want_release:+ $want_release} does" >&2
exit 0
