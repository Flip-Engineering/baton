#!/usr/bin/env python3
"""Stage the Bend2 logs-clean-all helper into a source-pinned release directory."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ENTRY = "bend2/src/coordinator/logs-clean-all-focused.bend"
RELEASE_SCHEMA = "baton2-logs-clean-all-release-v1"


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def tool_record(path, name):
    path = Path(path).resolve(strict=True)
    require(path.is_file() and os.access(path, os.X_OK), name + " must be an executable file")
    version = subprocess.run([str(path), "--version"], text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, check=False, timeout=10).stdout.strip()
    return {"path": str(path), "sha256": sha256(path), "version": version}


def source_record(root, expected_commit):
    root = Path(root).resolve(strict=True)
    commit = git(root, "rev-parse", "HEAD")
    require(re.fullmatch(r"[0-9a-f]{40}", expected_commit or "") is not None,
            "source commit must be a full lowercase Git object name")
    require(commit == expected_commit, "source HEAD does not match the requested commit")
    status = git(root, "status", "--porcelain=v1", "--untracked-files=all")
    require(status == "", "source tree must be clean before staging")
    tree = git(root, "rev-parse", commit + "^{tree}")
    entry = root / ENTRY
    require(entry.is_file() and not entry.is_symlink(), "the committed helper entry is missing or a symlink")
    committed_entry = subprocess.check_output(["git", "-C", str(root), "show", commit + ":" + ENTRY])
    entry_bytes = entry.read_bytes()
    require(entry_bytes == committed_entry, "helper entry bytes differ from the pinned commit")
    return {
        "repository": str(root),
        "commit": commit,
        "tree": tree,
        "entry": ENTRY,
        "entry_sha256": hashlib.sha256(entry_bytes).hexdigest(),
    }


def stage(binary, bend, clang, source_root, source_commit, destination):
    binary = Path(binary).resolve(strict=True)
    require(binary.is_file() and os.access(binary, os.X_OK), "helper binary must be executable")
    source = source_record(source_root, source_commit)
    bend_record = tool_record(bend, "Bend compiler")
    clang_record = tool_record(clang, "C compiler")
    destination = Path(destination).absolute()
    require(not destination.exists(), "release destination already exists")
    parent = destination.parent
    parent.mkdir(parents=True, exist_ok=True)
    stage_dir = Path(tempfile.mkdtemp(prefix="." + destination.name + ".stage-", dir=parent))
    try:
        helper_dir = stage_dir / "libexec" / "baton2"
        helper_dir.mkdir(parents=True)
        helper = helper_dir / "logs-clean-all"
        shutil.copyfile(binary, helper)
        helper.chmod(0o755)
        manifest = {
            "schema": RELEASE_SCHEMA,
            "created_at": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
            "source": source,
            "build": {
                "entry": ENTRY,
                "command": ["sh", "bend2/scripts/build-native.sh", ENTRY,
                            ".scratch/bend2/logs-clean-all-focused"],
                "bend": bend_record,
                "clang": clang_record,
                "helper_sha256": sha256(helper),
                "helper_size_bytes": helper.stat().st_size,
            },
            "command": {
                "path": "libexec/baton2/logs-clean-all",
                "arguments": ["DATABASE"],
                "behavior": "Calls Bend2 Logs.clean_all for registered sessions and writes its JSON result to stdout.",
            },
        }
        manifest_path = stage_dir / "logs-clean-all-manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        sums = {
            "libexec/baton2/logs-clean-all": sha256(helper),
            "logs-clean-all-manifest.json": sha256(manifest_path),
        }
        (stage_dir / "SHA256SUMS").write_text(
            "".join(value + "  " + name + "\n" for name, value in sorted(sums.items())))
        receipt = {
            "schema": "baton2-logs-clean-all-stage-receipt-v1",
            "release": str(destination),
            "source": source,
            "manifest_sha256": sha256(manifest_path),
            "helper_sha256": sha256(helper),
            "helper_size_bytes": helper.stat().st_size,
        }
        receipt_path = stage_dir / "stage-receipt.json"
        receipt_path.write_text(json.dumps(receipt, indent=2, ensure_ascii=False) + "\n")
        sums["stage-receipt.json"] = sha256(receipt_path)
        (stage_dir / "SHA256SUMS").write_text(
            "".join(value + "  " + name + "\n" for name, value in sorted(sums.items())))
        # The complete directory appears at its immutable name in one rename.
        os.rename(stage_dir, destination)
        return receipt
    except BaseException:
        shutil.rmtree(stage_dir, ignore_errors=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--binary", required=True, type=Path, help="compiled focused Bend2 helper")
    parser.add_argument("--bend", required=True, type=Path, help="pinned Bend compiler executable")
    parser.add_argument("--clang", required=True, type=Path, help="pinned C compiler executable")
    parser.add_argument("--source-root", required=True, type=Path, help="clean Git checkout used for the build")
    parser.add_argument("--source-commit", required=True, help="full Git commit used for the build")
    parser.add_argument("--destination", required=True, type=Path, help="new immutable release directory")
    args = parser.parse_args()
    try:
        result = stage(args.binary, args.bend, args.clang, args.source_root,
                       args.source_commit, args.destination)
        print(json.dumps({"status": "staged", **result}, sort_keys=True))
    except (OSError, subprocess.SubprocessError, RuntimeError, ValueError) as error:
        parser.exit(2, "stage-logs-clean-all: " + str(error) + "\n")


if __name__ == "__main__":
    main()
