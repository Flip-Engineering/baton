"""Exercise message admission and retained delivery through the native CLI."""
import json
from contextlib import closing
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Messaging(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.repo = self.directory / 'repo'
        self.repo.mkdir()
        for args in [('init', '-q'), ('config', 'user.name', 'Messaging fixture'),
                     ('config', 'user.email', 'fixture@example.invalid'),
                     ('commit', '-qm', 'Initial tree', '--allow-empty')]:
            subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                           text=True, capture_output=True)
        self.deliveries = self.directory / 'deliveries.jsonl'
        endpoint = self.directory / 'endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            f'with pathlib.Path({str(self.deliveries)!r}).open("a") as f:\n'
                            ' f.write(sys.argv[-1]+"\\n")\n')
        self.endpoint = json.dumps([sys.executable, str(endpoint)])
        for name, role in [('root', 'principal-conductor'), ('other-root', 'principal-conductor'),
                           ('operator', 'operator')]:
            self.call('attach', name, 'fixture', '', self.endpoint)
            self.call('role', name, role)
        for name, parent, role in [('lead-a', 'root', 'associate-conductor'),
                                   ('lead-b', 'root', 'associate-conductor'),
                                   ('leaf-a', 'lead-a', 'player'),
                                   ('leaf-b', 'lead-b', 'player'),
                                   ('deep-lead', 'lead-a', 'associate-conductor'),
                                   ('deep-leaf', 'deep-lead', 'player')]:
            self.call('recruit', name, parent, 'fixture', 'model', 'low', str(self.repo),
                      name + '-branch', str(self.directory / name), 'HEAD')
            if role == 'associate-conductor':
                self.call('role', name, role)
            self.call('connect', name, '', self.endpoint)

    def call(self, *args, success=True, stdin=None):
        result = subprocess.run([str(EXE), str(self.db), *args], input=stdin,
                                text=True, capture_output=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return json.loads(result.stdout)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def state(self):
        with closing(sqlite3.connect(self.db)) as db:
            return {name: db.execute('SELECT * FROM ' + name).fetchall()
                    for name in ['messages', 'turns', 'executions']}

    def endpoint_output(self):
        return self.deliveries.read_bytes() if self.deliveries.exists() else b''

    def send(self, ident, sender, recipient, kind='guidance', body='Task information.'):
        row = self.call('message', ident, sender, recipient, kind, body)
        self.assertEqual((row['sender'], row['recipient'], row['kind'], row['body']),
                         (sender, recipient, kind, body))
        return row

    def refused(self, ident, sender, recipient, kind='guidance', body='Task information.'):
        before, delivered = self.state(), self.endpoint_output()
        result = self.call('message', ident, sender, recipient, kind, body, success=False)
        self.assertIn('message-route-denied', result.stderr)
        self.assertIn('immediate conductor', result.stderr)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.endpoint_output(), delivered)
        return result

    def ensemble(self, name, *members, owner='root', coupling='tight'):
        self.call('ensemble', name, owner, coupling)
        for member in members:
            self.call('ensemble-member', name, owner, member, 'add')

    def test_conductors_reach_all_descendants_and_players_reach_immediate_parent(self):
        for i, pair in enumerate([('root', 'deep-leaf'), ('lead-a', 'deep-leaf'),
                                  ('deep-leaf', 'deep-lead'), ('deep-lead', 'lead-a'),
                                  ('lead-a', 'root')]):
            self.send('permitted-' + str(i), *pair)
        for i, pair in enumerate([('deep-leaf', 'lead-a'), ('deep-leaf', 'root'),
                                  ('deep-lead', 'root'), ('leaf-a', 'lead-b'),
                                  ('root', 'other-root')]):
            self.refused('denied-' + str(i), *pair)

    def test_loose_is_the_creation_default_and_tight_players_can_cross_parents(self):
        created = self.call('ensemble', 'players', 'root')
        self.assertEqual(created['coupling'], 'loose')
        for name in ['leaf-a', 'leaf-b']:
            self.call('ensemble-member', 'players', 'root', name, 'add')
        self.refused('loose', 'leaf-a', 'leaf-b')
        self.call('ensemble', 'players', 'root', 'tight')
        self.send('tight-a', 'leaf-a', 'leaf-b')
        self.send('tight-b', 'leaf-b', 'leaf-a')
        retained = self.call('ensemble', 'players', 'root')
        self.assertEqual(retained['coupling'], 'tight')
        self.assertEqual(retained['members'], ['leaf-a', 'leaf-b'])
        self.send('tight-after-omission', 'leaf-a', 'leaf-b')
        self.call('ensemble', 'players', 'root', 'loose')
        self.refused('explicit-loose', 'leaf-a', 'leaf-b')
        self.call('ensemble', 'players', 'root', 'tight')
        self.send('explicit-tight', 'leaf-a', 'leaf-b')
        self.refused('nonmember', 'leaf-a', 'deep-leaf')
        self.call('ensemble-member', 'players', 'root', 'leaf-b', 'remove')
        self.refused('removed', 'leaf-a', 'leaf-b')

    def test_tight_conductors_can_message_across_hierarchy_depths(self):
        self.ensemble('top', 'root', 'other-root')
        self.send('top-a', 'root', 'other-root')
        self.send('top-b', 'other-root', 'root')
        self.ensemble('leads', 'lead-a', 'lead-b')
        self.send('lead-peer', 'lead-a', 'lead-b')
        self.call('recruit', 'other-lead', 'other-root', 'fixture', 'model', 'low',
                  str(self.repo), 'other-lead-branch', str(self.directory / 'other-lead'), 'HEAD')
        self.call('role', 'other-lead', 'associate-conductor')
        self.call('ensemble-member', 'leads', 'root', 'other-lead', 'add')
        self.send('cross-parent-conductors', 'lead-a', 'other-lead')
        self.refused('outside-tight-ensemble', 'deep-lead', 'lead-b')
        self.call('ensemble-member', 'leads', 'root', 'deep-lead', 'add')
        self.send('different-depth-conductors', 'deep-lead', 'lead-b')
        self.send('different-depth-conductors-reply', 'lead-b', 'deep-lead')
        self.call('ensemble', 'top', 'root', 'loose')
        self.refused('top-loose', 'root', 'other-root')

    def test_tight_membership_cannot_bypass_upward_ancestry(self):
        self.ensemble('mixed', 'root', 'lead-a', 'deep-leaf')
        self.refused('grandparent', 'deep-leaf', 'lead-a')
        self.refused('principal', 'deep-leaf', 'root')
        self.send('ordinary-downward', 'lead-a', 'deep-leaf')
        self.call('role', 'lead-a', 'player')
        self.refused('player-ancestor-downward', 'lead-a', 'deep-leaf')

    def test_childless_roles_and_operator_routes_are_explicit(self):
        self.call('attach', 'unassigned', 'fixture', '', self.endpoint)
        self.assertEqual(self.call('role', 'unassigned')['role'], 'player')
        self.refused('null-is-not-operator', 'unassigned', 'root')
        self.send('operator-task', 'operator', 'root', 'task')
        self.send('operator-report', 'root', 'operator', 'report')
        self.refused('operator-to-subordinate', 'operator', 'leaf-a')
        self.refused('subordinate-to-operator', 'leaf-a', 'operator')
        self.call('role', 'leaf-a', 'operator', success=False)
        self.assertEqual(self.call('role', 'leaf-a')['role'], 'player')
        self.ensemble('null-peers', 'root', 'unassigned')
        self.call('role', 'unassigned', 'principal-conductor')
        self.send('childless-conductor', 'root', 'unassigned')
        self.call('ensemble-member', 'null-peers', 'root', 'operator', 'add', success=False)

    def test_closed_declarations_and_ownership_preserve_existing_policy(self):
        self.call('role', 'root', 'unknown', success=False)
        self.call('role', 'missing', 'principal-conductor', success=False)
        self.assertEqual(self.call('role', 'root')['role'], 'principal-conductor')
        self.assertEqual(self.call('ensemble', 'player-owned', 'leaf-a', 'tight')['owner'],
                         'leaf-a')
        self.call('ensemble', 'bad', 'missing', 'tight', success=False)
        self.call('ensemble', 'bad', 'root', 'unknown', success=False)
        self.ensemble('owned', 'leaf-a', 'leaf-b')
        before = self.call('ensemble', 'owned')
        self.call('ensemble', 'owned', 'other-root', success=False)
        self.call('ensemble', 'owned', 'other-root', 'loose', success=False)
        state, delivered = self.state(), self.endpoint_output()
        for ensemble, owner, member, action in [
                ('owned', 'other-root', 'leaf-b', 'remove'),
                ('owned', 'root', 'missing', 'add'),
                ('owned', 'root', 'operator', 'add'),
                ('owned', 'root', 'leaf-b', 'unknown'),
                ('missing', 'root', 'leaf-b', 'add')]:
            with self.subTest(ensemble=ensemble, member=member, action=action):
                refused = self.call('ensemble-member', ensemble, owner, member, action,
                                    success=False)
                self.assertEqual(refused.returncode, 2)
                error = json.loads(refused.stderr)
                self.assertEqual((error['error'], error['ensemble'], error['owner'],
                                  error['session'], error['action']),
                                 ('ensemble-member-refused', ensemble, owner, member, action))
                self.assertEqual(error['existingOwner'], 'root' if ensemble == 'owned' else None)
                self.assertTrue(error['condition'])
                self.assertTrue(error['next'])
                self.assertEqual(self.call('ensemble', 'owned'), before)
                self.assertEqual(self.state(), state)
                self.assertEqual(self.endpoint_output(), delivered)
        self.assertEqual(self.call('ensemble', 'owned'), before)
        first = self.call('ensemble-member', 'owned', 'root', 'leaf-b', 'remove')
        self.assertEqual(self.call('ensemble-member', 'owned', 'root', 'leaf-b', 'remove'), first)
        self.call('ensemble-member', 'owned', 'root', 'missing', 'remove')
        added = self.call('ensemble-member', 'owned', 'root', 'leaf-b', 'add')
        self.assertEqual(self.call('ensemble-member', 'owned', 'root', 'leaf-b', 'add'), added)
        self.assertEqual(self.call('ensemble', 'owned'), before)

    def test_reports_and_questions_explain_missing_parent_or_operator_without_delivery(self):
        body = "Unfinished upstream input λ🙂.\n"
        self.call('attach', 'unassigned', 'fixture', '', self.endpoint)
        self.call('role', 'operator', 'player')
        before, delivered = self.state(), self.endpoint_output()
        for sender in ['unassigned', 'missing', 'root']:
            for verb, kind in [('report', 'report'), ('ask', 'question')]:
                with self.subTest(sender=sender, command=verb):
                    ident = sender + '-' + verb
                    refused = self.call(verb, ident, sender, body, success=False)
                    self.assertEqual(refused.returncode, 2)
                    error = json.loads(refused.stderr)
                    self.assertEqual((error['error'], error['sender'], error['kind']),
                                     ('report-recipient-missing', sender, kind))
                    self.assertTrue(error['condition'])
                    self.assertTrue(error['next'])
                    self.assertEqual(self.state(), before)
                    self.assertEqual(self.endpoint_output(), delivered)
        upstream = self.directory / 'upstream.txt'
        upstream.write_text(body, encoding='utf-8')
        for verb in ['report-file', 'ask-file']:
            refused = self.call(verb, 'file-' + verb, 'unassigned', str(upstream), success=False)
            self.assertEqual(json.loads(refused.stderr)['error'], 'report-recipient-missing')
            self.assertEqual(self.state(), before)
            self.assertEqual(self.endpoint_output(), delivered)
        self.call('role', 'operator', 'operator')
        for verb, kind in [('report', 'report'), ('ask', 'question')]:
            row = self.call(verb, 'root-' + verb, 'root', body)
            self.assertEqual((row['recipient'], row['kind'], row['body']),
                             ('operator', kind, body))
            self.assertIsNone(row['receipt'])

    def test_all_message_kinds_and_file_or_stdin_share_admission(self):
        for kind in ['task', 'guidance', 'recovery', 'report', 'question', 'custom']:
            self.refused('self-' + kind, 'root', 'root', kind)
            self.refused('peer-' + kind, 'leaf-a', 'leaf-b', kind)
        body = "Complete text with apostrophe ' and unicode λ🙂.\n"
        file = self.directory / 'message.txt'
        file.write_text(body)
        before, delivered = self.state(), self.endpoint_output()
        for path in [str(file), '-']:
            denied = self.call('message-file', 'denied-file', 'leaf-a', 'root',
                               'guidance', path, stdin=body, success=False)
            self.assertIn('message-route-denied', denied.stderr)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.endpoint_output(), delivered)
        row = self.call('message-file', 'accepted-file', 'root', 'deep-leaf',
                        'task', '-', stdin=body)
        self.assertEqual(row['body'], body)

    def test_exact_accepted_retry_and_pending_delivery_survive_policy_changes(self):
        self.ensemble('players', 'leaf-a', 'leaf-b')
        self.send('retained', 'leaf-a', 'leaf-b')
        self.call('ensemble', 'players', 'root', 'loose')
        self.call('ensemble-member', 'players', 'root', 'leaf-b', 'remove')
        row = self.send('retained', 'leaf-a', 'leaf-b')
        self.assertIsNone(row['receipt'])
        self.assertEqual(self.endpoint_output(), b'retained\nretained\n')
        self.assertEqual(self.call('inbox', 'leaf-b')[0]['id'], 'retained')
        self.refused('new-message', 'leaf-a', 'leaf-b')
        self.call('ack', 'retained', 'leaf-b', 'native accepted')
        delivered = self.endpoint_output()
        self.assertEqual(self.send('retained', 'leaf-a', 'leaf-b')['receipt'], 'native accepted')
        self.assertEqual(self.endpoint_output(), delivered)

    def test_changed_coordinates_cannot_reuse_an_accepted_message_identity(self):
        self.send('accepted', 'root', 'leaf-a')
        for sender, recipient, kind, body in [
                ('leaf-b', 'leaf-a', 'guidance', 'Task information.'),
                ('leaf-a', 'leaf-b', 'guidance', 'Task information.'),
                ('leaf-a', 'leaf-a', 'recovery', 'Task information.'),
                ('leaf-b', 'leaf-a', 'guidance', 'Changed body.')]:
            refused = self.refused('accepted', sender, recipient, kind, body)
            self.assertNotIn('"body":"Task information."', refused.stderr)
        before, delivered = self.state(), self.endpoint_output()
        self.call('message', 'accepted', 'root', 'leaf-a', 'task', 'Changed body.', success=False)
        self.assertEqual(self.state(), before)
        self.assertEqual(self.endpoint_output(), delivered)

    def test_role_changes_preserve_accepted_inputs_without_granting_new_routes(self):
        self.send('retained-role', 'root', 'leaf-a')
        self.call('role', 'root', 'player')
        self.refused('new-role-input', 'root', 'leaf-a')
        self.assertIsNone(self.send('retained-role', 'root', 'leaf-a')['receipt'])
        self.assertEqual(self.call('inbox', 'leaf-a')[0]['id'], 'retained-role')
        self.assertEqual(self.endpoint_output(), b'retained-role\nretained-role\n')

    def test_parent_reports_questions_native_outcomes_and_promotion_self_notice_continue(self):
        self.call('report', 'evidence', 'deep-leaf', 'Completed useful work.')
        body = "Review this result with apostrophe ' and unicode λ🙂.\nComplete question.\n"
        question = self.directory / 'question.txt'
        question.write_text(body, encoding='utf-8')
        for verb, ident, sender, recipient in [
                ('ask', 'question', 'deep-leaf', 'deep-lead'),
                ('ask-file', 'child-question-file', 'deep-leaf', 'deep-lead'),
                ('ask', 'principal-question', 'root', 'operator'),
                ('ask-file', 'principal-question-file', 'root', 'operator')]:
            with self.subTest(command=verb, sender=sender):
                row = self.call(verb, ident, sender, str(question) if verb == 'ask-file' else body)
                self.assertEqual((row['sender'], row['recipient'], row['kind'], row['body']),
                                 (sender, recipient, 'question', body))
                self.assertIsNone(row['receipt'])
                self.assertEqual(self.call('delivery', ident)['body'], body)
        self.assertEqual(self.call('delivery', 'evidence')['recipient'], 'deep-lead')
        self.assertEqual(self.call('delivery', 'question')['recipient'], 'deep-lead')
        self.assertEqual({row['id'] for row in self.call('inbox', 'operator')},
                         {'principal-question', 'principal-question-file'})
        self.assertEqual({row['id'] for row in self.call('inbox', 'deep-lead')},
                         {'evidence', 'question', 'child-question-file'})
        self.assertEqual(self.endpoint_output().splitlines(),
                         [b'evidence', b'question', b'child-question-file',
                          b'principal-question', b'principal-question-file'])
        event = self.directory / 'terminal.json'
        event.write_text(json.dumps({'type': 'result', 'result': 'Native completed.'}))
        self.call('observe-file', 'native-result', 'deep-leaf', str(event))
        self.assertEqual(self.call('delivery', 'native-result')['recipient'], 'deep-lead')
        self.call('record', 'finding', 'deep-leaf', 'Useful claim.', 'message:evidence', 'Fixture only.')
        notice = self.call('delivery', 'finding:notice')
        self.assertEqual(notice['recipient'], 'deep-lead')
        self.call('promote', 'shared', 'deep-lead', 'deep-leaf', 'deep-lead', 'finding')
        promotion = self.call('delivery', 'shared:promotion-notice')
        self.assertEqual((promotion['sender'], promotion['recipient']), ('deep-lead', 'deep-lead'))
        self.assertIsNone(promotion['receipt'])


if __name__ == '__main__':
    unittest.main()
