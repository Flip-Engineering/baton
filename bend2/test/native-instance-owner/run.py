#!/usr/bin/env python3
"""Build and run the custody-task fixture, retaining every raw result.

The runner records the source commit, compiler version, module hashes, the
full build output and each mode's argv, stdout, stderr and actual exit status
under the output path. It asserts the expected exit for each mode and prints
one JSON record per run.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


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
    sources = ["bend2/src/context/custody-tasks.bend",
               "bend2/test/native-instance-owner/custody-tasks.bend"]
    (output / "source-sha256.json").write_text(json.dumps({
        path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in sources
    }, indent=2) + "\n")
    built = run("build", ["sh", "bend2/scripts/build-native.sh",
                          "bend2/test/native-instance-owner/custody-tasks.bend",
                          str(output / "custody-fixture")])
    assert built.returncode == 0, "fixture build failed; raw stderr retained"

    expected = {
        "laws": ("0", ["owner-ready", "owner-survived", "released-not-acknowledged-rebuilds-open-ok"]),
        "die": ("23", ["owner-ready"]),
        "try": ("24", ["owner-ready"]),
        "stopped": ("2", ["owner-ready"]),
        "result": ("0", ["owner-ready", "25:task-result", "owner-survived"]),
    }
    for mode, (code, needs) in expected.items():
        result = run("laws-" + mode if mode == "laws" else mode,
                     [str(output / "custody-fixture"), mode])
        assert result.returncode == int(code), f"{mode}: exit {result.returncode}, expected {code}"
        text = result.stdout
        for need in needs:
            assert need.encode() in text, f"{mode}: missing {need!r}"
    print("custody-fixture: all modes matched expected exits", flush=True)


if __name__ == "__main__":
    sys.exit(main())
