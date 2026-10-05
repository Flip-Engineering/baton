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
    "read, whether end of file was reached, whether metadata sampled at the listing, open, end of read "
    "and final path stat agreed, the counts of undecodable lines, non-JSON lines, non-object frames and "
    "unrecognised frames, and whether the final line is a partial frame. Those metadata samples bound a "
    "concurrent change but are not an atomic snapshot. Every inspected line is classified, including "
    "lines after a recognised route frame, so route existence and interpretation completeness are "
    "separate facts. observed_route_state is one of: route-parsed-from-retained-spool; "
    "no-route-frame-in-fully-read-spool, claimed only when end of file was reached, the metadata samples "
    "agreed, and every inspected line was decoded and interpreted; no-route-frame-in-inspected-prefix, "
    "when any of those conditions fails; spool-changed-during-read; spool-removed-after-listing, when "
    "the directory listing saw a spool that was gone before it could be read; no-retained-spool, when "
    "no listing and no file observed a spool at all. Recognised frames are an OMP get_state response "
    "with data.model.provider and data.model.id, a run.model.configured payload, and a message with "
    "provider and model; other shapes are counted as unrecognised rather than interpreted. Session and "
    "per-attempt reports come only from CLI captures supplied on the command line, and each capture "
    "carries its own state so a missing, failed or unparsable read is not an empty result. Rows inside a "
    "loaded read are validated individually: a repeated id with identical content is a duplicate, a "
    "repeated id with different content is a conflict where the first row is kept, and a turn row whose id "
    "or player names another session is refused for that capture. Every kept row records the index that "
    "supplied it and every row is accounted for, so only a read whose rows were all used once with none "
    "malformed, duplicated or conflicting is complete. Per-attempt reports are retained per capture "
    "session, and a record's report is read only from its own session's capture. "
    "sessions.observed_model is one mutable session-level value and states nothing about an earlier "
    "attempt of the same session.")


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


METADATA_LIMITS = (
    "Device, inode, size and modification time are sampled separately at the directory listing, at the "
    "open, after the prefix read and at the final path stat. Those comparisons bound a concurrent change "
    "but do not exclude one: the samples are not an atomic snapshot of the spool, and a change that "
    "restores the same size and modification time is not detected.")


def metadata(info):
    if info is None:
        return None
    return {"dev": info.st_dev, "ino": info.st_ino, "size": info.st_size, "mtime_ns": info.st_mtime_ns}


def compare_metadata(left, right):
    if left is None:
        return "left-absent"
    if right is None:
        return "right-absent"
    if (left.st_dev, left.st_ino) != (right.st_dev, right.st_ino):
        return "different-identity"
    if left.st_size != right.st_size:
        return "different-size"
    if left.st_mtime_ns != right.st_mtime_ns:
        return "different-mtime"
    return "same-dev-inode-size-mtime"


def read_bounded_bytes(path, limit, listing_stat):
    """Read at most limit bytes and report exactly what was inspected.

    Returns (blob or None, record). End of file is established by a read past the
    prefix. Metadata is sampled at the listing, the open, the end of the prefix
    read and a final path stat; every comparison is recorded, and a comparison
    that shows any difference marks the read as changed.
    """
    record = {"path": path, "limit_bytes": limit, "bytes_read": 0, "reached_eof": False,
              "changed_during_read": False, "opened": False, "error": None,
              "size_at_listing": listing_stat.st_size if listing_stat else None,
              "size_after_read": None, "prefix_sha256": None,
              "metadata_samples": {"listing": metadata(listing_stat)}, "metadata_comparisons": {},
              "metadata_limits": METADATA_LIMITS}
    try:
        with open(path, "rb") as handle:
            record["opened"] = True
            opened = os.fstat(handle.fileno())
            blob = handle.read(limit)
            extra = handle.read(1)
            record["bytes_read"] = len(blob)
            record["reached_eof"] = not extra
            record["prefix_sha256"] = hashlib.sha256(blob).hexdigest()
            after = os.fstat(handle.fileno())
            record["size_after_read"] = after.st_size
    except OSError as error:
        record["error"] = "errno %s" % error.errno
        return None, record

    # Everything below is recorded even when the final stat fails, so the bytes
    # already read stay available to interpretation and the observations already
    # taken are kept. A failed final stat marks the read changed, which denies a
    # complete-interpretation claim without reporting an absence.
    record["metadata_samples"]["opened"] = metadata(opened)
    record["metadata_samples"]["after_read"] = metadata(after)
    record["metadata_comparisons"] = {
        "listing_to_opened": compare_metadata(listing_stat, opened),
        "opened_to_after_read": compare_metadata(opened, after)}
    try:
        current = os.stat(path)
    except OSError as error:
        record["final_stat_error"] = "errno %s" % error.errno
        record["metadata_samples"]["final_path_stat"] = None
        record["metadata_comparisons"]["opened_to_final_path"] = "final-stat-failed"
        record["changed_during_read"] = True
    else:
        record["metadata_samples"]["final_path_stat"] = metadata(current)
        record["metadata_comparisons"]["opened_to_final_path"] = compare_metadata(opened, current)
    for comparison in record["metadata_comparisons"].values():
        if comparison not in ("same-dev-inode-size-mtime", "left-absent"):
            record["changed_during_read"] = True
    return blob, record


def retained_observed_route(directory, listing_stat):
    """Harness-reported route from this attempt's retained stdout spool."""
    path = os.path.join(directory, "stdout")
    if not os.path.exists(path):
        if listing_stat is None:
            return None
        # The directory listing established a spool that is gone now. That is an
        # observed removal, not an absence of retained evidence.
        return {"source": "stdout", "path": path, "state": "spool-removed-after-listing",
                "route": None, "frame": None, "bytes_read": 0, "reached_eof": False,
                "changed_during_read": True, "error": None, "metadata_samples":
                    {"listing": metadata(listing_stat), "removed_before_read": True},
                "metadata_comparisons": {"listing_to_open": "right-absent"},
                "metadata_limits": METADATA_LIMITS, "listing_size": listing_stat.st_size}
    blob, read = read_bounded_bytes(path, SPOOL_PREFIX_BYTES, listing_stat)
    found, stats = interpret_prefix(blob, read["reached_eof"])
    record = dict(read, **stats)
    record["source"] = "stdout"
    incomplete = uninterpreted_categories(stats, read)
    record["uninterpreted"] = incomplete
    record["interpreted_everything"] = not incomplete
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


def interpret_prefix(blob, reached_eof):
    """Split a byte prefix into lines, count what was not interpreted, and keep
    the first recognised route.

    Every inspected line is classified, including lines after the route frame, so
    a route found early cannot mask later undecodable or uninterpreted content.
    A line is parsed as JSON first; a value that is valid JSON but not an object
    is counted as a non-object frame rather than as non-JSON.
    """
    stats = {"lines": 0, "lines_blank": 0, "lines_undecodable": 0, "lines_non_json": 0,
             "frames_non_object": 0, "frames_unrecognised": 0, "frames_recognised": 0,
             "trailing_partial_line": False, "route_line_index": None}
    found = None
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
    for index, raw in enumerate(raw_lines):
        line = raw.strip()
        if not line:
            stats["lines_blank"] += 1
            continue
        stats["lines"] += 1
        try:
            text = line.decode("utf-8")
        except UnicodeDecodeError:
            stats["lines_undecodable"] += 1
            continue
        try:
            value = json.loads(text)
        except json.JSONDecodeError:
            stats["lines_non_json"] += 1
            continue
        if not isinstance(value, dict):
            stats["frames_non_object"] += 1
            continue
        candidate = frame_route(value)
        if candidate is None:
            stats["frames_unrecognised"] += 1
            continue
        stats["frames_recognised"] += 1
        if found is None:
            found = candidate
            stats["route_line_index"] = index
    return found, stats


def uninterpreted_categories(stats, read):
    """The categories that stop a full interpretation claim, with their counts."""
    reasons = {}
    if read["error"] is not None:
        reasons["read_error"] = read["error"]
    if read["changed_during_read"]:
        reasons["spool_changed_during_read"] = True
    if not read["reached_eof"]:
        reasons["end_of_file_not_reached"] = True
        reasons["bytes_read"] = read["bytes_read"]
    if stats["trailing_partial_line"]:
        reasons["trailing_partial_line"] = True
    for key in ("lines_undecodable", "lines_non_json", "frames_non_object", "frames_unrecognised"):
        if stats[key]:
            reasons[key] = stats[key]
    return reasons


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


REQUIRED_CAPTURE_HEADER = ("cli", "cli_sha256", "database", "captured_at")
CAPTURE_STREAMS = ("stdout", "stderr", "exit")


def sha256_hex(value):
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdefABCDEF" for c in value)


def load_captures(directory, database):
    """Consume CLI captures. This never runs a command.

    A capture set is a directory written by `capture-cli-reads.sh`: a `capture.txt`
    header naming the CLI, its SHA-256, the database and the capture time, one
    `<name><TAB><exit>` line per read, and `<name>.stdout`, `<name>.stderr` and
    `<name>.exit` for each read. A set is loaded only when the header names that
    identity and the recorded database matches the database under analysis. Each
    read must carry all three streams; a read that is incomplete, non-zero or
    unparsable keeps its raw sizes and hashes, states the reason, and is not
    interpreted.
    """
    result = {"directory": directory, "state": "not-supplied", "header": {}, "reads": {},
              "reasons": []}
    if not directory or not os.path.isdir(directory):
        result["reasons"].append("capture directory was not supplied or does not exist")
        return result
    manifest = os.path.join(directory, "capture.txt")
    if not os.path.exists(manifest):
        result["state"] = "manifest-missing"
        result["reasons"].append("capture.txt is absent")
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
    missing_header = [key for key in REQUIRED_CAPTURE_HEADER if not result["header"].get(key)]
    if missing_header:
        result["state"] = "header-incomplete"
        result["missing_header"] = missing_header
        result["reasons"].append("capture header lacks: %s" % ", ".join(missing_header))
        return result
    if not sha256_hex(result["header"]["cli_sha256"]):
        result["state"] = "header-invalid"
        result["reasons"].append("cli_sha256 is not a SHA-256 hex digest: %r" % result["header"]["cli_sha256"])
        return result
    recorded_database = result["header"]["database"]
    if database and os.path.realpath(recorded_database) != os.path.realpath(database):
        result["state"] = "database-mismatch"
        result["header"]["requested_database"] = database
        result["reasons"].append("capture header names database %s" % recorded_database)
        return result
    if not names:
        result["state"] = "no-reads"
        result["reasons"].append("capture header lists no reads")
        return result
    result["state"] = "loaded"
    for name in names:
        entry = {"name": name, "missing_files": [], "reasons": []}
        for suffix in CAPTURE_STREAMS:
            path = os.path.join(directory, "%s.%s" % (name, suffix))
            entry[suffix + "_path"] = path
            if not os.path.exists(path):
                entry[suffix] = None
                entry["missing_files"].append(suffix)
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
        entry["state"] = None
        entry["document"] = None
        if entry["missing_files"]:
            entry["state"] = "incomplete-capture"
            entry["reasons"].append("missing capture streams: %s" % ", ".join(entry["missing_files"]))
        elif entry["exit_code"] is None:
            entry["state"] = "no-exit-record"
            entry["reasons"].append("the exit file does not hold an integer")
        elif entry["exit_code"] != 0:
            entry["state"] = "failed"
            entry["reasons"].append("exit code %d" % entry["exit_code"])
        else:
            entry["state"] = "ok"
        stdout_bytes = entry.pop("_stdout_bytes", None)
        if entry["state"] == "ok":
            try:
                entry["document"] = json.loads((stdout_bytes or b"").decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                entry["state"] = "unparsable-stdout"
                entry["reasons"].append("stdout is not UTF-8 JSON: %s" % error)
        result["reads"][name] = entry
    return result


def nonempty_string(value):
    return isinstance(value, str) and value != ""


def attempt_id_session(attempt_id):
    """The session encoded in a `receive:<session>:<cursor>:<random>` id, or None."""
    parts = attempt_id.split(":")
    if len(parts) == 4 and parts[0] == "receive" and parts[1]:
        return parts[1]
    return None


def same_fields(left, right, keys):
    return all(left.get(key) == right.get(key) for key in keys)


def outcome_state(rows_seen, rows_used, rows_malformed, rows_duplicate, prefix):
    """`ok` only when every row was used once and none was malformed, duplicated
    or conflicting. A row that was dropped, repeated or superseded never leaves
    the read labelled complete."""
    if rows_used and not rows_malformed and not rows_duplicate:
        return "ok"
    if rows_used:
        return "%s-partial" % prefix
    if rows_seen:
        return "%s-malformed" % prefix
    return "%s-empty-list" % prefix


def validate_players(rows):
    """Return (current_by_id, malformed_rows, duplicates, conflicts).

    A repeated id with identical fields counts as a duplicate; a repeated id with
    different fields is a conflict and the first row is kept. Each kept entry
    records the row index that supplied it.
    """
    current = {}
    malformed = []
    conflicts = []
    duplicates = 0
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            malformed.append({"index": index, "reason": "row is not a JSON object"})
            continue
        row_id = row.get("id")
        if not nonempty_string(row_id):
            malformed.append({"index": index, "reason": "id is not a non-empty string"})
            continue
        execution = row.get("execution")
        if execution is not None and not isinstance(execution, dict):
            malformed.append({"index": index, "id": row_id, "reason": "execution is not a JSON object"})
            continue
        fields = {}
        reason = None
        for key in ("attempt", "mode", "phase", "status"):
            value = (execution or {}).get(key)
            if value is not None and not isinstance(value, str):
                reason = "execution.%s is not a string" % key
                break
            fields[key] = value
        if reason:
            malformed.append({"index": index, "id": row_id, "reason": reason})
            continue
        entry = {"current_attempt": fields["attempt"], "mode": fields["mode"], "phase": fields["phase"],
                 "status": fields["status"], "source_index": index}
        if row_id in current:
            if same_fields(current[row_id], entry, ("current_attempt", "mode", "phase", "status")):
                duplicates += 1
                current[row_id].setdefault("duplicate_indices", []).append(index)
            else:
                conflicts.append({"id": row_id, "source_index": index,
                                  "first_index": current[row_id]["source_index"],
                                  "reason": "repeated id with different fields"})
            continue
        current[row_id] = entry
    return current, malformed, duplicates, conflicts


def validate_turns(session, rows, reports, conflicts):
    """Insert this capture's report rows into reports[session].

    Returns (rows_used, duplicates, malformed). A row whose id encodes another
    session, or whose `player` names another session, is not used here and is
    recorded as a conflict, so one capture cannot supply another session's
    attempt. A repeated id with identical content counts as a duplicate; a
    repeated id with different content is a conflict and the first row is kept.
    """
    used = 0
    duplicates = 0
    malformed = []
    per_session = reports.setdefault(session, {})
    for index, row in enumerate(rows):
        if not isinstance(row, dict):
            malformed.append({"index": index, "reason": "row is not a JSON object"})
            continue
        row_id = row.get("id")
        if not nonempty_string(row_id):
            malformed.append({"index": index, "reason": "id is not a non-empty string"})
            continue
        embedded = attempt_id_session(row_id)
        if embedded is not None and embedded != session:
            conflicts.append({"capture_session": session, "attempt_id": row_id, "source_index": index,
                              "reason": "attempt id names session %s" % embedded})
            malformed.append({"index": index, "id": row_id,
                              "reason": "attempt id belongs to another session"})
            continue
        player = row.get("player")
        if player is not None and not isinstance(player, str):
            malformed.append({"index": index, "id": row_id, "reason": "player is not a string"})
            continue
        if isinstance(player, str) and player != session:
            conflicts.append({"capture_session": session, "attempt_id": row_id, "source_index": index,
                              "reason": "row names player %s" % player})
            malformed.append({"index": index, "id": row_id, "reason": "row names another player"})
            continue
        body = row.get("reportBody")
        if body is not None and not isinstance(body, str):
            malformed.append({"index": index, "id": row_id, "reason": "reportBody is not a string"})
            continue
        event = row.get("eventType")
        if event is not None and not isinstance(event, str):
            malformed.append({"index": index, "id": row_id, "reason": "eventType is not a string"})
            continue
        entry = {"report_body": body[:4000] if isinstance(body, str) else None,
                 "event_type": event, "receipt": row.get("receipt"),
                 "capture_session": session, "source_index": index}
        if row_id in per_session:
            if same_fields(per_session[row_id], entry, ("report_body", "event_type", "receipt")):
                duplicates += 1
                per_session[row_id].setdefault("duplicate_indices", []).append(index)
            else:
                conflicts.append({"capture_session": session, "attempt_id": row_id, "source_index": index,
                                  "first_index": per_session[row_id]["source_index"],
                                  "reason": "repeated id with different content"})
            continue
        per_session[row_id] = entry
        used += 1
    return used, duplicates, malformed


def attempt_view(captures):
    """Session and attempt state from CLI captures, each with an explicit state.

    A successful empty list, a missing read, a failed read, an unparsable read, a
    malformed document and a list mixing valid and invalid rows are reported
    separately, so an absent or partial state never appears as a complete
    success. Every row is accounted for in the detail record.
    """
    view = {"current": {}, "reports": {}, "players_state": None, "players_detail": {},
            "player_conflicts": [], "turns_state": {}, "turns_detail": {}, "report_conflicts": []}
    if captures["state"] != "loaded":
        view["players_state"] = "cli-reads-%s" % captures["state"]
        return view
    players = captures["reads"].get("players")
    if players is None:
        view["players_state"] = "players-missing"
    elif players["state"] != "ok":
        view["players_state"] = "players-%s" % players["state"]
    elif not isinstance(players["document"], list):
        view["players_state"] = "players-malformed"
        view["players_detail"] = {"reason": "the players document is not a JSON array"}
    else:
        current, malformed, duplicates, conflicts = validate_players(players["document"])
        view["current"] = current
        view["player_conflicts"] = conflicts
        view["players_detail"] = {"rows_seen": len(players["document"]), "rows_used": len(current),
                                  "rows_malformed": malformed, "rows_duplicate": duplicates,
                                  "rows_conflicting": len(conflicts)}
        view["players_state"] = outcome_state(len(players["document"]), len(current), malformed,
                                              duplicates, "players")
    for name, entry in captures["reads"].items():
        if not name.startswith("turns-"):
            continue
        session = name[len("turns-"):]
        if entry["state"] != "ok":
            view["turns_state"][session] = "turns-%s" % entry["state"]
            continue
        if not isinstance(entry["document"], list):
            view["turns_state"][session] = "turns-malformed"
            view["turns_detail"][session] = {"reason": "the turns document is not a JSON array"}
            continue
        conflicts_before = len(view["report_conflicts"])
        used, duplicates, malformed = validate_turns(session, entry["document"], view["reports"],
                                                     view["report_conflicts"])
        view["turns_state"][session] = outcome_state(len(entry["document"]), used, malformed,
                                                     duplicates, "turns")
        view["turns_detail"][session] = {"rows_seen": len(entry["document"]), "rows_used": used,
                                         "rows_malformed": malformed, "rows_duplicate": duplicates,
                                         "rows_conflicting": len(view["report_conflicts"]) - conflicts_before}
    return view


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
    view = attempt_view(captures)
    players_state = view["players_state"]
    players_resolved = players_state in ("ok", "players-partial", "players-empty-list")
    turns_resolved = ("ok", "turns-partial")

    observed_available = observed_agree = 0
    states = {}
    for record in records:
        states[record["observed_route_state"]] = states.get(record["observed_route_state"], 0) + 1
        if captures["state"] != "loaded":
            session_state = "unavailable"
        else:
            session_state = view["turns_state"].get(record["session"], "turns-missing")
        # The report follows this session's turns outcome, not the players
        # outcome, and it is read only from this session's own capture, so one
        # capture cannot supply another session's attempt.
        session_reports = view["reports"].get(record["session"]) or {}
        record["session_cli_state"] = session_state
        record["report_state"] = session_state
        record["current_execution"] = view["current"].get(record["session"]) if players_resolved else None
        record["report"] = session_reports.get(record["attempt"]) if session_state in turns_resolved else None
        observed = record["observed_route"]
        if observed and observed.get("route"):
            observed_available += 1
            if (record["configured_route"] or {}).get("model") == observed["route"]:
                observed_agree += 1

    capture_summary = {"state": captures["state"], "directory": captures["directory"],
                       "header": captures["header"], "reasons": captures["reasons"],
                       "reads": {name: {"state": entry["state"], "exit_code": entry["exit_code"],
                                        "reasons": entry["reasons"],
                                        "missing_files": entry["missing_files"],
                                        "stdout": entry.get("stdout"), "stderr": entry.get("stderr"),
                                        "stdout_path": entry.get("stdout_path")}
                                 for name, entry in captures["reads"].items()}}
    document = {
        "database": database,
        "attempt_count": len(records),
        "captured_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cli_captures": capture_summary,
        "cli_state": players_state,
        "players_detail": view["players_detail"],
        "player_conflicts": view["player_conflicts"],
        "session_cli_state": view["turns_state"],
        "session_cli_detail": view["turns_detail"],
        "report_conflicts": view["report_conflicts"],
        "route_provenance": ROUTE_PROVENANCE,
        "observed_route_summary": {"available": observed_available,
                                   "unavailable": len(records) - observed_available,
                                   "matches_configured": observed_agree,
                                   "states": states},
        "current_session_observation": view["current"] if players_resolved else None,
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
                      "exit_histogram": histogram, "cli_state": players_state,
                      "observed_route": document["observed_route_summary"]},
                     indent=1, sort_keys=True))


if __name__ == "__main__":
    main()
