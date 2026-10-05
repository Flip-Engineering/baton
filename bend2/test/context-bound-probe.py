#!/usr/bin/env python3
"""Native fixture driver for the additive bound database operations.

Builds bend2/test/context-bound-probe.bend with the pinned Bend 2.0.25 compiler,
creates a throwaway coordination database with a marker table, runs the probe and
asserts that a healthy bound call executes its SQL exactly once while every
refused binding executes none.

Every run writes into its own exclusive directory under .scratch/context-bound-probe/
so no earlier evidence is overwritten, and it retains the raw child streams, the
argv and cwd it ran with, the toolchain and source digests and a per-case result.
"""

import hashlib
import json
import os
import pathlib
import platform
import shutil
import sqlite3
import subprocess
import sys
import time

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
EVIDENCE = {"cases": []}


def check(condition, label, detail=""):
    if not condition:
        FAILURES.append(f"{label}: {detail}")
    return bool(condition)


def run(argv, cwd):
    env = dict(os.environ, BEND_NO_TELEMETRY="1")
    result = subprocess.run(argv, capture_output=True, text=True, env=env, cwd=str(cwd))
    return result


def digest(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


def case(name, result, out_path=None):
    entry = {"case": name, "argv": result.args, "exit": result.returncode}
    if out_path:
        out_path.write_text(result.stdout)
        err_path = out_path.with_suffix(".stderr")
        err_path.write_text(result.stderr)
        entry["stdout"] = str(out_path)
        entry["stderr"] = str(err_path)
        entry["stdout_sha256"] = digest(out_path)
    EVIDENCE["cases"].append(entry)
    return entry


def main():
    if not COMPILER.exists():
        raise SystemExit(f"Bend compiler not found at {COMPILER}; set BEND")
    WORK.mkdir(parents=True, exist_ok=True)
    run_dir = WORK / f"run-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}-{os.getpid()}"
    run_dir.mkdir()
    EVIDENCE["run_directory"] = str(run_dir)
    EVIDENCE["argv"] = sys.argv
    EVIDENCE["cwd"] = os.getcwd()
    EVIDENCE["platform"] = platform.platform()
    EVIDENCE["python"] = sys.version
    EVIDENCE["compiler"] = str(COMPILER)
    EVIDENCE["compiler_sha256"] = digest(COMPILER)
    EVIDENCE["entry"] = str(ENTRY)
    EVIDENCE["entry_sha256"] = digest(ENTRY)

    db = run_dir / "coord.sqlite"
    copy = run_dir / "copy.sqlite"
    connection = sqlite3.connect(str(db))
    connection.execute("CREATE TABLE marker(tag TEXT)")
    connection.commit()
    connection.close()
    shutil.copyfile(db, copy)

    build = run([str(COMPILER), str(ENTRY), "-o", str(run_dir / "probe.c")], run_dir)
    case("bend-compile", build, run_dir / "compile.stdout")
    if build.returncode != 0:
        print(build.stdout)
        print(build.stderr, file=sys.stderr)
        (run_dir / "evidence.json").write_text(json.dumps(EVIDENCE, indent=2))
        raise SystemExit(f"bend compile failed with exit {build.returncode}")
    EVIDENCE["generated_c_sha256"] = digest(run_dir / "probe.c")

    link = run(["clang", "-O1", "-pthread", str(run_dir / "probe.c"), "-lsqlite3", "-lm", "-o", str(run_dir / "probe")], run_dir)
    case("clang-link", link, run_dir / "link.stdout")
    if link.returncode != 0:
        print(link.stderr, file=sys.stderr)
        (run_dir / "evidence.json").write_text(json.dumps(EVIDENCE, indent=2))
        raise SystemExit(f"clang link failed with exit {link.returncode}")

    probe = run([str(run_dir / "probe"), str(db), str(copy)], run_dir)
    case("probe", probe, run_dir / "probe.stdout")
    print(probe.stdout, end="")
    if probe.stderr:
        print(probe.stderr, end="", file=sys.stderr)
    check(probe.returncode == 0, "probe exit", str(probe.returncode))

    values = {}
    for line in probe.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    EVIDENCE["observations"] = values
    check(values, "probe produced no observations", probe.stdout[:200])

    parsed = None
    try:
        parsed = json.loads(values.get("binding.original", ""))
    except (TypeError, ValueError):
        check(False, "binding.original", f"not JSON: {values.get('binding.original')!r}")
    if parsed:
        check(parsed.get("scheme") == "dev-ino-birth", "binding.scheme", parsed.get("scheme"))
        check(parsed.get("path") == os.path.realpath(db), "binding.path", parsed.get("path"))
        for member in ("version", "device", "file", "birth", "vfs"):
            check(member in parsed, f"binding.{member}", "missing")

    mismatches = {k: v for k, v in values.items() if isinstance(v, str) and v.startswith("context database binding mismatch:")}
    unavailable = {k: v for k, v in values.items() if isinstance(v, str) and v.startswith("context database binding unavailable:")}
    check(mismatches, "no mismatch refusal was observed", list(values)[:10])
    check(unavailable, "no unavailable refusal was observed", list(values)[:10])
    EVIDENCE["mismatch_cases"] = mismatches
    EVIDENCE["unavailable_cases"] = unavailable

    # The healthy call is the only one allowed to execute caller SQL: the marker
    # insert runs exactly once, and every refused binding runs none.
    with sqlite3.connect(str(db)) as inspect:
        markers = inspect.execute("SELECT count(*) FROM marker").fetchone()[0]
    EVIDENCE["marker_count"] = markers
    check(markers == 1, "marker count", f"{markers} (one healthy call expected, refusals must run none)")

    EVIDENCE["failures"] = FAILURES
    (run_dir / "evidence.json").write_text(json.dumps(EVIDENCE, indent=2))
    print(f"context-bound-probe: evidence in {run_dir}")
    if FAILURES:
        print(f"context-bound-probe: {len(FAILURES)} failed checks")
        for failure in FAILURES:
            print(f"  - {failure}")
        raise SystemExit(1)
    print("context-bound-probe: all checks green")


if __name__ == "__main__":
    main()
