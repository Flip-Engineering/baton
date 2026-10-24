"""A failed delivery redrives the owed input (#1054, instances A1 and A3).

A1: the root's nudge for worktree-paths-972-haiku-20261022 was committed at
00:44:44Z; its dispatch ran the seat's receive endpoint, which exited 5 on
'database is locked' before admitting a turn. The dispatch logged 'retry
delivery from the pending inbox' and exited, and no turn started.
A3: a dispatch to runtime-ds-rescue-coordinator-20261019 ended with exit 5
after the coordinator's receive process died with 22 owed inputs; nothing
started a further turn for them.

The detached delivery now derives the recipient's oldest owed input from the
pending inbox and starts one redelivery for it. A redelivery that fails again
is reported to the recipient's coordinator. These checks drive the delivery
entries against fixture databases whose session endpoints are scripts that
record each call and fail on request.

BATON2_DELIVERY_REDRIVE_FIXTURE names a built bend2/test/delivery-redrive
binary; otherwise the test builds it with bend2/scripts/build-native.sh.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code', model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');
CREATE TABLE session_roles (session TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
'''
# Records each call as one line 'ARGS' in the calls file; fails while the
# failures file holds a positive count, as the busy receive endpoint did.
ENDPOINT = '''#!/bin/sh
calls="$1"; failures="$2"; shift 2
printf '%s\\n' "$*" >> "$calls"
left=$(cat "$failures" 2>/dev/null || echo 0)
if [ "$left" -gt 0 ]; then
  echo $((left - 1)) > "$failures"
  echo 'database is locked' >&2
  exit 5
fi
exit 0
'''


def fixture():
    binary = os.environ.get('BATON2_DELIVERY_REDRIVE_FIXTURE')
    if binary:
        return binary
    SCRATCH.mkdir(parents=True, exist_ok=True)
    binary = str(SCRATCH / 'delivery-redrive')
    build = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/delivery-redrive.bend', binary],
                           cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True)
    if build.returncode:
        raise AssertionError(build.stdout + build.stderr)
    return binary


class DeliveryRedrive(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.binary = fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name)
        self.path = str(self.home / 'orchestra.db')
        self.db = sqlite3.connect(self.path, isolation_level=None)
        self.addCleanup(self.db.close)
        self.db.executescript(SCHEMA)
        script = self.home / 'endpoint.sh'
        script.write_text(ENDPOINT)
        self.endpoint = str(script)
        self.seat('coordinator', None)
        self.seat('worker', 'coordinator')

    def seat(self, name, parent):
        calls, failures = self.home / (name + '.calls'), self.home / (name + '.failures')
        endpoint = json.dumps(['/bin/sh', self.endpoint, str(calls), str(failures)])
        self.db.execute('INSERT INTO sessions(id,parent,endpoint) VALUES(?,?,?)', (name, parent, endpoint))

    def fail(self, name, count):
        (self.home / (name + '.failures')).write_text(str(count))

    def calls(self, name):
        path = self.home / (name + '.calls')
        return path.read_text().splitlines() if path.exists() else []

    def message(self, ident, sender, recipient, kind='guidance', body='Work.'):
        self.db.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                        (ident, sender, recipient, kind, body))

    def dispatch(self, ident):
        return subprocess.run([self.binary, '--dispatch-message', self.path, ident],
                              capture_output=True, text=True, timeout=60)

    def wait_for(self, predicate, seconds=30):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.1)
        return predicate()

    def test_a1_busy_endpoint_is_redriven_for_the_owed_input(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        self.fail('worker', 1)
        first = self.dispatch('root-nudge')
        self.assertNotEqual(first.returncode, 0)
        self.assertIn('database is locked', first.stdout + first.stderr)
        self.assertTrue(self.wait_for(lambda: len(self.calls('worker')) >= 2), self.calls('worker'))
        self.assertEqual(self.calls('worker'), ['root-nudge', 'root-nudge'])
        self.assertEqual(self.calls('coordinator'), [])
        undelivered = self.db.execute("SELECT count(*) FROM messages WHERE id LIKE '%:undelivered'").fetchone()[0]
        self.assertEqual(undelivered, 0)

    def test_a3_redelivery_targets_the_oldest_owed_input(self):
        self.message('owed-1', 'worker', 'coordinator', kind='report', body='Earlier report.')
        self.message('owed-2', 'worker', 'coordinator', kind='report', body='Later report.')
        self.message('report-now', 'worker', 'coordinator', kind='report', body='Report.')
        self.fail('coordinator', 1)
        first = self.dispatch('report-now')
        self.assertNotEqual(first.returncode, 0)
        self.assertTrue(self.wait_for(lambda: len(self.calls('coordinator')) >= 2), self.calls('coordinator'))
        self.assertEqual(self.calls('coordinator'), ['report-now', 'owed-1'])

    def test_repeated_failure_is_reported_to_the_coordinator_once(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        self.fail('worker', 100)
        self.dispatch('root-nudge')
        self.assertTrue(self.wait_for(lambda: len(self.calls('coordinator')) >= 1), self.calls('coordinator'))
        self.assertEqual(self.calls('coordinator'), ['root-nudge:undelivered'])
        row = self.db.execute("SELECT sender, recipient, kind, body FROM messages WHERE id='root-nudge:undelivered'").fetchone()
        self.assertEqual(row[:3], ('worker', 'coordinator', 'report'))
        self.assertIn('Input root-nudge for worker was not delivered', row[3])
        self.assertIn('session delivery failed (exit 5)', row[3])
        self.assertIn('1 owed inputs', row[3])
        time.sleep(2)
        self.assertEqual(self.calls('worker'), ['root-nudge', 'root-nudge'])

    def test_delivered_input_starts_no_redelivery(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        result = self.dispatch('root-nudge')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        time.sleep(2)
        self.assertEqual(self.calls('worker'), ['root-nudge'])


if __name__ == '__main__':
    unittest.main()
