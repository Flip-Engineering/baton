"""A busy store does not lose a native turn's result (#1054, instance B2).

Turn receive:compiler-crash-1017-opus-20261022:225958 finished its native turn,
but recording a frame failed with '5: database is locked'. The observer
stopped reading the span after that failure, never recorded the terminal
frame, and the turn ended 'without a native result (exit 0)', so its input was
not settled. The observer now records the frame again after a busy answer.
This check holds the store's write lock for longer than one busy-handler
wait while the frame is recorded. A second check makes the preflight
projection install itself meet the held lock: with its marker cleared, the
install takes BEGIN IMMEDIATE before the frame's own transaction.

BATON2_OBSERVE_BUSY_FIXTURE names a built bend2/test/observe-busy binary;
otherwise the test builds it with bend2/scripts/build-native.sh.
"""
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
ATTEMPT = 'receive:worker:9:beef'
HOLD_SECONDS = 35


def fixture():
    binary = os.environ.get('BATON2_OBSERVE_BUSY_FIXTURE')
    if binary:
        return binary
    SCRATCH.mkdir(parents=True, exist_ok=True)
    binary = str(SCRATCH / 'observe-busy')
    build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/observe-busy.bend', binary],
                           cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
    if build.returncode:
        raise AssertionError(build.stdout + build.stderr)
    return binary


class ObserveBusy(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = str(pathlib.Path(self.temp.name) / 'orchestra.db')
        installed = subprocess.run([self.binary, 'install', self.path], capture_output=True, text=True)
        self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        db = sqlite3.connect(self.path, isolation_level=None)
        db.execute("INSERT INTO sessions(id,parent,harness) VALUES('coordinator',NULL,'claude-code')")
        db.execute("INSERT INTO sessions(id,parent,harness) VALUES('worker','coordinator','claude-code')")
        db.close()

    def observe(self):
        return subprocess.run([self.binary, 'observe', self.path], capture_output=True, text=True)

    def recorded(self):
        db = sqlite3.connect(self.path)
        try:
            turns = db.execute('SELECT count(*) FROM turns WHERE id=?', (ATTEMPT,)).fetchone()[0]
            report = db.execute("SELECT recipient, kind, body FROM messages WHERE id=?", (ATTEMPT,)).fetchone()
        finally:
            db.close()
        return turns, report

    def test_frame_recorded_after_a_lock_held_past_the_busy_wait(self):
        holder = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        holder.execute('BEGIN EXCLUSIVE')
        release = threading.Timer(HOLD_SECONDS, lambda: holder.execute('ROLLBACK'))
        release.start()
        self.addCleanup(release.cancel)
        self.addCleanup(holder.close)
        start = time.monotonic()
        result = self.observe()
        elapsed = time.monotonic() - start
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'observed')
        self.assertGreaterEqual(elapsed, HOLD_SECONDS - 1)
        turns, report = self.recorded()
        self.assertEqual(turns, 1)
        self.assertEqual(report, ('coordinator', 'report', 'Turn finished.'))

    def test_frame_recorded_after_the_projection_install_meets_a_held_lock(self):
        db = sqlite3.connect(self.path, isolation_level=None)
        db.execute('DELETE FROM baton_projection_state')
        db.close()
        holder = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        holder.execute('BEGIN IMMEDIATE')
        release = threading.Timer(HOLD_SECONDS, lambda: holder.execute('ROLLBACK'))
        release.start()
        self.addCleanup(release.cancel)
        self.addCleanup(holder.close)
        result = self.observe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(result.stdout.strip(), 'observed')
        self.assertEqual(self.recorded(), (1, ('coordinator', 'report', 'Turn finished.')))

    def test_frame_recorded_without_contention(self):
        result = self.observe()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.recorded(), (1, ('coordinator', 'report', 'Turn finished.')))


if __name__ == '__main__':
    unittest.main()
