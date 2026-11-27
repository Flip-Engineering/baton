"""Message commit times and per-seat activity in status.

Every message projection carries committedAt, the instant its row was
committed. A status row carries the seat's newest message to the operator,
since when operator input waits unread for the seat, and one state word.
"""
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))
INSTANT = re.compile(r'^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$')


class SeatActivity(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.fail(f'Coordinator not built at {EXE}')
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.environment = {key: value for key, value in os.environ.items()
                            if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY')}
        self.environment['HOME'] = str(self.directory / 'home')
        (self.directory / 'home').mkdir()
        self.addCleanup(self.shutdown)
        deliveries = self.directory / 'deliveries.jsonl'
        endpoint = self.directory / 'endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            f'with pathlib.Path({str(deliveries)!r}).open("a") as f:\n'
                            ' f.write(sys.argv[-1]+"\\n")\n')
        self.endpoint = json.dumps([sys.executable, str(endpoint)])
        self.call('attach', 'operator', 'fixture', '', self.endpoint)
        self.call('role', 'operator', 'operator')
        self.call('attach', 'seat', 'codex', 'native-seat', self.endpoint)
        self.call('role', 'seat', 'principal-conductor')

    def shutdown(self):
        if self.db.exists():
            subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                           capture_output=True, text=True, env=self.environment)

    def call(self, *args):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, env=self.environment)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def committed(self, ident):
        with sqlite3.connect(self.db) as db:
            return db.execute("SELECT recorded_at FROM native_changes WHERE entity='message' "
                              "AND entity_id=? AND operation='insert' ORDER BY change_id LIMIT 1",
                              (ident,)).fetchone()[0]

    def seq(self, ident):
        with sqlite3.connect(self.db) as db:
            return db.execute('SELECT seq FROM messages WHERE id=?', (ident,)).fetchone()[0]

    def row(self, session):
        return next(row for row in self.call('status') if row['id'] == session)

    def quiet_seat(self):
        # A conductor with no receiver keeps operator input unread; its harness
        # has no native route, so its state is blocked with that cause.
        self.call('attach', 'quiet', 'fixture', '', '')
        self.call('role', 'quiet', 'principal-conductor')

    def test_messages_carry_their_commit_time(self):
        self.quiet_seat()
        self.call('message', 'task-1', 'operator', 'quiet', 'task', 'Do the work.')
        delivered = self.call('delivery', 'task-1')
        self.assertRegex(delivered['committedAt'], INSTANT)
        self.assertEqual(delivered['committedAt'], self.committed('task-1'))
        outbox = [m for m in self.call('outbox', 'operator') if m['id'] == 'task-1']
        self.assertEqual([m['committedAt'] for m in outbox], [self.committed('task-1')])

    def test_a_status_row_names_unread_operator_input_and_its_blocked_cause(self):
        self.quiet_seat()
        self.call('message', 'task-1', 'operator', 'quiet', 'task', 'Do the work.')
        row = self.row('quiet')
        self.assertEqual(row['operatorWaitingSince'], self.committed('task-1'))
        self.assertEqual(row['inputWaitingSince'], self.committed('task-1'))
        self.assertEqual((row['state'], row['blockedCause']), ('blocked', 'harness-unsupported'))
        # Baton reports the endpointless seat to the operator; that report is the
        # seat's newest message to the operator.
        latest = row['operatorLatest']
        self.assertEqual((latest['kind'], latest['committedAt']), ('report', self.committed(latest['id'])))

    def test_a_status_row_names_operator_traffic_and_one_state_word(self):
        self.call('message', 'task-1', 'operator', 'seat', 'task', 'Do the work.')
        self.call('as', 'seat', 'read', 'task-1')
        row = self.row('seat')
        self.assertIn('operatorLatest', row)
        self.assertIsNone(row['operatorWaitingSince'])
        self.assertIsNone(row['inputWaitingSince'])
        self.assertEqual(row['state'], 'waiting')
        self.call('message', 'report-1', 'seat', 'operator', 'question', 'Which remote holds the commit?')
        row = self.row('seat')
        self.assertEqual(row['operatorLatest'], {'id': 'report-1', 'seq': self.seq('report-1'),
                                                 'kind': 'question',
                                                 'committedAt': self.committed('report-1')})
        sent = self.call('as', 'seat', 'completion-request', '--text', 'Done.')[0]
        self.assertEqual(sent['status'], 'admitted', sent)
        self.assertEqual(self.row('seat')['state'], 'asks-to-end')
        self.call('as', 'operator', 'confirm', 'seat')
        self.assertEqual(self.row('seat')['state'], 'ended')

if __name__ == '__main__':
    unittest.main()
