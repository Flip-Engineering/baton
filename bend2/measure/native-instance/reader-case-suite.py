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
import traceback

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
    view = reader.attempt_view(reader.load_captures(failed, database))
    check("Q a failed players read reports players-failed",
          view["players_state"] == "players-failed" and view["current"] == {},
          view["players_state"])

    empty = capture_set(root, "view-empty", header(database), {"players": (0, "[]", "")})
    view = reader.attempt_view(reader.load_captures(empty, database))
    check("R an empty players list is its own state",
          view["players_state"] == "players-empty-list" and view["current"] == {},
          view["players_state"])

    malformed = capture_set(root, "view-malformed", header(database), {"players": (0, "[1]", "")})
    view = reader.attempt_view(reader.load_captures(malformed, database))
    check("S a players document of non-objects is malformed, not an empty success",
          view["players_state"] == "players-malformed", view["players_state"])

    turns_only = capture_set(root, "view-turns", header(database),
                             {"players": (0, "[]", ""), "turns-known": (1, "", "error")})
    view = reader.attempt_view(reader.load_captures(turns_only, database))
    check("T a failed turns read is recorded for that session",
          view["turns_state"].get("known") == "turns-failed", view["turns_state"])


def case_view_row_validation(root, database):
    empty_row = capture_set(root, "view-emptyrow", header(database), {"players": (0, "[{}]", "")})
    view = reader.attempt_view(reader.load_captures(empty_row, database))
    check("V a players row with no id is malformed, not an ok empty state",
          view["players_state"] == "players-malformed" and view["current"] == {}
          and view["players_detail"]["rows_malformed"],
          {k: view.get(k) for k in ("players_state", "players_detail")})

    mixed = capture_set(root, "view-mixed", header(database),
                        {"players": (0, '[{"id":"s1","execution":{"attempt":"a1","mode":"retained",'
                                     '"phase":"running","status":""}},{"id":5}]', "")})
    view = reader.attempt_view(reader.load_captures(mixed, database))
    check("W mixed valid and invalid players rows report players-partial with the valid row kept",
          view["players_state"] == "players-partial" and list(view["current"]) == ["s1"]
          and len(view["players_detail"]["rows_malformed"]) == 1,
          {k: view.get(k) for k in ("players_state", "current", "players_detail")})

    bad_field = capture_set(root, "view-badfield", header(database),
                            {"players": (0, '[{"id":"s2","execution":{"attempt":42}}]', "")})
    view = reader.attempt_view(reader.load_captures(bad_field, database))
    check("X a players row with a wrong execution field type is malformed",
          view["players_state"] == "players-malformed" and view["current"] == {},
          {k: view.get(k) for k in ("players_state", "players_detail")})

    turns_bad = capture_set(root, "view-turnsbad", header(database),
                            {"players": (0, "[]", ""),
                             "turns-s1": (0, '[1, {"id": {}, "reportBody": "x"}]', "")})
    view = reader.attempt_view(reader.load_captures(turns_bad, database))
    check("Y turns rows with non-string ids are malformed without raising",
          view["turns_state"].get("s1") == "turns-malformed" and view["reports"].get("s1", {}) == {},
          {k: view.get(k) for k in ("turns_state", "turns_detail")})

    turns_mixed = capture_set(root, "view-turnsmixed", header(database),
                              {"players": (0, "[]", ""),
                               "turns-s1": (0, '[{"id":"t1","reportBody":"hello",'
                                                '"eventType":"agent_end"},{"id":[]}]', "")})
    view = reader.attempt_view(reader.load_captures(turns_mixed, database))
    check("Z mixed turns rows report turns-partial and keep the valid report",
          view["turns_state"].get("s1") == "turns-partial"
          and view["reports"]["s1"]["t1"]["report_body"] == "hello"
          and view["reports"]["s1"]["t1"]["capture_session"] == "s1"
          and len(view["turns_detail"]["s1"]["rows_malformed"]) == 1,
          {k: view.get(k) for k in ("turns_state", "reports", "turns_detail")})


def case_final_stat_failure(root):
    directory = attempt_dir(root, "receive:case-final:1:jjjj", stdout=route_frame() + b"\n")
    path = os.path.join(directory, "stdout")
    listing = reader.listing_stat(path)
    real_stat = reader.os.stat
    calls = {}

    def failing_stat(target, *arguments, **keywords):
        key = str(target)
        calls[key] = calls.get(key, 0) + 1
        # The first os.stat for this path comes from the existence check; the
        # second is the final path stat after the read, which this case fails.
        if key == path and calls[key] == 2:
            raise OSError(2, "simulated removal after the read")
        return real_stat(target, *arguments, **keywords)

    reader.os.stat = failing_stat
    try:
        record = reader.retained_observed_route(directory, listing)
    finally:
        reader.os.stat = real_stat
    check("F2 a failed final stat keeps the bytes and the earlier observations",
          record["route"] == "deepseek/deepseek-flash"
          and record["changed_during_read"] is True
          and record["interpreted_everything"] is False
          and record.get("final_stat_error") is not None
          and record["metadata_samples"].get("opened") is not None,
          {k: record.get(k) for k in ("route", "state", "changed_during_read",
                                      "interpreted_everything", "final_stat_error")})


def case_composition(root, database):
    captures_directory = capture_set(
        root, "view-composition", header(database),
        {"players": (1, "", "error"),
         "turns-case-a": (0, '[{"id":"receive:case-a:1:aaaa","reportBody":"independent report",'
                             '"eventType":"agent_end","receipt":null}]', "")})
    out_path = os.path.join(root, "composition.json")
    argv = sys.argv
    sys.argv = ["attempt_exit_records.py", database, out_path, "--captures", captures_directory]
    try:
        reader.main()
    finally:
        sys.argv = argv
    with open(out_path) as handle:
        document = json.load(handle)
    matches = [record for record in document["attempts"]
               if record["attempt"] == "receive:case-a:1:aaaa"]
    record = matches[0] if matches else {}
    check("Z2 a successful turns read survives a failed players read in the output document",
          document["cli_state"] == "players-failed"
          and record.get("current_execution") is None
          and record.get("report_state") == "ok"
          and (record.get("report") or {}).get("report_body") == "independent report",
          {k: record.get(k) for k in ("session_cli_state", "report_state", "current_execution", "report")})


def case_duplicate_and_conflict_rows(root, database):
    duplicate_players = capture_set(
        root, "dup-players", header(database),
        {"players": (0, '[{"id":"s1","execution":{"attempt":"a1","mode":"retained","phase":"running",'
                         '"status":""}},{"id":"s1","execution":{"attempt":"a1","mode":"retained",'
                         '"phase":"running","status":""}}]', "")})
    view = reader.attempt_view(reader.load_captures(duplicate_players, database))
    check("AA a repeated identical players row is accounted as a duplicate, not complete",
          view["players_state"] == "players-partial"
          and view["players_detail"]["rows_duplicate"] == 1
          and view["players_detail"]["rows_used"] == 1
          and view["players_detail"]["rows_seen"] == 2,
          {k: view.get(k) for k in ("players_state", "players_detail")})

    conflicting_players = capture_set(
        root, "conflict-players", header(database),
        {"players": (0, '[{"id":"s1","execution":{"attempt":"a1","phase":"running"}},'
                         '{"id":"s1","execution":{"attempt":"a1","phase":"exited"}}]', "")})
    view = reader.attempt_view(reader.load_captures(conflicting_players, database))
    check("AB a repeated players row with different fields keeps the first and records a conflict",
          view["players_state"] == "players-partial"
          and view["players_detail"]["rows_conflicting"] == 1
          and view["current"]["s1"]["phase"] == "running"
          and view["current"]["s1"]["source_index"] == 0
          and len(view["player_conflicts"]) == 1,
          {k: view.get(k) for k in ("players_state", "players_detail", "player_conflicts")})

    duplicate_turns = capture_set(
        root, "dup-turns", header(database),
        {"players": (0, "[]", ""),
         "turns-s1": (0, '[{"id":"t1","reportBody":"same","eventType":"agent_end"},'
                         '{"id":"t1","reportBody":"same","eventType":"agent_end"}]', "")})
    view = reader.attempt_view(reader.load_captures(duplicate_turns, database))
    check("AC a repeated identical turns row is accounted as a duplicate",
          view["turns_state"].get("s1") == "turns-partial"
          and view["turns_detail"]["s1"]["rows_duplicate"] == 1
          and view["reports"]["s1"]["t1"]["report_body"] == "same",
          {k: view.get(k) for k in ("turns_state", "turns_detail")})

    conflicting_turns = capture_set(
        root, "conflict-turns", header(database),
        {"players": (0, "[]", ""),
         "turns-s1": (0, '[{"id":"t1","reportBody":"first"},{"id":"t1","reportBody":"second"}]', "")})
    view = reader.attempt_view(reader.load_captures(conflicting_turns, database))
    check("AD a repeated turns row with different content keeps the first and records a conflict",
          view["turns_state"].get("s1") == "turns-partial"
          and view["turns_detail"]["s1"]["rows_conflicting"] == 1
          and view["reports"]["s1"]["t1"]["report_body"] == "first"
          and len(view["report_conflicts"]) == 1,
          {k: view.get(k) for k in ("turns_state", "turns_detail", "report_conflicts")})

    other_player = capture_set(
        root, "other-player", header(database),
        {"players": (0, "[]", ""),
         "turns-s1": (0, '[{"id":"t1","player":"s2","reportBody":"elsewhere"}]', "")})
    view = reader.attempt_view(reader.load_captures(other_player, database))
    check("AE a turns row naming another player is a conflict and is not used",
          view["turns_state"].get("s1") == "turns-malformed" and view["reports"].get("s1", {}) == {}
          and len(view["report_conflicts"]) == 1,
          {k: view.get(k) for k in ("turns_state", "report_conflicts")})


def case_conflicting_sessions(root, database):
    shared_id = "receive:case-a:1:aaaa"
    captures_directory = capture_set(
        root, "view-crossed", header(database),
        {"players": (0, "[]", ""),
         "turns-case-a": (0, json.dumps([{"id": shared_id, "player": "case-a",
                                          "reportBody": "from case-a", "eventType": "agent_end",
                                          "receipt": None}]), ""),
         "turns-other": (0, json.dumps([{"id": shared_id, "player": "other",
                                         "reportBody": "from other", "eventType": "agent_end",
                                         "receipt": None}]), "")})
    out_path = os.path.join(root, "crossed.json")
    argv = sys.argv
    sys.argv = ["attempt_exit_records.py", database, out_path, "--captures", captures_directory]
    try:
        reader.main()
    finally:
        sys.argv = argv
    with open(out_path) as handle:
        document = json.load(handle)
    matches = [record for record in document["attempts"] if record["attempt"] == shared_id]
    record = matches[0] if matches else {}
    report = record.get("report") or {}
    check("AF an attempt keeps its own session's capture when another capture carries the same id",
          report.get("capture_session") == "case-a" and report.get("report_body") == "from case-a"
          and any(entry.get("attempt_id") == shared_id and entry.get("capture_session") == "other"
                  for entry in document["report_conflicts"]),
          {"report": report, "conflicts": document["report_conflicts"]})


def case_long_body_comparison(root, database):
    prefix = "p" * (reader.REPORT_PREVIEW_CHARS + 200)
    differing = capture_set(
        root, "long-suffix", header(database),
        {"players": (0, "[]", ""),
         "turns-s1": (0, json.dumps([
             {"id": "t1", "reportBody": prefix + "-one", "eventType": "agent_end"},
             {"id": "t1", "reportBody": prefix + "-two", "eventType": "agent_end"}]), "")})
    view = reader.attempt_view(reader.load_captures(differing, database))
    entry = view["reports"]["s1"]["t1"]
    check("AG bodies sharing a long prefix with different suffixes are a conflict, not a duplicate",
          view["turns_state"].get("s1") == "turns-partial"
          and view["turns_detail"]["s1"]["rows_conflicting"] == 1
          and view["turns_detail"]["s1"]["rows_duplicate"] == 0
          and entry["report_body_truncated"] is True
          and entry["report_body_chars"] == len(prefix) + 4
          and entry["report_body"] == (prefix + "-one")[:reader.REPORT_PREVIEW_CHARS],
          {k: view.get(k) for k in ("turns_state", "turns_detail")})

    identical = capture_set(
        root, "long-identical", header(database),
        {"players": (0, "[]", ""),
         "turns-s1": (0, json.dumps([
             {"id": "t2", "reportBody": prefix + "-same", "eventType": "agent_end"},
             {"id": "t2", "reportBody": prefix + "-same", "eventType": "agent_end"}]), "")})
    view = reader.attempt_view(reader.load_captures(identical, database))
    check("AH identical long bodies are still a duplicate, with the digest retained",
          view["turns_state"].get("s1") == "turns-partial"
          and view["turns_detail"]["s1"]["rows_duplicate"] == 1
          and view["turns_detail"]["s1"]["rows_conflicting"] == 0
          and view["reports"]["s1"]["t2"]["report_body_sha256"] is not None,
          {k: view.get(k) for k in ("turns_state", "turns_detail")})


def run_cases(root, database):
    case_route_parsed(root)
    case_route_then_undecodable(root)
    case_non_json_line(root)
    case_non_object_json(root)
    case_unrecognised_object(root)
    case_truncated_spool(root)
    case_removed_after_listing(root)
    case_no_spool(root)
    case_final_stat_failure(root)
    case_capture_states(root, database)
    case_view_states(root, database)
    case_view_row_validation(root, database)
    case_duplicate_and_conflict_rows(root, database)
    case_long_body_comparison(root, database)
    case_composition(root, database)
    case_conflicting_sessions(root, database)
    records = reader.attempt_records(database)
    check("U attempt_records reports one record per synthetic attempt",
          len(records) == len([name for name in os.listdir(root) if ".attempt-" in name]),
          len(records))


def write_results(root, failure):
    """Best effort: keep the per-case results and any termination failure."""
    try:
        with open(os.path.join(root, "results.json"), "w") as handle:
            json.dump({"cases": [{"case": name, "passed": passed, "detail": detail}
                                 for name, passed, detail in RESULTS],
                       "termination_failure": failure}, handle, indent=1, sort_keys=True)
    except OSError as error:
        print("could not write results.json: %s" % error, file=sys.stderr)


def main():
    arguments = [argument for argument in sys.argv[1:] if argument != "--keep"]
    keep = "--keep" in sys.argv
    supplied = None
    if arguments:
        supplied = os.path.abspath(arguments[0])
        if os.path.exists(supplied):
            raise SystemExit(
                "Refusing to reuse an existing directory: %s. Pass a fresh directory so earlier "
                "case results stay in place." % supplied)
        os.makedirs(supplied)
        root = supplied
    else:
        root = tempfile.mkdtemp(prefix="reader-cases-")
    database = os.path.join(root, "fixture.db")
    print("case root: %s" % root, flush=True)
    failure = None
    try:
        run_cases(root, database)
    except BaseException as error:
        # Includes KeyboardInterrupt: any incomplete termination is unsuccessful
        # and keeps its directory, even when every completed case had passed.
        failure = {"type": type(error).__name__, "message": str(error),
                   "traceback": traceback.format_exc()}
        RESULTS.append(("suite-terminated", False, failure["type"]))
        print("case suite terminated: %s" % error, file=sys.stderr)
    finally:
        write_results(root, failure)
        failed = [name for name, passed, _ in RESULTS if not passed]
        if failed or keep or supplied:
            print("retained: %s" % root, flush=True)
        else:
            shutil.rmtree(root, ignore_errors=True)
    failed = [name for name, passed, _ in RESULTS if not passed]
    print("%d/%d cases passed" % (len(RESULTS) - len(failed), len(RESULTS)))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
