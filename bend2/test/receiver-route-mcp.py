"""Future adapter cases using the existing recording-executable fixture."""
import importlib.util
import json
from pathlib import Path
import unittest


spec = importlib.util.spec_from_file_location('index_mcp', Path(__file__).with_name('control-index-mcp.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ReceiverRouteMcp(unittest.TestCase):
    setUp = fixture.ControlIndexMcp.setUp
    exchange = fixture.ControlIndexMcp.exchange

    def test_explicit_subject_and_endpoint_are_literal_and_native_refusal_is_an_error(self):
        endpoint = '["/tool with spaces","line\\nvalue"]'
        result, calls = self.exchange('baton2_receiver_route_inspect', {
            'player': 'selected child', 'expectedModel': 'old', 'expectedEndpoint': endpoint,
            'model': 'deepseek/deepseek-flash'}, code=2,
            stderr='{"status":"unavailable","configurationApplied":false}\n')
        self.assertEqual(calls, [[str(self.database), 'receiver-route', 'selected child',
                                 'old', endpoint, 'deepseek/deepseek-flash', '--inspect']])
        self.assertTrue(result['isError'])
        self.assertIn('"configurationApplied":false', result['content'][0]['text'])
        self.assertIn('exit code: 2', result['content'][0]['text'])

    def test_invalid_fields_refuse_before_native_dispatch(self):
        valid = {'player': 'child', 'expectedModel': 'old', 'expectedEndpoint': '[]', 'model': 'new'}
        for invalid in (dict(valid, model=7), dict(valid, model='bad\0model'),
                        dict(valid, worker='other'), {k: v for k, v in valid.items() if k != 'expectedEndpoint'}):
            with self.subTest(arguments=invalid):
                result, calls = self.exchange('baton2_receiver_route_inspect', invalid)
                self.assertTrue(result['isError'])
                self.assertEqual(calls, [])

    def test_configuration_uses_attachment_requester_and_literal_snapshot(self):
        snapshot = '{"model":"old", "endpoint":"line\\nvalue"}'
        args = {'player': 'child', 'expectedAssignment': snapshot, 'harness': 'omp',
                'model': 'new', 'effort': 'high', 'command': '/native with spaces', 'log': '/out'}
        result, calls = self.exchange('baton2_receiver_route', args, session='actual-parent',
                                      stdout='{"status":"configured","providerStarted":false}\n')
        self.assertEqual(calls, [[str(self.database), 'receiver-route', 'child', 'actual-parent',
                                 snapshot, 'omp', 'new', 'high', '/native with spaces', '/out', '--apply']])
        self.assertFalse(result.get('isError'))
        for key in ('requester', 'configuration', 'session'):
            result, calls = self.exchange('baton2_receiver_route', dict(args, **{key: 'injected'}))
            self.assertTrue(result['isError'])
            self.assertEqual(calls, [])

    def test_new_inspection_and_configuration_uncertainty(self):
        result, calls = self.exchange('baton2_receiver_route', {'player': 'child'})
        self.assertEqual(calls, [[str(self.database), 'receiver-route', 'child', '--inspect']])
        args = {'player': 'child', 'expectedAssignment': '{}', 'harness': 'omp',
                'model': 'new', 'effort': '', 'command': '/omp', 'log': '/out'}
        result, calls = self.exchange('baton2_receiver_route', args, code=2,
                                      stderr='{"status":"configuration-outcome-unknown","configurationApplied":null}\n')
        self.assertEqual(len(calls), 1)
        self.assertTrue(result['isError'])
        self.assertIn('configuration-outcome-unknown', result['content'][0]['text'])

    def test_recovery_handoff_results_remain_configuration_errors(self):
        args = {'player': 'child', 'expectedAssignment': '{}', 'harness': 'omp',
                'model': 'new', 'effort': 'high', 'command': '/omp', 'log': '/out'}
        for handoff in ({'kind': 'done', 'output': ''},
                        {'kind': 'failed', 'code': 73, 'error': 'endpoint changed before invocation'}):
            body = json.dumps({'status': 'configuration-recovery-required',
                               'configurationApplied': False, 'handoff': handoff})
            result, calls = self.exchange('baton2_receiver_route', args, code=2, stderr=body)
            self.assertEqual(len(calls), 1)
            self.assertTrue(result['isError'])
            self.assertIn(body, result['content'][0]['text'])


if __name__ == '__main__':
    unittest.main()
