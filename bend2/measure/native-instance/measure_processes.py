#!/usr/bin/env python3
"""Snapshot Baton2 and native-harness processes and classify them by role.

Read-only. Takes one ps snapshot, classifies each process by its own argv, then
asks footprint(1) for the exact phys_footprint of the Baton2 processes. Writes
one JSON document per run.

Usage: measure_processes.py OUTPUT.json [--label LABEL]
"""
import json
import os
import subprocess
import sys
import time

FIELDS = ["pid", "ppid", "pgid", "uid", "rss", "vsz", "%cpu", "time", "etime", "state"]

RELEASE_BIN = os.environ.get(
    "BATON2_RELEASE",
    "/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2")
GIT_SERIES = "libexec/baton2/git-series.mjs"


def parse_cpu_time(value):
    """Parse ps(1) TIME (MM:SS, MM:SS.SS or HH:MM:SS) into seconds."""
    text = value.strip()
    if not text:
        return None
    parts = text.split(":")
    try:
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    except ValueError:
        return None
    return None


def snapshot_ps():
    out = subprocess.run(
        ["ps", "-axo", ",".join(f + "=" for f in FIELDS) + ",command="],
        capture_output=True, text=True, check=True).stdout
    rows = []
    for line in out.splitlines():
        if not line.strip():
            continue
        parts = line.split(None, len(FIELDS))
        if len(parts) != len(FIELDS) + 1:
            continue
        row = dict(zip(FIELDS, parts[:-1]))
        row["command"] = parts[-1]
        for key in ("pid", "ppid", "pgid", "uid", "rss", "vsz"):
            row[key] = int(row[key])
        row["pctcpu"] = float(row.pop("%cpu"))
        row["cpu_s"] = parse_cpu_time(row.pop("time"))
        rows.append(row)
    return rows


def classify(row):
    """Return (kind, session, database) for a row, or (None, None, None)."""
    argv = row["command"].split()
    if not argv:
        return None, None, None
    exe = argv[0]
    if "git-series.mjs" in exe:
        return "git-series-launch", None, None
    if exe == RELEASE_BIN:
        rest = argv[1:]
        if rest and rest[0] == "--dispatch-message":
            return "delivery-dispatch", (rest[2] if len(rest) > 2 else None), (rest[1] if len(rest) > 1 else None)
        if rest and rest[0] == "--host-process-keeper":
            return "keeper", None, (rest[1] if len(rest) > 1 else None)
        if len(rest) > 2 and rest[1] == "receive":
            return "receive", rest[2], rest[0]
        if len(rest) > 3 and rest[1] == "turn":
            return "turn-dispatch", rest[2], rest[0]
        if rest and rest[0] == "--recover-receive":
            return "recover", (rest[2] if len(rest) > 2 else None), (rest[1] if len(rest) > 1 else None)
        return "cli", None, (rest[0] if rest else None)
    if "/toolchains/omp" in exe or exe.endswith("/omp"):
        return "harness-omp", None, None
    if exe.endswith("/codex") or exe.endswith("/muse-bin") or "muse-bin" in exe:
        return "harness-" + ("muse" if "muse" in exe else "codex"), None, None
    if exe.endswith("/bend"):
        return "bend-compiler", None, None
    return None, None, None


def footprint(pids, path):
    """Return {pid: {"footprint": bytes, "peak": bytes, "name": str}} for pids."""
    if not pids:
        return {}
    args = ["footprint", "-j", path]
    for pid in pids:
        args += ["-p", str(pid)]
    subprocess.run(args, capture_output=True, text=True)
    try:
        doc = json.load(open(path))
    except (OSError, json.JSONDecodeError):
        return {}
    result = {}
    for proc in doc.get("processes", []):
        auxiliary = proc.get("auxiliary") or {}
        result[proc["pid"]] = {
            "footprint": proc.get("footprint"),
            "peak": auxiliary.get("phys_footprint_peak"),
            "name": proc.get("name"),
        }
    return result


def take_snapshot(label):
    boot = subprocess.run(["sysctl", "-n", "kern.boottime"], capture_output=True, text=True).stdout.strip()
    started = time.time()
    rows = snapshot_ps()
    captured_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    baton = []
    for row in rows:
        kind, session, database = classify(row)
        if kind is None:
            continue
        baton.append(dict(row, kind=kind, session=session, database=database))

    baton_pids = [r["pid"] for r in baton if r["kind"] != "git-series-launch" and not r["kind"].startswith("harness")]
    fp = footprint(baton_pids, "/tmp/baton-footprint.json")
    for row in baton:
        info = fp.get(row["pid"])
        row["footprint"] = info["footprint"] if info else None
        row["footprint_peak"] = info["peak"] if info else None

    by_kind = {}
    for row in baton:
        entry = by_kind.setdefault(row["kind"], {"count": 0, "rss_kb": 0, "footprint_bytes": 0,
                                                 "footprint_peak_bytes": 0, "pctcpu": 0.0,
                                                 "cpu_s": 0.0, "footprint_missing": 0})
        entry["count"] += 1
        entry["rss_kb"] += row["rss"]
        entry["pctcpu"] += row["pctcpu"]
        entry["cpu_s"] = round(entry["cpu_s"] + (row["cpu_s"] or 0.0), 2)
        if row["footprint"] is None:
            entry["footprint_missing"] += 1
        else:
            entry["footprint_bytes"] += row["footprint"]
            entry["footprint_peak_bytes"] += row["footprint_peak"] or 0

    return {
        "label": label,
        "captured_at": captured_at,
        "boot": boot,
        "release_bin": RELEASE_BIN,
        "elapsed_s": round(time.time() - started, 3),
        "ps_row_count": len(rows),
        "processes": baton,
        "by_kind": by_kind,
    }


def main():
    args = sys.argv[1:]
    if args and args[0] == "--loop":
        count, interval_ms, out_path = int(args[1]), int(args[2]), args[3]
        label = args[4] if len(args) > 4 else "loop"
        with open(out_path, "a") as handle:
            for index in range(count):
                document = take_snapshot("%s#%d" % (label, index))
                handle.write(json.dumps(document, sort_keys=True) + "\n")
                handle.flush()
                summary = {kind: {"count": v["count"], "rss_kb": v["rss_kb"],
                                  "footprint_bytes": v["footprint_bytes"]}
                           for kind, v in document["by_kind"].items()}
                print(json.dumps({"sample": index, "at": document["captured_at"], "by_kind": summary}, sort_keys=True))
                if index + 1 < count:
                    time.sleep(interval_ms / 1000.0)
        return

    out_path = args[0]
    label = args[2] if len(args) > 2 and args[1] == "--label" else "snapshot"
    document = take_snapshot(label)
    with open(out_path, "w") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
    print(json.dumps({"label": label, "captured_at": document["captured_at"], "by_kind": document["by_kind"]},
                     indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
