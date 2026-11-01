"""Focused private-database regressions for deferred drain sweeps."""
import json
import os
from pathlib import Path
import select
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = Path(__file__).resolve().parents[2]
SWEEP_EXE = Path(os.environ['BATON2_DRAIN_SWEEP_EXE']).resolve()
STORE_EXE = Path(os.environ['BATON2_DRAIN_SWEEP_STORE']).resolve()

ENDPOINT = r'''import json,os,sqlite3,sys,time
db,session,calls,gate,message=sys.argv[1:]
with open(calls,'a') as stream:
    stream.write(json.dumps({'session':session,'message':message})+'\n')
while os.path.exists(gate):
    time.sleep(.02)
with sqlite3.connect(db) as connection:
    connection.execute("INSERT OR IGNORE INTO message_reads(attempt,message,recipient,native,identity) VALUES('drain-sweep-fixture',?,?, '',?)", (message,session,message))
'''

WAIT_GATE = r'''import os,sys,time
gate=sys.argv[1]
while os.path.exists(gate):
    time.sleep(.02)
'''


class DrainSweep(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='baton-drain-sweep-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.db = self.root / 'state.db'
        self.calls = self.root / 'endpoint-calls.jsonl'
        self.endpoint = self.root / 'endpoint.py'
        self.endpoint.write_text(ENDPOINT)
        self.wait_gate = self.root / 'hold-worker'
        self.wait_gate.write_text('hold\n')
        self.wait_script = self.root / 'wait-gate.py'
        self.wait_script.write_text(WAIT_GATE)
        self.endpoint_gate = self.root / 'hold-endpoint'
        self.endpoint_gate.write_text('hold\n')
        self.runtime = self.root / 'runtime'
        (self.runtime / 'baton2').mkdir(parents=True, mode=0o700)
        self.env = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))
        result = subprocess.run([str(SWEEP_EXE), '--ensure-schema', str(self.db)],
                                capture_output=True, text=True, env=self.env, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def run_cli(self, exe, *args):
        result = subprocess.run([str(exe), *map(str, args)], capture_output=True,
                                text=True, env=self.env, timeout=30)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def store(self, *args):
        return self.run_cli(STORE_EXE, *args)

    def connection(self):
        connection = sqlite3.connect(self.db)
        connection.execute('PRAGMA foreign_keys=ON')
        return connection

    def add_session(self, session, gate=None):
        endpoint = json.dumps([sys.executable, str(self.endpoint), str(self.db), session,
                               str(self.calls), str(gate or self.root / 'no-gate')])
        with self.connection() as connection:
            connection.execute("INSERT INTO sessions(id,harness,endpoint) VALUES(?,'fixture',?)",
                               (session, endpoint))

    def add_owed_message(self, session, message):
        with self.connection() as connection:
            connection.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,'operator',?,'message','fixture')",
                               (message, session))

    def add_deferred_claim(self, session, owner='legacy', generation=1):
        with self.connection() as connection:
            connection.execute("INSERT INTO wake_claims(session,state,owner,generation) VALUES(?,'drain-deferred',?,?)",
                               (session, owner, generation))

    def table_row(self, session):
        with sqlite3.connect(self.db) as connection:
            return connection.execute('SELECT generation,active FROM drain_deferred WHERE session=?',
                                      (session,)).fetchone()

    def endpoint_rows(self):
        if not self.calls.exists():
            return []
        return [json.loads(line) for line in self.calls.read_text().splitlines()]

    def read_recorded(self, session, message):
        with sqlite3.connect(self.db) as connection:
            return connection.execute('SELECT 1 FROM message_reads WHERE message=? AND recipient=?',
                                      (message, session)).fetchone() is not None

    def eventually(self, predicate, message, timeout=20):
        limit = time.monotonic() + timeout
        while time.monotonic() < limit:
            if predicate():
                return
            time.sleep(.05)
        self.fail(message)

    def deferred_worker_processes(self):
        result = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, check=True)
        db = str(self.db)
        return [line for line in result.stdout.splitlines()
                if '--drain-sweep-session' in line and db in line]

    def cleanup_holder(self, holder):
        self.wait_gate.unlink(missing_ok=True)
        if holder.poll() is None:
            holder.wait(timeout=10)

    def test_schema_preflight_backfills_legacy_claim_and_is_idempotent(self):
        legacy = self.root / 'legacy.db'
        session = 'odd\tline\n.lock-.dr-'
        with sqlite3.connect(legacy) as connection:
            connection.execute('CREATE TABLE sessions(id TEXT PRIMARY KEY)')
            connection.execute("CREATE TABLE wake_claims(session TEXT PRIMARY KEY,state TEXT NOT NULL,owner TEXT NOT NULL,generation INTEGER NOT NULL)")
            connection.execute('INSERT INTO sessions(id) VALUES(?)', (session,))
            connection.execute("INSERT INTO wake_claims VALUES(?,'drain-deferred','old-owner',42)",
                               (session,))

        first = subprocess.run([str(STORE_EXE), '--deferred-sessions', str(legacy)],
                               capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual(first.returncode, 0, first.stdout + first.stderr)
        self.assertEqual(first.stdout.strip(), session.encode().hex().upper() + '\t42')
        with sqlite3.connect(legacy) as connection:
            self.assertEqual(connection.execute('SELECT generation,active FROM drain_deferred WHERE session=?',
                                                (session,)).fetchone(), (42, 1))
        second = subprocess.run([str(STORE_EXE), '--deferred-sessions', str(legacy)],
                                capture_output=True, text=True, env=self.env, timeout=30)
        self.assertEqual(second.returncode, 0, second.stdout + second.stderr)
        with sqlite3.connect(legacy) as connection:
            self.assertEqual(connection.execute('SELECT generation,active FROM drain_deferred WHERE session=?',
                                                (session,)).fetchone(), (42, 1))

    def test_stale_worker_cannot_match_after_clear_and_redefer(self):
        session = 'aba-session'
        self.add_session(session)
        with self.connection() as connection:
            connection.execute("INSERT INTO sessions(id,harness) VALUES('operator','operator')")
            connection.execute("INSERT INTO wake_claims VALUES(?,'claimed','first',1)", (session,))
        self.store('--defer', self.db, session, 'first', '1')
        self.assertEqual(self.table_row(session), (1, 1))
        self.store('--clear', self.db, session, '1')
        self.assertEqual(self.table_row(session), (1, 0))
        with self.connection() as connection:
            connection.execute("UPDATE wake_claims SET state='claimed',owner='second',generation=2 WHERE session=?",
                               (session,))
        self.store('--defer', self.db, session, 'second', '2')
        self.assertEqual(self.table_row(session), (2, 1))
        self.add_owed_message(session, 'aba-message')

        self.run_cli(SWEEP_EXE, '--drain-sweep-session', self.db, session, '1')
        self.assertEqual(self.endpoint_rows(), [])
        self.assertEqual(self.table_row(session), (2, 1))
        self.run_cli(SWEEP_EXE, '--drain-sweep-session', self.db, session, '2')
        self.eventually(lambda: self.read_recorded(session, 'aba-message'),
                        'current generation did not reach the fixture endpoint')
        self.assertEqual(len(self.endpoint_rows()), 1)

    def test_sweep_fanout_skips_held_session_and_releases_before_endpoint_exit(self):
        held_session = 'fanout\tA\n.lock-.dr-'
        other_session = 'fanout-b'
        self.add_session(held_session, self.endpoint_gate)
        self.add_session(other_session)
        with self.connection() as connection:
            connection.execute("INSERT INTO sessions(id,harness) VALUES('operator','operator')")
        self.add_owed_message(held_session, 'fanout-a-message')
        self.add_owed_message(other_session, 'fanout-b-message')
        self.add_deferred_claim(held_session, generation=7)
        self.add_deferred_claim(other_session, generation=7)

        holder = subprocess.Popen([str(STORE_EXE), '--hold-sweep-lock', str(self.db),
                                   held_session, sys.executable,
                                   str(self.wait_script), str(self.wait_gate)],
                                  cwd=ROOT, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True, env=self.env)
        self.addCleanup(self.cleanup_holder, holder)
        ready, _, _ = select.select([holder.stdout], [], [], 10)
        if not ready:
            self.wait_gate.unlink(missing_ok=True)
            holder_stdout, holder_stderr = holder.communicate(timeout=10)
            self.fail('sweep-lock fixture did not acquire its lock: ' + holder_stdout + holder_stderr)
        self.assertEqual(holder.stdout.readline().strip(), 'lock-held')

        for _ in range(3):
            self.run_cli(SWEEP_EXE, '--drain-sweep', self.db)
            self.eventually(lambda: not self.deferred_worker_processes(),
                            'per-session sweep workers accumulated behind the held lock')
        self.eventually(lambda: self.read_recorded(other_session, 'fanout-b-message'),
                        'unheld session did not proceed while another session lock was held')
        self.assertEqual(self.store('--probe-sweep-lock', self.db, held_session).strip(), 'busy')
        self.assertEqual([row['message'] for row in self.endpoint_rows()], ['fanout-b-message'])

        self.wait_gate.unlink()
        holder_stdout, holder_stderr = holder.communicate(timeout=30)
        self.assertEqual(holder.returncode, 0, holder_stdout + holder_stderr)
        self.assertIn('lock-released', holder_stdout)

        self.run_cli(SWEEP_EXE, '--drain-sweep', self.db)
        self.eventually(lambda: any(row['message'] == 'fanout-a-message' for row in self.endpoint_rows()),
                        'released session did not retry its owed message')
        self.eventually(lambda: self.store('--probe-sweep-lock', self.db, held_session).strip() == 'free',
                        'detached receiver retained the per-session sweep lock')
        self.assertFalse(self.read_recorded(held_session, 'fanout-a-message'),
                         'blocked fixture endpoint returned before its release gate')
        self.endpoint_gate.unlink()
        self.eventually(lambda: self.read_recorded(held_session, 'fanout-a-message'),
                        'fixture endpoint did not finish after its release gate')
        self.assertEqual([row['message'] for row in self.endpoint_rows()].count('fanout-a-message'), 1)


if __name__ == '__main__':
    unittest.main()
