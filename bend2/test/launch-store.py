"""Regression for the OMP and Muse configured store binding (#933).

The fixture drives the production argv composition, final-argv preflight and
child environment. OMP must set PI_CODING_AGENT_DIR and Muse must set
XDG_CONFIG_HOME from the selected store. HOME is inherited unchanged.
No provider or credential is contacted.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/launch-store-test'))
UNWRITABLE = pathlib.Path('/proc')
OMP = os.environ.get('BATON2_OMP', '')
SCRIPT = """#!/bin/sh
printf 'HOME=%s\\n' "$HOME" > "$PROBE_OUT"
printf 'PI_CODING_AGENT_DIR=%s\\n' "$PI_CODING_AGENT_DIR" >> "$PROBE_OUT"
printf 'XDG_CONFIG_HOME=%s\\n' "$XDG_CONFIG_HOME" >> "$PROBE_OUT"
"""


class LaunchStore(unittest.TestCase):
    def setUp(self):
        if not EXE.is_file():
            self.skipTest(f'launch store fixture not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.home = self.root / 'root-home'
        self.home.mkdir()
        self.store = self.root / 'store'
        self.store.mkdir()
        self.out = self.root / 'child-env.txt'
        self.script = self.root / 'fake'
        self.script.write_text(SCRIPT)
        self.script.chmod(0o755)

    def run_fixture(self, args, home=None, extra=None):
        environment = {**os.environ, 'HOME': str(home or self.home),
                       'PROBE_OUT': str(self.out)}
        if extra:
            environment.update(extra)
        return subprocess.run([str(EXE), *args], env=environment,
                              text=True, capture_output=True, timeout=60)

    def argv(self, mode, store='', home=None):
        result = self.run_fixture([mode, str(store) if store else ''], home=home)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [line.split('\t', 1)[1] for line in result.stdout.splitlines()
                if line.startswith('arg\t')]

    def verdict(self, store, home):
        result = self.run_fixture(['preflight', str(store)], home=home)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout.strip()

    def test_omp_fresh_and_resume_bind_supported_store(self):
        for mode in ('omp-fresh', 'omp-resume'):
            with self.subTest(mode=mode):
                argv = self.argv(mode, self.store)
                self.assertIn('PI_CODING_AGENT_DIR=' + str(self.store), argv)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertIn('/usr/bin/omp', argv)
        self.assertIn('--resume', self.argv('omp-resume', self.store))

    def test_muse_fresh_and_resume_bind_xdg_config_home(self):
        for mode in ('muse-fresh', 'muse-resume'):
            with self.subTest(mode=mode):
                argv = self.argv(mode, self.store)
                self.assertIn('XDG_CONFIG_HOME=' + str(self.store), argv)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertIn('/usr/bin/muse', argv)
        self.assertIn('--session-id', self.argv('muse-resume', self.store))

    def test_plain_argv_has_no_store_or_home_binding(self):
        for mode in ('omp-plain', 'muse-plain'):
            with self.subTest(mode=mode):
                argv = self.argv(mode)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertFalse([value for value in argv if value.startswith('PI_CODING_AGENT_DIR=')])
                self.assertFalse([value for value in argv if value.startswith('XDG_CONFIG_HOME=')])


    def test_inherited_root_home_is_never_in_argv(self):
        root_home = pathlib.Path('/root')
        for mode in ('omp-fresh', 'muse-fresh'):
            with self.subTest(mode=mode):
                argv = self.argv(mode, self.store, home=root_home)
                self.assertFalse([value for value in argv if value.startswith('HOME=')])
                self.assertIn('/usr/bin/omp' if mode.startswith('omp') else '/usr/bin/muse', argv)
                store_var = ('PI_CODING_AGENT_DIR=' if mode.startswith('omp')
                             else 'XDG_CONFIG_HOME=')
                self.assertIn(store_var + str(self.store), argv)

    def test_preflight_checks_inherited_home_and_selected_store(self):
        self.assertEqual(self.verdict(self.store, self.home), 'preflight-ok')
        self.assertEqual(self.verdict(UNWRITABLE, self.home), 'preflight-refused')
        self.assertEqual(self.verdict(self.store, UNWRITABLE), 'preflight-refused')

    def test_child_environment_preserves_home_and_binds_store(self):
        ambient = {'PI_CODING_AGENT_DIR': '/ambient-agent',
                   'XDG_CONFIG_HOME': '/ambient-config'}
        for harness in ('omp', 'muse'):
            with self.subTest(harness=harness):
                if self.out.exists():
                    self.out.unlink()
                result = self.run_fixture(
                    ['spawn', harness, str(self.script), str(self.store), 'fresh'],
                    extra=ambient)
                self.assertEqual(result.returncode, 0, result.stderr)
                values = dict(line.split('=', 1) for line in
                              self.out.read_text().splitlines() if '=' in line)
                self.assertEqual(values['HOME'], str(self.home))
                if harness == 'omp':
                    self.assertEqual(values['PI_CODING_AGENT_DIR'], str(self.store))
                    self.assertEqual(values['XDG_CONFIG_HOME'], '/ambient-config')
                else:
                    self.assertEqual(values['XDG_CONFIG_HOME'], str(self.store))
                    self.assertEqual(values['PI_CODING_AGENT_DIR'], '/ambient-agent')

    def test_omp_help_documents_the_supported_agent_dir(self):
        if not OMP:
            self.skipTest('BATON2_OMP is not set')
        result = subprocess.run([OMP, '--help'], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('PI_CODING_AGENT_DIR', result.stdout)


if __name__ == '__main__':
    unittest.main()
