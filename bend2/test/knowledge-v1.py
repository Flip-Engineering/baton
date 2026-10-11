"""Exercise the knowledge-v1 surface with separate native processes.

A session records schema-typed nodes and edges through record-v1 and
relate-v1. Refusals name the violated rule and exit nonzero. Legacy and v1
rows share scope reads, index listings, search and traversal with their
provenance distinguished, and the fictional stream-shade example round-trips
with every scientific field intact. Every call below is its own process.
"""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
FIXTURE = ROOT / 'bend2/test/fixtures/knowledge-v1-scientific-example.json'
# Pinned contract artifact: SHA256
# d2419eb6b48f758cbc15a89ecd8370b5efab83e98da7974b6ed4e5927e6576ee.


def context(**overrides):
    base = {'scope': 'test scope', 'subjects': [], 'conditions': [], 'assumptions': []}
    base.update(overrides)
    return base


DETAILS = {
    'question': {'topic': 'test topic', 'openQuestions': []},
    'claim': {'quantification': 'singular'},
    'hypothesis': {'explanation': 'test explanation', 'predictions': [], 'overturnConditions': []},
    'observation': {'subject': {'kind': 'artifact', 'uri': 'urn:test:subject'},
                    'property': 'test property', 'procedure': 'test procedure',
                    'result': {'kind': 'text', 'value': 'test value'},
                    'phenomenonTime': 'test time'},
    'research-finding': {'method': {'kind': 'field-observation', 'procedure': 'test procedure'},
                         'inputs': [], 'inference': 'test inference',
                         'overturnConditions': []},
    'study': {'questions': [], 'method': {'kind': 'field-observation', 'procedure': 'test procedure'},
              'design': 'test design', 'state': 'completed', 'outputs': [],
              'studyIdentity': 'test-study'},
    'evidence': {'source': {'kind': 'artifact', 'uri': 'urn:test:source'},
                 'description': 'test description'},
    'argument': {'method': 'abduction', 'premises': [], 'derivation': 'test derivation'},
    'proposal': {'purpose': 'test purpose', 'proposedAction': 'test action',
                 'rationale': 'test rationale', 'alternatives': []},
    'decision': {'selected': {'id': 'test-selected', 'kind': 'claim'},
                 'rationale': 'test rationale', 'alternatives': []},
}


def node(author, ident, kind, statement='test statement', **overrides):
    payload = {'id': ident, 'author': author, 'kind': kind, 'statement': statement,
               'context': context(), 'evidence': [], 'limits': 'test limits',
               'uncertainty': '', 'details': DETAILS[kind]}
    payload.update(overrides)
    return payload


def edge(author, ident, kind, source, target, **overrides):
    payload = {'id': ident, 'author': author, 'kind': kind,
               'source': {'id': source[0], 'kind': source[1]},
               'target': {'id': target[0], 'kind': target[1]},
               'context': context(), 'basis': [], 'rationale': 'test rationale',
               'limits': '', 'uncertainty': '', 'details': {'derivation': 'test derivation'}}
    payload.update(overrides)
    return payload


class KnowledgeV1(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Knowledge v1 fixture']):
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

    def record(self, payload):
        return self.call('record-v1', json.dumps(payload))

    def relate(self, payload):
        return self.call('relate-v1', json.dumps(payload))

    def detail(self, ident):
        rows = self.call('knowledge-scope', 'root', 'all', '', '--id', ident)
        self.assertEqual(len(rows), 1)
        return rows[0]

    def test_record_v1_node_returns_full_envelope_and_notifies_parent(self):
        payload = node('grand', 'v1-question', 'question')
        answer = self.record(payload)
        self.assertEqual(answer['id'], 'v1-question')
        self.assertEqual(answer['kind'], 'question')
        self.assertEqual(answer['statement'], 'test statement')
        self.assertEqual(answer['context'], payload['context'])
        self.assertEqual(answer['details'], payload['details'])
        self.assertEqual(answer['provenance'], 'authored')
        self.assertEqual(answer['schemaVersion'], 1)
        self.assertEqual(answer['schemaId'], 'urn:baton:knowledge:schema:1')
        self.assertEqual(answer['promotions'], [])
        self.assertEqual(answer['relations'], [])
        notice = self.call('delivery', 'v1-question:notice')
        self.assertEqual(notice['recipient'], 'worker')
        self.assertEqual(json.loads(notice['body']),
                         {'finding': 'v1-question', 'author': 'grand'})

    def test_identical_rewrite_is_idempotent_and_conflict_refuses(self):
        payload = node('grand', 'v1-stable', 'claim', 'held statement')
        first = self.record(payload)
        second = self.record(payload)
        self.assertEqual(first, second)
        changed = dict(payload)
        changed['statement'] = 'replacement statement'
        conflict = self.call('record-v1', json.dumps(changed), success=False)
        self.assertIn('v1-node-id-conflict', conflict.stderr)
        self.assertEqual(self.detail('v1-stable')['statement'], 'held statement')

    def test_admission_refusal_paths(self):
        cases = [
            ('unknown node kind',
             dict(node('grand', 'v1-bad-kind', 'question', ), kind='rumor'),
             'v1-unknown-node-kind'),
            ('malformed node shape',
             {k: v for k, v in node('grand', 'v1-bad-shape', 'question').items() if k != 'details'},
             'v1-node-shape'),
            ('unregistered author',
             node('ghost', 'v1-bad-author', 'question'),
             'v1-unknown-author'),
            ('unknown edge kind',
             edge('grand', 'v1-bad-edge', 'rumored', ('v1-bad-edge', 'claim'), ('v1-bad-edge', 'claim')),
             'v1-unknown-edge-kind'),
        ]
        for label, payload, error in cases:
            with self.subTest(label=label):
                verb = 'relate-v1' if payload.get('source') else 'record-v1'
                refused = self.call(verb, json.dumps(payload), success=False)
                self.assertIn(error, refused.stderr)
        garbage = self.call('record-v1', '{not json', success=False)
        self.assertIn('v1-node-shape', garbage.stderr)

    def test_edge_reference_resolution_refusals(self):
        self.record(node('grand', 'v1-obs', 'observation'))
        missing = edge('grand', 'v1-missing', 'supports',
                       ('v1-gone', 'observation'), ('v1-obs', 'observation'),
                       details={'bearing': 'test bearing'})
        refused = self.call('relate-v1', json.dumps(missing), success=False)
        self.assertIn('v1-unresolved-endpoint', refused.stderr)
        mismatched = edge('grand', 'v1-mismatch', 'supports',
                          ('v1-obs', 'claim'), ('v1-obs', 'observation'),
                          details={'bearing': 'test bearing'})
        refused = self.call('relate-v1', json.dumps(mismatched), success=False)
        self.assertIn('v1-endpoint-kind-mismatch', refused.stderr)
        off_matrix = edge('grand', 'v1-matrix', 'investigates',
                          ('v1-obs', 'observation'), ('v1-obs', 'observation'),
                          details={'purpose': 'test purpose'})
        refused = self.call('relate-v1', json.dumps(off_matrix), success=False)
        self.assertIn('v1-endpoint-kind-mismatch', refused.stderr)

    def test_proof_rule_admission(self):
        self.record(node('grand', 'v1-abduction', 'argument'))
        self.record(node('grand', 'v1-target-claim', 'claim'))
        weak = edge('grand', 'v1-weak-proof', 'proves',
                    ('v1-abduction', 'argument'), ('v1-target-claim', 'claim'),
                    details={'conclusion': 'test conclusion'})
        refused = self.call('relate-v1', json.dumps(weak), success=False)
        self.assertIn('v1-proof-rule', refused.stderr)
        self.record(node('grand', 'v1-deduction', 'argument',
                         details={'method': 'deduction', 'premises': [],
                                  'derivation': 'test derivation'}))
        strong = edge('grand', 'v1-strong-proof', 'proves',
                      ('v1-deduction', 'argument'), ('v1-target-claim', 'claim'),
                      details={'conclusion': 'test conclusion'})
        answer = self.relate(strong)
        self.assertEqual(answer['kind'], 'proves')

    def test_produces_matrix_follows_study_outputs(self):
        self.record(node('grand', 'v1-gen-study', 'study'))
        self.record(node('grand', 'v1-gen-hypothesis', 'hypothesis'))
        admitted = self.relate(edge('grand', 'v1-generated', 'produces',
                                    ('v1-gen-study', 'study'),
                                    ('v1-gen-hypothesis', 'hypothesis'),
                                    details={'method': 'test method'}))
        self.assertEqual(admitted['kind'], 'produces')
        self.record(node('grand', 'v1-other-study', 'study'))
        refused = self.call('relate-v1', json.dumps(edge(
            'grand', 'v1-study-loop', 'produces',
            ('v1-gen-study', 'study'), ('v1-other-study', 'study'),
            details={'method': 'test method'})), success=False)
        self.assertIn('v1-endpoint-kind-mismatch', refused.stderr)

    def test_relate_v1_edge_round_trip_and_traversal(self):
        self.record(node('grand', 'v1-study', 'study'))
        self.record(node('grand', 'v1-ask', 'question'))
        answer = self.relate(edge('grand', 'v1-examines', 'investigates',
                                  ('v1-study', 'study'), ('v1-ask', 'question'),
                                  basis=[{'id': 'v1-ask', 'kind': 'question'}],
                                  details={'purpose': 'test purpose'}))
        self.assertEqual(answer['source'], {'id': 'v1-study', 'kind': 'study'})
        self.assertEqual(answer['target'], {'id': 'v1-ask', 'kind': 'question'})
        self.assertEqual(answer['basis'], [{'id': 'v1-ask', 'kind': 'question'}])
        self.assertEqual(answer['provenance'], 'authored')
        self.assertEqual(answer['schemaVersion'], 1)
        self.assertEqual(answer['schemaId'], 'urn:baton:knowledge:schema:1')
        walked = self.call('knowledge-traverse', 'root', 'all', '', 'v1:v1-study',
                           'out', '', 'neighbors')
        self.assertIn('v1:v1-study', walked['roots'])
        self.assertEqual({n['id'] for n in walked['nodes']}, {'v1-study', 'v1-ask'})
        self.assertEqual([e['id'] for e in walked['edges']], ['v1-examines'])
        stored = self.detail('v1-examines')
        self.assertEqual(stored['source'], {'id': 'v1-study', 'kind': 'study'})

    def test_mixed_legacy_and_v1_reads(self):
        self.call('record-typed', 'legacy-finding', 'grand', 'finding',
                  'A legacy claim', 'run:legacy', 'Legacy limits')
        self.record(node('grand', 'v1-mixed', 'question'))
        rows = {row['id']: row for row in self.call('knowledge-scope', 'root', 'all', '')}
        self.assertIn('legacy-finding', rows)
        self.assertIn('v1-mixed', rows)
        self.assertNotIn('statement', rows['legacy-finding'])
        self.assertNotIn('claim', rows['v1-mixed'])
        legacy = self.detail('legacy-finding')
        self.assertEqual(legacy['statement'], 'A legacy claim')
        self.assertIsNone(legacy['details'])
        self.assertEqual(legacy['provenance'], 'legacy')
        self.assertEqual(legacy['schemaVersion'], 'legacy')
        self.assertEqual(legacy['kind'], 'finding')
        current = self.detail('v1-mixed')
        self.assertEqual(current['statement'], 'test statement')
        self.assertEqual(current['provenance'], 'authored')
        index = {row['id']: row for row in
                 self.call('knowledge-scope', 'root', 'all', '', '--index')}
        self.assertEqual(index['legacy-finding']['detailRead'],
                         ['knowledge-scope', 'root', 'all', '', '--id', 'legacy-finding'])
        self.assertEqual(index['v1-mixed']['detailRead'],
                         ['knowledge-scope', 'root', 'all', '', '--id', 'v1-mixed'])
        reread = self.call(*index['v1-mixed']['detailRead'])
        self.assertEqual([row['id'] for row in reread], ['v1-mixed'])
        found = self.call('knowledge-search', 'root', 'all', '', 'limits')
        self.assertEqual({n['id'] for n in found['nodes']}, {'legacy-finding', 'v1-mixed'})

    def test_scientific_example_round_trip(self):
        example = json.loads(FIXTURE.read_text())
        self.assertEqual(example['schemaVersion'], 1)
        for item in example['nodes']:
            payload = dict(item)
            payload['author'] = 'grand'
            self.record(payload)
        for item in example['edges']:
            payload = dict(item)
            payload['author'] = 'grand'
            self.relate(payload)
        for item in example['nodes']:
            stored = self.detail(item['id'])
            for field in ('statement', 'context', 'evidence', 'limits', 'uncertainty', 'details'):
                self.assertEqual(stored[field], item[field], (item['id'], field))
            self.assertEqual(stored['kind'], item['kind'])
            self.assertEqual(stored['provenance'], 'authored')
            self.assertEqual(stored['schemaVersion'], 1)
            self.assertEqual(stored['schemaId'], 'urn:baton:knowledge:schema:1')
        for item in example['edges']:
            stored = self.detail(item['id'])
            for field in ('source', 'target', 'context', 'basis', 'rationale',
                          'limits', 'uncertainty', 'details'):
                self.assertEqual(stored[field], item[field], (item['id'], field))
            self.assertEqual(stored['kind'], item['kind'])
        rows = {row['id'] for row in self.call('knowledge-scope', 'root', 'all', '')}
        self.assertEqual(rows, {item['id'] for item in example['nodes'] + example['edges']})
        walked = self.call('knowledge-traverse', 'root', 'all', '', 'v1:shade-study',
                           'both', '', 'recursive')
        reached = {n['id'] for n in walked['nodes']}
        self.assertIn('shade-question', reached)
        self.assertIn('temperature-observation', reached)
        self.assertIn('warming-finding', reached)
        rivals = self.call('knowledge-traverse', 'root', 'all', '', 'v1:air-hypothesis',
                           'in', '', 'neighbors')
        self.assertEqual({n['id'] for n in rivals['nodes']},
                         {'air-hypothesis', 'shade-hypothesis'})
        stored = self.detail('hypothesis-rival')
        self.assertEqual(stored['source'], {'id': 'shade-hypothesis', 'kind': 'hypothesis'})


if __name__ == '__main__':
    unittest.main()
