"""Protected compiler tests for match-arm sharing and arm equality.

The tests run the checked-in REPL compiler source in
``bend2/compiler/upstream`` under Bun. They exercise the arm-equality
semantics directly, the duplicated-arm sharing decisions, and the emitted C
and runtime results of the protected Nat/U32 fixtures.

Prerequisites are a Bun executable (``BEND_BUN`` or ``BUN`` on PATH) and a C
compiler (``CC``, ``clang-19``, or ``clang`` on PATH). A missing prerequisite
skips the tests, as the other compiler-frontend tests do.
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import tempfile
import unittest
import compile_queue

ROOT = pathlib.Path(__file__).resolve().parents[2]
UPSTREAM = ROOT / 'bend2/compiler/upstream'
TEST_DIR = ROOT / 'bend2/test/compiler'
FIXTURES = TEST_DIR / 'fixtures'


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


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


def find_queue():
    # All native compiler work uses the shared host queue.
    return compile_queue.queue_entry()


def shared_queue_root():
    value = os.environ.get('BATON_COMPILE_QUEUE_ROOT')
    if not value or not pathlib.Path(value).is_absolute():
        raise RuntimeError('set BATON_COMPILE_QUEUE_ROOT to the shared absolute queue state directory')
    return pathlib.Path(value)


def upstream_sources():
    return [path for path in UPSTREAM.rglob('*')
            if path.is_file() and path.suffix in ('.ts', '.c', '.js')]


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
        cls.queue = find_queue()
        if cls.queue is None:
            raise unittest.SkipTest('the shared compile queue executable is unavailable')
        cls.state = shared_queue_root()
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

    def run_queue(self, args):
        result = subprocess.run(
            compile_queue.queue_command(self.queue, args),
            capture_output=True, text=True, timeout=600)
        self.assertEqual(result.returncode, 0,
                         msg='queue failed: %s\nstdout:\n%s\nstderr:\n%s'
                         % (' '.join(map(str, args)), result.stdout, result.stderr))
        return result

    def run_cgen(self, tag, fixture, source):
        # Include the compiler frontend and runtime files in the queue key.
        inputs = [path for path in sorted(UPSTREAM.rglob('*')) if path.is_file()]
        args = [
            'run', '--kind', 'cgen', '--state-root', self.state, '--cwd', ROOT,
            '--root', ROOT, '--source-root', ROOT,
            '--entry', fixture.relative_to(ROOT).as_posix(),
            '--compiler', self.bun, '--artifact', 'c=%s' % source,
            '--option', 'test=%s' % tag,
        ]
        for path in inputs:
            args.extend(['--input', path])
        args.extend(['--', self.bun, '--smol', UPSTREAM / 'main.ts', fixture, '-o', source])
        self.run_queue(args)

    def compile_fixture(self, tag, fixture, source):
        self.run_cgen(tag, fixture, source)

    def build_and_run(self, source, argv_results):
        binary = source.with_suffix('.bin')
        linker, version = compile_queue.compiler_identity(self.cc)
        self.run_queue([
            'run', '--kind', 'cc', '--state-root', self.state, '--cwd', ROOT,
            '--compiler', self.cc, '--linker', linker, '--version', version,
            '--source-root', str(source.parent.resolve()),
            '--input', source,
            '--artifact', 'binary=%s' % binary, '--option', 'test=%s' % source.stem,
            '--', self.cc, '-O1', '-w', source, '-lm', '-lpthread', '-o', binary])
        for argv, expected in argv_results:
            run = subprocess.run([str(binary), *argv], capture_output=True,
                                 text=True, timeout=30)
            self.assertEqual(run.returncode, 0, msg=run.stderr)
            self.assertEqual(run.stdout.strip(), expected)

    def mutated_c(self, test_name):
        source = pathlib.Path(self.temp.name) / (test_name + '.c')
        fixture = TEST_DIR / (test_name + '.ts')
        compiler_sources = [path for path in sorted((self.compiler / 'bend2').rglob('*'))
                            if path.is_file()]
        # The queue rewrites exact path arguments to staged inputs/artifacts.
        # Pass the output as a positional argument so it can stage the path,
        # then set ARM_EQ_C inside this wrapper.
        wrapper = pathlib.Path(self.temp.name) / (test_name + '-cgen.sh')
        wrapper.write_text('#!/bin/sh\nout=$1\nshift\nARM_EQ_C=$out exec "$@"\n')
        wrapper.chmod(0o755)
        inputs = [fixture, *compiler_sources, wrapper]
        source_root = compile_queue.common_source_root(inputs, ROOT)
        args = [
            'run', '--kind', 'cgen', '--state-root', self.state, '--cwd', ROOT,
            '--root', ROOT, '--source-root', str(source_root),
            '--entry', str(fixture),
            '--compiler', self.bun, '--artifact', 'c=%s' % source,
            '--option', 'test=%s' % test_name,
        ]
        for path in inputs:
            args.extend(['--input', path])
        args.extend(['--', wrapper, source, self.bun, '--smol',
                     fixture, self.compiler])
        self.run_queue(args)
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
        self.compile_fixture('native_arm_collision', fixture, source)
        text = source.read_text()
        names = re.findall(r'^(?:INLINE|FAR) Term (arm_\d+)\(', text, re.M)
        self.assertTrue(names, msg='the fixture emitted no shared arms')
        self.assertIn('spin_', text, msg='the fixture emitted no native spin')
        self.assertEqual(len(names), len(set(names)),
                         msg='a native spin reused an arm name: %r' % names)
        self.assertEqual(sorted(set(names)), ['arm_1', 'arm_3'],
                         msg='unexpected shared-arm names: %r' % names)
        self.build_and_run(source, [([], 'empty'), (['hello'], 'hello')])

    def test_nonflat_call_in_arm_keeps_segment_context(self):
        fixture = FIXTURES / 'arm_nonflat_call.bend'
        source = pathlib.Path(self.temp.name) / 'arm_nonflat_call.c'
        self.compile_fixture('arm_nonflat_call', fixture, source)
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
        expected = {
            'ref_bang_plain': ('877f8e3b7fb159951f0e038a44a0ea63fbb453e5f14edca53e5fb2959447ebbe', '5'),
            'ref_bang_marked': ('185329de2742e9b826ed8fac4ce3862bbb995daa507803833bef918be1daf8b0', '5'),
        }
        for name, (digest, output) in expected.items():
            with self.subTest(fixture=name):
                c = pathlib.Path(self.temp.name) / (name + '.c')
                self.compile_fixture(name, FIXTURES / (name + '.bend'), c)
                self.assertEqual(sha256(c), digest)
                self.build_and_run(c, [([], output)])

    def test_protected_nat_u32(self):
        expected = {
            'nat_pattern_deep': ('1333cb537122c753028f86cd366e5a063ed06812b7c30b23d5bd8b7ce935fe85', '306n'),
            'u32_table_bitvar': ('a94a327ba27ec2c6ddd756b940c4d52b5e49c0755d84391a2264b84a9e57cf81', '2496 2397'),
            'word_match_cover_key': ('a07e5b0a1da29a8edfc2e370b034f85bd9764880dd05f14054cb4170f5692785',
                                     '2139095040 2143289344 0 0 2139095040 2143289344'),
            'match_default': ('d5a4b87bca0fb04b31e3da5c6032909250ec5dbd18451f148c355d1522cbef5f', '0n'),
        }
        for name, (digest, output) in expected.items():
            with self.subTest(fixture=name):
                fixture = FIXTURES / (name + '.bend')
                check = self.run_bun(UPSTREAM / 'main.ts', fixture, '--check-only')
                self.assertEqual(check.stdout.strip(), 'All terms check.')
                c = pathlib.Path(self.temp.name) / (name + '.c')
                self.compile_fixture(name, fixture, c)
                self.assertEqual(sha256(c), digest)
                self.build_and_run(c, [([], output)])


if __name__ == '__main__':
    unittest.main()
