"""U1 Text.read native-backend vectors (spec commit 2036666).

Prepares the fixture workspace, runs the compiled text-read.bend program
with the vector 5 payload on stdin, and compares the results file with
independent hardcoded expectations. Build the program first with the
native test gate, for example

    sh bend2/scripts/build-native.sh bend2/test/text-read.bend SCRATCH/text-read

then run

    python3 bend2/test/text-read.py SCRATCH/text-read

As root both backends read a 000 file, so vector 7 expects success there;
vector 2 stays the root-proof refusal.
"""
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile

PAYLOAD = "caf\u00e9 \u03bb\n"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: text-read.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"text-read.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-text-read-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        # 0x41 'A'; 0xC0 invalid lead; 0xAF orphan continuation;
        # 0xE2 0x82 truncated sequence: one U+FFFD each.
        (cases / "utf8").write_bytes(b"\x41\xc0\xaf\xe2\x82")
        (cases / "empty").write_bytes(b"")
        locked = cases / "locked"
        locked.write_bytes(b"secret")
        locked.chmod(0o000)
        run = subprocess.run(
            [str(program)],
            cwd=root,
            input=PAYLOAD.encode("utf-8"),
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"text-read.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        results = (root / "results").read_bytes().decode("utf-8")
        privileged = hasattr(os, "geteuid") and os.geteuid() == 0
        expected = "".join([
            "fail:2\n",
            "fail:21\n",
            "fail:22\n",
            "ok:A\uFFFD\uFFFD\uFFFD\n",
            f"ok:{PAYLOAD}\n",
            "ok:\n",
            "ok:secret\n" if privileged else "fail:13\n",
        ])
        if results != expected:
            print("text-read.py: results differ from the independent expectations")
            print("--- expected ---")
            print(expected)
            print("--- actual ---")
            print(results)
            return 1
        print("text-read.py: all seven vectors agree")
        return 0
    finally:
        locked_path = root / "cases" / "locked"
        if locked_path.exists():
            locked_path.chmod(0o600)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
