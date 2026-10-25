"""A failed delivery redrives the owed input (#1054, instances A1 and A3).

A1: the root's nudge for worktree-paths-972-haiku-20261022 was committed at
00:44:44Z; its dispatch ran the seat's receive endpoint, which exited 5 on
'database is locked' before admitting a turn. The dispatch logged 'retry
delivery from the pending inbox' and exited, and no turn started.
A3: a dispatch to runtime-ds-rescue-coordinator-20261019 ended with exit 5
after the coordinator's receive process died with 22 owed inputs; nothing
started a further turn for them.

The detached delivery now derives the recipient's oldest owed input from the
pending inbox and starts a redelivery for it. A redelivery that fails on a held
write lock waits until the writer is gone and delivers the oldest owed input
again, with no attempt count. A failure with another cause is reported to the
recipient's coordinator; the report is committed through busy answers. These checks drive the delivery
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
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRATCH = ROOT / '.scratch/bend2'
SCHEMA = '''
CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, harness TEXT NOT NULL DEFAULT 'claude-code', model TEXT NOT NULL DEFAULT '', effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', base TEXT NOT NULL DEFAULT '');
CREATE TABLE session_roles (session TEXT NOT NULL, role TEXT NOT NULL);
CREATE TABLE session_stops (session TEXT PRIMARY KEY NOT NULL, id TEXT UNIQUE NOT NULL, reason TEXT NOT NULL, attempt TEXT NOT NULL DEFAULT '', directory TEXT NOT NULL DEFAULT '', signal INTEGER NOT NULL DEFAULT 15, applied_signal INTEGER NOT NULL DEFAULT 0, control_error TEXT NOT NULL DEFAULT '', outcome TEXT NOT NULL, native_status TEXT NOT NULL DEFAULT '', report_id TEXT NOT NULL DEFAULT '');
CREATE TABLE message_reads(attempt TEXT NOT NULL,message TEXT NOT NULL,recipient TEXT NOT NULL,native TEXT NOT NULL,identity TEXT NOT NULL,handled TEXT,PRIMARY KEY(attempt,identity,message));
CREATE TABLE messages (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, sender TEXT NOT NULL, recipient TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, receipt TEXT);
'''
# Records each call as one line 'ARGS' in the calls file; fails while the
# failures file holds a positive count, as the busy receive endpoint did: exit 5
# with 'database is locked'. FAILURES.exit and FAILURES.cause select another
# exit status and failure text.
ENDPOINT = '''#!/bin/sh
calls="$1"; failures="$2"; shift 2
printf '%s\\n' "$*" >> "$calls"
left=$(cat "$failures" 2>/dev/null || echo 0)
if [ "$left" -gt 0 ]; then
  echo $((left - 1)) > "$failures"
  if [ -f "$failures.cause" ]; then cat "$failures.cause" >&2; else echo 'database is locked' >&2; fi
  if [ -f "$failures.exit" ]; then exit "$(cat "$failures.exit")"; fi
  exit 5
fi
exit 0
'''
# The receive endpoint's own first write: fails on 'database is locked' while
# another connection holds the write lock, after a short busy wait.
LOCKED_ENDPOINT = '''import sqlite3, sys
calls, database, message = sys.argv[1], sys.argv[2], sys.argv[-1]
try:
    db = sqlite3.connect(database, isolation_level=None)
    db.execute('BEGIN IMMEDIATE')
    db.execute('COMMIT')
except sqlite3.OperationalError as error:
    open(calls, 'a').write('busy ' + message + '\\n')
    sys.stderr.write(str(error) + '\\n')
    sys.exit(5)
open(calls, 'a').write('ok ' + message + '\\n')
'''
HOLD_SECONDS = 40


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
        self.db.execute('PRAGMA journal_mode=WAL')
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

    def fail_endpoint(self, name, count, cause=None, status=None):
        (self.home / (name + '.failures')).write_text(str(count))
        if cause is not None:
            (self.home / (name + '.failures.cause')).write_text(cause + '\n')
        if status is not None:
            (self.home / (name + '.failures.exit')).write_text(str(status))

    def calls(self, name):
        path = self.home / (name + '.calls')
        return path.read_text().splitlines() if path.exists() else []

    def message(self, ident, sender, recipient, kind='guidance', body='Work.'):
        self.db.execute('INSERT INTO messages(id,sender,recipient,kind,body) VALUES(?,?,?,?,?)',
                        (ident, sender, recipient, kind, body))

    def dispatch(self, ident):
        return subprocess.run([self.binary, '--dispatch-message', self.path, ident],
                              capture_output=True, text=True)

    def wait_for(self, predicate, seconds=30):
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if predicate():
                return True
            time.sleep(0.1)
        return predicate()

    def test_a1_busy_endpoint_is_redriven_for_the_owed_input(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        self.fail_endpoint('worker', 1)
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
        self.fail_endpoint('coordinator', 1)
        first = self.dispatch('report-now')
        self.assertNotEqual(first.returncode, 0)
        self.assertTrue(self.wait_for(lambda: len(self.calls('coordinator')) >= 2), self.calls('coordinator'))
        self.assertEqual(self.calls('coordinator'), ['report-now', 'owed-1'])

    def test_failure_with_another_cause_is_reported_to_the_coordinator_once(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        self.fail_endpoint('worker', 100, cause='receive endpoint: no native conversation', status=2)
        self.dispatch('root-nudge')
        self.assertTrue(self.wait_for(lambda: len(self.calls('coordinator')) >= 1), self.calls('coordinator'))
        self.assertEqual(self.calls('coordinator'), ['root-nudge:undelivered'])
        row = self.db.execute("SELECT sender, recipient, kind, body FROM messages WHERE id='root-nudge:undelivered'").fetchone()
        self.assertEqual(row[:3], ('worker', 'coordinator', 'report'))
        self.assertIn('Input root-nudge for worker was not delivered', row[3])
        self.assertIn('session delivery failed (exit 2)', row[3])
        self.assertIn('1 owed inputs', row[3])
        time.sleep(2)
        self.assertEqual(self.calls('worker'), ['root-nudge', 'root-nudge'])

    def test_input_is_delivered_after_a_writer_holds_the_lock_past_the_busy_waits(self):
        script = self.home / 'locked-endpoint.py'
        script.write_text(LOCKED_ENDPOINT)
        calls = self.home / 'locked.calls'
        endpoint = json.dumps([sys.executable, str(script), str(calls), self.path])
        self.db.execute("UPDATE sessions SET endpoint=? WHERE id='worker'", (endpoint,))
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        holder = sqlite3.connect(self.path, isolation_level=None, check_same_thread=False)
        holder.execute('BEGIN IMMEDIATE')
        release = threading.Timer(HOLD_SECONDS, lambda: holder.execute('ROLLBACK'))
        release.start()
        self.addCleanup(release.cancel)
        self.addCleanup(holder.close)
        first = self.dispatch('root-nudge')
        self.assertNotEqual(first.returncode, 0)
        lines = lambda: calls.read_text().splitlines() if calls.exists() else []
        self.assertTrue(self.wait_for(lambda: 'ok root-nudge' in lines(), HOLD_SECONDS + 60), lines())
        self.assertEqual(lines()[-1], 'ok root-nudge')
        self.assertTrue(all(line == 'busy root-nudge' for line in lines()[:-1]), lines())
        undelivered = self.db.execute("SELECT count(*) FROM messages WHERE id LIKE '%:undelivered'").fetchone()[0]
        self.assertEqual(undelivered, 0)

    def test_delivered_input_starts_no_redelivery(self):
        self.message('root-nudge', 'coordinator', 'worker', kind='task', body='Continue.')
        result = self.dispatch('root-nudge')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        time.sleep(2)
        self.assertEqual(self.calls('worker'), ['root-nudge'])


    def test_redelivery_skips_recorded_reads_and_keeps_unread_receipt_rows(self):
        self.message('already-read', 'worker', 'coordinator', kind='report', body='Read report.')
        self.db.execute("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','already-read','coordinator','','fixture')")
        self.message('unread-report', 'worker', 'coordinator', kind='report', body='Unread report.')
        self.db.execute("UPDATE messages SET receipt='legacy-only' WHERE id='unread-report'")
        self.message('trigger', 'worker', 'coordinator', kind='report', body='Trigger report.')
        self.fail_endpoint('coordinator', 1)
        first = self.dispatch('trigger')
        self.assertNotEqual(first.returncode, 0)
        self.assertTrue(self.wait_for(lambda: len(self.calls('coordinator')) >= 2), self.calls('coordinator'))
        self.assertEqual(self.calls('coordinator'), ['trigger', 'unread-report'])


if __name__ == '__main__':
    unittest.main()
