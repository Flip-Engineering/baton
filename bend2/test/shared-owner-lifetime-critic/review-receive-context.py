#!/usr/bin/env python3
"""Remote-only independent review of immutable Receive correlation laws.

Run on a root-admitted remote runner. This counterexample probe preserves
source and child output; it does not establish shared-runtime acceptance.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess


PIN = "3a5523364c3178fda38813d00734857692541ff2"
MODULE = Path("bend2/src/context/receive-request.bend")
AUTHOR_ENTRY = Path("bend2/test/receive-request/main.bend")
AUTHOR_RUNNER = Path("bend2/test/receive-request/run.py")
ENTRY = Path("bend2/test/shared-owner-lifetime-critic/receive-context.bend")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    compiler = str(Path(args.bend).resolve())
    env = dict(os.environ, BEND_NO_TELEMETRY="1")

    def run(name, argv, cwd=root):
        child = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True)
        record = dict(argv=list(map(str, argv)), cwd=str(cwd), exit=child.returncode)
        (output / (name + ".stdout")).write_bytes(child.stdout)
        (output / (name + ".stderr")).write_bytes(child.stderr)
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(name, "exit", child.returncode, flush=True)
        return child

    version = run("compiler", [compiler, "version"])
    assert version.returncode == 0 and version.stdout.strip() == b"bend 2.0.25"
    assert run("host-compiler", [os.environ.get("CC", "clang"), "--version"]).returncode == 0
    assert run("fixture-commit", ["git", "rev-parse", "HEAD"]).returncode == 0
    sources = {ENTRY: (root / ENTRY).read_text()}
    for path in (MODULE, AUTHOR_ENTRY, AUTHOR_RUNNER):
        fetched = run("source-" + path.name, ["git", "show", PIN + ":" + str(path)])
        assert fetched.returncode == 0
        sources[path] = fetched.stdout.decode()
    (output / "source-sha256.json").write_text(json.dumps({
        "commit": PIN, "platform": platform.platform(),
        "compiler": hashlib.sha256(Path(compiler).read_bytes()).hexdigest(),
        "files": {str(p): hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}
    }, indent=2) + "\n")

    def isolate(name, source):
        directory = output / name
        for path, content in sources.items():
            target = directory / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source if path == MODULE else content)
        return directory

    def build(name, directory):
        generated = directory / "context.c"
        binary = directory / "context"
        assert run(name + "-check", [compiler, ENTRY, "--check-only"], directory).returncode == 0
        assert run(name + "-generate", [compiler, ENTRY, "-o", generated], directory).returncode == 0
        assert run(name + "-build", [os.environ.get("CC", "clang"), "-O1", "-pthread", generated, "-lm", "-o", binary], directory).returncode == 0
        return binary

    source = sources[MODULE]
    baseline = isolate("baseline", source)
    binary = build("baseline", baseline)
    fields = ("database", "owner", "request", "session")
    base = ["db", "owner", "request", "session"]
    for channel in ("stdout", "stderr"):
        for changed in (None, *fields):
            values = base.copy()
            if changed:
                values[fields.index(changed)] = "different"
            name = channel + "-" + (changed or "matching")
            payload = "--flag λ\nretained output\n"
            result = run("case-" + name, [binary, "route", *values, channel, "cursor", payload])
            expected = ("mismatched:" if changed else "matched:") + ":".join(values + [channel, "cursor", payload]) + "\n"
            assert result.returncode == 0 and result.stdout.decode() == expected
    for name, message in (("empty", ""), ("literal", "wake-λ\nnext")):
        result = run("case-wake-" + name, [binary, "wake", message])
        assert result.returncode == 0 and result.stdout.decode() == ("some:" + message if message else "none") + "\n"

    controls = [("ignore-" + field, "String.eq(" + field + ",other_" + field + ")", "True{}",
                 "different_" + field + "_preserves_unrouted_frame", "Matched", "Mismatched") for field in fields]
    frame = "select(OutputFrame{correlation,stream,cursor,bytes}"
    controls += [("drop-bytes", frame, 'select(OutputFrame{correlation,stream,cursor,""}', "matching_output_preserves_frame", "Matched", "Matched"),
                 ("change-stream", frame, "select(OutputFrame{correlation,Stdout{},cursor,bytes}", "matching_output_preserves_frame", "Matched", "Matched"),
                 ("drop-cursor", frame, 'select(OutputFrame{correlation,stream,"",bytes}', "matching_output_preserves_frame", "Matched", "Matched")]
    for name, old, new, law, expected, observed in controls:
        assert source.count(old) == 1
        directory = isolate(name, source.replace(old, new))
        result = run(name + "-check", [compiler, AUTHOR_ENTRY, "--check-only"], directory)
        diagnostic = (result.stdout + result.stderr).decode()
        prefix = "../../src/context/receive-request."
        assert result.returncode == 1
        assert "Location: " + prefix + law + "\n" in diagnostic
        assert "- expected : " + prefix + expected + "{" in diagnostic
        assert "- observed : " + prefix + observed + "{" in diagnostic

    old = "case False{}: Mismatched{frame}"
    new = """case False{}:
      match frame:
        case OutputFrame{correlation,stream,cursor,bytes}:
          Mismatched{OutputFrame{correlation,Stdout{},cursor,bytes}}"""
    assert source.count(old) == 1
    directory = isolate("mismatch-loses-stderr", source.replace(old, new))
    binary = build("mismatch-loses-stderr", directory)
    result = run("mismatch-loses-stderr-runtime", [binary, "route", "db", "other-owner", "request", "session", "stderr", "cursor", "failure"])
    assert result.returncode == 0 and result.stdout == b"mismatched:db:other-owner:request:session:stdout:cursor:failure\n"

    old = "case other: Some{other}"
    assert source.count(old) == 1
    directory = isolate("wake-replaced", source.replace(old, 'case other: Some{"message"}'))
    binary = build("wake-replaced", directory)
    result = run("wake-replaced-runtime", [binary, "wake", "original-wake-id"])
    assert result.returncode == 0 and result.stdout == b"some:message\n"
    print("Intended controls rejected; additional mismatch-stream and wake-identity gaps reproduced.", flush=True)


if __name__ == "__main__":
    main()
