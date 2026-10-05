#!/usr/bin/env python3
"""Read the retained per-attempt record for a Baton2 database.

Each attempt keeps its own directory `<database>.attempt-<hex(attempt id)>`. The
keeper reaps the native child and writes the raw wait status to `status` there,
beside `native.pid`, `native.birth`, `launch`, `released` and `acknowledged`.
This tool reads those files, decodes the wait status and the attempt identity,
and joins the database rows that are keyed by the attempt id. It is read-only.

Route provenance. The attempt's configured route comes from its own manifest
argv, so it is per-attempt evidence. A harness-reported route is recorded only
when retained per-attempt frame evidence exists: the native stdout spool
`<attempt>/stdout`, which the keeper unlinks at acknowledgement, so it survives
only for attempts that were never acknowledged. Every other attempt's observed
route is reported as unavailable. `sessions.observed_model` is a single mutable
session-level value; this tool reports it under `current_session_observation`
and never as per-attempt evidence.

Usage: attempt_exit_records.py DATABASE OUT.json
"""
import glob
import json
import os
import sqlite3
import struct
import sys
import time

MANIFEST_MAGIC = b"BATONRP1"
# The prompt writes set_event_filter, get_state and prompt in that order, so the
# harness route response lies in the first frames of the spool. Retained spools
# reach hundreds of megabytes, so only a bounded prefix is read.
SPOOL_PREFIX_BYTES = 4 << 20


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


def manifest_argv(blob):
    lengths = struct.unpack_from("<6Q", blob, 8)
    offset = 64
    fields = []
    for length in lengths:
        fields.append(blob[offset:offset + length])
        offset += length
    argv = [part.decode("utf-8", "replace") for part in fields[0].split(b"\0") if part]
    return argv, fields


def read_manifest(path):
    with open(path, "rb") as handle:
        blob = handle.read()
    if len(blob) < 64 or blob[:8] != MANIFEST_MAGIC:
        return {"valid": False, "bytes": len(blob)}
    argv, fields = manifest_argv(blob)
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
            route[token.lstrip("-") if token != "-m" else "model"] = argv[index + 1]
        elif token.startswith("--model="):
            route["model"] = token.split("=", 1)[1]
    route["argv0"] = manifest.get("argv0")
    return route


def retained_observed_route(directory):
    """Harness-reported route from this attempt's retained stdout spool.

    Returns None with no retained spool. Reads only a bounded prefix.
    """
    path = os.path.join(directory, "stdout")
    if not os.path.exists(path):
        return None
    size = os.path.getsize(path)
    with open(path, "r", errors="replace") as handle:
        prefix = handle.read(SPOOL_PREFIX_BYTES)
    for line in prefix.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            frame = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(frame, dict):
            continue
        if frame.get("command") == "get_state":
            data = frame.get("data") or {}
            model = data.get("model") or {}
            provider, identifier = model.get("provider"), model.get("id")
            if provider and identifier:
                return {"route": "%s/%s" % (provider, identifier), "source": "stdout",
                        "frame": "command=get_state data.model.provider+id",
                        "frame_success": frame.get("success"),
                        "spool_bytes": size, "prefix_bytes_read": len(prefix)}
        payload_type = frame.get("payload_type") or (frame.get("payload") or {}).get("kind")
        if payload_type == "run.model.configured":
            payload = frame.get("payload") or {}
            if payload.get("model_id"):
                return {"route": payload["model_id"], "source": "stdout",
                        "frame": "payload_type=run.model.configured",
                        "spool_bytes": size, "prefix_bytes_read": len(prefix)}
        message = frame.get("message")
        if isinstance(message, dict) and message.get("provider") and message.get("model"):
            return {"route": "%s/%s" % (message["provider"], message["model"]), "source": "stdout",
                    "frame": "message.provider+model",
                    "spool_bytes": size, "prefix_bytes_read": len(prefix)}
    return {"route": None, "source": "stdout", "frame": None, "spool_bytes": size,
            "prefix_bytes_read": len(prefix), "state": "no-route-frame-in-prefix"}


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
        observed = retained_observed_route(directory) if record["files"]["stdout"] else None
        record["observed_route"] = observed
        record["observed_route_state"] = ("unavailable" if observed is None
                                          else ("retained-spool" if observed.get("route") else
                                                observed.get("state", "unavailable")))
        record["native_stderr_bytes"] = size_of(os.path.join(directory, "native.stderr"))
        record["spool_bytes"] = size_of(os.path.join(directory, "stdout"))
        records.append(record)
    return records


def database_rows(connection, records):
    executions = {}
    reports = {}
    turns = {}
    sessions = {}
    for record in records:
        attempt = record["attempt"]
        session = record["session"]
        try:
            executions[attempt] = [dict(row) for row in connection.execute(
                "SELECT session,id,mode,directory,phase,status FROM executions WHERE id=?", (attempt,))]
            row = connection.execute("SELECT body FROM messages WHERE id=?", (attempt,)).fetchone()
            reports[attempt] = row["body"][:4000] if row else None
            row = connection.execute("SELECT event FROM turns WHERE id=?", (attempt,)).fetchone()
            turns[attempt] = row["event"][:2000] if row else None
            if session and session not in sessions:
                row = connection.execute(
                    "SELECT id,harness,model,effort,native,observed_harness,observed_model,observed_effort "
                    "FROM sessions WHERE id=?", (session,)).fetchone()
                sessions[session] = dict(row) if row else None
        except sqlite3.Error as error:
            executions[attempt] = {"error": str(error)}
    return executions, reports, turns, sessions


def main():
    database, out_path = sys.argv[1:3]
    records = attempt_records(database)
    executions, reports, turns, sessions = {}, {}, {}, {}
    if os.path.exists(database):
        connection = sqlite3.connect("file:%s?mode=ro" % database, uri=True)
        connection.row_factory = sqlite3.Row
        executions, reports, turns, sessions = database_rows(connection, records)
        connection.close()

    observed_available = observed_agree = 0
    for record in records:
        record["database"] = {"executions_for_attempt": executions.get(record["attempt"]),
                             "report": reports.get(record["attempt"]),
                             "turn_event": turns.get(record["attempt"])}
        observed = record["observed_route"]
        if observed and observed.get("route"):
            observed_available += 1
            configured = (record["configured_route"] or {}).get("model")
            if configured == observed["route"]:
                observed_agree += 1

    document = {
        "database": database,
        "attempt_count": len(records),
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "route_provenance": (
            "configured_route is read from each attempt's own manifest argv. observed_route is "
            "reported only from that attempt's retained stdout spool, which the keeper unlinks at "
            "acknowledgement; every other attempt is unavailable. current_session_observation holds "
            "the sessions row as it stands now and is a mutable session-level value, not per-attempt "
            "evidence."),
        "observed_route_summary": {"available": observed_available,
                                   "unavailable": len(records) - observed_available,
                                   "matches_configured": observed_agree},
        "current_session_observation": sessions,
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
                      "spool_retained": sum(1 for r in records if r["files"]["stdout"]),
                      "observed_route": document["observed_route_summary"]},
                     indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
