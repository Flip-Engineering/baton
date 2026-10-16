"""Files.mode and Files.executable vectors (bend2/src/host/files.bend).

The mode effect answers the permission bits as octal text with no
leading zero for files, directories and a 0000 file alike, and keeps
ENOENT for a missing path. The executable effect answers 1 or 0 and
keeps ENOENT for a missing path; a 0000 file refuses X_OK for root and
non-root alike because no execute bit is set anywhere. Root-insensitive
by construction, so no skip logic. Build the program first with the
native test gate,

    sh bend2/scripts/build-native.sh bend2/test/files-metadata.bend SCRATCH/files-metadata

then run

    python3 bend2/test/files-metadata.py SCRATCH/files-metadata
"""
import pathlib
import shutil
import subprocess
import sys
import tempfile

EXPECTED = [
    "ok:644\n",    # mode plain
    "ok:755\n",    # mode runnable
    "ok:0\n",      # mode sealed (0000)
    "ok:755\n",    # mode dir
    "fail:2\n",    # mode missing keeps ENOENT
    "ok:1\n",      # executable runnable
    "ok:0\n",      # executable plain (no x bit for the owner; root agrees)
    "fail:13\n",   # executable sealed (no x bit anywhere, root included)
    "fail:2\n",    # executable missing keeps ENOENT
]


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: files-metadata.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"files-metadata.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-files-metadata-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        (cases / "dir").mkdir()
        plain = cases / "plain"
        plain.write_bytes(b"")
        plain.chmod(0o644)
        runnable = cases / "runnable"
        runnable.write_bytes(b"")
        runnable.chmod(0o755)
        sealed = cases / "sealed"
        sealed.write_bytes(b"")
        sealed.chmod(0o000)
        run = subprocess.run(
            [str(program)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"files-metadata.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        results = (root / "results").read_text(encoding="utf-8")
        actual = results.splitlines(keepends=True)
        if actual != EXPECTED:
            print("files-metadata.py: results differ from expectations")
            print(f"expected: {EXPECTED!r}")
            print(f"actual:   {actual!r}")
            return 1
        print("files-metadata.py: all metadata vectors agree")
        return 0
    finally:
        sealed_path = root / "cases" / "sealed"
        if sealed_path.exists():
            sealed_path.chmod(0o600)
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
