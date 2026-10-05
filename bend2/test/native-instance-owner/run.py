#!/usr/bin/env python3
"""Build and run the custody-task fixture on an admitted remote runner.

Evidence contract: a fresh output directory is required. The runner records
the exact source state (commit, tree, component hashes, clean status for the
owned files, tree recheck after the run), the supplied tool identities (bend
executable hash and version, compiler archive hash, library-root listing
hash, host compiler, platform), and one launch record plus one completion
record per child, with stdout/stderr streamed to their own files from launch
so an interrupted runner keeps partial output. The unmutated fixture must
build and run; structural failure is retained and fails the runner. Each
intended implementation mutation is applied to a fresh persistent scratch
copy, and its verdict records the targeted law, the expected rejection kind
and the observed diagnostic, never a bare nonzero exit.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import time

# Each mutation: (name, unique source fragment, replacement, law proof name
# whose compile refusal must appear, and the semantic value the actual law
# requires, stated from the law itself).
MUTATIONS = [
    ("acknowledged-drops-duties",
     "  match clear:\n    case True{}: None{}",
     "  match acknowledged:\n    case True{}: None{}",
     "acknowledged_attempt_with_owed_notice_stays_a_duty",
     "acknowledged rebuild with failed delivery stays Some{Duty} with wake_owed true"),
    ("ref-open-wake",
     "Bool.not(fulfilled(delivery)),Bool.not(acknowledged),Bool.not(fulfilled(settle))",
     "ref_open(delivery),Bool.not(acknowledged),Bool.not(fulfilled(settle))",
     "unacknowledged_failed_delivery_keeps_the_wake_owed",
     "unacknowledged failed-delivery rebuild keeps wake_owed true"),
    ("wrong-attempt-accepted",
     "attempt_eq(attempt_of(duty),attempt)",
     "True{}",
     "a_differing_attempt_is_refused_as_unknown",
     "differing attempt resolves to Fail{UnknownAttempt{}}"),
    ("settlement-fail-clears",
     "Bool.and(settle_owed,Bool.not(fulfilled(ref)))",
     "Bool.and(settle_owed,fulfilled(ref))",
     "a_failed_settlement_survives_host_acknowledgment",
     "failed settlement keeps settle_owed true after host acknowledgment"),
]

OWNED = ["bend2/src/context/custody-tasks.bend",
         "bend2/test/native-instance-owner/custody-tasks.bend",
         "bend2/test/native-instance-owner/run.py"]


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


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

    module = root / OWNED[0]
    original = module.read_text()
    for name, old, new, law, expected_semantics in MUTATIONS:
        assert original.count(old) == 1, f"{name}: source fragment is not unique"
        scratch = output / ("mutation-" + name)
        scratch.mkdir()
        shutil.copytree(root / "bend2/src", scratch / "bend2/src")
        shutil.copytree(root / "bend2/scripts", scratch / "bend2/scripts")
        shutil.copytree(root / "bend2/test/native-instance-owner", scratch / "bend2/test/native-instance-owner")
        mutated = scratch / OWNED[0]
        mutated.write_text(original.replace(old, new))
        (scratch / "mutated-source.bend").write_text(mutated.read_text())
        child, streams, started = launch("mutation-" + name,
                                         ["sh", "bend2/scripts/build-native.sh",
                                          "bend2/test/native-instance-owner/custody-tasks.bend",
                                          str(scratch / "fixture")], scratch)
        code = complete("mutation-" + name, child, streams, started)
        stderr = (output / ("mutation-" + name + ".stderr")).read_text(errors="replace")
        location_lines = [line.strip() for line in stderr.splitlines()
                          if "custody-tasks." in line and law in line]
        expected = {"kind": "law-compile-failure", "outer_exit_nonzero": True,
                    "compiler_error": True,
                    "location": f"custody-tasks.{law}",
                    "expected_semantics": expected_semantics}
        observed = {"build_exit": code,
                    "compiler_error": "Error" in stderr,
                    "location_seen": "Location" in stderr and bool(location_lines),
                    "location_lines": location_lines[:4],
                    "law_named": law in stderr,
                    "semantic_verification": "unqualified",
                    "diagnostic_head": stderr.splitlines()[:6]}
        verdict = {"name": name, "target_law": law,
                   "expected": expected, "observed": observed,
                   "claim": ("mutation-refusal-recorded; not qualified as a semantic "
                             "discriminator because the Bend compiler child exit is "
                             "not attributed and no executed diagnostic supplies "
                             "observed semantic values"),
                   "records": [str(output / ("mutation-" + name + ".launch.json")),
                               str(output / ("mutation-" + name + ".completion.json")),
                               str(scratch / "mutated-source.bend"),
                               str(output / ("mutation-" + name + ".stderr"))]}
        record("mutation-" + name + ".verdict", verdict)
        assert code != 0, f"{name}: mutated outer build unexpectedly succeeded (exit {code})"
        assert observed["compiler_error"] and observed["location_seen"], \
            f"{name}: build stderr lacks a compiler Error with a custody-tasks.{law} Location"
        assert observed["law_named"], f"{name}: expected law {law} named in build stderr"

    for path in OWNED:
        assert sha256(root / path) == identity["owned_sha256_before"][path], \
            f"owned file changed during run: {path}"
    assert sha256(args.bend) == identity["bend_sha256"], "compiler changed during run"
    if args.compiler_archive:
        assert sha256(args.compiler_archive) == identity["compiler_archive_sha256"], \
            "compiler archive changed during run"
    assert git("rev-parse", "HEAD^{tree}") == identity["tree_before"], "tree changed during run"
    print("custody-fixture: all modes and mutations matched", flush=True)


if __name__ == "__main__":
    sys.exit(main())
