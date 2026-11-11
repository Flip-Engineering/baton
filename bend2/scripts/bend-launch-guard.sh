#!/bin/sh
# Narrow bootstrap launch guard for the packaged Bend compiler.
#
# The product admission policy remains the native Bend2 design in
# docs/bend2/build-admission.md. This wrapper refuses a coordinator Main C
# generation unless the invoking process carries an admitted bounded cgroup and
# a matching decision receipt. Focused entries, version queries and
# --check-only calls pass through unchanged.
#
# The canonical path is a delegated cgroup under /sys/fs/cgroup with a finite
# memory.max. There is no opt-out variable.
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)

entry=
output=
check_only=0
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
    --check-only|version|--version)
      check_only=1
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

refuse() {
  printf '{"error":"build-admission-required","condition":"%s","entry":"%s","output":"%s","cgroup":"%s","receipt":"%s","next":"Run the build through the admitted cgroup and receipt, or use a focused entry."}\n' \
    "$1" "$entry" "$output" "${BATON2_ADMISSION_CGROUP:-}" "${BATON2_ADMISSION_RECEIPT:-}" >&2
  exit 78
}

if [ "$full" = 1 ] && [ "$check_only" = 0 ]; then
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

exec "$root/bin/bun" --smol "$root/bend2/main.ts" "$@"
