"""Exercise the managed update path through the coordinator with native fixtures."""

import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
EXE = Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/baton2'))
FIXTURE = r"""
import json
import os
from pathlib import Path
import shutil
import sys

args = sys.argv[1:]
home = Path.home()
command = Path(sys.argv[0])
state = home / 'test-state'
if args == ['--version']:
    installed = (command.parent / '.muse-version').read_text().strip() if HARNESS == 'muse' else VERSION
    print(HARNESS, installed)
elif args == ['update'] or os.environ.get('MUSE_LAUNCHER_INSTALL') == '1':
    if HARNESS == 'codex':
        current = home / '.codex/packages/standalone/current'
        current.unlink()
        current.symlink_to(current.parent / 'releases/2.0.0')
        command.unlink()
        command.symlink_to(current / 'bin/codex')
        (current.parent / 'auto-update-version').write_text('2.0.0\n')
    elif HARNESS == 'claude-code':
        command.unlink()
        command.symlink_to(home / '.local/share/claude/versions/2.0.0')
    elif HARNESS == 'muse':
        (command.parent / '.muse-version').write_text('2.0.0\n')
    else:
        assert Path(shutil.which('omp')) == command
        shutil.copy2(state / 'omp-next', command.parent / '.next')
        (command.parent / '.next').replace(command)
    print('vendor output', flush=True)
    if (state / (HARNESS + '-fail')).exists():
        print('vendor error', file=sys.stderr)
        sys.exit(17)
elif args == ['debug', 'models']:
    print(json.dumps({'models': [{'slug': 'model-' + VERSION}]}))
elif args[0] == 'exec':
    sys.stdin.read()
    print(json.dumps({'type': 'thread.started', 'thread_id': 'native-fixture'}), flush=True)
    print(json.dumps({'type': 'item.completed', 'item': {
        'id': 'answer', 'type': 'agent_message', 'text': 'launched ' + VERSION}}), flush=True)
    print(json.dumps({'type': 'turn.completed', 'usage': {}}), flush=True)
elif args == ['hold']:
    print(VERSION, flush=True)
    sys.stdin.readline()
    print(VERSION, flush=True)
else:
    raise AssertionError(args)
"""


@unittest.skipUnless(sys.platform == 'linux', 'Managed harness updates run on Linux')
class HarnessUpdate(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'Coordinator not built at {EXE}')
        parent = ROOT / '.scratch/bend2'
        parent.mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(dir=parent)
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.home = self.root / 'service-home'
        self.bin = self.home / '.local/bin'
        self.bin.mkdir(parents=True)
        self.state = self.home / 'test-state'
        self.state.mkdir()
        self.db = self.root / 'orchestra.db'
        self.env = {key: value for key, value in os.environ.items()
                    if key not in ('BATON_DATABASE', 'BATON_SESSION', 'BATON2_GIT_REGISTRY',
                                   'BATON_COORDINATOR', 'BATON_ATTEMPT_DIRECTORY')}
        self.env['HOME'] = str(self.home)
        self.call('attach', 'root', 'codex', 'native-root', '')
        self.addCleanup(self.shutdown)

    def shutdown(self):
        result = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                cwd=self.root, env=self.env, text=True,
                                capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def call(self, *args):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                cwd=self.root, env=self.env, text=True,
                                capture_output=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result.stdout

    def write_client(self, file, harness, version):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(f'#!{sys.executable}\nHARNESS = {harness!r}\nVERSION = {version!r}\n' + FIXTURE)
        file.chmod(0o755)

    def install_codex(self):
        package = self.home / '.codex/packages/standalone'
        old = package / 'releases/1.0.0/codex'
        self.write_client(old, 'codex', '1.0.0')
        self.write_client(package / 'releases/2.0.0/bin/codex', 'codex', '2.0.0')
        (package / 'current').symlink_to(old.parent)
        (package / 'auto-update-version').write_text('1.0.0\n')
        (self.bin / 'codex').symlink_to(package / 'current/codex')
        return old

    def install_omp(self):
        command = self.bin / 'omp'
        self.write_client(command, 'omp', '1.0.0')
        self.write_client(self.state / 'omp-next', 'omp', '2.0.0')
        return command

    def route(self, command):
        self.call('attach', 'worker', 'codex', 'native-fixture', '')
        endpoint = [str(EXE), str(self.db), 'receive', 'worker', str(command),
                    'fixture-model', 'low', str(self.root), str(self.root / 'receiver.log')]
        with sqlite3.connect(self.db) as db:
            db.execute("UPDATE sessions SET parent='root', workspace=?, endpoint=? WHERE id='worker'",
                       (str(self.root), json.dumps(endpoint)))

    def records(self, harness):
        directory = self.home / '.local/state/baton2/harness-updates' / harness
        return [json.loads(path.read_text()) for path in sorted(directory.glob('*.json'))]

    def test_models_updates_a_legacy_path_and_reads_the_new_client(self):
        old = self.install_codex()
        self.route(old)
        answer = json.loads(self.call('models', 'worker'))
        self.assertEqual(answer['response']['models'], [{'slug': 'model-2.0.0'}])
        self.assertEqual(answer['command'], str(self.bin / 'codex'))
        record, = self.records('codex')
        self.assertEqual((record['oldVersion'], record['newVersion'], record['result']),
                         ('1.0.0', '2.0.0', 'updated'))

    def test_new_native_attempt_uses_the_updated_client(self):
        old = self.install_codex()
        self.route(old)
        task = self.root / 'input'
        task.write_text('Run the fixture.\n')
        log = self.root / 'native.log'
        self.call('turn', 'worker', 'attempt-update', old, 'fixture-model', 'low',
                  self.root, task, log, 'native-fixture')
        self.assertIn('launched 2.0.0', log.read_text())
        self.assertEqual(self.records('codex')[0]['result'], 'updated')

    def test_scheduled_check_keeps_a_running_client_and_reuses_fresh_observation(self):
        command = self.install_omp()
        with subprocess.Popen([command, 'hold'], env=self.env, text=True,
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE) as running:
            self.assertEqual(running.stdout.readline().strip(), '1.0.0')
            try:
                receipt = json.loads(self.call('harness-update'))
                self.assertEqual(receipt['result'], 'updated')
                self.assertEqual(subprocess.check_output([command, '--version'], text=True).strip(),
                                 'omp 2.0.0')
            finally:
                output, _ = running.communicate('\n', timeout=10)
            self.assertEqual(running.returncode, 0)
            self.assertEqual(output.strip(), '1.0.0')
        self.assertEqual(json.loads(self.call('harness-update'))['id'], receipt['id'])
        record, = self.records('omp')
        self.assertGreater(record['time'], 0)

    def test_failure_restores_prior_selection_and_reaches_the_root(self):
        old = self.install_codex()
        self.route(old)
        (self.state / 'codex-fail').touch()
        for _ in range(2):
            answer = json.loads(self.call('models', 'worker'))
            self.assertEqual(answer['response']['models'], [{'slug': 'model-1.0.0'}])
        self.assertEqual((self.bin / 'codex').resolve(), old)
        self.assertEqual((old.parents[2] / 'auto-update-version').read_text(), '1.0.0\n')
        record, = self.records('codex')
        self.assertEqual(record['result'], 'failed')
        self.assertEqual(record['newVersion'], '1.0.0')
        self.assertEqual(record['exitCode'], 17)
        self.assertIn('vendor error', record['stderr'])
        with sqlite3.connect(self.db) as db:
            rows = db.execute("SELECT sender, recipient, body FROM messages WHERE kind='report'").fetchall()
        sender, recipient, body = rows[0]
        self.assertEqual((sender, recipient), ('worker', 'root'))
        self.assertEqual(len(rows), 1)
        self.assertIn(record['id'], body)
        self.assertIn('vendor updater exited 17', body)

    def test_scheduled_failure_reaches_the_root(self):
        command = self.install_omp()
        (self.state / 'omp-fail').touch()
        receipt = json.loads(self.call('harness-update'))
        self.assertEqual(receipt['result'], 'failed')
        self.assertEqual(subprocess.check_output([command, '--version'], text=True).strip(),
                         'omp 1.0.0')
        with sqlite3.connect(self.db) as db:
            recipient, body = db.execute(
                "SELECT recipient, body FROM messages WHERE kind='report'").fetchone()
        self.assertEqual(recipient, 'root')
        self.assertIn(receipt['id'], body)

    def test_scheduled_check_uses_claude_and_muse_vendor_update_commands(self):
        versions = self.home / '.local/share/claude/versions'
        self.write_client(versions / '1.0.0', 'claude-code', '1.0.0')
        self.write_client(versions / '2.0.0', 'claude-code', '2.0.0')
        (self.bin / 'claude').symlink_to(versions / '1.0.0')
        self.write_client(self.bin / 'muse', 'muse', '1.0.0')
        (self.bin / '.muse-version').write_text('1.0.0\n')
        receipts = [json.loads(line) for line in self.call('harness-update').splitlines()]
        self.assertEqual({(r['harness'], r['newVersion'], r['result']) for r in receipts},
                         {('claude-code', '2.0.0', 'updated'), ('muse', '2.0.0', 'updated')})


if __name__ == '__main__':
    unittest.main()
