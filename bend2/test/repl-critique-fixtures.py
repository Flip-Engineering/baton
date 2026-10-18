"""Focused adversarial fixtures for the #778 critique findings F1, F2 and F3.

F1 pins the documented redefinition contract (docs/bend2/repl.md, "A
redefinition must preserve the type and affine validity of that complete
book"). The pinned upstream parser refuses a second declaration, so the raw
loader probe records that fact and the frontend cases run through the staged
compiler. F2 pins interactive continuation across recoverable refusals. F3
pins durable recorded success across a recovery observation, including the
custody release-to-acknowledge window.

Findings and failure evidence: docs/bend2/repl-critique-2026-10-17.md at
commit cf394d9 on release-repl-glm-778. Validation runs on the self-hosted
homelab runners; a subtest whose prerequisite stack is absent records an
explicit skip with its cause.
"""
import fcntl
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import closing

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
UPSTREAM = ROOT / 'bend2/compiler/upstream/bend.ts'

REDEFINITION_PROBE = '''
import * as Bend from <UPSTREAM>;
function show(e) {
  try { return Bend.err_show(e); } catch { return "unshown error"; }
}
async function main() {
  const book = Bend.book_nil();
  const seen = new Map();
  await Bend.book_load(book, Bend.BASE_BEND, "", seen);
  Bend.book_valid(book, 0);
  await Bend.book_load(book, process.argv[2], "", seen, undefined);
  Bend.book_valid(book, 0);
  try {
    await Bend.book_load(book, process.argv[3], "", seen, undefined);
    Bend.book_valid(book, 0);
    process.stdout.write("ACCEPTED\\n");
  } catch (e) {
    const text = e && e.$ === "Err" ? show(e) : String(e);
    process.stdout.write("REFUSED\\n" + text.split("\\n").slice(0, 4).join(" | ") + "\\n");
  }
}
main();
'''


def run_node_probe(work, first_source, second_source):
    first = work / 'cell-a.bend'
    second = work / 'cell-b.bend'
    first.write_text(first_source)
    second.write_text(second_source)
    script = work / 'redefinition-probe.mjs'
    script.write_text(REDEFINITION_PROBE.replace('<UPSTREAM>', json.dumps(str(UPSTREAM))))
    return subprocess.run(
        ['node', '--experimental-strip-types', str(script), str(first), str(second)],
        capture_output=True, text=True, timeout=120)


def stage_compiler(directory):
    runtime = os.environ.get('BATON2_REPL_RUNTIME')
    digest = os.environ.get('BATON2_REPL_RUNTIME_SHA256')
    notices = os.environ.get('BATON2_REPL_NOTICES')
    if not (runtime and digest and notices):
        return None
    target = directory / 'compiler'
    result = subprocess.run(
        [sys.executable, str(ROOT / 'bend2/scripts/stage-repl-compiler.py'),
         '--runtime', runtime, '--runtime-sha256', digest,
         '--runtime-notices', notices, '--output', str(target)],
        capture_output=True, text=True, timeout=300)
    if result.returncode:
        raise AssertionError(result.stderr)
    return target / 'compiler'


class ReplCritiqueFixtures(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        self.observer = None
        self.owner = None
        self.runtime = pathlib.Path(tempfile.mkdtemp(prefix='repl-rt-', dir='/tmp'))
        self.env = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))
        if EXE.exists():
            self.owner = subprocess.Popen([str(EXE), '--instance-owner', str(self.db)],
                                          cwd=self.directory, env=self.env,
                                          stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL)
            time.sleep(0.5)

    def tearDown(self):
        shutil.rmtree(getattr(self, "runtime", ""), ignore_errors=True)
        if self.owner is not None and self.owner.poll() is None:
            subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                           cwd=self.directory, capture_output=True, timeout=30)
            try:
                self.owner.wait(timeout=30)
            except subprocess.TimeoutExpired:
                self.owner.kill()
                self.owner.wait(timeout=30)
        self.close_observer()
        self.temp.cleanup()

    def invoke(self, *args, stdin=None):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)],
                              cwd=self.directory, env=self.env, capture_output=True,
                              text=True, input=stdin, timeout=120)

    def require_coordinator(self):
        if not EXE.exists():
            self.skipTest('compiled coordinator .scratch/bend2/baton2 absent; '
                          'the self-hosted homelab run owns this case')

    def actors(self):
        result = self.invoke('attach', 'critic', 'fixture', '', '')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        with sqlite3.connect(self.db) as connection:
            connection.execute("UPDATE sessions SET workspace=? WHERE id='critic'", (str(self.directory),))

    def compiler(self):
        if not hasattr(self, '_compiler'):
            self._compiler = stage_compiler(self.directory)
        if self._compiler is None:
            self.skipTest('REPL compiler runtime inputs absent: set '
                          'BATON2_REPL_RUNTIME, BATON2_REPL_RUNTIME_SHA256 and '
                          'BATON2_REPL_NOTICES')
        return self._compiler

    def run_define(self, definitions, source):
        work = self.directory / 'work'
        work.mkdir(exist_ok=True)
        cell = work / 'cell.bend'
        cell.write_text(source)
        return subprocess.run(
            [str(self.compiler()), 'define', str(cell), str(work), str(work / 'out')],
            cwd=work, input=json.dumps(definitions), capture_output=True,
            text=True, timeout=120)

    # --- F1: the promised redefinition semantics ---------------------------

    @unittest.skipUnless(UPSTREAM.exists() and shutil.which('node'),
                         'pinned upstream source or node absent')
    def test_f1_pinned_loader_refuses_a_second_declaration(self):
        with tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2') as work:
            result = run_node_probe(pathlib.Path(work),
                                    'def replaced() -> U32:\n  1\n',
                                    'def replaced() -> U32:\n  2\n')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.startswith('REFUSED'), result.stdout)
            self.assertIn('duplicate declaration', result.stdout)

    def test_f1_valid_redefinition_is_accepted(self):
        result = self.run_define(['def replaced() -> U32:\n  1\n'],
                                 'def replaced() -> U32:\n  2\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(report['kind'], 'definitions')
        self.assertEqual([(row['name'], row['type']) for row in report['declarations']],
                         [('replaced', 'U32')])

    def test_f1_incompatible_redefinition_is_refused_as_a_type_error(self):
        result = self.run_define(['def replaced() -> U32:\n  1\n'],
                                 'def replaced() -> U32:\n  replaced(1)\n')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertTrue(result.stderr)
        self.assertNotIn('duplicate declaration', result.stderr)

    def test_f1_affine_redefinition_is_refused(self):
        result = self.run_define(
            ['def affine(f: U32 -> U32) -> U32:\n  f(1)\n'],
            'def affine(f: U32 -> U32) -> U32:\n  U32.add(f(1),f(2))\n')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('consumed more than once', result.stderr)
        self.assertNotIn('duplicate declaration', result.stderr)

    def test_f1_redefinition_that_breaks_a_dependent_is_refused(self):
        result = self.run_define(
            ['def base() -> U32:\n  1\n', 'def dependent() -> U32:\n  base()\n'],
            'def base() -> String:\n  "x"\n')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('expected : U32', result.stderr)
        self.assertIn('observed : String', result.stderr)
        self.assertNotIn('duplicate declaration', result.stderr)

    def test_f1_valid_redefinition_keeps_a_dependent(self):
        result = self.run_define(
            ['def base() -> U32:\n  1\n', 'def dependent() -> U32:\n  base()\n'],
            'def base() -> U32:\n  2\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_f1_snapshot_replay_keeps_an_earlier_redefinition(self):
        result = self.run_define(
            ['def replaced() -> U32:\n  1\n', 'def replaced() -> U32:\n  2\n'],
            'def replaced() -> U32:\n  3\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_f1_type_redefinition_replaces_its_constructors(self):
        result = self.run_define(
            ['type Color is Data:\n  Red{}\n  Blue{}\n'],
            'type Color is Data:\n  Red{}\n  Green{}\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        report = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(report['declarations'],
                         [{'name': 'Color', 'kind': 'ADT', 'type': 'Data'}])

    def test_f1_type_redefinition_refuses_a_removed_constructor_dependent(self):
        result = self.run_define(
            ['type Color is Data:\n  Red{}\n  Blue{}\n',
             'def old() -> Color:\n  Blue{}\n'],
            'type Color is Data:\n  Red{}\n  Green{}\n')
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertIn('a declared constructor', result.stderr)
        self.assertNotIn('duplicate declaration', result.stderr)

    # --- F2: interactive continuation across recoverable refusals ----------

    def test_f2_bind_without_name_continues_the_session(self):
        self.require_coordinator()
        self.actors()
        result = self.invoke('repl', 'interactive', stdin=':bind\n:quit\n')
        self.assertEqual(result.returncode, 0,
                         'a recoverable :bind argument refusal ended the session: '
                         + result.stdout + result.stderr)
        self.assertIn('Use :bind NAME', result.stdout + result.stderr,
                      'the :bind refusal cause is missing from the session output')

    def test_f2_guard_blocked_submit_continues_the_session(self):
        self.require_coordinator()
        self.actors()
        ready = self.invoke('repl', 'interactive', stdin=':quit\n')
        self.assertEqual(ready.returncode, 0, ready.stdout + ready.stderr)
        with closing(self.hold_notebook_guard()) as held:
            self.assertIsNotNone(held, 'the fixture could not hold the notebook '
                                       'guard file')
            result = self.invoke('repl', 'interactive',
                                 stdin=':submit\n:submit\n:quit\n')
        self.assertEqual(result.returncode, 0,
                         'a guard-blocked :submit ended the interactive session: '
                         + result.stdout + result.stderr)
        self.assertIn('active evaluation', result.stdout + result.stderr,
                      'the guard refusal cause is missing from the session output')

    def hold_notebook_guard(self):
        """Hold the physical notebook guard the coordinator derives for the current notebook."""
        stat = os.stat(self.db)
        key = 'owner-%x-%x' % (stat.st_dev, stat.st_ino)
        with sqlite3.connect(self.db) as connection:
            row = connection.execute(
                "SELECT id FROM repl_notebooks WHERE owner='critic' AND name='main' ORDER BY rowid DESC LIMIT 1").fetchone()
        if row is None:
            return None
        suffix = '.lock-' + ('repl:' + row[0]).encode().hex()
        runtime = os.environ.get('XDG_RUNTIME_DIR') or ''
        candidates = [self.runtime / 'baton2']
        if runtime:
            candidates.append(pathlib.Path(runtime) / 'baton2')
        candidates.append(pathlib.Path('/tmp/baton2-%u' % os.geteuid()))
        candidates.append(pathlib.Path.home() / '.local/state/baton2')
        directory = next((item for item in candidates if item.exists()),
                         candidates[1])
        directory.mkdir(mode=0o700, exist_ok=True, parents=True)
        handle = open(directory / (key + suffix), 'a+')
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return None
        return handle

    def test_f2_line_refuses_embedded_nul_and_preserves_draft(self):
        self.require_coordinator()
        self.actors()
        result = self.invoke('repl', 'interactive',
                             stdin=':define\nU32.add(1,2)\x00\n:quit\n')
        self.assertNotEqual(result.returncode, 0,
                            'the NUL line was accepted: ' + result.stdout + result.stderr)
        self.assertIn('NUL', result.stdout + result.stderr)
        row = self.query("SELECT source FROM repl_drafts ORDER BY rowid DESC LIMIT 1")
        self.assertEqual(row, ('',), 'the refused NUL line altered the draft source')
        cells = self.query("SELECT count(*) FROM repl_cells")
        self.assertEqual(cells, (0,), 'the refused NUL line created a cell')

    def test_f2_line_refuses_invalid_utf8_and_preserves_draft(self):
        self.require_coordinator()
        self.actors()
        result = subprocess.run([str(EXE), str(self.db), 'repl', 'interactive'],
                                cwd=self.directory, env=self.env,
                                input=b':define\n\xff\n:quit\n',
                                capture_output=True, timeout=120)
        out = (result.stdout + result.stderr).decode('utf-8', 'replace')
        self.assertNotEqual(result.returncode, 0, 'the invalid UTF-8 line was accepted: ' + out)
        self.assertIn('UTF-8', out)
        row = self.query("SELECT source FROM repl_drafts ORDER BY rowid DESC LIMIT 1")
        self.assertEqual(row, ('',), 'the refused invalid UTF-8 line altered the draft source')
        cells = self.query("SELECT count(*) FROM repl_cells")
        self.assertEqual(cells, (0,), 'the refused invalid UTF-8 line created a cell')

    def test_f2_interactive_accepts_multiline_and_eof(self):
        self.require_coordinator()
        compiler = EXE.parent.parent / 'libexec/baton2/repl/compiler'
        if not compiler.exists():
            self.skipTest('staged REPL compiler absent beside the coordinator')
        self.actors()
        result = self.invoke('repl', 'interactive',
                             stdin=':define\ndef answer() -> U32:\n  42\n:submit\n')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        row = self.query("SELECT wait_status,cause FROM repl_attempts "
                         "ORDER BY rowid DESC LIMIT 1")
        self.assertEqual(row[0], 'exit 0', 'multiline define did not complete: ' + repr(row))

    def test_f2_native_eval_starts_and_returns_output(self):
        self.require_coordinator()
        compiler = EXE.parent.parent / 'libexec/baton2/repl/compiler'
        if not compiler.exists():
            self.skipTest('staged REPL compiler absent beside the coordinator; '
                          'the installed homelab run owns this case')
        self.actors()
        result = self.invoke('repl', 'eval', 'IO.write("native-eval\\n")', '--type', 'IO(Unit)')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('native-eval', result.stdout)
        self.assertNotIn('unstarted', result.stdout + result.stderr)

    # --- F3: durable recorded success across recovery ----------------------

    def finished_attempt(self, directory):
        stdout = '{"protocol":1,"kind":"definitions"}\n'
        connection = sqlite3.connect(self.db)
        try:
            notebook = connection.execute(
                "SELECT id FROM repl_notebooks WHERE owner="
                "(SELECT id FROM sessions WHERE id='critic') LIMIT 1").fetchone()
            self.assertTrue(notebook, 'the fixture notebook is missing')
            connection.execute(
                "INSERT INTO repl_cells(id,notebook,operation,source,expected_type,"
                "label,snapshot) VALUES('repl-cell:fixture',?,"
                "'define','def fixture() -> U32: 1','','','[]')", notebook)
            directory.mkdir(parents=True)
            (directory / 'stdout').write_text(stdout)
            (directory / 'stdout.saved').write_text(stdout)
            (directory / 'stderr').write_text('')
            connection.execute(
                "INSERT INTO repl_attempts(cell,stage,directory,argv,input,stdout,"
                "stderr,wait_status,cause) VALUES("
                "'repl-cell:fixture','compiler',?,?,?,?,?, 'exit 0','')",
                (str(directory),
                 json.dumps([str(EXE), 'define', str(directory / 'source.bend'),
                             '.', '/unused/program', '']),
                 '', stdout, ''))
            connection.commit()
        finally:
            connection.close()

    def test_f3_recover_keeps_a_completed_successful_attempt_byte_identical(self):
        self.require_coordinator()
        self.actors()
        ready = self.invoke('repl', 'read')
        self.assertEqual(ready.returncode, 0, ready.stdout + ready.stderr)
        self.finished_attempt(self.directory / 'attempt-fixture')
        result = self.invoke('repl', 'recover', '--cell', 'repl-cell:fixture')
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        connection = sqlite3.connect(self.db)
        try:
            row = connection.execute(
                "SELECT wait_status,cause,stdout FROM repl_attempts "
                "WHERE cell='repl-cell:fixture' AND stage='compiler'").fetchone()
        finally:
            connection.close()
        self.assertEqual(row, ('exit 0', '', '{"protocol":1,"kind":"definitions"}\n'),
                         'a recovery pass without a new observation changed the '
                         'recorded successful outcome')

    def test_f3_custody_window_recovery_preserves_recorded_success(self):
        self.require_coordinator()
        compiler = EXE.parent.parent / 'libexec/baton2/repl/compiler'
        if not compiler.exists():
            self.skipTest('staged REPL compiler absent beside the coordinator; '
                          'the installed homelab run owns this case')
        self.actors()
        for index in range(5):
            cell = self.start_io_evaluation(index)
            if cell is None:
                self.settle_observer()
                continue
            window = self.stop_in_release_window(cell)
            if window is None:
                self.settle_observer()
                continue
            directory, wait_status = window
            self.assertEqual(wait_status, 'exit 0',
                             'the stopped observer had not recorded a successful '
                             'native outcome')
            self.observer.send_signal(signal.SIGKILL)
            self.observer.wait(timeout=30)
            result = self.invoke('repl', 'recover', '--cell', cell)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            connection = sqlite3.connect(self.db)
            try:
                after = connection.execute(
                    "SELECT wait_status,cause FROM repl_attempts "
                    "WHERE cell=? AND stage='native'", (cell,)).fetchone()
            finally:
                connection.close()
            self.assertIsNotNone(after, 'the native attempt row vanished')
            self.assertEqual(after, ('exit 0', ''),
                             'recovery changed a recorded successful native '
                             'attempt: ' + repr(after))
            return
        self.skipTest('the release-to-acknowledge window was not reached in five '
                      'evaluations; each skipped evaluation retained its evidence')

    def settle_observer(self):
        if self.observer is not None and self.observer.poll() is None:
            self.observer.send_signal(signal.SIGCONT)
            self.observer.wait(timeout=120)

    def fail_observer(self, cause):
        stdout, stderr = ('', '')
        if self.observer is not None:
            try:
                stdout, stderr = self.observer.communicate(timeout=30)
            except subprocess.TimeoutExpired:
                self.observer.kill()
                stdout, stderr = self.observer.communicate(timeout=30)
        row = self.query("SELECT cell,stage,wait_status,cause FROM repl_attempts "
                         "ORDER BY rowid DESC LIMIT 1")
        self.fail(cause + '\nstdout: ' + stdout + '\nstderr: ' + stderr
                  + '\nlast attempt: ' + repr(row))

    def close_observer(self):
        if self.observer is None:
            return
        if self.observer.poll() is None:
            self.observer.kill()
            self.observer.wait(timeout=30)
        for stream in (self.observer.stdout, self.observer.stderr):
            if stream is not None:
                stream.close()
        self.observer = None

    def start_io_evaluation(self, index):
        program = 'IO.write("window-marker-' + str(index) + '\\n")'
        self.close_observer()
        self.observer = subprocess.Popen(
            [str(EXE), str(self.db), 'repl', 'eval', program],
            cwd=self.directory, env=self.env, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, text=True)
        cell = self.latest_native_cell(timeout=60)
        if cell is None:
            self.fail_observer('native eval observer exited before recording a native attempt')
        return cell

    def latest_native_cell(self, timeout):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if self.observer.poll() is not None:
                self.fail_observer('native eval observer exited before the release window')
            row = self.query(
                "SELECT c.id FROM repl_cells c JOIN repl_attempts a ON a.cell=c.id "
                "WHERE c.operation='eval' AND a.stage='native' "
                "ORDER BY c.seq DESC LIMIT 1")
            if row:
                return row[0]
            time.sleep(0.05)
        return None

    def stop_in_release_window(self, cell):
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if self.observer.poll() is not None:
                return None
            row = self.query(
                "SELECT directory,wait_status FROM repl_attempts "
                "WHERE cell=? AND stage='native'", (cell,))
            if row and row[1] is not None:
                self.observer.send_signal(signal.SIGSTOP)
                acknowledged = list(pathlib.Path(row[0]).glob('*acknowledged*'))
                if acknowledged:
                    return None
                return row[0], row[1]
            time.sleep(0.005)
        return None

    def query(self, sql, parameters=()):
        try:
            connection = sqlite3.connect('file:' + str(self.db) + '?mode=ro', uri=True)
            try:
                return connection.execute(sql, parameters).fetchone()
            finally:
                connection.close()
        except sqlite3.Error:
            return None


if __name__ == '__main__':
    unittest.main()
