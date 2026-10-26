"""Check adapter exit disposition with small subprocesses; no compiler runs."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
ADAPTER = Path(os.environ.get(
    'BATON2_NATIVE_QUEUE_ADAPTER', ROOT / '.github/scripts/queue-native-checks.py'))


@unittest.skipUnless(os.name == 'posix', 'Linux CI adapter requires POSIX signals')
class AdapterExitTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='queue-adapter-exit-')
        self.addCleanup(temporary.cleanup)
        self.temp = temporary
        self.output = Path(temporary.name) / 'output.c'

    def run_child(self, code, *args):
        return subprocess.run([
            sys.executable, str(ADAPTER), 'execute-cgen', str(self.output),
            sys.executable, '-c', code, *args], capture_output=True)

    def attempt(self, root):
        attempt = root / 'attempt'
        work = attempt / 'work'
        work.mkdir(parents=True)
        (attempt / 'meta').write_text(
            'kind=cgen\nkey=fixture-key\nentry=example.bend\nartifact_name=output.c\n')
        (attempt / 'argv').write_bytes(b'compiler\0example.bend\0')
        (attempt / 'command').write_text('compiler example.bend -o output.c\n')
        (attempt / 'source-digest').write_text('digest=fixture-source-digest\n')
        return attempt, work / 'output.c'

    def run_attempt(self, output, command, environment):
        argv = [sys.executable, str(ADAPTER), 'execute-cgen', str(output), *command]
        return subprocess.run(argv, capture_output=True, env=environment)

    def assert_signal(self, signum):
        result = self.run_child(
            'import os, signal; os.kill(os.getpid(), ' + str(signum) + ')')
        self.assertEqual(result.returncode, -signum, result.stderr)
        self.assertFalse(self.output.exists())

    def test_compiler_sigkill_is_visible_to_the_queue(self):
        self.assert_signal(signal.SIGKILL)

    def test_compiler_sigterm_is_visible_to_the_queue(self):
        self.assert_signal(signal.SIGTERM)

    def test_nonzero_exit_and_output_are_preserved(self):
        result = self.run_child(
            'import sys; print("child stdout"); '
            'print("child stderr", file=sys.stderr); sys.exit(17)')
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stdout, b'child stdout\n')
        self.assertEqual(result.stderr, b'child stderr\n')
        self.assertFalse(self.output.exists())

    def test_successful_check_creates_its_artifact(self):
        result = self.run_child('pass')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_text(),
                         '/* Compiler check completed successfully. */\n')

    def test_generated_output_is_preserved(self):
        result = self.run_child(
            'from pathlib import Path; import sys; '
            'Path(sys.argv[2]).write_text("generated output\\n")',
            '-o', str(self.output))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.output.read_text(), 'generated output\n')

    def test_execution_metadata_keeps_allowlisted_values_and_excludes_environment(self):
        attempt, output = self.attempt(Path(self.temp.name))
        environment = dict(os.environ)
        environment.update({
            'BEND_COMPILER_DIAGNOSTICS': '1',
            'BEND_FACTS_ONLY_FIRST': '',
            'BUN_JSC_maxPerThreadStackUsage': '67108864',
            'BUN_OPTIONS': '--env-file=/private/path/fixture-secret',
            'BEND_BASE': 'must-not-be-retained',
            'OPENAI_API_KEY': 'fixture-secret-value',
        })
        environment.pop('BEND_NO_TELEMETRY', None)
        environment.pop('BEND_LIB', None)
        code = "import sys; print('child stdout'); print('child stderr', file=sys.stderr); sys.exit(17)"
        result = self.run_attempt(output, [sys.executable, '-c', code], environment)
        self.assertEqual(result.returncode, 17)
        self.assertEqual(result.stdout, b'child stdout\n')
        self.assertEqual(result.stderr, b'child stderr\n')
        metadata_bytes = (attempt / 'compiler-diagnostics.json').read_bytes()
        metadata = json.loads(metadata_bytes)
        observed = metadata['environment']
        self.assertEqual(observed['BEND_COMPILER_DIAGNOSTICS'],
                         {'state': 'set', 'enabled': True})
        self.assertEqual(observed['BEND_FACTS_ONLY_FIRST'], {'state': 'empty'})
        self.assertEqual(observed['BEND_NO_TELEMETRY'], {'state': 'absent'})
        self.assertEqual(observed['BEND_LIB'], {
            'state': 'absent', 'effective_path': str(Path.home() / '.bend' / 'lib')})
        self.assertEqual(observed['BUN_OPTIONS'], {
            'state': 'set', 'value': 'omitted because option text may contain secrets'})
        self.assertEqual(observed['BUN_JSC_maxPerThreadStackUsage'],
                         {'state': 'set', 'value': 67108864})
        self.assertEqual(metadata['queue_attempt']['source_digest'],
                         'digest=fixture-source-digest')
        self.assertIn('cpu_affinity', metadata)
        self.assertNotIn(b'must-not-be-retained', metadata_bytes)
        self.assertNotIn(b'fixture-secret-value', metadata_bytes)
        self.assertNotIn(b'fixture-secret', metadata_bytes)
        self.assertNotIn(b'BEND_BASE', metadata_bytes)
        self.assertNotIn(b'OPENAI_API_KEY', metadata_bytes)

    def test_execution_metadata_is_written_before_a_killed_compiler(self):
        attempt, output = self.attempt(Path(self.temp.name))
        code = 'import os, signal; os.kill(os.getpid(), signal.SIGKILL)'
        result = self.run_attempt(output, [sys.executable, '-c', code], dict(os.environ))
        self.assertEqual(result.returncode, -signal.SIGKILL)
        metadata = json.loads((attempt / 'compiler-diagnostics.json').read_text())
        self.assertEqual(metadata['queue_attempt']['meta']['key'], 'fixture-key')

    def test_retain_copies_execution_metadata_with_existing_attempt_evidence(self):
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        state = Path(self.temp.name) / 'state'
        keydir = state / 'keys' / 'fixture-key'
        completed = keydir / 'completed'
        attempt = keydir / 'runs' / 'fixture-run'
        completed.mkdir(parents=True)
        attempt.mkdir(parents=True)
        (completed / 'result').write_text('attempt=' + str(attempt) + '\n')
        for name in ('stdout', 'stderr', 'meta', 'command', 'source-digest'):
            (attempt / name).write_text('')
        diagnostic = b'{"schema":"baton2-compiler-execution-observation-v1"}\n'
        (attempt / 'compiler-diagnostics.json').write_bytes(diagnostic)
        evidence = Path(self.temp.name) / 'evidence'
        evidence.mkdir()
        adapter.retain({'state': str(state)}, 'fixture-key', evidence, True)
        self.assertEqual((evidence / 'compiler-diagnostics.json').read_bytes(), diagnostic)

    def test_toolchain_identity_uses_matching_packaged_versions(self):
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        toolchain = Path(self.temp.name) / 'toolchain-home'
        binaries = toolchain / 'bin'
        binaries.mkdir(parents=True)
        compiler = binaries / 'bend'
        runtime = binaries / 'bun'
        compiler.write_bytes(b'fixture compiler launcher\n')
        runtime.write_bytes(b'fixture bun runtime\n')
        manifest = {
            'upstream_version': '2.0.25-fixture',
            'source_commit': 'a' * 40,
            'source_tree': 'b' * 40,
            'archive_sha256': 'c' * 64,
            'runtime_arguments': ['--smol'],
            'bun_version': '1.4.4-fixture',
            'bun_revision': 'd' * 40,
            'compiler': {'sha256': hashlib.sha256(compiler.read_bytes()).hexdigest()},
            'bun': {'sha256': hashlib.sha256(runtime.read_bytes()).hexdigest()},
        }
        (toolchain / 'fork-manifest.json').write_text(json.dumps(manifest))
        identity = adapter.toolchain_identity(compiler)
        self.assertEqual(identity['compiler']['version'], '2.0.25-fixture')
        self.assertEqual(identity['compiler']['source_commit'], 'a' * 40)
        self.assertEqual(identity['runtime']['version'], '1.4.4-fixture')
        self.assertEqual(identity['runtime']['revision'], 'd' * 40)
        self.assertTrue(identity['manifest']['compiler_matches'])
        self.assertTrue(identity['manifest']['runtime_matches'])
        runtime.write_bytes(b'changed bun runtime\n')
        changed = adapter.toolchain_identity(compiler)
        self.assertFalse(changed['manifest']['runtime_matches'])
        self.assertIsNone(changed['runtime']['version'])


if __name__ == '__main__':
    unittest.main()
