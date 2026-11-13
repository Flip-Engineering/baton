"""Committed root input survives an absent notification socket (#1488)."""
import importlib.util
import json
import os
import pathlib
import sqlite3
import subprocess
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('receive_fixture', ROOT / 'bend2/test/receive.py')
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)
receive.EXE = pathlib.Path(os.environ['BATON_ROOT_TEST_BINARY']).resolve()
TEXT = 'The message is committed. The root reads it from its inbox.'


class RootInboxDelivery(receive.Receive):
    def setUp(self):
        environment = dict(os.environ)
        for key in ('BATON_DATABASE', 'BATON_SESSION', 'BATON_ATTEMPT_DIRECTORY',
                    'BATON2_GIT_REGISTRY', 'HOME', 'CODEX_THREAD_ID', 'BATON_MCP_INPUT'):
            environment.pop(key, None)
        isolated = patch.dict(os.environ, environment, clear=True)
        isolated.start()
        self.addCleanup(isolated.stop)
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        super().setUp()
        script = self.directory / 'mcp-conductor.mjs'
        script.write_text("import net from 'node:net';\n"
                          "const s=net.createConnection(process.argv[7]);\n"
                          "s.on('connect',()=>s.end(process.argv[8]));\n"
                          "s.on('error',e=>{console.error(e);process.exitCode=1});\n")
        self.endpoint = ['node', str(script), str(self.db), str(receive.EXE),
                         '--session', 'root', '--deliver', 'missing-root.sock']
        with sqlite3.connect(self.db) as db:
            db.execute('UPDATE sessions SET endpoint=? WHERE id=?', (json.dumps(self.endpoint), 'root'))
            db.execute("INSERT INTO sessions(id,parent,harness,native,workspace) VALUES('worker','root','codex','native-worker',?)", (str(self.directory),))
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('assignment','root','worker','task','Complete the assigned work.')")
            db.execute("INSERT INTO message_reads(attempt,message,recipient,native,identity) VALUES('fixture','assignment','worker','','fixture')")

    def process_names(self):
        return super().process_names() | {'exe'}

    def eventually(self, observation, description):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            result = observation()
            if result:
                return result
            time.sleep(.01)
        self.fail(description)

    def committed_notice(self, value):
        if isinstance(value, dict):
            if 'noticeDelivery' in value:
                return value
            for child in value.values():
                found = self.committed_notice(child)
                if found is not None:
                    return found
        if isinstance(value, list):
            for child in value:
                found = self.committed_notice(child)
                if found is not None:
                    return found
        return None

    def send(self, verb, *args):
        actions = self.coord('as', 'worker', verb, *args)
        action, = actions
        if 'action' in action:
            self.assertEqual(action['status'], 'completed', action)
            self.assertEqual(action['waitStatus'], 'exit 0', action)
            self.assertEqual(action['stderr'], '', action)
            saved = json.loads(action['stdout'])
        else:
            self.assertEqual(action['admission']['status'], 'admitted', action)
            self.assertEqual(action['wake']['status'], 'accepted', action)
            saved = action
        answer = self.committed_notice(saved)
        self.assertIsNotNone(answer, saved)
        self.assertTrue(answer['committed'], answer)
        self.assertEqual(answer['noticeDelivery']['status'], 'undelivered', answer)
        self.assertEqual(answer['noticeDelivery']['detail'], TEXT, answer)
        self.assertEqual(set(answer['noticeDelivery']), {'status', 'code', 'detail', 'cause'})
        self.assertEqual(answer['noticeDelivery']['code'], 1)
        self.assertIn('no process accepts connections', answer['noticeDelivery']['cause'])
        self.assertNotIn('Attach ', answer['noticeDelivery']['cause'])
        self.assertNotIn('retry', answer['noticeDelivery']['cause'])
        return saved

    def retained(self, kind, body):
        with sqlite3.connect(self.db) as db:
            rows = db.execute("SELECT id,body FROM messages WHERE sender='worker' AND recipient='root' AND kind=?", (kind,)).fetchall()
            self.assertEqual(len(rows), 1, rows)
            ident, stored = rows[0]
            self.assertEqual(stored, body)
            self.assertEqual(db.execute('SELECT count(*) FROM message_reads WHERE message=?', (ident,)).fetchone()[0], 0)
            self.assertEqual(db.execute("SELECT count(*) FROM messages WHERE id LIKE '%:recovery-failure'").fetchone()[0], 0)
        self.assertIn('root session root', pathlib.Path(str(self.db) + '.root.log').read_text())
        self.assert_no_start()
        return ident

    def test_report_is_committed_with_separate_notice_result(self):
        self.send('report', '--text', 'The report is complete.')
        self.retained('report', 'The report is complete.')

    def test_question_is_committed_with_separate_notice_result(self):
        self.send('ask', '--text', 'Which recorded target should I use?')
        self.retained('question', 'Which recorded target should I use?')

    def test_completion_request_is_committed_with_separate_notice_result(self):
        self.send('completion-request', '--text', 'The assignment is ready for review.')
        self.retained('completion-request', 'The assignment is ready for review.')

    def test_knowledge_notice_is_committed_and_finding_reads_back(self):
        saved = self.send('knowledge', 'record', '--kind', 'finding', '--claim', 'The evidence is retained.',
                          '--evidence', 'The message is in this private database.', '--limits', 'Fixture observation.')
        ident = saved['id']
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute('SELECT claim FROM knowledge WHERE id=?', (ident,)).fetchone()[0], saved['claim'])
            self.assertEqual(db.execute('SELECT recipient FROM messages WHERE id=?', (ident + ':notice',)).fetchone()[0], 'root')
        action, = self.coord('as', 'worker', 'knowledge', 'read')
        self.assertEqual(action['status'], 'completed', action)
        self.assertEqual(json.loads(action['stdout'])[0]['id'], ident)

    def test_root_diagnostics_and_inbox_retain_the_unattached_cause(self):
        self.send('report', '--text', 'Read this retained report.')
        ident = self.retained('report', 'Read this retained report.')
        for args in [('status',), ('session', 'root'), ('orchestra',)]:
            with self.subTest(command=args):
                result = self.coord(*args, ok=False)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('root session root', result.stderr)
                self.assertIn('no attached channel', result.stderr)
        inbox = self.coord('as', 'root', 'inbox')
        action, = inbox
        self.assertEqual(action['status'], 'completed', action)
        self.assertIn(ident, action['stdout'])
        self.assertTrue(receive.read_recorded(self.db, ident))

    def test_recovery_finishes_when_only_root_notification_is_unattached(self):
        self.player()
        self.coord('account', 'read', *[''] * 8)
        with sqlite3.connect(self.db) as db:
            db.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('recover-task','root','parent','task','Finish the retained native work.')")
        observer = self.spawn(*self.receive_args('parent'))
        control, started = self.accept_child(observer, 'parent')
        def bound():
            with sqlite3.connect(self.db) as db:
                return db.execute("SELECT 1 FROM sessions s JOIN executions e ON e.session=s.id WHERE s.id='parent' AND s.native=? AND e.phase='running'", (started['native'],)).fetchone()
        self.eventually(bound, 'The original native identity was not recorded')
        with sqlite3.connect(self.db) as db:
            ident, directory = db.execute("SELECT id,directory FROM executions WHERE session='parent'").fetchone()
        observer.kill()
        observer.wait()
        self.action(control, body='The recovered native completed.', read=['recover-task'])
        self.assertEqual(control.readline(), b'')
        attempt = pathlib.Path(directory)
        self.eventually(lambda: (attempt / 'acknowledged').exists(), 'Recovery did not acknowledge the retained native')
        self.eventually(lambda: self.execution('parent')[0] == 'exited', 'Recovery did not record completion')
        self.eventually(lambda: not [process for process in self.owned_processes()
                                     if ' --instance-owner ' not in process['command']],
                        'The recovered observer did not finish its delivery')
        with sqlite3.connect(self.db) as db:
            reports = db.execute("SELECT body FROM messages WHERE sender='parent' AND recipient='root' AND kind='report'").fetchall()
            self.assertTrue(any('The recovered native completed.' in row[0] for row in reports), reports)
            self.assertEqual(db.execute("SELECT count(*) FROM messages WHERE id LIKE '%:recovery-failure'").fetchone()[0], 0)
        self.assertIn('no attached channel', pathlib.Path(str(self.db) + '.root.log').read_text())
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assert_no_start()


for name in dir(receive.Receive):
    if name.startswith('test_'):
        setattr(RootInboxDelivery, name, None)


if __name__ == '__main__':
    unittest.main()
