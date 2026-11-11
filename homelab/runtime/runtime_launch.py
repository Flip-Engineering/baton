"""Launch a job runtime from the verified selected immutable release.

This is the future-launch entrypoint. It resolves and re-validates the tracked
selection before executing the selected release; it does not stop, restart or
signal any active farm process or service.
"""
import argparse
import json
import os
from pathlib import Path
import sys
import uuid

import runtime_selection


def resolve(selection=None, releases=None):
    loaded = runtime_selection.load_selected(selection, releases)
    return loaded


def launch_receipt(loaded, entrypoint, command, receipts=None, argv=None):
    release = loaded["release"]
    receipt = {
        "schema": "acp.homelab-runtime-launch/v1",
        "generation": loaded["selection"]["generation"],
        "revision": release["revision"],
        "release": str(release["release"]),
        "release_seal_sha256": release["seal_sha256"],
        "provenance_sha256": release["provenance_sha256"],
        "selection": str(loaded["selection_path"]),
        "entrypoint": entrypoint,
        "argv": list(argv or command),
        "launched_at": runtime_selection.now(),
        "launcher_pid": os.getpid(),
        "service_restarted": False,
        "active_processes_modified": False,
    }
    directory = Path(receipts or Path(loaded["selection_path"]).parent / "runtime-launch-receipts")
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"{receipt['generation']:04d}-{release['revision']}-{os.getpid()}-{uuid.uuid4().hex}.json"
    runtime_selection.atomic_write(path, json.dumps(receipt, indent=2, sort_keys=True) + "\n", overwrite=False)
    return path, receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--selection")
    parser.add_argument("--releases")
    parser.add_argument("--receipts")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        parser.error("A runtime command is required after --")
    entrypoint = command[0]
    if Path(entrypoint).name != entrypoint or entrypoint.startswith("."):
        parser.error("Runtime entrypoint must be a plain filename inside the release")
    loaded = resolve(args.selection, args.releases)
    target = Path(loaded["release"]["release"]) / "runtime" / entrypoint
    if target.is_symlink() or not target.is_file():
        parser.error("Selected release does not contain " + entrypoint)
    receipt_path, receipt = launch_receipt(loaded, entrypoint, command, args.receipts)
    if args.dry_run:
        print(json.dumps({"entrypoint": str(target), "receipt": str(receipt_path), "launch": receipt}, indent=2, sort_keys=True))
        return
    os.execv(sys.executable, [sys.executable, str(target), *command[1:]])


if __name__ == "__main__":
    main()
