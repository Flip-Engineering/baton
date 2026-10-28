"""Check adapter exit disposition with small subprocesses; no compiler runs."""
import hashlib
import io
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
ADAPTER = Path(os.environ.get(
    'BATON2_NATIVE_QUEUE_ADAPTER', ROOT / '.github/scripts/queue-native-checks.py'))
EXEC = ROOT / '.github/scripts/compile-cgen-exec.py'


@unittest.skipUnless(os.name == 'posix', 'Linux CI adapter requires POSIX signals')
class AdapterExitTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='queue-adapter-exit-')
        self.addCleanup(temporary.cleanup)
        self.temp = temporary
        self.output = Path(temporary.name) / 'output.c'

    def run_child(self, code, *args):
        return subprocess.run([
            sys.executable, str(EXEC), str(self.output),
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
        argv = [sys.executable, str(EXEC), str(output), *command]
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

    def test_failed_queue_key_retains_process_and_source_evidence(self):
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        root = Path(self.temp.name).resolve()
        client = root / 'fake-queue-client'
        client.write_text(
            '#!/usr/bin/env python3\n'
            'import sys\n'
            'print("key stdout fixture")\n'
            'print("key stderr fixture", file=sys.stderr)\n'
            'raise SystemExit(29)\n')
        client.chmod(0o755)
        compiler = root / 'fake-compiler'
        compiler.write_text('#!/bin/sh\nexit 0\n')
        compiler.chmod(0o755)
        source = root / 'input.c'
        source.write_text('int fixture(void) { return 0; }\n')
        directory = root / 'evidence'
        directory.mkdir()
        config = {'client': str(client), 'state': str(root / 'state')}
        options = ['--kind', 'cc', '--compiler', str(compiler)]
        command = [str(compiler), '-c', str(source)]

        previous_cwd = Path.cwd()
        try:
            os.chdir(root)
            with open(root / 'parent.stderr', 'wb') as stderr_file, \
                    mock.patch.object(adapter.sys, 'stderr', mock.Mock(buffer=stderr_file)):
                code = adapter.submit(config, directory, options, command, key_only=True)
        finally:
            os.chdir(previous_cwd)

        self.assertEqual(code, 29)
        self.assertEqual((directory / 'key.stdout').read_bytes(), b'key stdout fixture\n')
        self.assertEqual((directory / 'key.stderr').read_bytes(), b'key stderr fixture\n')
        metadata = json.loads((directory / 'failed-key.json').read_text())
        expected_argv = [str(client), '--', 'key', '--state-root', str(root / 'state'),
                         '--cwd', str(root), '--root', str(root), *options, '--', *command]
        self.assertEqual(metadata['argv'], expected_argv)
        self.assertEqual(metadata['cwd'], str(root))
        self.assertEqual(metadata['exit_code'], 29)
        self.assertEqual(metadata['queue_binary']['sha256'],
                         hashlib.sha256(client.read_bytes()).hexdigest())
        self.assertEqual(metadata['queue_adapter']['sha256'],
                         hashlib.sha256(ADAPTER.read_bytes()).hexdigest())
        source_identity = next(item['identity'] for item in metadata['sources']
                               if item['identity'].get('path') == str(source))
        self.assertEqual(source_identity['sha256'], hashlib.sha256(source.read_bytes()).hexdigest())
        self.assertFalse((directory / 'request.json').exists())

    def test_failed_queue_key_sigkill_retains_evidence_and_signal(self):
        root = Path(self.temp.name).resolve()
        client = root / 'fake-queue-client'
        client.write_text(
            '#!/usr/bin/env python3\n'
            'import os, signal\n'
            'print("key stdout before SIGKILL", flush=True)\n'
            'print("key stderr before SIGKILL", file=__import__("sys").stderr, flush=True)\n'
            'os.kill(os.getpid(), signal.SIGKILL)\n')
        client.chmod(0o755)
        compiler = root / 'fake-compiler'
        compiler.write_text('#!/bin/sh\necho "fake compiler v1"\n')
        compiler.chmod(0o755)
        source = root / 'input.c'
        source.write_text('int fixture(void) { return 0; }\n')
        run = root / 'run'
        run.mkdir()
        config_path = root / 'queue.json'
        config_path.write_text(json.dumps({
            'client': str(client),
            'cc': str(compiler),
            'run': str(run),
            'state': str(root / 'state'),
        }))
        environment = dict(os.environ, BATON2_NATIVE_QUEUE=str(config_path))

        result = subprocess.run(
            [sys.executable, str(ADAPTER), 'key', 'cc', '-c', str(source)],
            cwd=root, env=environment, capture_output=True)

        self.assertEqual(result.returncode, -signal.SIGKILL, result.stderr)
        directories = list((run / 'evidence' / 'compile-queue').iterdir())
        self.assertEqual(len(directories), 1)
        directory = directories[0]
        self.assertEqual((directory / 'key.stdout').read_bytes(),
                         b'key stdout before SIGKILL\n')
        self.assertEqual((directory / 'key.stderr').read_bytes(),
                         b'key stderr before SIGKILL\n')
        metadata = json.loads((directory / 'failed-key.json').read_text())
        self.assertEqual(metadata['exit_code'], -signal.SIGKILL)
        self.assertFalse((directory / 'request.json').exists())

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
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
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
        with mock.patch.dict(os.environ, environment, clear=False):
            adapter.compiler_diagnostics(attempt, [sys.executable, '-c', code])
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

    def test_execution_metadata_is_written_for_a_killed_compiler(self):
        attempt, output = self.attempt(Path(self.temp.name))
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        code = 'import os, signal; os.kill(os.getpid(), signal.SIGKILL)'
        result = self.run_attempt(output, [sys.executable, '-c', code], dict(os.environ))
        self.assertEqual(result.returncode, -signal.SIGKILL)
        adapter.compiler_diagnostics(attempt, [sys.executable, '-c', code])
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

    def run_submit_with_denied_diagnostic_copy(self, success):
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_adapter', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        state = Path(self.temp.name) / ('state-success' if success else 'state-failure')
        keydir = state / 'keys' / 'fixture-key'
        completed = keydir / 'completed'
        attempt = keydir / 'runs' / 'fixture-run'
        attempt.mkdir(parents=True)
        completed.mkdir(parents=True)
        result = ('exit_code=0\n' if success else 'exit_code=17\n') + 'attempt=' + str(attempt) + '\n'
        result_path = completed / 'result' if success else attempt / 'result'
        result_path.write_text(result)
        evidence = {
            'stdout': b'compiler stdout\n',
            'stderr': b'compiler stderr\n',
            'meta': b'kind=cgen\n',
            'command': b'compiler fixture\n',
            'source-digest': b'digest=fixture\n',
            'compiler-diagnostics.json': b'{"schema":"fixture"}\n',
        }
        for name, contents in evidence.items():
            (attempt / name).write_bytes(contents)

        directory = Path(self.temp.name) / ('queue-success' if success else 'queue-failure')
        directory.mkdir()
        config = {'client': 'fixture-client', 'state': str(state)}
        stdout = io.BytesIO()
        stderr = io.BytesIO()

        class BinaryCapture:
            def __init__(self, buffer):
                self.buffer = buffer
                self.text = []

            def write(self, text):
                self.text.append(text)

        class QueueRun:
            def __init__(self, argv, stdout, stderr):
                stdout.write(b'queue stdout\n')
                stderr.write(b'queue stderr\n')

            def wait(self):
                return 0 if success else 17

        real_copyfile = adapter.shutil.copyfile

        def deny_diagnostic_copy(source, destination):
            if Path(source).name == 'compiler-diagnostics.json':
                raise PermissionError(13, 'fixture denied optional diagnostics copy')
            return real_copyfile(source, destination)

        captured_stdout = BinaryCapture(stdout)
        captured_stderr = BinaryCapture(stderr)

        def fake_key_run(argv, **kwargs):
            # run_queue_key calls subprocess.run(key_argv, cwd=..., capture_output=True).
            return subprocess.CompletedProcess(argv, 0, stdout=b'fixture-key\n', stderr=b'')

        with mock.patch.object(adapter.subprocess, 'run', side_effect=fake_key_run), \
                mock.patch.object(adapter.subprocess, 'Popen', side_effect=QueueRun), \
                mock.patch.object(adapter.shutil, 'copyfile', side_effect=deny_diagnostic_copy), \
                mock.patch.object(adapter.sys, 'stdout', captured_stdout), \
                mock.patch.object(adapter.sys, 'stderr', captured_stderr):
            code = adapter.submit(config, directory, [], ['fixture-compiler'])

        expected_code = 0 if success else 17
        self.assertEqual(code, expected_code)
        self.assertIn(b'compiler stdout\n', stdout.getvalue())
        self.assertIn(b'compiler stderr\n', stderr.getvalue())
        if success:
            self.assertNotIn('queue stderr\n', captured_stderr.text)
        else:
            self.assertIn('queue stderr\n', captured_stderr.text)
        self.assertTrue((directory / 'queue-result').is_file())
        for name in ('stdout', 'stderr', 'meta', 'command', 'source-digest'):
            self.assertEqual((directory / name).read_bytes(), evidence[name])
        self.assertFalse((directory / 'compiler-diagnostics.json').exists())

    def test_optional_diagnostic_copy_failure_preserves_successful_outcome(self):
        self.run_submit_with_denied_diagnostic_copy(True)

    def test_optional_diagnostic_copy_failure_preserves_failed_outcome(self):
        self.run_submit_with_denied_diagnostic_copy(False)

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



@unittest.skipUnless(os.name == 'posix', 'Linux CI adapter requires POSIX signals')
class KeyMaterialAdapterIdentityTests(unittest.TestCase):
    """The queue adapter's own bytes never enter the cache key request."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='queue-key-identity-')
        self.addCleanup(temporary.cleanup)
        self.temp = temporary
        self.root = Path(self.temp.name).resolve()
        self.run = self.root / 'run'
        self.run.mkdir()
        self.state = self.root / 'state'
        self.client = self.root / 'fake-queue-client'
        self.client.write_text(
            '#!/usr/bin/env python3\n'
            'import json, os, sys\n'
            'with open(os.environ["FAKE_KEY_ARGV_OUT"], "w") as handle:\n'
            '    json.dump(sys.argv, handle)\n'
            'print("0" * 64)\n')
        self.client.chmod(0o755)
        self.compiler = self.root / 'fake-compiler'
        self.compiler.write_text('#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; esac\nexit 0\n')
        self.compiler.chmod(0o755)
        self.config = {'client': str(self.client), 'state': str(self.state), 'run': str(self.run)}

    def recorded_key_argv(self, mode, argv):
        config_path = self.root / 'queue-config.json'
        config_path.write_text(json.dumps(self.config))
        argv_out = self.root / 'key-argv.json'
        environment = dict(os.environ,
                           BATON2_NATIVE_QUEUE=str(config_path),
                           FAKE_KEY_ARGV_OUT=str(argv_out))
        adapter_spec = importlib.util.spec_from_file_location('queue_native_checks_keymaterial', ADAPTER)
        adapter = importlib.util.module_from_spec(adapter_spec)
        adapter_spec.loader.exec_module(adapter)
        previous_cwd = Path.cwd()
        try:
            os.chdir(self.root)
            with mock.patch.dict(os.environ, environment, clear=False):
                code = adapter.compiler(mode, argv, key_only=True)
        finally:
            os.chdir(previous_cwd)
        self.assertEqual(code, 0)
        recorded = json.loads(argv_out.read_text())
        self.assertEqual(recorded[2], 'key')
        return recorded

    def assert_no_adapter_option(self, recorded):
        options = [recorded[index + 1] for index, value in enumerate(recorded)
                   if value == '--option' and index + 1 < len(recorded)]
        for option in options:
            self.assertFalse(option.startswith('adapter-sha256='),
                             'adapter self-identity leaked into key material: ' + option)

    def test_cc_key_request_excludes_adapter_self_identity(self):
        recorded = self.recorded_key_argv('cc', [str(self.compiler), '-o', 'out', 'input.c'])
        self.assert_no_adapter_option(recorded)

    def test_check_key_request_excludes_adapter_self_identity(self):
        entry = self.root / 'entry.bend'
        entry.write_text('law main() {}\n')
        recorded = self.recorded_key_argv('bend', [str(self.compiler), '--check-only', 'entry.bend'])
        self.assert_no_adapter_option(recorded)

    def test_cgen_key_request_excludes_adapter_self_identity(self):
        entry = self.root / 'entry.bend'
        entry.write_text('law main() {}\n')
        recorded = self.recorded_key_argv('bend', [str(self.compiler), 'entry.bend', '-o', 'out.c'])
        self.assert_no_adapter_option(recorded)


if __name__ == '__main__':
    unittest.main()
