#!/usr/bin/env python3
"""Build and run the instance event-registry fixture on an admitted runner.

Scope: this runner covers the pure registry decisions only. The retained
destination table, event queue, synchronization, reader effects and any
executor-side children are bound by the admitted remote executor and the
Controls-owned wrappers, not by this runner.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time

OWNED = ["bend2/src/instance/event-registry.bend",
         "bend2/test/instance-owner/event-registry.bend",
         "bend2/test/instance-owner/run.py"]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists():
        sys.exit(f"refusing existing output directory: {output} (fresh directory required)")
    output.mkdir(parents=True)
    root = Path(__file__).resolve().parents[3]
    env = dict(os.environ, BEND=str(Path(args.bend).resolve()))

    def git(*argv):
        return subprocess.run(["git", *argv], cwd=root, env=env,
                              capture_output=True, check=True).stdout.decode().strip()

    def record(name, payload):
        (output / (name + ".json")).write_text(json.dumps(payload, indent=2) + "\n")
        print(json.dumps(payload), flush=True)

    def launch(name, argv, cwd):
        streams = {1: open(output / (name + ".stdout"), "wb"),
                   2: open(output / (name + ".stderr"), "wb")}
        started = time.time()
        child = subprocess.Popen(argv, cwd=cwd, env=env, stdout=streams[1], stderr=streams[2])
        record(name + ".launch", {"name": name, "argv": list(map(str, argv)), "cwd": str(cwd),
                                  "pid": child.pid, "started_epoch": started})
        return child, streams, started

    def complete(name, child, streams, started):
        code = child.wait()
        for stream in streams.values():
            stream.close()
        payload = {"name": name, "pid": child.pid, "exit": code,
                   "started_epoch": started, "finished_epoch": time.time()}
        record(name + ".completion", payload)
        return code

    identity = {
        "commit": git("rev-parse", "HEAD"),
        "tree_before": git("rev-parse", "HEAD^{tree}"),
        "owned_clean": git("status", "--porcelain", "--", *OWNED) == "",
        "owned_sha256_before": {path: sha256(root / path) for path in OWNED},
        "bend_version": None,
        "bend_sha256": sha256(args.bend),
        "platform": platform.platform(),
        "module_sha256": sha256(root / OWNED[0]),
        "fixture_sha256": sha256(root / OWNED[1]),
        "runner_sha256": sha256(Path(__file__).resolve()),
        "custody_limits": ("OWNED files cover the instance author's pure registry "
                           "source only; build-native.sh, the coordinator import "
                           "closure and executor-side children are bound by the "
                           "admitted remote executor."),
    }
    assert identity["owned_clean"], "owned files must be committed and clean"
    child, streams, started = launch("compiler", [args.bend, "version"], root)
    assert complete("compiler", child, streams, started) == 0
    assert (output / "compiler.stdout").read_bytes().strip() == b"bend 2.0.25", \
        "compiler must be Bend 2.0.25"
    identity["bend_version"] = (output / "compiler.stdout").read_text().strip()
    (output / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")

    child, streams, started = launch("build", ["sh", "bend2/scripts/build-native.sh",
                                               "bend2/test/instance-owner/event-registry.bend",
                                               str(output / "event-registry-fixture")], root)
    assert complete("build", child, streams, started) == 0, "registry fixture build failed"

    child, streams, started = launch("laws", [str(output / "event-registry-fixture")], root)
    code = complete("laws", child, streams, started)
    assert code == 0, f"registry fixture exited {code}"
    text = (output / "laws.stdout").read_bytes()
    assert b"event-registry-ok" in text, "missing registry completion marker"
    for path in OWNED:
        assert sha256(root / path) == identity["owned_sha256_before"][path], \
            f"owned file changed during run: {path}"
    assert sha256(args.bend) == identity["bend_sha256"], "compiler changed during run"
    assert git("rev-parse", "HEAD^{tree}") == identity["tree_before"], "tree changed during run"
    print("event-registry: build and checks matched", flush=True)


if __name__ == "__main__":
    sys.exit(main())
