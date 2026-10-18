#!/bin/sh
# Narrow bootstrap launch guard for the packaged Bend compiler.
#
# The product admission policy remains the native Bend2 design in
# docs/bend2/build-admission.md. This wrapper requires an admitted bounded cgroup
# for focused and coordinator Main C generation. A coordinator Main also
# requires a matching decision receipt. Version queries and
# --check-only calls pass through unchanged.
#
# The canonical path is a delegated cgroup under /sys/fs/cgroup with a finite
# memory.max. There is no opt-out variable.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)

entry=
output=
query=0
expect_output=0
for argument in "$@"; do
  if [ "$expect_output" = 1 ]; then
    output=$argument
    expect_output=0
    continue
  fi
  case "$argument" in
    -o|--output)
      expect_output=1
      ;;
    version|--version)
      query=1
      ;;
    -)
      ;;
    -*)
      ;;
    *)
      if [ -z "$entry" ]; then
        entry=$argument
      fi
      ;;
  esac
done

entry_path=
if [ -n "$entry" ]; then
  entry_path=$(readlink -f -- "$entry" 2>/dev/null || true)
  [ -n "$entry_path" ] || entry_path=$entry
fi

full=0
case "$entry_path" in
  */bend2/src/coordinator/main.bend|bend2/src/coordinator/main.bend)
    full=1
    ;;
esac

# Every compiler invocation, including --check-only, requires the resource
# check. Version queries pass through without invoking the compiler.
build=1
if [ "$query" = 1 ]; then
  build=0
fi

refuse() {
  printf '{"error":"build-admission-required","condition":"%s","entry":"%s","output":"%s","cgroup":"%s","receipt":"%s","next":"Run the build through an admitted bounded cgroup; a coordinator Main also needs its decision receipt."}\n' \
    "$1" "$entry" "$output" "${BATON2_ADMISSION_CGROUP:-}" "${BATON2_ADMISSION_RECEIPT:-}" >&2
  exit 78
}

if [ "$build" = 1 ]; then
  cgroup=${BATON2_ADMISSION_CGROUP:-}
  receipt=${BATON2_ADMISSION_RECEIPT:-}
  [ -n "$cgroup" ] || refuse "missing-cgroup"
  cgroup_path=$(readlink -f -- "$cgroup" 2>/dev/null || true)
  [ -n "$cgroup_path" ] || refuse "missing-cgroup-directory"
  [ -d "$cgroup_path" ] || refuse "missing-cgroup-directory"
  case "$cgroup_path" in
    /sys/fs/cgroup/*) ;;
    *) refuse "cgroup-outside-canonical-root" ;;
  esac
  maximum=
  if [ -r "$cgroup_path/memory.max" ]; then
    maximum=$(cat "$cgroup_path/memory.max")
  fi
  [ -n "$maximum" ] || refuse "missing-memory-max"
  [ "$maximum" != max ] || refuse "unbounded-cgroup"
  case "$maximum" in
    ''|*[!0-9]*) refuse "invalid-memory-max" ;;
  esac
  [ "$maximum" -gt 0 ] || refuse "invalid-memory-max"
  swap_maximum=
  if [ -r "$cgroup_path/memory.swap.max" ]; then
    swap_maximum=$(cat "$cgroup_path/memory.swap.max")
  fi
  [ "$swap_maximum" = 0 ] || refuse "swap-not-disabled"
  [ "$(ulimit -v)" = unlimited ] || refuse "rlimit-as-capped"
  relative_cgroup=${cgroup_path#/sys/fs/cgroup}
  grep -Fxq "0::$relative_cgroup" /proc/self/cgroup || refuse "cgroup-membership-mismatch"
  if [ "$full" = 1 ]; then
    [ -f "$receipt" ] || refuse "missing-receipt"
    command -v jq >/dev/null 2>&1 || refuse "receipt-parser-unavailable"
    if [ -n "$output" ]; then
      jq -e --arg entry "$entry" --arg output "$output" --arg cgroup "$cgroup_path" \
        'type=="object" and .decision=="admitted" and .class=="full" and
         .entry==$entry and .output==$output and .cgroup==$cgroup' \
        "$receipt" >/dev/null 2>&1 || refuse "receipt-mismatch"
    else
      jq -e --arg entry "$entry" --arg cgroup "$cgroup_path" \
        'type=="object" and .decision=="admitted" and .class=="full" and
         .entry==$entry and .cgroup==$cgroup' \
        "$receipt" >/dev/null 2>&1 || refuse "receipt-mismatch"
    fi
  fi
fi

if [ "${BATON2_ADMISSION_CHECK_ONLY:-}" = 1 ]; then
  exit 0
fi

exec "$root/bin/bun" --smol "$root/bend2/main.ts" "$@"
