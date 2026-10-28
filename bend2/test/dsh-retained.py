"""Retained-launch and native admission checks for the DSH adapter.

The fixture derives DSH_HOME from a temporary database, prepares the two patch
overlays and calls retained launch composition and custody with a local CLI stub.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-retained-test'))
SCHEMA = (
    "CREATE TABLE sessions (id TEXT PRIMARY KEY NOT NULL, parent TEXT, "
    "harness TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', "
    "effort TEXT NOT NULL DEFAULT '', native TEXT NOT NULL DEFAULT '', "
    "observed_harness TEXT NOT NULL DEFAULT '', observed_model TEXT NOT NULL DEFAULT '', "
    "observed_effort TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', "
    "workspace TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', "
    "base TEXT NOT NULL DEFAULT '');"
)


class DshRetained(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'DSH retained fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        self.link = self.root / 'link.db'
        self.attempt = self.root / 'attempt'
        self.patches = self.root / 'attempt.dsh'
        with sqlite3.connect(self.db) as database:
            database.executescript(SCHEMA)
            database.execute(
                "INSERT INTO sessions(id,harness,model,effort) VALUES"
                "('dsh-fixture','dsh','deepseek-flash','max')")
        self.owner = None
        self.link.symlink_to(self.db)
        self.addCleanup(self.shutdown_owner)

    def shutdown_owner(self):
        subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                       text=True, capture_output=True, timeout=10)
        if self.owner is not None:
            try:
                self.owner.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.owner.kill()
                self.owner.wait(timeout=10)

    def start_owner(self):
        self.owner = subprocess.Popen(
            [str(EXE), '--instance-owner', str(self.db)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if self.owner.poll() is not None:
                self.fail('instance owner exited before readiness: '
                          + (self.owner.stderr.read() or ''))
            witness = subprocess.run(
                [str(EXE), '--instance-witness', str(self.db)],
                capture_output=True, text=True, timeout=5)
            if witness.returncode == 0 and witness.stdout.strip():
                return
            time.sleep(0.05)
        self.fail('instance owner did not become ready')

    def run_fixture(self):
        result = subprocess.run(
            [str(EXE), str(self.link), str(self.attempt), '/usr/bin/dsh',
             'deepseek/deepseek-flash', 'max', 'session-1'],
            text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_retained_argv_uses_seat_home_patches_and_stdin(self):
        output = self.run_fixture()
        argv = [line.split('\t', 1)[1] for line in output.splitlines()
                if line.startswith('arg\t')]
        home = str(self.db) + '.dsh-home-' + 'dsh-fixture'.encode().hex()
        self.assertEqual(argv[:3], ['/usr/bin/env', 'BATON_SESSION=dsh-fixture',
                                    '/usr/bin/env'])
        self.assertEqual(argv[3], 'DSH_HOME=' + home)
        self.assertEqual(argv[4], '/usr/bin/dsh')
        self.assertEqual(argv[5:], [
            '--profile', 'headless',
            '--patch', str(self.patches / 'dsh-tools.patch.yml'),
            '--patch', str(self.patches / 'dsh-model.patch.yml'),
            '--json', '--session-id', 'session-1'])
        self.assertIn('input\tfixture task', output)
        self.assertIn('keep\t0', output)
        self.assertIn('file\tfalse', output)
        self.assertFalse(self.attempt.exists())

    def test_retained_prepare_resolves_dsh_worker_bridge(self):
        self.start_owner()
        result = subprocess.run(
            [str(EXE), 'prepare', str(self.link), str(self.attempt), '/usr/bin/dsh',
             'deepseek/deepseek-flash', 'max'],
            text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        bridge = next((line.split('\t', 1)[1] for line in result.stdout.splitlines()
                       if line.startswith('arg\tBATON_DSH_WORKER_BRIDGE=')), '')
        self.assertTrue(bridge.endswith('/dsh-worker.mjs'), result.stdout)
        self.assertIn('input\tfixture task', result.stdout)

    def test_patch_inputs_are_the_minimal_roster_and_max_effort(self):
        self.run_fixture()
        tools = (self.patches / 'dsh-tools.patch.yml').read_text()
        model = (self.patches / 'dsh-model.patch.yml').read_text()
        self.assertIn('    read: false', tools)
        self.assertIn('    readImage: true', tools)
        self.assertIn('    write: false', tools)
        self.assertIn('    edit: false', tools)
        self.assertIn("name: '@deepseek-ai/dsh-tool-bash-persistent'", tools)
        self.assertIn('provider: deepseek-official', model)
        self.assertIn("model: 'deepseek-flash'", model)
        self.assertIn("reasoningEffort: 'max'", model)

    def admit(self, attempt, native=''):
        command = self.root / 'dsh-stub'
        command.write_text('''#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
patches = [pathlib.Path(args[i + 1]) for i, arg in enumerate(args) if arg == '--patch']
assert len(patches) == 2 and all(p.is_file() for p in patches)
assert "reasoningEffort: 'max'" in patches[1].read_text()
assert "model: 'deepseek-flash'" in patches[1].read_text()
assert 'readImage: true' in patches[0].read_text()
prompt = sys.stdin.read()
assert prompt == 'fixture task'
print(json.dumps({'argv': args, 'prompt': prompt, 'home': os.environ['DSH_HOME']}), flush=True)
''')
        command.chmod(0o700)
        result = subprocess.run(
            [str(EXE), 'admit', str(self.link), str(attempt), str(command),
             'deepseek/deepseek-flash', 'max', native],
            text=True, capture_output=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('native-exit 0', result.stdout)
        return json.loads(next(line for line in result.stdout.splitlines()
                               if line.startswith('{')))

    def test_first_admission_seals_prompt_and_finishes_custody(self):
        observed = self.admit(self.attempt)
        self.assertEqual(observed['prompt'], 'fixture task')
        self.assertNotIn('--session-id', observed['argv'])
        self.assertEqual((self.attempt / 'prompt.txt').read_text(), 'fixture task')
        self.assertTrue((self.attempt / 'manifest').is_file())
        self.assertTrue((self.attempt / 'acknowledged').is_file())
        self.assertFalse((self.attempt / 'dsh-tools.patch.yml').exists())

    def test_retained_retry_keeps_native_home_and_patch_identity(self):
        first = self.admit(self.attempt)
        tools = (self.patches / 'dsh-tools.patch.yml').read_bytes()
        model = (self.patches / 'dsh-model.patch.yml').read_bytes()
        retry = self.root / 'retry'
        observed = self.admit(retry, 'session-1')
        self.assertEqual(observed['home'], first['home'])
        self.assertEqual(observed['argv'][-2:], ['--session-id', 'session-1'])
        self.assertEqual((self.root / 'retry.dsh/dsh-tools.patch.yml').read_bytes(), tools)
        self.assertEqual((self.root / 'retry.dsh/dsh-model.patch.yml').read_bytes(), model)
        self.assertEqual((retry / 'prompt.txt').read_text(), 'fixture task')
        self.assertTrue((retry / 'acknowledged').is_file())

    def test_patch_storage_tracks_the_execution_owner_and_lease(self):
        for path in [self.patches, self.patches / 'dsh-model.patch.yml']:
            with self.subTest(path=path):
                active = subprocess.run(
                    [str(EXE), 'storage', str(self.attempt), str(path), 'running'],
                    text=True, capture_output=True, check=True)
                self.assertIn('owners\tdsh-fixture', active.stdout)
                self.assertIn('active\texecution:turn', active.stdout)
                ended = subprocess.run(
                    [str(EXE), 'storage', str(self.attempt), str(path), 'exited'],
                    text=True, capture_output=True, check=True)
                self.assertIn('owners\tdsh-fixture', ended.stdout)
                self.assertNotIn('execution:turn', ended.stdout)
        unrelated = subprocess.run(
            [str(EXE), 'storage', str(self.attempt), str(self.root / 'attempt.dsh-other'), 'running'],
            text=True, capture_output=True, check=True)
        self.assertNotIn('dsh-fixture', unrelated.stdout)
        self.assertNotIn('execution:turn', unrelated.stdout)


if __name__ == '__main__':
    unittest.main()
