#!/usr/bin/env python3
"""Read the retained per-attempt exit record for a Baton2 database.

Each attempt keeps its own directory `<database>.attempt-<hex(attempt id)>`. The
keeper reaps the native child and writes the raw wait status to `status` there,
beside `native.pid`, `native.birth`, `launch`, `released` and `acknowledged`.
This tool reads those files, decodes the wait status and the attempt identity,
and optionally joins the database rows for the same attempt id. It is read-only.

Usage: attempt_exit_records.py DATABASE OUT.json
"""
import glob
import json
import os
import sqlite3
import struct
import sys

MANIFEST_MAGIC = b"BATONRP1"


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
    keep_stdin, reserved = struct.unpack_from("<II", blob, 56)
    offset = 64
    fields = []
    for length in lengths:
        fields.append(blob[offset:offset + length])
        offset += length
    argv = fields[0].split(b"\0")
    argv = [part.decode("utf-8", "replace") for part in argv if part]
    route = {}
    for index, token in enumerate(argv):
        if token in ("--model", "--thinking", "--approval-mode") and index + 1 < len(argv):
            route[token.lstrip("-")] = argv[index + 1]
    return {"valid": True, "bytes": len(blob), "keep_stdin": keep_stdin, "reserved": reserved,
            "argv": argv, "route": route, "argv0": argv[0] if argv else None,
            "fields_text": [field.decode("utf-8", "replace")[:400] for field in fields[1:]]}


def size_of(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def attempt_records(database):
    records = []
    for directory in sorted(glob.glob(database + ".attempt-*")):
        suffix = os.path.basename(directory)[len(os.path.basename(database)) + len(".attempt-"):]
        record = {"directory": directory, "attempt": decode_attempt_id(suffix),
                  "session": (decode_attempt_id(suffix) or "").split(":")[1] if decode_attempt_id(suffix) else None}
        status = os.path.join(directory, "status")
        record["status_raw"] = open(status).read().strip() if os.path.exists(status) else None
        record["exit"] = wait_status(record["status_raw"]) if record["status_raw"] is not None else None
        record["files"] = {name: os.path.exists(os.path.join(directory, name))
                           for name in ("launch", "native.pid", "native.birth", "released", "acknowledged",
                                        "native-start-error", "keeper.log", "native.stderr", "manifest")}
        pid_path = os.path.join(directory, "native.pid")
        record["native_pid"] = open(pid_path).read().strip() if record["files"]["native.pid"] else None
        birth_path = os.path.join(directory, "native.birth")
        record["birth"] = read_birth(birth_path) if record["files"]["native.birth"] else None
        manifest_path = os.path.join(directory, "manifest")
        record["manifest"] = read_manifest(manifest_path) if record["files"]["manifest"] else None
        record["native_stderr_bytes"] = size_of(os.path.join(directory, "native.stderr"))
        record["spool_bytes"] = size_of(os.path.join(directory, "stdout"))
        records.append(record)
    return records


def main():
    database, out_path = sys.argv[1:3]
    records = attempt_records(database)
    rows = {}
    if os.path.exists(database):
        connection = sqlite3.connect("file:%s?mode=ro" % database, uri=True)
        connection.row_factory = sqlite3.Row
        for record in records:
            attempt = record["attempt"]
            entry = {"executions": [], "report": None, "turn_event": None, "session": None}
            try:
                entry["executions"] = [dict(row) for row in connection.execute(
                    "SELECT session,id,mode,directory,phase,status FROM executions WHERE session=? OR id=?",
                    (record["session"], attempt))]
                if record["session"]:
                    entry["session"] = dict(connection.execute(
                        "SELECT id,harness,model,effort,native,observed_harness,observed_model,observed_effort,workspace "
                        "FROM sessions WHERE id=?", (record["session"],)).fetchone() or {})
                row = connection.execute("SELECT body FROM messages WHERE id=?", (attempt,)).fetchone()
                entry["report"] = row["body"][:4000] if row else None
                row = connection.execute("SELECT event FROM turns WHERE id=?", (attempt,)).fetchone()
                entry["turn_event"] = row["event"][:2000] if row else None
            except sqlite3.Error as error:
                entry["error"] = str(error)
            rows[attempt] = entry
    document = {"database": database, "attempt_count": len(records),
                "captured_at": __import__("time").strftime("%Y-%m-%dT%H:%M:%SZ", __import__("time").gmtime()),
                "attempts": [{**record, "database_rows": rows.get(record["attempt"])} for record in records]}
    with open(out_path, "w") as handle:
        json.dump(document, handle, indent=1, sort_keys=True)
    exits = {}
    for record in records:
        kind = record["exit"]["kind"] if record["exit"] else "no-status"
        key = kind if record["exit"] is None or record["exit"]["exit"] is None else "exit %s" % record["exit"]["exit"]
        exits[key] = exits.get(key, 0) + 1
    print(json.dumps({"database": database, "attempt_count": len(records), "exit_histogram": exits},
                     indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
