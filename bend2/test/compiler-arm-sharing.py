"""Protected compiler tests for match-arm sharing and arm equality.

The tests run the checked-in REPL compiler source in
``bend2/compiler/upstream`` under Bun. They exercise the arm-equality
semantics directly, the duplicated-arm sharing decisions, and the emitted C
and runtime results of the protected Nat/U32 fixtures.

Prerequisites are a Bun executable (``BEND_BUN`` or ``BUN`` on PATH) and a C
compiler (``CC``, ``clang-19``, or ``clang`` on PATH). A missing prerequisite
skips the tests, as the other compiler-frontend tests do.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
UPSTREAM = pathlib.Path(os.environ.get('BEND_COMPILER_SOURCE', ROOT / 'bend2/compiler/upstream'))
TEST_DIR = ROOT / 'bend2/test/compiler'
FIXTURES = TEST_DIR / 'fixtures'


def find_bun():
    for value in (os.environ.get('BEND_BUN'), os.environ.get('BUN')):
        if value:
            return value
    return shutil.which('bun')


def find_cc():
    for value in (os.environ.get('CC'), 'clang-19', 'clang', 'cc'):
        if value and (pathlib.Path(value).is_file() or shutil.which(value)):
            return value
    return None


class CompilerArmSharing(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bun = find_bun()
        cls.cc = find_cc()
        if cls.bun is None:
            raise unittest.SkipTest('Bun is unavailable')
        if cls.cc is None:
            raise unittest.SkipTest('a C compiler is unavailable')
        cls.temp = tempfile.TemporaryDirectory(prefix='compiler-arm-sharing-')
        cls.compiler = pathlib.Path(cls.temp.name) / 'compiler'
        bend2 = cls.compiler / 'bend2'
        bend2.mkdir(parents=True)
        (cls.compiler / 'bin').mkdir()
        for name in ('comp.ts', 'bend.ts', 'base.bend'):
            shutil.copyfile(UPSTREAM / name, bend2 / name)
        shutil.copytree(UPSTREAM / 'effs', bend2 / 'effs')
        (cls.compiler / 'bin/bun').symlink_to(pathlib.Path(cls.bun).resolve())

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def run_bun(self, *argv, **kwargs):
        result = subprocess.run(
            [self.bun, '--smol', *map(str, argv)],
            capture_output=True, text=True, timeout=180, **kwargs)
        self.assertEqual(result.returncode, 0,
                         msg='command failed: %s\nstdout:\n%s\nstderr:\n%s'
                         % (' '.join(map(str, argv)), result.stdout, result.stderr))
        return result

    def build_and_run(self, source, argv_results):
        binary = source.with_suffix('.bin')
        build = subprocess.run(
            [self.cc, '-O1', '-w', str(source), '-lm', '-lpthread', '-o', str(binary)],
            capture_output=True, text=True, timeout=180)
        self.assertEqual(build.returncode, 0, msg=build.stderr)
        for argv, expected in argv_results:
            run = subprocess.run([str(binary), *argv], capture_output=True,
                                 text=True, timeout=30)
            self.assertEqual(run.returncode, 0, msg=run.stderr)
            self.assertEqual(run.stdout.strip(), expected)

    def mutated_c(self, test_name):
        source = pathlib.Path(self.temp.name) / (test_name + '.c')
        self.run_bun(TEST_DIR / (test_name + '.ts'), self.compiler,
                     env={**os.environ, 'ARM_EQ_C': str(source)})
        self.assertTrue(source.is_file(), msg='the test did not write ' + str(source))
        return source

    def test_binder_key_semantics(self):
        result = self.run_bun(TEST_DIR / 'arm_eq_binder_key.ts', self.compiler)
        self.assertIn('PASS all', result.stdout)
        self.assertIn('PASS ann', result.stdout)
        self.assertIn('PASS control', result.stdout)

    def test_native_arm_collision(self):
        fixture = FIXTURES / 'native_arm_collision.bend'
        source = pathlib.Path(self.temp.name) / 'native_arm_collision.c'
        self.run_bun(UPSTREAM / 'main.ts', fixture, '-o', source)
        text = source.read_text()
        names = re.findall(r'^(?:INLINE|FAR) Term (\w*arm_\d+)\(', text, re.M)
        self.assertTrue(names, msg='the fixture emitted no shared arms')
        self.assertIn('spin_', text, msg='the fixture emitted no native spin')
        self.assertEqual(len(names), len(set(names)),
                         msg='a native spin reused an arm name: %r' % names)
        self.build_and_run(source, [([], 'empty'), (['hello'], 'hello')])

    def test_nonflat_call_in_arm_keeps_segment_context(self):
        fixture = FIXTURES / 'arm_nonflat_call.bend'
        source = pathlib.Path(self.temp.name) / 'arm_nonflat_call.c'
        self.run_bun(UPSTREAM / 'main.ts', fixture, '-o', source)
        self.build_and_run(source, [
            (['a'], 'one'),
            (['z'], 'xy'),
            ([], 'xy'),
        ])

    def test_ann_share_regression(self):
        source = self.mutated_c('arm_eq_ann_share')
        self.build_and_run(source, [
            (['--host-process-keeper', 'a', 'b'], 'host'),
            (['a', 'b'], 'two'),
            ([], 'other'),
        ])

    def test_ref_bang_share_regression(self):
        source = self.mutated_c('arm_eq_ref_bang_share')
        self.build_and_run(source, [
            (['--host-process-keeper', 'a', 'b'], 'host'),
            (['a', 'b'], 'two'),
            ([], 'other'),
        ])

    def test_ref_bang_variants(self):
        for name in ('ref_bang_plain', 'ref_bang_marked'):
            with self.subTest(fixture=name):
                c = pathlib.Path(self.temp.name) / (name + '.c')
                self.run_bun(UPSTREAM / 'main.ts', FIXTURES / (name + '.bend'), '-o', c)
                self.build_and_run(c, [([], '5')])

    def test_protected_nat_u32(self):
        expected = {
            'nat_pattern_deep': '306n',
            'u32_table_bitvar': '2496 2397',
            'word_match_cover_key': '2139095040 2143289344 0 0 2139095040 2143289344',
            'match_default': '0n',
        }
        for name, output in expected.items():
            with self.subTest(fixture=name):
                fixture = FIXTURES / (name + '.bend')
                check = self.run_bun(UPSTREAM / 'main.ts', fixture, '--check-only')
                self.assertEqual(check.stdout.strip(), 'All terms check.')
                c = pathlib.Path(self.temp.name) / (name + '.c')
                self.run_bun(UPSTREAM / 'main.ts', fixture, '-o', c)
                self.build_and_run(c, [([], output)])


if __name__ == '__main__':
    unittest.main()
