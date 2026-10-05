"""Remote bound Direct SQL checks using an admitted compiled fixture.

BATON2_BOUND_EXPECTATION selects available or unavailable explicitly. The current
host qualifies birth identity on Darwin; Linux refusal is a separate outcome.
No process preparation, grant, cancellation or public Receive runs in this suite.
"""
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import unittest
from host_control_capture import run

EXE = os.environ.get('BATON2_DIRECT_ADMISSION_EXE')
BASELINE = os.environ.get('BATON2_BASELINE_EXE')
EXPECTATION = os.environ.get('BATON2_BOUND_EXPECTATION')
EVIDENCE = Path(tempfile.mkdtemp(prefix='direct-bound-'))
print(f'Bound Direct evidence: {EVIDENCE}', flush=True)


class BoundDirect(unittest.TestCase):
    def call(self, argv):
        directory = Path(tempfile.mkdtemp(prefix='child-', dir=EVIDENCE))
        return run(directory, 'call', argv, 30)

    def sql(self, statement, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(statement, parameters).fetchall()

    def ok(self, result):
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stderr, b'')
        return json.loads(result.stdout)

    def test_bound_original_decision_and_refusal(self):
        self.assertIn(EXPECTATION, ('available', 'unavailable'))
        self.assertTrue(EXE and Path(EXE).is_file())
        self.assertTrue(BASELINE and Path(BASELINE).is_file())
        self.db = EVIDENCE / 'original.db'
        for session in ('owner', 'child'):
            result = self.call([BASELINE, str(self.db), 'attach', session, 'muse', '', ''])
            self.assertEqual(result.returncode, 0, result.stderr)
        self.sql("UPDATE sessions SET parent='owner',model='model',effort='high',workspace='/workspace' WHERE id='child'")
        observed = self.call([EXE, 'binding', str(self.db)])
        if EXPECTATION == 'unavailable':
            self.assertNotEqual(observed.returncode, 0)
            self.assertEqual(observed.stdout, b'')
            self.assertIn(b'context database binding unavailable: discriminator', observed.stderr)
            return
        self.ok(observed)
        # Retain and reuse these exact original bytes through all later calls.
        binding = observed.stdout.decode('utf-8')
        (EVIDENCE / 'original.binding').write_bytes(observed.stdout)

        def decide(binding_value, ident='first', task='task'):
            return self.call([EXE, 'bound-decide', str(self.db), binding_value,
                              ident, '/attempt-' + ident, task])

        def readback(binding_value, ident='first'):
            return self.call([EXE, 'bound-readback', str(self.db), binding_value, ident])

        # A wrong binding must prevent the actual decision SQL, including DDL.
        wrong = dict(json.loads(binding), path='/different-qualified-path')
        refused = decide(json.dumps(wrong, separators=(',', ':')))
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(refused.stdout, b'')
        self.assertIn(b'context database binding mismatch: path', refused.stderr)
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='direct_requests'"), [])
        first = self.ok(decide(binding))
        self.assertEqual(first['admissionDecision'], 'accepted')
        self.sql("UPDATE direct_requests SET phase='exited',outcome='exit 7',notification='pending',cleanup='owed' WHERE id='first'")
        self.sql("UPDATE executions SET phase='exited',status='exit 7'")
        original = self.ok(readback(binding))
        self.assertEqual(original, dict(first, lookup='retained', phase='exited',
                                       outcome='exit 7', notification='pending', cleanup='owed'))
        self.ok(decide(binding, 'second', 'later task'))
        self.assertEqual(self.ok(readback(binding)), original)
        self.assertEqual(self.sql('SELECT id FROM executions'), [('second',)])
        self.assertEqual(self.ok(readback(binding, "missing' λ\n")),
                         {'lookup': 'absent', 'requestId': "missing' λ\n"})
        conflict = self.ok(decide(binding, 'first', 'changed'))
        self.assertEqual(conflict['error'], 'direct-request-conflict')
        self.assertEqual(conflict['field'], 'task')
        self.assertEqual(self.ok(readback(binding)), original)

        # An expected logical token cannot become an omitted expectation.
        token = dict(json.loads(binding), token='required-original-token')
        refused = readback(json.dumps(token, separators=(',', ':')))
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(refused.stdout, b'')
        self.assertIn(b'context database binding mismatch: token', refused.stderr)

        # Keep the original inode alive while replacing its pathname.
        moved = self.db.with_name('original-kept.db')
        self.db.rename(moved)
        with sqlite3.connect(self.db) as replacement:
            replacement.execute('CREATE TABLE marker(value TEXT)')
        refused = readback(binding)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(refused.stdout, b'')
        self.assertIn(b'context database binding mismatch:', refused.stderr)
        self.assertEqual(self.sql("SELECT name FROM sqlite_master WHERE name='direct_requests'"), [])
        self.assertEqual(self.sql('SELECT * FROM marker'), [])


if __name__ == '__main__':
    unittest.main()
