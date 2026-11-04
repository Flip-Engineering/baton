"""Real-entrypoint checks for the shared-storage writer lease (#912).

The focused receiver writes one controlled OMP frame, pauses while it holds the
shared root lease, and resumes to a terminal frame. storage-apply must refuse
while the writer holds the lease and must leave log, spool and checkpoint bytes
unchanged. After the terminal frame and ACK release the lease, a fresh apply may
evaluate the settled root. A second case holds the exclusive cleanup lease
first and requires the writer entrypoint to refuse without spawning native.
"""
import fcntl
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FOCUSED = pathlib.Path(os.environ["BATON2_STORAGE_FOCUSED_BINARY"]).resolve()
SETUP = pathlib.Path(os.environ["BATON2_SETUP_BINARY"]).resolve()
RUNTIME = pathlib.Path(os.environ.get(
    "BATON2_INTEGRATION_RUNTIME",
    "/mnt/nvme4tb/ci-runners/baton2-native-homelab/rt"))


FAKE_OMP = '''#!/usr/bin/env python3
import json, os, sqlite3, time
attempt = os.environ["BATON_ATTEMPT_DIRECTORY"]
with open(attempt + "/fixture-spawned", "w") as spawned:
    spawned.write("1")
marker = attempt + "/fixture-frame1"
resume = attempt + "/fixture-continue"
print(json.dumps({"type": "message_end", "message": {
    "id": "frame-1", "role": "assistant",
    "content": [{"type": "text", "text": "first frame"}]}}), flush=True)
with open(marker, "w") as ready:
    ready.write("1")
while not os.path.exists(resume):
    time.sleep(0.02)
with sqlite3.connect(os.environ["BATON_DATABASE"]) as database:
    database.execute(
        "UPDATE messages SET receipt='fixture native reviewed' "
        "WHERE recipient=? AND receipt IS NULL", (os.environ["BATON_SESSION"],))
print(json.dumps({"type": "message_end", "message": {
    "id": "frame-2", "role": "assistant",
    "content": [{"type": "text", "text": "second frame"}]}}), flush=True)
print(json.dumps({"type": "agent_end", "isTerminal": True, "messages": [
    {"role": "assistant", "content": [{"type": "text", "text": "done"}]}]}),
    flush=True)
'''


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1 << 16), b""):
            digest.update(chunk)
    return digest.hexdigest()


def retained_snapshot(storage, attempt):
    found = {}
    paths = list(attempt.rglob("*")) + list((storage / "logs").rglob("*"))
    for path in sorted(paths):
        if path.is_file():
            found[str(path)] = (path.stat().st_size, sha256(path))
    return found


class StorageWriterIntegration(unittest.TestCase):
    def setUp(self):
        for name, binary in (("focused receiver", FOCUSED), ("setup coordinator", SETUP)):
            if not binary.exists():
                self.skipTest(f"{name} not built at {binary}")
        if not shutil.which("git") or not shutil.which("sqlite3"):
            self.skipTest("git and sqlite3 are required")
        self.temp = tempfile.TemporaryDirectory(
            prefix="storage-writer-", dir=ROOT / ".scratch" / "bend2")
        self.addCleanup(self.temp.cleanup)
        base = pathlib.Path(self.temp.name)
        (base / "storage" / "logs").mkdir(parents=True)
        self.repo = base / "repo"
        self.repo.mkdir()
        self.checkouts = base / "checkouts"
        self.checkouts.mkdir()
        for argv in (["init", "-q", "-b", "main"],
                     ["config", "user.email", "fixture@example.invalid"],
                     ["config", "user.name", "Storage writer fixture"]):
            subprocess.run(["git", "-C", str(self.repo), *argv],
                           check=True, capture_output=True)
        (self.repo / "seed.txt").write_text("seed\n")
        subprocess.run(["git", "-C", str(self.repo), "add", "seed.txt"],
                       check=True, capture_output=True)
        subprocess.run(["git", "-C", str(self.repo), "commit", "-q", "-m", "seed"],
                       check=True, capture_output=True)
        self.base_commit = subprocess.run(
            ["git", "-C", str(self.repo), "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True).stdout.strip()
        self.storage = base / "storage"
        self.db = self.storage / "state.db"
        self.log = self.storage / "logs" / "writer.jsonl"
        self.lease = self.storage / ".baton-writer-lease"
        self.runtime = RUNTIME
        shutil.rmtree(self.runtime, ignore_errors=True)
        (self.runtime / "baton2").mkdir(parents=True)
        self.addCleanup(shutil.rmtree, self.runtime, True)
        self.fixture = base / "fake-omp"
        self.fixture.write_text(FAKE_OMP)
        self.fixture.chmod(0o700)
        self.children = []
        self.addCleanup(self.close_children)
        for helper in ("baton-full", "baton-recovery"):
            link = FOCUSED.parent / helper
            if not link.exists():
                link.symlink_to(FOCUSED.name)
                self.addCleanup(link.unlink)
        self.env = dict(os.environ)
        self.env["XDG_RUNTIME_DIR"] = str(self.runtime)
        self.env["BATON_STORAGE_ROOTS"] = f"log-evidence={self.storage}"
        self.env["PATH"] = os.environ.get("PATH", "/usr/bin:/bin")
        self.coord("attach", "root", "omp", "native-root", "")
        self.coord("role", "root", "principal-conductor")
        self.coord(
            "recruit", "writer", "root", "omp", "writer", "low",
            str(self.repo), "writer-branch", str(self.checkouts / "writer"),
            self.base_commit)
        with sqlite3.connect(self.db) as database:
            database.execute(
                "INSERT INTO messages(id,sender,recipient,kind,body) "
                "VALUES('fixture-task','root','writer','task','integration task')")

    def close_children(self):
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()

    def coord(self, *args):
        result = subprocess.run(
            [str(SETUP), str(self.db), *map(str, args)],
            env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def receive(self):
        child = subprocess.Popen(
            [str(FOCUSED), str(self.db), "receive", "writer", str(self.fixture),
             "writer", "low", str(self.repo), str(self.log), ""],
            env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        self.children.append(child)
        return child

    def apply(self):
        return subprocess.run(
            [str(FOCUSED), str(self.db), "storage-apply", "writer"],
            env=self.env, capture_output=True, text=True)

    def attempt(self):
        found = sorted(self.storage.glob("state.db.attempt-*"))
        return found[0] if found else None

    def log_text(self):
        text = ""
        for path in sorted((self.storage / "logs").glob("writer.jsonl*")):
            if path.is_file():
                text += path.read_text()
        return text

    def wait_for(self, observation, description, timeout=20):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            value = observation()
            if value:
                return value
            time.sleep(0.02)
        self.fail(f"timed out waiting for {description}")

    def test_paused_writer_blocks_apply_and_completes(self):
        receive = self.receive()
        marker = self.wait_for(
            lambda: next(self.storage.rglob("fixture-frame1"), None),
            "first retained frame")
        attempt = marker.parent
        self.wait_for(
            lambda: "first frame" in self.log_text()
            and (attempt / "checkpoint").exists(),
            "first retained write")
        previous = None
        while previous != retained_snapshot(self.storage, attempt):
            previous = retained_snapshot(self.storage, attempt)
            time.sleep(0.1)
        before = previous
        refused = self.apply()
        self.assertNotEqual(refused.returncode, 0, refused.stdout + refused.stderr)
        self.assertIn("cooperative root writer lease unavailable",
                      refused.stderr)
        self.assertEqual(retained_snapshot(self.storage, attempt), before,
                         "refused apply changed retained bytes")

        (attempt / "fixture-continue").write_text("go")
        log_text = self.wait_for(
            lambda: self.log_text() if "agent_end" in self.log_text() else None,
            "terminal retained frame")
        self.assertIn("second frame", log_text)
        self.assertIn("first frame", log_text)
        self.assertIn("second frame", (attempt / "stdout").read_text())
        self.assertTrue((attempt / "checkpoint").stat().st_size > 0)
        self.wait_for(lambda: (attempt / "released").exists(), "native release")

        settled = self.wait_for(
            lambda: (lambda result: result if result.returncode == 0 else None)(self.apply()),
            "settled apply")
        parsed = json.loads(settled.stdout)
        self.assertIn("receipts", parsed)
        self.assertTrue(parsed["receipts"])

    def test_paused_direct_blocks_apply_and_completes(self):
        receive = subprocess.Popen(
            [str(FOCUSED), str(self.db), "turn-text", "writer", "direct-id",
             str(self.fixture), "writer", "low", str(self.repo),
             "direct task body", str(self.log), ""],
            env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        self.children.append(receive)
        marker = self.wait_for(
            lambda: next(self.storage.rglob("fixture-frame1"), None),
            "direct first retained frame")
        attempt = marker.parent
        self.wait_for(
            lambda: "first frame" in self.log_text()
            and (attempt / "checkpoint").exists(),
            "direct first retained write")
        previous = None
        while previous != retained_snapshot(self.storage, attempt):
            previous = retained_snapshot(self.storage, attempt)
            time.sleep(0.1)
        refused = self.apply()
        self.assertNotEqual(refused.returncode, 0, refused.stdout + refused.stderr)
        self.assertIn("cooperative root writer lease unavailable",
                      refused.stderr)
        self.assertEqual(retained_snapshot(self.storage, attempt), previous,
                         "refused apply changed direct retained bytes")
        (attempt / "fixture-continue").write_text("go")
        log_text = self.wait_for(
            lambda: self.log_text() if "agent_end" in self.log_text() else None,
            "direct terminal retained frame")
        self.assertIn("second frame", log_text)
        self.wait_for(
            lambda: (lambda result: result if result.returncode == 0 else None)(self.apply()),
            "settled direct apply")

    def test_recovery_holds_lease_before_attach(self):
        receive = self.receive()
        marker = self.wait_for(
            lambda: next(self.storage.rglob("fixture-frame1"), None),
            "recovery first retained frame")
        attempt = marker.parent
        with sqlite3.connect(self.db) as database:
            ident, directory = database.execute(
                "SELECT id,directory FROM executions WHERE session='writer' "
                "AND mode='retained'").fetchone()
        receive.kill()
        receive.wait(timeout=10)
        recovery = subprocess.Popen(
            [str(FOCUSED), str(self.db), "--recover-receive", str(self.db),
             "writer", ident, "1", str(self.fixture), "writer", "low",
             str(self.repo), str(self.log), "omp", directory, ""],
            env=self.env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True)
        self.children.append(recovery)
        self.wait_for(
            lambda: "cooperative root writer lease unavailable" in self.apply().stderr,
            "recovery shared lease")
        self.assertTrue(recovery.poll() is None or recovery.returncode == 0)
        (attempt / "fixture-continue").write_text("go")
        self.wait_for(
            lambda: "agent_end" in self.log_text(), "recovery terminal frame")
        self.wait_for(
            lambda: (lambda result: result if result.returncode == 0 else None)(self.apply()),
            "settled recovery apply")

    def test_cleaner_first_refuses_without_spawning(self):
        self.lease.write_text("")
        holder = open(self.lease, "r+")
        fcntl.flock(holder, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.addCleanup(holder.close)
        receive = subprocess.run(
            [str(FOCUSED), str(self.db), "receive", "writer", str(self.fixture),
             "writer", "low", str(self.repo), str(self.log), ""],
            env=self.env, capture_output=True, text=True, timeout=30)
        self.assertNotEqual(receive.returncode, 0)
        self.assertIn("storage writer lease unavailable", receive.stderr)
        self.assertIsNone(self.attempt(), "writer created an attempt before refusal")
        self.assertFalse(any(self.storage.rglob("fixture-spawned")),
                         "writer spawned native beside the cleanup lease")


if __name__ == "__main__":
    unittest.main()
