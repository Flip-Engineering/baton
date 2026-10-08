#!/usr/bin/env python3
"""Independent acceptance checks for baton issue #686 at commit 351c9aba.

Exact-source validation of the composed candidate
`codex/core-integration-candidate-20261008` (logging lineage 307b8597 plus the
core repair 50ff4ffb). This drives the coordinator CLI only. Expectations come
from the contract in docs/bend2/logging.md and from the acceptance items
assigned to the validator, never from the implementation's own tests.

    python3 issue686_acceptance_351.py --exe .scratch/bend2/baton2 [--only NAME]

Each check prints one JSON object: {"check", "status", "detail"}. Status is
PASS, FAIL (the observed behaviour contradicts the stated contract), or BLOCKED
(the behaviour contradicts an acceptance requirement that the stated contract
does not yet cover, or the required evidence cannot be produced). The process
exits 1 when any check fails.

Surface notes for this candidate, taken from the source, not assumed:

* A direct turn rebinds its public log once per turn to
  `Logs.attempt_log(base, turn_id)` = `<base>.attempt-<code(turn_id)>`, and the
  checkpoint and the stderr sidecar follow the rebound path. The base path is
  not listed by `logs-storage` unless something registered it.
* `logs-clean` answers with `removed`, `attemptFiles` and `attemptLogs`.
* The native stderr bound is the session log budget (`Logs.stderr_limit`).
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

RECORDED_MEASUREMENT = {
    "small": 113,
    "cumulative": 118,
    "tool": 112,
}


def check(fn):
    CHECKS.append(fn)
    return fn


def git(*args, cwd):
    subprocess.run(["git", *args], cwd=str(cwd), check=True, capture_output=True)


class Board:
    """One isolated coordinator database and the fixtures a check needs."""

    def __init__(self, exe, root, name, legacy=None, repo=None):
        self.exe = str(pathlib.Path(exe).resolve())
        self.repo = pathlib.Path(repo or ".").resolve()
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
        self.checkout_repo = self.cwd / "repository"
        self.checkout_repo.mkdir()
        self.checkouts = self.cwd / "checkouts"
        self.checkouts.mkdir()
        git("init", "-q", "-b", "main", cwd=self.checkout_repo)
        git("config", "user.email", "acceptance@example.invalid", cwd=self.checkout_repo)
        git("config", "user.name", "Acceptance", cwd=self.checkout_repo)
        (self.checkout_repo / "seed.txt").write_text("seed\n")
        git("add", "seed.txt", cwd=self.checkout_repo)
        git("commit", "-q", "-m", "seed", cwd=self.checkout_repo)
        self.base = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=str(self.checkout_repo), check=True,
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
                         str(self.checkout_repo), name + "-branch",
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

    def run_turn(self, player, turn_id, base_log, frames, extra="", expect=0):
        self.events.write_text("\n".join(frames) + "\n")
        self.write_fixture(extra)
        return self.call("turn", player, turn_id, str(self.fixture), "model", "low",
                         str(self.cwd), str(self.task), str(base_log), "", expect=expect)

    def spawn_turn(self, player, turn_id, base_log, frames, extra=""):
        self.events.write_text("\n".join(frames) + "\n")
        self.write_fixture(extra)
        return subprocess.Popen(
            [self.exe, str(self.db), "turn", player, turn_id, str(self.fixture), "model",
             "low", str(self.cwd), str(self.task), str(base_log), ""],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    # -- registered log discovery -----------------------------------------

    def storage(self):
        return self.json_call("logs-storage")

    def log_entries(self, worker, base=None):
        rows = [row for row in self.storage()["logs"] if row["session"] == worker]
        if base is not None:
            stem = str(base) + ".attempt-"
            rows = [row for row in rows if row["path"] == str(base) or row["path"].startswith(stem)]
        return rows

    def generation(self, worker, base, turn_id):
        """The path this candidate should have rebound the base log to."""
        entries = self.log_entries(worker, base)
        for row in entries:
            if row.get("attempt") == turn_id:
                return pathlib.Path(row["path"]), row
        expected = pathlib.Path("%s.attempt-%s" % (base, turn_id))
        return expected, next((row for row in entries if row["path"] == str(expected)), {})

    # -- log inspection ----------------------------------------------------

    @staticmethod
    def segments(path, limit=32):
        found = {}
        for index in range(1, limit + 1):
            candidate = path.parent / ("%s.%d" % (path.name, index))
            if candidate.is_file():
                found[index] = candidate
        return found

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
    def retained_view(path):
        """The reader's order: highest numbered segment first, then the live log."""
        ids = []
        segments = Board.segments(path)
        for index in sorted(segments, reverse=True):
            ids.extend(frame.get("id") for frame in Board.frames_of(segments[index])
                       if frame.get("id") is not None)
        ids.extend(frame.get("id") for frame in Board.frames_of(path)
                   if frame.get("id") is not None)
        return ids

    @staticmethod
    def retained_text(path):
        segments = Board.segments(path)
        text = ""
        for index in sorted(segments, reverse=True):
            text += segments[index].read_text(errors="replace")
        if pathlib.Path(path).is_file():
            text += pathlib.Path(path).read_text(errors="replace")
        return text


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
    """General enumeration and configured counts, including above the old ceiling."""
    detail = {}
    ok = True
    for keep in (1, 2, 3, 4, 5, 7):
        worker = "depth-%d" % keep
        board.recruit(worker)
        base = board.cwd / ("%s.jsonl" % worker)
        board.call("logs", worker, "default", "65536", str(keep))
        turn = "%s-t1" % worker
        frames = [rot_frame(i) for i in range(30)] + [terminal()]
        board.run_turn(worker, turn, base, frames)
        path, entry = board.generation(worker, base, turn)
        segments = board.segments(path)
        retained = board.retained_view(path)
        wanted = ["r%d" % i for i in range(30)]
        suffix = wanted[len(wanted) - len(retained):]
        row = {
            "configured": keep,
            "generation_path_suffix": path.name.replace(base.name, "<base>"),
            "segments_present": sorted(segments),
            "segment_count": len(segments),
            "max_index": max(segments) if segments else 0,
            "retained_frames": len(retained),
            "retained_is_contiguous_suffix": retained == suffix,
        }
        row["count_matches_configured"] = len(segments) == keep
        row["index_within_count"] = (max(segments) if segments else 0) <= keep
        if not (row["count_matches_configured"] and row["index_within_count"]
                and row["retained_is_contiguous_suffix"]):
            ok = False
        detail[worker] = row
    return ("PASS" if ok else "FAIL"), detail


@check
def concurrent_writers(board):
    """Two turns on one output-log base, and the stderr budget they share."""
    first, second = "writer-a", "writer-b"
    board.recruit(first)
    board.recruit(second)
    base = board.cwd / "shared.jsonl"
    for worker in (first, second):
        board.call("logs", worker, "default", "65536", "2")
    frames_a = [rot_frame(i) for i in range(8)]
    extra_a = ("\nimport pathlib, time\n"
               "while not pathlib.Path('release').exists(): time.sleep(0.05)\n"
               "sys.stdout.write(" + repr(terminal("Writer A finish")) + " + '\\n')\n"
               "sys.stdout.flush()\n")
    proc_a = board.spawn_turn(first, "writer-a-t1", base, frames_a, extra=extra_a)
    err_a = err_b = ""
    b_state = "not_started"
    try:
        proc_b = board.spawn_turn(second, "writer-b-t1", base,
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

    entries = board.log_entries(first, base) + board.log_entries(second, base)
    paths = {row["path"]: row for row in entries}
    attempt_of_path = {row["path"]: row.get("attempt") for row in entries}
    corrupt = []
    for path in paths:
        for name in [pathlib.Path(path), *Board.segments(pathlib.Path(path)).values()]:
            for line in name.read_text(errors="replace").splitlines():
                if not line.strip():
                    continue
                try:
                    json.loads(line)
                except ValueError:
                    corrupt.append({"file": name.name, "line": line[:120]})
    # A repeated turn identity rebinds to the same generation file.
    board.run_turn(first, "writer-a-t1", base, [terminal("Writer A again")])
    repeat_entries = board.log_entries(first, base)
    repeat_paths = {row["path"] for row in repeat_entries}
    detail = {
        "writer_a_exit": proc_a.returncode,
        "writer_b_exit": proc_b.returncode,
        "writer_b_state": b_state,
        "writer_a_stderr": err_a.strip()[:200],
        "writer_b_stderr": err_b.strip()[:200],
        "registered_generations": sorted(paths),
        "generation_attempts": attempt_of_path,
        "base_log_written": base.is_file(),
        "distinct_generation_paths": len({row["path"] for row in entries
                                          if row["session"] in (first, second)}),
        "corrupt_lines": corrupt,
        "repeat_turn_reused_path": str(paths and sorted(paths)[0]) in repeat_paths,
        "generation_count_after_repeat": len(repeat_paths),
    }
    ok = (proc_a.returncode == 0 and proc_b.returncode == 0
          and not corrupt and not base.is_file()
          and detail["distinct_generation_paths"] == 2
          and set(attempt_of_path.values()) == {"writer-a-t1", "writer-b-t1"}
          and detail["repeat_turn_reused_path"])
    return ("PASS" if ok else "FAIL"), detail


@check
def stderr_budget_sharing(board):
    """The native stderr bound is the session log budget."""
    worker = "stderr"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "stderr-t1"
    written = 400000
    extra = ("\nimport sys\n"
             "sys.stderr.write('E' * %d)\n"
             "sys.stderr.flush()\n" % written)
    board.run_turn(worker, turn, base, [terminal()], extra=extra)
    path, entry = board.generation(worker, base, turn)
    stderr_runs = board.cwd.glob(path.name + ".stderr*")
    sizes = {p.name: p.stat().st_size for p in sorted(stderr_runs)}
    accounted = entry.get("accountedBytes")
    expected_accounted = (entry.get("bytes", 0) + entry.get("stderrBytes", 0)
                          + entry.get("stderrSpoolBytes", 0)
                          + entry.get("stderrMetadataBytes", 0)
                          + entry.get("stderrProcessingErrorBytes", 0)
                          + entry.get("pendingBytes", 0))
    detail = {
        "stderr_written_by_fixture": written,
        "budget_bytes": 65536,
        "stderr_run_files": sizes,
        "storage_stderrBytes": entry.get("stderrBytes"),
        "storage_stderrSpoolBytes": entry.get("stderrSpoolBytes"),
        "storage_stderrMetadataBytes": entry.get("stderrMetadataBytes"),
        "storage_stderrProcessingErrorBytes": entry.get("stderrProcessingErrorBytes"),
        "storage_accountedBytes": accounted,
        "accounted_identity_holds": accounted == expected_accounted,
        "bounded_view_within_budget": (entry.get("stderrBytes") or 0) <= 65536,
        "spool_retains_written_bytes": (entry.get("stderrSpoolBytes") or 0) >= written,
    }
    ok = (detail["bounded_view_within_budget"] and detail["accounted_identity_holds"]
          and detail["spool_retains_written_bytes"])
    return ("PASS" if ok else "FAIL"), detail


@check
def cleanup_eligibility(board):
    """Registered segments only, generation suffixes skipped, pending gate."""
    worker = "clean"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "4")
    turn = "clean-t1"
    board.run_turn(worker, turn, base, [rot_frame(i) for i in range(30)] + [terminal()])
    path, entry = board.generation(worker, base, turn)
    segments_before = board.segments(path)
    # Names the walk must not treat as numbered segments, and one segment whose
    # file belongs to no registered log.
    ignored = {}
    for name in ("%s.attempt-ghost" % path.name, "%s.01" % path.name, "%s.+9" % path.name,
                 "%s. 9" % path.name, "%s.9.stderr" % path.name, "%s.z" % path.name,
                 "%s.pending.tmp.owner" % path.name, "%s.4294967296" % path.name):
        sentinel = path.parent / name
        sentinel.write_text("preserved artifact\n")
        ignored[name] = sentinel
    unregistered = path.parent / "unregistered.jsonl.9"
    unregistered.write_text("unregistered evidence\n")
    board.call("logs", worker, "default", "65536", "2")
    _, entry2 = board.generation(worker, base, turn)
    preview = [row["index"] for row in entry2["rotated"] if row["eligible"]]
    answer = board.json_call("logs-clean", worker)
    removed = [item["index"] for item in answer["removed"]]
    segments_after = board.segments(path)
    second = board.json_call("logs-clean", worker)
    detail = {
        "segments_before_clean": sorted(segments_before),
        "preview_eligible": preview,
        "clean_removed": removed,
        "segments_after_clean": sorted(segments_after),
        "kept_indices_present": [i for i in (1, 2) if i in segments_after],
        "newest_generation_live_file_survives": path.is_file(),
        "attemptLogs_answer": answer.get("attemptLogs"),
        "attemptFiles_answer_len": len(answer.get("attemptFiles") or []),
        "second_clean_removed": second["removed"],
        "ignored_names_survived": {name: sentinel.is_file() for name, sentinel in ignored.items()},
        "unregistered_segment_survived": unregistered.is_file(),
        "removed_paths_within_generation": all(
            pathlib.Path(item["path"]).parent == path.parent
            and pathlib.Path(item["path"]).name.startswith(path.name + ".")
            for item in answer["removed"]),
    }
    # Pending gate on the same fixture.
    board.call("message", "hold-clean", "root", worker, "guidance", "Answer before cleaning.")
    gated = board.json_call("logs-clean", worker)
    detail["gated_removed"] = gated["removed"]
    detail["gated_skipped"] = gated.get("skipped")
    detail["gated_attemptLogs"] = gated.get("attemptLogs")
    ok = (removed == preview and detail["kept_indices_present"] == [1, 2]
          and path.is_file() and second["removed"] == []
          and all(detail["ignored_names_survived"].values())
          and detail["unregistered_segment_survived"]
          and detail["removed_paths_within_generation"]
          and gated["removed"] == [] and gated.get("skipped") == "pending-input")
    return ("PASS" if ok else "FAIL"), detail


@check
def checkpoint_reporting_and_survival(board):
    """New storage fields, and the checkpoint across storage and cleanup."""
    worker = "checkpoint"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "4294967295")
    turn = "checkpoint-t1"
    board.run_turn(worker, turn, base, [terminal()])
    path, entry = board.generation(worker, base, turn)
    checkpoint = path.parent / (path.name + ".pending")
    checkpoint.write_text('{"type":"tool_execution_update","toolCallId":"held"}\n')
    for index in (65, 101):
        (path.parent / ("%s.%d" % (path.name, index))).write_text("retained sparse evidence\n")
    _, entry = board.generation(worker, base, turn)
    bytes_before = checkpoint.stat().st_size
    detail = {
        "storage_attempt": entry.get("attempt"),
        "storage_keys": sorted(entry.keys()),
        "storage_pendingBytes": entry.get("pendingBytes"),
        "storage_pendingPath": entry.get("pendingPath"),
        "checkpoint_actual_bytes": bytes_before,
        "checkpoint_actual_path": str(checkpoint),
        "reported_indices": sorted(row["index"] for row in entry["rotated"]),
        "accountedBytes": entry.get("accountedBytes"),
    }
    board.call("logs", worker, "default", "65536", "2")
    _, entry2 = board.generation(worker, base, turn)
    eligible = sorted(row["index"] for row in entry2["rotated"] if row["eligible"])
    answer = board.json_call("logs-clean", worker)
    removed = sorted(item["index"] for item in answer["removed"])
    detail.update({
        "eligible_after_lowering": eligible,
        "removed": removed,
        "checkpoint_survived": checkpoint.is_file(),
        "checkpoint_content_intact": checkpoint.is_file()
        and checkpoint.read_text().startswith('{"type":"tool_execution_update"'),
        "sparse_removed": all(not (path.parent / ("%s.%d" % (path.name, i))).is_file()
                              for i in (65, 101)),
        "generation_live_file_survives": path.is_file(),
    })
    ok = (entry.get("pendingBytes") == bytes_before
          and entry.get("pendingPath") == str(checkpoint)
          and entry.get("attempt") == turn
          and eligible == removed == [65, 101]
          and detail["checkpoint_survived"] and detail["checkpoint_content_intact"]
          and detail["generation_live_file_survives"])
    return ("PASS" if ok else "FAIL"), detail


@check
def pending_input_gate(board):
    """Rotation and cleanup skip while input is unacknowledged."""
    worker = "pending"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    board.call("message", "hold-1", "root", worker, "guidance", "Answer before rotating.")
    turn = "pending-t1"
    board.run_turn(worker, turn, base, [rot_frame(i) for i in range(10)] + [terminal()])
    path, entry = board.generation(worker, base, turn)
    live = board.frames_of(path)
    skipped = [f for f in live if f.get("skipped") == "pending-input"]
    clean = board.json_call("logs-clean", worker)
    inbox = board.json_call("inbox", worker)
    detail = {
        "generation_path_exists": path.is_file(),
        "segments_after_over_budget_turn": sorted(board.segments(path)),
        "live_bytes": path.stat().st_size if path.is_file() else 0,
        "live_exceeds_budget": path.is_file() and path.stat().st_size > 65536,
        "rotation_skipped_frames": len(skipped),
        "storage_pendingInput": entry.get("pendingInput"),
        "storage_eligible": [row["index"] for row in entry["rotated"] if row["eligible"]],
        "clean_removed": clean["removed"],
        "clean_attemptLogs": clean.get("attemptLogs"),
        "clean_skipped": clean.get("skipped"),
        "clean_pendingInput": clean.get("pendingInput"),
        "inbox_still_holds_input": [m["id"] for m in inbox],
    }
    ok = (not detail["segments_after_over_budget_turn"] and detail["live_exceeds_budget"]
          and len(skipped) >= 1 and clean["removed"] == []
          and clean.get("skipped") == "pending-input"
          and (clean.get("attemptLogs") or []) == []
          and "hold-1" in detail["inbox_still_holds_input"])
    return ("PASS" if ok else "FAIL"), detail


@check
def rotation_failure_reporting(board):
    """A failed shift stops the chain and is named beside the appended frame."""
    worker = "shiftfail"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "shiftfail-t1"
    board.run_turn(worker, turn, base, [rot_frame(i) for i in range(6)] + [terminal()])
    path, _ = board.generation(worker, base, turn)
    warm = board.segments(path)
    blocker = path.parent / ("%s.2" % path.name)
    if blocker.exists():
        blocker.unlink()
    blocker.mkdir()
    board.run_turn(worker, turn, base, [rot_frame(i) for i in range(6, 16)]
                   + [terminal("After the failure")])
    live = board.frames_of(path)
    failed = [f for f in live if f.get("failed") is True]
    rotated = [f for f in live if f.get("type") == "baton_log_rotation"]
    detail = {
        "warm_segments": sorted(warm),
        "blocker_is_directory": blocker.is_dir(),
        "rotation_frames": rotated[:3],
        "failed_frames": failed[:2],
        "segments_after": sorted(board.segments(path)),
        "live_has_late_frame": any(f.get("id") == "r15" for f in live),
        "live_has_terminal": any(f.get("type") == "agent_end" for f in live),
    }
    ok = (bool(failed) and detail["live_has_late_frame"]
          and detail["live_has_terminal"] and blocker.is_dir())
    return ("PASS" if ok else "FAIL"), detail


@check
def held_frame_durability(board):
    """The rebound checkpoint survives a kill and restores on the next turn."""
    worker = "hold"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "hold-t1"
    frames = [rot_frame(i, 20000) for i in range(8)]
    frames += [tool_update("tool-a", "alpha 1"), tool_update("tool-a", "alpha 2"),
               tool_update("tool-b", "bravo 1")]
    extra = ("\nimport pathlib, time\n"
             "while not pathlib.Path('release').exists(): time.sleep(0.05)\n")
    proc = board.spawn_turn(worker, turn, base, frames, extra=extra)
    try:
        deadline = time.time() + 45
        while time.time() < deadline:
            path, _ = board.generation(worker, base, turn)
            checkpoint = path.parent / (path.name + ".pending")
            if checkpoint.is_file() and "alpha 2" in checkpoint.read_text(errors="replace") \
                    and "bravo 1" in checkpoint.read_text(errors="replace"):
                break
            if proc.poll() is not None:
                break
            time.sleep(0.05)
        path, _ = board.generation(worker, base, turn)
        checkpoint = path.parent / (path.name + ".pending")
        held = [(f.get("toolCallId"), f["partialResult"]["content"][0]["text"])
                for f in board.frames_of(checkpoint)] if checkpoint.is_file() else []
        temporary = sorted(p.name for p in path.parent.glob(path.name + ".pending.tmp.*"))
        log_before = path.read_text(errors="replace") if path.is_file() else ""
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=30)
        detail = {
            "generation_path": path.name,
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
    board.run_turn(worker, turn, base, [terminal("After the restore")])
    path2, _ = board.generation(worker, base, turn)
    retained = board.retained_text(path2)
    checkpoint = path2.parent / (path2.name + ".pending")
    detail.update({
        "same_generation_reused": path2 == path,
        "restored_alpha_2": "alpha 2" in retained,
        "restored_bravo_1": "bravo 1" in retained,
        "checkpoint_cleared_after_restore": not checkpoint.is_file(),
    })
    ok = (detail["checkpoint_present_before_kill"]
          and sorted(held) == [("tool-a", "alpha 2"), ("tool-b", "bravo 1")]
          and not temporary and detail["held_absent_from_public_log"]
          and detail["checkpoint_present_after_kill"]
          and detail["same_generation_reused"]
          and detail["restored_alpha_2"] and detail["restored_bravo_1"]
          and detail["checkpoint_cleared_after_restore"])
    return ("PASS" if ok else "FAIL"), detail


@check
def abrupt_end_keeps_latest_frames(board):
    """The newest held snapshot per identity survives an unterminated stream."""
    worker = "abrupt"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "abrupt-tool"
    update = [tool_update("tool-1", "partial %d" % i) for i in range(3)]
    board.run_turn(worker, turn, base, update + [terminal()])
    path, _ = board.generation(worker, base, turn)
    tool_kept = [f for f in board.frames_of(path) if f.get("type") == "tool_execution_update"]

    worker2 = "abrupt2"
    board.recruit(worker2)
    base2 = board.cwd / ("%s.jsonl" % worker2)
    board.call("logs", worker2, "default", "65536", "2")
    turn2 = "abrupt-stream"
    stream = [json.dumps({"type": "message_start", "messageId": "m1",
                          "message": {"role": "assistant", "content": []}})]
    stream += [json.dumps({"type": "message_update", "messageId": "m1",
                           "message": {"role": "assistant",
                                       "content": [{"type": "text",
                                                    "text": "half an answer %d" % i}]}})
               for i in range(3)]
    board.run_turn(worker2, turn2, base2, stream, extra="\nimport os\nos._exit(0)\n")
    path2, _ = board.generation(worker2, base2, turn2)
    stream_frames = board.frames_of(path2)
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
def only_copy_evidence(board):
    """A terminal frame reaches the database and the report survives rotation."""
    worker = "onlycopy"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "onlycopy-t1"
    frames = [rot_frame(i) for i in range(30)] + [terminal("Only copy answer")]
    board.run_turn(worker, turn, base, frames)
    path, entry = board.generation(worker, base, turn)
    retained = board.retained_view(path)
    delivered = board.json_call("delivery", turn)
    con = sqlite3.connect(str(board.db))
    turns = con.execute("SELECT id,worker,event FROM turns WHERE id=?", (turn,)).fetchall()
    observations = con.execute(
        "SELECT turn_id,event_sha256,projection FROM log_terminal_observations WHERE turn_id=?",
        (turn,)).fetchall()
    con.close()
    stored = json.loads(turns[0][2]) if turns else {}
    projection = json.loads(observations[0][2]) if observations else {}
    detail = {
        "retained_ids": retained,
        "dropped_oldest_ids": [i for i in ("r%d" % n for n in range(30)) if i not in retained],
        "delivery_body": delivered.get("body"),
        "turns_rows": len(turns),
        "terminal_event_type": stored.get("type"),
        "terminal_observation_rows": len(observations),
        "terminal_projection": projection,
        "terminal_frame_retained_in_public_log": any(
            f.get("type") == "agent_end" for f in board.frames_of(path)),
        "storage_attempt": entry.get("attempt"),
    }
    ok = (delivered.get("body") == "Only copy answer"
          and detail["turns_rows"] == 1 and stored.get("type") == "agent_end"
          and detail["terminal_observation_rows"] == 1
          and projection.get("eventType") == "agent_end"
          and detail["terminal_frame_retained_in_public_log"])
    return ("PASS" if ok else "FAIL"), detail


@check
def source_and_preservation(board):
    """Policy bounds, the legacy table migration and its failure path."""
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
        cases[label] = {"argv": args[2:], "exit": done.returncode}
        return done

    attempted("segments_0", level="default", budget="65536", segments="0")
    for value in ("5", "7", "64", "101", "4294967295"):
        attempted("segments_%s" % value, level="default", budget="65536", segments=value)
    attempted("segments_4294967296", level="default", budget="65536", segments="4294967296")
    attempted("budget_65535", level="default", budget="65535", segments="2")
    attempted("budget_65536", level="default", budget="65536", segments="2")
    attempted("budget_4294967296", level="default", budget="4294967296", segments="2")
    attempted("level_loud", level="loud")
    stored = board.json_call("logs", worker)
    other_stored = board.json_call("logs", other)
    detail = {
        "cases": cases,
        "stored_after_cases": stored,
        "other_session_row_preserved": other_stored,
        "docs_match": (cases["segments_0"]["exit"] == 2
                       and cases["segments_4294967296"]["exit"] == 2
                       and cases["budget_65535"]["exit"] == 2
                       and cases["budget_65536"]["exit"] == 0
                       and cases["budget_4294967296"]["exit"] == 2
                       and cases["level_loud"]["exit"] == 2),
        "above_four_admitted": all(cases["segments_%s" % v]["exit"] == 0
                                   for v in ("5", "7", "64", "101", "4294967295")),
    }
    return ("PASS" if (detail["docs_match"] and detail["above_four_admitted"]
                       and other_stored.get("level") == "quiet") else "FAIL"), detail


@check
def old_schema_migration(board):
    """The legacy 1..4 constraint migrates with rows and registry preserved."""
    worker = "legacy-worker"
    board.recruit(worker)
    log = str(board.cwd / "legacy.jsonl")
    con = sqlite3.connect(str(board.db))
    con.execute("INSERT INTO log_policies VALUES(?,?,?,?)", (worker, "diagnostic", 1048576, 3))
    con.execute("INSERT INTO log_files VALUES(?,?)", (worker, log))
    con.commit()
    con.close()
    before = board.json_call("logs", worker)
    after = board.json_call("logs", worker, "diagnostic", "", "101")
    con = sqlite3.connect(str(board.db))
    schema = [row[0] for row in con.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='log_policies'")]
    policies = con.execute(
        "SELECT session,level,budget_bytes,keep_segments FROM log_policies").fetchall()
    files = con.execute("SELECT session,log FROM log_files").fetchall()
    legacy_left = con.execute(
        "SELECT count(*) FROM sqlite_master WHERE name='log_policies_legacy'").fetchone()[0]
    con.close()
    detail = {
        "legacy_schema": LEGACY_TABLES,
        "read_before_write": before,
        "write_above_four": after,
        "schema_after": schema,
        "policies_after": policies,
        "files_after": files,
        "legacy_table_left_behind": legacy_left,
        "row_preserved": policies == [(worker, "diagnostic", 1048576, 101)],
        "registry_preserved": files == [(worker, log)],
        "constraint_migrated": bool(schema) and "BETWEEN 1 AND 4294967295" in schema[0],
        "read_preserved_row": (before.get("level") == "diagnostic"
                               and before.get("budgetBytes") == 1048576
                               and before.get("keepSegments") == 3
                               and before.get("registeredLogs") == 1),
    }
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
    ok = (detail["refused"] and detail["no_policy_answer"] and detail["row_preserved"]
          and detail["constraint_unchanged"] and legacy_left == 0)
    return ("PASS" if ok else "FAIL"), detail


@check
def measurement_driver_audit(board):
    """Run the measurement driver and compare its row with the recorded one."""
    driver = board.repo / "bend2" / "scripts" / "measure-omp-stream.py"
    recorded_path = board.repo / "docs" / "bend2" / "measurements" / "2026-10-06-logging-policy.json"
    if not driver.is_file():
        return "BLOCKED", {"blocked_on": "no driver at %s" % driver}
    out = board.root / "measure"
    shutil.rmtree(out, ignore_errors=True)
    done = subprocess.run([sys.executable, str(driver), "--exe", board.exe,
                           "--output", str(out), "--label", "validator-351c9aba",
                           "--source-revision", "351c9aba"],
                          text=True, capture_output=True, timeout=900)
    results = {}
    for name in ("result.json", "measurement.json"):
        candidate = out / name
        if candidate.is_file():
            results = json.loads(candidate.read_text())
            break
    payload = results.get("results") or results.get("batches") or []
    retained = {}
    for item in payload:
        if isinstance(item, dict) and item.get("kind"):
            retained[item["kind"]] = item.get("retained_bytes")
    recorded = json.loads(recorded_path.read_text())["retained_bytes"]["candidate"] \
        if recorded_path.is_file() else {}
    detail = {
        "driver_exit": done.returncode,
        "driver_stderr_tail": done.stderr.strip()[-300:],
        "result_json_files": sorted(p.name for p in out.glob("*.json")),
        "retained_bytes": retained,
        "recorded_candidate_row": recorded,
        "reproduced": {kind: retained.get(kind) == value
                       for kind, value in RECORDED_MEASUREMENT.items()},
        "driver_head": results.get("driver_source_head", "absent"),
        "native_log_bytes": (out / "native.jsonl").stat().st_size
        if (out / "native.jsonl").is_file() else None,
    }
    ok = (detail["reproduced"] and all(detail["reproduced"].values()))
    if not results:
        return "BLOCKED", dict(detail, blocked_on="the driver wrote no result JSON")
    return ("PASS" if ok else "FAIL"), detail


@check
def interrupted_read_failure(board):
    """The read-failure arm and the frame it is meant to write."""
    worker = "readfail"
    board.recruit(worker)
    base = board.cwd / ("%s.jsonl" % worker)
    board.call("logs", worker, "default", "65536", "2")
    turn = "readfail-t1"
    frames = [tool_update("tool-1", "partial state")] + [terminal()]
    done = board.run_turn(worker, turn, base, frames, expect=None)
    path, _ = board.generation(worker, base, turn)
    lines = board.frames_of(path)
    detail = {
        "graceful_turn_exit": done.returncode,
        "log_frames": [f.get("type") for f in lines],
        "interrupted_frames": len([f for f in lines
                                   if f.get("type") == "baton_log_interrupted"]),
        "held_update_written_on_graceful_end": any(
            f.get("type") == "tool_execution_update" for f in lines),
        "frame_guarded_by_nonempty_held": "logs.bend:334-336 writes no frame when held is empty",
        "delivered_test_coverage": "no file under bend2/test names baton_log_interrupted",
        "durable_copy_instead": "the held set is checkpointed to <generation>.pending per frame",
    }
    return "BLOCKED", dict(detail, blocked_on=(
        "no fixture reaches the read-failure arm with a non-empty held set, so "
        "no baton_log_interrupted frame can be observed; the held frames it "
        "would flush are durable in the generation checkpoint instead"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--exe", default=".scratch/bend2/baton2")
    parser.add_argument("--root", default=None)
    parser.add_argument("--repo", default=".")
    parser.add_argument("--only", action="append", default=[])
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    exe = pathlib.Path(args.exe)
    if not exe.is_file():
        print(json.dumps({"error": "no executable at %s" % exe}))
        return 2
    root = pathlib.Path(args.root or tempfile.mkdtemp(prefix="issue686-351-"))
    root.mkdir(parents=True, exist_ok=True)
    selected = [fn for fn in CHECKS if not args.only or fn.__name__ in args.only]
    results = []
    for fn in selected:
        legacy = LEGACY_TABLES if fn in (old_schema_migration, failed_migration_preserves_rows) else None
        board = Board(exe, root, fn.__name__, legacy=legacy, repo=args.repo)
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
