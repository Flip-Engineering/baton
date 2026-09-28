"""Check script: one selected unittest file judged with failure identities."""
import pathlib
import re
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/check-unittest.sh'

PASSING = '''
import unittest

class Quiet(unittest.TestCase):
    def test_passes(self):
        self.assertEqual(1, 1)
'''

FAILING = '''
import unittest

class Broken(unittest.TestCase):
    def test_fails(self):
        self.assertEqual(1, 2)

    def test_errors(self):
        raise ValueError('boom')
'''

NOISY = 'import sys\nprint("hello")\nraise SystemExit(1)\n'

EMPTY = 'import unittest\n'

SKIPPED = '''
import unittest

class AllSkipped(unittest.TestCase):
    @unittest.skip('later')
    def test_skipped(self):
        self.fail('never')

    @unittest.skipIf(True, 'condition')
    def test_also_skipped(self):
        self.fail('never')
'''

MIXED = '''
import unittest

class Mixed(unittest.TestCase):
    def test_passes(self):
        self.assertEqual(1, 1)

    @unittest.skip('later')
    def test_skipped(self):
        self.fail('never')
'''

UNEXPECTED_SUCCESS = '''
import unittest

class Unexpected(unittest.TestCase):
    @unittest.expectedFailure
    def test_passes_despite_expectation(self):
        self.assertEqual(1, 1)
'''

EXPECTED_FAILURE = '''
import unittest

class Expected(unittest.TestCase):
    @unittest.expectedFailure
    def test_fails_as_expected(self):
        self.assertEqual(1, 2)
'''


def run_script(tree, selected):
    return subprocess.run(
        ['/bin/sh', str(SCRIPT), selected],
        cwd=tree, text=True, capture_output=True,
    )


def decode(line):
    fields = line.split(' ')
    return [bytes.fromhex(field).decode() for field in fields]


class CheckUnittest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.tree = pathlib.Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, name, body):
        (self.tree / name).write_text(body)

    def assert_unjudged(self, p):
        self.assertEqual(p.returncode, 1, p.stderr)
        self.assertNotEqual(p.stdout, '')
        for line in p.stdout.splitlines():
            fields = line.split(' ')
            hexes = all(re.fullmatch(r'[0-9a-f]+', f) for f in fields)
            self.assertFalse(len(fields) == 4 and hexes, line)

    def test_passing_file_prints_nothing_and_exits_zero(self):
        self.fixture('quiet.py', PASSING)
        p = run_script(self.tree, 'quiet.py')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, '')

    def test_failing_file_prints_one_identity_per_case(self):
        self.fixture('broken.py', FAILING)
        p = run_script(self.tree, 'broken.py')
        self.assertEqual(p.returncode, 1, p.stderr)
        lines = p.stdout.splitlines()
        self.assertEqual(len(lines), 2)
        rows = [decode(line) for line in lines]
        self.assertEqual(rows[0], ['broken.py', 'bend2_selected_broken.Broken.test_fails', 'assertion', '-'])
        self.assertEqual(rows[1], ['broken.py', 'bend2_selected_broken.Broken.test_errors', 'error', '-'])

    def test_identity_lines_match_the_landing_contract_shape(self):
        self.fixture('broken.py', FAILING)
        p = run_script(self.tree, 'broken.py')
        for line in p.stdout.splitlines():
            fields = line.split(' ')
            self.assertEqual(len(fields), 4, line)
            for field in fields:
                self.assertGreater(len(field), 0)
                self.assertTrue(re.fullmatch(r'[0-9a-f]+', field), line)

    def test_identical_failures_in_two_trees_print_identical_lines(self):
        self.fixture('broken.py', FAILING)
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as other:
            other_tree = pathlib.Path(other)
            (other_tree / 'broken.py').write_text(FAILING)
            first = run_script(self.tree, 'broken.py')
            second = run_script(other_tree, 'broken.py')
        self.assertEqual(first.returncode, 1)
        self.assertEqual(first.stdout, second.stdout)

    def test_missing_file_fails_with_the_load_identity(self):
        p = run_script(self.tree, 'absent.py')
        self.assertEqual(p.returncode, 1, p.stderr)
        self.assertEqual(decode(p.stdout.strip()), ['absent.py', 'load', 'missing-file', '-'])

    def test_stdout_that_is_not_an_identity_line_travels_whole(self):
        self.fixture('noisy.py', NOISY)
        p = run_script(self.tree, 'noisy.py')
        self.assertEqual(p.returncode, 1)
        self.assertIn('hello', p.stdout)
        with self.assertRaises(ValueError):
            decode(p.stdout.strip())

    def test_file_with_no_tests_is_unjudged(self):
        self.fixture('empty.py', EMPTY)
        p = run_script(self.tree, 'empty.py')
        self.assert_unjudged(p)
        self.assertIn('unjudged', p.stdout)

    def test_entirely_skipped_suite_is_unjudged(self):
        self.fixture('skipped.py', SKIPPED)
        p = run_script(self.tree, 'skipped.py')
        self.assert_unjudged(p)
        self.assertIn('test_skipped', p.stdout)
        self.assertIn('test_also_skipped', p.stdout)

    def test_passing_suite_with_a_skipped_case_is_unjudged(self):
        self.fixture('mixed.py', MIXED)
        p = run_script(self.tree, 'mixed.py')
        self.assert_unjudged(p)
        self.assertIn('test_skipped', p.stdout)

    def test_identical_omissions_in_two_trees_stay_unjudged(self):
        self.fixture('skipped.py', SKIPPED)
        first = run_script(self.tree, 'skipped.py')
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as other:
            other_tree = pathlib.Path(other)
            (other_tree / 'skipped.py').write_text(SKIPPED)
            second = run_script(other_tree, 'skipped.py')
        self.assert_unjudged(first)
        self.assert_unjudged(second)
        self.assertEqual(first.stdout, second.stdout)

    def test_unexpected_success_is_a_failure_identity(self):
        self.fixture('unexpected.py', UNEXPECTED_SUCCESS)
        p = run_script(self.tree, 'unexpected.py')
        self.assertEqual(p.returncode, 1, p.stderr)
        self.assertEqual(
            decode(p.stdout.strip()),
            ['unexpected.py',
             'bend2_selected_unexpected.Unexpected.test_passes_despite_expectation',
             'unexpected-success', '-'],
        )

    def test_expected_failure_that_fails_passes_quietly(self):
        self.fixture('expected.py', EXPECTED_FAILURE)
        p = run_script(self.tree, 'expected.py')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, '')


if __name__ == '__main__':
    unittest.main()
