"""Claim one explicitly authorized queue job for one render lane."""

import json
import os
from pathlib import Path
import re
import tempfile


TARGET_FIELDS = (
    "job_id",
    "pipeline_commit",
    "retry_of",
    "piece",
    "run",
    "dependencies",
)
CLAIM_FIELDS = ("pipeline_commit", "run", "dependencies")


def load_target(path, lane):
    """Return the pending target for lane, or None when no route is configured."""
    if not path:
        return None
    control = json.loads(Path(path).read_text())
    if control.get("version") != 1:
        raise ValueError("unsupported targeted-acquire control version")
    target = control.get("target")
    if not isinstance(target, dict) or target.get("state") != "pending":
        return None
    if target.get("lane") != lane:
        return None
    validate_target(target, lane)
    return target


def validate_target(target, lane):
    if target.get("state") != "pending" or target.get("lane") != lane:
        raise ValueError("targeted-acquire lane or state mismatch")
    if not re.fullmatch(r"[A-Za-z0-9_-]+", str(target.get("job_id", ""))):
        raise ValueError("targeted-acquire job id is invalid")
    if not re.fullmatch(r"[0-9a-f]{40}", str(target.get("pipeline_commit", ""))):
        raise ValueError("targeted-acquire commit must be a full SHA")
    retry_of = target.get("retry_of")
    if "retry_of" not in target or (
        retry_of is not None
        and not re.fullmatch(r"[A-Za-z0-9_-]+", str(retry_of))
    ):
        raise ValueError("targeted-acquire retry lineage is invalid")
    if not isinstance(target.get("run"), list) or not target["run"]:
        raise ValueError("targeted-acquire recipe is missing")
    if not isinstance(target.get("dependencies"), dict):
        raise ValueError("targeted-acquire dependencies are missing")
    if not target.get("piece"):
        raise ValueError("targeted-acquire piece is missing")


def matches_target(job, target):
    actual = dict(job)
    actual.setdefault("job_id", job.get("id"))
    return all(actual.get(key) == target.get(key) for key in TARGET_FIELDS)


def acquire(target, lane, worker, lease_hours, run):
    """Claim the allowlisted job by id and return its normal worker queue payload.

    `run` executes one queue CLI argument vector and returns stdout. A target
    already claimed by this worker can be resumed after a worker process restart.
    """
    validate_target(target, lane)
    show = json.loads(run(["show", target["job_id"]]))
    if not matches_target(show, target):
        return None
    state = show.get("state")
    if state == "open":
        output = run([
            "claim",
            target["job_id"],
            "--by",
            worker,
            "--lease",
            str(lease_hours),
        ])
        identifier, payload = output.split("\n", 1)
        payload = json.loads(payload)
        if identifier != target["job_id"] or any(
            payload.get(key) != target.get(key) for key in CLAIM_FIELDS
        ):
            run(["release", target["job_id"], "--by", worker])
            raise ValueError("claimed queue recipe differs from target allowlist")
        return identifier, payload
    if state == "claimed" and (show.get("claim") or {}).get("by") == worker:
        return target["job_id"], show
    return None


def mark_consumed(path, target, worker, at):
    """Persist one-shot consumption after the worker wrote its durable request."""
    path = Path(path)
    control = json.loads(path.read_text())
    current = control.get("target")
    if current != target:
        raise ValueError("targeted-acquire control changed during claim")
    control["target"] = dict(target, state="consumed", claimed_by=worker, consumed_at=at)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(control, stream, sort_keys=True, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except FileNotFoundError:
            pass
        raise
