"""Validate module emission, imported interfaces and foreign source changes."""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(os.environ.get('BEND_COMPILER_SOURCE', ROOT / 'bend2/compiler/upstream'))


class CompilerModules(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bun = os.environ.get('BEND_BUN') or shutil.which('bun')
        cls.cc = os.environ.get('CC') or shutil.which('clang-19') or shutil.which('clang')
        if not cls.bun or not cls.cc:
            raise unittest.SkipTest('Bun and Clang are required')
        cls.temporary = tempfile.TemporaryDirectory(prefix='bend-module-tests-')
        cls.directory = Path(cls.temporary.name)
        cls.runner = cls.directory / 'compile.ts'
        cls.runner.write_text('''import fs from "node:fs";
import * as Bend from %s;
import * as Comp from %s;
import * as Modules from %s;
const [entry, output, cache, mode] = process.argv.slice(2);
try {
  const book = Bend.book_nil(), seen = new Map();
  await Bend.book_load(book, entry, "", seen);
  Bend.book_valid(book);
  if (mode === "single") fs.writeFileSync(output, Comp.compile_book(book));
  else await Modules.compile_book(book, seen, output, cache);
} catch (error) {
  console.error(error?.$ === "Err" ? Bend.err_show(error) : String(error));
  process.exitCode = 1;
}
''' % tuple(json.dumps(str(SOURCE / file)) for file in ('bend.ts', 'comp.ts', 'modules.ts')))

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def fixture(self, name, files):
        directory = self.directory / name
        directory.mkdir()
        for file, text in files.items():
            (directory / file).write_text(text)
        return directory

    def compile(self, directory, label, cache='cache', mode='modules'):
        output = directory / (label + '.c')
        argv = [self.bun, '--smol', str(self.runner), str(directory / 'main.bend'),
                str(output), str(directory / cache), mode]
        started = time.monotonic()
        run = subprocess.run(argv, capture_output=True, text=True, env={**os.environ,
            'BEND_COMPILER_DIAGNOSTICS': '1', 'BEND_NO_TELEMETRY': '1'})
        (directory / (label + '.stdout')).write_text(run.stdout)
        (directory / (label + '.stderr')).write_text(run.stderr)
        (directory / (label + '.result.json')).write_text(json.dumps({
            'argv': argv, 'exit': run.returncode, 'wall_seconds': time.monotonic() - started,
            'completed': datetime.datetime.now(datetime.timezone.utc).isoformat(),
            'compiler_files': {f.name: hashlib.sha256(f.read_bytes()).hexdigest()
                               for f in SOURCE.glob('*.ts')},
        }, indent=2))
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
        if mode == 'modules':
            for execution in (directory / cache / 'runs').glob('*/execution.json'):
                record = json.loads(execution.read_text())
                self.assertEqual(record['code'], 0, record)
                self.assertIsNone(record['signal'], record)
                self.assertIn('ended', record)
        binary = directory / label
        build = subprocess.run([self.cc, '-std=c11', '-O1', '-w', str(output), '-lm',
                                '-pthread', '-o', str(binary)], capture_output=True, text=True)
        self.assertEqual(build.returncode, 0, build.stderr)
        return output, binary, frames

    def run_value(self, binary):
        run = subprocess.run([str(binary)], capture_output=True, text=True)
        self.assertEqual(run.returncode, 0, run.stderr)
        return run.stdout.strip()

    def emitted(self, frames):
        return {Path(f['module']) for f in frames if f.get('compiler_diagnostic') == 'module.begin'}

    def test_only_changed_module_emits(self):
        directory = self.fixture('independent', {
            'a.bend': 'import Base\ndef value(x: U32) -> U32:\n  (x + 1 : U32)\n',
            'b.bend': 'import Base\ndef value(x: U32) -> U32:\n  (x * 2 : U32)\n',
            'main.bend': '''import Base
import ./a.bend as A
import ./b.bend as B
def main() -> U32:
  A.value(B.value(20))
''',
        })
        cold, binary, frames = self.compile(directory, 'cold')
        self.assertEqual(self.run_value(binary), '41')
        self.assertTrue({directory / 'a.bend', directory / 'b.bend'} <= self.emitted(frames))
        warm, binary, frames = self.compile(directory, 'warm')
        self.assertEqual(self.run_value(binary), '41')
        self.assertEqual(self.emitted(frames), set())
        self.assertEqual(warm.read_bytes(), cold.read_bytes())
        (directory / 'a.bend').write_text('import Base\ndef value(x: U32) -> U32:\n  (x + 3 : U32)\n')
        _, binary, frames = self.compile(directory, 'changed')
        self.assertEqual(self.run_value(binary), '43')
        self.assertEqual(self.emitted(frames), {directory / 'a.bend'})

    def test_foreign_only_edit_matches_clean_link(self):
        directory = self.fixture('foreign', {
            'effect.bend': '''import Base
def Custom.text() -> IO(String):
  import "./effect.c"
''',
            'effect.c': '''Term custom_text_run(Env e, Term* f, IoWork* w) {
  return io_str(e, "first", 5);
}
static void __attribute__((constructor)) custom_text_use(void) {
  io_eff(CID_CUSTOM_TEXT, custom_text_run, 0);
}
''',
            'main.bend': '''import Base
import ./effect.bend as E
def main() -> IO(Unit):
  do IO<Unit>:
    text : String <- E.Custom.text()
    IO.print(text)
''',
        })
        _, binary, _ = self.compile(directory, 'cold')
        self.assertEqual(self.run_value(binary), 'first')
        foreign = directory / 'effect.c'
        foreign.write_text(foreign.read_text().replace('io_str(e, "first", 5)', 'term_pak(CID_SNIL, 0)'))
        cached, binary, frames = self.compile(directory, 'changed')
        self.assertEqual(self.run_value(binary), '')
        self.assertEqual(self.emitted(frames), {directory / 'effect.bend'})
        clean, binary, _ = self.compile(directory, 'clean', cache='clean-cache')
        self.assertEqual(self.run_value(binary), '')
        self.assertEqual(cached.read_bytes(), clean.read_bytes())

    def test_imported_law_uses_implementation_module(self):
        directory = self.fixture('law', {
            'api.bend': '''import Base
law value:
  for x: U32
  U32
''',
            'main.bend': '''import Base
import ./api.bend as A
def A.value(x):
  (x + 2 : U32)
def main() -> U32:
  A.value(40)
''',
        })
        _, binary, frames = self.compile(directory, 'modules')
        self.assertEqual(self.run_value(binary), '42')
        self.assertEqual(self.emitted(frames), {directory / 'main.bend'})

    def test_new_facts_reuse_unaffected_definitions(self):
        directory = self.fixture('facts', {'main.bend':
            (ROOT / 'bend2/test/compiler/fixtures/ref_bang_marked.bend').read_text()})
        _, binary, frames = self.compile(directory, 'modules')
        self.assertEqual(self.run_value(binary), '5')
        definitions = [f for f in frames if f.get('compiler_diagnostic') == 'definition.end']
        self.assertEqual(sum(f['name'] == 'deep' for f in definitions), 1)
        self.assertTrue(any(f.get('compiler_diagnostic') == 'definition.reuse'
                            and f['name'] == 'deep' for f in frames))

    def test_affine_array_crosses_modules(self):
        directory = self.fixture('array', {
            'a.bend': '''import Base
def make() -> Array<U32>:
  [5 : U32*8n]
def get(a: Array<U32>) -> Array<U32> & U32:
  a[3]
''',
            'main.bend': '''import Base
import ./a.bend as A
def finish(pair: Array<U32> & U32) -> U32:
  (a, value) = pair
  value
def main() -> U32:
  finish(A.get(A.make()))
''',
        })
        _, binary, _ = self.compile(directory, 'modules')
        self.assertEqual(self.run_value(binary), '5')
        _, binary, _ = self.compile(directory, 'single', mode='single')
        self.assertEqual(self.run_value(binary), '5')

    def test_borrowed_string_crosses_modules(self):
        directory = self.fixture('borrow', {
            'a.bend': '''import Base
def size(+s: String) -> U32:
  match s:
    case SNil{}: 0
    case SCon{c, tail}: (1 + size(tail) : U32)
''',
            'b.bend': '''import Base
import ./a.bend as A
def twice(+s: String) -> U32:
  (A.size(s) + A.size(s) : U32)
''',
            'main.bend': '''import Base
import ./b.bend as B
def main() -> U32:
  B.twice("abc")
''',
        })
        candidate, binary, _ = self.compile(directory, 'modules')
        self.assertEqual(self.run_value(binary), '6')
        reference, binary, _ = self.compile(directory, 'single', mode='single')
        self.assertEqual(self.run_value(binary), '6')

        def hot(path):
            c = path.read_text()
            cid = int(re.search(r'^#define CID_SCON (\d+)$', c, re.M)[1])
            table = re.search(r'CONSTV u8 CID_HOT_T\[\] = \{ ([^}]*) \};', c)[1]
            return [int(x.strip()) for x in table.split(',')][cid]

        self.assertEqual(hot(candidate), hot(reference), 'String constructor sharing')


if __name__ == '__main__':
    unittest.main()
