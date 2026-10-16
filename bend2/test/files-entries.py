"""Files.entries vectors (contract in bend2/src/host/files.bend).

Exactly the two pseudo-entries "." and ".." are excluded by the host;
every dot-prefixed name passes. The join is one NUL per name, so a name
containing a newline survives as one entry; an empty directory yields
the empty string; a missing directory keeps its ENOENT cause.
Order is a readdir promise of none, so the driver sorts the splits
before comparing. Build the program first with the native test gate,

    sh bend2/scripts/build-native.sh bend2/test/files-entries.bend SCRATCH/files-entries

then run

    python3 bend2/test/files-entries.py SCRATCH/files-entries
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

EXPECTED_ENTRIES = sorted(["a.txt", "z.txt", ".hidden", "with\nlf.txt"])


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: files-entries.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"files-entries.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-files-entries-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        (cases / "empty-dir").mkdir()
        for name in ("a.txt", "z.txt", ".hidden", "with\nlf.txt"):
            (cases / name).write_bytes(b"")
        run = subprocess.run(
            [str(program)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"files-entries.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        listed = (root / "results-listed").read_text(encoding="utf-8")
        parts = listed.split("\0")
        if sorted(parts[:-1]) != EXPECTED_ENTRIES or parts[-1] != "":
            print("files-entries.py: entry set or NUL join differs")
            print(f"expected: {EXPECTED_ENTRIES!r} + trailing NUL")
            print(f"actual:   {parts!r}")
            return 1
        empty = (root / "results-empty").read_text(encoding="utf-8")
        if empty != "":
            print(f"files-entries.py: empty directory answered {empty!r}")
            return 1
        missing = (root / "results-missing").read_text(encoding="utf-8")
        if missing != "fail:2\n":
            print(f"files-entries.py: missing directory answered {missing!r}")
            return 1
        print("files-entries.py: all entry vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
