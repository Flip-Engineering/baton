#!/usr/bin/env python3
"""Read the retained per-attempt record for a Baton2 database.

Each attempt keeps its own directory `<database>.attempt-<hex(attempt id)>`. The
keeper reaps the native child and writes the raw wait status to `status` there,
beside `native.pid`, `native.birth`, `launch`, `released` and `acknowledged`.
This tool reads those files, decodes the wait status and the attempt identity,
and takes operational state only from CLI captures that were produced by a
direct CLI invocation outside this tool (see `capture-cli-reads.sh`). It never
runs a CLI command, never writes outside its output file, and never treats a
missing or failed capture as an empty successful result.

Modes:
  attempt_exit_records.py DATABASE OUT.json [--captures CAPTURE_DIR]
  attempt_exit_records.py --list-sessions DATABASE

Route provenance. The attempt's configured route comes from its own manifest
argv, so it is per-attempt evidence. A harness-reported route is recorded only
from that attempt's own retained native stdout spool, which the keeper unlinks
at acknowledgement. Absence therefore means unavailable in the retained
evidence that was inspected; it is not evidence that the attempt produced no
model frame. The prefix read is bounded in bytes, the record states the bytes
read, whether end of file was reached, whether the spool changed during the
read, how many lines could not be decoded as UTF-8, how many parsed frames were
not objects or matched no recognised shape, and whether the final line is a
partial frame. A successful full inspection is claimed only when end of file was
reached, the spool did not change during the read, and every line was
interpreted.
"""
import glob
import hashlib
import json
import os
import struct
import sys
import time

MANIFEST_MAGIC = b"BATONRP1"
# The prompt writes set_event_filter, get_state and prompt in that order, so the
# harness route response lies in the first frames of the spool. Retained spools
# reach hundreds of megabytes, so only a bounded prefix is read.
SPOOL_PREFIX_BYTES = 4 << 20

ROUTE_PROVENANCE = (
    "configured_route is read from each attempt's own manifest argv. observed_route is reported only "
    "from that attempt's retained native stdout spool, which the keeper unlinks at acknowledgement, so "
    "a missing observed_route means unavailable in the retained and inspected evidence, not that the "
    "attempt produced no model frame. The spool read is bounded to a byte prefix and reports the bytes "
    "read, whether end of file was reached, whether the spool changed during the read, the count of "
    "undecodable or uninterpreted lines and frames, and whether the final line is a partial frame. "
    "observed_route_state is one of: route-parsed-from-retained-spool; "
    "no-route-frame-in-fully-read-spool, claimed only when end of file was reached, the spool did not "
    "change during the read, and every line was interpreted; no-route-frame-in-inspected-prefix, when "
    "the prefix ended before end of file or a line could not be interpreted; "
    "spool-changed-during-read, when the spool was removed or changed while it was read; "
    "no-retained-spool. Recognised frames are an OMP get_state response with data.model.provider and "
    "data.model.id, a run.model.configured payload, and a message with provider and model; other shapes "
    "are counted as unrecognised rather than interpreted. current_session_observation and per-attempt "
    "reports come from CLI captures supplied on the command line; sessions.observed_model is one "
    "mutable session-level value and states nothing about an earlier attempt of the same session.")


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
    """Return the route a recognised harness frame reports, or None.

    Every nested value is type-checked before use, so a frame with an unexpected
    JSON shape is unrecognised rather than an error.
    """
    if not isinstance(frame, dict):
        return None
    if frame.get("command") == "get_state":
        data = frame.get("data")
        model = data.get("model") if isinstance(data, dict) else None
        if isinstance(model, dict) and isinstance(model.get("provider"), str) and isinstance(model.get("id"), str):
            return {"route": "%s/%s" % (model["provider"], model["id"]),
                    "frame": "command=get_state data.model.provider+id",
                    "frame_success": frame.get("success") if isinstance(frame.get("success"), bool) else None}
    payload = frame.get("payload")
    payload_type = frame.get("payload_type")
    if not isinstance(payload_type, str):
        payload_type = payload.get("kind") if isinstance(payload, dict) else None
    if payload_type == "run.model.configured" and isinstance(payload, dict) and isinstance(payload.get("model_id"), str):
        return {"route": payload["model_id"], "frame": "payload_type=run.model.configured"}
    message = frame.get("message")
    if isinstance(message, dict) and isinstance(message.get("provider"), str) and isinstance(message.get("model"), str):
        return {"route": "%s/%s" % (message["provider"], message["model"]),
                "frame": "message.provider+model"}
    return None


def read_bounded_bytes(path, limit, listing_stat):
    """Read at most limit bytes and report exactly what was inspected.

    Returns (blob or None, record). End of file is established by a read past
    the prefix. A spool that was removed or replaced between the directory
    listing and the read, or that changed size or modification time during the
    read, is reported as changed rather than as a completed inspection.
    """
    record = {"path": path, "limit_bytes": limit, "bytes_read": 0, "reached_eof": False,
              "changed_during_read": False, "opened": False, "error": None,
              "size_at_listing": listing_stat.st_size if listing_stat else None,
              "size_after_read": None, "prefix_sha256": None}
    try:
        with open(path, "rb") as handle:
            record["opened"] = True
            opened = os.fstat(handle.fileno())
            if listing_stat and (opened.st_dev, opened.st_ino) != (listing_stat.st_dev, listing_stat.st_ino):
                record["changed_during_read"] = True
            blob = handle.read(limit)
            extra = handle.read(1)
            record["bytes_read"] = len(blob)
            record["reached_eof"] = not extra
            record["prefix_sha256"] = hashlib.sha256(blob).hexdigest()
            after = os.fstat(handle.fileno())
            record["size_after_read"] = after.st_size
            if opened.st_size != after.st_size or opened.st_mtime_ns != after.st_mtime_ns:
                record["changed_during_read"] = True
        current = os.stat(path)
        if (current.st_dev, current.st_ino) != (opened.st_dev, opened.st_ino) or current.st_size != after.st_size:
            record["changed_during_read"] = True
    except OSError as error:
        record["error"] = "errno %s" % error.errno
        return None, record
    return blob, record


def interpret_prefix(blob, reached_eof):
    """Split a byte prefix into lines and count what was not interpreted."""
    stats = {"lines": 0, "lines_undecodable": 0, "lines_non_json": 0, "frames_non_object": 0,
             "frames_unrecognised": 0, "frames_recognised": 0, "trailing_partial_line": False}
    if blob is None or not blob:
        return None, stats
    # A final line is partial only when the prefix ended before end of file and
    # the last byte is not a newline. At end of file an unterminated final line
    # is a complete line.
    partial_final = (not reached_eof) and not blob.endswith(b"\n")
    raw_lines = blob.split(b"\n")
    if partial_final:
        # The last element is an incomplete line; it is never parsed because the
        # frame it belongs to may continue beyond the inspected prefix.
        raw_lines = raw_lines[:-1]
        stats["trailing_partial_line"] = True
    if raw_lines and raw_lines[-1] == b"":
        raw_lines = raw_lines[:-1]
    for raw in raw_lines:
        line = raw.strip()
        if not line:
            continue
        stats["lines"] += 1
        try:
            text = line.decode("utf-8")
        except UnicodeDecodeError:
            stats["lines_undecodable"] += 1
            continue
        if not text.startswith("{"):
            stats["lines_non_json"] += 1
            continue
        try:
            frame = json.loads(text)
        except json.JSONDecodeError:
            stats["lines_non_json"] += 1
            continue
        if not isinstance(frame, dict):
            stats["frames_non_object"] += 1
            continue
        found = frame_route(frame)
        if found:
            stats["frames_recognised"] += 1
            return found, stats
        stats["frames_unrecognised"] += 1
    return None, stats


def retained_observed_route(directory, listing_stat):
    """Harness-reported route from this attempt's retained stdout spool."""
    path = os.path.join(directory, "stdout")
    if not os.path.exists(path):
        return None
    blob, read = read_bounded_bytes(path, SPOOL_PREFIX_BYTES, listing_stat)
    found, stats = interpret_prefix(blob, read["reached_eof"])
    record = dict(read, **stats)
    record["source"] = "stdout"
    record["interpreted_everything"] = bool(
        read["reached_eof"] and not read["changed_during_read"] and read["error"] is None
        and stats["lines_undecodable"] == 0 and stats["trailing_partial_line"] is False
        and stats["frames_non_object"] == 0 and stats["frames_unrecognised"] == 0)
    if found:
        record["route"] = found["route"]
        record["frame"] = found["frame"]
        record["frame_success"] = found.get("frame_success")
        record["state"] = "route-parsed-from-retained-spool"
    else:
        record["route"] = None
        record["frame"] = None
        if read["error"] is not None or read["changed_during_read"]:
            record["state"] = "spool-changed-during-read"
        elif record["interpreted_everything"]:
            record["state"] = "no-route-frame-in-fully-read-spool"
        else:
            record["state"] = "no-route-frame-in-inspected-prefix"
    return record


def size_of(path):
    try:
        return os.path.getsize(path)
    except OSError:
        return None


def session_names(database):
    """Session ids discovered from attempt directory names, with no file reads."""
    suffix = os.path.basename(database) + ".attempt-"
    sessions = set()
    for directory in glob.glob(database + ".attempt-*"):
        attempt = decode_attempt_id(os.path.basename(directory)[len(suffix):])
        if attempt and attempt.count(":") >= 1:
            sessions.add(attempt.split(":")[1])
    return sorted(sessions)


def listing_stat(path):
    try:
        return os.stat(path)
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
        observed = retained_observed_route(directory, listing_stat(os.path.join(directory, "stdout")))
        record["observed_route"] = observed
        record["observed_route_state"] = observed["state"] if observed else "no-retained-spool"
        record["native_stderr_bytes"] = size_of(os.path.join(directory, "native.stderr"))
        record["spool_bytes"] = size_of(os.path.join(directory, "stdout"))
        records.append(record)
    return records


def load_captures(directory, database):
    """Consume CLI captures. This never runs a command.

    A capture set is a directory written by `capture-cli-reads.sh`: a
    `capture.txt` header with `cli`, `cli_sha256`, `database` and `captured_at`,
    one `<name><TAB><exit>` line per read, and `<name>.stdout`, `<name>.stderr`
    and `<name>.exit` for each read. A read whose exit file is missing or does
    not parse as zero is recorded as failed with its raw sizes and hashes, and
    its output is not interpreted.
    """
    result = {"directory": directory, "state": "not-supplied", "header": {}, "reads": {}}
    if not directory or not os.path.isdir(directory):
        return result
    manifest = os.path.join(directory, "capture.txt")
    if not os.path.exists(manifest):
        result["state"] = "manifest-missing"
        return result
    names = []
    with open(manifest, "r", errors="replace") as handle:
        for line in handle:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            if "\t" not in line and "=" in line:
                key, value = line.split("=", 1)
                result["header"][key.strip()] = value.strip()
            elif "\t" in line:
                names.append(line.split("\t", 1)[0].strip())
    result["header"]["capture_file"] = manifest
    recorded_database = result["header"].get("database")
    if recorded_database and database and os.path.realpath(recorded_database) != os.path.realpath(database):
        result["state"] = "database-mismatch"
        result["header"]["requested_database"] = database
        return result
    result["state"] = "loaded"
    for name in names:
        entry = {"name": name}
        for suffix in ("stdout", "stderr", "exit"):
            path = os.path.join(directory, "%s.%s" % (name, suffix))
            entry[suffix + "_path"] = path
            if not os.path.exists(path):
                entry[suffix] = None
                continue
            with open(path, "rb") as handle:
                blob = handle.read()
            entry[suffix] = {"bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest()}
            if suffix == "stdout":
                entry["_stdout_bytes"] = blob
            if suffix == "exit":
                entry["_exit_bytes"] = blob
        exit_bytes = entry.pop("_exit_bytes", None)
        try:
            entry["exit_code"] = int((exit_bytes or b"").strip())
        except ValueError:
            entry["exit_code"] = None
        entry["state"] = "ok" if entry["exit_code"] == 0 else (
            "failed" if entry["exit_code"] is not None else "no-exit-record")
        entry["document"] = None
        if entry["state"] == "ok":
            stdout_bytes = entry.pop("_stdout_bytes", b"")
            try:
                entry["document"] = json.loads(stdout_bytes.decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                entry["state"] = "unparsable-stdout"
                entry["error"] = str(error)
        else:
            entry.pop("_stdout_bytes", None)
        result["reads"][name] = entry
    return result


def attempt_view(captures):
    """Session-level and attempt-level state from CLI captures, or unavailable."""
    current = {}
    reports = {}
    if captures["state"] != "loaded":
        return current, reports, "cli-reads-%s" % captures["state"]
    players = captures["reads"].get("players")
    if players and players["state"] == "ok" and isinstance(players["document"], list):
        for row in players["document"]:
            if not isinstance(row, dict):
                continue
            execution = row.get("execution")
            execution = execution if isinstance(execution, dict) else {}
            current[row.get("id")] = {"current_attempt": execution.get("attempt"),
                                      "mode": execution.get("mode"), "phase": execution.get("phase"),
                                      "status": execution.get("status")}
    for name, entry in captures["reads"].items():
        if not name.startswith("turns-") or entry["state"] != "ok" or not isinstance(entry["document"], list):
            continue
        for row in entry["document"]:
            if not isinstance(row, dict):
                continue
            reports[row.get("id")] = {"report_body": (row.get("reportBody") or "")[:4000]
                                      if isinstance(row.get("reportBody"), str) else None,
                                      "event_type": row.get("eventType"),
                                      "receipt": row.get("receipt")}
    return current, reports, "loaded"


def main():
    arguments = sys.argv[1:]
    if arguments[:1] == ["--list-sessions"]:
        for session in session_names(arguments[1]):
            print(session)
        return
    database, out_path = arguments[0], arguments[1]
    capture_directory = None
    if "--captures" in arguments:
        capture_directory = arguments[arguments.index("--captures") + 1]

    records = attempt_records(database)
    captures = load_captures(capture_directory, database)
    current, reports, cli_state = attempt_view(captures)

    observed_available = observed_agree = 0
    states = {}
    for record in records:
        states[record["observed_route_state"]] = states.get(record["observed_route_state"], 0) + 1
        record["current_execution"] = current.get(record["session"]) if cli_state == "loaded" else None
        record["report"] = reports.get(record["attempt"]) if cli_state == "loaded" else None
        observed = record["observed_route"]
        if observed and observed.get("route"):
            observed_available += 1
            if (record["configured_route"] or {}).get("model") == observed["route"]:
                observed_agree += 1

    capture_summary = {"state": captures["state"], "directory": captures["directory"],
                       "header": captures["header"],
                       "reads": {name: {"state": entry["state"], "exit_code": entry["exit_code"],
                                        "stdout": entry.get("stdout"), "stderr": entry.get("stderr"),
                                        "stdout_path": entry.get("stdout_path")}
                                 for name, entry in captures["reads"].items()}}
    document = {
        "database": database,
        "attempt_count": len(records),
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cli_captures": capture_summary,
        "cli_state": cli_state,
        "route_provenance": ROUTE_PROVENANCE,
        "observed_route_summary": {"available": observed_available,
                                   "unavailable": len(records) - observed_available,
                                   "matches_configured": observed_agree,
                                   "states": states},
        "current_session_observation": current if cli_state == "loaded" else None,
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
                      "exit_histogram": histogram, "cli_state": cli_state,
                      "observed_route": document["observed_route_summary"]},
                     indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
