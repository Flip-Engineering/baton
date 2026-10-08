#!/usr/bin/env python3
"""Independent acceptance checks for baton issue #686 at commit 31f261ff.

Exact-source validation of `origin/bend2-rewrite` at 31f261ff, which removes the
log byte and segment budgets (PR #700). The policy is level-only: `quiet`,
`default`, `diagnostic`; there is no byte budget, no retention count, no
byte-triggered rotation, and no retention pruning. This drives the coordinator
CLI only. Expectations come from the contract in docs/bend2/logging.md at this
commit and from the acceptance items assigned to the validator.

    python3 issue686_acceptance_31f261ff.py --exe .scratch/bend2/baton2

Each check prints one JSON object: {"check", "status", "detail"}. Status is
PASS, FAIL (the observed behaviour contradicts the stated contract), or BLOCKED
(the required evidence cannot be produced). The process exits 1 on any FAIL.

Surface taken from the source at this commit, not assumed:

* `logs SESSION [LEVEL]` is the whole policy command; a budget or a retention
  count has no argument position and is refused by the parser.
* A direct turn writes to the OUTPUT_LOG it was given; there is no generation
  rebinding and no segment file.
* `log_policies` holds (session, level) only; a legacy table with extra columns
  migrates to that shape.
* `logs-clean` removes only registered attempt diagnostics; its `removed` array
  is always empty.
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

LEGACY_TABLES = (
    "CREATE TABLE log_policies(session TEXT PRIMARY KEY NOT NULL,"
    "level TEXT NOT NULL CHECK(level IN ('quiet','default','diagnostic')),"
    "budget_bytes INTEGER NOT NULL,keep_segments INTEGER NOT NULL);"
    "CREATE TABLE log_files(session TEXT NOT NULL,log TEXT NOT NULL,"
    "PRIMARY KEY(session,log));")

# The failure path needs a stored level the level-only table refuses. The real
# budget-era table enforced the same level domain, so this reproducer is the
# defensive shape: a legacy table that did not.
LEGACY_TABLES_OPEN_LEVEL = (
    "CREATE TABLE log_policies(session TEXT PRIMARY KEY NOT NULL,"
    "level TEXT NOT NULL,budget_bytes INTEGER NOT NULL,keep_segments INTEGER NOT NULL);"
    "CREATE TABLE log_files(session TEXT NOT NULL,log TEXT NOT NULL,"
    "PRIMARY KEY(session,log));")

FILTER_NOTE = "baton_event_filter"


def check(fn):
    CHECKS.append(fn)
    return fn


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True)


class Board:
    """One isolated coordinator database and the fixtures a check needs."""

    def __init__(self, exe, root, name, legacy=None):
        self.exe = str(pathlib.Path(exe).resolve())
        self.root = pathlib.Path(root) / name
        self.cwd = self.root / "work"
        self.cwd.mkdir(parents=True)
        self.db = self.cwd / "state.db"
        if legacy:
            con = sqlite3.connect(str(self.db))
            con.executescript(legacy)
            con.commit()
            con.close()
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

    def call(self, *args, expect=0, timeout=240):
        done = subprocess.run([self.exe, str(self.db), *args], text=True,
                              capture_output=True, timeout=timeout)
        if expect is not None and done.returncode != expect:
            raise AssertionError(
                "command %r exited %d (want %s)\nstdout: %s\nstderr: %s"
                % (args, done.returncode, expect, done.stdout[:2000], done.stderr[:2000]))
        return done

    def json_call(self, *args, expect=0):
        return json.loads(self.call(*args, expect=expect).stdout)

    def recruit(self, name, harness="omp", parent="root"):
        return self.call("recruit", name, parent, harness, "model", "low",
                         str(self.repo), name + "-branch",
                         str(self.checkouts / name), self.base)

    # -- fixture native process -------------------------------------------

    def write_fixture(self, extra):
        body = ("import pathlib, sys\n"
                "for _ in range(3): sys.stdin.readline()\n"
                "sys.stdout.write(pathlib.Path('events.jsonl').read_text())\n"
                "sys.stdout.flush()\n" + extra)
        self.fixture.write_text("#!/usr/bin/env python3\n" + body
                                + "\nassert sys.stdin.read() == ''\n")
        self.fixture.chmod(0o755)

    def run_turn(self, player, turn_id, log, frames, extra="", expect=0):
        self.events.write_text("\n".join(frames) + "\n")
        self.write_fixture(extra)
        return self.call("turn", player, turn_id, str(self.fixture), "model", "low",
                         str(self.cwd), str(self.task), str(log), "", expect=expect)

    def spawn_turn(self, player, turn_id, log, frames, extra=""):
        self.events.write_text("\n".join(frames) + "\n")
        self.write_fixture(extra)
        return subprocess.Popen(
            [self.exe, str(self.db), "turn", player, turn_id, str(self.fixture), "model",
             "low", str(self.cwd), str(self.task), str(log), ""],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def writer_dir(self, name):
        path = self.cwd / ("writer-" + name)
        path.mkdir(parents=True, exist_ok=True)
        return path

    def spawn_turn_in(self, cwd, player, turn_id, log, frames, extra=""):
        """Start a turn whose fixture and event file live in its own directory."""
        cwd = pathlib.Path(cwd)
        (cwd / "events.jsonl").write_text("\n".join(frames) + "\n")
        body = ("import pathlib, sys\n"
                "for _ in range(3): sys.stdin.readline()\n"
                "sys.stdout.write(pathlib.Path('events.jsonl').read_text())\n"
                "sys.stdout.flush()\n" + extra)
        fixture = cwd / "fixture-harness"
        fixture.write_text("#!/usr/bin/env python3\n" + body
                           + "\nassert sys.stdin.read() == ''\n")
        fixture.chmod(0o755)
        return subprocess.Popen(
            [self.exe, str(self.db), "turn", player, turn_id, str(fixture), "model",
             "low", str(cwd), str(self.task), str(log), ""],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # -- log inspection ----------------------------------------------------

    @staticmethod
    def frames_of(path):
        out = []
        if not pathlib.Path(path).is_file():
            return out
        for line in pathlib.Path(path).read_text(errors="replace").splitlines():
            try:
                value = json.loads(line)
            except ValueError:
                continue
            if isinstance(value, dict):
                out.append(value)
        return out

    @staticmethod
    def kinds(path):
        return [frame.get("type") for frame in Board.frames_of(path)]


def response(index, pad=200):
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


def message_update(message_id, text):
    return json.dumps({"type": "message_update", "messageId": message_id,
                       "message": {"role": "assistant",
                                   "content": [{"type": "text", "text": text}]}})


def message_start(message_id):
    return json.dumps({"type": "message_start", "messageId": message_id,
                       "message": {"role": "assistant", "content": []}})


def message_end(message_id, text):
    return json.dumps({"type": "message_end", "messageId": message_id,
                       "message": {"role": "assistant",
                                   "content": [{"type": "text", "text": text}]}})


def mixed_stream():
    return [
        response(0),
        message_update("m1", "u1"),
        message_update("m1", "u2"),
        message_start("m2"),
        message_update("m2", "u3"),
        message_end("m2", "done"),
        json.dumps({"type": "tool_execution_start", "toolCallId": "tool-1",
                    "toolName": "bash", "args": {"command": "echo"}}),
        tool_update("tool-1", "p1"),
        tool_update("tool-1", "p2"),
        json.dumps({"type": "tool_execution_end", "toolCallId": "tool-1",
                    "toolName": "bash", "isError": False,
                    "result": {"content": [{"type": "text", "text": "final"}]}}),
        message_start("m3"),
        json.dumps({"type": "error", "message": "provider reported a failure"}),
        terminal("Answer with every level"),
        '{"probe":"unclassified frame"}',
    ]


# ---------------------------------------------------------------- checks


@check
def level_default_policy(board):
    """default keeps complete frames and the newest held prefix per identity."""
    worker = "level-default"
    board.recruit(worker)
    log = board.cwd / "default.jsonl"
    board.run_turn(worker, "level-default-t1", log, mixed_stream())
    frames = board.frames_of(log)
    kinds = [frame.get("type") for frame in frames]
    updates_m1 = [f for f in frames if f.get("type") == "message_update"
                  and f.get("messageId") == "m1"]
    updates_m2 = [f for f in frames if f.get("type") == "message_update"
                  and f.get("messageId") == "m2"]
    starts_m2 = [f for f in frames if f.get("type") == "message_start"
                 and f.get("messageId") == "m2"]
    starts_m3 = [f for f in frames if f.get("type") == "message_start"
                 and f.get("messageId") == "m3"]
    tool_updates = [f for f in frames if f.get("type") == "tool_execution_update"]
    detail = {
        "kinds": kinds,
        "newest_message_update_m1": [f["message"]["content"][0]["text"] for f in updates_m1],
        "message_update_m2_retained": len(updates_m2),
        "message_start_m2_retained": len(starts_m2),
        "unterminated_message_start_m3_retained": len(starts_m3),
        "tool_updates_retained": [f["partialResult"]["content"][0]["text"]
                                  for f in tool_updates],
        "kept_evidence": all(kind in kinds for kind in
                             ("response", "message_end", "tool_execution_start",
                              "tool_execution_end", "agent_end", "error")),
        "unclassified_retained": "unclassified frame" in json.dumps(frames),
        "filter_note_retained": FILTER_NOTE in kinds,
    }
    ok = (detail["newest_message_update_m1"] == ["u2"]
          and detail["message_update_m2_retained"] == 0
          and detail["message_start_m2_retained"] == 0
          and detail["unterminated_message_start_m3_retained"] == 1
          and detail["tool_updates_retained"] == ["p2"]
          and detail["kept_evidence"] and detail["unclassified_retained"]
          and detail["filter_note_retained"])
    return ("PASS" if ok else "FAIL"), detail


@check
def level_quiet_policy(board):
    """quiet keeps terminal frames and unclassified frames alone."""
    worker = "level-quiet"
    board.recruit(worker)
    log = board.cwd / "quiet.jsonl"
    board.call("logs", worker, "quiet")
    board.run_turn(worker, "level-quiet-t1", log, mixed_stream())
    frames = board.frames_of(log)
    kinds = [frame.get("type") for frame in frames]
    text = json.dumps(frames)
    detail = {
        "kinds": kinds,
        "terminal_retained": "agent_end" in kinds,
        "unclassified_retained": "unclassified frame" in text,
        "classified_running_frames_dropped": not any(
            kind in kinds for kind in ("response", "message_start", "message_update",
                                       "tool_execution_update", "tool_execution_start",
                                       "tool_execution_end")),
        "message_end_dropped": "message_end" not in kinds,
    }
    ok = (detail["terminal_retained"] and detail["unclassified_retained"]
          and detail["classified_running_frames_dropped"]
          and detail["message_end_dropped"])
    return ("PASS" if ok else "FAIL"), detail


@check
def level_diagnostic_policy(board):
    """diagnostic keeps every frame verbatim."""
    worker = "level-diagnostic"
    board.recruit(worker)
    log = board.cwd / "diagnostic.jsonl"
    board.call("logs", worker, "diagnostic")
    stream = mixed_stream()
    board.run_turn(worker, "level-diagnostic-t1", log, stream)
    frames = board.frames_of(log)
    kinds = [frame.get("type") for frame in frames]
    detail = {
        "emitted_frames": len(stream),
        "retained_frames": len(frames),
        "kinds": kinds,
        "all_emitted_retained": all(any(f == json.loads(line) for f in frames)
                                    for line in stream),
        "message_updates_retained": len([k for k in kinds if k == "message_update"]),
        "tool_updates_retained": len([k for k in kinds if k == "tool_execution_update"]),
    }
    ok = (detail["all_emitted_retained"] and detail["message_updates_retained"] == 3
          and detail["tool_updates_retained"] == 2)
    return ("PASS" if ok else "FAIL"), detail


@check
def level_read_and_set(board):
    """The policy command is level-only, and a budget has no argument position."""
    worker = "level-policy"
    board.recruit(worker)
    read_default = board.json_call("logs", worker)
    set_quiet = board.json_call("logs", worker, "quiet")
    read_quiet = board.json_call("logs", worker)
    refused_level = board.call("logs", worker, "loud", expect=None)
    refused_budget = board.call("logs", worker, "default", "65536", expect=None)
    refused_budget_keep = board.call("logs", worker, "default", "65536", "2", expect=None)
    refused_unknown = board.call("logs", "absent-session", "quiet", expect=None)
    detail = {
        "read_default": read_default,
        "set_quiet": set_quiet,
        "read_quiet": read_quiet,
        "refused_level_exit": refused_level.returncode,
        "refused_level_stderr": refused_level.stderr.strip()[:160],
        "refused_budget_exit": refused_budget.returncode,
        "refused_budget_stderr": refused_budget.stderr.strip()[:160],
        "refused_budget_keep_exit": refused_budget_keep.returncode,
        "refused_unknown_exit": refused_unknown.returncode,
        "read_keys": sorted(read_default.keys()),
    }
    ok = (read_default.get("level") == "default"
          and read_default.get("registeredLogs") == 0
          and set_quiet.get("level") == "quiet"
          and read_quiet.get("level") == "quiet"
          and refused_level.returncode == 2
          and refused_budget.returncode != 0
          and refused_budget_keep.returncode != 0
          and refused_unknown.returncode == 2)
    return ("PASS" if ok else "FAIL"), detail


@check
def abrupt_end_retention(board):
    """An unterminated stream still leaves the newest held snapshot per identity."""
    worker = "abrupt"
    board.recruit(worker)
    log = board.cwd / "abrupt.jsonl"
    tool_frames = [tool_update("tool-1", "partial %d" % i) for i in range(3)]
    board.run_turn(worker, "abrupt-tool", log, tool_frames + [terminal()])
    tool_kept = [f for f in board.frames_of(log)
                 if f.get("type") == "tool_execution_update"]

    worker2 = "abrupt2"
    board.recruit(worker2)
    log2 = board.cwd / "abrupt2.jsonl"
    stream = [message_start("m1")] + [message_update("m1", "half an answer %d" % i)
                                      for i in range(3)]
    board.run_turn(worker2, "abrupt-stream", log2, stream,
                   extra="\nimport os\nos._exit(0)\n")
    frames = board.frames_of(log2)
    updates = [f for f in frames if f.get("type") == "message_update"]
    text = json.dumps(frames)
    detail = {
        "tool_call": {
            "tool_update_frames_retained": len(tool_kept),
            "retained_text": [f["partialResult"]["content"][0]["text"] for f in tool_kept],
        },
        "assistant_frames": [f.get("type") for f in frames],
        "message_update_frames_retained": len(updates),
        "latest_assistant_text_retained": "half an answer 2" in text,
        "first_assistant_text_retained": "half an answer 0" in text,
    }
    tool_ok = (len(tool_kept) == 1
               and [f["partialResult"]["content"][0]["text"] for f in tool_kept] == ["partial 2"])
    stream_ok = len(updates) == 1 and detail["latest_assistant_text_retained"]
    return ("PASS" if tool_ok and stream_ok else "FAIL"), detail


@check
def checkpoint_durability_and_restore(board):
    """The checkpoint holds the newest held frame, survives a kill, and restores."""
    worker = "hold"
    board.recruit(worker)
    log = board.cwd / "hold.jsonl"
    checkpoint = log.parent / (log.name + ".pending")
    frames = [response(i, 20000) for i in range(8)]
    frames += [tool_update("tool-a", "alpha 1"), tool_update("tool-a", "alpha 2"),
               tool_update("tool-b", "bravo 1")]
    extra = ("\nimport pathlib, time\n"
             "while not pathlib.Path('release').exists(): time.sleep(0.05)\n")
    proc = board.spawn_turn(worker, "hold-t1", log, frames, extra=extra)
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            if checkpoint.is_file() and "alpha 2" in checkpoint.read_text(errors="replace") \
                    and "bravo 1" in checkpoint.read_text(errors="replace"):
                break
            if proc.poll() is not None:
                break
            time.sleep(0.05)
        held = [(f.get("toolCallId"), f["partialResult"]["content"][0]["text"])
                for f in board.frames_of(checkpoint)] if checkpoint.is_file() else []
        temporary = sorted(p.name for p in log.parent.glob(log.name + ".pending.tmp.*"))
        log_before = log.read_text(errors="replace") if log.is_file() else ""
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=30)
        detail = {
            "checkpoint_present_before_kill": checkpoint.is_file(),
            "checkpoint_entries": held,
            "temporary_files": temporary,
            "held_absent_from_public_log": "alpha 2" not in log_before,
            "checkpoint_present_after_kill": checkpoint.is_file(),
        }
    finally:
        (board.cwd / "release").write_text("go\n")
        if proc.poll() is None:
            proc.kill()
    board.run_turn(worker, "hold-t2", log, [terminal("After the restore")])
    text = log.read_text(errors="replace") if log.is_file() else ""
    detail.update({
        "restored_alpha_2": "alpha 2" in text,
        "restored_bravo_1": "bravo 1" in text,
        "checkpoint_cleared_after_restore": not checkpoint.is_file(),
    })
    ok = (detail["checkpoint_present_before_kill"]
          and sorted(held) == [("tool-a", "alpha 2"), ("tool-b", "bravo 1")]
          and not temporary and detail["held_absent_from_public_log"]
          and detail["checkpoint_present_after_kill"]
          and detail["restored_alpha_2"] and detail["restored_bravo_1"]
          and detail["checkpoint_cleared_after_restore"])
    return ("PASS" if ok else "FAIL"), detail


@check
def pending_message_recovery(board):
    """Unanswered input stays recoverable and blocks attempt cleanup."""
    worker = "pending"
    board.recruit(worker)
    log = board.cwd / "pending.jsonl"
    board.call("message", "hold-1", "root", worker, "guidance", "Answer before cleanup.")
    board.run_turn(worker, "pending-t1", log, [response(0), terminal()])
    inbox_after_one = board.json_call("inbox", worker)
    storage = board.json_call("logs-storage")
    entry = next(row for row in storage["logs"] if row["path"] == str(log))
    clean = board.json_call("logs-clean", worker)
    board.run_turn(worker, "pending-t2", log, [response(1), terminal("Second turn")])
    inbox_after_two = board.json_call("inbox", worker)
    checkpoint = log.parent / (log.name + ".pending")
    checkpoint.write_text('{"type":"tool_execution_update","toolCallId":"kept"}\n')
    clean_again = board.json_call("logs-clean", worker)
    detail = {
        "inbox_after_one_turn": [m["id"] for m in inbox_after_one],
        "inbox_after_two_turns": [m["id"] for m in inbox_after_two],
        "storage_pendingInput": entry.get("pendingInput"),
        "clean_removed": clean["removed"],
        "clean_attemptFiles": clean.get("attemptFiles"),
        "clean_skipped": clean.get("skipped"),
        "clean_pendingInput": clean.get("pendingInput"),
        "clean_again_removed": clean_again["removed"],
        "checkpoint_kept_while_pending": checkpoint.is_file(),
        "public_log_still_present": log.is_file(),
    }
    ok = (detail["inbox_after_one_turn"] == ["hold-1"]
          and detail["inbox_after_two_turns"] == ["hold-1"]
          and entry.get("pendingInput") == 1
          and clean["removed"] == [] and clean.get("attemptFiles") == []
          and clean.get("skipped") == "pending-input"
          and clean_again["removed"] == []
          and detail["checkpoint_kept_while_pending"] and detail["public_log_still_present"])
    return ("PASS" if ok else "FAIL"), detail


@check
def output_failure_reporting(board):
    """A failed log write is reported with its path and keeps the report."""
    worker = "unwritable"
    board.recruit(worker)
    unwritable = board.cwd / "log-directory"
    unwritable.mkdir()
    board.run_turn(worker, "unwritable-t1", unwritable,
                   [response(0), terminal("Answer despite an unwritable log")])
    inbox = board.json_call("inbox", "root")
    bodies = [message["body"] for message in inbox]
    delivered = board.json_call("delivery", "unwritable-t1")
    detail = {
        "failure_reports": len([body for body in bodies
                                if "Native output observation failed" in body]),
        "names_the_log_path": any(str(unwritable) in body for body in bodies),
        "delivery_body": delivered.get("body"),
        "inbox_bodies_sample": [body[:120] for body in bodies[:3]],
    }
    ok = (detail["failure_reports"] == 1 and detail["names_the_log_path"]
          and detail["delivery_body"] == "Answer despite an unwritable log")
    return ("PASS" if ok else "FAIL"), detail


@check
def report_extraction(board):
    """The terminal frame's text is recoverable through the delivery command."""
    worker = "report"
    board.recruit(worker)
    log = board.cwd / "report.jsonl"
    board.run_turn(worker, "report-t1", log, [response(0), terminal("Extract me")])
    delivered = board.json_call("delivery", "report-t1")
    turns = board.json_call("turns", worker)
    con = sqlite3.connect(str(board.db))
    rows = con.execute("SELECT id,worker,event FROM turns WHERE id=?",
                       ("report-t1",)).fetchall()
    con.close()
    event = json.loads(rows[0][2]) if rows else {}
    detail = {
        "delivery_body": delivered.get("body"),
        "turns_rows": len(rows),
        "turn_event_type": event.get("type"),
        "turn_listing_ids": [row.get("id") for row in turns],
        "terminal_frame_in_log": any(f.get("type") == "agent_end"
                                     for f in board.frames_of(log)),
    }
    ok = (detail["delivery_body"] == "Extract me" and detail["turns_rows"] == 1
          and detail["turn_event_type"] == "agent_end"
          and "report-t1" in detail["turn_listing_ids"]
          and detail["terminal_frame_in_log"])
    return ("PASS" if ok else "FAIL"), detail


@check
def only_copy_evidence(board):
    """Every written frame stays in the log, and the terminal frame is in the database."""
    worker = "onlycopy"
    board.recruit(worker)
    log = board.cwd / "onlycopy.jsonl"
    frames = [response(i, 20000) for i in range(30)] + [terminal("Only copy answer")]
    board.run_turn(worker, "onlycopy-t1", log, frames)
    retained = [f.get("id") for f in board.frames_of(log) if f.get("id")]
    delivered = board.json_call("delivery", "onlycopy-t1")
    con = sqlite3.connect(str(board.db))
    rows = con.execute("SELECT id,event FROM turns WHERE id=?", ("onlycopy-t1",)).fetchall()
    con.close()
    detail = {
        "written_frames": 30,
        "retained_ids": retained,
        "missing_ids": [i for i in ("r%d" % n for n in range(30)) if i not in retained],
        "delivery_body": delivered.get("body"),
        "turns_rows": len(rows),
        "terminal_frame_retained": any(f.get("type") == "agent_end"
                                       for f in board.frames_of(log)),
    }
    ok = (not detail["missing_ids"] and delivered.get("body") == "Only copy answer"
          and detail["turns_rows"] == 1 and detail["terminal_frame_retained"])
    return ("PASS" if ok else "FAIL"), detail


@check
def legacy_schema_migration(board):
    """A legacy policy table migrates to level-only with its rows and registry."""
    worker = "legacy-worker"
    board.recruit(worker)
    log = str(board.cwd / "legacy.jsonl")
    con = sqlite3.connect(str(board.db))
    con.execute("INSERT INTO log_policies VALUES(?,?,?,?)",
                (worker, "diagnostic", 1048576, 3))
    con.execute("INSERT INTO log_files VALUES(?,?)", (worker, log))
    con.commit()
    con.close()
    before = board.json_call("logs", worker)
    after = board.json_call("logs", worker, "quiet")
    con = sqlite3.connect(str(board.db))
    columns = [row[1] for row in con.execute("PRAGMA table_info(log_policies)")]
    policies = con.execute("SELECT session,level FROM log_policies").fetchall()
    files = con.execute("SELECT session,log FROM log_files").fetchall()
    legacy_left = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0]
    con.close()
    detail = {
        "legacy_schema": LEGACY_TABLES,
        "read_before_write": before,
        "set_level_after_migration": after,
        "columns_after": columns,
        "policies_after": policies,
        "files_after": files,
        "legacy_table_left_behind": legacy_left,
        "level_preserved": before.get("level") == "diagnostic",
        "registry_preserved": files == [(worker, log)],
        "level_only_columns": sorted(columns) == ["level", "session"],
        "set_accepted": after.get("level") == "quiet",
    }
    ok = (detail["level_preserved"] and detail["registry_preserved"]
          and detail["level_only_columns"] and detail["set_accepted"]
          and legacy_left == 0 and before.get("registeredLogs") == 1)
    return ("PASS" if ok else "FAIL"), detail


@check
def failed_migration_preserves_rows(board):
    """A migration that cannot move its rows changes nothing and refuses success."""
    worker = "legacy-broken"
    board.recruit(worker)
    con = sqlite3.connect(str(board.db))
    con.execute("INSERT INTO log_policies VALUES(?,?,?,?)",
                (worker, "invalid-legacy-level", 1048576, 3))
    con.commit()
    con.close()
    done = board.call("logs", worker, expect=None)
    con = sqlite3.connect(str(board.db))
    columns = [row[1] for row in con.execute("PRAGMA table_info(log_policies)")]
    policies = con.execute("SELECT session,level FROM log_policies").fetchall()
    legacy_left = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0]
    con.close()
    detail = {
        "exit": done.returncode,
        "stdout": done.stdout.strip()[:200],
        "stderr": done.stderr.strip()[:300],
        "columns_after": columns,
        "policies_after": policies,
        "legacy_table_left_behind": legacy_left,
        "row_preserved": policies == [(worker, "invalid-legacy-level")],
        "schema_unchanged": sorted(columns) == ["budget_bytes", "keep_segments",
                                               "level", "session"],
        "refused": done.returncode != 0,
        "no_policy_answer": '"level"' not in done.stdout,
        "names_the_constraint": "CHECK constraint failed" in done.stderr,
    }
    ok = (detail["refused"] and detail["no_policy_answer"] and detail["row_preserved"]
          and detail["schema_unchanged"] and legacy_left == 0)
    return ("PASS" if ok else "FAIL"), detail


@check
def concurrent_append_writers(board):
    """Two supervisors appending one public log path keep every frame."""
    first, second = "writer-a", "writer-b"
    board.recruit(first)
    board.recruit(second)
    log = board.cwd / "shared.jsonl"
    dir_a = board.writer_dir("a")
    dir_b = board.writer_dir("b")
    frames_a = [response(i) for i in range(40)]
    extra_a = ("\nimport pathlib, time\n"
               "pathlib.Path('ready').write_text('ready')\n"
               "while not pathlib.Path('release').exists(): time.sleep(0.02)\n"
               "sys.stdout.write(" + repr(terminal("Writer A finish")) + " + '\\n')\n"
               "sys.stdout.flush()\n")
    proc_a = board.spawn_turn_in(dir_a, first, "writer-a-t1", log, frames_a, extra=extra_a)
    err_a = err_b = ""
    b_state = "not_started"
    ready = False
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            if (dir_a / "ready").exists():
                ready = True
                break
            if proc_a.poll() is not None:
                break
            time.sleep(0.02)
        proc_b = board.spawn_turn_in(dir_b, second, "writer-b-t1", log,
                                     [response(100 + i) for i in range(40)]
                                     + [terminal("Writer B finish")])
        try:
            out_b, err_b = proc_b.communicate(timeout=90)
            b_state = "exited"
        except subprocess.TimeoutExpired:
            b_state = "blocked"
            proc_b.kill()
            out_b, err_b = proc_b.communicate()
    finally:
        (dir_a / "release").write_text("go\n")
        try:
            out_a, err_a = proc_a.communicate(timeout=90)
        except subprocess.TimeoutExpired:
            proc_a.kill()
            out_a, err_a = proc_a.communicate()
    corrupt = []
    for line in log.read_text(errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            json.loads(line)
        except ValueError:
            corrupt.append(line[:120])
    ids = [f.get("id") for f in board.frames_of(log) if isinstance(f.get("id"), str)]
    ids_a = [i for i in ids if i.startswith("r") and int(i[1:]) < 100]
    ids_b = [i for i in ids if i.startswith("r") and int(i[1:]) >= 100]
    detail = {
        "writer_a_exit": proc_a.returncode,
        "writer_b_exit": proc_b.returncode,
        "writer_b_state": b_state,
        "first_writer_ready_before_second": ready,
        "writer_a_stderr": err_a.strip()[:200],
        "writer_b_stderr": err_b.strip()[:200],
        "corrupt_lines": corrupt,
        "first_writer_ids_present": len(ids_a),
        "first_writer_ids_expected": len(frames_a),
        "second_writer_ids_present": len(ids_b),
        "second_writer_ids_expected": 40,
        "duplicated_ids": sorted({i for i in ids if ids.count(i) > 1}),
        "terminal_lines": len([f for f in board.frames_of(log)
                               if f.get("type") == "agent_end"]),
    }
    if b_state != "exited":
        return "BLOCKED", dict(detail, blocked_on=(
            "the second writer did not run while the first held the log open"))
    ok = (proc_a.returncode == 0 and proc_b.returncode == 0 and not corrupt
          and ready
          and not detail["duplicated_ids"]
          and detail["first_writer_ids_present"] == len(frames_a)
          and detail["second_writer_ids_present"] == 40
          and detail["terminal_lines"] == 2)
    return ("PASS" if ok else "FAIL"), detail


@check
def storage_and_cleanup_scope(board):
    """Storage reports the level-only entry, and cleanup never prunes the log."""
    worker = "scope"
    board.recruit(worker)
    log = board.cwd / "scope.jsonl"
    board.run_turn(worker, "scope-t1", log, [response(0), terminal()])
    checkpoint = log.parent / (log.name + ".pending")
    sentinels = {
        checkpoint: "checkpoint retained\n",
        log.parent / (log.name + ".stderr"): "stderr retained\n",
        log.parent / (log.name + ".1"): "rotated-looking name retained\n",
        log.parent / (log.name + ".attempt-x"): "generation-looking name retained\n",
    }
    for path, body in sentinels.items():
        path.write_text(body)
    storage = board.json_call("logs-storage")
    entry = next(row for row in storage["logs"] if row["path"] == str(log))
    clean = board.json_call("logs-clean", worker)
    detail = {
        "storage_keys": sorted(entry.keys()),
        "storage_level": entry.get("level"),
        "storage_bytes": entry.get("bytes"),
        "storage_pendingBytes": entry.get("pendingBytes"),
        "storage_pendingPath": entry.get("pendingPath"),
        "clean_keys": sorted(clean.keys()),
        "clean_removed": clean["removed"],
        "clean_attemptFiles": clean.get("attemptFiles"),
        "sentinels_survived": {path.name: path.is_file() for path in sentinels},
        "public_log_survived": log.is_file(),
        "storage_lists_no_segments": all("rotated" not in row for row in storage["logs"]),
        "no_budget_fields": not any(key in entry for key in
                                    ("budgetBytes", "keepSegments", "rotated")),
    }
    ok = (detail["storage_level"] == "default"
          and detail["storage_pendingBytes"] == len(sentinels[checkpoint])
          and clean["removed"] == [] and clean.get("attemptFiles") == []
          and all(detail["sentinels_survived"].values())
          and detail["public_log_survived"] and detail["no_budget_fields"]
          and detail["storage_lists_no_segments"])
    return ("PASS" if ok else "FAIL"), detail


@check
def interrupted_read_failure(board):
    """The read-failure arm and the frame it is meant to write."""
    worker = "readfail"
    board.recruit(worker)
    log = board.cwd / "readfail.jsonl"
    frames = [tool_update("tool-1", "partial state")] + [terminal()]
    done = board.run_turn(worker, "readfail-t1", log, frames, expect=None)
    lines = board.frames_of(log)
    detail = {
        "graceful_turn_exit": done.returncode,
        "log_frames": [f.get("type") for f in lines],
        "interrupted_frames": len([f for f in lines
                                   if f.get("type") == "baton_log_interrupted"]),
        "held_update_written_on_graceful_end": any(
            f.get("type") == "tool_execution_update" for f in lines),
        "frame_guarded_by_nonempty_held": "logs.bend:293-295 writes no frame when held is empty",
        "delivered_test_coverage": "no file under bend2/test names baton_log_interrupted",
        "durable_copy_instead": "the held set is checkpointed to <log>.pending per frame",
    }
    return "BLOCKED", dict(detail, blocked_on=(
        "no fixture reaches the read-failure arm with a non-empty held set, so "
        "no baton_log_interrupted frame can be observed; the held frames it "
        "would flush are durable in the checkpoint instead"))


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
    root = pathlib.Path(args.root or tempfile.mkdtemp(prefix="issue686-31f261ff-"))
    root.mkdir(parents=True, exist_ok=True)
    selected = [fn for fn in CHECKS if not args.only or fn.__name__ in args.only]
    results = []
    for fn in selected:
        legacy = LEGACY_TABLES if fn in (legacy_schema_migration,) else (
            LEGACY_TABLES_OPEN_LEVEL if fn in (failed_migration_preserves_rows,) else None)
        board = Board(exe, root, fn.__name__, legacy=legacy)
        started = time.time()
        try:
            status, detail = fn(board)
        except Exception as error:  # a check that cannot run is not a pass
            status, detail = "FAIL", {"exception": "%s: %s" % (type(error).__name__, error)}
        record = {"check": fn.__name__, "status": status,
                  "seconds": round(time.time() - started, 1), "detail": detail}
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
