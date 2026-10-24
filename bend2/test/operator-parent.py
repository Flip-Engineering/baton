"""Operator child command admission through the native coordinator.

BATON2_EXE selects the full coordinator. BATON2_MESSAGE_EXE optionally selects
the focused admission entry for dispatch, report and ask. Setup still uses the
full coordinator. Focused admission leaves delivery pending.
"""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2')).resolve()
MESSAGE_EXE = os.environ.get('BATON2_MESSAGE_EXE')


class OperatorParent(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='operator-parent-', dir=EXE.parent)
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.addCleanup(self.shutdown)
        self.repo = self.directory / 'repo'
        self.repo.mkdir()
        for args in [('init', '-q'), ('config', 'user.name', 'Operator parent fixture'),
                     ('config', 'user.email', 'fixture@example.invalid'),
                     ('commit', '-qm', 'Initial tree', '--allow-empty')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                           capture_output=True, text=True)
        self.env = os.environ.copy()
        for key in ('BATON_DATABASE', 'BATON_SESSION', 'CODEX_THREAD_ID'):
            self.env.pop(key, None)
        self.call('attach', 'operator', 'fixture', '', '')
        self.call('role', 'operator', 'operator')
        self.call('attach', 'root', 'fixture', '', '')
        self.call('role', 'root', 'principal-conductor')

    def shutdown(self):
        subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                       capture_output=True, text=True)

    def call(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                env=self.env, capture_output=True, text=True)
        with (self.directory / 'commands.jsonl').open('a') as log:
            log.write(json.dumps({'argv': list(map(str, args)), 'exit': result.returncode,
                                  'stdout': result.stdout, 'stderr': result.stderr}) + '\n')
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def action(self, actor, *args, ok=True):
        if MESSAGE_EXE and args[0] in ('dispatch', 'report', 'ask'):
            options = dict(zip(args[1::2], args[2::2]))
            result = subprocess.run(
                [MESSAGE_EXE, str(self.db), args[0], actor, options.get('--to', ''),
                 options.get('--kind', 'task'), options['--text']],
                env=self.env, capture_output=True, text=True)
            with (self.directory / 'commands.jsonl').open('a') as log:
                log.write(json.dumps({'argv': result.args, 'exit': result.returncode,
                                      'stdout': result.stdout, 'stderr': result.stderr}) + '\n')
            self.assertEqual(result.returncode, 0 if ok else 2,
                             result.stdout + result.stderr)
            return json.loads(result.stdout) if ok else {'stderr': result.stderr}
        outcomes = self.call('as', actor, *args)
        self.assertEqual(len(outcomes), 1)
        outcome = outcomes[0]
        self.assertEqual(outcome['status'], 'completed' if ok else 'failed', outcome)
        self.assertEqual(outcome['waitStatus'], 'exit 0' if ok else 'exit 2', outcome)
        return json.loads(outcome['stdout']) if ok else outcome

    def child(self, name, parent='operator', recruit=False):
        options = ['--session', name, '--harness', 'fixture', '--model', 'model',
                   '--effort', 'high']
        if parent != 'operator':
            options += ['--parent', parent]
        if recruit:
            options += ['--repo', str(self.repo), '--branch', name + '-branch',
                        '--path', str(self.directory / name), '--base', 'HEAD']
        else:
            options += ['--path', str(self.repo)]
        return self.action('operator', 'recruit' if recruit else 'join', *options)

    def messages(self):
        with sqlite3.connect(self.db) as db:
            return db.execute('SELECT sender,recipient,kind,body FROM messages ORDER BY seq').fetchall()

    def test_join_and_recruit_children_accept_operator_dispatch_as_players(self):
        for recruit in (False, True):
            with self.subTest(recruit=recruit):
                name = 'recruited' if recruit else 'joined'
                self.child(name, recruit=recruit)
                self.assertEqual(self.call('session', name)['parent'], 'operator')
                self.assertEqual(self.call('role', name)['role'], 'player')
                body = "Complete operator task λ🙂.\nKeep the sender's identity.\n"
                row = self.action('operator', 'dispatch', '--to', name, '--text', body)
                self.assertEqual((row['sender'], row['recipient'], row['kind'], row['body']),
                                 ('operator', name, 'task', body))
                self.assertIn(('operator', name, 'task', body), self.messages())

    def test_children_report_and_ask_their_operator_parent_in_each_role(self):
        self.child('child')
        for role in ('player', 'associate-conductor'):
            self.call('role', 'child', role)
            for verb, kind in [('report', 'report'), ('ask', 'question')]:
                body = role + ' ' + verb + '\nComplete child input λ🙂.\n'
                row = self.action('child', verb, '--text', body)
                self.assertEqual((row['sender'], row['recipient'], row['kind'], row['body']),
                                 ('child', 'operator', kind, body))
                self.assertIn(('child', 'operator', kind, body), self.messages())
            addressed = self.action('child', 'dispatch', '--to', 'operator',
                                    '--kind', 'report', '--text', 'Addressed ' + role)
            self.assertEqual((addressed['sender'], addressed['recipient']),
                             ('child', 'operator'))
            self.action('operator', 'dispatch', '--to', 'child', '--kind', 'guidance',
                        '--text', 'Continue ' + role)

    def test_operator_routes_follow_immediate_parentage(self):
        self.child('child')
        self.call('role', 'child', 'associate-conductor')
        self.child('grandchild', parent='child')
        self.child('other-child', parent='root')
        self.call('role', 'other-child', 'associate-conductor')
        for sender, recipient in [('operator', 'grandchild'), ('grandchild', 'operator'),
                                  ('operator', 'other-child'), ('other-child', 'operator'),
                                  ('operator', 'operator')]:
            with self.subTest(sender=sender, recipient=recipient):
                before = self.messages()
                result = self.action(sender, 'dispatch', '--to', recipient,
                                     '--text', 'Unrelated route.', ok=False)
                self.assertIn('message-route-denied', result['stderr'])
                self.assertEqual(self.messages(), before)

    def test_operator_and_parentless_conductor_keep_their_routes(self):
        self.action('operator', 'dispatch', '--to', 'root', '--text', 'Root task.')
        row = self.action('root', 'report', '--text', 'Root report.')
        self.assertEqual((row['sender'], row['recipient']), ('root', 'operator'))
        self.call('attach', 'unassigned', 'fixture', '', '')
        result = self.action('operator', 'dispatch', '--to', 'unassigned',
                             '--text', 'Unassigned task.', ok=False)
        self.assertIn('message-route-denied', result['stderr'])


if __name__ == '__main__':
    unittest.main()
