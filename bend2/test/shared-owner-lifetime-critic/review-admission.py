#!/usr/bin/env python3
"""Independently review the immutable owner-admission decision and law gaps.

Only isolated copies are mutated. Historical pins reproduce the coverage gap;
the corrected pin requires rejection at each intended law. These checks cover
the pure component and do not qualify shared runtime integration.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess


PIN = "bea247cc523271f2eab4199febcc47262aca8574"
TYPED_PIN = "0dc3c99051c4df9521546f14aacbd57a19174480"
CORRECTED_PIN = "7de194e02aa7ae0a4e7d19bf5845198182a97881"
MODULE = Path("bend2/src/coordinator/owner-admission.bend")
ENTRY = Path("bend2/test/owner-admission/main.bend")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--bend", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--pin", choices=(PIN, TYPED_PIN, CORRECTED_PIN), default=PIN)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, BEND_NO_TELEMETRY="1")

    def run(name, argv, cwd=root):
        child = subprocess.run(list(map(str, argv)), cwd=cwd, env=env, capture_output=True)
        record = {"argv": list(map(str, argv)), "cwd": str(cwd), "exit": child.returncode,
                  "stdout": child.stdout.decode(errors="replace"),
                  "stderr": child.stderr.decode(errors="replace")}
        (output / (name + ".stdout")).write_bytes(child.stdout)
        (output / (name + ".stderr")).write_bytes(child.stderr)
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(dict(name=name, **record)), flush=True)
        return child

    version = run("compiler", [args.bend, "version"])
    assert version.returncode == 0 and version.stdout.strip() == b"bend 2.0.25"
    sources = {}
    for name, path in (("module", MODULE), ("entry", ENTRY)):
        fetched = run("source-" + name, ["git", "show", args.pin + ":" + str(path)])
        assert fetched.returncode == 0
        sources[path] = fetched.stdout.decode()
    (output / "source-sha256.json").write_text(json.dumps({
        "commit": args.pin, "compiler": hashlib.sha256(Path(args.bend).read_bytes()).hexdigest(),
        "files": {str(p): hashlib.sha256(s.encode()).hexdigest() for p, s in sources.items()}
    }, indent=2) + "\n")

    variants = [("baseline", None)] + [("ignore-" + field, field)
                                      for field in ("request", "session", "operation")]
    for name, field in variants:
        isolated = output / name
        for path, source in sources.items():
            target = isolated / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if path == MODULE and field:
                needle = f"String.eq({field},other_{field})"
                assert source.count(needle) == 1
                source = source.replace(needle, "True{}")
            target.write_text(source)
        checked = run(name + "-check", [args.bend, ENTRY, "--check-only"], isolated)
        if field and args.pin == CORRECTED_PIN:
            diagnostic = (checked.stdout + checked.stderr).decode(errors="replace")
            prefix = "../../src/coordinator/owner-admission."
            assert checked.returncode == 1, (name, diagnostic)
            assert "Location: " + prefix + "changed_" + field + "_refuses_request_reuse\n" in diagnostic
            assert "- expected : " + prefix + "Replay{" in diagnostic
            assert "- observed : " + prefix + "Conflict{" in diagnostic
            continue
        assert checked.returncode == 0
        generated = isolated / "admission.c"
        binary = isolated / "admission"
        assert run(name + "-generate", [args.bend, ENTRY, "-o", generated], isolated).returncode == 0
        assert run(name + "-build", [os.environ.get("CC", "clang"), "-O1", "-pthread",
                                     generated, "-lm", "-o", binary], isolated).returncode == 0
        base = ["db", "request", "session", "receive", "input", "stored", "attempt-a"]
        fields = ("request", "session", "operation") if field is None else (field,)
        for changed_field in fields:
            arguments = base.copy()
            arguments[{"request": 1, "session": 2, "operation": 3}[changed_field]] = "changed"
            result = run(name + "-changed-" + changed_field, [binary, *arguments], isolated)
            assert result.returncode == 0
            conflict = b"conflict\n" if args.pin == PIN else ("conflict:attempt-a:" + changed_field + "\n").encode()
            assert result.stdout == (conflict if field is None else b"replay:attempt-a\n")
        if field is None:
            replay = run("baseline-replay", [binary, *base], isolated)
            assert replay.returncode == 0 and replay.stdout == b"replay:attempt-a\n"
            fresh = run("baseline-absent", [binary, *base[:5], "absent", ""], isolated)
            assert fresh.returncode == 0 and fresh.stdout == b"fresh\n"


if __name__ == "__main__":
    main()
