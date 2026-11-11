#!/usr/bin/env python3
"""Acquire a lane continuation gate and launch the selected immutable runtime."""
import argparse
import fcntl
import os
from pathlib import Path
import re
import sys
import time

import runtime_selection


def gate_path(root, lane):
    if not re.fullmatch(r"[A-Za-z0-9_-]+", lane):
        raise ValueError("Invalid lane name")
    directory = Path(root).resolve() / "continuation-gates"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / (lane + ".lock")
    if path.is_symlink():
        raise ValueError("Continuation gate must not be a symlink")
    return path


def acquire_shared(root, lane):
    path = gate_path(root, lane)
    flags = os.O_CREAT | os.O_RDWR
    if hasattr(os, "O_CLOEXEC"):
        flags |= os.O_CLOEXEC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    hold = path.with_name(lane + ".hold.json")
    while True:
        if hold.is_symlink():
            raise ValueError("Continuation hold must not be a symlink")
        if hold.exists():
            time.sleep(1)
            continue
        descriptor = os.open(path, flags, 0o600)
        fcntl.flock(descriptor, fcntl.LOCK_SH)
        if hold.exists():
            os.close(descriptor)
            time.sleep(1)
            continue
        os.set_inheritable(descriptor, True)
        return descriptor


def launch(root, lane, selection=None, releases=None):
    root = Path(root).resolve()
    selection = Path(selection or root / "runtime-selection.json").resolve()
    releases = Path(releases or root / "runtime-releases").resolve()
    selected = runtime_selection.load_selected(selection, releases)
    release_root = Path(selected["release"]["release"])
    target = release_root / "runtime" / "gpu_lane.py"
    if target.is_symlink() or not target.is_file():
        raise ValueError("Selected release has no regular gpu_lane.py entrypoint")
    descriptor = acquire_shared(root, lane)
    argv = [
        sys.executable,
        str(release_root / "runtime" / "runtime_launch.py"),
        "--selection",
        str(selection),
        "--releases",
        str(releases),
        "--",
        "gpu_lane.py",
        lane,
        "work",
    ]
    os.execv(sys.executable, argv)
    return descriptor, argv


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root")
    parser.add_argument("lane")
    parser.add_argument("--selection")
    parser.add_argument("--releases")
    args = parser.parse_args(argv)
    launch(args.root, args.lane, args.selection, args.releases)


if __name__ == "__main__":
    main()
