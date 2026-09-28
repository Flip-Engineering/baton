#!/bin/sh
# Check one selected Python test file for the checked landing.
#
# The gate (bend2/src/git/land_checked in bend2/src/git/land.bend) runs this
# script as
#   /bin/sh CHECK SELECTED_FILE
# inside each checked tree, once per selected file per tree. A passing run
# exits 0 and prints nothing. A failing run prints one line per failing
# case as four hex-encoded fields separated by single spaces: the selected
# file, the test id, the failure type (assertion, error, unexpected-success,
# missing-file or import-error), and the stable semantic code ("-"). It exits
# 1. Identical failures in two trees print identical lines, so the gate can
# tell a new failure from one the target shows too.
#
# A run that executed no test, or that skipped any test, prints a line that
# is not a failure identity and exits 1. A test decorated with
# unittest.expectedFailure prints nothing when it fails, as unittest reports
# that as an expected failure, and is named with the unexpected-success kind
# when it passes.
#
# stdout carries only identity lines: any other stdout line makes the run
# unjudged, and an unjudged run blocks the landing whatever the other tree
# printed. Diagnostics go to stderr.
#
# The test files under bend2/test drive the coordinator binary at
# .scratch/bend2/baton2 and skip when it is missing, so a selection under
# bend2/test builds the binary in the checked tree first, from $BEND or the
# documented compiler locations. A build failure prints no stdout and
# exits 1 with no identity lines, which the gate reports as unjudged.
set -eu

if [ "$#" -ne 1 ]; then
  echo "usage: check-unittest.sh SELECTED_FILE" >&2
  exit 2
fi

if python3 --version >/dev/null 2>&1; then
  PY=python3
else
  PY=/usr/bin/python3
fi
exec "$PY" - "$1" <<'PY'
import importlib.util
import os
import pathlib
import subprocess
import sys
import unittest


def hx(s):
    return s.encode("utf-8").hex()


def identity(path, test, kind):
    print(f"{hx(path)} {hx(test)} {hx(kind)} {hx('-')}")


def unjudged(path, detail):
    print(f"check-unittest: unjudged: {path}: {detail}")


path = sys.argv[1]
if not pathlib.Path(path).is_file():
    identity(path, "load", "missing-file")
    sys.exit(1)

if path.startswith("bend2/test/"):
    exe = pathlib.Path(".scratch/bend2/baton2")
    if not exe.exists():
        compiler = os.environ.get("BEND") or ""
        if not compiler:
            for candidate in (".bend/bin/bend", "node_modules/.bend/bin/bend"):
                if pathlib.Path(candidate).exists():
                    compiler = candidate
                    break
        if not compiler:
            print("check-unittest: no Bend compiler found for the build", file=sys.stderr)
            sys.exit(1)
        build = subprocess.run(
            ["sh", "bend2/scripts/build-native.sh"],
            stdout=subprocess.DEVNULL,
            env={**os.environ, "BEND": compiler},
        )
        if build.returncode != 0 or not exe.exists():
            print("check-unittest: the coordinator binary did not build", file=sys.stderr)
            sys.exit(1)

name = "bend2_selected_" + pathlib.Path(path).stem.replace("-", "_").replace(".", "_")
spec = importlib.util.spec_from_file_location(name, path)
module = importlib.util.module_from_spec(spec)
try:
    spec.loader.exec_module(module)
except Exception:
    identity(path, "load", "import-error")
    sys.exit(1)

suite = unittest.defaultTestLoader.loadTestsFromModule(module)
result = unittest.TestResult()
suite.run(result)
for test, _ in result.failures:
    identity(path, test.id(), "assertion")
for test, _ in result.errors:
    identity(path, test.id(), "error")
for test in result.unexpectedSuccesses:
    identity(path, test.id(), "unexpected-success")
ran = result.testsRun - len(result.skipped)
for test, _ in result.skipped:
    unjudged(path, f"{test.id()}: skipped")
if ran <= 0:
    unjudged(path, "no test ran")
bad = bool(result.failures or result.errors or result.unexpectedSuccesses
           or result.skipped or ran <= 0)
sys.exit(1 if bad else 0)
PY
