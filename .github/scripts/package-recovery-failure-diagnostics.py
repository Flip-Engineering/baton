#!/usr/bin/env python3
"""Persist small, identity-bound recovery failure evidence outside runner temp."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat


RUN_ID = re.compile(r"[0-9]+\Z")
SHA1 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")

RUN_FILES = (
    "build.stdout",
    "build.stderr",
    "queue-selection.txt",
    "queue-client.sha256",
    "queue-bootstrap.stdout",
    "queue-bootstrap.stderr",
    "queue-bootstrap.telemetry",
    "recovery-c-selection.json",
    "selection.stdout",
    "selection.stderr",
    "darwin-c-toolchain.txt",
    "clang.txt",
    "source-commit.txt",
    "source-tree.txt",
    "source-closure.json",
    "source-closure.stdout",
    "output.sha256",
    "toolchain/compiler.sha256",
)

QUEUE_FILES = frozenset(
    {
        "queue-config.json",
        "compile-queue.lock",
        "request.json",
        "receipt",
        "client.stdout",
        "client.stderr",
        "cancel.stdout",
        "cancel.stderr",
        "queue-result",
        "stdout",
        "stderr",
        "meta",
        "command",
        "source-digest",
        "compiler-diagnostics.json",
    }
)


def regular_file(path):
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode)


def queue_tokens(queue_root):
    tokens = set()
    for request_path in queue_root.rglob("request.json"):
        if not regular_file(request_path):
            continue
        try:
            value = json.loads(request_path.read_text())
        except (OSError, ValueError):
            continue
        token = value.get("token") if isinstance(value, dict) else None
        if isinstance(token, str) and token:
            tokens.add(token)
    return tokens


def copy_redacted(source, target, tokens):
    if not regular_file(source):
        return False
    data = source.read_bytes()
    for token in tokens:
        data = data.replace(token.encode("utf-8"), b"[redacted-queue-owner-token]")
    target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    target.write_bytes(data)
    target.chmod(0o600)
    return True


def sha256_file(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def package(run_root, destination_root, proof_path, run_id, attempt, source_sha, proof_sha256):
    if not RUN_ID.fullmatch(run_id) or not RUN_ID.fullmatch(attempt):
        raise ValueError("run id and attempt must contain decimal digits")
    if not SHA1.fullmatch(source_sha) or not SHA256.fullmatch(proof_sha256):
        raise ValueError("source and proof identities must be lowercase hexadecimal digests")

    run_root = Path(run_root)
    destination_root = Path(destination_root)
    destination_root.mkdir(parents=True, exist_ok=True, mode=0o700)
    if destination_root.is_symlink() or not destination_root.is_dir():
        raise ValueError("diagnostics root must be a real directory")
    if destination_root.stat().st_uid != os.getuid():
        raise ValueError("diagnostics root must belong to the runner user")
    destination_root.chmod(0o700)

    destination = destination_root / (run_id + "-" + attempt)
    destination.mkdir(mode=0o700)
    tokens = queue_tokens(run_root / "queue-run")
    captured = {}
    missing = []

    sources = [(run_root / name, Path(name)) for name in RUN_FILES]
    sources.append((Path(proof_path), Path("recovery-c-reuse.json")))
    for source, relative in sources:
        target = destination / relative
        if copy_redacted(source, target, tokens):
            captured[relative.as_posix()] = {
                "bytes": target.stat().st_size,
                "sha256": sha256_file(target),
            }
        else:
            missing.append(relative.as_posix())

    queue_root = run_root / "queue-run"
    queue_evidence_copied = False
    if queue_root.is_dir() and not queue_root.is_symlink():
        for source in sorted(queue_root.rglob("*")):
            if source.name not in QUEUE_FILES or not regular_file(source):
                continue
            relative = Path("queue-run") / source.relative_to(queue_root)
            target = destination / relative
            if copy_redacted(source, target, tokens):
                queue_evidence_copied = True
                captured[relative.as_posix()] = {
                    "bytes": target.stat().st_size,
                    "sha256": sha256_file(target),
                }

    selection = {}
    selection_path = destination / "recovery-c-selection.json"
    if selection_path.is_file():
        try:
            selection = json.loads(selection_path.read_text())
        except (OSError, ValueError):
            selection = {}

    observed_source_sha = None
    source_path = destination / "source-commit.txt"
    if source_path.is_file():
        observed_source_sha = source_path.read_text().strip()

    observed_proof_sha256 = None
    saved_proof = destination / "recovery-c-reuse.json"
    if saved_proof.is_file():
        observed_proof_sha256 = sha256_file(saved_proof)

    closure_count = None
    closure_path = destination / "source-closure.json"
    if closure_path.is_file():
        try:
            closure_count = len(json.loads(closure_path.read_text()).get("files", []))
        except (OSError, ValueError, TypeError):
            closure_count = None

    manifest = {
        "schema": "baton2-recovery-failure-evidence-v1",
        "run_id": run_id,
        "run_attempt": attempt,
        "source_commit_expected": source_sha,
        "source_commit_observed": observed_source_sha,
        "source_closure_file_count": closure_count,
        "proof_sha256_expected": proof_sha256,
        "proof_sha256_observed": observed_proof_sha256,
        "proof_matches_expected": observed_proof_sha256 == proof_sha256,
        "selected_c_sha256": selection.get("selected_c_sha256"),
        "queue_owner_tokens_redacted": len(tokens),
        "queue_evidence_copied": queue_evidence_copied,
        "captured_files": captured,
        "missing_files": missing,
    }
    manifest_path = destination / "diagnostics-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n")
    manifest_path.chmod(0o600)
    return destination


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--run-root", required=True)
    parser.add_argument("--destination-root", required=True)
    parser.add_argument("--proof", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--attempt", required=True)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--proof-sha256", required=True)
    args = parser.parse_args()
    destination = package(
        args.run_root,
        args.destination_root,
        args.proof,
        args.run_id,
        args.attempt,
        args.source_sha,
        args.proof_sha256,
    )
    print("persistent_recovery_diagnostics=" + str(destination))


if __name__ == "__main__":
    main()
