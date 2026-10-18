"""Behavioral fixtures for knowledge PRs 789, 790 and 791.

The entry drives AgentActions.parse and the production Knowledge/Store code
directly. No native attach, owner socket or Main entry is used.
"""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

EXE = pathlib.Path(os.environ['BATON2_EXE']).resolve()


class KnowledgeBehavior(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='knowledge-behavior-')
        self.addCleanup(self.temp.cleanup)
        self.db = pathlib.Path(self.temp.name) / 'state.db'
        self.call('seed', self.db)

    def call(self, *args, ok=True):
        if args and args[0] == 'seed':
            argv = [str(EXE), *map(str, args)]
        else:
            argv = [str(EXE), str(self.db), *map(str, args)]
        result = subprocess.run(argv, text=True,
                                capture_output=True, timeout=60)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            return result.stdout
        self.assertNotEqual(result.returncode, 0, result.stdout)
        return result

    def json_call(self, *args):
        return json.loads(self.call(*args))

    def test_789_scope_validation_and_typed_graph(self):
        self.call('record', 'finding-a', 'worker', 'observation', 'Alpha finding', 'run:a', '')
        self.call('record', 'finding-b', 'worker', 'hypothesis', 'Beta finding', 'run:b', '')
        self.call('relate', 'rel-a', 'worker', 'finding:finding-a', 'Supports', 'finding:finding-b')
        graph = self.json_call('search', 'root', 'worker', 'worker', 'finding')
        self.assertEqual(graph['scope'], {'kind': 'worker', 'id': 'worker'})
        self.assertIn('finding:finding-a', graph['roots'])
        edge = next(edge for edge in graph['edges'] if edge['id'] == 'rel-a')
        self.assertEqual(edge['relation'], 'Supports')
        self.assertEqual(edge['sourceKind'], 'observation')
        self.assertEqual(edge['targetKind'], 'hypothesis')
        traversed = self.json_call('traverse', 'root', 'worker', 'worker',
                                   'finding:finding-a', 'out', '', 'neighbors')
        self.assertEqual(traversed['roots'], ['finding:finding-a'])
        self.assertEqual(traversed['direction'], 'out')
        self.assertTrue(any(edge['id'] == 'rel-a' for edge in traversed['edges']))
        for command, error in (
                (('search', 'root', 'wrker', 'worker', 'finding'), 'knowledge-scope-invalid'),
                (('search', 'root', 'worker', '', 'finding'), 'knowledge-subject-required'),
                (('traverse', 'root', 'worker', 'worker', 'finding:finding-a',
                  'inout', '', 'neighbors'), 'knowledge-direction-invalid')):
            refused = self.call(*command, ok=False)
            self.assertEqual(json.loads(refused.stderr)['error'], error)

    def test_790_evidence_reference_resolution(self):
        self.call('record', 'pending-message', 'grand', 'observation',
                  'Pending citation', 'message:citation-message', '')
        detail = self.json_call('detail', 'root', 'pending-message')
        self.assertEqual(detail[0]['evidenceReference'],
                         {'reference': 'message:citation-message', 'kind': 'message',
                          'resolution': 'missing'})
        self.call('report', 'citation-message', 'worker', 'Retained body')
        detail = self.json_call('detail', 'root', 'pending-message')
        self.assertEqual(detail[0]['evidenceReference'],
                         {'reference': 'message:citation-message', 'kind': 'message',
                          'resolution': 'retained'})
        self.call('record', 'linked-finding', 'grand', 'finding',
                  'Linked citation', 'finding:source-finding', '')
        detail = self.json_call('detail', 'root', 'linked-finding')
        self.assertEqual(detail[0]['evidenceReference'],
                         {'reference': 'finding:source-finding', 'kind': 'finding',
                          'resolution': 'missing'})
        self.call('record', 'source-finding', 'grand', 'measurement',
                  'Source finding', 'run:source', '')
        detail = self.json_call('detail', 'root', 'linked-finding')
        self.assertEqual(detail[0]['evidenceReference'],
                         {'reference': 'finding:source-finding', 'kind': 'measurement',
                          'resolution': 'retained'})

    def test_connect_and_status_sql_terminate_with_the_expected_shape(self):
        connect = self.call('connect-sql', 'lead', '[]', '["/bin/echo"]')
        self.assertTrue(connect.startswith('UPDATE sessions SET native='), connect[:80])
        self.assertIn("'invalid-endpoint'", connect)
        self.assertIn("SELECT json_patch(json_object('id',id", connect)
        session = self.call('session-sql', "id='lead'")
        self.assertIn("FROM sessions WHERE id='lead';", session)
        self.assertIn("'taskCompletion'", session)
        status = self.call('status-sql')
        self.assertIn('json_group_array', status)
        self.assertIn("'endpointArgv'", status)

    def test_refused_classification_covers_every_stored_term(self):
        for term in ('player-assignment-conflict', 'message-route-denied',
                     'invalid-endpoint', 'message-id-conflict',
                     'relation-id-conflict', 'finding-id-conflict',
                     'knowledge-notice-conflict', 'promotion-id-conflict',
                     'promotion-notice-conflict', 'attach-parent-conflict',
                     'native-request-id-conflict', 'invalid-role',
                     'section-refused', 'ensemble-owner-conflict',
                     'ensemble-member-refused', 'report-recipient-missing'):
            body = '{"error":"%s"}' % term
            self.assertEqual(self.call('refused', body).strip(), 'true', term)
        self.assertEqual(self.call('refused', '{"error":"unknown"}').strip(), 'false')

    def test_791_relation_identity_notice_and_refusal_order(self):
        stored = self.json_call('relate', 'rel-1', 'worker', 'file:source',
                                'Supports', 'finding:target')
        self.assertEqual(stored, {'id': 'rel-1', 'author': 'worker', 'source': 'file:source',
                                  'relation': 'Supports', 'target': 'finding:target'})
        conflict = self.call('relate', 'rel-1', 'worker', 'file:source',
                             'Supersedes', 'finding:target', ok=False)
        self.assertEqual(json.loads(conflict.stderr)['error'], 'relation-id-conflict')
        self.assertEqual(self.call('refused',
                                   '{"error":"relation-id-conflict"}').strip(), 'true')
        self.assertEqual(self.call('refused',
                                   '{"error":"message-id-conflict"}').strip(), 'true')
        self.assertEqual(self.call('refused',
                                   '{"error":"finding-id-conflict"}').strip(), 'true')
        notice = self.call('notice', 'notice-finding', 'grand',
                           'Notice claim', 'run:notice', '')
        self.assertIn('INSERT INTO messages', notice)
        self.assertIn("json_object('finding'", notice)
        self.call('record', 'notice-finding', 'grand', 'observation',
                  'Notice claim', 'run:notice', '')
        inbox = self.json_call('inbox', 'worker')
        self.assertEqual(inbox[0]['body'], {'finding': 'notice-finding', 'author': 'grand'})


if __name__ == '__main__':
    unittest.main(verbosity=2)
