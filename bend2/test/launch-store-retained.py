"""Retained-launch regression for the OMP and Muse configured store (#933)
and the Claude Code launch environment (#1338).

The fixture drives Turn.retained_prepare with a profile record. The final argv
must bind PI_CODING_AGENT_DIR for OMP and XDG_CONFIG_HOME for Muse, with no
HOME assignment. A selected profile store overrides an inherited value, and
the OMP preflight checks the selected store. A Claude Code launch carries
BUN_OPTIONS with the packaged agent_summary preload. No provider is contacted.
"""
import os
import json
import pathlib
import shlex
import sqlite3
import subprocess
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/launch-store-retained-test'))
UNWRITABLE = pathlib.Path('/proc')


class RetainedStore(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not EXE.is_file() and 'BATON2_EXE' not in os.environ:
            subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                            'bend2/test/launch-store-retained.bend', str(EXE)],
                           cwd=ROOT, check=True)
        if not EXE.is_file():
            raise RuntimeError(f'Retained store fixture is unavailable at {EXE}')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.db = self.root / 'state.db'
        sqlite3.connect(self.db).close()
        self.attempt = self.root / 'attempt'
        self.attempt.mkdir()
        self.home = self.root / 'root-home'
        self.home.mkdir()
        self.owner = None

    def start_owner(self):
        self.owner = subprocess.Popen(
            [str(EXE), '--instance-owner', str(self.db)],
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        while self.owner.poll() is None:
            witness = subprocess.run(
                [str(EXE), '--instance-witness', str(self.db)],
                capture_output=True, text=True)
            if witness.returncode == 0 and witness.stdout.strip():
                return
            time.sleep(0.05)
        self.fail('instance owner exited before readiness: '
                  + (self.owner.stderr.read() or ''))

    def tearDown(self):
        shutdown = subprocess.run(
            [str(EXE), '--instance-shutdown', str(self.db)],
            capture_output=True, text=True)
        if self.owner is not None:
            status = self.owner.wait()
            self.assertEqual(status, 0, self.owner.stderr.read() or '')
        self.assertEqual(shutdown.returncode, 0, shutdown.stdout + shutdown.stderr)

    def select(self, harness, store):
        (self.db.parent / (self.db.name + '.profiles')).write_text(
            harness + ' main ' + str(store) + '\n')
        record = self.root / (self.db.name + '.profile-' + 'store-fixture'.encode().hex())
        record.write_text(' ' + harness + ' main ' + str(store) + '\n')

    def run_fixture(self, harness, extra=None, drop=(), session=None):
        self.start_owner()
        environment = {**os.environ, 'HOME': str(self.home)}
        for name in drop:
            environment.pop(name, None)
        if extra:
            environment.update(extra)
        return subprocess.run([str(EXE), str(self.db), str(self.attempt), harness, *([session] if session else [])],
                              env=environment, text=True, capture_output=True)

    def argv(self, harness, extra=None):
        result = self.run_fixture(harness, extra)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [line.split('\t', 1)[1] for line in result.stdout.splitlines()
                if line.startswith('arg\t')]

    def test_omp_profile_binds_agent_dir(self):
        store = self.root / 'omp-agent'
        store.mkdir()
        self.select('omp', store)
        argv = self.argv('omp', {'PI_CODING_AGENT_DIR': '/ambient-agent'})
        self.assertIn('PI_CODING_AGENT_DIR=' + str(store), argv)
        self.assertFalse([value for value in argv if value.startswith('HOME=')])
        self.assertNotIn('/ambient-agent', argv)

    def test_muse_profile_binds_config_home(self):
        store = self.root / 'muse-config'
        store.mkdir()
        self.select('muse', store)
        argv = self.argv('muse', {'XDG_CONFIG_HOME': '/ambient-config'})
        self.assertIn('XDG_CONFIG_HOME=' + str(store), argv)
        self.assertFalse([value for value in argv if value.startswith('HOME=')])
        self.assertNotIn('/ambient-config', argv)
        configs = [argv[index + 1] for index, value in enumerate(argv[:-1])
                   if value == '--config']
        hooks = next(json.loads(value[len('hooks='):]) for value in configs
                     if value.startswith('hooks='))
        self.assertEqual({'PostToolUse', 'Stop'}, set(hooks))
        for event in ('PostToolUse', 'Stop'):
            command = hooks[event][0]['hooks'][0]['command']
            self.assertEqual([
                '/usr/bin/env',
                'BATON_DATABASE=' + str(self.db.resolve()),
                'BATON_SESSION=store-fixture',
                'BATON_ATTEMPT_DIRECTORY=' + str(self.attempt.resolve()),
                str(EXE.resolve()),
                '--stop-hook',
            ], shlex.split(command))
        self.assertEqual(1, len(configs))

    def test_no_profile_adds_no_store_binding(self):
        for harness in ('omp', 'muse'):
            with self.subTest(harness=harness):
                argv = self.argv(harness)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertFalse([value for value in argv if value.startswith('PI_CODING_AGENT_DIR=')])
                self.assertFalse([value for value in argv if value.startswith('XDG_CONFIG_HOME=')])

    def claude_argv(self, bun_options, session=None):
        result = self.run_fixture('claude-code', {'BUN_OPTIONS': bun_options} if bun_options else None,
                                  drop=() if bun_options else ('BUN_OPTIONS',), session=session)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [line.split('\t', 1)[1] for line in result.stdout.splitlines()
                if line.startswith('arg\t')]

    def test_claude_launch_carries_the_preload(self):
        preload = '--preload=' + str(ROOT / 'bend2/scripts/no-agent-summary.js')
        argv = self.claude_argv(None)
        self.assertIn('BUN_OPTIONS=' + preload, argv)
        self.assertLess(argv.index('BUN_OPTIONS=' + preload), argv.index('/usr/bin/claude'))

    def test_claude_launch_appends_to_inherited_bun_options(self):
        preload = '--preload=' + str(ROOT / 'bend2/scripts/no-agent-summary.js')
        argv = self.claude_argv('--smol')
        self.assertIn('BUN_OPTIONS=--smol ' + preload, argv)
        self.assertEqual(1, len([value for value in argv if value.startswith('BUN_OPTIONS=')]))

    def test_other_harnesses_carry_no_preload(self):
        for harness in ('omp', 'muse'):
            with self.subTest(harness=harness):
                self.assertFalse([value for value in self.argv(harness) if value.startswith('BUN_OPTIONS=')])

    def check_report(self):
        report = self.attempt / 'agent-summary-check.json'
        for _ in range(200):
            if report.exists():
                break
            time.sleep(0.05)
        self.assertTrue(report.exists(), 'the seat-start check wrote no report')
        return json.loads(report.read_text())

    def test_claude_seat_start_writes_the_check_report(self):
        self.claude_argv(None)
        findings = self.check_report()['findings']
        self.assertEqual(['claude-unreadable'], [finding['code'] for finding in findings])

    def test_a_resumed_claude_start_carries_the_preload_and_runs_the_check(self):
        preload = '--preload=' + str(ROOT / 'bend2/scripts/no-agent-summary.js')
        argv = self.claude_argv(None, session='native-claude-1')
        self.assertIn('BUN_OPTIONS=' + preload, argv)
        self.assertEqual('native-claude-1', argv[argv.index('--resume') + 1])
        findings = self.check_report()['findings']
        self.assertEqual(['claude-unreadable'], [finding['code'] for finding in findings])
        # A finding does not stop the launch: the argv above was produced.

    def test_unwritable_omp_profile_store_is_refused(self):
        self.select('omp', UNWRITABLE)
        result = self.run_fixture('omp')
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('retained prepare failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
