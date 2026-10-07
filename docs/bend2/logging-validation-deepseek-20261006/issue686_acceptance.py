#!/usr/bin/env python3
"""Independent acceptance checks for baton issue #686, the coordinator log policy.

This drives the coordinator CLI only. Expectations come from the contract in
docs/bend2/logging.md and from the acceptance checks assigned to the validator,
never from the implementation's own tests.

    python3 issue686_acceptance.py --exe .scratch/bend2/baton2 [--only NAME ...]

Each check prints one JSON object: {"check", "status", "detail"}. Status is
PASS, FAIL (the observed behaviour contradicts the stated contract), or BLOCKED
(the behaviour contradicts an acceptance requirement that the stated contract
does not yet cover). The process exits 1 when any check fails.
"""
import argparse
import json
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time

CHECKS = []


def check(fn):
    CHECKS.append(fn)
    return fn


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True)


class Board:
    """One isolated coordinator database and the fixtures a check needs."""

    def __init__(self, exe, root, name):
        self.exe = str(pathlib.Path(exe).resolve())
        self.root = pathlib.Path(root) / name
        self.cwd = self.root / "work"
        self.cwd.mkdir(parents=True)
        self.db = self.cwd / "state.db"
        self.task = self.cwd / "task.txt"
        self.task.write_text("acceptance task\n")
        self.events = self.cwd / "events.jsonl"
        self.fixture = self.cwd / "fixture-harness"
        self.repo = self.cwd / "repository"
        self.repo.mkdir()
        self.checkouts = self.cwd / "checkouts"
        self.checkouts.mkdir()
        git("init", "-q", "-b", "main", cwd=self.repo)
        git("config", "user.email", "acceptance@example.invalid", cwd=self.repo)
        git("config", "user.name", "Acceptance", cwd=self.repo)
        (self.repo / "seed.txt").write_text("seed\n")
        git("add", "seed.txt", cwd=self.repo)
        git("commit", "-q", "-m", "seed", cwd=self.repo)
        self.base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(self.repo), check=True,
            capture_output=True, text=True).stdout.strip()
        self.call("attach", "root", "native-fixture", "root-session", "root-endpoint")
        self.call("role", "root", "principal-conductor")

    # -- CLI ---------------------------------------------------------------

    def call(self, *args, expect=0, timeout=180):
        done = subprocess.run([self.exe, str(self.db), *args], text=True,
                              capture_output=True, timeout=timeout)
        if expect is not None and done.returncode != expect:
            raise AssertionError(
                "command %r exited %d (want %s)\nstdout: %s\nstderr: %s"
                % (args, done.returncode, expect, done.stdout[:2000], done.stderr[:2000]))
        return done

    def json_call(self, *args, expect=0):
        done = self.call(*args, expect=expect)
        return json.loads(done.stdout)

    def recruit(self, name, harness="omp", parent="root"):
        return self.call("recruit", name, parent, harness, "model", "low", str(self.repo),
                         name + "-branch", str(self.checkouts / name), self.base)

    # -- fixture native process -------------------------------------------

    def run_turn(self, player, turn_id, log, frames, extra="", expect=0):
        self.events.write_text("\n".join(frames) + "\n")
        body = ("import pathlib, sys\n"
                "for _ in range(3): sys.stdin.readline()\n"
                "sys.stdout.write(pathlib.Path('events.jsonl').read_text())\n"
                "sys.stdout.flush()\n")
        self.fixture.write_text("#!/usr/bin/env python3\n" + body + extra
                                + "\nassert sys.stdin.read() == ''\n")
        self.fixture.chmod(0o755)
        return self.call("turn", player, turn_id, str(self.fixture), "model", "low",
                         str(self.cwd), str(self.task), str(log), "", expect=expect)

    def spawn_turn(self, player, turn_id, log, frames, extra=""):
        self.events.write_text("\n".join(frames) + "\n")
        body = ("import pathlib, sys\n"
                "for _ in range(3): sys.stdin.readline()\n"
                "sys.stdout.write(pathlib.Path('events.jsonl').read_text())\n"
                "sys.stdout.flush()\n")
        self.fixture.write_text("#!/usr/bin/env python3\n" + body + extra
                                + "\nassert sys.stdin.read() == ''\n")
        self.fixture.chmod(0o755)
        return subprocess.Popen(
            [self.exe, str(self.db), "turn", player, turn_id, str(self.fixture), "model",
             "low", str(self.cwd), str(self.task), str(log), ""],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # -- log inspection ----------------------------------------------------

    @staticmethod
    def segments(log, limit=16):
        found = {}
        for index in range(1, limit + 1):
            path = log.parent / ("%s.%d" % (log.name, index))
            if path.is_file():
                found[index] = path
        return found

    @staticmethod
    def frames_of(path):
        out = []
        for line in path.read_text(errors="replace").splitlines():
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                out.append(value)
        return out

    @staticmethod
    def ids_in_order(log, segments):
        """The reader's order: highest numbered segment first, then the live log."""
        ids = []
        for index in sorted(segments, reverse=True):
            ids.extend(frame.get("id") for frame in Board.frames_of(segments[index])
                       if frame.get("id") is not None)
        ids.extend(frame.get("id") for frame in Board.frames_of(log)
                   if frame.get("id") is not None)
        return ids


def rot_frame(index, pad=20000):
    return json.dumps({"type": "response", "id": "r%d" % index, "command": "probe",
                       "pad": "y" * pad})


def terminal(text="Acceptance answer"):
    return json.dumps({"type": "agent_end", "isTerminal": True,
                       "messages": [{"role": "assistant",
                                     "content": [{"type": "text", "text": text}]}]})


def tool_update(call_id, text):
    return json.dumps({"type": "tool_execution_update", "toolCallId": call_id,
                       "toolName": "bash",
                       "partialResult": {"content": [{"type": "text", "text": text}]}})


# ---------------------------------------------------------------- checks


@check
def rotation_depth(board):
    """The retained segment count and index ceiling per configured keep_segments.

    docs/bend2/logging.md: "the numbered segments shift one position up, the
    replacement of the highest one included". The implementation comment at
    segment_at states rotation never produces an index above the retention
    count. Both are checked for every admitted value.
    """
    detail = {}
    ok = True
    for keep in (1, 2, 3, 4):
        worker = "depth-%d" % keep
        board.recruit(worker)
        log = board.cwd / ("%s.jsonl" % worker)
        board.call("logs", worker, "default", "65536", str(keep))
        frames = [rot_frame(i) for i in range(16)] + [terminal()]
        board.run_turn(worker, "%s-t1" % worker, log, frames)
        segments = board.segments(log)
        retained = board.ids_in_order(log, segments)
        wanted = ["r%d" % i for i in range(16)]
        suffix = wanted[len(wanted) - len(retained):]
        entry = {
            "configured": keep,
            "segments_present": sorted(segments),
            "segment_count": len(segments),
            "max_index": max(segments) if segments else 0,
            "retained_frames": len(retained),
            "retained_is_contiguous_suffix": retained == suffix,
            "live_bytes": log.stat().st_size,
        }
        entry["count_matches_docs"] = len(segments) == keep
        entry["index_within_count"] = (max(segments) if segments else 0) <= keep
        if not (entry["count_matches_docs"] and entry["index_within_count"]
                and entry["retained_is_contiguous_suffix"]):
            ok = False
        detail[worker] = entry
    return ("PASS" if ok else "FAIL"), detail


@check
def pending_input_gate(board):
    """A session with unacknowledged input rotates nothing and cleans nothing."""
    worker = "pending"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    board.call("message", "hold-1", "root", worker, "guidance", "Answer before rotating.")
    frames = [rot_frame(i) for i in range(10)] + [terminal()]
    board.run_turn(worker, "pending-t1", log, frames)
    segments = board.segments(log)
    live = board.frames_of(log)
    skipped = [f for f in live if f.get("skipped") == "pending-input"]
    storage = board.json_call("logs-storage")
    entry = [row for row in storage["logs"] if row["path"] == str(log)][0]
    clean = board.json_call("logs-clean", worker)
    inbox = board.json_call("inbox", worker)
    detail = {
        "segments_after_over_budget_turn": sorted(segments),
        "live_bytes": log.stat().st_size,
        "live_exceeds_budget": log.stat().st_size > 65536,
        "rotation_skipped_frames": len(skipped),
        "storage_pendingInput": entry.get("pendingInput"),
        "storage_pendingBytes": entry.get("pendingBytes"),
        "storage_eligible": [row["index"] for row in entry["rotated"] if row["eligible"]],
        "clean_removed": clean["removed"],
        "clean_skipped": clean.get("skipped"),
        "clean_pendingInput": clean.get("pendingInput"),
        "inbox_still_holds_input": [m["id"] for m in inbox],
    }
    ok = (not segments
          and detail["live_exceeds_budget"]
          and len(skipped) >= 1
          and clean["removed"] == []
          and clean.get("skipped") == "pending-input"
          and "hold-1" in detail["inbox_still_holds_input"])
    if entry.get("pendingBytes") is None:
        return "BLOCKED", dict(detail, blocked_on="logs-storage has no pendingBytes field")
    return ("PASS" if ok else "FAIL"), detail


@check
def cleanup_eligibility(board):
    """logs-clean removes exactly the segments logs-storage marks eligible."""
    worker = "clean"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "4")
    frames = [rot_frame(i) for i in range(24)] + [terminal()]
    board.run_turn(worker, "clean-t1", log, frames)
    segments_before = board.segments(log)
    # Sentinels the cleanup surface must not name: a stderr file, a re-attach
    # checkpoint, its temporary name, and an attempt directory.
    sentinels = {
        log.parent / (log.name + ".stderr"): "stderr kept\n",
        log.parent / (log.name + ".pending"): "checkpoint kept\n",
        log.parent / (log.name + ".pending.tmp.1"): "temporary checkpoint kept\n",
    }
    for path, body in sentinels.items():
        path.write_text(body)
    attempt = board.cwd / "state.db.attempt-sentinel"
    attempt.mkdir()
    (attempt / "stdout").write_text("retained raw stream\n")
    board.call("logs", worker, "default", "65536", "2")
    storage = board.json_call("logs-storage")
    entry = [row for row in storage["logs"] if row["path"] == str(log)][0]
    preview = [row["index"] for row in entry["rotated"] if row["eligible"]]
    answer = board.json_call("logs-clean", worker)
    removed = [item["index"] for item in answer["removed"]]
    segments_after = board.segments(log)
    second = board.json_call("logs-clean", worker)
    detail = {
        "segments_before_clean": sorted(segments_before),
        "preview_eligible": preview,
        "clean_removed": removed,
        "removed_all_reported_ok": all(item["removed"] for item in answer["removed"]),
        "segments_after_clean": sorted(segments_after),
        "live_present": log.is_file(),
        "kept_indices_present": [i for i in (1, 2) if i in segments_after],
        "second_clean_removed": second["removed"],
        "sentinels_survived": {path.name: path.is_file() for path in sentinels},
        "attempt_sentinel_survived": (attempt / "stdout").is_file(),
        "removed_paths_within_log_segments": all(
            pathlib.Path(item["path"]).parent == log.parent
            and pathlib.Path(item["path"]).name.startswith(log.name + ".")
            for item in answer["removed"]),
    }
    ok = (removed == preview
          and detail["removed_all_reported_ok"]
          and log.is_file()
          and all(i in segments_after for i in (1, 2))
          and second["removed"] == []
          and all(detail["sentinels_survived"].values())
          and detail["attempt_sentinel_survived"])
    return ("PASS" if ok else "FAIL"), detail


@check
def policy_and_schema(board):
    """Accepted policy values against docs/bend2/logging.md, and the old schema."""
    worker = "policy"
    board.recruit(worker)
    cases = {}

    def attempted(label, **kwargs):
        args = ["logs", worker]
        for key in ("level", "budget", "segments"):
            args.append(kwargs.get(key, ""))
        while len(args) > 2 and args[-1] == "":
            args.pop()
        done = board.call(*args, expect=None)
        stored = board.json_call("logs", worker) if done.returncode == 0 else None
        cases[label] = {"argv": args[2:], "exit": done.returncode,
                        "stderr": done.stderr.strip()[:200], "stored": stored}

    def stored_keep():
        con = sqlite3.connect(str(board.db))
        row = con.execute("SELECT keep_segments FROM log_policies WHERE session=?",
                          (worker,)).fetchone()
        con.close()
        return None if row is None else row[0]

    attempted("segments_4", level="default", budget="65536", segments="4")
    keep_before = stored_keep()
    attempted("segments_5", level="default", budget="65536", segments="5")
    attempted("segments_7", level="default", budget="65536", segments="7")
    attempted("segments_64", level="default", budget="65536", segments="64")
    keep_after = stored_keep()
    attempted("segments_0", level="default", budget="65536", segments="0")
    attempted("budget_65535", level="default", budget="65535", segments="2")
    attempted("budget_65536", level="default", budget="65536", segments="2")
    attempted("budget_4294967295", level="default", budget="4294967295", segments="2")
    attempted("budget_4294967296", level="default", budget="4294967296", segments="2")

    con = sqlite3.connect(str(board.db))
    schema = con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name IN "
        "('log_policies','log_files') ORDER BY name").fetchall()
    rows = con.execute("SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    con.close()

    detail = {"cases": cases, "log_policies_schema": [row[0] for row in schema],
              "policy_rows_after": rows,
              "keep_stored_before_above_four_attempts": keep_before,
              "keep_stored_after_above_four_attempts": keep_after,
              "policy_row_preserved_across_refusals": keep_before == keep_after}
    ceiling_ok = cases["segments_5"]["exit"] == 0 and cases["segments_7"]["exit"] == 0
    docs_match = (cases["segments_0"]["exit"] == 2
                  and cases["budget_65535"]["exit"] == 2
                  and cases["budget_65536"]["exit"] == 0
                  and cases["budget_4294967295"]["exit"] == 0
                  and cases["budget_4294967296"]["exit"] == 2
                  and cases["segments_4"]["exit"] == 0)
    detail["docs_match"] = docs_match
    detail["ceiling_removed"] = ceiling_ok
    if not docs_match:
        return "FAIL", detail
    if not ceiling_ok:
        return "BLOCKED", dict(detail, blocked_on=(
            "keep_segments above 4 refused; the acceptance rule allows only "
            "representational bounds, and the migration of an existing "
            "log_policies CHECK (1..4) table is untested in this candidate"))
    return "PASS", detail


@check
def segments_above_four_on_old_schema(board):
    """The >4 request against the table the 5c binary creates itself.

    The reproducer is the candidate's own schema; no hypothetical table is
    built. Existing policy rows and the log_files registry are checked for
    survival across the request.
    """
    worker = "migrate"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "4")
    board.run_turn(worker, "migrate-t1", log, [rot_frame(0, 200), terminal()])
    con = sqlite3.connect(str(board.db))
    old_schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    before_policies = con.execute(
        "SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    before_files = con.execute("SELECT session,log FROM log_files").fetchall()
    con.close()
    done = board.call("logs", worker, "default", "65536", "7", expect=None)
    con = sqlite3.connect(str(board.db))
    after_policies = con.execute(
        "SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    after_files = con.execute("SELECT session,log FROM log_files").fetchall()
    new_schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    con.close()
    detail = {
        "old_schema": old_schema,
        "schema_after_request": new_schema,
        "request_exit": done.returncode,
        "request_stderr": done.stderr.strip()[:200],
        "policies_before": before_policies,
        "policies_after": after_policies,
        "files_before": before_files,
        "files_after": after_files,
        "registry_preserved": before_files == after_files,
    }
    if done.returncode != 0:
        return "BLOCKED", dict(detail, blocked_on=(
            "keep_segments=7 refused; the acceptance rule requires an existing "
            "log_policies CHECK (1..4) table to migrate while every policy row "
            "and log_files row survives"))
    detail["policies_preserved"] = before_policies == after_policies
    migrated = not any("BETWEEN 1 AND 4" in (sql or "") for sql in new_schema)
    detail["constraint_migrated"] = migrated
    return ("PASS" if (detail["registry_preserved"] and detail["policies_preserved"]
                       and migrated) else "FAIL"), detail


@check
def only_copy_evidence(board):
    """Frames that are the only copy survive through database and attempt files."""
    worker = "onlycopy"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "diagnostic", "65536", "2")
    frames = [rot_frame(i) for i in range(20)] + [terminal("Only copy answer")]
    board.run_turn(worker, "onlycopy-t1", log, frames)
    segments = board.segments(log)
    retained_ids = board.ids_in_order(log, segments)
    delivered = board.json_call("delivery", "onlycopy-t1")
    storage = board.json_call("logs-storage")
    entries = [row for row in storage["logs"] if row["path"] == str(log)]
    attempts = [row for row in storage["attempts"] if row["session"] == worker]
    attempt_files = {}
    for row in attempts:
        directory = pathlib.Path(row["directory"])
        attempt_files[row["directory"]] = {
            name: (directory / name).stat().st_size if (directory / name).is_file() else None
            for name in ("stdout", "native.stderr", "observer.log", "keeper.log")}
    detail = {
        "retained_ids": retained_ids,
        "dropped_oldest_ids": [i for i in ("r%d" % n for n in range(20))
                               if i not in retained_ids],
        "delivery_body": delivered.get("body"),
        "storage_entries_for_path": len(entries),
        "storage_attempts": attempts,
        "attempt_file_bytes": attempt_files,
    }
    ok = delivered.get("body") == "Only copy answer"
    return ("PASS" if ok else "FAIL"), detail


@check
def interrupted_read_failure(board):
    """The read-failure arm of consume, and the frame it is meant to write.

    Source trace on this candidate: the native read can only return Fail on a
    retained attempt re-adopted after keeper loss with <attempt>/stdout
    replaced, and that failure lands on the first read, where the held set is
    empty; Logs.interrupted emits its frame only when the held set is non-empty
    (logs.bend:308-310). No file under bend2/test names baton_log_interrupted.
    The graceful end-of-stream path is exercised here for contrast.
    """
    worker = "readfail"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    frames = [tool_update("tool-1", "partial state")] + [terminal()]
    done = board.run_turn(worker, "readfail-t1", log, frames, expect=None)
    lines = board.frames_of(log) if log.is_file() else []
    interrupted = [f for f in lines if f.get("type") == "baton_log_interrupted"]
    detail = {
        "graceful_turn_exit": done.returncode,
        "graceful_turn_stderr": done.stderr.strip()[:400],
        "log_frames": [f.get("type") for f in lines],
        "interrupted_frames": len(interrupted),
        "held_update_written_on_graceful_end": any(
            f.get("type") == "tool_execution_update" for f in lines),
        "frame_guarded_by_nonempty_held": "logs.bend:308-310 writes no frame when held is empty",
        "delivered_test_coverage": "no file under bend2/test names baton_log_interrupted",
    }
    return "BLOCKED", dict(detail, blocked_on=(
        "the read-failure arm cannot be driven by an external fixture with a "
        "non-empty held set: the sole externally reachable Fail path fails on "
        "the first read, where held is empty, and Logs.interrupted writes its "
        "frame only when held is non-empty, so 'writes held frames plus one "
        "baton_log_interrupted frame' is neither tested nor independently "
        "verifiable in this candidate"))


@check
def abrupt_end_keeps_latest_frames(board):
    """Held prefix frames after an abrupt end, and the message_update case.

    docs/bend2/logging.md: "The held frames are what an interrupted turn keeps."
    Used here on a harness that ends without the closing frame for its call.
    """
    worker = "abrupt"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    update = [tool_update("tool-1", "partial %d" % i) for i in range(3)]
    board.run_turn(worker, "abrupt-tool", log, update + [terminal()])
    tool_frames = board.frames_of(log)
    tool_kept = [f for f in tool_frames
                 if f.get("type") == "tool_execution_update"]
    tool_detail = {
        "tool_update_frames_retained": len(tool_kept),
        "retained_text": [f["partialResult"]["content"][0]["text"] for f in tool_kept],
    }

    worker2 = "abrupt2"
    board.recruit(worker2)
    log2 = board.cwd / ("%s.jsonl" % worker2)
    board.call("logs", worker2, "default", "65536", "2")
    stream = [
        json.dumps({"type": "message_start", "messageId": "m1",
                    "message": {"role": "assistant", "content": []}}),
        json.dumps({"type": "message_update", "messageId": "m1",
                    "message": {"role": "assistant",
                                "content": [{"type": "text", "text": "half an answer"}]}}),
        json.dumps({"type": "message_update", "messageId": "m1",
                    "message": {"role": "assistant",
                                "content": [{"type": "text", "text": "half an answer, more"}]}}),
    ]
    # The stream ends without the closing frame of the open message and without
    # a terminal frame, so the only copy of the accumulated text is the
    # message_update frames the default level drops.
    board.run_turn(worker2, "abrupt-stream", log2, stream,
                   extra="\nimport os\nos._exit(0)\n")
    stream_frames = board.frames_of(log2)
    text = json.dumps(stream_frames)
    detail = {
        "tool_call": tool_detail,
        "assistant_frames": [f.get("type") for f in stream_frames],
        "latest_assistant_text_retained": "half an answer, more" in text,
        "any_assistant_text_retained": "half an answer" in text,
    }
    tool_ok = (tool_detail["tool_update_frames_retained"] == 1
               and tool_detail["retained_text"] == ["partial 2"])
    stream_ok = detail["latest_assistant_text_retained"]
    if not tool_ok:
        return "FAIL", detail
    if not stream_ok:
        return "BLOCKED", dict(detail, blocked_on=(
            "an abrupt assistant stream keeps no message_update frame, so the "
            "latest accumulated assistant text is lost"))
    return "PASS", detail


@check
def rotation_failure_reporting(board):
    """A failed shift stops the chain and is reported beside the appended frame."""
    worker = "shiftfail"
    board.recruit("shiftfail-bystander")
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    board.run_turn(worker, "shiftfail-warm", log,
                   [rot_frame(i) for i in range(6)] + [terminal()])
    warm = board.segments(log)
    # Inject a shift failure: the target of the first rename is a directory.
    blocker = log.parent / (log.name + ".2")
    if blocker.exists():
        blocker.unlink()
    blocker.mkdir()
    frames = [rot_frame(i) for i in range(6, 16)] + [terminal("After the failure")]
    board.run_turn(worker, "shiftfail-t2", log, frames)
    live = board.frames_of(log)
    failed = [f for f in live if f.get("failed") is True]
    rotated = [f for f in live if f.get("type") == "baton_log_rotation"]
    detail = {
        "warm_segments": sorted(warm),
        "blocker_is_directory": blocker.is_dir(),
        "rotation_frames": rotated[:3],
        "failed_frames": failed[:2],
        "segments_after": sorted(board.segments(log)),
        "live_has_late_frame": any(f.get("id") == "r15" for f in live),
        "live_has_terminal": any(f.get("type") == "agent_end" for f in live),
        "stderr": "",
    }
    ok = (bool(failed) and detail["live_has_late_frame"]
          and detail["live_has_terminal"] and blocker.is_dir())
    return ("PASS" if ok else "FAIL"), detail


@check
def concurrent_writers(board):
    """Two supervisors appending to one log path across a rotation."""
    first, second = "writer-a", "writer-b"
    board.recruit(first)
    board.recruit(second)
    log = board.cwd / "shared.jsonl"
    for worker in (first, second):
        board.call("logs", worker, "default", "65536", "2")
    frames_a = [rot_frame(i) for i in range(8)]
    extra_a = ("\nimport pathlib, time\n"
               "while not pathlib.Path('release').exists(): time.sleep(0.05)\n"
               "sys.stdout.write(" + repr(terminal("Writer A finish")) + " + '\\n')\n"
               "sys.stdout.flush()\n")
    proc_a = board.spawn_turn(first, "writer-a-t1", log, frames_a, extra=extra_a)
    err_a = err_b = ""
    rotated_by_first = []
    b_state = "not_started"
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            if board.segments(log) or proc_a.poll() is not None:
                break
            time.sleep(0.05)
        rotated_by_first = sorted(board.segments(log))
        proc_b = board.spawn_turn(second, "writer-b-t1", log,
                                  [rot_frame(100 + i) for i in range(8)] + [terminal("B")])
        try:
            out_b, err_b = proc_b.communicate(timeout=90)
            b_state = "exited"
        except subprocess.TimeoutExpired:
            b_state = "blocked"
            proc_b.kill()
            out_b, err_b = proc_b.communicate()
    finally:
        board.cwd.joinpath("release").write_text("go\n")
        try:
            out_a, err_a = proc_a.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            proc_a.kill()
            out_a, err_a = proc_a.communicate()
    segments = board.segments(log)
    live = board.frames_of(log)
    corrupt = []
    for path in [log, *segments.values()]:
        for line in path.read_text(errors="replace").splitlines():
            if not line.strip():
                continue
            try:
                json.loads(line)
            except ValueError:
                corrupt.append({"file": path.name, "line": line[:120]})
    all_frames = []
    for index in sorted(segments, reverse=True):
        all_frames.extend(board.frames_of(segments[index]))
    all_frames.extend(live)
    ids = [f.get("id") for f in all_frames if isinstance(f.get("id"), str)]
    ids_a = [f for f in ids if f.startswith("r") and int(f[1:]) < 100]
    ids_b = [f for f in ids if f.startswith("r") and int(f[1:]) >= 100]
    reported = [i for i in ids_a + ids_b if ids.count(i) > 1]
    detail = {
        "segments_seen_after_first_writer": rotated_by_first,
        "writer_a_exit": proc_a.returncode, "writer_b_state": b_state,
        "writer_b_exit": proc_b.returncode,
        "writer_a_stderr": err_a.strip()[:300],
        "writer_b_stderr": err_b.strip()[:300],
        "ids_first_writer_present": sorted(ids_a, key=lambda v: int(v[1:])),
        "ids_second_writer_present": sorted(ids_b, key=lambda v: int(v[1:])),
        "duplicated_ids": sorted(set(reported)),
        "corrupt_lines": corrupt,
        "rotation_frames": [f for f in all_frames if f.get("type") == "baton_log_rotation"],
        "segments_final": sorted(segments),
    }
    if b_state != "exited":
        return "BLOCKED", dict(detail, blocked_on=(
            "the second writer did not run to completion while the first held "
            "the log open, so no interleaved append was exercised"))

    def is_tail(kept, emitted):
        return kept == emitted[len(emitted) - len(kept):] if kept else False

    tail_a = is_tail(sorted(ids_a, key=lambda v: int(v[1:])), ["r%d" % i for i in range(8)])
    tail_b = is_tail(sorted(ids_b, key=lambda v: int(v[1:])), ["r%d" % i for i in range(100, 108)])
    detail["first_writer_kept_a_contiguous_tail"] = tail_a
    detail["second_writer_kept_a_contiguous_tail"] = tail_b
    ok = (proc_a.returncode == 0 and proc_b.returncode == 0
          and not corrupt and not reported and tail_a and tail_b)
    return ("PASS" if ok else "FAIL"), detail


@check
def keeper_kill(board):
    """What survives a SIGKILL of the coordinator with a frame still held.

    docs/bend2/logging.md: "A coordinator killed before that point writes no
    held frame. A retained receive keeps the raw stream in its attempt
    directory, which holds the same frames; a direct turn loses the last
    partial update of every call it had open."
    """
    worker = "kill"
    board.recruit(worker)
    log = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    frames = [rot_frame(i, 20000) for i in range(8)]
    frames.append(tool_update("tool-1", "held partial that only memory holds"))
    extra = ("\nimport pathlib, time\n"
             "while not pathlib.Path('release').exists(): time.sleep(0.05)\n")
    proc = board.spawn_turn(worker, "kill-t1", log, frames, extra=extra)
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            if log.is_file() and "held partial" not in log.read_text(errors="replace") \
                    and log.stat().st_size > 0 and board.segments(log):
                break
            if proc.poll() is not None:
                break
            time.sleep(0.1)
        # Let the supervisor consume the frames it has already been sent, so the
        # last prefix frame is held rather than still queued.
        time.sleep(1.5)
        held_in_memory_only = (log.is_file()
                               and "held partial" not in log.read_text(errors="replace"))
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=30)
    finally:
        board.cwd.joinpath("release").write_text("go\n")
        if proc.poll() is None:
            proc.kill()
    after = log.read_text(errors="replace") if log.is_file() else ""
    attempt_dirs = sorted(str(p) for p in board.cwd.glob("state.db.attempt-*"))
    attempt_files = {}
    for directory in attempt_dirs:
        attempt_files[directory] = sorted(p.name for p in pathlib.Path(directory).iterdir())
    con = sqlite3.connect(str(board.db))
    executions = con.execute(
        "SELECT session,id,mode,phase,status,directory FROM executions").fetchall()
    con.close()
    detail = {
        "held_frame_absent_before_kill": held_in_memory_only,
        "held_frame_absent_after_kill": "held partial" not in after,
        "segments_after_kill": sorted(board.segments(log)),
        "live_bytes_after_kill": log.stat().st_size if log.is_file() else 0,
        "attempt_directories": attempt_dirs,
        "attempt_files": attempt_files,
        "executions_rows": executions,
    }
    return "PASS", detail


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", default=".scratch/bend2/baton2")
    parser.add_argument("--root", default=None)
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    exe = pathlib.Path(args.exe)
    if not exe.is_file():
        print(json.dumps({"error": "no executable at %s" % exe}))
        return 2
    root = pathlib.Path(args.root or tempfile.mkdtemp(prefix="issue686-acceptance-"))
    root.mkdir(parents=True, exist_ok=True)
    selected = [fn for fn in CHECKS if not args.only or fn.__name__ in args.only]
    results = []
    for fn in selected:
        board = Board(exe, root, fn.__name__)
        started = time.time()
        try:
            status, detail = fn(board)
        except Exception as error:  # a check that cannot run is not a pass
            status, detail = "FAIL", {"exception": "%s: %s" % (type(error).__name__, error)}
        record = {"check": fn.__name__, "status": status, "seconds": round(time.time() - started, 1),
                  "detail": detail}
        results.append(record)
        print(json.dumps(record, sort_keys=True), flush=True)
    summary = {status: len([r for r in results if r["status"] == status])
               for status in ("PASS", "FAIL", "BLOCKED")}
    print(json.dumps({"summary": summary, "root": str(root), "exe": str(exe)}, sort_keys=True))
    if not args.keep:
        shutil.rmtree(root, ignore_errors=True)
    return 1 if summary["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
