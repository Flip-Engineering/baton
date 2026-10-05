#!/usr/bin/env python3
"""Observe recovery_argv on a synthetic released, unacknowledged attempt.

The manifest uses the baseline native ABI. No native process is launched,
attached or recovered by this probe; the birth record is synthetic.
"""

import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


class ManifestHeader(ctypes.Structure):
    _fields_ = [("magic", ctypes.c_char * 8), ("lengths", ctypes.c_uint64 * 6),
                ("keep_stdin", ctypes.c_uint32), ("reserved", ctypes.c_uint32)]


class Birth(ctypes.Structure):
    _fields_ = [("pid", ctypes.c_int32), ("first", ctypes.c_uint64),
                ("second", ctypes.c_uint64)]


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
        record = {"name": name, "argv": argv, "exit": result.returncode,
                  "stdout": result.stdout.decode(errors="replace"),
                  "stderr": result.stderr.decode(errors="replace")}
        (output / (name + ".stdout")).write_bytes(result.stdout)
        (output / (name + ".stderr")).write_bytes(result.stderr)
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)
        assert result.returncode == 0
        return result

    run("source", ["git", "rev-parse", "HEAD"])
    version = run("compiler", [args.bend, "version"])
    assert version.stdout.strip() == b"bend 2.0.25"
    files = ["bend2/src/host/process-spawn.c", "bend2/src/host/process.bend",
             "bend2/test/shared-owner-lifetime-critic/recovery.bend"]
    (output / "source-sha256.json").write_text(json.dumps({
        path: hashlib.sha256((root / path).read_bytes()).hexdigest() for path in files
    }, indent=2) + "\n")
    binary = str(output / "recovery")
    run("build", ["sh", "bend2/scripts/build-native.sh",
                  "bend2/test/shared-owner-lifetime-critic/recovery.bend", binary])
    with tempfile.TemporaryDirectory(prefix="attempt-", dir=output) as directory:
        attempt = Path(directory)
        fields = [b"unused-native\0", b".", b"unused-stderr", b"",
                  b"fixture-recovery\0", b"unused-socket"]
        header = ManifestHeader(b"BATONRP1", (ctypes.c_uint64 * 6)(*map(len, fields)), 0, 0)
        (attempt / "manifest").write_bytes(bytes(header) + b"".join(fields))
        (attempt / "native.birth").write_bytes(bytes(Birth(0, 0, 0)))
        (attempt / "launch").write_text("fixture\n")
        before = run("before-release", [binary, directory])
        assert before.stdout == b"recovery-command:fixture-recovery\n"
        (attempt / "released").write_text("released\n")
        assert not (attempt / "acknowledged").exists()
        after = run("released-unacknowledged", [binary, directory])
        assert after.stdout == b"no-recovery-command\n"


if __name__ == "__main__":
    main()
