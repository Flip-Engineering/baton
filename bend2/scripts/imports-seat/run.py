#!/usr/bin/env python3
"""Push one immutable source archive to the validation runner and compile it there.

Usage: run.py <label> <module,module,...> [--commit <rev>]

The archive is `git archive` of the given revision (default HEAD), so the
recorded revision and the archive digest identify exactly what was compiled.
"""

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

HOST = "atari-homelab"
REMOTE_ROOT = Path("/home/atari2036/baton-imports-deepseek-20261006")
REPO = Path(__file__).resolve().parents[2]  # unused; set from --cwd
LOCAL_STAGE = Path("/tmp/baton-ds-imports/stage")


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("label")
    parser.add_argument("modules")
    parser.add_argument("--rev", default="HEAD")
    parser.add_argument("--cwd", required=True)
    parser.add_argument("--probe", default=None)
    args = parser.parse_args()

    cwd = Path(args.cwd).resolve()
    label_dir = LOCAL_STAGE / args.label
    label_dir.mkdir(parents=True, exist_ok=True)
    archive = label_dir / "source.tar.gz"

    rev = subprocess.run(["git", "rev-parse", args.rev], cwd=cwd, check=True,
                         stdout=subprocess.PIPE).stdout.decode().strip()
    with open(archive, "wb") as handle:
        subprocess.run(["git", "archive", "--format=tar.gz", "-9",
                        "--prefix=source/", rev],
                       cwd=cwd, check=True, stdout=handle)
    digest = sha256_file(archive)
    print(f"revision {rev}\narchive {archive}\nsha256 {digest}")

    remote_dir = REMOTE_ROOT / args.label
    subprocess.run(["ssh", HOST, f"mkdir -p {remote_dir}"], check=True)
    subprocess.run(["scp", "-q", str(archive), f"{HOST}:{remote_dir}/source.tar.gz"],
                   check=True)
    subprocess.run(["scp", "-q", str(Path(__file__).parent / "remote_run.py"),
                    f"{HOST}:{remote_dir}/remote_run.py"], check=True)
    if args.probe:
        subprocess.run(["scp", "-q", args.probe, f"{HOST}:{remote_dir}/probe.bend"],
                       check=True)

    proc = subprocess.run(
        ["ssh", HOST,
         f"cd {remote_dir} && python3 remote_run.py {remote_dir} '{args.modules}'"],
        stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(proc.stdout.decode())
    print(f"\nremote evidence: {remote_dir}/evidence.json")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
