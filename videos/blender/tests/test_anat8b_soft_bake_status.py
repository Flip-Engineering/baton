import ast
import pathlib
import unittest

SOURCE = pathlib.Path(__file__).resolve().parents[1] / 'anat8b_soft_job.py'
module = ast.parse(SOURCE.read_text())
helper = next(node for node in module.body
              if isinstance(node, ast.FunctionDef) and node.name == 'classify_bake_completion')
namespace = {}
exec(compile(ast.Module(body=[helper], type_ignores=[]), str(SOURCE), 'exec'), namespace)
classify = namespace['classify_bake_completion']


class SoftBakeStatusTests(unittest.TestCase):
    def test_current_key_cache_hit_is_success_without_a_new_write(self):
        result = classify(
            'L08_f24_hispanic', 0,
            'soft_bake: L08_f24_hispanic: the bake is current (aa4adbaf:13380 sk3.mu2.so1.br12.env1)\n',
            True, 100, 200, 3.2)
        self.assertFalse(result['written'])
        self.assertTrue(result['reused_current'])
        self.assertTrue(result['success'])
        self.assertEqual(result['state'], 'reused-current')

    def test_newly_written_file_is_success(self):
        result = classify('person', 0, 'soft: solved\n', True, 300, 200, 10)
        self.assertTrue(result['written'])
        self.assertFalse(result['reused_current'])
        self.assertTrue(result['success'])
        self.assertEqual(result['state'], 'written')

    def test_stale_file_without_current_key_receipt_is_unverified(self):
        result = classify('person', 0, 'soft_bake: person done in 1 s\n', True, 100, 200, 1)
        self.assertFalse(result['written'])
        self.assertFalse(result['reused_current'])
        self.assertFalse(result['success'])
        self.assertEqual(result['state'], 'unverified')

    def test_current_receipt_requires_matching_person_success_and_output(self):
        line = 'soft_bake: person: the bake is current (body solver)\n'
        cases = [
            classify('person', 1, line, True, 100, 200, 1),
            classify('person', 0, line, False, 0, 200, 1),
            classify('person', 0, line.replace('person:', 'person-other:'), True, 100, 200, 1),
        ]
        self.assertEqual([case['state'] for case in cases], ['failed', 'missing', 'unverified'])
        self.assertTrue(all(not case['success'] and not case['reused_current'] for case in cases))


if __name__ == '__main__':
    unittest.main()
