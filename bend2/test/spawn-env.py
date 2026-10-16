"""D5 env-delta vectors (spec rewrite-native/spawn-env-proposal.md).

The driver sets FOO=1 and PARENT_BAR=keep in the program's parent
environment, then each case runs /usr/bin/env through Process.run with
one delta and writes the captured output to its own results file:

1. bare NAME removes: results-1 lacks FOO=1
2. NAME=VALUE sets: results-2 has CHILD_BAR=2
3. set overrides: results-3 has FOO=9 and lacks FOO=1
4. empty inherits: results-4 has FOO=1 and PARENT_BAR=keep
5. empty name refuses: results-5 is exactly fail:22
6. value containing '=' survives: results-6 has K=V=W
7. last wins, set after removal: results-7 has FOO=9, lacks FOO=1
8. last wins, removal after set: results-8 has no FOO= line at all

Build the program first with the native test gate,

    sh bend2/scripts/build-native.sh bend2/test/spawn-env.bend SCRATCH/spawn-env

then run

    python3 bend2/test/spawn-env.py SCRATCH/spawn-env
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile


def env_lines(text: str) -> list:
    lines = text.split("\n")
    if not lines or not lines[0].startswith("exit "):
        return None
    if lines[0] != "exit 0":
        return None
    return lines[1:]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: spawn-env.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"spawn-env.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-spawn-env-"))
    parent = dict(os.environ)
    parent["FOO"] = "1"
    parent["PARENT_BAR"] = "keep"
    parent.pop("CHILD_BAR", None)
    parent["A"] = "parent1"
    try:
        run = subprocess.run(
            [str(program)],
            cwd=root,
            env=parent,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"spawn-env.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        def read(name):
            return (root / name).read_text(encoding="utf-8")
        failures = []
        one = env_lines(read("results-1"))
        if one is None or any(line == "FOO=1" for line in one):
            failures.append("results-1: removal did not drop FOO=1")
        two = env_lines(read("results-2"))
        if two is None or "CHILD_BAR=2" not in two or any(
                line.startswith("CHILD_BAR=") and line != "CHILD_BAR=2"
                for line in two):
            failures.append("results-2: set entry missing or mangled")
        seven = env_lines(read("results-7"))
        if seven is None or "FOO=9" not in seven or "FOO=1" in seven:
            failures.append("results-7: set after remove did not win")
        eight = env_lines(read("results-8"))
        if eight is None or any(line.startswith("FOO=") for line in eight):
            failures.append("results-8: removal after set left a FOO line")
        nine = env_lines(read("results-9"))
        if nine is None or nine.count("A=2") != 1 or "A=1" in nine or "A=parent1" in nine:
            failures.append("results-9: set-then-set did not answer exactly one A=2")
        three = env_lines(read("results-3"))
        if three is None or "FOO=9" not in three or "FOO=1" in three:
            failures.append("results-3: override did not replace FOO")
        four = env_lines(read("results-4"))
        if four is None or "FOO=1" not in four or "PARENT_BAR=keep" not in four:
            failures.append("results-4: empty delta did not inherit")
        five = read("results-5")
        if five != "fail:22":
            failures.append(f"results-5: expected fail:22, got {five!r}")
        six = env_lines(read("results-6"))
        if six is None or "K=V=W" not in six:
            failures.append("results-6: value with '=' mangled")
        if failures:
            for failure in failures:
                print("spawn-env.py: " + failure, file=sys.stderr)
            return 1
        print("spawn-env.py: all nine env-delta vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
