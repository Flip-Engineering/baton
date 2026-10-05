#!/usr/bin/env python3
"""Build and run the custody-task fixture on an admitted remote runner.

The runner requires a fresh output directory, records the source commit and
tree, component hashes, compiler version, host compiler, platform and any
supplied compiler-archive and library-root identities, then builds and runs
the unmutated fixture and four intended implementation mutations. Every
child keeps its argv, raw stdout, raw stderr and actual exit under the output
path. A structural build failure of the unmutated fixture is retained and
fails the runner; it is never accepted as mutation evidence.
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

# Each mutation: (name, unique source fragment, replacement, law diagnostic
# that must name the failing proof, expected substring in stderr).
MUTATIONS = [
    ("acknowledged-drops-duties",
     "  match clear:\n    case True{}: None{}",
     "  match acknowledged:\n    case True{}: None{}",
     "acknowledged_attempt_with_owed_notice_stays_a_duty"),
    ("ref-open-wake",
     "Bool.not(fulfilled(delivery)),Bool.not(acknowledged),Bool.not(fulfilled(settle))",
     "ref_open(delivery),Bool.not(acknowledged),Bool.not(fulfilled(settle))",
     "unacknowledged_failed_delivery_keeps_the_wake_owed"),
    ("wrong-attempt-accepted",
     "attempt_eq(attempt_of(duty),attempt)",
     "True{}",
     "a_differing_attempt_is_refused_as_unknown"),
    ("settlement-fail-clears",
     "Bool.and(settle_owed,Bool.not(fulfilled(ref)))",
     "Bool.and(settle_owed,fulfilled(ref))",
     "a_failed_settlement_survives_host_acknowledgment"),
]


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

    def run(name, argv, cwd=None, check=None):
        result = subprocess.run(argv, cwd=cwd or root, env=env, capture_output=True)
        (output / (name + ".stdout")).write_bytes(result.stdout)
        (output / (name + ".stderr")).write_bytes(result.stderr)
        record = {"name": name, "argv": list(map(str, argv)), "cwd": str(cwd or root),
                  "exit": result.returncode,
                  "stdout": result.stdout.decode(errors="replace"),
                  "stderr": result.stderr.decode(errors="replace")}
        (output / (name + ".json")).write_text(json.dumps(record, indent=2) + "\n")
        print(json.dumps(record), flush=True)
        if check is not None:
            assert result.returncode == check, f"{name}: exit {result.returncode}, expected {check}"
        return result

    identity = {
        "commit": run("source", ["git", "rev-parse", "HEAD"]).stdout.decode().strip(),
        "tree": run("source-tree", ["git", "rev-parse", "HEAD^{tree}"]).stdout.decode().strip(),
        "bend_version": run("compiler", [args.bend, "version"], check=0).stdout.decode().strip(),
        "bend_sha256": sha256(args.bend),
        "module_sha256": sha256(root / "bend2/src/context/custody-tasks.bend"),
        "fixture_sha256": sha256(root / "bend2/test/native-instance-owner/custody-tasks.bend"),
        "runner_sha256": sha256(Path(__file__).resolve()),
        "host_compiler": run("host-compiler", [os.environ.get("CC", "clang"), "--version"]).stdout.decode(errors="replace"),
        "platform": platform.platform(),
        "compiler_archive": args.compiler_archive,
        "library_root": args.library_root,
    }
    (output / "identity.json").write_text(json.dumps(identity, indent=2) + "\n")

    built = run("build", ["sh", "bend2/scripts/build-native.sh",
                          "bend2/test/native-instance-owner/custody-tasks.bend",
                          str(output / "custody-fixture")], check=0)

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
        result = run(name, [str(output / "custody-fixture"), mode])
        assert result.returncode == int(code), f"{mode}: exit {result.returncode}, expected {code}"
        for need in needs:
            assert need.encode() in result.stdout, f"{mode}: missing {need!r}"

    module = root / "bend2/src/context/custody-tasks.bend"
    original = module.read_text()
    for name, old, new, law in MUTATIONS:
        assert original.count(old) == 1, f"{name}: source fragment is not unique"
        scratch = output / ("mutation-" + name)
        scratch.mkdir()
        shutil.copytree(root / "bend2/src", scratch / "bend2/src")
        shutil.copytree(root / "bend2/scripts", scratch / "bend2/scripts")
        shutil.copytree(root / "bend2/test/native-instance-owner", scratch / "bend2/test/native-instance-owner")
        mutated = scratch / "bend2/src/context/custody-tasks.bend"
        mutated.write_text(original.replace(old, new))
        (scratch / "mutated-source.bend").write_text(mutated.read_text())
        result = run("mutation-" + name,
                     ["sh", "bend2/scripts/build-native.sh",
                      "bend2/test/native-instance-owner/custody-tasks.bend",
                      str(scratch / "fixture")],
                     cwd=scratch)
        assert result.returncode != 0, f"{name}: mutated build unexpectedly succeeded"
        assert law.encode() in result.stderr, f"{name}: expected law {law} named in build stderr"
        (output / ("mutation-" + name + ".json")).write_text(json.dumps(
            {"name": name, "law": law, "exit": result.returncode,
             "stderr": result.stderr.decode(errors="replace")}, indent=2) + "\n")

    restored = sha256(module)
    assert restored == identity["module_sha256"], "module changed during mutations"
    print("custody-fixture: all modes and mutations matched", flush=True)


if __name__ == "__main__":
    sys.exit(main())
