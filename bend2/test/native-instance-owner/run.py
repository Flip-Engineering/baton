#!/usr/bin/env python3
"""Build and run the custody-task fixture on an admitted remote runner.

Evidence contract: a fresh output directory is required. The runner records
the exact source state (commit, tree, component hashes, clean status for the
owned files, tree recheck after the run), the supplied tool identities (bend
executable hash and version, compiler archive hash, library-root listing
hash, host compiler, platform), and one launch record plus one completion
record per child, with stdout/stderr streamed to their own files from launch
so an interrupted runner keeps partial output. The unmutated fixture must
build and run; structural failure is retained and fails the runner.

Each mutation replaces one operative decision site in the module on a fresh
persistent scratch copy and is observed twice. First the module law gate: the
mutated module checked alone must fail with a diagnostic that names the law
stating the mutated decision and prints its expected and observed values; the
fixture check gate on the same mutated copy is recorded beside it. Second the
runtime isolation: the same mutation with the module's law blocks removed
must still build, and the fixture's own checks must then fail on the named
check, so the mutation is attributed to a fixture check as well as to a law.
A law-stripped unmutated control build fixes the isolation technique itself as
the cause of no failure. Verdicts record expected and observed values and the
raw stream paths, never a bare nonzero exit. After the mutations the runner
re-verifies every owned file hash and rebuilds and re-runs the unmutated
fixture from the restored worktree.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import time

# Each mutation: (name, unique source fragment, replacement, law proof name
# whose compile refusal must appear, the semantic value the actual law
# requires, stated from the law itself, and the fixture check that must
# observe the mutated decision at run time).
MUTATIONS = [
    ("fail-delivery-fulfills-wake",
     "Bool.pick(Duty,fulfilled(ref),Duty{owner,attempt,put_delivery(results,ref),False{}",
     "Bool.pick(Duty,Bool.not(ref_open(ref)),Duty{owner,attempt,put_delivery(results,ref),False{}",
     "a_failed_delivery_settles_and_leaves_the_wake_owed",
     "a settled Fail delivery keeps wake_owed true",
     "failed-delivery-settles-and-leaves-wake-owed"),
    ("ack-cleared-without-marker",
     "Bool.and(ack_owed,Bool.not(marker))",
     "Bool.and(ack_owed,Bool.not(fulfilled(ref)))",
     "an_ack_without_marker_evidence_keeps_the_responsibility",
     "an acknowledged result reference without the marker keeps ack_owed true",
     "ack-without-marker-keeps-duty-open"),
    ("historical-validation-reads-the-slot-generation",
     "attempt_eq(attempt_of(duty),attempt)",
     "Bool.and(attempt_eq(attempt_of(duty),attempt),"
     "U32.is_eq(generation_of(attempt_of(duty)),"
     "generation_of_slot(advance_slot(Slot{session_of(attempt),generation_of(attempt)},"
     "session_of(attempt),U32.add(generation_of(attempt),1)))))",
     "attempt_validation_reads_the_attempt_record_not_the_slot",
     "historical validation of the duty's own attempt resolves to Done{duty}",
     "attempt-check-after-advance-slot"),
]

OWNED = ["bend2/src/context/custody-tasks.bend",
         "bend2/test/native-instance-owner/custody-tasks.bend",
         "bend2/test/native-instance-owner/run.py"]

LAW_BLOCK = re.compile(
    r"^law (\w+):\n(?:^  .*\n)*\n*^def \1\([^\n]*\):\n(?:^  .*\n)+", re.MULTILINE)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def strip_law_blocks(source):
    """Remove every law statement and its companion proof definition.

    The runtime isolation observation needs the mutated decision to compile so
    the fixture's own checks can observe it, while the law gate is observed
    separately on the same mutated module. Each proof definition carries the
    law's own name and an indented body, so a law statement and its proof are
    removed as one span.
    """
    names = LAW_BLOCK.findall(source)
    stripped = re.sub(r"\n{3,}", "\n\n", LAW_BLOCK.sub("", source))
    return names, stripped


def law_diagnostics(text):
    """Split compiler output into one row per diagnostic block."""
    rows = []
    for block in text.split("Error:")[1:]:
        location = re.search(r"^Location:\s*(\S+)", block, re.MULTILINE)
        rows.append({"location": location.group(1) if location else None,
                     "expected_observed": "- expected :" in block and "- observed :" in block})
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--compiler-archive")
    parser.add_argument("--library-root")
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
        "owned_status": git("status", "--porcelain", "--", *OWNED),
        "owned_sha256_before": {path: sha256(root / path) for path in OWNED},
        "bend_version": None,
        "bend_sha256": sha256(args.bend),
        "compiler_archive_sha256": sha256(args.compiler_archive) if args.compiler_archive else None,
        "library_root": None,
        "host_compiler": None,
        "platform": platform.platform(),
        "custody_limits": ("OWNED files cover the author's source only; "
                           "build-native.sh, the stop.bend import closure and any "
                           "executor-side children are bound by the admitted remote "
                           "executor, not by this runner."),
        "module_sha256": sha256(root / OWNED[0]),
        "fixture_sha256": sha256(root / OWNED[1]),
        "runner_sha256": sha256(Path(__file__).resolve()),
    }
    assert identity["owned_clean"], f"owned files must be committed and clean: {identity['owned_status']}"
    child, streams, started = launch("compiler", [args.bend, "version"], root)
    code = complete("compiler", child, streams, started)
    assert code == 0 and (output / "compiler.stdout").read_bytes().strip() == b"bend 2.0.25", \
        "compiler must be Bend 2.0.25"
    identity["bend_version"] = (output / "compiler.stdout").read_text().strip()
    child, streams, started = launch("host-compiler", [os.environ.get("CC", "clang"), "--version"], root)
    assert complete("host-compiler", child, streams, started) == 0, "host compiler probe failed"
    identity["host_compiler"] = (output / "host-compiler.stdout").read_text(errors="replace")
    if args.library_root:
        listing = sorted((p.relative_to(args.library_root).as_posix(), sha256(p))
                         for p in Path(args.library_root).rglob("*") if p.is_file())
        identity["library_root"] = {"path": str(Path(args.library_root).resolve()),
                                    "files": len(listing),
                                    "listing_sha256": hashlib.sha256(
                                        json.dumps(listing, sort_keys=True).encode()).hexdigest()}
    (output / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")

    child, streams, started = launch("build", ["sh", "bend2/scripts/build-native.sh",
                                               "bend2/test/native-instance-owner/custody-tasks.bend",
                                               str(output / "custody-fixture")], root)
    assert complete("build", child, streams, started) == 0, "unmutated fixture build failed"

    expected = {
        "laws": ("0", ["owner-ready", "owner-survived",
                       "failed-settlement-survives-ack-ok",
                       "notice-retry-clears-wake-ok",
                       "released-not-acknowledged-rebuilds-open-ok",
                       "acknowledged-owed-notice-stays-open-ok"]),
        "die": ("23", ["owner-ready"]),
        "try": ("24", ["owner-ready"]),
        "stopped": ("2", ["owner-ready"]),
        "result": ("0", ["owner-ready", "25:task-result", "owner-survived"]),
    }
    for mode, (code, needs) in expected.items():
        name = "laws" if mode == "laws" else mode
        child, streams, started = launch(name, [str(output / "custody-fixture"), mode], root)
        code_actual = complete(name, child, streams, started)
        assert code_actual == int(code), f"{mode}: exit {code_actual}, expected {code}"
        text = (output / (name + ".stdout")).read_bytes()
        for need in needs:
            assert need.encode() in text, f"{mode}: missing {need!r}"

    def copy_corpus(destination):
        for part in ("bend2/src", "bend2/scripts", "bend2/test/native-instance-owner"):
            shutil.copytree(root / part, destination / part)

    def build_fixture(name, case):
        binary = case / (name + "-fixture")
        child, streams, started = launch(name + ".build",
                                         ["sh", "bend2/scripts/build-native.sh",
                                          "bend2/test/native-instance-owner/custody-tasks.bend",
                                          str(binary)], case)
        return binary, complete(name + ".build", child, streams, started)

    def run_laws(name, binary, case):
        child, streams, started = launch(name + ".run", [str(binary), "laws"], case)
        code = complete(name + ".run", child, streams, started)
        text = (output / (name + ".run.stdout")).read_text(errors="replace")
        failed = [line[:-len("-failed")] for line in text.splitlines()
                  if line.endswith("-failed")]
        return code, (failed[0] if failed else None), text

    def check_only(name, case, entry):
        child, streams, started = launch(name, [args.bend, entry, "--check-only"], case)
        code = complete(name, child, streams, started)
        text = ((output / (name + ".stdout")).read_text(errors="replace") +
                (output / (name + ".stderr")).read_text(errors="replace"))
        return code, text

    def records_for(*names):
        return [str(output / (name + suffix))
                for name in names
                for suffix in (".launch.json", ".completion.json", ".stdout", ".stderr")]

    original = (root / OWNED[0]).read_text()

    # Isolation control: the law-stripped unmutated module must build and run
    # clean, so a failing isolation run is attributable to its mutation and not
    # to the removal of the law blocks.
    control = output / "isolation-control"
    control.mkdir()
    copy_corpus(control)
    law_names, stripped = strip_law_blocks(original)
    assert law_names and "law " not in stripped and "{==}" not in stripped, \
        "law stripping left law statements or proof bodies"
    (control / "law-stripped-source.bend").write_text(stripped)
    (control / OWNED[0]).write_text(stripped)
    binary, code = build_fixture("isolation-control", control)
    assert code == 0, "law-stripped control build failed"
    run_code, failing, _ = run_laws("isolation-control", binary, control)
    assert run_code == 0 and failing is None, \
        f"law-stripped control run exit {run_code}, first failing check {failing}"
    record("isolation-control.verdict",
           {"law_blocks_removed": len(law_names), "build_exit": code, "run_exit": run_code,
            "first_failing_check": failing,
            "law_stripped_source": str(control / "law-stripped-source.bend"),
            "law_stripped_sha256": sha256(control / "law-stripped-source.bend"),
            "claim": ("the law-stripped unmutated module builds and every fixture check "
                      "passes, so a failing isolation run below is caused by its mutation"),
            "records": records_for("isolation-control")})

    for name, old, new, law, expected_semantics, expected_check in MUTATIONS:
        assert original.count(old) == 1, f"{name}: source fragment is not unique"
        mutated_source = original.replace(old, new)
        case = output / ("mutation-" + name)
        case.mkdir()
        copy_corpus(case)
        module = case / OWNED[0]
        module.write_text(mutated_source)
        (case / "mutated-source.bend").write_text(mutated_source)
        prefixes = ["mutation-" + name + ".module-law-gate",
                    "mutation-" + name + ".fixture-law-gate",
                    "mutation-" + name + ".isolation"]

        module_exit, module_text = check_only(prefixes[0], case, OWNED[0])
        rows = law_diagnostics(module_text)
        target = [row for row in rows if row["location"] == law]
        assert module_exit == 1, \
            f"{name}: mutated module check-only exit {module_exit}, expected 1"
        assert any(row["expected_observed"] for row in target), \
            f"{name}: no diagnostic names {law} with expected and observed values: {rows[:8]}"

        fixture_exit, fixture_text = check_only(
            prefixes[1], case, "bend2/test/native-instance-owner/custody-tasks.bend")
        fixture_rows = law_diagnostics(fixture_text)

        mutation_names, mutated_stripped = strip_law_blocks(mutated_source)
        assert len(mutation_names) == len(law_names), f"{name}: law block count changed"
        assert "law " not in mutated_stripped and "{==}" not in mutated_stripped, \
            f"{name}: law stripping left law statements or proof bodies"
        (case / "law-stripped-source.bend").write_text(mutated_stripped)
        module.write_text(mutated_stripped)
        binary, build_exit = build_fixture(prefixes[2], case)
        assert build_exit == 0, f"{name}: isolation build failed"
        run_exit, failing, _ = run_laws(prefixes[2], binary, case)
        assert run_exit != 0 and failing == expected_check, \
            (f"{name}: isolation run exit {run_exit}, first failing check {failing!r}, "
             f"expected {expected_check!r}")

        record("mutation-" + name + ".verdict",
               {"name": name, "mutated_site": old, "replacement": new,
                "target_law": law, "expected_semantics": expected_semantics,
                "expected_fixture_check": expected_check,
                "module_law_gate": {
                    "exit": module_exit,
                    "target_law_named_with_values": any(
                        row["expected_observed"] for row in target),
                    "target_law_diagnostics": target,
                    "diagnostics": rows[:8]},
                "fixture_law_gate": {
                    "exit": fixture_exit,
                    "target_law_named": any(row["location"] == law for row in fixture_rows),
                    "diagnostics": fixture_rows[:8]},
                "runtime_isolation": {"build_exit": build_exit, "run_exit": run_exit,
                                      "first_failing_check": failing,
                                      "expected_check": expected_check},
                "claim": ("the mutation is refused by the law stating the mutated "
                          "decision with its expected and observed values, and the "
                          "fixture's own check named above fails at run time on the "
                          "same mutation with the law blocks removed"),
                "records": records_for(*prefixes) +
                           [str(case / "mutated-source.bend"),
                            str(case / "law-stripped-source.bend")]})

    for path in OWNED:
        assert sha256(root / path) == identity["owned_sha256_before"][path], \
            f"owned file changed during run: {path}"
    restored = output / "restored"
    restored.mkdir()
    copy_corpus(restored)
    binary, code = build_fixture("restored", restored)
    assert code == 0, "restored-source fixture build failed"
    run_code, failing, text = run_laws("restored", binary, restored)
    assert run_code == 0 and failing is None and "owner-survived" in text, \
        f"restored-source fixture run exit {run_code}, first failing check {failing}"
    record("restored.verdict",
           {"run_exit": run_code, "first_failing_check": failing,
            "owned_sha256": {path: sha256(root / path) for path in OWNED},
            "claim": ("every owned file hash is unchanged after the mutations and the "
                      "fixture rebuilt from the restored worktree passes"),
            "records": records_for("restored")})
    assert sha256(args.bend) == identity["bend_sha256"], "compiler changed during run"
    if args.compiler_archive:
        assert sha256(args.compiler_archive) == identity["compiler_archive_sha256"], \
            "compiler archive changed during run"
    assert git("rev-parse", "HEAD^{tree}") == identity["tree_before"], "tree changed during run"
    print("custody-fixture: baseline modes, the law-stripped isolation control, "
          f"{len(MUTATIONS)} mutation controls and the restored-source rebuild "
          "completed", flush=True)


if __name__ == "__main__":
    sys.exit(main())
