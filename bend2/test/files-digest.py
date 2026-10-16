"""Files.digest vectors (bend2/src/host/files.bend).

Expected values come from the independent reference implementation
(hashlib) and the standard empty-input constant:

- sha256(b"payload bytes\\n")
- sha256(b"") is e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
- a missing path keeps its ENOENT cause

Build the program first with the native test gate,

    sh bend2/scripts/build-native.sh bend2/test/files-digest.bend SCRATCH/files-digest

then run

    python3 bend2/test/files-digest.py SCRATCH/files-digest
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: files-digest.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"files-digest.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-files-digest-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        source = cases / "source"
        payload = b"payload bytes\n"
        source.write_bytes(payload)
        (cases / "empty").write_bytes(b"")
        import hashlib
        expected_payload = hashlib.sha256(payload).hexdigest()
        expected_empty = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        run = subprocess.run(
            [str(program)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"files-digest.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        failures = []
        one = (root / "results-d1").read_text(encoding="utf-8")
        if one != f"ok:{expected_payload}\n":
            failures.append(f"results-d1: expected ok:{expected_payload}, got {one!r}")
        two = (root / "results-d2").read_text(encoding="utf-8")
        if two != f"ok:{expected_empty}\n":
            failures.append(f"results-d2: expected ok:{expected_empty}, got {two!r}")
        three = (root / "results-d3").read_text(encoding="utf-8")
        if three != "fail:2\n":
            failures.append(f"results-d3: expected fail:2, got {three!r}")
        if failures:
            for failure in failures:
                print("files-digest.py: " + failure, file=sys.stderr)
            return 1
        print("files-digest.py: all digest vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
