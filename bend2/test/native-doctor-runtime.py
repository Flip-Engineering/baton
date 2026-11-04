"""Regression for `baton doctor` (#1338).

The test compiles the production native-entry router with a stub runtime and
places it in an installed layout and in a source layout. `doctor` must run
agent-summary-check.mjs with the remaining arguments, keep its stdout and use
its exit status. The Claude Code binary is a fixture script.
"""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
NATIVE_ENTRY = pathlib.Path(os.environ.get('BATON2_NATIVE_ENTRY', ROOT / 'bend2/src/host/native-entry.c')).resolve()
STUB = 'int baton2_runtime_main(int argc, char **argv) { return 0; }\n'
ANCHOR = '[AgentSummary] Timer fired'


def compiler():
    for name in (os.environ.get('CC'), 'clang', 'clang-19', '/usr/bin/clang-19'):
        if not name:
            continue
        path = pathlib.Path(name)
        if path.is_file() and os.access(path, os.X_OK):
            return str(path)
        found = shutil.which(name)
        if found:
            return found
    raise unittest.SkipTest('no clang compiler is available')


def fixture_claude(anchor):
    return f"""#!/bin/sh
# {ANCHOR if anchor else 'no timer text here'}
case "$BUN_OPTIONS" in
  *--preload=*) [ -n "$CC_AGENT_SUMMARY_LOG" ] && printf '%s\\n' 'pid=1 preload active mode=off bun=fixture' >> "$CC_AGENT_SUMMARY_LOG" ;;
esac
echo 2.1.312
"""


class Doctor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        node = shutil.which('node')
        if node is None:
            raise unittest.SkipTest('no node runtime is available')
        cls.node = node
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        cls.build = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        stub = pathlib.Path(cls.build.name) / 'stub.c'
        stub.write_text(STUB)
        cls.flavors = {}
        for name, defines in (('plain', []), ('focused', ['-DBATON2_RECEIVE_FOCUSED']),
                              ('router', ['-DBATON2_NATIVE_RECEIVER_ROUTER'])):
            cls.flavors[name] = pathlib.Path(cls.build.name) / ('doctor-test-' + name)
            subprocess.run([compiler(), '-O1', '-pthread', *defines, str(NATIVE_ENTRY), str(stub),
                            '-o', str(cls.flavors[name])], check=True, capture_output=True, text=True)
        cls.exe = cls.flavors['plain']

    @classmethod
    def tearDownClass(cls):
        cls.build.cleanup()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.tools = self.root / 'tools'
        self.tools.mkdir()

    def claude(self, anchor=True):
        path = self.tools / 'claude'
        path.write_text(fixture_claude(anchor))
        path.chmod(0o755)
        return path

    def layout(self, helper_directory, executable):
        helper_directory.mkdir(parents=True)
        for name in ('agent-summary-check.mjs', 'no-agent-summary.js'):
            shutil.copyfile(ROOT / 'bend2/scripts' / name, helper_directory / name)
        executable.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(self.exe, executable)
        executable.chmod(0o755)
        return executable

    def installed(self):
        return self.layout(self.root / 'installed/libexec/baton2', self.root / 'installed/bin/baton')

    def source(self):
        return self.layout(self.root / 'checkout/bend2/scripts', self.root / 'checkout/.scratch/bend2/baton')

    def run_doctor(self, executable, *arguments):
        env = {'PATH': f'{self.tools}:/usr/bin:/bin', 'BATON2_NODE': self.node}
        return subprocess.run([str(executable), 'doctor', *arguments], env=env,
                              capture_output=True, text=True, timeout=60)

    def test_installed_layout_reports_a_passing_claude_on_path(self):
        self.claude()
        result = self.run_doctor(self.installed())
        self.assertEqual(result.returncode, 0, result.stderr)
        report = json.loads(result.stdout)
        self.assertTrue(report['ok'])
        self.assertEqual(report['claude']['path'], str(self.tools / 'claude'))
        self.assertEqual(report['preload']['path'], str(self.root / 'installed/libexec/baton2/no-agent-summary.js'))
        self.assertTrue(report['preload']['loaded'])

    def test_the_focused_and_router_binaries_route_doctor(self):
        self.claude()
        for name in ('focused', 'router'):
            with self.subTest(flavor=name):
                self.exe = self.flavors[name]
                result = self.run_doctor(self.layout(self.root / name / 'libexec/baton2', self.root / name / 'bin/baton'))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(json.loads(result.stdout)['ok'])

    def test_source_layout_finds_the_helper(self):
        self.claude()
        result = self.run_doctor(self.source())
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)['ok'])

    def test_a_missing_anchor_is_a_finding_and_exit_status_1(self):
        self.claude(anchor=False)
        result = self.run_doctor(self.installed())
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual([finding['code'] for finding in json.loads(result.stdout)['findings']], ['anchor-missing'])

    def test_claude_argument_selects_the_binary(self):
        other = self.root / 'other'
        other.mkdir()
        (other / 'claude-2').write_text(fixture_claude(True))
        (other / 'claude-2').chmod(0o755)
        result = self.run_doctor(self.installed(), '--claude', str(other / 'claude-2'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)['claude']['path'], str(other / 'claude-2'))

    def test_help_prints_the_usage(self):
        result = self.run_doctor(self.installed(), '--help')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(result.stdout.startswith('usage: baton doctor'))

    def test_help_action_lists_doctor_with_the_helper_usage(self):
        source = (ROOT / 'bend2/src/coordinator/agent-actions.bend').read_text()
        self.assertIn('repl, clear-stop, doctor.\\nBaton resolves', source)
        line = next(row for row in source.splitlines() if row.lstrip().startswith('case "doctor": "'))
        literal = line.split('case "doctor": ', 1)[1]
        text = json.loads(literal)
        result = self.run_doctor(self.installed(), '--help')
        self.assertEqual(text, result.stdout)

    def test_missing_helper_names_the_installation_problem(self):
        executable = self.root / 'bare/bin/baton'
        executable.parent.mkdir(parents=True)
        shutil.copyfile(self.exe, executable)
        executable.chmod(0o755)
        result = self.run_doctor(executable)
        self.assertEqual(result.returncode, 2)
        self.assertIn('agent-summary-check.mjs is missing from this installation', result.stderr)


if __name__ == '__main__':
    unittest.main()
