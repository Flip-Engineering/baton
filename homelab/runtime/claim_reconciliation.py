"""Read-only reconciliation and safe retirement of duplicate local claims.

The homelab lanes keep independent ``farm.JOBS`` trees but share the queue
worker name. A prepared checkpoint retained in one lane and a later claim in
another lane can therefore coexist for the same protocol id. Reconciliation
classifies such copies; retirement marks only a stale prepared copy as
superseded after one allocated active copy is confirmed, never signalling or
changing the active reservation.
"""
import datetime
import json
import os
from pathlib import Path
import tempfile

SCHEMA = "acp.cross-lane-claim-reconciliation/v1"
ACTIVE_STATES = ("running", "pictured", "complete")


def read_json(path):
    path = Path(path)
    return json.loads(path.read_text()) if path.is_file() and not path.is_symlink() else None


def lane_name(root, job):
    job = Path(job)
    root = Path(root)
    if job.parent == root / "jobs":
        return "gpu0"
    if job.parent.parent.parent.name == "lanes":
        return job.parent.parent.name
    return "other"


def copy_record(root, job):
    job = Path(job)
    request = read_json(job / "request.json") or {}
    status = read_json(job / "status.json") or {}
    prepared = read_json(job / "prepared.json") or {}
    allocation = read_json(job / "allocation.json") or {}
    ranges = prepared.get("ranges") or []
    allocated = allocation.get("gpus") or []
    return {
        "lane": lane_name(root, job),
        "job_dir": str(job),
        "state": status.get("state"),
        "phase": status.get("phase"),
        "request_submitted": request.get("submitted"),
        "started": status.get("started"),
        "prepared": status.get("prepared"),
        "render_started": status.get("render_started"),
        "request_commit": request.get("commit"),
        "host_memory_gib": prepared.get("host_memory_gib"),
        "range_uuid": ranges[0].get("gpu", {}).get("uuid") if ranges else None,
        "allocation_present": bool(allocated),
        "allocation_uuid": allocated[0].get("uuid") if allocated else None,
        "admission_present": (job / "admission.json").is_file() and not (job / "admission.json").is_symlink(),
    }


def copies(root, protocol_id):
    root = Path(root)
    name = "protocol-" + protocol_id
    paths = [root / "jobs" / name]
    paths.extend(sorted(root.glob("lanes/*/jobs/" + name)))
    return [copy_record(root, path) for path in paths if path.is_dir()]


def classify(records):
    active = [item for item in records if item["state"] in ACTIVE_STATES and item["allocation_present"]]
    prepared = [item for item in records if item["state"] == "prepared"]
    active_ids = {id(item) for item in active}
    prepared_ids = {id(item) for item in prepared}
    other = [item for item in records if id(item) not in active_ids and id(item) not in prepared_ids]
    if len(active) > 1:
        action = "conflict_multiple_active"
    elif len(active) == 1 and not other and len(active) + len(prepared) == len(records):
        action = "retain_active_hold_prepared"
    elif len(prepared) == len(records) and records:
        action = "ambiguous_prepared"
    elif not active and not prepared and records:
        action = "inspect_other_states"
    elif not records:
        action = "no_local_copy"
    else:
        action = "inspect_mixed_states"
    return {
        "action": action,
        "active": active[0] if len(active) == 1 else None,
        "stale_prepared": prepared if len(active) == 1 else [],
        "other": other,
        "active_count": len(active),
        "prepared_count": len(prepared),
    }


def reconcile(root, protocol_id, queue_claim=None, workers=None):
    records = copies(root, protocol_id)
    result = classify(records)
    result.update({
        "schema": SCHEMA,
        "protocol_id": protocol_id,
        "copies": records,
        "queue_claim": queue_claim,
        "workers": workers or [],
        "read_only": True,
        "mutation": False,
    })
    if result["action"] == "retain_active_hold_prepared":
        active = result["active"]
        stale = result["stale_prepared"]
        result["cause_hint"] = (
            "one allocated active copy in lane " + active["lane"] +
            "; prepared duplicate(s) in " + ", ".join(item["lane"] for item in stale) +
            "; hold only the allocated copy until the duplicate is retired"
        )
    elif result["action"] == "ambiguous_prepared":
        result["cause_hint"] = "no allocated copy; do not dispatch either prepared duplicate"
    elif result["action"] == "conflict_multiple_active":
        result["cause_hint"] = "more than one allocated active copy; operator review required"
    else:
        result["cause_hint"] = "inspect the recorded states before any dispatch decision"
    return result


def _now():
    return datetime.datetime.now(datetime.timezone.utc)


def _age_seconds(value, now):
    if not isinstance(value, str) or not value:
        return None
    try:
        stamp = datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
        if stamp.tzinfo is None or stamp.utcoffset() is None:
            return None
        return (now - stamp).total_seconds()
    except (TypeError, ValueError, OverflowError):
        return None


def _write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix="." + path.name + ".", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            stream.write(json.dumps(data, indent=2, sort_keys=True) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    except BaseException:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def candidate_protocol_ids(root):
    root = Path(root)
    identifiers = set()
    for status_path in list((root / "jobs").glob("*/status.json")) + list(root.glob("lanes/*/jobs/*/status.json")):
        status = read_json(status_path) or {}
        if status.get("state") != "prepared":
            continue
        request = read_json(status_path.parent / "request.json") or {}
        identifier = request.get("protocol_id") or status_path.parent.name.removeprefix("protocol-")
        if identifier:
            identifiers.add(identifier)
    return sorted(identifiers)


def retire_prepared_duplicates(root, protocol_ids=None, apply=False, min_age_seconds=300, now=None):
    """Retire prepared copies when one allocated active copy exists.

    ``apply=False`` is a dry run. Retirement writes a receipt and marks only the
    stale prepared copy as superseded; the allocated active copy, its
    reservation and its job files are never modified. Prepared copies younger
    than ``min_age_seconds`` and copies with an allocation or admission marker
    are skipped.
    """
    root = Path(root)
    now = now or _now()
    identifiers = sorted(set(protocol_ids or candidate_protocol_ids(root)))
    summary = {"schema": "acp.cross-lane-claim-retirement/v1", "root": str(root),
               "apply": bool(apply), "min_age_seconds": min_age_seconds,
               "retired": [], "would_retire": [], "skipped": [], "protocols": []}
    for identifier in identifiers:
        result = reconcile(root, identifier)
        entry = {"protocol_id": identifier, "action": result["action"]}
        summary["protocols"].append(entry)
        if result["action"] != "retain_active_hold_prepared":
            entry["result"] = "no_retirement"
            continue
        active = result["active"]
        for stale in result["stale_prepared"]:
            reason = None
            age = _age_seconds(stale.get("prepared") or stale.get("started"), now)
            if stale.get("job_dir") == active.get("job_dir"):
                reason = "same_job_as_active"
            elif stale.get("allocation_present"):
                reason = "stale_copy_has_allocation"
            elif stale.get("admission_present"):
                reason = "stale_copy_has_admission"
            elif stale.get("state") != "prepared" or stale.get("phase") != "ready":
                reason = "stale_copy_not_ready"
            elif age is None:
                reason = "stale_copy_timestamp_unknown"
            elif age < min_age_seconds:
                reason = "stale_copy_too_young"
            if reason:
                summary["skipped"].append({"protocol_id": identifier, "job_dir": stale["job_dir"], "reason": reason})
                entry.setdefault("skipped", []).append(stale["job_dir"])
                continue
            job = Path(stale["job_dir"])
            receipt = {
                "schema": "acp.prepared-duplicate-retirement/v1",
                "protocol_id": identifier,
                "stale_job": str(job),
                "stale_lane": stale["lane"],
                "active_job": active["job_dir"],
                "active_lane": active["lane"],
                "active_state": active["state"],
                "active_uuid": active["allocation_uuid"],
                "previous_state": stale["state"],
                "previous_phase": stale["phase"],
                "retired_at": now.isoformat(),
                "retired_by": {"pid": os.getpid()},
                "reason": "duplicate prepared copy; allocated active copy retained",
            }
            record = {"protocol_id": identifier, "job_dir": str(job), "lane": stale["lane"],
                      "receipt": str(job / "retirement.json")}
            if not apply:
                record["age_seconds"] = round(age, 3)
                summary["would_retire"].append(record)
                entry.setdefault("would_retire", []).append(str(job))
                continue
            _write_json(job / "retirement.json", receipt)
            status_path = job / "status.json"
            status = read_json(status_path) or {}
            status.update({
                "state": "superseded",
                "phase": "retired",
                "retired_at": receipt["retired_at"],
                "retirement_receipt": "retirement.json",
                "previous_state": stale["state"],
                "previous_phase": stale["phase"],
                "retired_active_job": active["job_dir"],
            })
            _write_json(status_path, status)
            record["age_seconds"] = round(age, 3)
            summary["retired"].append(record)
            entry.setdefault("retired", []).append(str(job))
    return summary


def main():
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--protocol", action="append", default=[])
    parser.add_argument("--min-age-seconds", type=float, default=300)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    print(json.dumps(retire_prepared_duplicates(
        args.root, args.protocol or None, apply=args.apply,
        min_age_seconds=args.min_age_seconds), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
