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
        for key, value in (('user.name', 'Fixture'), ('user.email', 'fixture@example.invalid')):
            subprocess.run(['git', '-C', str(self.repo), 'config', key, value], check=True)
        subprocess.run(['git', '-C', str(self.repo), '-c', 'user.name=Fixture',
                        '-c', 'user.email=fixture@example.invalid', 'commit',
                        '-qm', 'Initial tree', '--allow-empty'], check=True)
        self.source = self.home / 'tools'
        scripts = self.source / 'bend2/scripts'
        scripts.mkdir(parents=True)
        for name in ('check-unittest.sh', 'check-node-test.sh'):
            shutil.copy2(ROOT / 'bend2/scripts' / name, scripts / name)
        self.check = scripts / 'check-unittest.sh'
        shutil.copytree(ROOT / 'bend2/trial', self.source / 'bend2/trial')
        # The suite already built EXE. Reuse it while exercising the launcher's
        # build-output replacement and all real coordinator commands.
        build = scripts / 'build-native.sh'
        build.write_text('#!/bin/sh\nexec ' + shlex.quote(sys.executable)
                         + ' - "$2" <<\'PY\'\nimport json,os,pathlib,shutil,sys\n'
                         + 'pathlib.Path(' + repr(str(self.home / 'build.json'))
                         + ').write_text(json.dumps({"BEND":os.environ.get("BEND")}))\n'
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

    def launch(self, check=None):
        return subprocess.run(['sh', str(LAUNCHER), str(self.repo),
                               str(self.source), str(self.db), str(check or self.check)], env=self.env,
                              text=True, capture_output=True)

    def trial_command(self, *args):
        env = {key: value for key, value in os.environ.items() if key != 'BEND'}
        return subprocess.run([
            'sh', '-c', '. "$1"; shift; exec "$@"', 'sh',
            str(self.state / 'environment.sh'), *map(str, args),
        ], env=env, text=True, capture_output=True)

    def trial_call(self, *args):
        result = self.trial_command('sh', '-c', 'exec "$B2" "$DB" "$@"', 'sh', *args)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def git(self, *args, repo=None):
        return subprocess.check_output(['git', '-C', str(repo or self.repo), *args],
                                       text=True).strip()

    def selected_check_repository(self):
        selected = self.repo / 'checks/selected.py'
        selected.parent.mkdir()
        selected.write_text('import json,os,pathlib,subprocess,unittest\n'
            + 'class SelectedBehavior(unittest.TestCase):\n'
            + ' def test_value_and_compiler_context(self):\n'
            + '  cwd=pathlib.Path.cwd()\n'
            + '  row={"cwd":str(cwd),"file":__file__,"BEND":os.environ.get("BEND"),'
              '"head":subprocess.check_output(["git","rev-parse","HEAD"],text=True).strip()}\n'
            + '  with pathlib.Path(' + repr(str(self.home / 'checks.jsonl')) + ').open("a") as out:\n'
            + '   out.write(json.dumps(row)+"\\n")\n'
            + '  self.assertEqual(os.environ.get("BEND"),' + repr(str(self.harness)) + ')\n'
            + '  self.assertEqual((cwd/"value.txt").read_text(),"working\\n")\n')
        (self.repo / 'value.txt').write_text('working\n')
        self.git('add', 'checks/selected.py', 'value.txt')
        self.git('commit', '-qm', 'Selected behavior fixture')
        return selected.relative_to(self.repo).as_posix()

    def recruit_player(self):
        base = self.git('rev-parse', 'bend2-trial')
        lead = self.trial_call('recruit', 'lead', 'root', 'omp', 'fixture/model', 'low',
                               self.repo, 'lead-branch', self.home / 'lead', base)
        self.trial_call('role', 'lead', 'associate-conductor')
        self.git('checkout', '-q', '--detach', repo=lead['workspace'])
        return self.trial_call('recruit', 'worker', 'lead', 'omp', 'fixture/model', 'low',
                               self.repo, 'worker-branch', self.home / 'worker', base)

    def assert_attached(self, result, native):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        sessions = {row['id']: row for row in self.coordinator('status')}
        self.assertEqual(sessions['operator']['harness'], 'terminal')
        root = sessions['root']
        self.assertEqual(root['harness'], 'codex')
        self.assertEqual(root['native'], native)
        self.assertEqual((root['kind'], root['role']), ('player', 'principal-conductor'))
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
        settings = self.trial_command('sh', '-c',
            'printf "%s\\n" "$TRIAL_PRINCIPAL_INSTRUCTIONS" "$TRIAL_ROOT_INSTRUCTIONS" '
            '"$TRIAL_ASSOCIATE_INSTRUCTIONS" "$TRIAL_LEAD_INSTRUCTIONS"')
        self.assertEqual(settings.returncode, 0, settings.stderr)
        principal, legacy_root, associate, legacy_lead = settings.stdout.splitlines()
        self.assertEqual(principal, legacy_root)
        self.assertEqual(associate, legacy_lead)
        self.assertTrue(principal.endswith('/principal-conductor-instructions.md'))
        self.assertTrue(associate.endswith('/associate-conductor-instructions.md'))
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
        self.assertIn('principal-conductor-instructions.md',
                      (self.state / 'root-instructions.md').read_text())

    def test_missing_check_refuses_before_state_login_or_build(self):
        refs = self.git('show-ref')
        result = self.launch(self.home / 'missing-check.sh')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('CHECK_PROGRAM: file unavailable:', result.stderr)
        self.assertFalse(self.state.exists())
        self.assertFalse(self.db.exists())
        self.assertFalse(self.harness.with_suffix('.calls').exists())
        self.assertFalse((self.home / 'build.json').exists())
        self.assertEqual(self.git('show-ref'), refs)

    def test_relative_compiler_and_explicit_js_check_are_emitted_as_absolute_paths(self):
        self.env['BEND'] = os.path.relpath(self.harness, ROOT)
        check = self.source / 'bend2/scripts/check-node-test.sh'
        self.assert_attached(self.launch(check), '')
        settings = self.trial_command(sys.executable, '-c',
            'import json,os; print(json.dumps({k:os.environ[k] for k in ("BEND","TRIAL_CHECK")}))')
        self.assertEqual(settings.returncode, 0, settings.stderr)
        self.assertEqual(json.loads(settings.stdout), {'BEND': str(self.harness), 'TRIAL_CHECK': str(check)})
        self.assertEqual(json.loads((self.home / 'build.json').read_text()), {'BEND': str(self.harness)})

    def test_selected_python_check_drives_both_landing_levels(self):
        selected = self.selected_check_repository()
        self.env['BEND'] = str(self.harness)
        self.check.chmod(0o600)
        self.assert_attached(self.launch(), '')
        self.git('checkout', '-q', '--detach')
        player = self.recruit_player()
        workspace = pathlib.Path(player['workspace'])
        (workspace / 'worker-change.txt').write_text('reviewed worker change\n')
        self.git('add', 'worker-change.txt', repo=workspace)
        self.git('commit', '-qm', 'Worker change', repo=workspace)
        player_tip = self.git('rev-parse', 'HEAD', repo=workspace)
        for session, target in (('worker', 'lead-branch'), ('lead', 'bend2-trial')):
            result = self.trial_call('land-checked', session, self.repo, target, self.check, selected)
            self.assertEqual(result['status'], 'landed', result)
            self.assertEqual(self.git('show', target + ':worker-change.txt'), 'reviewed worker change')
        self.assertEqual(self.git('rev-parse', 'HEAD', repo=workspace), player_tip)
        rows = [json.loads(line) for line in (self.home / 'checks.jsonl').read_text().splitlines()]
        self.assertEqual(len(rows), 4)
        self.assertTrue(all(row['BEND'] == str(self.harness) for row in rows))
        self.assertTrue(all(pathlib.Path(row['file']).relative_to(row['cwd']).as_posix() == selected
                            for row in rows))

    def test_selected_python_failure_preserves_target_and_player(self):
        selected = self.selected_check_repository()
        self.env['BEND'] = str(self.harness)
        self.assert_attached(self.launch(), '')
        self.git('checkout', '-q', '--detach')
        player = self.recruit_player()
        workspace = pathlib.Path(player['workspace'])
        (workspace / 'value.txt').write_text('broken\n')
        self.git('add', 'value.txt', repo=workspace)
        self.git('commit', '-qm', 'Broken worker change', repo=workspace)
        target_tip = self.git('rev-parse', 'lead-branch')
        player_tip = self.git('rev-parse', 'HEAD', repo=workspace)
        result = self.trial_call('land-checked', 'worker', self.repo, 'lead-branch', self.check, selected)
        self.assertEqual(result['status'], 'blocked', result)
        self.assertEqual(self.git('rev-parse', 'lead-branch'), target_tip)
        self.assertEqual(self.git('rev-parse', 'HEAD', repo=workspace), player_tip)
        self.assertEqual((workspace / 'value.txt').read_text(), 'broken\n')
        self.assertEqual(self.git('status', '--porcelain', repo=workspace), '')


if __name__ == '__main__':
    unittest.main()
