"""Storage policy, preview and apply receipt checks on the focused entry."""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/storage-policy-entry'

SCHEMA = """
CREATE TABLE sessions(id TEXT PRIMARY KEY);
CREATE TABLE executions(session TEXT, id TEXT, mode TEXT, phase TEXT,
  status TEXT, directory TEXT);
CREATE TABLE messages(id TEXT, sender TEXT, recipient TEXT, kind TEXT,
  body TEXT, receipt TEXT);
CREATE TABLE turns(id TEXT, worker TEXT, event TEXT);
CREATE TABLE log_policies(session TEXT PRIMARY KEY, level TEXT);
CREATE TABLE log_files(session TEXT, log TEXT, PRIMARY KEY(session, log));
CREATE TABLE log_generations(session TEXT, attempt TEXT, log TEXT,
  base TEXT, PRIMARY KEY(session, attempt));
CREATE TABLE log_stderr_runs(session TEXT, attempt TEXT, run INTEGER,
  generation TEXT, stderr TEXT, PRIMARY KEY(session, attempt, run));
CREATE TABLE session_stops(session TEXT, attempt TEXT, report_id TEXT,
  outcome TEXT);
"""


class StoragePolicy(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd = pathlib.Path(self.temp.name)
        self.db = self.cwd / 'state.db'
        with sqlite3.connect(self.db) as connection:
            connection.executescript(SCHEMA)

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args):
        result = subprocess.run([str(EXE), str(self.db), *args],
                                  text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def seed(self, session='omp-worker', attempt='turn-1'):
        directory = str(self.db) + '.attempt-' + attempt.encode().hex()
        with sqlite3.connect(self.db) as connection:
            connection.execute('INSERT INTO sessions(id) VALUES (?)', (session,))
            connection.execute(
                'INSERT INTO executions(session,id,mode,phase,status,directory)'
                ' VALUES (?,?,?,?,?,?)',
                (session, attempt, 'native', 'exited', 'exit 0', directory))
            connection.execute('INSERT INTO turns(id,worker,event) VALUES (?,?,?)',
                               (attempt, session, '{"type":"agent_end"}'))
            connection.execute(
                'INSERT INTO messages(id,sender,recipient,kind,body,receipt)'
                ' VALUES (?,?,?,?,?,?)',
                (attempt, session, 'root', 'report', 'done', 'receipt-1'))
        attempt_dir = pathlib.Path(directory)
        attempt_dir.mkdir()
        for name, body in (('manifest', b'retained manifest'), ('status', b'0\n'),
                           ('released', b'released\n'),
                           ('acknowledged', b'acknowledged\n')):
            (attempt_dir / name).write_bytes(body)
        full = b'complete native diagnostics\n'
        (attempt_dir / 'stderr.full').write_bytes(full)
        (attempt_dir / 'stderr.meta').write_text(json.dumps({
            'schema': 'baton2-stderr-v1', 'status': 'complete',
            'truncated': False, 'observedBytes': len(full),
            'retainedBytes': len(full), 'spool': 'stderr.full'}))
        for name in ('stdout', 'native.stderr', 'observer.log', 'keeper.log'):
            (attempt_dir / name).write_text('diagnostic data for ' + name)
        return attempt, attempt_dir

    def test_policy_names_durable_classes(self):
        policy = json.loads(self.call('storage-policy'))
        self.assertFalse(policy['ageOnlyDeletion'])
        classes = {item['class']: item for item in policy['classes']}
        self.assertEqual(set(classes), {'scratch-build', 'checkout-worktree',
                                        'shared-immutable', 'git-objects',
                                        'logs-evidence', 'durable-state',
                                        'unknown'})
        self.assertTrue(classes['scratch-build']['deletable'])
        self.assertTrue(classes['logs-evidence']['deletable'])

    def test_preview_apply_and_idempotency(self):
        attempt, attempt_dir = self.seed()
        preview = json.loads(self.call('storage-preview', 'omp-worker'))
        self.assertEqual(preview['mode'], 'preview')
        item = next(row for row in preview['items']
                    if row['path'] == str(attempt_dir))
        self.assertEqual(item['class'], 'logs-evidence')
        self.assertTrue(item['wouldRemove'], item)
        self.assertTrue((attempt_dir / 'stdout').is_file())
        applied = json.loads(self.call('storage-apply', 'omp-worker'))
        self.assertEqual(applied['mode'], 'apply')
        removed = {row['file'] for row in applied['result']['attemptFiles']
                   if row.get('removed') and 'file' in row}
        self.assertIn('stdout', removed)
        self.assertFalse((attempt_dir / 'stdout').exists())
        self.assertTrue((attempt_dir / 'manifest').is_file())
        second = json.loads(self.call('storage-apply', 'omp-worker'))
        self.assertEqual({row['file'] for row in second['result']['attemptFiles']
                          if row.get('removed') and 'file' in row}, set())
        cleaned = json.loads(self.call('logs-clean', 'omp-worker'))
        self.assertEqual({row['file'] for row in cleaned['attemptFiles']
                          if row.get('removed') and 'file' in row}, set())

    def test_pending_input_is_preserved(self):
        attempt, attempt_dir = self.seed()
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                'INSERT INTO messages(id,sender,recipient,kind,body,receipt)'
                ' VALUES (?,?,?,?,?,NULL)',
                ('pending-1', 'root', 'omp-worker', 'guidance', 'Review first.'))
        preview = json.loads(self.call('storage-preview', 'omp-worker'))
        item = next(row for row in preview['items']
                    if row['path'] == str(attempt_dir))
        self.assertFalse(item['wouldRemove'], item)
        self.assertEqual(item['reason'], 'pending-input')
        applied = json.loads(self.call('storage-apply', 'omp-worker'))
        self.assertEqual(applied['result']['skipped'], 'pending-input')
        self.assertTrue((attempt_dir / 'stdout').is_file())

    def test_symlink_attempt_directory_is_preserved(self):
        attempt, attempt_dir = self.seed(session='worker-2', attempt='turn-9')
        target = pathlib.Path(str(attempt_dir) + '-real')
        attempt_dir.rename(target)
        attempt_dir.symlink_to(target, target_is_directory=True)
        with sqlite3.connect(self.db) as connection:
            connection.execute(
                'UPDATE executions SET directory=? WHERE session=?',
                (str(attempt_dir), 'worker-2'))
        preview = json.loads(self.call('storage-preview', 'worker-2'))
        item = next(row for row in preview['items']
                    if row['path'] == str(attempt_dir))
        self.assertFalse(item['wouldRemove'], item)
        self.assertEqual(item['reason'], 'symlink-path')
        self.assertTrue((target / 'stdout').is_file())
        self.assertTrue(attempt_dir.is_symlink())


if __name__ == '__main__':
    unittest.main()
