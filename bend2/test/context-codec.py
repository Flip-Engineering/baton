#!/usr/bin/env python3
"""Host fixtures for the semantic-context codec lane.

Compilation, build and test execution for this project is remote-only; do not run
this on the orchestrator.

Exit status separates collection from qualification:

  0  collection completed and every required outcome qualified
  1  the collection itself failed, or an executed outcome failed
  2  collection completed, nothing failed, but some result is unqualified
     (a module whose output has no independently reviewed oracle)

Every executed command's argv, working directory, stdout, stderr, status and
signal is recorded, and the raw streams are written to files as they run. Source
and toolchain hashes are taken before and after the run; a change fails the run. A
byte-level discrepancy against a proposed oracle is retained and governs the
result: the oracle file is never rewritten.

The mutation records in bend2/src/context/codec-mutations.json are handed to the
single Controls/CI classifier. This driver only checks their shape and that each
`find` occurs exactly once; it draws no verdict about refusal.
"""

import argparse
import hashlib
import json
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTEXT = ROOT / "bend2" / "src" / "context"
EXTRA_MODULES = ["engines.bend", "snapshot.bend", "refs.bend"]
CHECK_MODULES = ["contracts.bend", "request.bend", "operations.bend", "codec.bend", "raw-fixture.bend"]
ENTRY_MODULES = ["contracts.bend", "operations.bend", "codec.bend"]

RAW_CASES = [
    ("ok-ascii.bin", b'{"version":1}', "text 123 34 118 101 114 115 105 111 110 34 58 49 125"),
    ("ok-astral.bin", '{"s":"\U0001F600\U0001F680"}'.encode("utf-8"),
     "text 123 34 115 34 58 34 128512 128640 34 125"),
    ("ok-cjk.bin", '{"k":"\u6f22\u5b57"}'.encode("utf-8"),
     "text 123 34 107 34 58 34 28450 23383 34 125"),
    ("bad-nul.bin", b"a\x00b", "nul 1"),
    ("bad-truncated.bin", b"\xe2\x82", "invalidUtf8 0"),
    ("bad-overlong.bin", b"\xc0\xaf", "invalidUtf8 0"),
    ("bad-surrogate.bin", b"\xed\xa0\x80", "invalidUtf8 0"),
    ("bad-above.bin", b"\xf5\x80\x80\x80", "invalidUtf8 0"),
    ("bad-late.bin", b"ok\xff", "invalidUtf8 2"),
    ("bom.bin", b'\xef\xbb\xbf{"a":1}', "bom"),
    ("nul-then-bad.bin", b"a\x00\xff", "invalidUtf8 2"),
    ("bom-then-bad.bin", b"\xef\xbb\xbf\xff", "bom"),
    ("empty.bin", b"", "text"),
    ("bad-lone-cont.bin", b"\x80", "invalidUtf8 0"),
    ("bad-c1.bin", b"\xc1\xbf", "invalidUtf8 0"),
]
STDIN_CASE = ("-", b"ab\xe2\x82", "- invalidUtf8 2")


def sha256_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path):
    return sha256_bytes(Path(path).read_bytes())


def source_hashes():
    seen = {}
    for name in sorted(set(CHECK_MODULES + EXTRA_MODULES)):
        candidate = CONTEXT / name
        if candidate.exists():
            seen[f"bend2/src/context/{name}"] = sha256_file(candidate)
    return seen


def run(record, name, argv, cwd, stdin_bytes=None):
    """Execute one command and return its process identity record."""
    entry = {"name": name, "argv": [str(a) for a in argv], "cwd": str(cwd), "spawn": "ok",
             "status": None, "signal": None, "stdout_file": None, "stderr_file": None}
    try:
        proc = subprocess.run([str(a) for a in argv], cwd=str(cwd), input=stdin_bytes,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as error:
        entry["spawn"] = f"failed: {error}"
        record["commands"].append(entry)
        return entry, b"", b""
    entry["status"] = proc.returncode
    if proc.returncode is not None and proc.returncode < 0:
        entry["signal"] = -proc.returncode
    out_path = record["_out"] / f"{name}.stdout"
    err_path = record["_out"] / f"{name}.stderr"
    out_path.write_bytes(proc.stdout)
    err_path.write_bytes(proc.stderr)
    entry["stdout_file"] = str(out_path)
    entry["stderr_file"] = str(err_path)
    record["commands"].append(entry)
    return entry, proc.stdout, proc.stderr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True, help="absolute path to the pinned Bend compiler")
    parser.add_argument("--out", required=True, help="evidence directory; it must not already exist")
    args = parser.parse_args()

    out = Path(args.out)
    if out.exists() and any(out.iterdir()):
        print(f"refusing to reuse a non-empty output directory: {out}", file=sys.stderr)
        return 1
    out.mkdir(parents=True, exist_ok=True)
    (out / "raw").mkdir(exist_ok=True)

    record = {"commands": [], "_out": out, "failures": [], "unqualified": [], "discrepancies": [],
              "platform": {"platform": platform.platform(), "machine": platform.machine(),
                           "python": sys.version.split()[0]},
              "compiler": {"path": str(args.bend)}}
    if not Path(args.bend).exists():
        record["failures"].append("the given compiler path does not exist")
        (out / "evidence.json").write_text(json.dumps(record, indent=1, default=str) + "\n")
        print(json.dumps({"failures": record["failures"]}, indent=1))
        return 1
    record["compiler"]["sha256"] = sha256_file(args.bend)
    record["sources_before"] = source_hashes()

    entry, stdout, _ = run(record, "bend-version", [args.bend, "version"], ROOT)
    version = stdout.decode("utf-8", "replace").strip()
    record["compiler"]["version"] = version
    if entry["status"] != 0 or version != "bend 2.0.25":
        record["failures"].append(f"compiler identity is not bend 2.0.25: {version!r}")

    for module in CHECK_MODULES:
        entry, _, _ = run(record, f"check-{module.replace('.bend','')}", [args.bend, "--check-only", CONTEXT / module], ROOT)
        if entry["status"] != 0:
            record["failures"].append(f"--check-only failed for {module}")

    fixture = out / "raw-fixture"
    env = dict(os.environ)
    env["BEND"] = str(args.bend)
    try:
        built = subprocess.run(["sh", str(ROOT / "bend2" / "scripts" / "build-native.sh"),
                                str(CONTEXT / "raw-fixture.bend"), str(fixture)],
                               cwd=str(ROOT), env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        build_entry = {"name": "build-raw-fixture", "argv": ["sh", "build-native.sh", "raw-fixture.bend", str(fixture)],
                       "cwd": str(ROOT), "spawn": "ok", "status": built.returncode, "signal": None,
                       "env_bend": env["BEND"], "stdout_file": None, "stderr_file": None}
        (out / "build-raw-fixture.stdout").write_bytes(built.stdout)
        (out / "build-raw-fixture.stderr").write_bytes(built.stderr)
        build_entry["stdout_file"] = str(out / "build-raw-fixture.stdout")
        build_entry["stderr_file"] = str(out / "build-raw-fixture.stderr")
    except OSError as error:
        build_entry = {"name": "build-raw-fixture", "spawn": f"failed: {error}", "status": None, "signal": None}
    record["commands"].append(build_entry)
    if build_entry.get("status") != 0:
        record["failures"].append("the raw fixture build did not exit 0")

    if build_entry.get("status") == 0 and fixture.exists():
        record["fixture_artifact_sha256"] = sha256_file(fixture)
        targets = []
        for name, payload, expected in RAW_CASES:
            target = out / "raw" / name
            target.write_bytes(payload)
            targets.append((target, expected))
        argv = [fixture] + [str(t) for t, _ in targets]
        entry, stdout, _ = run(record, "raw-bytes", argv, ROOT)
        lines = stdout.decode("utf-8", "replace").splitlines()
        for index, (target, expected) in enumerate(targets):
            got = lines[index] if index < len(lines) else "<missing>"
            wanted = f"{target} {expected}"
            record["discrepancies"].append({"case": target.name, "expected": wanted, "actual": got, "match": got == wanted})
        name, payload, expected = STDIN_CASE
        entry, stdout, _ = run(record, "raw-stdin", [fixture, name], ROOT, stdin_bytes=payload)
        got = stdout.decode("utf-8", "replace").strip()
        record["discrepancies"].append({"case": "stdin", "expected": expected, "actual": got, "match": got == expected})

    for module in ENTRY_MODULES:
        entry, stdout, _ = run(record, f"interpreted-{module.replace('.bend','')}", [args.bend, CONTEXT / module], ROOT)
        if entry["status"] != 0:
            record["failures"].append(f"the {module} entry did not exit 0")
        oracle = (CONTEXT / module).with_suffix(".expected.txt")
        candidate = out / f"{module}.candidate.txt"
        candidate.write_bytes(stdout)
        if oracle.exists():
            expected = oracle.read_bytes()
            match = stdout == expected
            record["discrepancies"].append({"module": module, "oracle": str(oracle),
                                            "oracle_sha256": sha256_file(oracle),
                                            "actual_file": str(candidate), "match": match})
            if not match:
                record["failures"].append(f"{module} output differs from its proposed oracle")
        else:
            record["unqualified"].append({"module": module, "actual_file": str(candidate),
                                          "reason": "no independently reviewed oracle is checked in"})

    mutations = json.loads((CONTEXT / "codec-mutations.json").read_text())
    record["mutations"] = {"count": len(mutations), "records": []}
    for item in mutations:
        source = (ROOT / item["file"]).read_text()
        record_item = {"name": item["name"], "law": item["law"],
                       "find_occurrences": source.count(item["find"]),
                       "identical": item["find"] == item["replace"]}
        record["mutations"]["records"].append(record_item)
        if record_item["find_occurrences"] != 1 or record_item["identical"]:
            record["failures"].append(f"mutation record is not applicable: {item['name']}")

    record["sources_after"] = source_hashes()
    for path, digest in record["sources_before"].items():
        if record["sources_after"].get(path) != digest:
            record["failures"].append(f"source changed during the run: {path}")

    del record["_out"]
    status = 1 if record["failures"] else (2 if record["unqualified"] else 0)
    record["collection"] = "incomplete" if any(c.get("spawn", "").startswith("failed") for c in record["commands"]) else "complete"
    record["qualification"] = "failed" if record["failures"] else ("unqualified" if record["unqualified"] else "qualified")
    record["exit"] = status
    (out / "evidence.json").write_text(json.dumps(record, indent=1, default=str) + "\n")
    print(json.dumps({"out": str(out), "collection": record["collection"],
                      "qualification": record["qualification"], "exit": status,
                      "failures": record["failures"], "unqualified": [u["module"] for u in record["unqualified"]],
                      "raw_cases": len(RAW_CASES) + 1,
                      "byte_mismatches": [d for d in record["discrepancies"] if d.get("match") is False]}, indent=1))
    return status


if __name__ == "__main__":
    sys.exit(main())
