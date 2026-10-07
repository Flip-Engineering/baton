#!/usr/bin/env python3
"""Independent bounded execution of the conductor owner-admission module.

Copies the exact module and test entry bytes from the conductor worktree (or a
given revision source directory) into an owned layout, compiles them with the
pinned Bend 2.0.25 compiler, and runs an independent case set that adds field
precedence, payload-encoding and comparison-cost cases to the conductor's cases.

No file in the conductor worktree is modified.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

HERE = Path(__file__).resolve().parent
DEFAULT_COMPILER = ("/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/"
                    ".scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--conductor-worktree", required=True)
    parser.add_argument("--compiler", default=DEFAULT_COMPILER)
    parser.add_argument("--output", default=str(HERE / "out"))
    args = parser.parse_args()

    source = Path(args.conductor_worktree)
    work = Path(args.output).resolve()
    shutil.rmtree(work, ignore_errors=True)
    (work / "src" / "coordinator").mkdir(parents=True)
    (work / "test" / "owner-admission").mkdir(parents=True)

    module_src = source / "bend2/src/coordinator/owner-admission.bend"
    entry_src = source / "bend2/test/owner-admission/main.bend"
    shutil.copy(module_src, work / "src/coordinator/owner-admission.bend")
    shutil.copy(entry_src, work / "test/owner-admission/main.bend")
    identity = {
        "module_source": str(module_src),
        "module_sha256": sha256(module_src),
        "entry_source": str(entry_src),
        "entry_sha256": sha256(entry_src),
        "compiler": args.compiler,
        "compiler_sha256": sha256(args.compiler),
    }

    def run(name, argv, cwd=work, stdin=None):
        started = time.monotonic()
        child = subprocess.run(argv, cwd=cwd, capture_output=True, input=stdin)
        return {
            "name": name,
            "argv": argv,
            "exit": child.returncode,
            "elapsed": round(time.monotonic() - started, 4),
            "stdout": child.stdout.decode(errors="replace")[:400],
            "stderr": child.stderr.decode(errors="replace")[:400],
        }

    results = [run("version", [args.compiler, "version"])]
    version_ok = results[-1]["exit"] == 0 and results[-1]["stdout"].strip() == "bend 2.0.25"
    results.append(run("check", [args.compiler, "test/owner-admission/main.bend", "--check-only"]))
    generated = work / "admission.c"
    executable = work / "admission"
    results.append(run("generate", [args.compiler, "test/owner-admission/main.bend", "-o", str(generated)]))
    results.append(run("build", [os.environ.get("CC", "clang"), "-O1", "-pthread",
                                 str(generated), "-lm", "-o", str(executable)]))

    base = ["db", "request", "session", "receive", "input", "stored", "attempt-a"]
    present = list(base)

    def args_for(db="db", request="request", session="session", operation="receive",
                 payload="input", stored="stored", attempt="attempt-a"):
        return [db, request, session, operation, payload, stored, attempt]

    cases = {
        "retry-identical": (args_for(), "replay:attempt-a"),
        "stored-absent-empty-payload": (args_for(payload="", stored="absent", attempt=""), "fresh"),
        "stored-absent-empty-attempt": (args_for(stored="absent", attempt=""), "fresh"),
        "attempt-empty-with-record": (args_for(attempt=""), "invalid:attempt"),
        "conflict-request-field": (args_for(request="other"), "conflict:attempt-a:request"),
        "conflict-session-field": (args_for(session="other"), "conflict:attempt-a:session"),
        "conflict-operation-field": (args_for(operation="other"), "conflict:attempt-a:operation"),
        "conflict-database-field": (args_for(db="other"), "conflict:attempt-a:database"),
        "conflict-payload-field": (args_for(payload="other"), "conflict:attempt-a:payload"),
        "payload-trailing-newline": (args_for(payload="input\n"), "conflict:attempt-a:payload"),
        "empty-database": (args_for(db=""), "invalid:database"),
        "empty-request": (args_for(request=""), "invalid:request"),
        "empty-session": (args_for(session=""), "invalid:session"),
        "empty-operation": (args_for(operation=""), "invalid:operation"),
        "empty-database-beats-conflict": (args_for(db="", session="other"), "invalid:database"),
        "database-beats-payload": (args_for(db="other", payload="other"), "conflict:attempt-a:database"),
        "request-beats-session": (args_for(request="other", session="other"), "conflict:attempt-a:request"),
        "session-beats-operation": (args_for(session="other", operation="other"), "conflict:attempt-a:session"),
        "operation-beats-payload": (args_for(operation="other", payload="other"), "conflict:attempt-a:operation"),
        "empty-record-attempt-beats-conflict": (args_for(session="other", payload="other", attempt=""), "invalid:attempt"),
        "unicode-payload-differs": (args_for(payload="inpüt"), "conflict:attempt-a:payload"),
        "flaglike-values-retained": (args_for(db="--pretty", session="-"), "conflict:attempt-a:database"),
    }
    for name, (arguments, expected) in cases.items():
        outcome = run("case-" + name, [str(executable), *arguments])
        outcome["expected"] = expected
        outcome["matched"] = outcome["exit"] == 0 and outcome["stdout"].strip() == expected
        results.append(outcome)

    # Bounded comparison cost and argv capacity. The current ordinary CLI path
    # carries the request in argv, so ARG_MAX bounds the payload; both a fitting
    # 200 KB payload and an over-limit payload are recorded.
    size = 200000
    big = "x" * size
    for name, payload, expected in (
        ("cost-identical-200kb", big, "replay:attempt-a"),
        ("cost-differs-last-byte-200kb", big[:-1] + "y", "conflict:attempt-a:payload"),
    ):
        outcome = run(name, [str(executable), *args_for(payload=payload)])
        outcome["expected"] = expected
        outcome["matched"] = outcome["exit"] == 0 and outcome["stdout"].strip() == expected
        results.append(outcome)
    over = "x" * 1200000
    try:
        outcome = run("cost-over-argmax-1.2mb", [str(executable), *args_for(payload=over)])
        outcome["expected"] = "operating-system argument limit"
        outcome["matched"] = outcome["exit"] != 0
    except OSError as error:
        outcome = {"name": "cost-over-argmax-1.2mb", "argv": [], "exit": None,
                   "elapsed": None, "stdout": "", "stderr": "",
                   "os_error": error.strerror, "errno": error.errno,
                   "expected": "operating-system argument limit", "matched": True}
    results.append(outcome)

    # Malformed request: six arguments must refuse rather than decide.
    bad = run("case-malformed-argv", [str(executable), "db", "request", "session", "receive", "input", "stored"])
    bad["expected"] = "exit 2 refusal"
    bad["matched"] = bad["exit"] == 2
    results.append(bad)

    identity["version_ok"] = version_ok
    failures = [r["name"] for r in results if r["name"].startswith(("case-", "cost-")) and not r.get("matched")]
    summary = {
        "identity": identity,
        "compiler_version_ok": version_ok,
        "check_exit": results[1]["exit"],
        "build_exit": results[3]["exit"],
        "case_failures": failures,
        "cases_run": len([r for r in results if r["name"].startswith(("case-", "cost-"))]),
    }
    (work / "results.json").write_text(json.dumps({"summary": summary, "results": results}, indent=2) + "\n")
    print(json.dumps(summary, indent=2))
    for r in results:
        if r["name"].startswith(("case-", "cost-")):
            print("%-40s exit=%s elapsed=%s matched=%s out=%r" % (
                r["name"], r["exit"], r["elapsed"], r.get("matched"), r["stdout"].strip()[:60]))


if __name__ == "__main__":
    main()
