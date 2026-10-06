#!/usr/bin/env python3
"""Host fixtures for the semantic-context codec lane.

Compilation, build and test execution for this project is remote-only; do not run
this on the orchestrator.

Exit status separates collection from qualification:

  0  collection completed and every required outcome qualified
  1  the collection itself failed, or an executed outcome failed
  2  collection completed, nothing failed, but some result is unqualified
     (a runnable entry whose output has no independently reviewed oracle)

The lane's modules are compiled with `--check-only`. A module that declares
`main` is a runnable entry: this driver runs it and compares its complete output
with the oracle file the repository carries beside it, and it never writes that
oracle. A module without `main` is a library, and the compile is its whole
qualification. The declared module and entry lists are read against the sources
before anything runs, so a composition change that adds or removes an entry fails
the run instead of being missed, and an oracle file beside a module the fixture
does not run is itself a failure.

Every executed command's argv, working directory, stdout, stderr, status and
signal is recorded, and the raw streams are written to files as they run. Source
and toolchain hashes are taken before and after the run over the modules' complete
import closure; a change fails the run. A byte-level discrepancy against a carried
oracle is retained and governs the result.

The mutation records in bend2/src/context/codec-mutations.json name an
implementation change and the law that must refuse it. This driver requires each
record to be applicable in the source it mutates, to name a law the fixture
compiles, and to name a module the mutated module is reached by. It then applies
each record in an isolated copy and requires the law's module to refuse the
compile, retaining every raw diagnostic. A record whose mutated tree still
compiles is reported as a surviving mutation, which is a failure of the fixture.
A record whose law's module does not compile before the mutation stays unapplied
and counts as unqualified. Which law a refusal is the verdict of stays with the
single Controls/CI classifier; this driver retains the raw process outcome for it.
"""

import argparse
import hashlib
import json
import os
import platform
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CONTEXT = ROOT / "bend2" / "src" / "context"
MUTATIONS = CONTEXT / "codec-mutations.json"

# The modules this fixture compiles, in dependency order. A module the codec lane
# composes belongs here whether or not an entry imports it, because the compile is
# what verifies its laws.
LANE_MODULES = [
    "contracts.bend",
    "request.bend",
    "operations.bend",
    "codec.bend",
    "codec-schema.bend",
    "codec-wire.bend",
    "codec-convert.bend",
    "raw.bend",
    "raw-fixture.bend",
]

# The modules a runnable entry reads as its own output oracle. `raw-fixture.bend`
# declares `main` too; its fixture is the byte corpus below, which this driver
# builds and runs natively, so it carries no oracle file.
ENTRY_MODULES = ["contracts.bend", "operations.bend", "codec.bend"]
NATIVE_ENTRY = "raw-fixture.bend"

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

IMPORT_LINE = re.compile(r"^\s*import\s+(\S+)", re.M)
MAIN_DEF = re.compile(r"^def main\s*\(", re.M)
LAW_DECL = re.compile(r"^law\s+([A-Za-z0-9_]+)\s*:", re.M)


def sha256_bytes(payload):
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path):
    return sha256_bytes(Path(path).read_bytes())


def imported_paths(path):
    """The relative module and C paths one source file imports."""
    found = []
    for token in IMPORT_LINE.findall(path.read_text()):
        token = token.strip().strip('"')
        if not token.startswith("."):
            continue
        candidate = (path.parent / token).resolve()
        if candidate.suffix in (".bend", ".c") and candidate.exists():
            found.append(candidate)
    return found


def import_closure(roots):
    """Every source file the given modules reach, transitively."""
    seen, pending = [], [root.resolve() for root in roots]
    while pending:
        path = pending.pop()
        if path in seen:
            continue
        seen.append(path)
        pending.extend(imported_paths(path))
    return sorted(seen)


def lane_paths():
    return [CONTEXT / name for name in LANE_MODULES]


def source_hashes():
    seen = {}
    for path in import_closure(lane_paths()):
        seen[str(path.relative_to(ROOT))] = sha256_file(path)
    return seen


def declared_entries():
    """The lane modules that declare `main`, read from the sources."""
    return sorted(name for name in LANE_MODULES if MAIN_DEF.search((CONTEXT / name).read_text()))


def law_modules():
    """law name -> lane module that declares it."""
    index = {}
    for name in LANE_MODULES:
        for law in LAW_DECL.findall((CONTEXT / name).read_text()):
            index.setdefault(law, name)
    return index


def compile_env():
    env = dict(os.environ)
    env["BEND_NO_TELEMETRY"] = "1"
    return env


def run(record, name, argv, cwd, stdin_bytes=None):
    """Execute one command and return its process identity record."""
    entry = {"name": name, "argv": [str(a) for a in argv], "cwd": str(cwd), "spawn": "ok",
             "status": None, "signal": None, "stdout_file": None, "stderr_file": None}
    try:
        proc = subprocess.run([str(a) for a in argv], cwd=str(cwd), input=stdin_bytes,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=compile_env())
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


def check_module(record, bend, module):
    entry, _, _ = run(record, f"check-{module.replace('.bend', '')}", [bend, "--check-only", CONTEXT / module], ROOT)
    if entry["status"] != 0:
        record["failures"].append(f"--check-only failed for {module}")
    return entry


def check_entries(record, bend, out):
    """Run every declared entry and govern each result by its carried oracle."""
    derived = declared_entries()
    wanted = sorted(ENTRY_MODULES + [NATIVE_ENTRY])
    if derived != wanted:
        record["failures"].append(
            f"the runnable-entry set does not match the lane sources: declared {wanted}, sources declare {derived}")
    for name in LANE_MODULES:
        orphan = (CONTEXT / name).with_suffix(".expected.txt")
        if name not in wanted and orphan.exists():
            record["failures"].append(
                f"an oracle is checked in for a module this fixture does not run: {orphan.name}")
    for module in ENTRY_MODULES:
        entry, stdout, _ = run(record, f"interpreted-{module.replace('.bend', '')}", [bend, CONTEXT / module], ROOT)
        if entry["status"] != 0:
            record["failures"].append(f"the {module} entry did not exit 0")
        oracle = (CONTEXT / module).with_suffix(".expected.txt")
        candidate = out / f"{module}.candidate.txt"
        candidate.write_bytes(stdout)
        if oracle.exists():
            expected = oracle.read_bytes()
            match = stdout == expected
            record["discrepancies"].append({"module": module, "oracle": str(oracle),
                                            "oracle_source": "repository",
                                            "oracle_sha256": sha256_file(oracle),
                                            "candidate_sha256": sha256_bytes(stdout),
                                            "actual_file": str(candidate), "match": match})
            if not match:
                record["failures"].append(f"{module} output differs from its proposed oracle")
        else:
            record["unqualified"].append({"module": module, "actual_file": str(candidate),
                                          "reason": "no independently reviewed oracle is checked in"})


def review_mutations(record, bend, out):
    """Validate the lane's mutation payload and run it as a negative control."""
    records = json.loads(MUTATIONS.read_text())
    laws = law_modules()
    record["mutations"] = {"count": len(records), "records": [], "refused": 0, "survived": 0, "unqualified": 0}
    applicable = []
    for index, item in enumerate(records):
        entry = {"name": item["name"], "law": item["law"], "file": item["file"]}
        source_file = (ROOT / item["file"]).resolve()
        if source_file.parent != CONTEXT.resolve() or not source_file.exists():
            entry["problem"] = "the record does not target a module of this lane"
        else:
            source = source_file.read_text()
            entry["find_occurrences"] = source.count(item["find"])
            entry["identical"] = item["find"] == item["replace"]
            if entry["find_occurrences"] != 1 or entry["identical"]:
                entry["problem"] = "the record is not applicable"
            elif laws.get(item["law"]) is None:
                entry["problem"] = "the named law is not declared in a module this fixture compiles"
            else:
                reached = {str(path.relative_to(ROOT)) for path in import_closure([CONTEXT / laws[item["law"]]])}
                if item["file"] not in reached:
                    entry["problem"] = "the mutated module is not reached by a compile of the named law's module"
        record["mutations"]["records"].append(entry)
        if entry.get("problem"):
            record["failures"].append(f"mutation record is not applicable: {item['name']}: {entry['problem']}")
        else:
            applicable.append((index, item, laws[item["law"]]))

    if not applicable:
        return
    control = out / "mutations"
    control.mkdir(exist_ok=True)
    tree = control / "tree"
    if tree.exists():
        shutil.rmtree(tree)
    tree.mkdir()
    shutil.copytree(ROOT / "bend2", tree / "bend2", symlinks=True)

    # The unmutated modules must compile in the copy; otherwise a refusal says
    # nothing about the mutation applied to it.
    baseline = {}
    for module in sorted({module for _, _, module in applicable}):
        entry, _, _ = run(record, f"mutation-baseline-{module.replace('.bend', '')}",
                          [bend, "--check-only", tree / "bend2" / "src" / "context" / module], tree)
        baseline[module] = entry["status"]
        if entry["status"] != 0:
            record["failures"].append(f"the unmutated {module} does not compile in the mutation copy")

    for index, item, module in applicable:
        if baseline.get(module) != 0:
            # A refusal from a module that does not compile before the mutation
            # says nothing about the mutation, so the record stays unapplied.
            record["mutations"]["unqualified"] += 1
            record["mutations"]["records"][index]["outcome"] = "baseline-unqualified"
            record["mutations"]["records"][index]["baseline_status"] = baseline.get(module)
            continue
        source_file = tree / "bend2" / "src" / "context" / Path(item["file"]).name
        pristine = source_file.read_bytes()
        source_file.write_bytes(pristine.replace(item["find"].encode(), item["replace"].encode(), 1))
        stem = f"{index:03d}-{item['name']}"
        entry, stdout, stderr = run(record, f"mutation-{stem}",
                                    [bend, "--check-only", tree / "bend2" / "src" / "context" / module], tree)
        source_file.write_bytes(pristine)
        outcome = "refused" if entry["status"] != 0 else "survived"
        named = item["law"] in (stdout + stderr).decode("utf-8", "replace")
        if outcome == "refused":
            record["mutations"]["refused"] += 1
        else:
            record["mutations"]["survived"] += 1
            record["failures"].append(f"mutation survived the fixture: {item['name']} ({item['law']})")
        record["mutations"]["records"][index]["outcome"] = outcome
        record["mutations"]["records"][index]["baseline_status"] = baseline.get(module)
        record["mutations"]["records"][index]["diagnostic_names_the_law"] = named


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
              "compiler": {"path": str(args.bend)},
              "lane": {"modules": LANE_MODULES, "entries": ENTRY_MODULES, "native_entry": NATIVE_ENTRY}}
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

    for module in LANE_MODULES:
        check_module(record, args.bend, module)

    fixture = out / "raw-fixture"
    env = compile_env()
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

    check_entries(record, args.bend, out)

    try:
        review_mutations(record, args.bend, out)
    except (OSError, ValueError, KeyError) as error:
        record["failures"].append(f"the mutation payload could not be reviewed: {error}")

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
                      "mutations": {k: record["mutations"][k] for k in ("count", "refused", "survived", "unqualified")},
                      "byte_mismatches": [d for d in record["discrepancies"] if d.get("match") is False]}, indent=1))
    return status


if __name__ == "__main__":
    sys.exit(main())
