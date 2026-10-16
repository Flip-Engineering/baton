"""Files.copy and Files.which vectors (bend2/src/host/files.bend).

PATH for the program is <root>/bin:<root>/plain so which() finds
probe-exec in the first entry; probe-plain exists only in the second as
a 0644 regular file, so the name is present but not executable and the
effect refuses EACCES; no-such-tool exists nowhere and the effect
answers the empty string. Copy preserves bytes and permission bits,
keeps ENOENT for a missing source and for an unwritable destination
directory. All fixtures are root-insensitive. Build the program first,

    sh bend2/scripts/build-native.sh bend2/test/files-path.bend SCRATCH/files-path

then run

    python3 bend2/test/files-path.py SCRATCH/files-path
"""
import os
import pathlib
import shutil
import stat
import subprocess
import sys
import tempfile


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: files-path.py PROGRAM", file=sys.stderr)
        return 2
    program = pathlib.Path(sys.argv[1]).resolve()
    if not program.exists():
        print(f"files-path.py: missing program {program}", file=sys.stderr)
        return 2
    root = pathlib.Path(tempfile.mkdtemp(prefix="baton-files-path-"))
    try:
        cases = root / "cases"
        cases.mkdir()
        source = cases / "source"
        source.write_bytes(b"payload bytes\n")
        source.chmod(0o640)
        os.link(source, cases / "alias-hard")
        os.symlink(source, cases / "alias-sym")
        (cases / "dir").mkdir()
        dest_full = cases / "dest-full"
        dest_full.write_bytes(b"existing\n")
        dest_full.chmod(0o600)
        os.mkfifo(cases / "pipe")
        runme = cases / "runme"
        runme.write_bytes(b"run\n")
        runme.chmod(0o755)
        bindir = root / "bin"
        plaindir = root / "plain"
        bindir.mkdir()
        plaindir.mkdir()
        executable = bindir / "probe-exec"
        executable.write_bytes(b"")
        executable.chmod(0o755)
        plain = plaindir / "probe-plain"
        plain.write_bytes(b"")
        plain.chmod(0o644)
        parent = dict(os.environ)
        parent["PATH"] = f"{bindir}:{plaindir}"
        run = subprocess.run(
            [str(program)],
            cwd=root,
            env=parent,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if run.returncode != 0:
            print(f"files-path.py: program exited {run.returncode}: "
                  + run.stderr.decode("utf-8", "replace"), file=sys.stderr)
            return 1
        failures = []

        def check(name, expected):
            actual = (root / name).read_text(encoding="utf-8")
            if actual != expected:
                failures.append(f"{name}: expected {expected!r}, got {actual!r}")

        check("results-we", f"ok:{bindir / 'probe-exec'}\n")
        check("results-wn", "fail:13\n")
        check("results-wa", "ok:\n")
        check("results-c1", "ok:\n")
        check("results-c2", "ok:payload bytes\n")
        check("results-c3", "ok:640\n")
        check("results-c4", "fail:2\n")
        check("results-c5", "fail:2\n")
        # Alias refusals: same-inode copies fail with EINVAL (22) and the
        # original bytes and mode survive.
        check("results-c6", "fail:22\n")
        check("results-c7", "fail:22\n")
        check("results-c8", "fail:22\n")
        # A directory source fails with EISDIR (21) and the existing
        # destination is preserved; a writerless FIFO fails with EINVAL (22)
        # without waiting for a writer.
        check("results-c9", "fail:21\n")
        check("results-c10", "fail:22\n")
        # A distinct regular copy keeps its executable mode.
        check("results-c11", "ok:\n")
        check("results-c12", "ok:755\n")
        check("results-c13", "ok:payload bytes\n")
        check("results-c14", "ok:existing\n")
        check("results-c15", "ok:640\n")
        # A writerless destination FIFO refuses without touching either
        # side: the open fails ENXIO under O_NONBLOCK, so the source
        # keeps its bytes and the path stays a FIFO.
        check("results-c16", "fail:6\n")
        if (root / "cases/source").read_bytes() != b"payload bytes\n":
            failures.append("results-c16: source bytes did not survive")
        if not stat.S_ISFIFO(os.stat(root / "cases/pipe").st_mode):
            failures.append("results-c16: destination did not stay a FIFO")
        if failures:
            for failure in failures:
                print("files-path.py: " + failure, file=sys.stderr)
            return 1
        print("files-path.py: all copy and which vectors agree")
        return 0
    finally:
        shutil.rmtree(root, ignore_errors=True)


if __name__ == "__main__":
    raise SystemExit(main())
