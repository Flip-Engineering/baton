#!/usr/bin/env python3
"""Host fixtures for the semantic-context codec lane.

This driver runs the raw reader over real byte files and runs the three pure
context entries. It records, for every command, the exact argv, stdout, stderr and
child status, plus the compiler, platform and source identities.

Execution is remote-only for this project; do not run this on the orchestrator.

A checked-in expected file is a proposed oracle pending independent review. When
actual output differs, this driver records the discrepancy and fails. It never
rewrites an expected file.

The mutation records in bend2/src/context/codec-mutations.json are handed to the
single Controls/CI classifier; this driver only checks their shape and that each
`find` string occurs exactly once. It draws no verdict about whether a mutation is
refused by its law.
"""

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTEXT = ROOT / "bend2" / "src" / "context"

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


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def record(name, argv, status, stdout, stderr, note=None):
    entry = {
        "name": name,
        "argv": [str(a) for a in argv],
        "status": status,
        "stdout": stdout,
        "stderr": stderr,
    }
    if note:
        entry["note"] = note
    return entry


def run(argv, stdin_bytes=None):
    proc = subprocess.run(
        [str(a) for a in argv],
        input=stdin_bytes,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return proc.returncode, proc.stdout.decode("utf-8", "replace"), proc.stderr.decode("utf-8", "replace")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True, help="absolute path to the pinned Bend compiler")
    parser.add_argument("--out", default=None, help="evidence directory; a unique one is created when absent")
    args = parser.parse_args()

    out = Path(args.out) if args.out else Path(tempfile.mkdtemp(prefix="context-codec-", dir=os.environ.get("TMPDIR", "/tmp")))
    out.mkdir(parents=True, exist_ok=True)
    (out / "raw").mkdir(exist_ok=True)

    evidence = {
        "platform": {
            "platform": platform.platform(),
            "machine": platform.machine(),
            "python": sys.version,
            "node": None,
        },
        "compiler": {"path": str(args.bend), "sha256": sha256_file(args.bend)},
        "sources": {},
        "commands": [],
        "raw_cases": [],
        "failures": [],
        "discrepancies": [],
    }
    for name in sorted(p.name for p in CONTEXT.iterdir() if p.is_file()):
        evidence["sources"][f"bend2/src/context/{name}"] = sha256_file(CONTEXT / name)

    status, stdout, stderr = run([args.bend, "version"])
    evidence["compiler"]["version"] = stdout.strip()
    evidence["commands"].append(record("bend-version", [args.bend, "version"], status, stdout, stderr))
    if stdout.strip() != "bend 2.0.25":
        evidence["failures"].append("compiler version is not bend 2.0.25")
        (out / "evidence.json").write_text(json.dumps(evidence, indent=1) + "\n")
        print(json.dumps(evidence, indent=1))
        return 1

    for module in ["contracts.bend", "request.bend", "operations.bend", "codec.bend", "raw-fixture.bend"]:
        path = CONTEXT / module
        status, stdout, stderr = run([args.bend, "--check-only", path])
        evidence["commands"].append(record(f"check-{module}", [args.bend, "--check-only", path], status, stdout, stderr))
        if status != 0:
            evidence["failures"].append(f"--check-only failed for {module}")

    fixture = out / "raw-fixture"
    status, stdout, stderr = run(["sh", ROOT / "bend2" / "scripts" / "build-native.sh", CONTEXT / "raw-fixture.bend", fixture])
    evidence["commands"].append(record("build-raw-fixture",
                                      ["sh", ROOT / "bend2" / "scripts" / "build-native.sh",
                                       CONTEXT / "raw-fixture.bend", fixture], status, stdout, stderr))
    if status != 0:
        evidence["failures"].append("raw fixture build failed")
    else:
        evidence["fixture_artifact_sha256"] = sha256_file(fixture)
        written = []
        for name, payload, expected in RAW_CASES:
            target = out / "raw" / name
            target.write_bytes(payload)
            written.append((target, f"{target} {expected}"))
        status, stdout, stderr = run([fixture] + [t for t, _ in written])
        evidence["commands"].append(record("raw-bytes", [fixture] + [str(t) for t, _ in written], status, stdout, stderr))
        lines = stdout.splitlines()
        for index, (_, want) in enumerate(written):
            got = lines[index] if index < len(lines) else "<missing>"
            evidence["raw_cases"].append({"case": want.split("/")[-1], "expected": want, "actual": got, "match": got == want})
            if got != want:
                evidence["discrepancies"].append({"case": want, "expected": want, "actual": got})
        stdin_name, payload, expected = STDIN_CASE
        status, stdout, stderr = run([fixture, stdin_name], stdin_bytes=payload)
        evidence["commands"].append(record("raw-stdin", [fixture, stdin_name], status, stdout, stderr))
        got = stdout.strip()
        evidence["raw_cases"].append({"case": "stdin", "expected": expected, "actual": got, "match": got == expected})
        if got != expected:
            evidence["discrepancies"].append({"case": "stdin", "expected": expected, "actual": got})

    for module in ["contracts.bend", "operations.bend", "codec.bend"]:
        path = CONTEXT / module
        status, stdout, stderr = run([args.bend, path])
        evidence["commands"].append(record(f"interpreted-{module}", [args.bend, path], status, stdout, stderr))
        expected_path = path.with_suffix(".expected.txt")
        if expected_path.exists():
            expected = expected_path.read_text()
            evidence["discrepancies"].append({
                "module": module,
                "oracle": str(expected_path),
                "oracle_sha256": sha256_file(expected_path),
                "status": "match" if stdout == expected else "mismatch",
            })
            if stdout != expected:
                evidence["failures"].append(f"{module} interpreted output differs from its proposed oracle")
                (out / f"{module}.actual.txt").write_text(stdout)
        else:
            evidence["discrepancies"].append({
                "module": module,
                "status": "no-checked-in-oracle",
                "note": "actual output retained for independent review; this driver does not adopt it as an oracle",
            })
            (out / f"{module}.candidate.txt").write_text(stdout)

    mutations_path = CONTEXT / "codec-mutations.json"
    mutations = json.loads(mutations_path.read_text())
    evidence["mutations"] = {"count": len(mutations), "records": []}
    for entry in mutations:
        source = (ROOT / entry["file"]).read_text()
        record_entry = {
            "name": entry["name"],
            "law": entry["law"],
            "find_occurrences": source.count(entry["find"]),
            "identical": entry["find"] == entry["replace"],
        }
        evidence["mutations"]["records"].append(record_entry)
        if record_entry["find_occurrences"] != 1 or record_entry["identical"]:
            evidence["failures"].append(f"mutation record is not applicable: {entry['name']}")

    (out / "evidence.json").write_text(json.dumps(evidence, indent=1) + "\n")
    print(json.dumps({"out": str(out), "failures": evidence["failures"],
                      "raw_cases": len(evidence["raw_cases"]), "discrepancies": len(evidence["discrepancies"])}, indent=1))
    return 1 if evidence["failures"] else 0


if __name__ == "__main__":
    sys.exit(main())
