#!/usr/bin/env python3
"""Independent acceptance checks for baton issue #686, the coordinator log policy.

Re-qualification against the landed primary `bend2-rewrite` at ecfbdd0b. This
drives the coordinator CLI only. Expectations come from the contract in
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

LEGACY_TABLES = (
    "CREATE TABLE log_policies(session TEXT PRIMARY KEY NOT NULL,"
    "level TEXT NOT NULL,budget_bytes INTEGER NOT NULL,"
    "keep_segments INTEGER NOT NULL CHECK(keep_segments BETWEEN 1 AND 4));"
    "CREATE TABLE log_files(session TEXT NOT NULL,log TEXT NOT NULL,"
    "PRIMARY KEY(session,log));")


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

    def log_path(self, worker):
        return self.cwd / ("%s.jsonl" % worker)

    def storage_entry(self, log):
        report = self.json_call("logs-storage")
        found = [row for row in report["logs"] if row["path"] == str(log)]
        return report, (found[0] if found else None)

    # -- fixture native process -------------------------------------------

    def fixture_body(self, extra):
        return ("import pathlib, sys\n"
                "for _ in range(3): sys.stdin.readline()\n"
                "sys.stdout.write(pathlib.Path('events.jsonl').read_text())\n"
                "sys.stdout.flush()\n" + extra)

    def write_fixture(self, extra):
        self.fixture.write_text("#!/usr/bin/env python3\n"
                                + self.fixture_body(extra
                                                    + "\nassert sys.stdin.read() == ''\n"))
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

    # -- log inspection ----------------------------------------------------

    @staticmethod
    def segments(log, limit=24):
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
    """Configured keep_segments 1, 2, 3 and 4 each retain exactly that many.

    docs/bend2/logging.md: the numbered segments shift one position up, the
    replacement of the highest one included. Retained frames must stay a
    contiguous suffix of the written frames.
    """
    detail = {}
    ok = True
    for keep in (1, 2, 3, 4):
        worker = "depth-%d" % keep
        board.recruit(worker)
        log = board.log_path(worker)
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
        }
        entry["count_matches_docs"] = len(segments) == keep
        entry["index_within_count"] = (max(segments) if segments else 0) <= keep
        if not (entry["count_matches_docs"] and entry["index_within_count"]
                and entry["retained_is_contiguous_suffix"]):
            ok = False
        detail[worker] = entry
    return ("PASS" if ok else "FAIL"), detail


@check
def policy_and_schema(board):
    """Admitted policy values and the bounds docs/bend2/logging.md states."""
    worker = "policy"
    board.recruit(worker)
    other = "policy-other"
    board.recruit(other)
    board.call("logs", other, "quiet", "1048576", "3")
    cases = {}

    def attempted(label, session=worker, **kwargs):
        args = ["logs", session]
        for key in ("level", "budget", "segments"):
            args.append(kwargs.get(key, ""))
        while len(args) > 2 and args[-1] == "":
            args.pop()
        done = board.call(*args, expect=None)
        cases[label] = {"argv": args[2:], "exit": done.returncode,
                        "stderr": done.stderr.strip()[:200]}
        return done

    attempted("segments_0", level="default", budget="65536", segments="0")
    for value in ("5", "7", "64", "101", "4294967295"):
        attempted("segments_%s" % value, level="default", budget="65536", segments=value)
    attempted("segments_4294967296", level="default", budget="65536", segments="4294967296")
    attempted("budget_65535", level="default", budget="65535", segments="2")
    attempted("budget_65536", level="default", budget="65536", segments="2")
    attempted("budget_4294967295", level="default", budget="4294967295", segments="2")
    attempted("budget_4294967296", level="default", budget="4294967296", segments="2")
    attempted("level_loud", level="loud")

    stored = board.json_call("logs", worker)
    other_stored = board.json_call("logs", other)
    con = sqlite3.connect(str(board.db))
    schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    rows = con.execute("SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    con.close()
    detail = {
        "cases": cases,
        "stored_after_cases": stored,
        "other_session_row_preserved": other_stored,
        "log_policies_schema": schema,
        "policy_rows": rows,
    }
    above_four = [cases["segments_%s" % v]["exit"] for v in ("5", "7", "64", "101", "4294967295")]
    docs_match = (cases["segments_0"]["exit"] == 2
                  and cases["segments_4294967296"]["exit"] == 2
                  and cases["budget_65535"]["exit"] == 2
                  and cases["budget_65536"]["exit"] == 0
                  and cases["budget_4294967295"]["exit"] == 0
                  and cases["budget_4294967296"]["exit"] == 2
                  and cases["level_loud"]["exit"] == 2)
    detail["docs_match"] = docs_match
    detail["above_four_admitted"] = all(code == 0 for code in above_four)
    detail["other_session_preserved"] = (
        other_stored.get("level") == "quiet" and other_stored.get("budgetBytes") == 1048576
        and other_stored.get("keepSegments") == 3)
    detail["constraint_allows_u32"] = bool(schema) and "BETWEEN 1 AND 4294967295" in schema[0]
    ok = (docs_match and detail["above_four_admitted"]
          and detail["other_session_preserved"] and detail["constraint_allows_u32"])
    return ("PASS" if ok else "FAIL"), detail


@check
def old_schema_migration(board):
    """The legacy 1..4 constraint migrates with rows and the registry preserved."""
    worker = "legacy-worker"
    log = board.cwd / "legacy.jsonl"
    board.recruit(worker)
    con = sqlite3.connect(str(board.db))
    con.execute("INSERT INTO log_policies VALUES(?,?,?,?)",
                (worker, "diagnostic", 1048576, 3))
    con.execute("INSERT INTO log_files VALUES(?,?)", (worker, str(log)))
    con.commit()
    con.close()
    detail = {"legacy_schema": LEGACY_TABLES}
    before = board.json_call("logs", worker)
    detail["read_before_write"] = before
    after = board.json_call("logs", worker, "diagnostic", "", "101")
    detail["write_above_four"] = after
    detail["write_above_four_argv"] = ["logs", worker, "diagnostic", "", "101"]
    con = sqlite3.connect(str(board.db))
    schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    policies = con.execute(
        "SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    files = con.execute("SELECT session,log FROM log_files").fetchall()
    legacy_left = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0]
    con.close()
    detail.update({
        "schema_after": schema,
        "policies_after": policies,
        "files_after": files,
        "legacy_table_left_behind": legacy_left,
        "row_preserved": policies == [(worker, "diagnostic", 1048576, 101)],
        "registry_preserved": files == [(worker, str(log))],
        "constraint_migrated": bool(schema) and "BETWEEN 1 AND 4294967295" in schema[0],
        "read_preserved_row": (before.get("level") == "diagnostic"
                               and before.get("budgetBytes") == 1048576
                               and before.get("keepSegments") == 3
                               and before.get("registeredLogs") == 1),
    })
    ok = (detail["read_preserved_row"] and after.get("keepSegments") == 101
          and detail["row_preserved"] and detail["registry_preserved"]
          and detail["constraint_migrated"] and legacy_left == 0)
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
    schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    policies = con.execute(
        "SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    legacy_left = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0]
    con.close()
    detail = {
        "exit": done.returncode,
        "stdout": done.stdout.strip()[:200],
        "stderr": done.stderr.strip()[:300],
        "policies_after": policies,
        "schema_after": schema,
        "legacy_table_left_behind": legacy_left,
        "row_preserved": policies == [(worker, "invalid-legacy-level", 1048576, 3)],
        "constraint_unchanged": bool(schema) and "BETWEEN 1 AND 4" in schema[0],
        "refused": done.returncode != 0,
        "no_policy_answer": '"keepSegments"' not in done.stdout,
        "names_the_constraint": "CHECK constraint failed" in done.stderr,
    }
    ok = (detail["refused"] and detail["no_policy_answer"]
          and detail["row_preserved"] and detail["constraint_unchanged"]
          and legacy_left == 0)
    return ("PASS" if ok else "FAIL"), detail


@check
def checkpoint_reporting_and_survival(board):
    """pendingBytes and pendingPath, the checkpoint survives, odd names are ignored."""
    worker = "checkpoint"
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "4294967295")
    board.run_turn(worker, "checkpoint-t1", log, [terminal()])
    checkpoint = log.parent / (log.name + ".pending")
    checkpoint.write_text('{"type":"tool_execution_update","toolCallId":"held"}\n')
    sparse = {}
    for index in (65, 101, 4294967295):
        path = log.parent / ("%s.%d" % (log.name, index))
        path.write_text("retained sparse evidence\n")
        sparse[index] = path
    ignored = {}
    for name in ("%s.pending" % log.name, "%s.pending.tmp.owner" % log.name,
                 "%s.01" % log.name, "%s.+9" % log.name, "%s. 9" % log.name,
                 "%s.9.stderr" % log.name, "%s.4294967296" % log.name,
                 "%s.z" % log.name):
        path = log.parent / name
        if path != checkpoint:
            path.write_text("preserved artifact\n")
        ignored[name] = path
    _, entry = board.storage_entry(log)
    bytes_before = checkpoint.stat().st_size
    detail = {
        "storage_pendingBytes": entry.get("pendingBytes"),
        "storage_pendingPath": entry.get("pendingPath"),
        "checkpoint_actual_bytes": bytes_before,
        "checkpoint_actual_path": str(checkpoint),
        "reported_indices": sorted(row["index"] for row in entry["rotated"]),
        "reported_index_paths": sorted(row["path"] for row in entry["rotated"]),
    }
    board.call("logs", worker, "default", "65536", "2")
    _, entry2 = board.storage_entry(log)
    eligible = sorted(row["index"] for row in entry2["rotated"] if row["eligible"])
    answer = board.json_call("logs-clean", worker)
    removed = sorted(item["index"] for item in answer["removed"])
    detail.update({
        "eligible_after_lowering": eligible,
        "removed": removed,
        "checkpoint_survived": checkpoint.is_file(),
        "checkpoint_content_intact": checkpoint.is_file()
        and checkpoint.read_text().startswith('{"type":"tool_execution_update"'),
        "sparse_indices_reported": sorted(sparse) == detail["reported_indices"],
        "ignored_names_survived": {name: path.is_file() for name, path in ignored.items()},
        "sparse_removed": all(not path.is_file() for path in sparse.values()),
    })
    ok = (detail["storage_pendingBytes"] == bytes_before
          and detail["storage_pendingPath"] == str(checkpoint)
          and detail["sparse_indices_reported"]
          and eligible == removed == sorted(sparse)
          and detail["checkpoint_survived"] and detail["checkpoint_content_intact"]
          and all(detail["ignored_names_survived"].values()))
    return ("PASS" if ok else "FAIL"), detail


@check
def held_frame_durability(board):
    """A held prefix frame is on disk before the turn ends, and a later turn restores it."""
    worker = "hold"
    board.recruit(worker)
    log = board.log_path(worker)
    checkpoint = log.parent / (log.name + ".pending")
    board.call("logs", worker, "default", "65536", "2")
    frames = [rot_frame(i, 20000) for i in range(8)]
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
    finally:
        (board.cwd / "release").write_text("go\n")
        if proc.poll() is None:
            proc.kill()
    detail = {
        "checkpoint_present_before_kill": checkpoint.is_file(),
        "checkpoint_entries": held,
        "temporary_files": temporary,
        "held_absent_from_public_log": "alpha 2" not in log_before,
        "checkpoint_present_after_kill": checkpoint.is_file(),
    }
    board.run_turn(worker, "hold-t2", log, [terminal("After the restore")])
    segments = board.segments(log)
    # The restore appends to the live log; the next append can then rotate that
    # live log, so the restored frames are read across the whole retained view.
    retained = "".join(
        (segments[index].read_text(errors="replace") for index in sorted(segments, reverse=True)),
        )
    retained += log.read_text(errors="replace") if log.is_file() else ""
    detail.update({
        "restored_alpha_2_in_retained_view": "alpha 2" in retained,
        "restored_bravo_1_in_retained_view": "bravo 1" in retained,
        "restored_alpha_2_in_live_log": "alpha 2" in (log.read_text(errors="replace")
                                                      if log.is_file() else ""),
        "checkpoint_cleared_after_restore": not checkpoint.is_file(),
        "segments_after": sorted(segments),
    })
    ok = (detail["checkpoint_present_before_kill"]
          and sorted(held) == [("tool-a", "alpha 2"), ("tool-b", "bravo 1")]
          and not temporary and detail["held_absent_from_public_log"]
          and detail["checkpoint_present_after_kill"]
          and detail["restored_alpha_2_in_retained_view"]
          and detail["restored_bravo_1_in_retained_view"]
          and detail["checkpoint_cleared_after_restore"])
    return ("PASS" if ok else "FAIL"), detail


@check
def interrupted_read_failure(board):
    """The read-failure arm of consume, and the frame it is meant to write.

    Logs.interrupted writes its frame only when the held set is non-empty
    (logs.bend:325-327). The native read returns Fail on a direct turn only for
    a non-EOF pipe error, and on a retained receive only for the attach open or
    a read error on the single descriptor held for the whole observation, which
    is the first read. Recorded so the check is not silently skipped.
    """
    worker = "readfail"
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "2")
    frames = [tool_update("tool-1", "partial state")] + [terminal()]
    done = board.run_turn(worker, "readfail-t1", log, frames, expect=None)
    lines = board.frames_of(log) if log.is_file() else []
    detail = {
        "graceful_turn_exit": done.returncode,
        "graceful_turn_stderr": done.stderr.strip()[:300],
        "log_frames": [f.get("type") for f in lines],
        "interrupted_frames": len([f for f in lines
                                   if f.get("type") == "baton_log_interrupted"]),
        "held_update_written_on_graceful_end": any(
            f.get("type") == "tool_execution_update" for f in lines),
        "frame_guarded_by_nonempty_held": "logs.bend:325-327 writes no frame when held is empty",
        "durable_copy_instead": "the held set is checkpointed to <log>.pending per frame",
    }
    return "BLOCKED", dict(detail, blocked_on=(
        "no external fixture reaches the read-failure arm with a non-empty held "
        "set, so the baton_log_interrupted frame is untested; the frames it "
        "would flush are now durable in <log>.pending and are verified by the "
        "held_frame_durability check"))


@check
def abrupt_end_keeps_latest_frames(board):
    """The newest held snapshot per identity survives an unfinished stream."""
    worker = "abrupt"
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "2")
    update = [tool_update("tool-1", "partial %d" % i) for i in range(3)]
    board.run_turn(worker, "abrupt-tool", log, update + [terminal()])
    tool_kept = [f for f in board.frames_of(log) if f.get("type") == "tool_execution_update"]

    worker2 = "abrupt2"
    board.recruit(worker2)
    log2 = board.log_path(worker2)
    board.call("logs", worker2, "default", "65536", "2")
    stream = [json.dumps({"type": "message_start", "messageId": "m1",
                          "message": {"role": "assistant", "content": []}})]
    stream += [json.dumps({"type": "message_update", "messageId": "m1",
                           "message": {"role": "assistant",
                                       "content": [{"type": "text",
                                                    "text": "half an answer %d" % i}]}})
               for i in range(3)]
    board.run_turn(worker2, "abrupt-stream", log2, stream,
                   extra="\nimport os\nos._exit(0)\n")
    stream_frames = board.frames_of(log2)
    updates = [f for f in stream_frames if f.get("type") == "message_update"]
    text = json.dumps(stream_frames)
    detail = {
        "tool_call": {
            "tool_update_frames_retained": len(tool_kept),
            "retained_text": [f["partialResult"]["content"][0]["text"] for f in tool_kept],
        },
        "assistant_frames": [f.get("type") for f in stream_frames],
        "message_update_frames_retained": len(updates),
        "latest_assistant_text_retained": "half an answer 2" in text,
        "first_assistant_text_retained": "half an answer 0" in text,
    }
    tool_ok = (len(tool_kept) == 1
               and [f["partialResult"]["content"][0]["text"] for f in tool_kept] == ["partial 2"])
    stream_ok = len(updates) == 1 and detail["latest_assistant_text_retained"]
    if not (tool_ok and stream_ok):
        return "FAIL", detail
    return "PASS", detail


@check
def pending_input_gate(board):
    """A session with unacknowledged input rotates nothing and cleans nothing."""
    worker = "pending"
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "2")
    board.call("message", "hold-1", "root", worker, "guidance", "Answer before rotating.")
    frames = [rot_frame(i) for i in range(10)] + [terminal()]
    board.run_turn(worker, "pending-t1", log, frames)
    segments = board.segments(log)
    live = board.frames_of(log)
    skipped = [f for f in live if f.get("skipped") == "pending-input"]
    _, entry = board.storage_entry(log)
    clean = board.json_call("logs-clean", worker)
    inbox = board.json_call("inbox", worker)
    detail = {
        "segments_after_over_budget_turn": sorted(segments),
        "live_bytes": log.stat().st_size,
        "live_exceeds_budget": log.stat().st_size > 65536,
        "rotation_skipped_frames": len(skipped),
        "storage_pendingInput": entry.get("pendingInput"),
        "storage_pendingBytes": entry.get("pendingBytes"),
        "storage_pendingPath": entry.get("pendingPath"),
        "storage_eligible": [row["index"] for row in entry["rotated"] if row["eligible"]],
        "clean_removed": clean["removed"],
        "clean_skipped": clean.get("skipped"),
        "clean_pendingInput": clean.get("pendingInput"),
        "inbox_still_holds_input": [m["id"] for m in inbox],
    }
    ok = (not segments and detail["live_exceeds_budget"] and len(skipped) >= 1
          and clean["removed"] == [] and clean.get("skipped") == "pending-input"
          and "hold-1" in detail["inbox_still_holds_input"]
          and entry.get("pendingBytes") == 0
          and entry.get("pendingPath") == str(log) + ".pending")
    return ("PASS" if ok else "FAIL"), detail


@check
def cleanup_eligibility(board):
    """logs-clean removes exactly the segments logs-storage marks eligible."""
    worker = "clean"
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "4")
    frames = [rot_frame(i) for i in range(24)] + [terminal()]
    board.run_turn(worker, "clean-t1", log, frames)
    segments_before = board.segments(log)
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
    _, entry = board.storage_entry(log)
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
    ok = (removed == preview and detail["removed_all_reported_ok"] and log.is_file()
          and all(i in segments_after for i in (1, 2)) and second["removed"] == []
          and all(detail["sentinels_survived"].values())
          and detail["attempt_sentinel_survived"])
    return ("PASS" if ok else "FAIL"), detail


@check
def rotation_failure_reporting(board):
    """A failed shift stops the chain and is reported beside the appended frame."""
    worker = "shiftfail"
    board.recruit("shiftfail-bystander")
    board.recruit(worker)
    log = board.log_path(worker)
    board.call("logs", worker, "default", "65536", "2")
    board.run_turn(worker, "shiftfail-warm", log,
                   [rot_frame(i) for i in range(6)] + [terminal()])
    warm = board.segments(log)
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
        (board.cwd / "release").write_text("go\n")
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
        "writer_a_exit": proc_a.returncode,
        "writer_b_state": b_state,
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
    tail_b = is_tail(sorted(ids_b, key=lambda v: int(v[1:])),
                     ["r%d" % i for i in range(100, 108)])
    detail["first_writer_kept_a_contiguous_tail"] = tail_a
    detail["second_writer_kept_a_contiguous_tail"] = tail_b
    ok = (proc_a.returncode == 0 and proc_b.returncode == 0
          and not corrupt and not reported and tail_a and tail_b)
    return ("PASS" if ok else "FAIL"), detail


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
        legacy = LEGACY_TABLES if fn in (old_schema_migration, failed_migration_preserves_rows) else None
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
