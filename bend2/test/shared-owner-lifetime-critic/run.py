#!/usr/bin/env python3
"""Run baseline counterexamples against imported production functions.

These probes describe shared-owner integration requirements. They do not qualify
a shared-owner implementation. Every child result is retained in the output path.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, BEND=str(Path(args.bend).resolve()))

    def run(name, argv):
        result = subprocess.run(argv, cwd=root, env=env, capture_output=True)
        (output / (name + ".stdout")).write_bytes(result.stdout)
        (output / (name + ".stderr")).write_bytes(result.stderr)
        record = {"name": name, "argv": list(map(str, argv)), "exit": result.returncode,
                  "stdout": result.stdout.decode(errors="replace"),
                  "stderr": result.stderr.decode(errors="replace")}
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)
        return result

    identity = run("source", ["git", "rev-parse", "HEAD"])
    assert identity.returncode == 0
    version = run("compiler", [args.bend, "version"])
    assert version.returncode == 0
    assert version.stdout.strip() == b"bend 2.0.25"
    sources = ["bend2/src/host/session-lock.c", "bend2/src/host/session-lock.bend",
               "bend2/src/coordinator/stop.bend"]
    (output / "source-sha256.json").write_text(json.dumps({
        path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in sources
    }, indent=2) + "\n")
    for fixture in ("failure", "guard"):
        built = run("build-" + fixture, ["sh", "bend2/scripts/build-native.sh",
                    f"bend2/test/shared-owner-lifetime-critic/{fixture}.bend",
                    str(output / fixture)])
        assert built.returncode == 0

    for mode, expected in (("die", 23), ("try", 24), ("stopped", 2), ("result", 0)):
        result = run("failure-" + mode, [str(output / "failure"), mode])
        assert result.returncode == expected
        assert b"owner-ready" in result.stdout
        assert (b"owner-survived" in result.stdout) == (mode == "result")

    with tempfile.TemporaryDirectory(prefix="guards-", dir=output) as directory:
        fixture = Path(directory)
        database = fixture / "state.db"
        database.touch()
        (fixture / "symlink.db").symlink_to(database)
        (fixture / "hardlink.db").hardlink_to(database)
        for alias, expected in (("state.db", "busy"), ("symlink.db", "busy"),
                                ("hardlink.db", "acquired")):
            result = run("guard-" + alias, [str(output / "guard"), str(database),
                                           str(fixture / alias)])
            assert result.returncode == 0
            assert result.stdout.decode().splitlines() == [
                "same-session:" + expected, "other-session:acquired"]


if __name__ == "__main__":
    main()
