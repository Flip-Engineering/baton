#!/usr/bin/env python3
"""Measure the law-diagnostic path prefix for the import form Main will use.

The interfaces report requires the composed Main diagnostic prefix to be measured
rather than assumed from the isolated fixture prefix. This probe is scoped: it
builds the same two-level import shape (entry -> laws module -> owner-admission)
from a copy of the validated module, applies one of the pinned implementation
mutations, and records the exact diagnostic prefix. It is not the composed Main
compile; that remains the CI owner's measurement.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

HERE = Path(__file__).resolve().parent
DEFAULT_COMPILER = ("/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/"
                    ".scratch/native-artifact-qualification-20261002T174637Z/toolchain-home/bin/bend")
MODULE_SRC = ("/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/"
              ".scratch/semantic-context-20261005/worktrees/native-instance-conductor/"
              "bend2/src/coordinator/owner-admission.bend")

LAWS = '''import Base
import ./owner-admission.bend as OwnerAdmission

def witness(+decision: OwnerAdmission.Decision) -> String:
  match decision:
    case OwnerAdmission.Fresh{}: "fresh"
    case OwnerAdmission.Replay{attempt}: "replay"
    case OwnerAdmission.Conflict{attempt,field}: "conflict"
    case OwnerAdmission.Invalid{field}: "invalid"
'''

ENTRY = '''import Base
import ./laws-like.bend as Laws

def main() -> IO(Unit):
  IO.print(Laws.witness(Laws.fresh()))
'''

MUTATION = ("case None{}: Replay{attempt}", "case None{}: Fresh{}")


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--compiler", default=DEFAULT_COMPILER)
    parser.add_argument("--output", default=str(HERE / "prefix-out"))
    args = parser.parse_args()
    work = Path(args.output).resolve()
    shutil.rmtree(work, ignore_errors=True)
    coordinator = work / "src" / "coordinator"
    coordinator.mkdir(parents=True)
    module = coordinator / "owner-admission.bend"
    shutil.copy(MODULE_SRC, module)
    (coordinator / "laws-like.bend").write_text(LAWS)
    (coordinator / "main-like.bend").write_text(ENTRY)

    record = {"module_sha256": sha256(module), "module_source": MODULE_SRC,
              "compiler_sha256": sha256(args.compiler)}

    def compile_entry(name, source_text=None):
        if source_text is not None:
            module.write_text(source_text)
        child = subprocess.run([args.compiler, "src/coordinator/main-like.bend", "--check-only"],
                               cwd=work, capture_output=True)
        text = (child.stdout.decode(errors="replace") + child.stderr.decode(errors="replace"))
        return {"case": name, "exit": child.returncode,
                "diagnostic_lines": [line for line in text.splitlines()
                                     if "Location" not in line][:12]}

    baseline_source = module.read_text()
    record["baseline"] = compile_entry("baseline")
    count = baseline_source.count(MUTATION[0])
    record["mutation_occurrences"] = count
    record["mutation"] = compile_entry("duplicate-grant",
                                       baseline_source.replace(MUTATION[0], MUTATION[1]))
    (work / "prefix.json").write_text(json.dumps(record, indent=2) + "\n")
    print(json.dumps(record, indent=2))


if __name__ == "__main__":
    main()
