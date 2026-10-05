#!/usr/bin/env python3
"""Run the retained-offset component on a root-admitted remote runner."""

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


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            result.update(block)
    return result.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--compiler-archive", required=True)
    parser.add_argument("--library-root", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    compiler = Path(args.bend).resolve(strict=True)
    archive = Path(args.compiler_archive).resolve(strict=True)
    library = Path(args.library_root).resolve(strict=True)
    module = Path("bend2/src/context/retained-read.bend")
    dependency = Path("bend2/src/context/receive-request.bend")
    entry = Path("bend2/test/retained-read/main.bend")
    runner = Path(__file__).resolve().relative_to(root)
    paths = (module, dependency, entry, runner)
    env = dict(os.environ, BEND_NO_TELEMETRY="1")

    def run(name, argv, cwd=root):
        argv = list(map(str, argv))
        started = time.monotonic()
        stdout_path = output / (name + ".stdout")
        stderr_path = output / (name + ".stderr")
        with stdout_path.open("wb") as stdout_file, stderr_path.open("wb") as stderr_file:
            child = subprocess.Popen(argv, cwd=cwd, env=env, stdout=stdout_file, stderr=stderr_file)
            launch = dict(argv=argv, cwd=str(cwd), pid=child.pid)
            try:
                (output / (name + ".launch.json")).write_text(json.dumps(launch, indent=2) + "\n")
                child.wait()
            except BaseException as error:
                # The remote job owns reconciliation of this same child.
                # Retain source and output even when its exit was not observed.
                interrupted = dict(launch, outcome="unobserved", error_type=type(error).__name__)
                try:
                    (output / (name + ".interrupted.json")).write_text(json.dumps(interrupted, indent=2) + "\n")
                except OSError:
                    pass
                print(json.dumps(interrupted), file=sys.stderr, flush=True)
                raise
        stdout, stderr = stdout_path.read_bytes(), stderr_path.read_bytes()
        record = dict(launch, exit=child.returncode, elapsed_seconds=time.monotonic() - started,
                      stdout_sha256=hashlib.sha256(stdout).hexdigest(),
                      stderr_sha256=hashlib.sha256(stderr).hexdigest())
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(name, "exit", child.returncode, flush=True)
        return child.returncode, stdout, stderr

    def identity():
        return dict(platform=platform.platform(), machine=platform.machine(),
                    compiler=dict(path=str(compiler), sha256=digest(compiler)),
                    archive=dict(path=str(archive), sha256=digest(archive)),
                    library=dict(path=str(library), files={str(p.relative_to(library)): digest(p)
                                 for p in sorted(library.rglob("*")) if p.is_file()}),
                    files={str(p): digest(root / p) for p in paths})

    before = identity()
    (output / "identity-before.json").write_text(json.dumps(before, indent=2) + "\n")
    for name, command in (("source", ["git", "rev-parse", "HEAD", "HEAD^{tree}"]),
                          ("source-status", ["git", "status", "--porcelain", "--", *paths]),
                          ("host-compiler", [os.environ.get("CC", "clang"), "--version"])):
        status, stdout, stderr = run(name, command)
        assert status == 0, (name, status)
        if name == "source-status":
            assert stdout == b"", "Component source must match its recorded commit"
    status, stdout, stderr = run("compiler", [compiler, "version"])
    assert status == 0 and stdout.strip() == b"bend 2.0.25"
    assert run("check", [compiler, entry, "--check-only"])[0] == 0
    generated = output / "retained-read.c"
    binary = output / "retained-read"
    assert run("generate", [compiler, entry, "-o", generated])[0] == 0
    assert run("native-build", [os.environ.get("CC", "clang"), "-O1", "-pthread", generated,
                                "-lm", "-o", binary])[0] == 0
    status, stdout, stderr = run("examples", [binary])
    assert status == 0 and stdout == b"1:0\noverflow\noverflow\n4:12\n"

    # Python integers supply the independent unsigned arithmetic result.
    cases = {
        "nonzero-words": (7, 11, 3, 17),
        "carry-with-nonzero-high": (7, 4294967295, 3, 1),
        "maximum-offset": (4294967295, 4294967295, 0, 0),
        "high-overflow-without-carry": (4294967295, 0, 1, 0),
        "carry-at-high-limit": (4294967295, 4294967295, 0, 1),
        "both-word-overflows": (4294967295, 4294967295, 1, 1),
    }
    for name, words in cases.items():
        high, low, other_high, other_low = words
        total = ((high << 32) | low) + ((other_high << 32) | other_low)
        expected = "overflow" if total >= (1 << 64) else f"{total >> 32}:{total & ((1 << 32) - 1)}"
        status, stdout, stderr = run("case-" + name, [binary, *words])
        assert status == 0 and stdout == (expected + "\n").encode(), name
    for index in range(4):
        words = ["0", "0", "0", "0"]
        words[index] = "invalid"
        status, stdout, stderr = run("invalid-word-" + str(index), [binary, *words])
        assert status == 2 and stdout == b"" and b"Invalid unsigned offset word." in stderr

    controls = (
        ("drop-low-carry", "U32.is_lt(next_low,low)", "False{}", "offset_carry_keeps_the_high_word", "Done", "Done"),
        ("drop-high-overflow", "U32.is_lt(next_high,high)", "False{}", "offset_high_word_overflow_is_refused", "Done", "Fail"),
        ("drop-carry-overflow", "U32.is_eq(high,4294967295)", "False{}", "offset_carry_overflow_is_refused", "Done", "Fail"),
    )
    source = (root / module).read_text()
    for name, old, new, law, expected, observed in controls:
        implementation, laws = source.split("\nlaw ", 1)
        assert implementation.count(old) == 1, name
        mutated = implementation.replace(old, new) + "\nlaw " + laws
        (output / (name + ".bend")).write_text(mutated)
        isolated = output / ("mutation-source-" + name)
        isolated.mkdir()
        for path in (module, dependency, entry):
            (isolated / path).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(root / path, isolated / path)
        (isolated / module).write_text(mutated)
        status, stdout, stderr = run("mutation-" + name, [compiler, entry, "--check-only"], isolated)
        diagnostic = (stdout + stderr).decode(errors="replace")
        assert status == 1, (name, diagnostic)
        assert "Location: ../../src/context/retained-read." + law + "\n" in diagnostic, (name, diagnostic)
        for label, constructor in (("expected", expected), ("observed", observed)):
            pattern = r"^- " + label + r" : (?:[A-Za-z0-9_./-]+\.)?" + constructor + r"\{"
            assert re.search(pattern, diagnostic, re.MULTILINE), (name, diagnostic)
    after = identity()
    (output / "identity-after.json").write_text(json.dumps(after, indent=2) + "\n")
    assert before == after, "Source or toolchain changed during this run"
    print("Retained offset cases and intended implementation controls passed.", flush=True)


if __name__ == "__main__":
    main()
