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
persistent scratch copy and is observed twice. First the law gate: the gate
refuses the unmutated module on the laws it cannot discharge, so the runner
records the module gate and the fixture gate for the mutation and, when the
mutation also breaks a law the gate can discharge, requires the gate to refuse
that law. Second the runtime isolation: the mutation with exactly the laws the
unmutated gate refused removed must still build, and the fixture's own checks
must then fail on the named check, so every mutation is attributed to a fixture
check. The law gate on the unmutated source fixes which laws the removal takes
and the baseline build of that source fixes the isolation technique itself as
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
     "def fulfilled(ref: Ref) -> Bool:\n  match ref:\n"
     "    case RefDone{note}: True{}\n    case other: False{}",
     "def fulfilled(ref: Ref) -> Bool:\n  match ref:\n"
     "    case RefDone{note}: True{}\n    case RefFail{error}: True{}\n    case other: False{}",
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

FIXTURE_ENTRY = "bend2/test/native-instance-owner/custody-tasks.bend"

LAW_STATEMENT = re.compile(r"^law \w+:$", re.MULTILINE)


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def strip_law(name, source):
    """Remove one law statement together with its companion proof definition."""
    block = re.compile(r"^law " + re.escape(name) + r":\n(?:^  .*\n)*\n*^def "
                       + re.escape(name) + r"\([^\n]*\):\n(?:^  .*\n)+", re.MULTILINE)
    stripped, count = block.subn("", source)
    assert count == 1, f"{name}: law statement or companion proof is not unique"
    return stripped


def law_diagnostics(text):
    """Split compiler output into one row per diagnostic block."""
    rows = []
    for block in text.split("Error:")[1:]:
        location = re.search(r"^Location:\s*(\S+)", block, re.MULTILINE)
        rows.append({"location": location.group(1) if location else None,
                     "expected_observed": "- expected :" in block and "- observed :" in block,
                     "head": block.strip().splitlines()[:4]})
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

    def copy_corpus(destination):
        for part in ("bend2/src", "bend2/scripts", "bend2/test/native-instance-owner"):
            shutil.copytree(root / part, destination / part)

    def build_fixture(name, case):
        binary = case / (name + "-fixture")
        child, streams, started = launch(name + ".build",
                                         ["sh", "bend2/scripts/build-native.sh",
                                          FIXTURE_ENTRY, str(binary)], case)
        return binary, complete(name + ".build", child, streams, started)

    def run_laws(name, binary, case):
        child, streams, started = launch(name + ".run", [str(binary), "laws"], case)
        code = complete(name + ".run", child, streams, started)
        # A passing check prints "-ok" on stdout; the failing check reports its own
        # name on stderr through IO.die, so both streams carry the evidence.
        text = ((output / (name + ".run.stdout")).read_text(errors="replace") + "\n" +
                (output / (name + ".run.stderr")).read_text(errors="replace"))
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

    def strip_refused_laws(case, prefix, module_path, source):
        """Remove exactly the law statements the fixture gate refuses.

        The module's inline law suite is not wholly machine-checkable: for a law
        stated over symbolic strings or numbers the gate cannot discharge the
        comparison, so it refuses that law rather than the fixture. Every
        refusal is read from the compiler's own diagnostic and that law with its
        companion proof is removed, so the buildable source is derived from the
        observed gate and this runner pins no law list of its own. The loop is
        bounded by the number of law statements in the source it was given and
        returns each refusal with its diagnostic; a refusal that names no law
        statement is returned as the failure.
        """
        stripped = []
        for index in range(len(LAW_STATEMENT.findall(source)) + 1):
            exit_code, text = check_only(f"{prefix}.{index}", case, FIXTURE_ENTRY)
            if exit_code == 0:
                return source, stripped, None
            rows = law_diagnostics(text)
            location = rows[0]["location"] if rows else None
            law = location.rsplit(".", 1)[-1] if location else None
            if not law or not re.search(r"^law " + re.escape(law) + r":$", source, re.MULTILINE):
                return source, stripped, {"item": law, "diagnostic": text.strip().splitlines()[:8]}
            source = strip_law(law, source)
            stripped.append({"law": law, "gate_exit": exit_code,
                             "expected_observed": rows[0]["expected_observed"],
                             "diagnostic": rows[0]["head"]})
            module_path.write_text(source)
        raise AssertionError(f"{prefix}: the gate never passed after stripping every law")

    original = (root / OWNED[0]).read_text()

    # The shipped module's inline laws gate the fixture build. A refusal is a
    # property of the stated law, so the buildable baseline removes the refused
    # laws, each with its own recorded diagnostic, and every fixture check runs
    # against that baseline. When the gate accepts every law, the shipped build
    # is the baseline.
    baseline = output / "baseline"
    baseline.mkdir()
    copy_corpus(baseline)
    baseline_module = baseline / OWNED[0]
    binary, law_bearing_exit = build_fixture("baseline.law-bearing", baseline)
    record("baseline.law-bearing.verdict",
           {"build_exit": law_bearing_exit,
            "diagnostics": law_diagnostics(
                (output / "baseline.law-bearing.build.stderr").read_text(errors="replace"))[:8],
            "claim": ("the fixture built against the shipped module: a nonzero exit is the "
                      "law gate refusing a stated law, recorded with the compiler's own "
                      "expected and observed values"),
            "records": records_for("baseline.law-bearing")})

    if law_bearing_exit == 0:
        baseline_source, refused, baseline_binary = original, [], binary
    else:
        baseline_source, refused, refuse_failure = strip_refused_laws(
            baseline, "baseline.gate", baseline_module, original)
        assert refuse_failure is None, \
            f"the fixture gate refuses a non-law item: {refuse_failure}"
        assert (len(LAW_STATEMENT.findall(original))
                - len(LAW_STATEMENT.findall(baseline_source))) == len(refused), \
            "law removal does not match the recorded refusals"
        (baseline / "law-stripped-source.bend").write_text(baseline_source)
        baseline_binary, build_exit = build_fixture("baseline.law-stripped", baseline)
        assert build_exit == 0, "law-stripped baseline fixture build failed"
    (baseline / "buildable-source.bend").write_text(baseline_source)
    record("baseline.verdict",
           {"law_bearing_build_exit": law_bearing_exit,
            "refused_laws": refused,
            "buildable_source_sha256": sha256(baseline / "buildable-source.bend"),
            "claim": ("every fixture check runs against the buildable baseline; each law the "
                      "gate refused is recorded with its own diagnostic and is a property of "
                      "the unmutated source, so no mutation is attributed to it"),
            "records": records_for("baseline.law-stripped")})

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
        name = "baseline." + mode
        child, streams, started = launch(name, [str(baseline_binary), mode], baseline)
        code_actual = complete(name, child, streams, started)
        assert code_actual == int(code), f"{mode}: exit {code_actual}, expected {code}"
        text = (output / (name + ".stdout")).read_bytes()
        for need in needs:
            assert need.encode() in text, f"{mode}: missing {need!r}"

    baseline_refused = [row["law"] for row in refused]
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
        module_rows = law_diagnostics(module_text)
        fixture_exit, fixture_text = check_only(prefixes[1], case, FIXTURE_ENTRY)
        fixture_rows = law_diagnostics(fixture_text)

        # The isolation source removes exactly the laws the unmutated gate
        # refused, so a law this mutation breaks and the gate can discharge is
        # refused here, which is a second and independent control on the
        # mutation. Every further refusal is removed only to reach a buildable
        # source, and the first one is required to be the mutated law's own.
        isolated = mutated_source
        for refused_law in baseline_refused:
            isolated = strip_law(refused_law, isolated)
        module.write_text(isolated)
        isolated, extra_refusals, refuse_failure = strip_refused_laws(
            case, prefixes[2] + ".gate", module, isolated)
        assert refuse_failure is None, \
            f"{name}: the fixture gate refuses a non-law item: {refuse_failure}"
        gate_law = extra_refusals[0]["law"] if extra_refusals else None
        if law not in baseline_refused:
            assert gate_law is not None, \
                (f"{name}: the gate discharged {law} before the mutation and refuses no "
                 f"law after it")
        (case / "law-stripped-source.bend").write_text(isolated)
        module.write_text(isolated)
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
                "module_law_gate": {"exit": module_exit, "diagnostics": module_rows[:8]},
                "fixture_law_gate": {"exit": fixture_exit, "diagnostics": fixture_rows[:8]},
                "law_gate_over_the_baseline_law_set": {
                    "first_refused_law": gate_law, "refusals": extra_refusals},
                "runtime_isolation": {
                    "build_exit": build_exit, "run_exit": run_exit,
                    "first_failing_check": failing, "expected_check": expected_check,
                    "laws_removed": baseline_refused + [row["law"] for row in extra_refusals],
                    "source_sha256": sha256(case / "law-stripped-source.bend")},
                "claim": ("the fixture's own check named above fails at run time on this "
                          "mutation; where the mutation also breaks a law the gate can "
                          "discharge, the gate refuses that law before any stripping"),
                "records": records_for(*prefixes) +
                           [str(case / "mutated-source.bend"),
                            str(case / "law-stripped-source.bend")]})

    for path in OWNED:
        assert sha256(root / path) == identity["owned_sha256_before"][path], \
            f"owned file changed during run: {path}"
    restored = output / "restored"
    restored.mkdir()
    copy_corpus(restored)
    restored_module = restored / OWNED[0]
    binary, restored_law_bearing_exit = build_fixture("restored.law-bearing", restored)
    assert restored_law_bearing_exit == law_bearing_exit, \
        (f"restored law-bearing build exit {restored_law_bearing_exit}, "
         f"baseline {law_bearing_exit}")
    restored_source, restored_refused, restored_failure = strip_refused_laws(
        restored, "restored.gate", restored_module, (root / OWNED[0]).read_text())
    assert restored_failure is None, \
        f"restored fixture gate refuses a non-law item: {restored_failure}"
    assert restored_source == baseline_source, \
        "the restored worktree yields a different buildable source than the baseline"
    binary, build_exit = build_fixture("restored.law-stripped", restored)
    assert build_exit == 0, "restored-source fixture build failed"
    run_code, failing, text = run_laws("restored.law-stripped", binary, restored)
    assert run_code == 0 and failing is None and "owner-survived" in text, \
        f"restored-source fixture run exit {run_code}, first failing check {failing}"
    record("restored.verdict",
           {"law_bearing_build_exit": restored_law_bearing_exit,
            "refused_laws": restored_refused,
            "buildable_source_sha256": sha256(baseline / "buildable-source.bend"),
            "run_exit": run_code, "first_failing_check": failing,
            "owned_sha256": {path: sha256(root / path) for path in OWNED},
            "claim": ("every owned file hash is unchanged after the mutations, the "
                      "restored worktree rebuilds the same buildable source as the "
                      "baseline and every fixture check passes again"),
            "records": records_for("restored.law-stripped")})
    assert sha256(args.bend) == identity["bend_sha256"], "compiler changed during run"
    if args.compiler_archive:
        assert sha256(args.compiler_archive) == identity["compiler_archive_sha256"], \
            "compiler archive changed during run"
    assert git("rev-parse", "HEAD^{tree}") == identity["tree_before"], "tree changed during run"
    print("custody-fixture: baseline modes, "
          f"{len(MUTATIONS)} mutation controls and the restored-source rebuild "
          "completed", flush=True)


if __name__ == "__main__":
    sys.exit(main())
