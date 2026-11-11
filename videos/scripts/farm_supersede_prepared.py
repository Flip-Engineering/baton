#!/usr/bin/env python3
"""Hold and supersede a prepared homelab render after its source pin is corrected."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone

SHA = re.compile(r"^[0-9a-f]{40}$")
JOB_ID = re.compile(r"^[A-Za-z0-9_-]+$")


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def digest_file(path):
    h = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    except BaseException:
        try:
            os.unlink(name)
        except FileNotFoundError:
            pass
        raise


def load_json(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError("expected a regular file: " + str(path))
    return json.loads(path.read_text())


def job_path(root, job_id, queue):
    if not JOB_ID.fullmatch(job_id):
        raise ValueError("invalid local job ID")
    root = Path(root).resolve(strict=True)
    queue_path = (root / queue).resolve(strict=True)
    if root not in queue_path.parents or queue_path.name != "jobs":
        raise ValueError("queue path must be jobs or lanes/<lane>/jobs under the farm root")
    path = queue_path / job_id
    if not path.is_dir() or path.is_symlink():
        raise ValueError("local job directory does not exist or is unsafe")
    path = path.resolve(strict=True)
    if root not in path.parents:
        raise ValueError("job path escapes the configured farm root")
    return root, path


@contextmanager
def worker_lock(root, job):
    lane = job.parent.parent.name if job.parent.parent.parent.name == "lanes" else "gpu0"
    lock_path = root / "lanes" / lane / "worker.lock" if lane != "gpu0" else root / "worker.lock"
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0)
    fd = os.open(lock_path, flags, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError("lane worker owns the queue; prepared job cannot be held safely") from error
        yield
    finally:
        os.close(fd)

def lineage(job, request, prepared, status):
    files = {}
    for name in ("request.json", "prepared.json", "dependencies.json", "receipt.json", "pictured.json"):
        path = job / name
        if path.is_file() and not path.is_symlink():
            files[name] = {"sha256": digest_file(path), "bytes": path.stat().st_size}
    out = job / "out"
    if out.is_dir() and not out.is_symlink():
        for path in sorted(out.rglob("*")):
            rel = path.relative_to(job).as_posix()
            if path.is_symlink():
                files[rel] = {"symlink": os.readlink(path)}
            elif path.is_file():
                files[rel] = {"sha256": digest_file(path), "bytes": path.stat().st_size}
    return {"job_id": job.name, "old_commit": request.get("commit"),
            "protocol_id": request.get("protocol_id"),
            "original_status": status,
            "request": request, "prepared_commit": prepared.get("commit"),
            "files": files}


def running_containers(job_id, docker="docker"):
    result = subprocess.run([docker, "ps", "--format", "{{.Names}}"],
                            capture_output=True, text=True, timeout=15)
    if result.returncode:
        raise RuntimeError("cannot verify active render containers: " + result.stderr.strip())
    prefix = "acp-" + job_id + "-"
    return [name for name in result.stdout.splitlines() if name.startswith(prefix)]


def hold_prepared(root, queue, job_id, reason, *, docker="docker", containers=None):
    if not reason.strip():
        raise ValueError("a source-correction reason is required")
    root, job = job_path(root, job_id, queue)
    status_path = job / "status.json"
    with worker_lock(root, job):
        status = load_json(status_path)
        request = load_json(job / "request.json")
        prepared = load_json(job / "prepared.json")
        if status.get("state") in ("supersession_held", "superseded"):
            embedded = status.get("supersession", {}).get("record")
            record_path = job / "supersession.json"
            existing = load_json(record_path) if record_path.exists() else embedded
            if not existing or existing.get("state") not in ("held", "superseded"):
                raise ValueError("existing supersession record is incomplete; inspect it")
            if not record_path.exists():
                atomic_json(record_path, existing)
            return existing
        return _hold_prepared_locked(root, job_id, job, reason, status, request, prepared, docker, containers)

def _hold_prepared_locked(root, job_id, job, reason, status, request, prepared, docker, containers):
    status_path = job / "status.json"
    if status.get("state") != "prepared" or status.get("phase") != "ready":
        raise ValueError("only a prepared, ready job can be superseded")
    if not SHA.fullmatch(str(request.get("commit", ""))) or prepared.get("commit") != request["commit"]:
        raise ValueError("prepared source pin does not match its request")
    if prepared.get("request") != request:
        raise ValueError("prepared request differs from the durable request")
    if request.get("protocol_id") and request.get("protocol_spec", {}).get("pipeline_commit") != request.get("commit"):
        raise ValueError("canonical protocol recipe pin differs from the prepared pin")
    if (job / "admission.json").exists():
        raise ValueError("job has an admission owner marker")
    if (job / "stage-recovery-hold.json").exists():
        raise ValueError("job already has a stage recovery hold")
    active = running_containers(job_id, docker=docker) if containers is None else list(containers)
    if active:
        raise ValueError("active render container owns job: " + ", ".join(active))

    retained = lineage(job, request, prepared, status)
    hold_id = digest_bytes((job_id + "\0" + request["commit"] + "\0" + reason).encode())[:24]
    record = {"version": 1, "state": "held", "hold_id": hold_id,
              "reason": reason, "held_at": None, "farm_root": str(root),
              "job_path": str(job), "lineage": retained}
    record["held_at"] = datetime.now(timezone.utc).isoformat()
    held_status = dict(status, state="supersession_held", phase="supersession",
                       supersession={"hold_id": hold_id, "reason": reason,
                                     "original_status": status,
                                     "lineage_sha256": digest_bytes(json.dumps(retained, sort_keys=True).encode()),
                                     "record": record})
    # The worker selects only state=prepared. This atomic status write excludes
    # the job while retaining its prior status, request, prepared tree and outputs.
    atomic_json(status_path, held_status)
    atomic_json(job / "supersession.json", record)
    return record


def validate_replacement(record, replacement):
    lineage_data = record["lineage"]
    old_request = lineage_data["request"]
    spec = old_request.get("protocol_spec")
    if not spec or not old_request.get("protocol_id"):
        raise ValueError("prepared job lacks a canonical pipeline recipe")
    if replacement.get("retry_of") != old_request["protocol_id"]:
        raise ValueError("replacement does not retry the superseded protocol job")
    if not SHA.fullmatch(str(replacement.get("pipeline_commit", ""))):
        raise ValueError("replacement must pin a full commit SHA")
    if replacement["pipeline_commit"] == old_request["commit"]:
        raise ValueError("replacement must use a different source pin")
    if replacement.get("run") != spec.get("run"):
        raise ValueError("replacement run recipe differs from the prepared job")
    if replacement.get("dependencies", {}) != spec.get("dependencies", {}):
        raise ValueError("replacement dependencies differ from the prepared job")
    if replacement.get("outputs", []) != spec.get("outputs", []):
        raise ValueError("replacement output contract differs from the prepared job")
    if not JOB_ID.fullmatch(str(replacement.get("id", ""))):
        raise ValueError("replacement has an invalid pipeline job ID")
    return {"id": replacement["id"], "pipeline_commit": replacement["pipeline_commit"],
            "retry_of": replacement["retry_of"], "run": replacement["run"],
            "dependencies": replacement.get("dependencies", {}),
            "outputs": replacement.get("outputs", [])}


def complete_supersession(root, queue, job_id, replacement_id, replacement_commit,
                          *, queue_cli, python="python3"):
    root, job = job_path(root, job_id, queue)
    status_path = job / "status.json"
    status = load_json(status_path)
    record_path = job / "supersession.json"
    record = load_json(record_path) if record_path.exists() else status.get("supersession", {}).get("record")
    if not record:
        raise ValueError("held job has no recoverable supersession record")
    if status.get("state") == "superseded":
        embedded = status.get("supersession", {}).get("record")
        if embedded:
            if (embedded.get("replacement", {}).get("id") != replacement_id or
                    embedded.get("replacement", {}).get("pipeline_commit") != replacement_commit):
                raise ValueError("job is already linked to a different replacement")
            if not (job / "supersession.json").exists():
                atomic_json(job / "supersession.json", embedded)
            return embedded
    if status.get("state") != "supersession_held" or record.get("state") not in ("held", "superseded"):
        raise ValueError("job is not held for supersession")
    hold = status.get("supersession", {})
    lineage_sha = digest_bytes(json.dumps(record.get("lineage"), sort_keys=True).encode())
    if hold.get("hold_id") != record.get("hold_id") or hold.get("lineage_sha256") != lineage_sha:
        raise ValueError("held-job provenance does not match its supersession record")
    if not JOB_ID.fullmatch(replacement_id) or not SHA.fullmatch(replacement_commit):
        raise ValueError("replacement ID and full commit SHA are required")
    if record.get("replacement"):
        if record["replacement"]["id"] != replacement_id or record["replacement"]["pipeline_commit"] != replacement_commit:
            raise ValueError("held job is already linked to a different replacement")
        return record
    result = subprocess.run([python, str(queue_cli), "show", replacement_id],
                            capture_output=True, text=True, timeout=60)
    if result.returncode:
        raise RuntimeError("replacement queue lookup failed: " + result.stderr.strip())
    replacement = json.loads(result.stdout)
    if replacement.get("pipeline_commit") != replacement_commit:
        raise ValueError("replacement queue pin differs from the requested commit")
    linked = validate_replacement(record, replacement)
    for rel, expected in record["lineage"]["files"].items():
        path = job / rel
        if "symlink" in expected:
            if not path.is_symlink() or os.readlink(path) != expected["symlink"]:
                raise ValueError("retained lineage changed: " + rel)
        elif not path.is_file() or path.is_symlink() or path.stat().st_size != expected["bytes"] or digest_file(path) != expected["sha256"]:
            raise ValueError("retained lineage changed: " + rel)
    record.update(state="superseded", superseded_at=datetime.now(timezone.utc).isoformat(), replacement=linked)
    new_status = dict(status, state="superseded", phase="superseded",
                      supersession=dict(status["supersession"], replacement=linked, record=record))
    atomic_json(status_path, new_status)
    atomic_json(job / "supersession.json", record)
    return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    hold = sub.add_parser("hold", help="exclude one prepared stale-source job from dispatch")
    hold.add_argument("--root", required=True)
    hold.add_argument("--queue", required=True, help="jobs or lanes/<lane>/jobs")
    hold.add_argument("--job", required=True)
    hold.add_argument("--reason", required=True)
    complete = sub.add_parser("complete", help="link a prepared hold to its canonical replacement job")
    complete.add_argument("--root", required=True)
    complete.add_argument("--queue", required=True, help="jobs or lanes/<lane>/jobs")
    complete.add_argument("--job", required=True)
    complete.add_argument("--replacement-id", required=True)
    complete.add_argument("--replacement-commit", required=True)
    complete.add_argument("--queue-cli", required=True, help="path to the worker's pipeline queue CLI")
    args = parser.parse_args(argv)
    if args.command == "hold":
        record = hold_prepared(args.root, args.queue, args.job, args.reason)
    else:
        record = complete_supersession(args.root, args.queue, args.job, args.replacement_id,
                                       args.replacement_commit, queue_cli=args.queue_cli)
    print(json.dumps(record, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
