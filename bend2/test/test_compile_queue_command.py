import os
import pathlib
import tempfile
import unittest
from unittest import mock

import compile_queue


class QueueCommandTests(unittest.TestCase):
    def test_native_binary_gets_runtime_delimiter(self):
        with mock.patch.dict(os.environ, {
                'BATON2_COMPILE_QUEUE_BIN': '/opt/baton/bin/compile-queue',
                'BATON2_COMPILE_QUEUE': '/opt/baton/bin/compile-queue.sh'}):
            self.assertEqual(
                compile_queue.queue_command('/opt/baton/bin/compile-queue', ['run', '--kind', 'cc']),
                ['/opt/baton/bin/compile-queue', '--', 'run', '--kind', 'cc'])

    def test_public_launcher_keeps_its_command_contract(self):
        with mock.patch.dict(os.environ, {'BATON2_COMPILE_QUEUE': '/opt/baton/bin/compile-queue.sh'}, clear=True):
            self.assertEqual(
                compile_queue.queue_command('/opt/baton/bin/compile-queue.sh', ['run', '--kind', 'cc']),
                ['/opt/baton/bin/compile-queue.sh', 'run', '--kind', 'cc'])

    def test_native_binary_runs_fake_compiler(self):
        native = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
        if not native:
            self.skipTest('BATON2_COMPILE_QUEUE_BIN is not configured')
        state = os.environ.get('BATON_COMPILE_QUEUE_ROOT')
        if not state or not pathlib.Path(state).is_absolute():
            self.skipTest('BATON_COMPILE_QUEUE_ROOT is not configured')
        with tempfile.TemporaryDirectory(prefix='compile-queue-native-caller-') as temporary:
            root = pathlib.Path(temporary)
            compiler = root / 'fake-cc'
            compiler.write_text('#!/bin/sh\ncase "$1" in\n  --version) printf "fake-cc 1\\n"; exit 0 ;;\n  -print-prog-name=ld) printf "/usr/bin/ld\\n"; exit 0 ;;\nesac\nout=\nprevious=\nfor arg in "$@"; do\n  if [ "$previous" = -o ]; then out=$arg; break; fi\n  previous=$arg\ndone\n[ -n "$out" ] || exit 4\nprintf "fake-native-queue-artifact\\n" > "$out"\n')
            compiler.chmod(0o755)
            source = root / 'input.c'
            source.write_text('int main(void) { return 0; }\n')
            output = root / 'output'
            with mock.patch.dict(os.environ, {
                    'BATON2_COMPILE_QUEUE_BIN': native,
                    'BATON_COMPILE_QUEUE_ROOT': state}, clear=False):
                compile_queue.compile_cc([str(compiler), '-o', str(output), str(source)],
                                         [str(source)], output, root, compiler=str(compiler))
            self.assertEqual(output.read_text(), 'fake-native-queue-artifact\n')



    def test_maintained_adapter_runs_native_and_public_launcher(self):
        import hashlib
        import importlib.util
        import json
        import subprocess
        import time
        import sys

        native = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
        launcher = os.environ.get('BATON2_COMPILE_QUEUE')
        self.assertTrue(native, 'BATON2_COMPILE_QUEUE_BIN is required')
        self.assertTrue(launcher, 'BATON2_COMPILE_QUEUE is required')
        repo = pathlib.Path(__file__).resolve().parents[2]
        adapter_path = repo / '.github/scripts/queue-native-checks.py'
        spec = importlib.util.spec_from_file_location('maintained_queue_adapter', adapter_path)
        adapter = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(adapter)
        for mode, client in [('native', native), ('launcher', launcher)]:
            with self.subTest(mode=mode):
                evidence = os.environ.get('BATON_COMPILE_QUEUE_TEST_EVIDENCE')
                if evidence:
                    pathlib.Path(evidence).mkdir(parents=True, exist_ok=True)
                root = pathlib.Path(tempfile.mkdtemp(prefix='queue-adapter-' + mode + '-', dir=evidence))
                print('retained queue adapter evidence: ' + str(root), flush=True)
                state = root / 'queue'
                state.mkdir(mode=0o2770)
                state.chmod(0o2770)
                run = root / 'run'
                run.mkdir()
                compiler = root / 'fake-cc'
                compiler.write_text(
                    '#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; esac\n'
                    'previous=\nfor arg in "$@"; do\n'
                    '  if [ "$previous" = -o ]; then printf "adapter-artifact\\n" > "$arg"; exit 0; fi\n'
                    '  previous=$arg\ndone\nexit 4\n')
                compiler.chmod(0o755)
                source = root / 'input.c'
                source.write_text('int main(void){return 0;}\n')
                output = root / 'result'
                with mock.patch.dict(os.environ, {
                        'BEND': str(compiler), 'CC': str(compiler),
                        'BATON_COMPILE_QUEUE_ROOT': str(state)}), \
                        mock.patch.object(adapter, 'CLIENT', str(pathlib.Path(client).resolve())), \
                        mock.patch.object(adapter, 'STATE', str(state)):
                    environment = adapter.environment(run)
                argv = [sys.executable, str(adapter_path), 'stage', 'cc',
                        str(compiler), '-o', output.name, source.name]
                started_ns = time.time_ns()
                process = subprocess.Popen(argv, cwd=root, env=environment,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                stdout, stderr = process.communicate()
                finished_ns = time.time_ns()
                result = subprocess.CompletedProcess(argv, process.returncode, stdout, stderr)
                (root / 'adapter.stdout').write_text(result.stdout)
                (root / 'adapter.stderr').write_text(result.stderr)
                (root / 'process.json').write_text(json.dumps({
                    'argv': result.args, 'cwd': str(root), 'exit_code': result.returncode,
                    'pid': process.pid, 'started_ns': started_ns, 'finished_ns': finished_ns,
                    'client': str(pathlib.Path(client).resolve()),
                    'native_sha256': hashlib.sha256(pathlib.Path(native).read_bytes()).hexdigest(),
                    'launcher_sha256': hashlib.sha256(pathlib.Path(launcher).read_bytes()).hexdigest(),
                    'adapter_sha256': hashlib.sha256(adapter_path.read_bytes()).hexdigest(),
                    'python': sys.executable,
                    'python_sha256': hashlib.sha256(pathlib.Path(sys.executable).read_bytes()).hexdigest(),
                }, indent=2) + '\n')
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(output.read_text(), 'adapter-artifact\n')
                requests = list((run / 'evidence/compile-queue').glob('*/request.json'))
                self.assertEqual(len(requests), 1)
                request = json.loads(requests[0].read_text())
                self.assertEqual(request['cwd'], str(root))
                self.assertEqual(request['command'], [str(compiler), '-o', str(output), source.name])
                self.assertRegex(request['key'], r'^[0-9a-f]{64}$')
                self.assertEqual(request['key_argv'][:3], [str(pathlib.Path(client).resolve()), '--', 'key'])
                self.assertEqual(request['argv'][:3], [str(pathlib.Path(client).resolve()), '--', 'run'])
                self.assertEqual(request['argv'][3:7], ['--token', request['token'], '--receipt', str(requests[0].parent / 'receipt')])
                self.assertEqual(request['argv'][7:], request['key_argv'][3:])
                common = request['key_argv'][3:]
                separator = common.index('--')
                flags = common[:separator]
                self.assertEqual(len(flags) % 2, 0)
                options = dict(zip(flags[::2], flags[1::2]))
                for option, expected in {
                        '--state-root': str(state), '--cwd': str(root), '--root': str(root),
                        '--kind': 'cc', '--source-root': '/', '--compiler': str(compiler),
                        '--artifact': 'output=' + str(output)}.items():
                    self.assertEqual(options[option], expected, option)
                self.assertEqual(common[separator + 1:],
                                 [str(compiler), '-o', str(output), source.name])
                self.assertEqual(request['exit_code'], 0)
                self.assertGreaterEqual(request['finished_ns'], request['started_ns'])
                receipt = dict(line.split('=', 1) for line in
                               (requests[0].parent / 'receipt').read_text().splitlines()
                               if '=' in line)
                self.assertEqual(receipt['status'], 'completed')
                self.assertEqual(receipt['key'], request['key'])
                self.assertEqual(receipt['owner'], request['token'])
                self.assertEqual(receipt['artifact-output'], str(output))
                saved = dict(line.split('=', 1) for line in
                             (requests[0].parent / 'queue-result').read_text().splitlines()
                             if '=' in line)
                self.assertEqual(saved['schema'], 'baton-compile-queue-result-v2')
                self.assertEqual(saved['status'], 'completed')
                self.assertEqual(saved['exit'], '0')
                self.assertEqual(saved['key'], request['key'])
                self.assertEqual(saved['verified'], '1')
                self.assertEqual(saved['identity_schema'], 'baton-compile-queue-identity-v2')
                expected_digest = hashlib.sha256(b'adapter-artifact\n').hexdigest()
                self.assertEqual(saved['artifact'], 'output\tfile\t' + expected_digest)
                self.assertEqual(hashlib.sha256(output.read_bytes()).hexdigest(), expected_digest)



class QueueExecutionIdentityTests(unittest.TestCase):
    """Paired cache-key qualification against the installed native queue client.

    Diagnostic-only edits to the queue adapter must leave the key unchanged,
    an edit to the executed module must change it, and source, compiler and
    argv changes must produce different keys. Key requests only: no compiler
    runs, no queue record is written or adopted.
    """

    def setUp(self):
        import json
        import shutil
        import sys
        self.native = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
        if not self.native:
            self.skipTest('BATON2_COMPILE_QUEUE_BIN is not configured')
        self.json = json
        self.sys = sys
        repo = pathlib.Path(__file__).resolve().parents[2]
        self.adapter_source = repo / '.github' / 'scripts' / 'queue-native-checks.py'
        self.exec_source = repo / '.github' / 'scripts' / 'compile-cgen-exec.py'
        self.root = pathlib.Path(tempfile.mkdtemp(prefix='queue-identity-pair-'))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.compiler = self.root / 'fake-cc'
        self.compiler.write_text(
            '#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; esac\nexit 0\n')
        self.compiler.chmod(0o755)
        self.entry = self.root / 'entry.bend'
        self.entry.write_text('law main() {}\n')
        self.source = self.root / 'input.c'
        self.source.write_text('int fixture(void) { return 0; }\n')
        run = self.root / 'run'
        run.mkdir()
        self.state = self.root / 'state'
        self.state.mkdir()
        self.config = run / 'queue-config.json'
        self.config.write_text(self.json.dumps({
            'run': str(run), 'bend': str(self.compiler), 'cc': str(self.compiler),
            'client': str(pathlib.Path(self.native).resolve()), 'state': str(self.state)}))

    def materialize_adapter(self):
        import hashlib
        target = self.root / '.github' / 'scripts'
        target.mkdir(parents=True, exist_ok=True)
        for source in (self.adapter_source, self.exec_source):
            (target / source.name).write_text(source.read_text())
        self.materialized_digest = hashlib.sha256(
            (target / self.adapter_source.name).read_bytes()).hexdigest()
        return target / self.adapter_source.name

    def key_of(self, mode, argv, adapt=True):
        import subprocess
        import sys
        if adapt:
            self.materialize_adapter()
        adapter = self.root / '.github' / 'scripts' / self.adapter_source.name
        environment = dict(os.environ,
                           BEND=str(self.compiler), CC=str(self.compiler),
                           BATON2_NATIVE_QUEUE=str(self.config),
                           BATON_COMPILE_QUEUE_ROOT=str(self.state))
        result = subprocess.run(
            [self.sys.executable, str(adapter), 'key', mode, *argv],
            cwd=self.root, env=environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        key = result.stdout.strip()
        self.assertRegex(key, r'^[0-9a-f]{64}$')
        return key

    def cgen_argv(self):
        return ['entry.bend', '-o', 'out.c']

    def cc_argv(self):
        return ['-o', 'out.bin', 'input.c']

    def test_diagnostic_only_adapter_edit_keeps_key_equal(self):
        import hashlib
        for mode, argv in [('bend', self.cgen_argv()), ('cc', self.cc_argv())]:
            with self.subTest(mode=mode):
                adapter = self.materialize_adapter()
                base = self.key_of(mode, argv, adapt=False)
                adapter.write_text(adapter.read_text()
                                   + '\n# diagnostic-retention fixture variant\n')
                edited_digest = hashlib.sha256(adapter.read_bytes()).hexdigest()
                self.assertNotEqual(edited_digest, self.materialized_digest,
                                    'the paired run did not exercise edited adapter bytes')
                self.assertEqual(base, self.key_of(mode, argv, adapt=False))

    def test_execution_wrapper_edit_changes_key(self):
        base = self.key_of('bend', self.cgen_argv())
        executed = self.root / '.github' / 'scripts' / self.exec_source.name
        executed.write_text(executed.read_text().replace(
            'completed successfully', 'completed fixture'))
        self.assertNotEqual(base, self.key_of('bend', self.cgen_argv(), adapt=False))

    def test_cgen_source_change_changes_key(self):
        base = self.key_of('bend', self.cgen_argv())
        self.entry.write_text('law main() { 1 }\n')
        self.assertNotEqual(base, self.key_of('bend', self.cgen_argv()))

    def test_cgen_argv_change_changes_key(self):
        base = self.key_of('bend', self.cgen_argv())
        changed = ['entry.bend', '-o', 'out.c', '--extra-fact']
        self.assertNotEqual(base, self.key_of('bend', changed))

    def test_compiler_change_changes_key(self):
        for mode, argv in [('bend', self.cgen_argv()), ('cc', self.cc_argv())]:
            with self.subTest(mode=mode):
                base = self.key_of(mode, argv)
                self.compiler.write_text(
                    '#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; esac\n# fixture rebuild\nexit 0\n')
                self.assertNotEqual(base, self.key_of(mode, argv))
                self.compiler.write_text(
                    '#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; esac\nexit 0\n')

    def test_cc_input_change_changes_key(self):
        base = self.key_of('cc', self.cc_argv())
        self.source.write_text('int fixture(void) { return 1; }\n')
        self.assertNotEqual(base, self.key_of('cc', self.cc_argv()))


if __name__ == '__main__':
    unittest.main()
