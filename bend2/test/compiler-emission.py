"""Compile literal dispatch, captured fallback and call-chain regressions."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('BEND_COMPILER_SOURCE', ROOT / 'bend2/compiler/upstream'))
FIXTURES = ROOT / 'bend2/test/compiler/fixtures'


class CompilerEmission(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bun = os.environ.get('BEND_BUN') or shutil.which('bun')
        cls.cc = os.environ.get('CC') or shutil.which('clang-19') or shutil.which('clang')
        if not cls.bun or not cls.cc:
            raise unittest.SkipTest('Bun and Clang are required')

    def test_report_type_and_erased_dependencies(self):
        with tempfile.TemporaryDirectory(prefix='bend-report-') as temporary:
            fixture = Path(temporary) / 'report.bend'
            fixture.write_text('''import Base

@unsafe
def Abstract(-n: Nat) -> Data:
  U32

def dependent(-n: Nat, value: Abstract(n)) -> U32:
  value

def annotated() -> U32:
  {0 : Abstract(0n)}

def erased(-T: Data, value: U32) -> U32:
  value

def erased_use() -> U32:
  erased(Abstract(0n), 0)

type Holder is Data:
  Wrapped{value: Abstract(0n)}

def safe() -> U32:
  0
''')
            run = subprocess.run([self.bun, '--smol', str(SOURCE / 'main.ts'),
                                  str(fixture), '--check-only'],
                                 capture_output=True, text=True,
                                 env={**os.environ, 'BEND_NO_TELEMETRY': '1'})
            self.assertEqual(run.returncode, 0, run.stderr)
            claims = {line[2:] for line in run.stdout.splitlines() if line.startswith('- ')}
            self.assertEqual(claims,
                             {'Abstract', 'dependent', 'annotated', 'erased_use', 'Holder'})

    def test_constructor_shadow(self):
        script = ROOT / 'bend2/test/compiler/ctor_shadow.ts'
        run = subprocess.run([self.bun, '--smol', str(script), str(ROOT)],
                             capture_output=True, text=True, env={
                                 **os.environ, 'BEND_COMPILER_SOURCE': str(SOURCE),
                                 'BEND_NO_TELEMETRY': '1'})
        self.assertEqual(run.returncode, 0, run.stderr)

    def test_literal_chain(self):
        with tempfile.TemporaryDirectory(prefix='bend-emission-') as temporary:
            directory = Path(temporary)
            c = directory / 'main.c'
            argv = [self.bun, '--smol', str(SOURCE / 'main.ts'),
                    str(FIXTURES / 'emission_chain.bend'), '-o', str(c)]
            if Path('/usr/bin/time').exists() and os.uname().sysname == 'Linux':
                argv = ['/usr/bin/time', '-v', '-o', str(directory / 'time'), *argv]
            run = subprocess.run(argv, capture_output=True, text=True, env={
                **os.environ, 'BEND_COMPILER_DIAGNOSTICS': '1', 'BEND_NO_TELEMETRY': '1'})
            self.assertEqual(run.returncode, 0, run.stderr)
            frames = []
            for line in run.stderr.splitlines():
                try:
                    frames.append(json.loads(line))
                except ValueError:
                    pass
            passes = [f for f in frames if f.get('compiler_diagnostic') == 'pass.end']
            reach = next(f for f in frames if f.get('compiler_diagnostic') == 'reach.end')
            self.assertEqual(passes[-1]['segments'], reach['segments'])
            self.assertLess(reach['segments'], 128)
            if (directory / 'time').exists():
                peak = int(re.search(r'Maximum resident set size \(kbytes\): (\d+)',
                                     (directory / 'time').read_text())[1])
                self.assertLess(peak, 256 * 1024, 'literal dispatch peak exceeds 256 MiB')
            build = subprocess.run([self.cc, '-std=c11', '-O1', '-w', str(c),
                                    '-lm', '-lpthread', '-o', str(directory / 'main')],
                                   capture_output=True, text=True)
            self.assertEqual(build.returncode, 0, build.stderr)
            for args, expected in [([], 'other'), (['--stop-hook'], 'stop'),
                                   (['--redeliver-message', 'db', 'id'], 'dbid'),
                                   (['--stop-hook', 'extra'], 'other'),
                                   (['--stop-hooj'], '--stop-hooj!'), (['🦉'], '🦉!')]:
                with self.subTest(args=args):
                    result = subprocess.run([str(directory / 'main'), *args],
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertEqual(result.stdout.strip(), expected)


if __name__ == '__main__':
    unittest.main()
