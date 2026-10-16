"""Files.open/read_chunk/close and the pure Bend2 SHA-256 composition
vectors (bend2/src/context/sha256.bend, frozen API in
rewrite-native/byte-digest-api.md).

The binary fixture is 200 bytes of (i*7+3) % 256: two full 128-byte
chunks and a 72-byte end-of-file chunk, crossing block and chunk
boundaries at once, with NUL and invalid UTF-8 sequences present as
plain values. Expected digests come from the independent hashlib
oracle. Refusal causes stay exact: ENOENT for a missing path, EISDIR
for a directory, ESTALE for a read past close, EBADF for a double
close. Build the program first with the native test gate,

    sh bend2/scripts/build-native.sh bend2/test/files-bytes.bend SCRATCH/files-bytes

then run

    python3 bend2/test/files-bytes.py SCRATCH/files-bytes
"""
import hashlib
import pathlib
import shutil
import subprocess
import sys
import tempfile

payload = bytes((i * 7 + 3) % 256 for i in range(200))


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: files-bytes.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"files-bytes.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-files-bytes-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        (cases / "binary").write_bytes(payload)
        (cases / "empty").write_bytes(b"")
        (cases / "dir").mkdir()
        run = subprocess.run(
            [str(program)],
            cwd=root,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"files-bytes.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        failures = []
        one = (root / "results-b1").read_text(encoding="utf-8")
        expected_one = f"ok:{hashlib.sha256(payload).hexdigest()}\n"
        if one != expected_one:
            failures.append(f"results-b1: expected {expected_one!r}, got {one!r}")
        two = (root / "results-b2").read_text(encoding="utf-8")
        expected_two = f"ok:{hashlib.sha256(b'').hexdigest()}\n"
        if two != expected_two:
            failures.append(f"results-b2: expected {expected_two!r}, got {two!r}")
        three = (root / "results-b3").read_text(encoding="utf-8")
        if three != "fail:2\n":
            failures.append(f"results-b3: expected fail:2, got {three!r}")
        four = (root / "results-b4").read_text(encoding="utf-8")
        if four != "fail:21\n":
            failures.append(f"results-b4: expected fail:21, got {four!r}")
        five = (root / "results-b5").read_text(encoding="utf-8")
        if five != "fail:116\n":
            failures.append(f"results-b5: expected fail:116 (ESTALE), got {five!r}")
        six = (root / "results-b6").read_text(encoding="utf-8")
        if six != "fail:9\n":
            failures.append(f"results-b6: expected fail:9 (EBADF), got {six!r}")
        if failures:
            for failure in failures:
                print("files-bytes.py: " + failure, file=sys.stderr)
            return 1
        print("files-bytes.py: all byte-composition vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
