"""Exercise the knowledge evaluation workflow with separate native processes.

Recording a v1 node or edge opens one authored-availability evaluation
request addressed to its author; the first promotion of a v1 record opens
one handoff request addressed to the promotion destination. Requests commit
in the same transaction as their triggering write, carry deterministic ids,
and never reopen on byte-equal replay, redelivery, re-promotion or twin
hits. Refused writes open nothing. Every call below is its own process.
"""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def context(**overrides):
    base = {'scope': 'test scope', 'subjects': [], 'conditions': [], 'assumptions': []}
    base.update(overrides)
    return base


DETAILS = {
    'question': {'topic': 'test topic', 'openQuestions': []},
    'claim': {'quantification': 'singular'},
    'argument': {'method': 'abduction', 'premises': [], 'derivation': 'test derivation'},
    'evidence': {'source': {'kind': 'artifact', 'uri': 'urn:test:source'},
                 'description': 'test description'},
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


class KnowledgeEval(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.repo = pathlib.Path(self.temp.name) / 'repository'
        self.repo.mkdir()
        self.checkouts = pathlib.Path(self.temp.name) / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['git', 'init', '-q', '-b', 'main', str(self.repo)],
                     ['git', '-C', str(self.repo), 'config', 'user.email', 'fixture@example.invalid'],
                     ['git', '-C', str(self.repo), 'config', 'user.name', 'Knowledge eval fixture']):
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
        rows = self.call('knowledge-scope', 'root', 'all', '', '--id', ident)
        self.assertEqual(len(rows), 1)
        return rows[0]

    def evaluations(self, ident):
        return self.detail(ident)['evaluations']

    def test_authored_request_opens_on_record_v1(self):
        answer = self.record(node('grand', 'ev-q1', 'question'))
        self.assertEqual(answer['evaluations'], [{
            'requestId': 'eval:v1:ev-q1:session:grand:authored',
            'trigger': 'authored',
            'destinationKind': 'session',
            'destination': 'grand',
            'requestedBy': 'grand',
            'decision': None,
            'rationale': None,
            'decidedBy': None,
        }])
        self.assertEqual(self.evaluations('ev-q1'), answer['evaluations'])

    def test_authored_request_opens_on_relate_v1(self):
        self.record(node('grand', 'ev-src', 'evidence'))
        self.record(node('grand', 'ev-dst', 'claim'))
        answer = self.relate(edge('grand', 'ev-e1', 'supports',
                                  ('ev-src', 'evidence'), ('ev-dst', 'claim'),
                                  details={'bearing': 'test bearing'}))
        self.assertEqual([row['requestId'] for row in answer['evaluations']],
                         ['eval:v1:ev-e1:session:grand:authored'])
        self.assertEqual(answer['evaluations'][0]['trigger'], 'authored')

    def test_handoff_request_opens_on_first_promotion(self):
        self.record(node('grand', 'ev-h1', 'question'))
        answers = self.call_rows('promote', 'ev-hp1', 'sibling', 'grand',
                                 'sibling', 'ev-h1')
        v1 = [row for row in answers if 'recordId' in row][0]
        self.assertEqual(v1['evaluationRequestId'],
                         'eval:v1:ev-h1:session:sibling:handoff')
        notice = self.call('delivery', 'ev-hp1:promotion-notice')
        self.assertEqual(notice['recipient'], 'sibling')
        self.assertEqual(json.loads(notice['body'])['evaluationRequestId'],
                         'eval:v1:ev-h1:session:sibling:handoff')
        held = self.evaluations('ev-h1')
        self.assertEqual([(row['trigger'], row['destination']) for row in held],
                         [('authored', 'grand'), ('handoff', 'sibling')])

    def test_replay_redelivery_and_repromotion_do_not_reopen(self):
        self.record(node('grand', 'ev-h2', 'question'))
        self.call_rows('promote', 'ev-hp2', 'sibling', 'grand', 'sibling', 'ev-h2')
        self.assertEqual(len(self.evaluations('ev-h2')), 2)
        # Byte-equal replay of the record reuses the authored request.
        self.record(node('grand', 'ev-h2', 'question'))
        self.assertEqual(len(self.evaluations('ev-h2')), 2)
        # Redelivery of the same promotion id reuses the handoff request.
        self.call_rows('promote', 'ev-hp2', 'sibling', 'grand', 'sibling', 'ev-h2')
        self.assertEqual(len(self.evaluations('ev-h2')), 2)
        # Re-promotion under a new id is not a new lifecycle event.
        self.call_rows('promote', 'ev-hp2b', 'sibling', 'grand', 'sibling', 'ev-h2')
        self.assertEqual(len(self.evaluations('ev-h2')), 2)

    def test_second_destination_opens_second_request(self):
        self.record(node('grand', 'ev-h3', 'question'))
        self.call_rows('promote', 'ev-hp3', 'sibling', 'grand', 'sibling', 'ev-h3')
        self.call_rows('promote', 'ev-hp3b', 'grand', 'grand', 'grand', 'ev-h3')
        held = self.evaluations('ev-h3')
        self.assertEqual(len(held), 3)
        self.assertEqual({(row['trigger'], row['destination']) for row in held},
                         {('authored', 'grand'), ('handoff', 'sibling'), ('handoff', 'grand')})

    def test_refused_write_opens_no_request(self):
        payload = edge('grand', 'ev-nope', 'supports',
                       ('ev-missing', 'evidence'), ('ev-missing', 'claim'),
                       details={'bearing': 'test bearing'})
        refused = self.call('relate-v1', json.dumps(payload), success=False)
        self.assertIn('v1-unresolved-endpoint', refused.stderr)
        rows = self.call('knowledge-scope', 'root', 'all', '', '--id', 'ev-nope')
        self.assertEqual(rows, [])

    def test_kindless_reference_names_shape(self):
        # The contract reference types require kind on every id reference,
        # so a kind-less basis entry is malformed shape, not a mismatch.
        argument = node('grand', 'ev-arg', 'argument', details={
            'method': 'deduction', 'premises': [], 'derivation': 'test derivation'})
        self.record(argument)
        self.record(node('grand', 'ev-claim', 'claim'))
        payload = edge('grand', 'ev-proof', 'proves',
                       ('ev-arg', 'argument'), ('ev-claim', 'claim'),
                       basis=[{'id': 'ev-claim'}],
                       details={'conclusion': 'test conclusion'})
        refused = self.call('relate-v1', json.dumps(payload), success=False)
        self.assertIn('v1-edge-shape', refused.stderr)

    def test_edge_notice_prompts_author_destination(self):
        self.record(node('grand', 'ev-ns', 'evidence'))
        self.record(node('grand', 'ev-nd', 'claim'))
        self.relate(edge('grand', 'ev-ne', 'supports',
                         ('ev-ns', 'evidence'), ('ev-nd', 'claim'),
                         details={'bearing': 'test bearing'}))
        notice = self.call('delivery', 'eval:v1:ev-ne:session:grand:authored:notice')
        self.assertEqual(notice['recipient'], 'grand')
        body = json.loads(notice['body'])
        self.assertEqual(body['evaluationRequest'],
                         'eval:v1:ev-ne:session:grand:authored')
        self.assertEqual(body['destination'], 'grand')
        self.assertEqual(body['trigger'], 'authored')

    def test_proof_rule_fires_for_unqualified_arguments(self):
        # implies and disproves need no conclusion; with a non-deduction
        # source argument the proof predicate fails and names v1-proof-rule.
        self.record(node('grand', 'ev-weak-arg', 'argument'))
        self.record(node('grand', 'ev-src-claim', 'claim'))
        self.record(node('grand', 'ev-tgt-claim', 'claim'))
        implies = edge('grand', 'ev-imp', 'implies',
                       ('ev-src-claim', 'claim'), ('ev-tgt-claim', 'claim'),
                       details={'argument': {'id': 'ev-weak-arg', 'kind': 'argument'},
                                'inferenceRule': 'test rule'})
        refused = self.call('relate-v1', json.dumps(implies), success=False)
        self.assertIn('v1-proof-rule', refused.stderr)
        disproves = edge('grand', 'ev-dis', 'disproves',
                         ('ev-weak-arg', 'argument'), ('ev-tgt-claim', 'claim'),
                         details={'refutedProposition': 'test proposition',
                                  'scopeOverlap': 'test overlap'})
        refused = self.call('relate-v1', json.dumps(disproves), success=False)
        self.assertIn('v1-proof-rule', refused.stderr)

    def test_proves_without_conclusion_names_shape(self):
        argument = node('grand', 'ev-arg2', 'argument', details={
            'method': 'deduction', 'premises': [], 'derivation': 'test derivation'})
        self.record(argument)
        self.record(node('grand', 'ev-claim2', 'claim'))
        payload = edge('grand', 'ev-proof2', 'proves',
                       ('ev-arg2', 'argument'), ('ev-claim2', 'claim'),
                       details={})
        refused = self.call('relate-v1', json.dumps(payload), success=False)
        self.assertIn('v1-edge-shape', refused.stderr)
