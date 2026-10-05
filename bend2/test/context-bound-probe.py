#!/usr/bin/env python3
"""Native fixture driver for the additive bound database operations.

Builds bend2/test/context-bound-probe.bend with the pinned Bend 2.0.25 compiler,
creates a throwaway coordination database with a marker table, runs the probe and
asserts that a healthy bound call executes its SQL exactly once while every
refused binding executes none. The database lives under
.scratch/context-bound-probe/ and nothing else is written.
"""

import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORK = ROOT / ".scratch" / "context-bound-probe"
ENTRY = ROOT / "bend2" / "test" / "context-bound-probe.bend"
COMPILER = pathlib.Path(
    os.environ.get(
        "BEND",
        ROOT / ".scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend",
    )
)
FAILURES = []


def check(condition, label, detail=""):
    if not condition:
        FAILURES.append(f"{label}: {detail}")


def run(argv):
    env = dict(os.environ, BEND_NO_TELEMETRY="1")
    return subprocess.run(argv, capture_output=True, text=True, env=env)


def main():
    if not COMPILER.exists():
        raise SystemExit(f"Bend compiler not found at {COMPILER}; set BEND")
    WORK.mkdir(parents=True, exist_ok=True)
    db = WORK / "coord.sqlite"
    copy = WORK / "copy.sqlite"
    for path in (db, copy):
        if path.exists():
            path.unlink()
    connection = sqlite3.connect(str(db))
    connection.execute("CREATE TABLE marker(tag TEXT)")
    connection.commit()
    connection.close()
    shutil.copyfile(db, copy)

    build = run([str(COMPILER), str(ENTRY), "-o", str(WORK / "probe.c")])
    if build.returncode != 0:
        print(build.stdout)
        print(build.stderr, file=sys.stderr)
        raise SystemExit(f"bend compile failed with exit {build.returncode}")
    link = run(["clang", "-O1", "-pthread", str(WORK / "probe.c"), "-lsqlite3", "-lm", "-o", str(WORK / "probe")])
    if link.returncode != 0:
        print(link.stderr, file=sys.stderr)
        raise SystemExit(f"clang link failed with exit {link.returncode}")

    result = run([str(WORK / "probe"), str(db), str(copy)])
    (WORK / "probe.stdout").write_text(result.stdout)
    (WORK / "probe.stderr").write_text(result.stderr)
    print(result.stdout, end="")
    if result.stderr:
        print(result.stderr, end="", file=sys.stderr)
    check(result.returncode == 0, "probe exit", str(result.returncode))

    values = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    check(values, "probe produced no observations", result.stdout[:200])

    binding = values.get("binding.original")
    parsed = None
    try:
        parsed = json.loads(binding)
    except (TypeError, ValueError):
        check(False, "binding.original", f"not JSON: {binding!r}")
    if parsed:
        check(parsed.get("scheme") == "dev-ino-birth", "binding.scheme", parsed.get("scheme"))
        check(parsed.get("path") == os.path.realpath(db), "binding.path", parsed.get("path"))
        for member in ("version", "device", "file", "birth", "vfs"):
            check(member in parsed, f"binding.{member}", "missing")
    refusals = {
        key: value
        for key, value in values.items()
        if isinstance(value, str)
        and (value.startswith("context database binding mismatch:") or value.startswith("context database binding unavailable:"))
    }
    check(refusals, "no binding refusal was observed", list(values)[:10])
    check(
        any(value.startswith("context database binding mismatch:") for value in refusals.values()),
        "no mismatch refusal was observed",
        refusals,
    )

    # The healthy call is the only one allowed to execute caller SQL: the probe's
    # marker insert runs once, and every refused binding must have run none.
    with sqlite3.connect(str(db)) as inspect:
        markers = inspect.execute("SELECT count(*) FROM marker").fetchone()[0]
    check(markers == 1, "marker count", f"{markers} (one healthy call expected, refusals must run none)")

    if FAILURES:
        print(f"context-bound-probe: {len(FAILURES)} failed checks")
        for failure in FAILURES:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("context-bound-probe: all checks green")


if __name__ == "__main__":
    main()
