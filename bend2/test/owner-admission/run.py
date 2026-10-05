#!/usr/bin/env python3
"""Compile and exercise the actual owner admission decision and its mutations."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    compiler = str(Path(args.bend).resolve())
    module = Path("bend2/src/coordinator/owner-admission.bend")
    entry = Path("bend2/test/owner-admission/main.bend")
    env = dict(os.environ, BEND_NO_TELEMETRY="1")

    def run(name, argv, cwd=root):
        started = time.monotonic()
        child = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True)
        record = dict(argv=list(map(str, argv)), cwd=str(cwd), exit=child.returncode,
                      elapsed_seconds=time.monotonic() - started)
        (output / (name + ".stdout")).write_bytes(child.stdout)
        (output / (name + ".stderr")).write_bytes(child.stderr)
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(name, "exit", child.returncode, flush=True)
        return child

    version = run("compiler", [compiler, "version"])
    assert version.returncode == 0 and version.stdout.strip() == b"bend 2.0.25"
    revision = run("source", ["git", "rev-parse", "HEAD"])
    assert revision.returncode == 0
    paths = [module, entry, Path(__file__).resolve().relative_to(root)]
    identity = {str(path): hashlib.sha256((root / path).read_bytes()).hexdigest() for path in paths}
    identity[compiler] = hashlib.sha256(Path(compiler).read_bytes()).hexdigest()
    (output / "source-sha256.json").write_text(json.dumps(identity, indent=2) + "\n")
    assert run("check", [compiler, entry, "--check-only"]).returncode == 0
    generated = output / "admission.c"
    executable = output / "admission"
    assert run("generate", [compiler, entry, "-o", generated]).returncode == 0
    assert run("native-build", [os.environ.get("CC", "clang"), "-O1", "-pthread",
                                generated, "-lm", "-o", executable]).returncode == 0
    base = ["db", "request", "session", "receive", "input", "stored", "attempt-a"]
    cases = {"retry": (base, "replay:attempt-a"),
             "missing-record": (base[:5] + ["absent", ""], "fresh"),
             "missing-attempt": (base[:6] + [""], "invalid:attempt"),
             "replay-original-attempt": (base[:6] + ["older-attempt"], "replay:older-attempt")}
    for index, field in enumerate(("database", "request", "session", "operation", "payload")):
        changed = base.copy()
        changed[index] = "different"
        cases["changed-" + field] = (changed, "conflict:attempt-a:" + field)
        if field != "payload":
            empty = base.copy()
            empty[index] = ""
            cases["empty-" + field] = (empty, "invalid:" + field)
    cases["empty-payload-new"] = (base[:4] + ["", "absent", ""], "fresh")
    for name, (arguments, expected) in cases.items():
        child = run("case-" + name, [executable, *arguments])
        assert child.returncode == 0 and child.stdout.decode().strip() == expected, name

    mutations = {
        "drop-conflict-attempt": ("case Some{field}: Conflict{attempt,field}",
                                  'case Some{field}: Conflict{"",field}',
                                  "conflict_preserves_attempt_and_field", "Conflict", "Conflict"),
        "duplicate-grant": ("case None{}: Replay{attempt}", "case None{}: Fresh{}",
                            "identical_retry_preserves_original_attempt", "Fresh", "Replay"),
        "ignore-payload": ("String.eq(payload,other_payload)", "True{}",
                           "changed_payload_refuses_request_reuse", "Replay", "Conflict"),
        "ignore-database": ("String.eq(db,other_db)", "True{}",
                            "changed_database_refuses_request_reuse", "Replay", "Conflict"),
        "ignore-request": ("String.eq(request,other_request)", "True{}",
                           "changed_request_refuses_request_reuse", "Replay", "Conflict"),
        "ignore-session": ("String.eq(session,other_session)", "True{}",
                           "changed_session_refuses_request_reuse", "Replay", "Conflict"),
        "ignore-operation": ("String.eq(operation,other_operation)", "True{}",
                             "changed_operation_refuses_request_reuse", "Replay", "Conflict"),
        "missing-attempt-grant": ("case False{}: Invalid{AttemptField{}}\n    case True{}: replay",
                                  "case False{}: Fresh{}\n    case True{}: replay",
                                  "missing_attempt_does_not_authorize_new_grant", "Fresh", "Invalid"),
    }
    source = (root / module).read_text()
    for name, (old, new, law, expected, observed) in mutations.items():
        assert source.count(old) == 1, name
        with tempfile.TemporaryDirectory(prefix="admission-", dir=output) as directory:
            isolated = Path(directory)
            (isolated / module).parent.mkdir(parents=True)
            (isolated / entry).parent.mkdir(parents=True)
            mutated = source.replace(old, new)
            (isolated / module).write_text(mutated)
            shutil.copyfile(root / entry, isolated / entry)
            (output / (name + ".bend")).write_text(mutated)
            child = run("mutation-" + name, [compiler, entry, "--check-only"], isolated)
            diagnostic = (child.stdout + child.stderr).decode(errors="replace")
            prefix = "../../src/coordinator/owner-admission."
            assert child.returncode == 1, (name, diagnostic)
            assert "Location: " + prefix + law + "\n" in diagnostic, (name, diagnostic)
            assert "- expected : " + prefix + expected + "{" in diagnostic, (name, diagnostic)
            assert "- observed : " + prefix + observed + "{" in diagnostic, (name, diagnostic)
    print("Admission cases and intended implementation mutation rejections passed.", flush=True)


if __name__ == "__main__":
    main()
