"""Verify native endpoint admission, retained input and actual local delivery."""
from contextlib import closing
import json
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Connect(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.deliveries = self.directory / 'deliveries.jsonl'
        endpoint = self.directory / 'endpoint.py'
        endpoint.write_text(
            'import json,pathlib,subprocess,sys\n'
            'exe,db,log,*arguments=sys.argv[1:]\n'
            'with pathlib.Path(log).open("a") as output:\n'
            ' output.write(json.dumps(arguments,ensure_ascii=False)+"\\n")\n'
            'result=subprocess.run([exe,db,"ack",arguments[-1],"lead","accepted"],capture_output=True)\n'
            'sys.stdout.buffer.write(result.stdout)\n'
            'sys.stderr.buffer.write(result.stderr)\n'
            'raise SystemExit(result.returncode)\n')
        self.arguments = ["λ ' whitespace\n", '']
        self.endpoint = json.dumps([sys.executable, str(endpoint), str(EXE), str(self.db),
                                    str(self.deliveries), *self.arguments], ensure_ascii=False)
        self.task = ('message', 'retained-task', 'operator', 'lead', 'task', "body λ ' \n")
        self.call('attach', 'operator', 'fixture', '', '')
        self.call('role', 'operator', 'operator')
        self.call('attach', 'lead', 'fixture', 'native-kept', '')
        self.call('role', 'lead', 'associate-conductor')
        self.call(*self.task)
        self.call('connect', 'lead', 'native-kept', self.endpoint)

    def call(self, *args, success=True):
        result = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        return json.loads(result.stderr)

    def state(self):
        with closing(sqlite3.connect(self.db)) as db:
            return {name: db.execute('SELECT * FROM ' + name).fetchall()
                    for name in ('sessions', 'messages', 'turns', 'executions', 'session_roles')}

    def test_filename_refuses_without_mutation_and_retained_input_delivers(self):
        filename = self.directory / 'lead-endpoint.json'
        filename.write_text(self.endpoint)
        before = self.state()
        refused = self.call('connect', 'lead', 'native-replacement', str(filename), success=False)
        self.assertEqual(refused['error'], 'invalid-endpoint')
        self.assertEqual(refused['session'], 'lead')
        self.assertIn('JSON', refused['condition'])
        self.assertIn('ENDPOINT', refused['next'])
        self.assertEqual(self.state(), before)
        self.assertFalse(self.deliveries.exists())
        corrected = self.call('connect', 'lead', 'native-kept', filename.read_text())
        self.assertEqual(corrected['endpoint'], self.endpoint)
        self.assertEqual(self.state(), before)
        self.call(*self.task)
        self.assertEqual(json.loads(self.deliveries.read_text()), self.arguments + ['retained-task'])
        self.assertEqual(self.call('delivery', 'retained-task')['body'], self.task[-1])
        self.assertEqual(self.call('delivery', 'retained-task')['receipt'], 'accepted')
        self.assertEqual(self.call('inbox', 'lead'), [])
        self.call(*self.task)
        self.assertEqual(len(self.deliveries.read_text().splitlines()), 1)

    def test_invalid_argv_preserves_existing_binding_and_pending_input(self):
        before = self.state()
        invalid = ['not JSON', '{', '{}', 'null', '[]', json.dumps('/usr/bin/true'),
                   '[42]', '["/usr/bin/true",null]', '["/usr/bin/true",{}]',
                   '["/usr/bin/true",false]', '["", "argument"]',
                   json.dumps(['/usr/bin/true', 'bad\0argument']),
                   json.dumps(['bad\0executable'])]
        for endpoint in invalid:
            with self.subTest(endpoint=endpoint):
                refused = self.call('connect', 'lead', 'native-replacement', endpoint, success=False)
                self.assertEqual(refused['error'], 'invalid-endpoint')
                self.assertEqual(self.state(), before)
                self.assertFalse(self.deliveries.exists())

    def test_empty_endpoint_disconnects_and_valid_argv_resumes_retained_delivery(self):
        messages = self.state()['messages']
        cleared = self.call('connect', 'lead', 'native-disconnected', '')
        self.assertEqual(cleared['native'], 'native-disconnected')
        self.assertEqual(cleared['endpoint'], '')
        self.call(*self.task)
        self.assertEqual(self.state()['messages'], messages)
        self.assertFalse(self.deliveries.exists())
        connected = self.call('connect', 'lead', 'native-reconnected', self.endpoint)
        self.assertEqual(connected['native'], 'native-reconnected')
        self.assertEqual(connected['endpoint'], self.endpoint)
        self.call(*self.task)
        self.assertEqual(json.loads(self.deliveries.read_text()), self.arguments + ['retained-task'])
        self.assertEqual(self.call('inbox', 'lead'), [])

    def test_missing_executable_is_admitted_and_delivery_failure_retains_input(self):
        endpoint = json.dumps([str(self.directory / 'missing-executable')])
        self.assertEqual(self.call('connect', 'lead', 'native-kept', endpoint)['endpoint'], endpoint)
        before = self.state()
        result = subprocess.run([str(EXE), str(self.db), *self.task], text=True, capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertTrue(result.stderr.strip(), result.stdout + result.stderr)
        self.assertEqual(self.state(), before)
        self.assertFalse(self.deliveries.exists())


if __name__ == '__main__':
    unittest.main()
