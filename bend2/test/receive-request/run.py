#!/usr/bin/env python3
"""Compile and exercise the actual Receive request routing decisions and their mutations."""

import argparse
import hashlib
import json
import os
import re
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
    output.mkdir(parents=True, exist_ok=False)
    compiler = str(Path(args.bend).resolve())
    module = Path("bend2/src/context/receive-request.bend")
    entry = Path("bend2/test/receive-request/main.bend")
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
    generated = output / "receive-request.c"
    executable = output / "receive-request"
    assert run("generate", [compiler, entry, "-o", generated]).returncode == 0
    assert run("native-build", [os.environ.get("CC", "clang"), "-O1", "-pthread",
                                generated, "-lm", "-o", executable]).returncode == 0
    base = ["db", "owner", "request", "session", "cursor", "body"]
    cases = {"matching": (base, "matched:stdout:cursor:body"),
             "empty-bytes": (base[:5] + [""], "matched:stdout:cursor:"),
             "literal-bytes": (base[:5] + ["--flag λ \nsecond"], "matched:stdout:cursor:--flag λ \nsecond"),
             "stderr-matching": (["stderr", *base], "matched:stderr:cursor:body"),
             "wake-empty": (["wake", ""], "none"),
             "wake-literal": (["wake", "original-wake-λ\nnext"], "some:original-wake-λ\nnext")}
    for index, field in enumerate(("database", "owner", "request", "session")):
        changed = base.copy()
        changed[index] = "other-" + field
        cases["different-" + field] = (changed, "mismatched:stdout:cursor:body")
        cases["stderr-different-" + field] = (["stderr", *changed], "mismatched:stderr:cursor:body")
    for name, (arguments, expected) in cases.items():
        child = run("case-" + name, [executable, *arguments])
        assert child.returncode == 0 and child.stdout.decode() == expected + "\n", name

    mutations = {}
    for field in ("database", "owner", "request", "session"):
        mutations["ignore-" + field] = (
            "String.eq(" + field + ",other_" + field + ")", "True{}",
            "different_" + field + "_preserves_unrouted_frame", "Matched", "Mismatched")
    mutations["drop-bytes"] = (
        "select(OutputFrame{correlation,stream,cursor,bytes}",
        'select(OutputFrame{correlation,stream,cursor,""}',
        "matching_output_preserves_frame", "Matched", "Matched")
    mutations["change-stream"] = (
        "select(OutputFrame{correlation,stream,cursor,bytes}",
        "select(OutputFrame{correlation,Stdout{},cursor,bytes}",
        "matching_output_preserves_frame", "Matched", "Matched")
    mutations["drop-cursor"] = (
        "select(OutputFrame{correlation,stream,cursor,bytes}",
        'select(OutputFrame{correlation,stream,"",bytes}',
        "matching_output_preserves_frame", "Matched", "Matched")
    mutations["mismatch-loses-stderr"] = (
        "def select(frame: OutputFrame, matches: Bool) -> OutputRoute:\n"
        "  match matches:\n"
        "    case True{}: Matched{frame}\n"
        "    case False{}: Mismatched{frame}",
        "def mismatch_stdout(frame: OutputFrame) -> OutputRoute:\n"
        "  match frame:\n"
        "    case OutputFrame{correlation,stream,cursor,bytes}:\n"
        "      Mismatched{OutputFrame{correlation,Stdout{},cursor,bytes}}\n\n"
        "def select(frame: OutputFrame, matches: Bool) -> OutputRoute:\n"
        "  match matches:\n"
        "    case True{}: Matched{frame}\n"
        "    case False{}: mismatch_stdout(frame)",
        "mismatched_output_preserves_entire_frame", "Mismatched", "Mismatched")
    mutations["wake-replaced"] = (
        "case other: Some{other}", 'case other: Some{"message"}',
        "nonempty_wake_keeps_message_identifier", "Some", "Some")
    source = (root / module).read_text()
    for name, (old, new, law, expected, observed) in mutations.items():
        assert source.count(old) == 1, name
        with tempfile.TemporaryDirectory(prefix="receive-request-", dir=output) as directory:
            isolated = Path(directory)
            (isolated / module).parent.mkdir(parents=True)
            (isolated / entry).parent.mkdir(parents=True)
            mutated = source.replace(old, new)
            (isolated / module).write_text(mutated)
            shutil.copyfile(root / entry, isolated / entry)
            (output / (name + ".bend")).write_text(mutated)
            child = run("mutation-" + name, [compiler, entry, "--check-only"], isolated)
            diagnostic = (child.stdout + child.stderr).decode(errors="replace")
            prefix = "../../src/context/receive-request."
            assert child.returncode == 1, (name, diagnostic)
            assert "Location: " + prefix + law + "\n" in diagnostic, (name, diagnostic)
            for label, constructor in (("expected", expected), ("observed", observed)):
                if name == "wake-replaced":
                    # Base constructor qualification is determined by the compiler.
                    pattern = r"^- " + label + r" : (?:[A-Za-z0-9_./-]+\.)?Some\{"
                    assert re.search(pattern, diagnostic, re.MULTILINE), (name, diagnostic)
                else:
                    assert "- " + label + " : " + prefix + constructor + "{" in diagnostic, (name, diagnostic)
    print("Receive request cases and intended implementation mutation rejections passed.", flush=True)


if __name__ == "__main__":
    main()
