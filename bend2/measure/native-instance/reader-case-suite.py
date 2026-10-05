#!/usr/bin/env python3
"""Case suite for the attempt reader's malformed, truncated, removed and
capture-failure paths.

Remote-only. This suite builds synthetic attempt directories and capture sets in
a fresh temporary directory and checks the states the reader reports. It runs no
Baton command, no compiler and no provider request, and it touches no retained
evidence. It is written for execution on an admitted runner, not on the laptop.

Usage: reader-case-suite.py [--keep]
Exit status is 0 when every case matches and 1 when any case differs.
"""
import json
import os
import shutil
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import attempt_exit_records as reader  # noqa: E402

RESULTS = []


def route_frame(provider="deepseek", identifier="deepseek-flash"):
    return json.dumps({"type": "response", "command": "get_state", "success": True,
                       "data": {"model": {"provider": provider, "id": identifier,
                                          "name": "synthetic"}}}).encode("utf-8")


def attempt_dir(root, name, stdout=None, status=b"0\n", argv_model="deepseek/deepseek-flash"):
    directory = os.path.join(root, "fixture.db.attempt-" + name.encode("utf-8").hex())
    os.makedirs(directory)
    with open(os.path.join(directory, "status"), "wb") as handle:
        handle.write(status)
    with open(os.path.join(directory, "native.pid"), "w") as handle:
        handle.write("4242\n")
    with open(os.path.join(directory, "manifest"), "wb") as handle:
        argv = ("/usr/bin/env\0%s\0--model\0%s\0" % ("/synthetic/omp", argv_model)).encode("utf-8")
        header = b"BATONRP1" + b"".join(len(part).to_bytes(8, "little") for part in
                                        (argv, b"/cwd", b"/log", b"", b"recovery", b"/sock"))
        handle.write(header + (0).to_bytes(4, "little") + (0).to_bytes(4, "little"))
        for part in (argv, b"/cwd", b"/log", b"", b"recovery", b"/sock"):
            handle.write(part)
    if stdout is not None:
        with open(os.path.join(directory, "stdout"), "wb") as handle:
            handle.write(stdout)
    return directory


def check(name, condition, detail):
    RESULTS.append((name, bool(condition), detail))
    print("%-4s %s%s" % ("PASS" if condition else "FAIL", name, "" if condition else "  -> " + str(detail)))


def case_route_parsed(root):
    directory = attempt_dir(root, "receive:case-a:1:aaaa", stdout=route_frame() + b"\n")
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("A route parsed from an intact spool", record["state"] == "route-parsed-from-retained-spool"
          and record["route"] == "deepseek/deepseek-flash" and record["interpreted_everything"] is True,
          {k: record.get(k) for k in ("state", "route", "interpreted_everything", "uninterpreted")})


def case_route_then_undecodable(root):
    stdout = route_frame() + b"\n" + b"\xff\xfe not utf8\n"
    directory = attempt_dir(root, "receive:case-b:1:bbbb", stdout=stdout)
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("B route kept while later undecodable bytes are reported",
          record["state"] == "route-parsed-from-retained-spool"
          and record["interpreted_everything"] is False
          and record["uninterpreted"].get("lines_undecodable") == 1,
          {k: record.get(k) for k in ("state", "route", "interpreted_everything", "uninterpreted")})


def case_non_json_line(root):
    directory = attempt_dir(root, "receive:case-c:1:cccc", stdout=b"not-json\n")
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("C a stable non-JSON line prevents a full-interpretation claim",
          record["state"] == "no-route-frame-in-inspected-prefix"
          and record["uninterpreted"].get("lines_non_json") == 1,
          {k: record.get(k) for k in ("state", "interpreted_everything", "uninterpreted")})


def case_non_object_json(root):
    for label, payload in (("number", b"123\n"), ("string", b'"hello"\n'), ("array", b"[1,2]\n")):
        directory = attempt_dir(root, "receive:case-d-" + label + ":1:dddd", stdout=payload)
        record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
        check("D valid non-object JSON counts as a non-object frame (%s)" % label,
              record["state"] == "no-route-frame-in-inspected-prefix"
              and record["uninterpreted"].get("frames_non_object") == 1,
              {k: record.get(k) for k in ("state", "interpreted_everything", "uninterpreted")})


def case_unrecognised_object(root):
    directory = attempt_dir(root, "receive:case-e:1:eeee",
                            stdout=json.dumps({"type": "response", "command": "other"}).encode() + b"\n")
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("E an object with no recognised shape is counted unrecognised",
          record["state"] == "no-route-frame-in-inspected-prefix"
          and record["uninterpreted"].get("frames_unrecognised") == 1,
          {k: record.get(k) for k in ("state", "interpreted_everything", "uninterpreted")})


def case_truncated_spool(root):
    filler = b"y" * (reader.SPOOL_PREFIX_BYTES + (1 << 20))
    directory = attempt_dir(root, "receive:case-f:1:ffff", stdout=filler + b"\n" + route_frame() + b"\n")
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("F a route beyond the prefix is reported as an uninspected prefix",
          record["state"] == "no-route-frame-in-inspected-prefix"
          and record["reached_eof"] is False
          and record["uninterpreted"].get("end_of_file_not_reached") is True
          and record["bytes_read"] == reader.SPOOL_PREFIX_BYTES,
          {k: record.get(k) for k in ("state", "reached_eof", "bytes_read", "trailing_partial_line")})


def case_removed_after_listing(root):
    directory = attempt_dir(root, "receive:case-g:1:gggg", stdout=route_frame() + b"\n")
    path = os.path.join(directory, "stdout")
    listing = reader.listing_stat(path)
    os.unlink(path)
    record = reader.retained_observed_route(directory, listing)
    check("G a spool removed after the listing is an observed removal",
          record is not None and record["state"] == "spool-removed-after-listing",
          None if record is None else {k: record.get(k) for k in ("state", "metadata_comparisons")})


def case_no_spool(root):
    directory = attempt_dir(root, "receive:case-h:1:hhhh", stdout=None)
    record = reader.retained_observed_route(directory, reader.listing_stat(os.path.join(directory, "stdout")))
    check("H no listing and no file means no retained spool", record is None, record)


def capture_set(root, name, header_lines, reads):
    directory = os.path.join(root, name)
    os.makedirs(directory)
    with open(os.path.join(directory, "capture.txt"), "w") as handle:
        handle.write("".join(line + "\n" for line in header_lines))
        for read_name, (exit_code, stdout, stderr) in reads.items():
            handle.write("%s\t%s\n" % (read_name, exit_code))
    for read_name, (exit_code, stdout, stderr) in reads.items():
        for suffix, payload in (("stdout", stdout), ("stderr", stderr), ("exit", "%s\n" % exit_code)):
            if payload is None:
                continue
            with open(os.path.join(directory, "%s.%s" % (read_name, suffix)), "w") as handle:
                handle.write(payload)
    return directory


def header(database, digest=None):
    return ["cli=/synthetic/baton2", "cli_sha256=" + (digest or "a" * 64),
            "database=" + database, "captured_at=2026-01-01T00:00:00Z"]


def case_capture_states(root, database):
    good = capture_set(root, "cap-ok", header(database), {"players": (0, "[]", ""), "turns-s:1": (0, "[]", "")})
    result = reader.load_captures(good, database)
    check("I capture set loads when the header is bound and reads carry three streams",
          result["state"] == "loaded" and len(result["reads"]) == 2, result["state"])

    incomplete = capture_set(root, "cap-header", ["cli=/synthetic/baton2", "database=" + database],
                             {"players": (0, "[]", "")})
    result = reader.load_captures(incomplete, database)
    check("J a header without the CLI hash is refused",
          result["state"] == "header-incomplete" and "cli_sha256" in result.get("missing_header", []),
          result.get("missing_header"))

    bad_hash = capture_set(root, "cap-hash", header(database, digest="not-a-digest"), {"players": (0, "[]", "")})
    result = reader.load_captures(bad_hash, database)
    check("K a malformed CLI hash is refused", result["state"] == "header-invalid", result["state"])

    other = capture_set(root, "cap-other", header(database + ".other"), {"players": (0, "[]", "")})
    result = reader.load_captures(other, database)
    check("L a capture set bound to another database is refused",
          result["state"] == "database-mismatch", result["state"])

    empty = capture_set(root, "cap-empty", header(database), {})
    result = reader.load_captures(empty, database)
    check("M a header with no reads is refused", result["state"] == "no-reads", result["state"])

    failed = capture_set(root, "cap-failed", header(database), {"players": (3, "boom\n", "stderr text")})
    result = reader.load_captures(failed, database)
    entry = result["reads"]["players"]
    check("N a non-zero exit is a failed capture, not an empty result",
          entry["state"] == "failed" and entry["document"] is None and entry["reasons"],
          {k: entry.get(k) for k in ("state", "exit_code", "reasons")})

    missing_stderr = capture_set(root, "cap-missing", header(database),
                                 {"players": (0, "[]", None)})
    result = reader.load_captures(missing_stderr, database)
    entry = result["reads"]["players"]
    check("O a read without raw stderr is an incomplete capture",
          entry["state"] == "incomplete-capture" and entry["missing_files"] == ["stderr"],
          {k: entry.get(k) for k in ("state", "missing_files")})

    empty_out = capture_set(root, "cap-emptyout", header(database), {"players": (0, "", "")})
    result = reader.load_captures(empty_out, database)
    entry = result["reads"]["players"]
    check("P exit 0 with empty stdout is unparsable, not an empty success",
          entry["state"] == "unparsable-stdout" and entry["document"] is None, entry["state"])


def case_view_states(root, database):
    failed = capture_set(root, "view-failed", header(database), {"players": (1, "", "error")})
    current, reports, state, turns = reader.attempt_view(reader.load_captures(failed, database))
    check("Q a failed players read reports players-failed", state == "players-failed", state)

    empty = capture_set(root, "view-empty", header(database), {"players": (0, "[]", "")})
    current, reports, state, turns = reader.attempt_view(reader.load_captures(empty, database))
    check("R an empty players list is its own state", state == "players-empty-list" and current == {}, state)

    malformed = capture_set(root, "view-malformed", header(database), {"players": (0, "[1]", "")})
    current, reports, state, turns = reader.attempt_view(reader.load_captures(malformed, database))
    check("S malformed players rows are not an empty success", state == "players-malformed", state)

    turns = capture_set(root, "view-turns", header(database),
                        {"players": (0, "[]", ""), "turns-known": (1, "", "error")})
    current, reports, state, turns_state = reader.attempt_view(reader.load_captures(turns, database))
    check("T a failed turns read is recorded for that session",
          turns_state.get("known") == "turns-failed", turns_state)


def main():
    keep = "--keep" in sys.argv
    root = tempfile.mkdtemp(prefix="reader-cases-")
    database = os.path.join(root, "fixture.db")
    try:
        case_route_parsed(root)
        case_route_then_undecodable(root)
        case_non_json_line(root)
        case_non_object_json(root)
        case_unrecognised_object(root)
        case_truncated_spool(root)
        case_removed_after_listing(root)
        case_no_spool(root)
        case_capture_states(root, database)
        case_view_states(root, database)
        records = reader.attempt_records(database)
        check("U attempt_records reports one record per synthetic attempt",
              len(records) == len([name for name in os.listdir(root) if ".attempt-" in name]),
              len(records))
        with open(os.path.join(root, "results.json"), "w") as handle:
            json.dump([{"case": name, "passed": passed, "detail": detail} for name, passed, detail in RESULTS],
                      handle, indent=1, sort_keys=True)
    finally:
        if not keep:
            shutil.rmtree(root, ignore_errors=True)
        else:
            print("kept: %s" % root)
    failed = [name for name, passed, _ in RESULTS if not passed]
    print("%d/%d cases passed" % (len(RESULTS) - len(failed), len(RESULTS)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
