#!/usr/bin/env python3
"""Measure startup costs for the native CLI, the identity wrapper and Node.

Writes evidence/startup-costs.json. Each measurement runs several repetitions
and reports minimum and median wall time.

Usage: measure_startup.py FIXTURE_DATABASE OUT_PATH
"""
import json
import statistics
import subprocess
import sys
import time

RELEASE = os.environ.get(
    "BATON2_RELEASE",
    "/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2")
RELEASE_ROOT = os.path.dirname(os.path.dirname(RELEASE))
HELPER = os.environ.get("BATON2_GIT_SERIES", os.path.join(RELEASE_ROOT, "libexec/baton2/git-series.mjs"))
REGISTRY = os.environ.get("BATON2_GIT_REGISTRY", "/Users/wahargis/.config/baton/github-apps/series.json")
MODEL = os.environ.get("BATON2_MEASURE_MODEL", "deepseek/deepseek-flash")


def timed(args, repetitions=5):
    times = []
    result = None
    for _ in range(repetitions):
        started = time.perf_counter()
        result = subprocess.run(args, capture_output=True, text=True)
        times.append(time.perf_counter() - started)
    return {"argv": args, "repetitions": repetitions, "exit": result.returncode,
            "min_s": round(min(times), 4), "median_s": round(statistics.median(times), 4),
            "max_s": round(max(times), 4), "stdout_bytes": len(result.stdout)}


def main():
    database, out_path = sys.argv[1:3]
    node = subprocess.run(["which", "node"], capture_output=True, text=True).stdout.strip()
    node_version = subprocess.run(["node", "--version"], capture_output=True, text=True).stdout.strip()
    rows = [
        timed([RELEASE, "help"]),
        timed([RELEASE, database, "players"]),
        timed([RELEASE, database, "session", "fixture-agent"]),
        timed([RELEASE, database, "status"]),
        timed(["node", HELPER, "check", "--registry", REGISTRY, "--model-key", MODEL]),
        timed(["node", HELPER, "launch", "--registry", REGISTRY, "--model-key", MODEL, "--", "/usr/bin/true"]),
    ]
    floor = subprocess.Popen(["node", "-e", "setTimeout(()=>{},20000)"])
    time.sleep(1.5)
    detail = subprocess.run(["ps", "-o", "rss=,%cpu=", "-p", str(floor.pid)],
                            capture_output=True, text=True).stdout.split()
    floor.terminate()
    node_floor = {"rss_kb": int(detail[0]), "pctcpu": float(detail[1])} if len(detail) >= 2 else {}
    document = {"node": node, "node_version": node_version, "node_floor": node_floor, "measurements": rows,
                "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "load": subprocess.run(["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True).stdout.strip()}
    with open(out_path, "w") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
    print(json.dumps(document, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
