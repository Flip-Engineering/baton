"""Exercise the shared knowledge workflow with separate native processes.

A producer records an evidence-backed finding and its parent is notified with an
ordinary message; the findings a reader may see follow the declared scope; a
promotion names the scope it is drawn from and only the destination scope's
owner may perform it. Every call below is its own process, so a consumer that
reads after the producer exited is the same read a restarted consumer makes.
"""
import json
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Knowledge(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Knowledge fixture']):
            subprocess.run(argv, check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-test', 'root-session', 'native-endpoint')
        self.worker('worker')
        self.worker('grand', parent='worker')
        self.worker('sibling')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args, success=True):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0, p.stdout)
        return p

    def worker(self, name, parent='root'):
        return self.call('recruit', name, parent, 'requested-harness', 'requested-model', 'high',
                         str(self.repo), name + '-branch', str(self.checkouts / name), self.base)

    def evidence(self, ident, who):
        """A retained report the given session is a party to, as an evidence reference."""
        self.call('report', ident, who, 'evidence body')
        return 'message:' + ident

    def read(self, reader):
        return self.call('knowledge', reader)

    def ids(self, rows):
        return sorted(row['id'] for row in rows)

    def test_a_finding_reaches_its_author_and_parent_and_no_further(self):
        recorded = self.call('record', 'finding-1', 'worker', 'the cache is warm',
                             self.evidence('report-1', 'worker'), 'one host, one load')
        self.assertEqual(recorded['author'], 'worker')
        self.assertEqual(recorded['claim'], 'the cache is warm')
        self.assertEqual(recorded['evidence'], 'message:report-1')
        self.assertEqual(recorded['limits'], 'one host, one load')
        self.assertEqual(self.ids(self.read('worker')), ['finding-1'])
        self.assertEqual(self.ids(self.read('root')), ['finding-1'])
        self.assertEqual(self.read('grand'), [])
        self.assertEqual(self.read('sibling'), [])
        notices = [m for m in self.call('inbox', 'root') if m['kind'] == 'question']
        self.assertEqual([m['id'] for m in notices], ['finding-1:notice'])
        body = json.loads(notices[0]['body'])
        self.assertEqual(body, {'finding': 'finding-1', 'author': 'worker'})
        seen = self.read('worker')[0]
        self.assertEqual(seen['evidenceMessage'],
                         {'id': 'report-1', 'sender': 'worker', 'recipient': 'root',
                          'body': 'evidence body'})

    def test_a_consumer_started_after_the_producer_reads_the_same_finding(self):
        self.call('record', 'finding-2', 'worker', 'the queue drains at ten a second',
                  self.evidence('report-7', 'worker'), 'single runner')
        sqlite = sqlite3.connect(self.db)
        stored = sqlite.execute('SELECT id, author, claim, evidence, limits FROM knowledge').fetchall()
        sqlite.close()
        self.assertEqual(stored, [('finding-2', 'worker', 'the queue drains at ten a second',
                                   'message:report-7', 'single runner')])
        for _ in range(2):
            seen = self.read('root')
            self.assertEqual(self.ids(seen), ['finding-2'])
            self.assertEqual(seen[0]['destinations'], [])
            self.assertEqual(seen[0]['promotions'], [])

    def test_promotion_is_explicit_and_only_the_destination_owner_promotes(self):
        self.call('record', 'finding-3', 'grand', 'the retry doubles the work',
                  self.evidence('report-2', 'grand'), 'one worker')
        self.assertEqual(self.ids(self.read('worker')), ['finding-3'])
        self.assertEqual(self.read('root'), [])
        refused = self.call('promote', 'promotion-1', 'root', 'grand', 'root', 'finding-3', success=False)
        self.assertIn('No knowledge row was written', refused.stderr)
        promoted = self.call('promote', 'promotion-1', 'worker', 'grand', 'worker', 'finding-3')
        self.assertEqual(promoted, {'id': 'promotion-1', 'finding': 'finding-3', 'author': 'grand',
                                    'source': 'grand', 'destination': 'worker', 'promotedBy': 'worker'})
        seen = self.read('grand')
        self.assertEqual(seen[0]['destinations'], ['worker'])
        self.assertEqual(seen[0]['promotions'],
                         [{'finding': 'finding-3', 'author': 'grand', 'source': 'grand',
                           'destination': 'worker', 'promotedBy': 'worker'}])
        self.assertEqual(self.ids(self.read('root')), ['finding-3'])
        self.assertEqual(self.read('sibling'), [])

    def test_a_higher_parent_reshapes_a_finding_from_its_childs_shared_scope(self):
        self.call('record', 'finding-6', 'grand', 'the lock is held for a second',
                  self.evidence('report-3', 'grand'), 'one host')
        self.call('promote', 'promotion-4', 'worker', 'grand', 'worker', 'finding-6')
        reshaped = self.call('promote', 'promotion-5', 'root', 'worker', 'root', 'finding-6')
        self.assertEqual(reshaped, {'id': 'promotion-5', 'finding': 'finding-6', 'author': 'grand',
                                    'source': 'worker', 'destination': 'root', 'promotedBy': 'root'})
        seen = self.read('root')
        self.assertEqual(sorted(seen[0]['destinations']), ['root', 'worker'])
        self.assertEqual([p['source'] for p in seen[0]['promotions']], ['grand', 'worker'])
        self.assertEqual([p['author'] for p in seen[0]['promotions']], ['grand', 'grand'])
        self.assertEqual([p['promotedBy'] for p in seen[0]['promotions']], ['worker', 'root'])
        wrong_source = self.call('promote', 'promotion-6', 'root', 'grand', 'root', 'finding-6',
                                 success=False)
        self.assertIn('No knowledge row was written', wrong_source.stderr)

    def test_a_reader_outside_the_scope_sees_nothing_and_promotes_nothing(self):
        self.call('record', 'finding-4', 'worker', 'the lock is held',
                  self.evidence('report-4', 'worker'), 'one host')
        self.assertEqual(self.read('sibling'), [])
        refused = self.call('promote', 'promotion-2', 'sibling', 'worker', 'sibling', 'finding-4',
                            success=False)
        self.assertIn('No knowledge row was written', refused.stderr)
        self.assertEqual(self.read('sibling'), [])
        self.assertEqual(self.ids(self.read('worker')), ['finding-4'])

    def test_evidence_must_name_an_existing_message_the_author_is_party_to(self):
        refused = self.call('record', 'finding-7', 'worker', 'claim', 'the run said so', 'limits',
                            success=False)
        self.assertIn('No knowledge row was written', refused.stderr)
        self.call('record', 'finding-7', 'worker', 'claim', 'message:no-such-message', 'limits',
                  success=False)
        self.call('record', 'finding-7', 'sibling', 'claim', self.evidence('report-5', 'worker'),
                  'limits', success=False)
        self.call('record', 'finding-7', 'worker', 'claim', 'git:' + self.base, 'limits',
                  success=False)
        self.assertEqual(self.read('worker'), [])
        recorded = self.call('record', 'finding-7', 'worker', 'claim',
                             self.evidence('report-8', 'worker'), 'limits')
        self.assertEqual(recorded['evidence'], 'message:report-8')
        seen = self.read('worker')[0]
        self.assertEqual(seen['evidenceMessage']['body'], 'evidence body')
        self.assertEqual(seen['evidenceMessage']['recipient'], 'root')

    def test_repeated_ids_answer_the_stored_row_and_changed_content_refuses(self):
        evidence = self.evidence('report-6', 'worker')
        first = self.call('record', 'finding-5', 'worker', 'a', evidence, 'c')
        self.assertEqual(self.call('record', 'finding-5', 'worker', 'a', evidence, 'c'), first)
        self.call('record', 'finding-5', 'worker', 'changed', evidence, 'c', success=False)
        self.assertEqual(self.ids(self.read('worker')), ['finding-5'])
        self.assertEqual(self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-5'),
                         self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-5'))
        self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-1', success=False)

    def test_a_mismatched_evidence_repeat_is_refused_and_keeps_the_stored_row(self):
        evidence = self.evidence('report-9', 'worker')
        self.call('record', 'finding-8', 'worker', 'a', evidence, 'c')
        notices = [m['id'] for m in self.call('inbox', 'root') if m['kind'] == 'question']
        self.assertEqual(notices, ['finding-8:notice'])
        # An existing id repeated with the same author, claim and limits but an
        # evidence the author cannot cite is refused, not answered with the
        # stored row and not redelivered.
        absent = self.call('record', 'finding-8', 'worker', 'a', 'message:absent', 'c', success=False)
        self.assertIn('No knowledge row was written', absent.stderr)
        unrelated = self.call('record', 'finding-8', 'worker', 'a',
                              self.evidence('report-10', 'sibling'), 'c', success=False)
        self.assertIn('No knowledge row was written', unrelated.stderr)
        after = [m['id'] for m in self.call('inbox', 'root') if m['kind'] == 'question']
        self.assertEqual(after, notices)
        stored = self.read('worker')
        self.assertEqual(self.ids(stored), ['finding-8'])
        self.assertEqual(stored[0]['evidence'], evidence)
        repeated = self.call('record', 'finding-8', 'worker', 'a', evidence, 'c')
        self.assertEqual((repeated['id'], repeated['evidence']), ('finding-8', evidence))

    def test_the_usage_names_the_three_knowledge_verbs(self):
        p = self.call('nonsense-verb', success=False)
        for verb in ('record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS', 'knowledge READER',
                     'promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING'):
            self.assertIn(verb, p.stderr)


if __name__ == '__main__':
    unittest.main()
