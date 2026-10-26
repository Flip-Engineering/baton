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
        import importlib.util
        import json
        import subprocess
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
            with self.subTest(mode=mode), tempfile.TemporaryDirectory(prefix='queue-adapter-') as temporary:
                root = pathlib.Path(temporary)
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
                result = subprocess.run(
                    [sys.executable, str(adapter_path), 'stage', 'cc',
                     str(compiler), '-o', str(output), str(source)],
                    cwd=root, env=environment, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertEqual(output.read_text(), 'adapter-artifact\n')
                requests = list((run / 'evidence/compile-queue').glob('*/request.json'))
                self.assertEqual(len(requests), 1)
                request = json.loads(requests[0].read_text())
                self.assertEqual(request['exit_code'], 0)
                self.assertGreaterEqual(request['finished_ns'], request['started_ns'])
                receipt = dict(line.split('=', 1) for line in
                               (requests[0].parent / 'receipt').read_text().splitlines()
                               if '=' in line)
                self.assertEqual(receipt['status'], 'completed')
                self.assertEqual(receipt['key'], request['key'])
                self.assertTrue(receipt['owner'])
                saved = dict(line.split('=', 1) for line in
                             (requests[0].parent / 'queue-result').read_text().splitlines()
                             if '=' in line)
                self.assertEqual(saved['schema'], 'baton-compile-queue-result-v2')
                self.assertEqual(saved['status'], 'completed')
                self.assertEqual(saved['exit'], '0')
                self.assertEqual(saved['key'], request['key'])
                self.assertEqual(saved['verified'], '1')


if __name__ == '__main__':
    unittest.main()
