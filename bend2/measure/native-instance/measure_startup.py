#!/usr/bin/env python3
"""Measure startup costs for the native CLI, the identity wrapper and Node.

Writes a JSON document of wall-time measurements. Each measurement runs several
repetitions and reports minimum, median and maximum wall time.

The run's inputs come from `measure_identity`: `BATON2_RELEASE`,
`BATON2_GIT_SERIES`, `BATON2_GIT_REGISTRY` and `BATON2_MEASURE_MODEL` are
required, and the resolved identity is written into the output. The retained
laptop baseline is reachable only by setting
`BATON2_MEASURE_IDENTITY=historical-fca7af87-laptop`, whose use the output
records. A configured path that does not resolve stops the run; no path is
substituted silently.

Usage: measure_startup.py FIXTURE_DATABASE OUT_PATH
"""
import json
import statistics
import subprocess
import sys
import time

import measure_identity

IDENTITY = measure_identity.identity()
RELEASE = IDENTITY["release"]
HELPER = IDENTITY["helper"]
REGISTRY = IDENTITY["registry"]
MODEL = IDENTITY["model"]


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
                "identity": IDENTITY,
                "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                "load": subprocess.run(["sysctl", "-n", "vm.loadavg"], capture_output=True, text=True).stdout.strip()}
    with open(out_path, "w") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
    print(json.dumps(document, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
