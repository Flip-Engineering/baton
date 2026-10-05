#!/usr/bin/env python3
"""Read the retained per-attempt record for a Baton2 database.

Each attempt keeps its own directory `<database>.attempt-<hex(attempt id)>`. The
keeper reaps the native child and writes the raw wait status to `status` there,
beside `native.pid`, `native.birth`, `launch`, `released` and `acknowledged`.
This tool reads those files, decodes the wait status and the attempt identity,
and takes the operational state from scoped CLI reads: `players` for the current
execution pointer and session rows, and `turns <session>` for the per-attempt
report and event. Raw CLI output is kept beside the record. It writes no state.

Route provenance. The attempt's configured route comes from its own manifest
argv, so it is per-attempt evidence. A harness-reported route is recorded only
from that attempt's own retained native stdout spool, which the keeper unlinks
at acknowledgement. Absence therefore means unavailable in the retained
evidence that was inspected; it is not evidence that the attempt produced no
model frame. The inspected prefix is bounded, and the record states whether the
spool was longer than that prefix, so an uninspected suffix stays distinct from
an absence of a route frame.

Usage: attempt_exit_records.py DATABASE OUT.json [--cli PATH]
"""
import glob
import hashlib
import json
import os
import subprocess
import struct
import sys
import time

MANIFEST_MAGIC = b"BATONRP1"
# The prompt writes set_event_filter, get_state and prompt in that order, so the
# harness route response lies in the first frames of the spool. Retained spools
# reach hundreds of megabytes, so only a bounded prefix is read.
SPOOL_PREFIX_BYTES = 4 << 20
DEFAULT_CLI = ("/Users/wahargis/Development/Experiments/baton-bend2-root-delivery-20260928/"
               ".scratch/semantic-context-20261005/worktrees/semantic-controls-interfaces-research/"
               ".scratch/671-frozen-stable98/baton2")
ROUTE_PROVENANCE = (
    "configured_route is read from each attempt's own manifest argv. observed_route is reported only "
    "from that attempt's retained native stdout spool, which the keeper unlinks at acknowledgement, so "
    "a missing observed_route means unavailable in the retained and inspected evidence, not that the "
    "attempt produced no model frame. The spool read is bounded to a prefix; observed_route_state "
    "distinguishes a route parsed from the spool, a spool inspected in full with no recognised route "
    "frame, a prefix inspected with the suffix uninspected, and no retained spool. Recognised frames are "
    "an OMP get_state response with data.model.provider and data.model.id, a run.model.configured "
    "payload, and a message with provider and model. current_session_observation holds sessions rows as "
    "they stand now; sessions.observed_model is one mutable session-level value and states nothing about "
    "an earlier attempt of the same session.")


def decode_attempt_id(name):
    """Attempt directory suffix is lower(hex(attempt id))."""
    try:
        return bytes.fromhex(name).decode("utf-8", "replace")
    except ValueError:
        return None


def wait_status(raw):
    value = int(raw.strip())
    if value & 0x7F == 0x7F:
        return {"raw": value, "kind": "stopped", "exit": None, "signal": None}
    if value & 0x7F:
        return {"raw": value, "kind": "signaled", "exit": None, "signal": value & 0x7F}
    return {"raw": value, "kind": "exited", "exit": (value >> 8) & 0xFF, "signal": 0}


def read_birth(path):
    with open(path, "rb") as handle:
        blob = handle.read(24)
    if len(blob) < 24:
        return {"bytes": len(blob), "pid": None}
    pid = struct.unpack_from("<i", blob, 0)[0]
    first, second = struct.unpack_from("<QQ", blob, 8)
    return {"pid": pid, "start_sec": first, "start_usec": second}


def read_manifest(path):
    with open(path, "rb") as handle:
        blob = handle.read()
    if len(blob) < 64 or blob[:8] != MANIFEST_MAGIC:
        return {"valid": False, "bytes": len(blob)}
    lengths = struct.unpack_from("<6Q", blob, 8)
    offset = 64
    fields = []
    for length in lengths:
        fields.append(blob[offset:offset + length])
        offset += length
    argv = [part.decode("utf-8", "replace") for part in fields[0].split(b"\0") if part]
    keep_stdin, reserved = struct.unpack_from("<II", blob, 56)
    return {"valid": True, "bytes": len(blob), "keep_stdin": keep_stdin, "reserved": reserved,
            "argv": argv, "argv0": argv[0] if argv else None,
            "fields_text": [field.decode("utf-8", "replace")[:400] for field in fields[1:]]}


def configured_route(manifest):
    """The route named by this attempt's own manifest argv."""
    if not manifest or not manifest.get("valid"):
        return None
    argv = manifest["argv"]
    route = {}
    for index, token in enumerate(argv):
        if token in ("--model", "--thinking", "--approval-mode", "--effort", "-m") and index + 1 < len(argv):
            route["model" if token == "-m" else token.lstrip("-")] = argv[index + 1]
        elif token.startswith("--model="):
            route["model"] = token.split("=", 1)[1]
    route["argv0"] = manifest.get("argv0")
    return route


def frame_route(frame):
    """Return the route a recognised harness frame reports, or None."""
    if frame.get("command") == "get_state":
        model = (frame.get("data") or {}).get("model") or {}
        if model.get("provider") and model.get("id"):
            return {"route": "%s/%s" % (model["provider"], model["id"]),
                    "frame": "command=get_state data.model.provider+id",
                    "frame_success": frame.get("success")}
    payload = frame.get("payload") or {}
    if (frame.get("payload_type") or payload.get("kind")) == "run.model.configured" and payload.get("model_id"):
        return {"route": payload["model_id"], "frame": "payload_type=run.model.configured"}
    message = frame.get("message")
    if isinstance(message, dict) and message.get("provider") and message.get("model"):
        return {"route": "%s/%s" % (message["provider"], message["model"]),
                "frame": "message.provider+model"}
    return None


def retained_observed_route(directory):
    """Harness-reported route from this attempt's retained stdout spool.

    Returns None when no spool is retained. Otherwise returns the parsed route
    or a state that distinguishes a fully inspected spool from an inspected
    prefix with an uninspected suffix.
    """
    path = os.path.join(directory, "stdout")
    if not os.path.exists(path):
        return None
    size = os.path.getsize(path)
    with open(path, "r", errors="replace") as handle:
        prefix = handle.read(SPOOL_PREFIX_BYTES)
    complete = len(prefix) >= size
    for line in prefix.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(frame, dict):
            found = frame_route(frame)
            if found:
                return {"route": found["route"], "source": "stdout", "frame": found["frame"],
                        "spool_bytes": size, "prefix_bytes_read": len(prefix),
                        "spool_fully_inspected": complete,
                        "state": "route-parsed-from-retained-spool"}
    return {"route": None, "source": "stdout", "frame": None, "spool_bytes": size,
            "prefix_bytes_read": len(prefix), "spool_fully_inspected": complete,
            "state": ("no-route-frame-in-retained-spool" if complete
                      else "no-route-frame-in-inspected-prefix")}


def size_of(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def attempt_records(database):
    records = []
    for directory in sorted(glob.glob(database + ".attempt-*")):
        suffix = os.path.basename(directory)[len(os.path.basename(database)) + len(".attempt-"):]
        attempt = decode_attempt_id(suffix)
        record = {"directory": directory, "attempt": attempt,
                  "session": (attempt or "").split(":")[1] if attempt else None}
        status = os.path.join(directory, "status")
        record["status_raw"] = open(status).read().strip() if os.path.exists(status) else None
        record["exit"] = wait_status(record["status_raw"]) if record["status_raw"] is not None else None
        record["files"] = {name: os.path.exists(os.path.join(directory, name))
                           for name in ("launch", "native.pid", "native.birth", "released", "acknowledged",
                                        "native-start-error", "keeper.log", "native.stderr", "manifest",
                                        "stdout", "observer.log")}
        pid_path = os.path.join(directory, "native.pid")
        record["native_pid"] = open(pid_path).read().strip() if record["files"]["native.pid"] else None
        birth_path = os.path.join(directory, "native.birth")
        record["birth"] = read_birth(birth_path) if record["files"]["native.birth"] else None
        manifest_path = os.path.join(directory, "manifest")
        record["manifest"] = read_manifest(manifest_path) if record["files"]["manifest"] else None
        record["configured_route"] = configured_route(record["manifest"])
        observed = retained_observed_route(directory)
        record["observed_route"] = observed
        record["observed_route_state"] = observed["state"] if observed else "no-retained-spool"
        record["native_stderr_bytes"] = size_of(os.path.join(directory, "native.stderr"))
        record["spool_bytes"] = size_of(os.path.join(directory, "stdout"))
        records.append(record)
    return records


def cli_read(cli, database, args, raw_directory):
    """Run one scoped CLI read and keep its exact bytes."""
    argv = [cli, database] + list(args)
    done = subprocess.run(argv, capture_output=True, text=True)
    name = "-".join([str(part) for part in args]).replace("/", "_")[:120] + ".json"
    path = os.path.join(raw_directory, name)
    with open(path, "w") as handle:
        handle.write(done.stdout)
    entry = {"argv": argv, "exit": done.returncode, "stdout_bytes": len(done.stdout),
             "stderr": done.stderr[:2000], "raw": path}
    try:
        entry["document"] = json.loads(done.stdout)
    except json.JSONDecodeError:
        entry["document"] = None
    return entry


def main():
    arguments = sys.argv[1:]
    database, out_path = arguments[0], arguments[1]
    cli = os.environ.get("BATON2_CLI", DEFAULT_CLI)
    if "--cli" in arguments:
        cli = arguments[arguments.index("--cli") + 1]
    if not os.path.exists(cli):
        fallback = "/Users/wahargis/.local/share/baton2/releases/1.1.0-fca7af876c8260c32d17f95f3e19bc68ee1bf561/bin/baton2"
        cli = fallback if os.path.exists(fallback) else cli

    records = attempt_records(database)
    raw_directory = os.path.join(os.path.dirname(os.path.abspath(out_path)), "cli-reads")
    os.makedirs(raw_directory, exist_ok=True)

    reads = {}
    if os.path.exists(cli):
        reads["players"] = cli_read(cli, database, ["players"], raw_directory)
        sessions = sorted({record["session"] for record in records if record["session"]})
        for session in sessions:
            reads["turns:" + session] = cli_read(cli, database, ["turns", session], raw_directory)

    current = {}
    for row in (reads.get("players", {}).get("document") or []):
        execution = row.get("execution") or {}
        current[row.get("id")] = {"current_attempt": execution.get("attempt"),
                                  "mode": execution.get("mode"), "phase": execution.get("phase"),
                                  "status": execution.get("status")}
    reports = {}
    for key, entry in reads.items():
        if not key.startswith("turns:"):
            continue
        for row in (entry.get("document") or []):
            reports[row.get("id")] = {"report_body": (row.get("reportBody") or "")[:4000],
                                      "event_type": row.get("eventType"), "receipt": row.get("receipt")}

    observed_available = observed_agree = 0
    states = {}
    for record in records:
        states[record["observed_route_state"]] = states.get(record["observed_route_state"], 0) + 1
        record["current_execution"] = current.get(record["session"])
        record["report"] = reports.get(record["attempt"])
        observed = record["observed_route"]
        if observed and observed.get("route"):
            observed_available += 1
            if (record["configured_route"] or {}).get("model") == observed["route"]:
                observed_agree += 1

    document = {
        "database": database,
        "attempt_count": len(records),
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cli": {"path": cli,
                "sha256": hashlib.sha256(open(cli, "rb").read()).hexdigest() if os.path.exists(cli) else None,
                "reads": {key: {"argv": value["argv"], "exit": value["exit"],
                                "stdout_bytes": value["stdout_bytes"], "raw": value["raw"]}
                          for key, value in reads.items()}},
        "route_provenance": ROUTE_PROVENANCE,
        "observed_route_summary": {"available": observed_available,
                                   "unavailable": len(records) - observed_available,
                                   "matches_configured": observed_agree,
                                   "states": states},
        "current_session_observation": current,
        "attempts": records,
    }
    with open(out_path, "w") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)

    histogram = {}
    for record in records:
        if record["exit"] is None:
            key = "no-status"
        elif record["exit"]["exit"] is None:
            key = "signal %s" % record["exit"]["signal"]
        else:
            key = "exit %s" % record["exit"]["exit"]
        histogram[key] = histogram.get(key, 0) + 1
    print(json.dumps({"database": database, "attempt_count": len(records),
                      "exit_histogram": histogram,
                      "observed_route": document["observed_route_summary"],
                      "cli_reads": len(reads)}, indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
