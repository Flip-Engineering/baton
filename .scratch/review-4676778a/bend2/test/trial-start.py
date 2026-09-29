"""Trial attachment uses the native coordinator and a provider-free login fixture."""
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
LAUNCHER = ROOT / 'bend2/scripts/trial-start.sh'


class TrialStartTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="baton trial's ")
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.repo = self.home / 'repository'
        self.repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(self.repo)], check=True)
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.invalid', 'commit',
                        '-qm', 'Initial tree', '--allow-empty'], check=True)
        self.source = self.home / 'tools'
        scripts = self.source / 'bend2/scripts'
        scripts.mkdir(parents=True)
        shutil.copytree(ROOT / 'bend2/trial', self.source / 'bend2/trial')
        # The suite already built EXE. Reuse it while exercising the launcher's
        # build-output replacement and all real coordinator commands.
        build = scripts / 'build-native.sh'
        build.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable)
                         + ' - "$2" <<\'PY\'\nimport shutil,sys\n'
                         + 'shutil.copy2(' + repr(str(EXE)) + ',sys.argv[1])\nPY\n')
        self.harness = self.home / 'native-login'
        self.harness.write_text('#!' + sys.executable + '\n'
            + 'import json,os,pathlib,sys\n'
            + 'with pathlib.Path(__file__).with_suffix(".calls").open("a") as out:\n'
            + ' out.write(json.dumps({"args":sys.argv[1:],"apiKeyPresent":any(k in os.environ for k in ("OPENAI_API_KEY","CODEX_API_KEY"))})+"\\n")\n'
            + 'assert sys.argv[1:]==["-c",\'forced_login_method="chatgpt"\',"login","status"], "unexpected native turn"\n'
            + 'print("Fixture subscription login")\n')
        self.harness.chmod(0o700)
        self.db = self.home / 'trial.db'
        self.state = pathlib.Path(str(self.db) + '.trial')
        self.env = dict(os.environ, NODE=sys.executable,
                        BATON_CODEX=str(self.harness), BATON_OMP=str(self.harness),
                        BATON_MUSE=str(self.harness), OPENAI_API_KEY='fixture-only',
                        CODEX_API_KEY='fixture-only')

    def coordinator(self, *args):
        result = subprocess.run([str(EXE), str(self.db), *args],
                                text=True, capture_output=True, check=True)
        return json.loads(result.stdout)

    def launch(self):
        return subprocess.run(['sh', str(LAUNCHER), str(self.repo),
                               str(self.source), str(self.db)], env=self.env,
                              text=True, capture_output=True)

    def assert_attached(self, result, native):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        sessions = {row['id']: row for row in self.coordinator('status')}
        self.assertEqual(sessions['operator']['harness'], 'terminal')
        root = sessions['root']
        self.assertEqual(root['harness'], 'codex')
        self.assertEqual(root['native'], native)
        self.assertEqual(json.loads(root['endpoint']), [
            str(self.state / 'baton2'), str(self.db), 'receive', 'root',
            str(self.state / 'codex-subscription.sh'), 'gpt-6-astra', 'low',
            str(self.repo), str(self.state / 'root-native.jsonl')])
        self.assertEqual(self.coordinator('inbox', 'root'), [])
        calls = [json.loads(line) for line in
                 self.harness.with_suffix('.calls').read_text().splitlines()]
        self.assertEqual(calls, [{'args': ['-c', 'forced_login_method="chatgpt"',
                                          'login', 'status'], 'apiKeyPresent': False}])
        return root

    def test_first_launch_attaches_root_without_starting_an_empty_turn(self):
        self.assert_attached(self.launch(), '')
        self.assertIn('Assigned issue', (self.state / 'first-task.md').read_text())
        target = subprocess.check_output(['git', '-C', str(self.repo), 'rev-parse',
                                          'bend2-trial'], text=True).strip()
        head = subprocess.check_output(['git', '-C', str(self.repo), 'rev-parse',
                                        'HEAD'], text=True).strip()
        self.assertEqual(target, head)

    def test_default_trial_starts_when_optional_muse_is_unavailable(self):
        missing = str(self.home / 'not-installed-muse')
        self.env['BATON_MUSE'] = missing
        self.assert_attached(self.launch(), '')
        configured = subprocess.check_output([
            'sh', '-c', '. "$1"; printf "%s" "$TRIAL_MUSE"', 'sh',
            str(self.state / 'environment.sh')], text=True)
        self.assertEqual(configured, missing)

    def test_reattach_preserves_native_identity_and_operator_task(self):
        self.coordinator('attach', 'root', 'codex', 'existing-native-session',
                         '["/old/receiver"]')
        self.state.mkdir()
        first = self.state / 'first-task.md'
        task = b'Operator assignment with retained edits.\n'
        first.write_bytes(task)
        (self.state / 'root-instructions.md').write_text('old instructions\n')
        self.assert_attached(self.launch(), 'existing-native-session')
        self.assertEqual(first.read_bytes(), task)
        self.assertIn('Bend2 trial root',
                      (self.state / 'root-instructions.md').read_text())


if __name__ == '__main__':
    unittest.main()
