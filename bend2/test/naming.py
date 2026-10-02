"""Exercise canonical naming through the native CLI and retained SQLite state."""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Naming(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.git('init', '-q', '-b', 'main')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'Naming fixture')
        (self.repo / 'seed').write_text('seed\n')
        self.git('add', 'seed')
        self.git('commit', '-q', '-m', 'seed')
        self.base = self.git('rev-parse', 'HEAD').strip()
        self.principal, self.associate, self.player = 'arbitrary / α', 'delegated λ', 'individual Ω'
        for ident in [self.principal, 'other top', 'unassigned top', 'human']:
            self.call('attach', ident, 'fixture', 'native:' + ident, '')
        self.call('role', self.principal, 'conductor')
        self.call('role', 'other top', 'principal-conductor')
        self.call('role', 'human', 'operator')
        self.recruit(self.associate, self.principal, 'associate')
        self.call('role', self.associate, 'conductor')
        self.recruit(self.player, self.associate, 'individual')
        self.recruit('peer', self.associate, 'peer')

    def tearDown(self):
        self.temp.cleanup()

    def git(self, *args, cwd=None):
        run = subprocess.run(['git', '-C', str(cwd or self.repo), *args],
                             text=True, capture_output=True)
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return run.stdout

    def call(self, *args, error=None):
        run = subprocess.run([str(EXE), str(self.db), *args], cwd=self.directory,
                             text=True, capture_output=True)
        if error:
            self.assertEqual(run.returncode, 2, run.stdout + run.stderr)
            self.assertEqual(run.stdout, '')
            row = json.loads(run.stderr)
            self.assertEqual(row['error'], error)
            self.assertTrue(row['condition'])
            self.assertTrue(row['next'])
            return row
        self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
        return json.loads(run.stdout)

    def recruit(self, ident, parent, branch):
        return self.call('recruit', ident, parent, 'fixture', 'model', 'low',
                         str(self.repo), branch, str(self.directory / ('tree ' + branch)), self.base)

    def stored(self):
        with closing(sqlite3.connect(self.db)) as db:
            names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            return {name: db.execute('SELECT * FROM ' + name + ' ORDER BY rowid').fetchall()
                    for name in names}

    def test_players_include_conductors_and_parentless_agents(self):
        players = {row['id']: row for row in self.call('players')}
        self.assertEqual(set(players), {self.principal, 'other top', 'unassigned top',
                                       self.associate, self.player, 'peer'})
        self.assertEqual(players[self.principal]['role'], 'principal-conductor')
        self.assertEqual(players['other top']['role'], 'principal-conductor')
        self.assertEqual(players[self.associate]['role'], 'associate-conductor')
        self.assertEqual(players['unassigned top']['role'], 'player')
        self.assertEqual({row['kind'] for row in players.values()}, {'player'})
        status = {row['id']: row for row in self.call('status')}
        orchestra = {row['id']: row for row in self.call('orchestra')['players']}
        for ident, tier in [(self.principal, 'principal-conductor'),
                            (self.associate, 'associate-conductor')]:
            with self.subTest(ident=ident, tier=tier):
                self.assertEqual(self.call('role', ident)['role'], tier)
                self.assertEqual(self.call('player', ident)['role'], tier)
                self.assertEqual(self.call('session', ident)['role'], tier)
                self.assertEqual(status[ident]['role'], tier)
                self.assertEqual(players[ident]['role'], tier)
                self.assertEqual(orchestra[ident]['role'], tier)
        for ident in players:
            row = self.call('player', ident)
            self.assertEqual(row['native'], players[ident]['native'])
            self.assertEqual(row['role'], players[ident]['role'])
        legacy = self.call('workers')
        self.assertEqual({row['id'] for row in legacy}, {self.associate, self.player, 'peer'})
        self.assertNotIn('role', legacy[0])
        self.assertEqual(self.call('session', 'human')['kind'], 'operator')

    def test_explicit_tiers_refuse_opposite_parentage_without_mutation(self):
        self.assertEqual(self.call('role', self.principal, 'principal-conductor')['role'],
                         'principal-conductor')
        self.assertEqual(self.call('role', self.associate, 'associate-conductor')['role'],
                         'associate-conductor')
        for ident, role in [(self.principal, 'associate-conductor'),
                            (self.associate, 'principal-conductor'),
                            (self.associate, 'operator'), ('missing', 'player'),
                            (self.player, 'unknown')]:
            with self.subTest(ident=ident, role=role):
                before = self.stored()
                self.call('role', ident, role, error='invalid-role')
                self.assertEqual(self.stored(), before)
        with closing(sqlite3.connect(self.db)) as db:
            self.assertEqual(db.execute('SELECT role FROM session_roles WHERE session=?',
                                        (self.associate,)).fetchone()[0], 'conductor')

    def test_sections_use_owner_and_members_of_the_named_ensemble(self):
        for ensemble, owner in [('build', self.principal), ('other', 'other top')]:
            self.call('ensemble', ensemble, owner)
        self.call('ensemble-member', 'build', self.principal, self.player, 'add')
        self.call('ensemble-member', 'other', 'other top', 'peer', 'add')
        self.call('section', 'build', 'review', self.principal, 'validation λ')
        self.call('section', 'other', 'review', 'other top', 'validation λ')
        self.call('section-member', 'build', 'review', self.principal, self.player, 'add')
        self.call('section-member', 'other', 'review', 'other top', 'peer', 'add')
        repeated = self.call('section', 'build', 'review', self.principal, 'validation λ')
        self.assertEqual(repeated['members'], [self.player])
        updated = self.call('section', 'build', 'review', self.principal, 'source review λ')
        self.assertEqual(updated['capability'], 'source review λ')
        self.assertEqual(updated['members'], [self.player])
        for args in [('section', 'build', 'review', 'other top', 'replacement'),
                     ('section', 'build', 'review', self.principal, ''),
                     ('section-member', 'build', 'review', self.principal, 'peer', 'add'),
                     ('section-member', 'build', 'review', 'other top', self.player, 'remove'),
                     ('section-member', 'build', 'missing', self.principal, self.player, 'add'),
                     ('section-member', 'build', 'review', self.principal, self.player, 'unknown')]:
            with self.subTest(args=args):
                before = self.stored()
                self.call(*args, error='section-refused')
                self.assertEqual(self.stored(), before)
        self.call('message', 'retained-member-input', self.principal, self.player, 'task', 'Keep this input λ\n')
        self.call('report', 'retained-member-report', self.player, 'Keep this report λ\n')
        self.call('ack', 'retained-member-report', self.associate, 'accepted report λ')
        messages = self.stored()['messages']
        self.call('ensemble-member', 'build', self.principal, self.player, 'remove')
        self.assertEqual(self.stored()['messages'], messages)
        self.assertEqual(self.call('section', 'build', 'review')['members'], [])
        self.assertEqual(self.call('section', 'other', 'review')['members'], ['peer'])
        self.call('section-member', 'build', 'review', self.principal, self.player, 'remove')
        self.call('ensemble-member', 'build', self.principal, self.player, 'add')
        self.assertEqual(self.call('section', 'build', 'review')['members'], [])

    def test_sections_preserve_existing_message_and_knowledge_rules(self):
        self.call('ensemble', 'team', self.principal)
        self.call('section', 'team', 'review', self.principal, 'review')
        for ident in [self.player, 'peer']:
            self.call('ensemble-member', 'team', self.principal, ident, 'add')
            self.call('section-member', 'team', 'review', self.principal, ident, 'add')
        self.call('report', 'evidence', self.player, 'Complete finding evidence λ\n')
        self.call('record', 'finding', self.player, 'Reviewed finding', 'message:evidence', 'Fixture scope')
        self.assertEqual(self.call('knowledge', 'peer'), [])
        before = self.stored()
        self.call('message', 'denied', self.player, 'peer', 'guidance', 'review',
                  error='message-route-denied')
        self.assertEqual(self.stored(), before)
        self.call('ensemble', 'team', self.principal, 'tight')
        self.call('message', 'accepted', self.player, 'peer', 'guidance', 'review')
        self.call('section-member', 'team', 'review', self.principal, 'peer', 'remove')
        self.call('message', 'still-accepted', self.player, 'peer', 'guidance', 'review')
        self.assertEqual(self.call('knowledge', 'peer'), [])

    def test_orchestra_is_a_read_only_complete_local_snapshot(self):
        self.call('ensemble', 'team', self.principal)
        self.call('ensemble-member', 'team', self.principal, self.player, 'add')
        self.call('section', 'team', 'review', self.principal, 'validation')
        self.call('section-member', 'team', 'review', self.principal, self.player, 'add')
        self.call('message', 'pending', self.principal, self.player, 'task', 'Retained task λ\n')
        before = self.stored()
        row = self.call('orchestra')
        self.assertEqual(self.stored(), before)
        self.assertEqual(row['players'], self.call('players'))
        self.assertEqual([r['id'] for r in row['operators']], ['human'])
        self.assertEqual(row['ensembles'], [self.call('ensemble', 'team')])
        self.assertEqual(row['ensembles'][0]['sections'], [self.call('section', 'team', 'review')])
        player = next(r for r in row['players'] if r['id'] == self.player)
        self.assertEqual(player['pendingCount'], 1)
        self.assertEqual({r['id'] for r in row['players'] if r['role'] == 'principal-conductor'},
                         {self.principal, 'other top'})

    def test_existing_database_identity_messages_turns_and_work_are_preserved(self):
        tree = self.directory / 'tree individual'
        (tree / 'committed').write_text('retained commit λ\n')
        self.git('add', 'committed', cwd=tree)
        self.git('commit', '-q', '-m', 'Retained work', cwd=tree)
        (tree / 'seed').write_text('retained dirty work\n')
        (tree / 'untracked').write_text('retained untracked work\n')
        self.call('bind', self.player, 'native preserved λ', 'fixture', 'observed/model', 'high')
        self.call('message', 'owed', self.principal, self.player, 'task', 'Full pending body λ\n')
        event = self.directory / 'event.json'
        event.write_text(json.dumps({'type': 'result', 'result': 'Full report λ\n'}))
        self.call('observe-file', 'turn preserved', self.player, str(event))
        self.call('ack', 'turn preserved', self.associate, 'native receipt λ')
        # Removing the empty new tables models the previous on-disk schema.
        with closing(sqlite3.connect(self.db)) as db:
            db.execute('DROP TABLE section_members')
            db.execute('DROP TABLE sections')
            db.commit()
        before = self.stored()
        refs = self.git('show-ref')
        work = {p: (tree / p).read_bytes() for p in ['committed', 'seed', 'untracked']}
        self.call('role', self.associate, 'associate-conductor')
        orchestra = self.call('orchestra')
        self.assertTrue(orchestra['players'])
        after = self.stored()
        self.assertEqual({k: after[k] for k in before}, before)
        self.assertEqual(after['sections'], [])
        self.assertEqual(after['section_members'], [])
        self.assertEqual(self.git('show-ref'), refs)
        self.assertEqual({p: (tree / p).read_bytes() for p in work}, work)
        turns = self.call('turns', self.player)
        self.assertEqual(turns[0]['player'], self.player)
        self.assertNotIn('worker', turns[0])
        self.assertEqual(turns[0]['reportBody'], 'Full report λ\n')
        self.assertEqual(turns[0]['receipt'], 'native receipt λ')
        self.assertEqual(self.call('player', self.player)['native'], 'native preserved λ')
        self.assertEqual(self.call('inbox', self.player)[0]['body'], 'Full pending body λ\n')


if __name__ == '__main__':
    unittest.main()
