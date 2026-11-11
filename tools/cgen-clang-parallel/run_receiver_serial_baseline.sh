#!/usr/bin/env bash
# Properly timed same-flags serial baseline for the focused receiver C.
#
# Run INSIDE the prepared cgroup (root writes this pid into
# /sys/fs/cgroup/baton2.slice/baton2-build.slice/cgroup.procs first):
#
#   printf '%s' $$ > /sys/fs/cgroup/baton2.slice/baton2-build.slice/cgroup.procs
#   exec bash tools/cgen-clang-parallel/run_receiver_serial_baseline.sh
#
# It compiles the exact immutable C to baseline.o with the same flags as the
# build/ABI arm, links baseline.bin, verifies both hashes against the root
# build/ABI receipt, records /usr/bin/time -v per step and the cgroup read-back,
# and writes paired speedups against the already-recorded sharded arm.
set -uo pipefail

INPUT="/run/baton2-native-homelab/retained/baton-account-credits-793-702-20261017T0106Z/worktrees/runtime-memory-focus-luna-20261018/.scratch-runtime-memory-focus-20261018-6.c"
INPUT_SHA="be0f8d5bc981849d102fd6d8d46c94b7b2becacb044f6093af84957caa4565d5"
INPUT_BYTES=14716059
EXPECTED_OBJ_SHA="e790e195e9141e45affd3964e61435682aeba9f6dfe5830bd20527b0dd0d19d4"
EXPECTED_BIN_SHA="b70a109d3d72509284089488607a64d8971e84c00ea4bfea1ef8821c1d4ebe0a"
CC="/usr/bin/clang-19"
CGROUP="/sys/fs/cgroup/baton2.slice/baton2-build.slice"
OUTDIR="/var/tmp/cgen-clang-parallel-20261018/receiver-serial-baseline"
BUILD_RECEIPT="/var/tmp/cgen-clang-parallel-20261018/receiver-buildabi/build/receipt.json"

die() { echo "PRECONDITION-FAIL: $*" >&2; exit 4; }

[ -f "$INPUT" ] || die "input missing"
[ "$(sha256sum "$INPUT" | cut -d' ' -f1)" = "$INPUT_SHA" ] || die "input sha mismatch"
[ "$(stat -c %s "$INPUT")" = "$INPUT_BYTES" ] || die "input byte size mismatch"
[ -x "$CC" ] || die "clang missing"
grep -q "baton2-build.slice" /proc/self/cgroup || die "not inside $CGROUP"
MEM_MAX=$(cat "$CGROUP/memory.max" 2>/dev/null || echo unknown)
MEM_SWAP_MAX=$(cat "$CGROUP/memory.swap.max" 2>/dev/null || echo unknown)
[ "$MEM_MAX" = "17179869184" ] || die "memory.max=$MEM_MAX, expected 17179869184"
[ "$MEM_SWAP_MAX" = "0" ] || die "memory.swap.max=$MEM_SWAP_MAX, expected 0"

mkdir -p "$OUTDIR"
cd "$OUTDIR" || die "cannot enter $OUTDIR"

/usr/bin/time -v -o baseline-object.time "$CC" -O1 -pthread -c "$INPUT" -o baseline.o 2>> baseline-object.stderr
RC_OBJ=$?
[ "$RC_OBJ" = "0" ] || die "baseline object compile failed rc=$RC_OBJ"
OBJ_SHA=$(sha256sum baseline.o | cut -d' ' -f1)
[ "$OBJ_SHA" = "$EXPECTED_OBJ_SHA" ] || die "baseline object hash $OBJ_SHA != $EXPECTED_OBJ_SHA"

/usr/bin/time -v -o baseline-link.time "$CC" -O1 -pthread baseline.o -lsqlite3 -lm -o baseline.bin 2> baseline-link.stderr
RC_LINK=$?
[ "$RC_LINK" = "0" ] || die "baseline link failed rc=$RC_LINK"
BIN_SHA=$(sha256sum baseline.bin | cut -d' ' -f1)
[ "$BIN_SHA" = "$EXPECTED_BIN_SHA" ] || die "baseline binary hash $BIN_SHA != $EXPECTED_BIN_SHA"

OUTDIR="$OUTDIR" INPUT="$INPUT" INPUT_SHA="$INPUT_SHA" INPUT_BYTES="$INPUT_BYTES" \
OBJ_SHA="$OBJ_SHA" BIN_SHA="$BIN_SHA" CGROUP="$CGROUP" BUILD_RECEIPT="$BUILD_RECEIPT" \
python3 - <<'PY'
import json, os, platform, re
from pathlib import Path

E = os.environ
out = Path(E["OUTDIR"]); cg = Path(E["CGROUP"])

def read(name):
    try: return (cg / name).read_text().strip()
    except OSError: return None

def wall(path):
    text = Path(path).read_text(errors="replace")
    def grab(label):
        for line in text.splitlines():
            if line.strip().startswith(label): return line.split(": ", 1)[1].strip()
        return None
    raw = grab("Elapsed (wall clock) time")
    seconds = None
    if raw:
        parts = [float(x) for x in raw.split(":")]
        seconds = parts[0] * 3600 + parts[1] * 60 + parts[2] if len(parts) == 3 else parts[0] * 60 + parts[1]
    return {
        "wall_s": seconds,
        "user_s": float(grab("User time (seconds)")) if grab("User time (seconds)") else None,
        "sys_s": float(grab("System time (seconds)")) if grab("System time (seconds)") else None,
        "maxrss_kib": int(grab("Maximum resident set size (kbytes)")) if grab("Maximum resident set size (kbytes)") else None,
        "exit": int(grab("Exit status")) if grab("Exit status") else None,
        "path": str(Path(path).resolve()),
    }

obj = wall(out / "baseline-object.time")
lnk = wall(out / "baseline-link.time")
serial_s = (obj["wall_s"] or 0) + (lnk["wall_s"] or 0)
build = json.loads(Path(E["BUILD_RECEIPT"]).read_text())
arm = build["sharded_no_pch"]
sharded_compile_s = arm["total_wall_s"]
sharded_whole_s = arm.get("whole_route_wall_s") or (build.get("split_wall_s", 0) + sharded_compile_s)
receipt = {
    "schema": "baton-cgen-clang-parallel-receiver-serial-baseline-v1",
    "input": {"path": E["INPUT"], "sha256": E["INPUT_SHA"], "bytes": int(E["INPUT_BYTES"])},
    "flags": ["-O1", "-pthread"],
    "commands": {
        "object": ["/usr/bin/clang-19", "-O1", "-pthread", "-c", E["INPUT"], "-o", "baseline.o"],
        "link": ["/usr/bin/clang-19", "-O1", "-pthread", "baseline.o", "-lsqlite3", "-lm", "-o", "baseline.bin"],
    },
    "baseline": {
        "object_sha256": E["OBJ_SHA"], "binary_sha256": E["BIN_SHA"],
        "object_time": obj, "link_time": lnk,
        "compile_plus_link_wall_s": serial_s,
        "note": "object compile is the measured /usr/bin/time pass",
    },
    "paired_sharded_arm": {
        "receipt": E["BUILD_RECEIPT"],
        "compile_plus_link_wall_s": sharded_compile_s,
        "whole_route_wall_s": sharded_whole_s,
        "aggregate_peak_kib": arm["aggregate_peak_kib"],
        "binary_sha256": arm["binary_sha256"],
    },
    "paired_ratios": {
        "serial_over_sharded_compile_plus_link": serial_s / sharded_compile_s if sharded_compile_s else None,
        "serial_over_sharded_whole_route": serial_s / sharded_whole_s if sharded_whole_s else None,
        "serial_peak_over_sharded_aggregate_peak": (obj["maxrss_kib"] or 0) / arm["aggregate_peak_kib"] if arm["aggregate_peak_kib"] else None,
        "note": "same input and -O1 -pthread flags; sharded arm from the root build/ABI receipt; no codegen identity claim",
    },
    "cgroup": {
        "path": str(cg), "memory_max": E.get("MEM_MAX") or read("memory.max"),
        "memory_swap_max": E.get("MEM_SWAP_MAX") or read("memory.swap.max"),
        "memory_peak_bytes": read("memory.peak"), "memory_current_bytes": read("memory.current"),
        "memory_events": read("memory.events"),
    },
    "host": {"kernel": platform.release(), "loadavg": Path("/proc/loadavg").read_text().strip()},
}
(out / "serial-baseline-receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({
    "serial_compile_plus_link_wall_s": serial_s,
    "object_wall_s": obj["wall_s"], "link_wall_s": lnk["wall_s"],
    "object_maxrss_kib": obj["maxrss_kib"], "link_maxrss_kib": lnk["maxrss_kib"],
    "sharded_compile_plus_link_wall_s": sharded_compile_s,
    "sharded_whole_route_wall_s": sharded_whole_s,
    "serial_over_sharded_compile_plus_link": receipt["paired_ratios"]["serial_over_sharded_compile_plus_link"],
    "serial_over_sharded_whole_route": receipt["paired_ratios"]["serial_over_sharded_whole_route"],
    "cgroup_peak_bytes": receipt["cgroup"]["memory_peak_bytes"],
    "receipt": str(out / "serial-baseline-receipt.json"),
}, indent=2))
PY
