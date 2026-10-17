"""Exec.run_capture vectors (bend2/src/host/exec.bend).

Case 1 runs /bin/sh -c 'echo out-y; echo err-y >&2; exit 3': the
captured stdout is "out-y\n", the status line carries exit 3, and the
caller-named stderr path records "err-y\n" verbatim. Case 2 refuses
the empty-name env entry with EINVAL. Build the program first with the
native test gate,

    sh bend2/scripts/build-native.sh bend2/test/exec-capture.bend SCRATCH/exec-capture

then run

    python3 bend2/test/exec-capture.py SCRATCH/exec-capture
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: exec-capture.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"exec-capture.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-exec-capture-"))
    try:
        run = subprocess.run(
            [str(program)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"exec-capture.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        failures = []
        one = (root / "results-x1").read_text(encoding="utf-8")
        if one != "exit 3\nout-y\n":
            failures.append(f"results-x1: expected exit-3 capture, got {one!r}")
        two = (root / "results-x2").read_text(encoding="utf-8")
        if two != "fail:22\n":
            failures.append(f"results-x2: expected fail:22, got {two!r}")
        errfile = root / "captured-err"
        if not errfile.exists() or errfile.read_text(encoding="utf-8") != "err-y\n":
            failures.append("results-x1: captured stderr missing or wrong")
        if failures:
            for failure in failures:
                print("exec-capture.py: " + failure, file=sys.stderr)
            return 1
        print("exec-capture.py: capture vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
