"""Exercise the shared knowledge workflow with separate native processes.

A producer records an evidence-backed finding and its parent is notified with an
ordinary message. Every registered session reads the shared finding and its
provenance; only a registered destination owner may promote from the author or
a destination recorded for that finding. Every call below is its own process.
"""
import json
import pathlib
import sqlite3
import subprocess
import sys
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
        self.call('role', 'root', 'principal-conductor')
        self.player('worker')
        self.player('grand', parent='worker')
        self.player('sibling')

    def tearDown(self):
        self.temp.cleanup()

    def call(self, *args, success=True):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        if success:
            self.assertEqual(p.returncode, 0, p.stderr)
            return json.loads(p.stdout)
        self.assertNotEqual(p.returncode, 0, p.stdout)
        return p

    def player(self, name, parent='root'):
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

    def scoped(self, scope, subject=''):
        return self.call('knowledge-scope', 'root', scope, subject)

    def test_typed_evidence_and_corrections_follow_explicit_shared_holdings(self):
        self.call('role', 'worker', 'associate-conductor')
        self.call('ensemble', 'review-group', 'worker', 'tight')
        self.call('ensemble-member', 'review-group', 'worker', 'grand', 'add')
        observed = self.evidence('quota-observed', 'grand')
        corrected = self.evidence('quota-corrected', 'grand')
        self.call('record-typed', 'quota-observation', 'grand', 'observation',
                  'The provider ended with a quota error.', observed, 'One retained turn.')
        self.call('record-typed', 'quota-correction', 'grand', 'correction',
                  'Process exit zero does not describe the retained provider error.',
                  corrected, 'The observed provider response.')
        self.call('relate', 'quota-support', 'grand', observed, 'Supports',
                  'finding:quota-observation')
        relation = self.call('relate', 'quota-supersedes', 'grand',
                             'finding:quota-correction', 'Supersedes',
                             'finding:quota-observation')
        self.assertEqual(relation['relation'], 'Supersedes')
        local = {row['id']: row for row in self.scoped('worker', 'grand')}
        self.assertEqual(local['quota-correction']['kind'], 'correction')
        self.assertEqual(local['quota-observation']['evidenceMessage']['id'], 'quota-observed')
        self.assertEqual({row['id'] for row in local['quota-observation']['relations']},
                         {'quota-support', 'quota-supersedes'})
        self.assertEqual(self.scoped('group', 'review-group'), [])
        self.assertEqual(self.scoped('universal'), [])
        self.call('promote', 'quota-to-worker', 'worker', 'grand', 'worker', 'quota-observation')
        self.assertEqual(self.scoped('group', 'review-group'), [])
        self.call('promote-scoped', 'quota-to-group', 'worker', 'session', 'grand',
                  'group', 'review-group', 'quota-observation')
        self.assertEqual(self.ids(self.scoped('group', 'review-group')), ['quota-observation'])
        self.assertEqual(self.ids(self.call('knowledge-relations', 'root', 'group', 'review-group')),
                         ['quota-support', 'quota-supersedes'])
        self.assertEqual(self.scoped('universal'), [])
        self.call('promote', 'quota-to-root', 'root', 'worker', 'root', 'quota-observation')
        self.assertEqual(self.ids(self.scoped('universal')), ['quota-observation'])
        self.assertEqual(self.ids(self.scoped('all')), ['quota-correction', 'quota-observation'])
        self.assertEqual(self.ids(self.read('root')), ['quota-correction', 'quota-observation'])

    def test_groups_have_independent_holdings_and_typed_promotion_provenance(self):
        self.call('ensemble', 'worker', 'root', 'tight')
        self.call('ensemble', 'second-group', 'root', 'loose')
        self.call('record', 'owner-local', 'root', 'Owner finding', 'run:owner', 'One run')
        self.call('record', 'alpha', 'grand', 'First finding', 'run:alpha', 'One run')
        self.call('record', 'beta', 'grand', 'Second finding', 'run:beta', 'One run')
        shared = self.call('promote-scoped', 'alpha-group', 'root', 'session', 'grand',
                           'group', 'worker', 'alpha')
        self.call('promote-scoped', 'beta-group', 'root', 'session', 'grand',
                  'group', 'second-group', 'beta')
        self.assertEqual((shared['sourceKind'], shared['destinationKind']), ('session', 'group'))
        self.assertEqual(shared['destination'], 'worker')
        self.assertEqual(self.ids(self.scoped('group', 'worker')), ['alpha'])
        self.assertEqual(self.ids(self.scoped('group', 'second-group')), ['beta'])
        self.assertEqual(self.scoped('worker', 'worker'), [])
        self.assertEqual(self.ids(self.scoped('universal')), ['owner-local'])
        conflict = self.call('promote-scoped', 'alpha-group', 'root', 'session', 'grand',
                             'session', 'root', 'alpha', success=False)
        self.assertIn('promotion-id-conflict', conflict.stderr)
        self.assertEqual(self.ids(self.scoped('universal')), ['owner-local'])
        notice = self.call('delivery', 'alpha-group:promotion-notice')
        self.assertEqual(notice['recipient'], 'root')
        self.assertEqual(json.loads(notice['body'])['destinationKind'], 'group')
        self.assertEqual(self.scoped('group', 'worker')[0]['promotions'][0]['destinationKind'], 'group')
        index = self.call('knowledge-scope', 'root', 'group', 'worker', '--index')
        self.assertEqual(self.ids(index), ['alpha'])
        self.assertEqual(self.ids(self.call(*index[0]['detailRead'])), ['alpha'])

        # The session and Ensemble named worker retain separate holdings.
        self.call('promote', 'beta-session', 'worker', 'grand', 'worker', 'beta')
        self.assertEqual(self.ids(self.scoped('worker', 'worker')), ['beta'])
        self.assertEqual(self.ids(self.scoped('group', 'worker')), ['alpha'])
        promoted = self.call('promote-scoped', 'alpha-root', 'root', 'group', 'worker',
                             'session', 'root', 'alpha')
        self.assertEqual((promoted['sourceKind'], promoted['destinationKind']), ('group', 'session'))
        self.assertEqual(self.ids(self.scoped('universal')), ['alpha', 'owner-local'])
        self.assertEqual(self.ids(self.scoped('group', 'second-group')), ['beta'])
        with sqlite3.connect(self.db) as db:
            affected = {row[0] for row in db.execute(
                "SELECT session_id FROM native_changes WHERE entity='promotion' AND entity_id='alpha' AND operation='insert'")}
        self.assertIn('root', affected)
        self.assertNotIn('worker', affected)

    def test_causal_records_search_evidence_and_traverse_scoped_cycles(self):
        source = "retained evidence ' λ"
        self.call('report', source, 'grand', 'The measured process recovered after reconnect.')
        self.call('record-typed', 'measurement', 'grand', 'evidence',
                  'Observed recovery', 'message:' + source, 'One process')
        links = [{'id': 'supports-hypothesis', 'source': 'finding:measurement',
                  'relation': 'Supports', 'target': 'finding:hypothesis'}]
        self.call('record-linked', 'hypothesis', 'grand', 'hypothesis',
                  'Reconnect permits recovery', 'message:' + source, 'Needs another run',
                  json.dumps(links))
        self.call('record-linked', 'decision', 'grand', 'decision',
                  'Continue the original process', 'finding:hypothesis', 'This observed fault',
                  json.dumps([{'id': 'informs-decision', 'source': 'finding:hypothesis',
                               'relation': 'Informed', 'target': 'finding:decision'},
                              {'id': 'cycle', 'source': 'finding:decision',
                               'relation': 'Related', 'target': 'finding:measurement'}]))
        self.call('record-typed', 'unheld', 'sibling', 'hypothesis',
                  'Reconnect permits unrelated recovery', 'run:other', 'Another worker')
        found = self.call('knowledge-search', 'root', 'worker', 'grand', 'measured reconnect')
        self.assertEqual({r['id'] for r in found['matches']}, {'measurement', 'hypothesis'})
        self.assertNotIn('unheld', {r['id'] for r in found['nodes']})
        self.assertEqual(found['matches'][0]['evidenceMessage']['body'],
                         'The measured process recovered after reconnect.')
        for node in found['nodes']:
            self.assertEqual(node['reference'], 'finding:' + node['id'])
            self.assertEqual(self.call(*node['detailRead'])[0]['id'], node['id'])
        incoming = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                             'hypothesis', 'in', 'supports', 'neighbors')
        self.assertEqual({edge['id'] for edge in incoming['edges']}, {'supports-hypothesis'})
        self.assertEqual({r['kind'] for r in incoming['nodes']}, {'evidence', 'hypothesis'})
        self.assertEqual(incoming['edges'][0]['sourceKind'], 'evidence')
        self.assertEqual(incoming['edges'][0]['targetKind'], 'hypothesis')
        full = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                         'finding:decision', 'both', '', 'recursive')
        self.assertEqual({r['id'] for r in full['nodes']}, {'measurement', 'hypothesis', 'decision'})
        self.assertIn('message:' + source, full['roots'])
        evidence = next(r for r in full['references'] if r['reference'] == 'message:' + source)
        self.assertEqual(self.call(*evidence['deliveryRead'])['body'],
                         'The measured process recovered after reconnect.')
        self.assertEqual(self.call('knowledge-search', 'root', 'universal', '', 'recovery')['matches'], [])
        self.call('promote', 'share-hypothesis', 'root', 'grand', 'root', 'hypothesis')
        shared = self.call('knowledge-search', 'root', 'universal', '', 'reconnect')
        self.assertEqual({r['id'] for r in shared['matches']}, {'hypothesis'})
        self.assertEqual({r['id'] for r in shared['nodes']}, {'hypothesis'})
        outside = {r['reference']: r['kind'] for r in shared['references']}
        self.assertEqual(outside['finding:measurement'], 'evidence')
        self.assertEqual(outside['finding:decision'], 'decision')

    def test_linked_record_failure_rolls_back_record_links_and_parent_notice(self):
        malformed = [{'id': 'broken', 'source': 'finding:new', 'relation': 'Supports'}]
        self.call('record-linked', 'new', 'grand', 'hypothesis', 'Proposed explanation',
                  'run:observation', 'Not evaluated', json.dumps(malformed), success=False)
        self.assertEqual(self.read('root'), [])
        self.assertEqual(self.call('knowledge-relations', 'root', 'all', ''), [])
        self.assertEqual(self.call('inbox', 'worker'), [])

    def test_legacy_promotions_remain_session_holdings_before_and_after_migration(self):
        self.call('ensemble', 'review-group', 'worker')
        self.call('record', 'legacy-share', 'grand', 'Legacy finding', 'run:legacy', 'One run')
        original = self.call('promote', 'legacy-promotion', 'worker', 'grand', 'worker', 'legacy-share')
        with sqlite3.connect(self.db) as db:
            db.execute('CREATE TABLE old_promotions (id TEXT UNIQUE NOT NULL,finding TEXT NOT NULL,'
                       'author TEXT NOT NULL,source TEXT NOT NULL,destination TEXT NOT NULL,promoted_by TEXT NOT NULL)')
            db.execute('INSERT INTO old_promotions SELECT id,finding,author,source,destination,promoted_by FROM knowledge_promotions')
            db.execute('DROP TABLE knowledge_promotions')
            db.execute('ALTER TABLE old_promotions RENAME TO knowledge_promotions')
        self.assertEqual(self.ids(self.scoped('worker', 'worker')), ['legacy-share'])
        self.assertEqual(self.scoped('group', 'review-group'), [])
        with sqlite3.connect(self.db) as db:
            self.assertNotIn('destination_kind', {row[1] for row in db.execute('PRAGMA table_info(knowledge_promotions)')})
        self.assertEqual(self.call('promote', 'legacy-promotion', 'worker', 'grand', 'worker', 'legacy-share'), original)
        self.call('promote-scoped', 'new-group-promotion', 'worker', 'session', 'worker',
                  'group', 'review-group', 'legacy-share')
        self.assertEqual(self.ids(self.scoped('group', 'review-group')), ['legacy-share'])
        with sqlite3.connect(self.db) as db:
            self.assertEqual(db.execute(
                "SELECT source_kind,destination_kind FROM knowledge_promotions WHERE id='legacy-promotion'").fetchone(),
                ('session', 'session'))

    def test_relationship_discovery_includes_links_without_a_finding_endpoint(self):
        first = self.evidence("first report ' λ", 'grand')
        later = self.evidence('later report λ', 'grand')
        message_link = self.call('relate', 'report-correction', 'grand', later,
                                 'Supersedes', first)
        external_link = self.call('relate', 'source-result', 'grand', 'file:source λ',
                                  'Causes', 'run:result λ')
        self.call('relate', 'root-link', 'root', 'external:observation',
                  'DerivedFrom', 'external:source')
        self.call('ensemble', 'review-group', 'worker')
        self.call('relate', 'group-link', 'worker', 'message:group-a',
                  'Supports', 'message:group-b')

        own = self.call('knowledge-relations', 'grand')
        self.assertEqual(own, [message_link, external_link])
        self.assertEqual(self.call('knowledge-relations', 'grand', '--pretty'), own)
        self.assertEqual((own[0]['source'], own[0]['relation'], own[0]['target']),
                         (later, 'Supersedes', first))
        self.assertEqual(self.call('knowledge-relations', 'root', 'group', 'review-group'), [])
        self.assertEqual(self.ids(self.call('knowledge-relations', 'root', 'universal', '')),
                         ['root-link'])
        all_links = self.call('knowledge-relations', 'root', 'all', '')
        self.assertEqual(self.ids(all_links),
                         ['group-link', 'report-correction', 'root-link', 'source-result'])
        self.assertEqual(self.call('knowledge-relations', 'root', 'all', '', '--pretty'),
                         all_links)
        self.assertEqual(self.read('root'), [])

    def test_metadata_navigation_reads_exact_findings_and_evidence_in_the_same_scope(self):
        finding = "finding ' λ"
        message = "evidence ' λ"
        claim = 'Observed claim\n日本語'
        limits = 'One retained fixture.\nλ'
        self.call('report', message, 'grand', 'complete evidence\nλ')
        self.call('record-typed', finding, 'grand', 'observation', claim,
                  'message:' + message, limits)

        index = self.call('knowledge', 'root', '--index')
        row = next(item for item in index if item['id'] == finding)
        self.assertEqual(self.call('knowledge', 'root', '--index', '--pretty'), index)
        self.assertNotIn('claim', row)
        self.assertNotIn('limits', row)
        self.assertNotIn('body', row['evidenceMessage'])
        self.assertEqual(row['kind'], 'observation')
        self.assertEqual(row['claimBytes'], len(claim.encode()))
        self.assertEqual(row['limitsBytes'], len(limits.encode()))
        self.assertEqual(row['evidenceMessage']['id'], message)
        self.assertEqual(row['evidenceMessage']['bodyBytes'], len('complete evidence\nλ'.encode()))
        self.assertEqual(row['evidenceMessage']['deliveryRead'], ['delivery', message])
        self.assertEqual(row['detailRead'], ['knowledge', 'root', '--id', finding])

        complete = self.call(*row['detailRead'])
        self.assertEqual(self.call(*row['detailRead'], '--pretty'), complete)
        self.assertEqual(len(complete), 1)
        self.assertEqual(complete[0]['claim'], claim)
        self.assertEqual(complete[0]['limits'], limits)
        self.assertEqual(complete[0]['evidenceMessage']['body'], 'complete evidence\nλ')
        self.assertEqual(self.call(*row['evidenceMessage']['deliveryRead'])['body'],
                         'complete evidence\nλ')
        self.assertEqual(self.call('knowledge', 'root', '--id', 'absent'), [])

        scoped = self.call('knowledge-scope', 'root', 'worker', 'grand', '--index')
        scoped_row = next(item for item in scoped if item['id'] == finding)
        self.assertEqual(scoped_row['detailRead'],
                         ['knowledge-scope', 'root', 'worker', 'grand', '--id', finding])
        self.assertEqual(self.call(*scoped_row['detailRead']), complete)
        self.assertEqual(self.call(*scoped_row['detailRead'], '--pretty'), complete)

    def test_an_existing_knowledge_table_keeps_its_findings_when_typed_records_are_written(self):
        with sqlite3.connect(self.db) as db:
            db.execute('DROP TABLE knowledge')
            db.execute('DROP TABLE knowledge_relations')
            db.execute('CREATE TABLE knowledge (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,'
                       'claim TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL)')
            db.execute("INSERT INTO knowledge VALUES ('legacy','root','Recorded claim','run:legacy','One run')")
        legacy = self.read('root')[0]
        self.assertEqual((legacy['id'], legacy['kind'], legacy['relations']),
                         ('legacy', 'finding', []))
        self.assertEqual(self.call('knowledge-relations', 'root'), [])
        with sqlite3.connect(self.db) as db:
            self.assertIsNone(db.execute("SELECT name FROM sqlite_master WHERE name='knowledge_relations'").fetchone())
        self.call('record-typed', 'new-observation', 'root', 'observation',
                  'New recorded observation', 'run:new', 'One run')
        migrated = {row['id']: row for row in self.read('root')}
        self.assertEqual(migrated['legacy']['claim'], 'Recorded claim')
        self.assertEqual(migrated['legacy']['kind'], 'finding')
        self.assertEqual(migrated['new-observation']['kind'], 'observation')

    def test_legacy_findings_with_retained_relations_support_search_and_traversal(self):
        with sqlite3.connect(self.db) as db:
            db.execute('DROP TABLE knowledge')
            db.execute('CREATE TABLE knowledge (id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,'
                       'claim TEXT NOT NULL,evidence TEXT NOT NULL,limits TEXT NOT NULL)')
            db.execute("INSERT INTO knowledge VALUES ('legacy','root','Recorded claim','run:legacy','One run')")
            db.execute("INSERT INTO knowledge_relations VALUES ('retained','root','finding:legacy','Supports','message:source')")
        relation = self.call('knowledge-relations', 'root')[0]
        self.assertEqual((relation['sourceKind'], relation['targetKind']), ('finding', 'message'))
        found = self.call('knowledge-search', 'root', 'universal', '', 'Recorded claim')
        self.assertEqual(found['matches'][0]['kind'], 'finding')
        linked = self.call('knowledge-traverse', 'root', 'universal', '',
                           'legacy', 'out', 'supports', 'recursive')
        self.assertEqual(linked['edges'], [{**relation, 'provenance': 'authored'}])
        self.assertEqual(linked['references'][0]['deliveryRead'], ['delivery', 'source'])
        with sqlite3.connect(self.db) as db:
            self.assertNotIn('kind', {row[1] for row in db.execute('PRAGMA table_info(knowledge)')})

    def test_a_finding_is_readable_by_every_registered_session(self):
        recorded = self.call('record', 'finding-1', 'worker', 'the cache is warm',
                             self.evidence('report-1', 'worker'), 'one host, one load')
        self.assertEqual(recorded['author'], 'worker')
        self.assertEqual(recorded['claim'], 'the cache is warm')
        self.assertEqual(recorded['evidence'], 'message:report-1')
        self.assertEqual(recorded['limits'], 'one host, one load')
        self.assertEqual(self.ids(self.read('worker')), ['finding-1'])
        self.assertEqual(self.ids(self.read('root')), ['finding-1'])
        self.assertEqual(self.ids(self.read('grand')), ['finding-1'])
        self.assertEqual(self.ids(self.read('sibling')), ['finding-1'])
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
        self.assertEqual(self.ids(self.read('root')), ['finding-3'])
        refused = self.call('promote', 'promotion-1', 'root', 'grand', 'worker', 'finding-3', success=False)
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
        self.assertEqual(self.ids(self.read('sibling')), ['finding-3'])

    def test_another_destination_owner_promotes_from_a_recorded_destination(self):
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
        wrong_source = self.call('promote', 'promotion-6', 'root', 'sibling', 'root', 'finding-6',
                                 success=False)
        self.assertIn('No knowledge row was written', wrong_source.stderr)

    def test_any_registered_destination_owner_can_promote_from_actual_provenance(self):
        self.call('record', 'finding-4', 'worker', 'the lock is held',
                  self.evidence('report-4', 'worker'), 'one host')
        self.assertEqual(self.ids(self.read('sibling')), ['finding-4'])
        promoted = self.call('promote', 'promotion-2', 'sibling', 'worker', 'sibling', 'finding-4')
        self.assertEqual(promoted['source'], 'worker')
        self.assertEqual(promoted['destination'], 'sibling')
        self.assertEqual(self.ids(self.read('grand')), ['finding-4'])
        self.assertEqual(self.read('missing-reader'), [])
        fabricated = self.call('promote', 'promotion-7', 'sibling', 'root', 'sibling', 'finding-4',
                               success=False)
        self.assertIn('No knowledge row was written', fabricated.stderr)

    def test_findings_accept_source_references_and_include_message_content(self):
        shared = self.evidence('shared-report', 'sibling')
        references = ['the run said so', 'git:' + self.base,
                      str(self.repo / 'seed.txt'), 'message:no-such-message', shared]
        for index, reference in enumerate(references):
            ident = 'finding-reference-' + str(index)
            recorded = self.call('record', ident, 'worker', 'claim', reference, 'limits')
            self.assertEqual(recorded['evidence'], reference)
        seen = {row['evidence']: row for row in self.read('worker')}
        for reference in references[:-1]:
            self.assertIsNone(seen[reference]['evidenceMessage'])
        self.assertEqual(seen[shared]['evidenceMessage'], {
            'id': 'shared-report', 'sender': 'sibling', 'recipient': 'root',
            'body': 'evidence body'})

    def test_repeated_ids_answer_the_stored_row_and_changed_content_refuses(self):
        evidence = self.evidence('report-6', 'worker')
        first = self.call('record', 'finding-5', 'worker', 'a', evidence, 'c')
        self.assertEqual(self.call('record', 'finding-5', 'worker', 'a', evidence, 'c'), first)
        changed = self.call('record', 'finding-5', 'worker', 'changed', evidence, 'c',
                            success=False)
        self.assertIn('finding-id-conflict', changed.stderr)
        self.assertEqual(self.ids(self.read('worker')), ['finding-5'])
        self.assertEqual(self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-5'),
                         self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-5'))
        self.call('record', 'finding-6', 'worker', 'b', self.evidence('report-7', 'worker'), 'c')
        reused = self.call('promote', 'promotion-3', 'root', 'worker', 'root', 'finding-6',
                           success=False)
        self.assertIn('promotion-id-conflict', reused.stderr)

    def test_a_mismatched_evidence_repeat_is_refused_and_keeps_the_stored_row(self):
        evidence = self.evidence('report-9', 'worker')
        self.call('record', 'finding-8', 'worker', 'a', evidence, 'c')
        notices = [m['id'] for m in self.call('inbox', 'root') if m['kind'] == 'question']
        self.assertEqual(notices, ['finding-8:notice'])
        # Reusing a finding ID with different content preserves the original row
        # and does not deliver another notice.
        absent = self.call('record', 'finding-8', 'worker', 'a', 'message:absent', 'c', success=False)
        unrelated = self.call('record', 'finding-8', 'worker', 'a',
                              self.evidence('report-10', 'sibling'), 'c', success=False)
        self.assertIn('finding-id-conflict', absent.stderr)
        self.assertIn('finding-id-conflict', unrelated.stderr)
        after = [m['id'] for m in self.call('inbox', 'root') if m['kind'] == 'question']
        self.assertEqual(after, notices)
        stored = self.read('worker')
        self.assertEqual(self.ids(stored), ['finding-8'])
        self.assertEqual(stored[0]['evidence'], evidence)
        repeated = self.call('record', 'finding-8', 'worker', 'a', evidence, 'c')
        self.assertEqual((repeated['id'], repeated['evidence']), ('finding-8', evidence))

    def test_a_changed_content_repeat_keeps_the_stored_kind(self):
        evidence = self.evidence('report-typed', 'worker')
        self.call('record-typed', 'typed-1', 'worker', 'question', 'a', evidence, 'c')
        refused = self.call('record-typed', 'typed-1', 'worker', 'answer', 'changed',
                            evidence, 'c', success=False)
        self.assertIn('finding-id-conflict', refused.stderr)
        stored = self.read('worker')
        self.assertEqual(self.ids(stored), ['typed-1'])
        self.assertEqual((stored[0]['kind'], stored[0]['claim']), ('question', 'a'))
        # A repeat that matches the stored finding still changes its kind.
        self.call('record-typed', 'typed-1', 'worker', 'answer', 'a', evidence, 'c')
        self.assertEqual(self.read('worker')[0]['kind'], 'answer')

    def test_the_usage_names_knowledge_commands(self):
        p = self.call('nonsense-verb', success=False)
        for verb in ('record FINDING_ID AUTHOR CLAIM EVIDENCE LIMITS', 'knowledge READER',
                     'record-typed FINDING_ID AUTHOR KIND CLAIM EVIDENCE LIMITS',
                     'relate RELATION_ID AUTHOR SOURCE RELATION TARGET',
                     'knowledge-scope READER universal|worker|group|all SUBJECT',
                     'promote PROMOTION_ID PROMOTER SOURCE DESTINATION FINDING',
                     'promote-scoped PROMOTION_ID PROMOTER SOURCE_KIND SOURCE DESTINATION_KIND DESTINATION FINDING'):
            self.assertIn(verb, p.stderr)

    def test_a_refused_record_retry_leaves_parent_endpoint_delivery_unchanged(self):
        evidence = self.evidence('endpoint-evidence', 'worker')
        unrelated = self.evidence('endpoint-unrelated', 'sibling')
        deliveries = pathlib.Path(self.temp.name) / 'deliveries.txt'
        endpoint = pathlib.Path(self.temp.name) / 'endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            'with pathlib.Path(sys.argv[1]).open("a") as stream:\n'
                            '    stream.write(sys.argv[2] + "\\n")\n')
        self.call('connect', 'root', 'root-session',
                  json.dumps([sys.executable, str(endpoint), str(deliveries)]))
        record = ('record', 'endpoint-finding', 'worker', 'claim', evidence, 'limits')
        first = self.call(*record)
        before = deliveries.read_text()
        self.assertEqual(before, 'endpoint-finding:notice\n')
        for bad_evidence in ('message:absent', unrelated):
            self.call('record', 'endpoint-finding', 'worker', 'claim', bad_evidence,
                      'limits', success=False)
            self.assertEqual(deliveries.read_text(), before)
        self.assertEqual(self.call(*record), first)
        self.assertEqual(deliveries.read_text(), before + before)

    def test_a_stopped_reviewing_parent_retains_the_notice_and_notifies_its_parent(self):
        self.call('connect', 'root', 'root-session', json.dumps(['/usr/bin/true']))
        self.call('recruit', 'reviewer', 'root', 'omp', 'fixture-model', 'high',
                  str(self.repo), 'reviewer-branch', str(self.checkouts / 'reviewer'), self.base)
        self.player('researcher', parent='reviewer')
        evidence = self.evidence('retained-check', 'researcher')
        self.call('stop', 'reviewer', 'end-review', 'Reviewing session ended.')
        finding = ('record', 'handoff-finding', 'researcher', 'measured claim', evidence, 'fixture')
        recorded = self.call(*finding)
        self.assertEqual(self.call(*finding), recorded)
        self.assertEqual(self.ids(self.read('reviewer')), ['handoff-finding'])
        self.assertEqual(self.ids(self.read('root')), ['handoff-finding'])
        notice = self.call('delivery', 'handoff-finding:notice')
        self.assertEqual(notice['recipient'], 'reviewer')
        self.assertIsNone(notice['receipt'])
        body = {'finding': 'handoff-finding', 'author': 'researcher'}
        self.assertEqual(json.loads(notice['body']), body)
        handoffs = [json.loads(row['body']) for row in self.call('inbox', 'root')
                    if row['kind'] == 'report']
        matches = [row for row in handoffs if row.get('originalMessage') == 'handoff-finding:notice']
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]['originalKind'], 'question')
        self.assertEqual(json.loads(matches[0]['originalBody']), body)
        self.assertEqual(self.read('reviewer')[0]['promotions'], [])

    def test_promotion_notifies_the_destination_owner_with_full_provenance(self):
        self.call('record', 'promotion-finding', 'grand', 'measured claim',
                  self.evidence('promotion-evidence', 'grand'), 'fixture')
        self.call('promote', 'worker-share', 'worker', 'grand', 'worker', 'promotion-finding')
        notice = self.call('delivery', 'worker-share:promotion-notice')
        self.assertEqual((notice['sender'], notice['recipient'], notice['kind']),
                         ('worker', 'worker', 'question'))
        self.assertEqual(json.loads(notice['body']),
                         {'promotion': 'worker-share', 'finding': 'promotion-finding',
                          'author': 'grand', 'source': 'grand', 'destination': 'worker',
                          'promotedBy': 'worker'})
        self.call('promote', 'root-share', 'root', 'worker', 'root', 'promotion-finding')
        root_notice = self.call('delivery', 'root-share:promotion-notice')
        self.assertEqual(json.loads(root_notice['body']),
                         {'promotion': 'root-share', 'finding': 'promotion-finding',
                          'author': 'grand', 'source': 'worker', 'destination': 'root',
                          'promotedBy': 'root'})
        self.assertEqual(self.call('inbox', 'sibling'), [])
        self.assertEqual(self.call('inbox', 'grand'), [])
        self.assertEqual(self.ids(self.read('sibling')), ['promotion-finding'])

    def test_promotion_retries_deliver_only_the_exact_pending_owner_notice(self):
        evidence = self.evidence('promotion-endpoint-evidence', 'worker')
        self.call('record', 'endpoint-shared-finding', 'worker', 'claim', evidence, 'limits')
        deliveries = pathlib.Path(self.temp.name) / 'promotion-deliveries.txt'
        endpoint = pathlib.Path(self.temp.name) / 'promotion-endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            'with pathlib.Path(sys.argv[1]).open("a") as stream:\n'
                            '    stream.write(sys.argv[2] + "\\n")\n')
        self.call('connect', 'root', 'root-session',
                  json.dumps([sys.executable, str(endpoint), str(deliveries)]))
        promote = ('promote', 'endpoint-share', 'root', 'worker', 'root', 'endpoint-shared-finding')
        first = self.call(*promote)
        before = 'endpoint-share:promotion-notice\n'
        self.assertEqual(deliveries.read_text(), before)
        # These calls cannot select the stored promotion and must not invoke its
        # endpoint, including the rejected source that carries no finding.
        for source in ('grand', 'absent'):
            self.call('promote', 'endpoint-share', 'root', source, 'root',
                      'endpoint-shared-finding', success=False)
            self.assertEqual(deliveries.read_text(), before)
        self.call('promote', 'endpoint-share', 'sibling', 'worker', 'sibling',
                  'endpoint-shared-finding', success=False)
        self.assertEqual(deliveries.read_text(), before)
        self.call('record', 'other-shared-finding', 'worker', 'other claim', evidence, 'limits')
        before_conflict = deliveries.read_text()
        self.call('promote', 'endpoint-share', 'root', 'worker', 'root',
                  'other-shared-finding', success=False)
        self.assertEqual(deliveries.read_text(), before_conflict)
        self.assertEqual(self.call(*promote), first)
        self.assertEqual(deliveries.read_text(), before_conflict + before)
        self.call('ack', 'endpoint-share:promotion-notice', 'root', 'Reviewed shared context.')
        self.assertEqual(self.call(*promote), first)
        self.assertEqual(deliveries.read_text(), before_conflict + before)
        self.assertEqual(len(self.read('sibling')[0]['promotions']), 1)

    def test_conflicting_promotion_notice_identity_preserves_the_promotion_and_refuses(self):
        self.call('record', 'rollback-finding', 'worker', 'claim',
                  self.evidence('rollback-evidence', 'worker'), 'limits')
        self.call('message', 'conflict-share:promotion-notice', 'root', 'sibling',
                  'guidance', 'Existing unrelated input.')
        deliveries = pathlib.Path(self.temp.name) / 'conflict-deliveries.txt'
        endpoint = pathlib.Path(self.temp.name) / 'conflict-endpoint.py'
        endpoint.write_text('import pathlib,sys\n'
                            'with pathlib.Path(sys.argv[1]).open("a") as stream:\n'
                            '    stream.write(sys.argv[2] + "\\n")\n')
        self.call('connect', 'sibling', 'sibling-session',
                  json.dumps([sys.executable, str(endpoint), str(deliveries)]))
        before = deliveries.read_text() if deliveries.exists() else ''
        stored = self.call('delivery', 'conflict-share:promotion-notice')
        conflict = self.call('promote', 'conflict-share', 'root', 'worker', 'root',
                             'rollback-finding', success=False)
        self.assertIn('promotion-notice-conflict', conflict.stderr)
        # The refusal invoked no endpoint of the original notice's recipient.
        self.assertEqual(deliveries.read_text() if deliveries.exists() else '', before)
        self.assertEqual(self.ids(self.read('worker')), ['rollback-finding'])
        self.assertEqual([p['destination'] for p in self.read('worker')[0]['promotions']],
                         ['root'])
        notice = self.call('delivery', 'conflict-share:promotion-notice')
        self.assertEqual((notice['sender'], notice['recipient'], notice['kind'], notice['body']),
                         (stored['sender'], stored['recipient'], stored['kind'], stored['body']))
        self.assertEqual(notice['receipt'], stored['receipt'])

    def test_committed_promotion_notice_retries_after_endpoint_repair(self):
        self.call('record', 'repair-finding', 'worker', 'claim',
                  self.evidence('repair-evidence', 'worker'), 'limits')
        self.call('connect', 'root', 'root-session',
                  json.dumps([str(pathlib.Path(self.temp.name) / 'missing-endpoint')]))
        promote = ('promote', 'repair-share', 'root', 'worker', 'root', 'repair-finding')
        failed = self.call(*promote, success=False)
        self.assertIn('The row is committed and its notice is undelivered', failed.stderr)
        notice = self.call('delivery', 'repair-share:promotion-notice')
        self.assertIsNone(notice['receipt'])
        self.assertEqual(self.ids(self.read('sibling')), ['repair-finding'])
        self.call('connect', 'root', 'root-session', json.dumps(['/usr/bin/true']))
        saved = self.call(*promote)
        self.assertEqual(saved['id'], 'repair-share')
        self.assertEqual(len(self.read('sibling')[0]['promotions']), 1)

    def test_a_stopped_destination_retains_the_promotion_notice_and_notifies_parent(self):
        self.call('connect', 'root', 'root-session', json.dumps(['/usr/bin/true']))
        self.call('recruit', 'reviewer', 'root', 'omp', 'fixture-model', 'high',
                  str(self.repo), 'reviewer-branch', str(self.checkouts / 'reviewer'), self.base)
        self.player('researcher', parent='reviewer')
        self.call('record', 'stopped-share-finding', 'researcher', 'measured claim',
                  self.evidence('stopped-share-evidence', 'researcher'), 'fixture')
        self.call('stop', 'reviewer', 'end-reviewer', 'Reviewing session ended.')
        promotion = self.call('promote', 'stopped-share', 'reviewer', 'researcher', 'reviewer',
                              'stopped-share-finding')
        notice = self.call('delivery', 'stopped-share:promotion-notice')
        self.assertIsNone(notice['receipt'])
        self.assertEqual(json.loads(notice['body'])['destination'], 'reviewer')
        reports = [json.loads(row['body']) for row in self.call('inbox', 'root')
                   if row['kind'] == 'report']
        handoff = next(row for row in reports
                       if row.get('originalMessage') == 'stopped-share:promotion-notice')
        self.assertEqual(handoff['originalKind'], 'question')
        self.assertEqual(json.loads(handoff['originalBody'])['promotion'], promotion['id'])
        self.assertEqual(self.read('root')[0]['destinations'], ['reviewer'])
        self.assertEqual(self.ids(self.read('sibling')), ['stopped-share-finding'])


if __name__ == '__main__':
    unittest.main()
