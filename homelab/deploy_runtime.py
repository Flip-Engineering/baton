#!/usr/bin/env python3
"""Stage a verified homelab runtime under an immutable release path."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile


RELEASE_SCHEMA = "acp.homelab-runtime-release/v1"


def manifest_digest(records):
    canonical = json.dumps(sorted(records, key=lambda item: item["path"]),
                           sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def stage(source, releases, revision, provenance):
    source = Path(source).resolve()
    releases = Path(releases).resolve()
    manifest = json.loads(Path(provenance).read_text())
    if len(revision) != 40 or any(c not in "0123456789abcdef" for c in revision):
        raise ValueError("Runtime revision must be a full lowercase Git commit SHA")
    for item in manifest["records"]:
        target = source / item["path"]
        if not target.is_file() or sha256(target) != item["tracked_sha256"]:
            raise ValueError("Runtime source hash mismatch: " + item["path"])
    destination = releases / revision
    if destination.exists():
        raise FileExistsError("Release already exists: " + str(destination))
    releases.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix="." + revision + ".", dir=releases))
    try:
        shutil.copytree(source, temporary / "runtime", dirs_exist_ok=True, ignore=shutil.ignore_patterns("__pycache__", "*.py[cod]"))
        shutil.copy2(provenance, temporary / "SOURCE_PROVENANCE.json")
        records = [{"path": item["path"], "tracked_sha256": item["tracked_sha256"]}
                   for item in manifest["records"]]
        files = {}
        for item in manifest["records"]:
            copied = temporary / "runtime" / item["path"]
            if sha256(copied) != item["tracked_sha256"]:
                raise ValueError("Staged runtime hash mismatch: " + item["path"])
            files[item["path"]] = item["tracked_sha256"]
        seal = {
            "schema": RELEASE_SCHEMA,
            "revision": revision,
            "source_commit": revision,
            "provenance_sha256": sha256(temporary / "SOURCE_PROVENANCE.json"),
            "manifest_sha256": manifest_digest(records),
            "files": files,
            "staged_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        (temporary / "RELEASE.json").write_text(json.dumps(seal, indent=2, sort_keys=True) + "\n")
        os.replace(temporary, destination)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return destination


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--releases", required=True)
    parser.add_argument("--revision", required=True)
    parser.add_argument("--provenance", required=True)
    args = parser.parse_args()
    checkout = Path(args.source).resolve().parent.parent
    status = subprocess.check_output(["git", "status", "--porcelain"], cwd=checkout, text=True)
    if status:
        raise ValueError("Runtime source checkout has uncommitted changes")
    actual = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=checkout, text=True).strip()
    if actual != args.revision:
        raise ValueError("Requested runtime revision does not match the source checkout HEAD")
    path = stage(args.source, args.releases, args.revision, args.provenance)
    print(json.dumps({"state": "staged", "revision": args.revision, "path": str(path)}))


if __name__ == "__main__":
    main()
