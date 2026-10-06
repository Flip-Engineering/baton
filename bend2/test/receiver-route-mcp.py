"""Future adapter cases using the existing recording-executable fixture."""
import importlib.util
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


if __name__ == '__main__':
    unittest.main()
