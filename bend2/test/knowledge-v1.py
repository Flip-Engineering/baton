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


def context(**overrides):
    base = {'scope': 'test scope', 'subjects': [], 'conditions': [], 'assumptions': []}
    base.update(overrides)
    return base


DETAILS = {
    'question': {'topic': 'test topic', 'openQuestions': []},
    'claim': {'quantification': 'singular'},
    'hypothesis': {'explanation': 'test explanation', 'predictions': [], 'overturnConditions': []},
    'observation': {'subject': {'kind': 'entity', 'uri': 'urn:test:subject', 'label': 'Observed subject'},
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

    def call_rows(self, *args):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True)
        self.assertEqual(p.returncode, 0, p.stderr)
        return [json.loads(line) for line in p.stdout.splitlines() if line.strip()]

    def record(self, payload):
        return self.call('record-v1', json.dumps(payload))

    def relate(self, payload):
        return self.call('relate-v1', json.dumps(payload))

    def detail(self, ident):
        rows = self.call('knowledge-v1-detail', 'root', 'all', '', ident)
        self.assertEqual(len(rows), 1)
        return rows[0]

    def batch(self, nodes, edges=(), success=True):
        return self.call('knowledge-admit-v1', 'grand', json.dumps({
            'schemaVersion': 1, 'nodes': list(nodes), 'edges': list(edges),
        }), success=success)

    def refused(self, result, rule):
        self.assertEqual(result.returncode, 2, result.stderr)
        refusal = json.loads(result.stderr)
        self.assertEqual(refusal['error'], 'v1-refused')
        self.assertEqual(refusal['rule'], rule)

    def test_scientific_graph_round_trip_and_navigation(self):
        example = json.loads(FIXTURE.read_text())
        for item in example['nodes'] + example['edges']:
            item['author'] = 'grand'
        self.call('knowledge-admit-v1', 'grand', json.dumps(example))
        for item in example['nodes'] + example['edges']:
            stored = self.detail(item['id'])
            for field, value in item.items():
                self.assertEqual(stored[field], value, (item['id'], field))
            self.assertEqual(stored['schemaVersion'], 1)
            self.assertEqual(stored['schemaId'], 'urn:baton:knowledge:schema:1')
        walked = self.call('knowledge-traverse', 'root', 'all', '', 'v1:shade-study',
                           'both', '', 'recursive')
        self.assertTrue({'shade-question', 'temperature-observation', 'warming-finding'}
                        <= {item['id'] for item in walked['nodes']})
        rivals = self.call('knowledge-traverse', 'root', 'all', '', 'v1:air-hypothesis',
                           'in', '', 'neighbors')
        self.assertEqual({item['id'] for item in rivals['nodes']},
                         {'air-hypothesis', 'shade-hypothesis'})
        self.assertEqual(self.detail('hypothesis-rival')['source'],
                         {'id': 'shade-hypothesis', 'kind': 'hypothesis'})

    def test_single_record_full_answer_notice_and_idempotency(self):
        payload = node('grand', 'question-record', 'question')
        first = self.record(payload)
        self.assertEqual(first, self.record(payload))
        for field, value in payload.items():
            self.assertEqual(first[field], value)
        notice = self.call('delivery', 'knowledge-v1:question-record:notice')
        self.assertEqual(notice['recipient'], 'worker')
        self.assertEqual(json.loads(notice['body']), {
            'schemaVersion': 1, 'schemaId': 'urn:baton:knowledge:schema:1',
            'recordId': 'question-record', 'kind': 'question', 'author': 'grand',
        })
        changed = dict(payload, statement='A revised question')
        self.refused(self.call('record-v1', json.dumps(changed), success=False), 'identity')
        self.assertEqual(self.detail(payload['id'])['statement'], payload['statement'])

    def test_invalid_batch_preserves_prior_graph(self):
        self.record(node('grand', 'retained-claim', 'claim'))
        invalid_edge = edge('grand', 'missing-relation', 'supports',
                            ('missing-observation', 'observation'), ('retained-claim', 'claim'),
                            details={'bearing': 'The observation would bear on this claim.'})
        self.refused(self.batch([node('grand', 'uncommitted-claim', 'claim')],
                                [invalid_edge], success=False), 'endpoint')
        self.assertEqual(self.call('knowledge-v1-detail', 'root', 'all', '',
                                   'uncommitted-claim'), [])
        self.assertEqual(self.detail('retained-claim')['kind'], 'claim')

    def test_malformed_and_closed_shapes_are_structured_refusals(self):
        import copy
        valid = node('grand', 'malformed-observation', 'observation')
        cases = []
        def modified(change):
            item = copy.deepcopy(valid)
            change(item)
            cases.append(item)
        modified(lambda item: item.update(kind='rumor'))
        modified(lambda item: item.update(extra='unrecognized'))
        modified(lambda item: item['details'].update(result={'kind': 'text'}))
        modified(lambda item: item['details'].update(result={'kind': 'boolean', 'value': 1}))
        modified(lambda item: item['details'].update(resultTime=None))
        modified(lambda item: item['details']['subject'].update(extra='unrecognized'))
        modified(lambda item: item['details'].update(subject={'kind': 'artifact', 'uri': 'urn:test:source', 'sha256': None}))
        modified(lambda item: item['details']['subject'].update(label=None))
        modified(lambda item: item['details']['subject'].update(label=4))
        modified(lambda item: item['details']['subject'].update(sha256='a' * 64))
        modified(lambda item: item['context'].update(subjects=['plain scalar']))
        modified(lambda item: item['context'].update(subjects=[json.dumps({'kind': 'artifact', 'uri': 'x'})]))
        for item in cases:
            with self.subTest(item=item):
                self.refused(self.call('record-v1', json.dumps(item), success=False), 'structure')
        for item in ['plain scalar', json.dumps(valid), None, 4]:
            with self.subTest(member=item):
                self.refused(self.batch([item], success=False), 'structure')
        self.refused(self.call('record-v1', '{not json', success=False), 'structure')
        self.assertEqual(self.call('knowledge-scope', 'root', 'all', ''), [])

    def test_boolean_results_and_nonempty_scientific_conditions(self):
        payload = node('grand', 'boolean-observation', 'observation',
                       context=context(conditions=['Summer low flow'], assumptions=['Sensor calibrated']),
                       details={**DETAILS['observation'], 'result': {'kind': 'boolean', 'value': True}})
        self.assertEqual(self.record(payload)['details']['result'],
                         {'kind': 'boolean', 'value': True})
        self.assertEqual(self.detail(payload['id'])['context'], payload['context'])

    def test_entities_and_documents_are_distinct_observation_subjects(self):
        entity = node('grand', 'entity-observation', 'observation')
        self.assertEqual(self.record(entity)['details']['subject'], entity['details']['subject'])
        document = node('grand', 'document-observation', 'observation', details={
            **DETAILS['observation'], 'subject': {'kind': 'artifact', 'uri': 'urn:test:document'},
            'property': 'The document records a sampling procedure'})
        self.assertEqual(self.record(document)['details']['subject'], document['details']['subject'])

    def test_proof_and_prior_counterexample_methods(self):
        self.batch([node('grand', 'claim', 'claim'), node('grand', 'observed-witness', 'observation'),
                    node('grand', 'abductive-argument', 'argument')])
        weak = edge('grand', 'weak-proof', 'proves', ('abductive-argument', 'argument'),
                    ('claim', 'claim'), details={'conclusion': 'The claim follows.'})
        self.refused(self.call('relate-v1', json.dumps(weak), success=False), 'method')
        missing = node('grand', 'missing-witness', 'argument', details={
            'method': 'counterexample', 'premises': [], 'derivation': 'One observation contradicts the universal claim.'})
        self.refused(self.call('record-v1', json.dumps(missing), success=False), 'structure')
        witness = node('grand', 'counterexample', 'argument', details={
            **missing['details'], 'witness': {'id': 'observed-witness', 'kind': 'observation'}})
        self.record(witness)
        disproof = edge('grand', 'counterexample-disproof', 'disproves',
                        ('counterexample', 'argument'), ('claim', 'claim'),
                        details={'conclusion': 'The universal claim fails for this witness.'})
        self.assertEqual(self.relate(disproof)['kind'], 'disproves')
        stored = self.detail(disproof['id'])
        self.assertEqual(stored['source'], disproof['source'])

    def test_legacy_and_scientific_ids_and_promotions_are_independent(self):
        self.call('record-typed', 'shared-id', 'grand', 'finding',
                  'A legacy claim', 'run:legacy', 'Legacy limits')
        self.record(node('grand', 'shared-id', 'question'))
        self.call('promote', 'same-promotion-id', 'sibling', 'grand', 'sibling', 'shared-id')
        old = self.call('knowledge-scope', 'root', 'all', '', '--id', 'shared-id')[0]
        new = self.detail('shared-id')
        self.assertEqual(old['claim'], 'A legacy claim')
        self.assertEqual(old['statement'], 'A legacy claim')
        self.assertIn('details', old)
        self.assertIsNone(old['details'])
        self.assertEqual(len(old['promotions']), 1)
        self.assertEqual(new['promotions'], [])
        self.call('promote-v1', 'same-promotion-id', 'sibling', 'grand', 'sibling', 'shared-id')
        self.assertEqual(len(self.detail('shared-id')['promotions']), 1)
        old = self.call('knowledge-scope', 'root', 'all', '', '--id', 'shared-id')[0]
        self.assertEqual(len(old['promotions']), 1)
        for message in ('same-promotion-id:promotion-notice',
                        'knowledge-v1:same-promotion-id:promotion-notice'):
            self.assertEqual(self.call('delivery', message)['recipient'], 'sibling')
        rows = [item for item in self.call('knowledge-scope', 'root', 'all', '')
                if item['id'] == 'shared-id']
        self.assertEqual({item.get('schemaVersion', 'legacy') for item in rows}, {'legacy', 1})
        index = self.call('knowledge-scope', 'root', 'all', '', '--index')
        scientific = next(item for item in index if item.get('schemaVersion') == 1)
        self.assertEqual(scientific['detailRead'],
                         ['knowledge-v1-detail', 'root', 'all', '', 'shared-id'])

    def test_simulation_model_reference_round_trip(self):
        method = {
            'kind': 'simulation',
            'model': {'kind': 'artifact', 'uri': 'urn:example:stream-temperature-model'},
            'parameters': {'shadeFraction': 0.75, 'flowMetresPerSecond': 0.4},
            'procedure': 'Calculate stream temperature under the stated shade and flow.',
        }
        original = node('grand', 'temperature-simulation', 'study',
                        details={**DETAILS['study'], 'method': method})
        self.record(original)
        self.assertEqual(self.detail(original['id'])['details']['method'], method)
        reordered = {
            **method,
            'parameters': dict(reversed(list(method['parameters'].items()))),
        }
        self.record({**original, 'details': {**original['details'], 'method': reordered}})
        self.assertEqual(self.detail(original['id'])['details']['method'], method)
        for ident, model in (
                ('unknown-model-kind', {'kind': 'unknown', 'uri': 'urn:example:model'}),
                ('model-extra-field', {**method['model'], 'undeclared': True})):
            with self.subTest(model=model):
                invalid = node('grand', ident, 'study', details={
                    **DETAILS['study'], 'method': {**method, 'model': model},
                })
                self.refused(self.call('record-v1', json.dumps(invalid), success=False),
                             'structure')
                self.assertEqual(self.call('knowledge-v1-detail', 'root', 'all', '', ident), [])

    def test_mixed_relations_read_keeps_identity_and_scope(self):
        self.call('record-typed', 'legacy-anchor', 'grand', 'finding',
                  'Anchor claim', 'run:legacy', 'Legacy limits')
        self.call('relate', 'legacy-link', 'grand', 'legacy-anchor',
                  'Supports', 'legacy-anchor')
        self.batch([node('grand', 'v1-anchor', 'evidence'),
                    node('grand', 'v1-other', 'claim')],
                   [edge('grand', 'v1-link', 'supports',
                         ('v1-anchor', 'evidence'), ('v1-other', 'claim'),
                         details={'bearing': 'The evidence bears on the claim.'})])
        rows = self.call('knowledge-relations', 'root', 'all', '')
        self.assertEqual([row['id'] for row in rows], ['legacy-link', 'v1-link'])
        legacy, scientific = rows
        self.assertNotIn('provenance', legacy)
        self.assertEqual(scientific['provenance'], 'authored')
        self.assertEqual(scientific['schemaVersion'], 1)
        self.assertEqual(scientific['schemaId'], 'urn:baton:knowledge:schema:1')
        self.assertEqual(scientific['sourceReference'], 'v1:v1-anchor')
        self.assertEqual(scientific['relation'], 'supports')
        self.assertEqual(self.call(*scientific['detailRead']), [self.detail('v1-link')])
        scoped = self.call('knowledge-relations', 'root', 'worker', 'grand')
        self.assertEqual([row['id'] for row in scoped], ['legacy-link', 'v1-link'])
        self.assertEqual(scoped[1]['detailRead'],
                         ['knowledge-v1-detail', 'root', 'worker', 'grand', 'v1-link'])
        self.assertEqual(self.call(*scoped[1]['detailRead']), [self.detail('v1-link')])
        self.assertEqual(self.call('knowledge-relations', 'root', 'worker', 'sibling'), [])

    def test_citations_keep_typed_sources_and_outside_scope_navigation(self):
        self.record(node('sibling', 'cited-observation', 'observation'))
        self.record(node('sibling', 'cited-claim', 'claim'))
        self.relate(edge('sibling', 'cited-support', 'supports',
                         ('cited-observation', 'observation'), ('cited-claim', 'claim'),
                         details={'bearing': 'The observation bears on the claim.'}))
        self.call('message', 'cited-message', 'sibling', 'grand', 'report',
                  'The researcher records a source description.')
        uri = 'https://example.invalid/research-source'
        references = [
            {'id': 'cited-observation', 'kind': 'observation'},
            {'id': 'cited-support', 'kind': 'edge', 'edgeKind': 'supports'},
            {'id': 'cited-message', 'kind': 'message'},
            {'kind': 'artifact', 'uri': uri, 'sha256': 'a' * 64},
            {'kind': 'url', 'uri': uri},
            {'kind': 'entity', 'uri': uri, 'label': 'The observed research site'},
        ]
        self.record(node('grand', 'citing-claim', 'claim', evidence=references))
        self.call('record-typed', 'citing-claim', 'grand', 'finding',
                  'A separate legacy claim', 'run:legacy', 'Legacy scope')
        graph = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                          'v1:citing-claim', 'out', 'Cited', 'neighbors')
        self.assertEqual({item['reference'] for item in graph['nodes']},
                         {'v1:citing-claim'})
        self.assertEqual(len(graph['edges']), len(references))
        self.assertEqual(len({item['id'] for item in graph['edges']}), len(references))
        targets = {item['targetReference']: item for item in graph['edges']}
        expected_keys = [
            'v1:cited-observation', 'v1:cited-support', 'message:cited-message',
            'resource:' + json.dumps(['artifact', uri, 'a' * 64], separators=(',', ':')),
            'resource:' + json.dumps(['url', uri], separators=(',', ':')),
            'resource:' + json.dumps(['entity', uri], separators=(',', ':')),
        ]
        self.assertEqual(set(targets), set(expected_keys))
        outside = {item['reference']: item for item in graph['references']}
        for index, (key, reference) in enumerate(zip(expected_keys, references)):
            citation = targets[key]
            self.assertEqual(citation['sourceReference'], 'v1:citing-claim')
            self.assertEqual(citation['source'], {'id': 'citing-claim', 'kind': 'claim'})
            self.assertEqual(citation['target'], reference)
            self.assertEqual(citation['targetKind'], reference['kind'])
            self.assertEqual(citation['provenance'], 'recorded-evidence')
            self.assertEqual(citation['projectionKey'],
                             ['recorded-evidence', 'v1:citing-claim', index])
            self.assertEqual(outside[key]['kind'], reference['kind'])
            self.assertEqual(outside[key]['identity'], reference)
        for ident in ('cited-observation', 'cited-support'):
            read = outside['v1:' + ident]['detailRead']
            self.assertEqual(read, ['knowledge-v1-detail', 'root', 'all', '', ident])
            self.assertEqual(self.call(*read), [self.detail(ident)])
        self.assertEqual(self.call(*outside['message:cited-message']['deliveryRead'])['body'],
                         'The researcher records a source description.')
        all_graph = self.call('knowledge-traverse', 'root', 'all', '',
                              'v1:citing-claim', 'out', 'Cited', 'neighbors')
        self.assertEqual({item['reference'] for item in all_graph['nodes']},
                         {'v1:citing-claim', 'v1:cited-observation'})
        self.relate(edge('grand', 'outside-support', 'supports',
                         ('cited-observation', 'observation'), ('citing-claim', 'claim'),
                         details={'bearing': 'This observation also bears on the citing claim.'}))
        authored = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                             'v1:citing-claim', 'in', 'supports', 'neighbors')
        outside_observation = next(item for item in authored['references']
                                   if item['reference'] == 'v1:cited-observation')
        self.assertEqual(outside_observation['kind'], 'observation')
        self.assertEqual(outside_observation['identity'], references[0])
        self.assertEqual(self.call(*outside_observation['detailRead']),
                         [self.detail('cited-observation')])
        self.relate(edge('grand', 'citation:v1:citing-claim:0', 'supports',
                         ('cited-observation', 'observation'), ('citing-claim', 'claim'),
                         details={'bearing': 'An authored edge can use this record ID.'}))
        mixed = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                          'v1:citing-claim', 'both', '', 'neighbors')
        shared_id = [item for item in mixed['edges']
                     if item['id'] == 'citation:v1:citing-claim:0']
        self.assertEqual({item['provenance'] for item in shared_id},
                         {'authored', 'recorded-evidence'})
        self.assertEqual(next(item['projectionKey'] for item in shared_id
                              if item['provenance'] == 'recorded-evidence'),
                         ['recorded-evidence', 'v1:citing-claim', 0])
        adversarial = [
            {'kind': 'url', 'uri': 'v1:cited-observation'},
            {'kind': 'url', 'uri': 'message:cited-message'},
            {'kind': 'artifact', 'uri': 'urn:source#sha256=' + 'a' * 64},
            {'kind': 'artifact', 'uri': 'urn:source', 'sha256': 'a' * 64},
        ]
        self.record(node('grand', 'alias-citing-claim', 'claim', evidence=adversarial))
        aliases = self.call('knowledge-traverse', 'root', 'all', '',
                            'v1:alias-citing-claim', 'out', 'Cited', 'neighbors')
        self.assertEqual({item['reference'] for item in aliases['nodes']},
                         {'v1:alias-citing-claim'})
        self.assertEqual(len({item['targetReference'] for item in aliases['edges']}), 4)
        self.assertEqual([item['target'] for item in sorted(aliases['edges'],
                                                          key=lambda item: item['projectionKey'][2])],
                         adversarial)
        self.call('record-typed', 'v1:cited-claim', 'grand', 'finding',
                  'A legacy ID contains the scientific prefix', 'run:legacy', 'Legacy scope')
        self.call('relate', 'legacy-prefixed-link', 'grand', 'v1:cited-claim',
                  'Supports', 'citing-claim')
        legacy = next(item for item in self.call('knowledge-relations', 'root', 'worker', 'grand')
                      if item['id'] == 'legacy-prefixed-link')
        self.assertEqual((legacy['sourceReference'], legacy['targetReference'], legacy['sourceKind']),
                         ('finding:v1:cited-claim', 'finding:citing-claim', 'finding'))
        for ident, identity in (
                ('cited-claim', {'id': 'cited-claim', 'kind': 'claim'}),
                ('cited-support', references[1])):
            isolated = self.call('knowledge-traverse', 'root', 'worker', 'grand',
                                 'v1:' + ident, 'out', 'Cited', 'neighbors')
            self.assertEqual(isolated['nodes'], [])
            self.assertEqual(isolated['edges'], [])
            self.assertEqual(isolated['references'][0]['kind'], identity['kind'])
            self.assertEqual(isolated['references'][0]['identity'], identity)
            self.assertEqual(self.call(*isolated['references'][0]['detailRead']),
                             [self.detail(ident)])
            missing_reader = self.call('knowledge-traverse', 'missing-reader', 'worker', 'grand',
                                       'v1:' + ident, 'out', 'Cited', 'neighbors')
            self.assertNotIn('identity', missing_reader['references'][0])
            self.assertEqual(missing_reader['references'][0]['kind'], 'external')

    def test_study_revision_uses_prior_stored_identity(self):
        original = node('grand', 'study-first', 'study')
        self.record(original)
        revised = node('grand', 'study-revised', 'study')
        revision = edge('grand', 'study-revision', 'supersedes',
                        ('study-revised', 'study'), ('study-first', 'study'),
                        details={'revision': 'The study protocol was revised.'})
        self.batch([revised], [revision])
        other = node('grand', 'different-study', 'study',
                     details={**DETAILS['study'], 'studyIdentity': 'different-study'})
        invalid = edge('grand', 'different-revision', 'supersedes',
                       ('different-study', 'study'), ('study-first', 'study'),
                       details={'revision': 'A different study cannot revise this identity.'})
        self.refused(self.batch([other], [invalid], success=False), 'study')
        self.assertEqual(self.call('knowledge-v1-detail', 'root', 'all', '', 'different-study'), [])

    def test_live_changes_include_scientific_records_and_promotions(self):
        import sqlite3
        self.record(node('grand', 'live-claim', 'claim'))
        self.record(node('grand', 'live-argument', 'argument'))
        self.relate(edge('grand', 'live-support', 'supports',
                         ('live-argument', 'argument'), ('live-claim', 'claim'),
                         details={'bearing': 'The argument bears on this claim.'}))
        self.call('promote-v1', 'live-promotion', 'sibling', 'grand', 'sibling', 'live-claim')
        with sqlite3.connect(self.db) as db:
            events = set(db.execute('SELECT entity,entity_id,session_id,kind FROM native_changes'))
        self.assertIn(('knowledge', 'live-claim', 'grand', 'knowledge-v1-node'), events)
        self.assertIn(('knowledge', 'live-support', 'grand', 'knowledge-v1-edge'), events)
        self.assertIn(('promotion', 'live-claim', 'sibling', 'promotion-v1'), events)


if __name__ == '__main__':
    unittest.main()
