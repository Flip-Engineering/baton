"""Ordinary report-file entry over a separately admitted native executable.

These cases send report bodies through files or stdin. The recording parent
endpoint receives the retained ID and reads its committed report independently.
Run only under the exact source/platform gate admitted by the release owner.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_REPORT_EXE', ROOT / '.scratch/bend2/baton2')).resolve()


class ReportFile(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='baton-report-file-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.db = self.root / 'coord.db'
        self.observed = self.root / 'parent-observed.jsonl'
        self.endpoint = self.root / 'parent endpoint.py'
        self.endpoint.write_text('''import json, sqlite3, sys
with sqlite3.connect(sys.argv[1]) as db:
    row = db.execute("SELECT id,sender,recipient,kind,body FROM messages WHERE id=?", (sys.argv[3],)).fetchone()
with open(sys.argv[2], "a", encoding="utf-8") as out:
    out.write(json.dumps({"argvId":sys.argv[3], "row":row}) + "\\n")
''', encoding='utf-8')
        self.repo = self.root / 'repository'
        self.repo.mkdir()
        git_env = dict(os.environ, GIT_AUTHOR_NAME='Report fixture',
                       GIT_AUTHOR_EMAIL='fixture@example.invalid',
                       GIT_COMMITTER_NAME='Report fixture',
                       GIT_COMMITTER_EMAIL='fixture@example.invalid')
        for args in [('init', '-q', '-b', 'main'),
                     ('-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgSign=false',
                      'commit', '-q', '--allow-empty', '-m', 'Report fixture')]:
            subprocess.run(['git', '-C', str(self.repo), *args], env=git_env,
                           check=True, capture_output=True)
        base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                              check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-test', 'root-native', '')
        self.call('role', 'root', 'principal-conductor')
        self.call('recruit', 'parent', 'root', 'native-test', 'model', 'high',
                  str(self.repo), 'parent-branch', str(self.root / 'parent'), base)
        self.call('role', 'parent', 'associate-conductor')
        self.call('recruit', 'child', 'parent', 'native-test', 'model', 'high',
                  str(self.repo), 'child-branch', str(self.root / 'child'), base)
        self.call('connect', 'parent', 'parent-native', json.dumps(
            [sys.executable, str(self.endpoint), str(self.db), str(self.observed)]))

    def call(self, *args, data=None, success=True, database=None):
        result = subprocess.run([str(EXE), str(self.db if database is None else database), *args],
                                input=data, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def deliveries(self):
        if not self.observed.exists():
            return []
        return [json.loads(line) for line in self.observed.read_text(encoding='utf-8').splitlines()]

    def assert_report(self, ident, body):
        report = self.call('delivery', ident)
        self.assertEqual({key: report[key] for key in ('id', 'sender', 'recipient', 'kind', 'body')},
                         dict(id=ident, sender='child', recipient='parent', kind='report', body=body))
        self.assertIsNone(report['receipt'])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT CAST(body AS BLOB) FROM messages WHERE id=?',
                                        (ident,)).fetchone()[0], body.encode('utf-8'))
        self.assertEqual(self.deliveries()[-1],
                         {'argvId': ident, 'row': [ident, 'child', 'parent', 'report', body]})
        self.assertEqual(self.call('inbox', 'root'), [])

    def test_complete_large_file_and_stdin_reach_the_original_parent(self):
        # Exceeds the single-argument limit that blocked the replay fixture.
        body = "  beginning\r\n" + ("quotes ' \" \\ $(); café λ 🎵\r\n" * 16384) + "\tend\n\n"
        payload = body.encode('utf-8')
        path = self.root / "literal ' $() ; report\nwith trailing newline\n"
        path.write_bytes(payload)
        for ident, source, data in [('file-report', str(path), None), ('stdin-report', '-', payload)]:
            with self.subTest(source=source):
                answer = self.call('report-file', ident, 'child', source, data=data)
                self.assertEqual(answer['body'].encode('utf-8'), payload)
                self.assert_report(ident, body)

    def test_empty_file_and_stdin_are_retained_empty_reports(self):
        path = self.root / 'empty'
        path.write_bytes(b'')
        for ident, source, data in [('empty-file', str(path), None), ('empty-stdin', '-', b'')]:
            with self.subTest(source=source):
                self.call('report-file', ident, 'child', source, data=data)
                self.assert_report(ident, '')

    def test_inline_and_file_reuse_the_same_report_identity(self):
        body = " unchanged ' report\r\n\n"
        path = self.root / 'same report'
        path.write_bytes(body.encode('utf-8'))
        self.call('report', 'same-id', 'child', body)
        self.assert_report('same-id', body)
        self.call('ack', 'same-id', 'parent', 'original-receipt')
        before = self.deliveries()
        self.call('report-file', 'same-id', 'child', str(path))
        retained = self.call('delivery', 'same-id')
        self.assertEqual(retained['body'], body)
        self.assertEqual(retained['receipt'], 'original-receipt')
        self.assertEqual(self.deliveries(), before)
        path.write_bytes(b'different body')
        self.call('report-file', 'same-id', 'child', str(path), success=False)
        self.assertEqual(self.call('delivery', 'same-id'), retained)
        self.assertEqual(self.deliveries(), before)
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT id FROM messages').fetchall(), [('same-id',)])

    def test_read_failure_precedes_any_store_or_delivery_effect(self):
        absent = self.root / 'missing report'
        fresh = self.root / 'must not be created.db'
        self.call('report-file', 'unread', 'child', str(absent), database=fresh, success=False)
        self.assertFalse(fresh.exists())
        before = self.db.read_bytes()
        self.call('report-file', 'unread', 'child', str(absent), success=False)
        self.assertEqual(self.db.read_bytes(), before)
        self.assertEqual(self.deliveries(), [])
        self.assertEqual(self.call('inbox', 'parent'), [])

    def test_nul_body_preserves_existing_sql_text_refusal(self):
        # Sql.query rejects embedded NUL in its SQL before opening the database.
        self.call('report-file', 'nul-report', 'child', '-', data=b'before\0after', success=False)
        self.assertEqual(self.call('inbox', 'parent'), [])
        self.assertEqual(self.deliveries(), [])


if __name__ == '__main__':
    unittest.main()
