#!/usr/bin/env python3
"""Push one immutable archive to the runner and run the codec lane collector.

Usage: run_collector.py <label> --cwd <repo> [--rev <rev>]
"""

import argparse
import hashlib
import subprocess
import sys
from pathlib import Path

HOST = "atari-homelab"
REMOTE_ROOT = Path("/home/atari2036/baton-imports-deepseek-20261006")
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
    parser.add_argument("--rev", default="HEAD")
    parser.add_argument("--cwd", required=True)
    args = parser.parse_args()

    cwd = Path(args.cwd).resolve()
    label_dir = LOCAL_STAGE / args.label
    label_dir.mkdir(parents=True, exist_ok=True)
    archive = label_dir / "source.tar.gz"
    rev = subprocess.run(["git", "rev-parse", args.rev], cwd=cwd, check=True,
                         stdout=subprocess.PIPE).stdout.decode().strip()
    with open(archive, "wb") as handle:
        subprocess.run(["git", "archive", "--format=tar.gz", "-9",
                        "--prefix=source/", rev], cwd=cwd, check=True, stdout=handle)
    print(f"revision {rev}\narchive {archive}\nsha256 {sha256_file(archive)}")

    remote_dir = REMOTE_ROOT / args.label
    subprocess.run(["ssh", HOST, f"rm -rf {remote_dir} && mkdir -p {remote_dir}"], check=True)
    subprocess.run(["scp", "-q", str(archive), f"{HOST}:{remote_dir}/source.tar.gz"], check=True)
    subprocess.run(["scp", "-q", str(Path(__file__).parent / "remote_run_collector.py"),
                    f"{HOST}:{remote_dir}/remote_run_collector.py"], check=True)
    proc = subprocess.run(["ssh", HOST,
                           f"cd {remote_dir} && python3 remote_run_collector.py {remote_dir}"],
                          stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    print(proc.stdout.decode())
    print(f"\nremote evidence: {remote_dir}/evidence.json")
    return proc.returncode


if __name__ == "__main__":
    sys.exit(main())
