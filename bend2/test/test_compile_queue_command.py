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



    def test_checked_in_typescript_queue_callers_run_native_and_launcher(self):
        import json
        import subprocess

        native = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
        state = os.environ.get('BATON_COMPILE_QUEUE_ROOT')
        bun = os.environ.get('BATON2_TEST_BUN')
        launcher = os.environ.get('BATON2_COMPILE_QUEUE')
        if not all((native, state, bun, launcher)):
            self.skipTest('native queue, state, pinned Bun, and launcher are required')
        repo = pathlib.Path(__file__).resolve().parents[2]
        for relative in ('bend2/compiler/upstream/main.ts',
                         'bend2/context/bend2/upstream/main.ts'):
            text = (repo / relative).read_text()
            start = text.index('function queue_cc(')
            end = text.index('// cli_build', start)
            function = text[start:end]
            for mode in ('native', 'launcher'):
                with self.subTest(source=relative, mode=mode), tempfile.TemporaryDirectory(prefix='queue-cc-ts-') as tmp:
                    root = pathlib.Path(tmp)
                    state_root = pathlib.Path(state) / ('ts-' + str(len(relative)) + '-' + mode)
                    state_root.mkdir(mode=0o2770, parents=True, exist_ok=True)
                    compiler = root / 'fake-cc'
                    compiler.write_text('#!/bin/sh\ncase "$1" in --version) echo fake-cc-v1; exit 0;; -print-prog-name=ld) echo fake-ld; exit 0;; esac\nout=\nprev=\nfor arg in "$@"; do if [ "$prev" = -o ]; then out=$arg; break; fi; prev=$arg; done\n[ -n "$out" ] || exit 4\nprintf "ts-native-queue-artifact\\n" > "$out"\n')
                    compiler.chmod(0o755)
                    source = root / 'input.c'
                    source.write_text('int main(void) { return 0; }\n')
                    output = root / 'result'
                    queue = native if mode == 'native' else launcher
                    harness = root / 'harness.ts'
                    argv = ['-o', str(output), str(source)]
                    call = ('\nqueue_cc(' + json.dumps(queue) + ', ' + json.dumps(str(state_root)) +
                            ', ' + json.dumps(str(compiler)) + ', "/usr/bin/ld", "fake-cc-v1", ' +
                            json.dumps(str(source)) + ', [], "binary", ' + json.dumps(str(output)) +
                            ', [], false, false, "", ' + json.dumps(argv) + ');\n')
                    harness.write_text('import * as path from "node:path";\nimport * as child from "node:child_process";\n' + function + call)
                    env = os.environ.copy()
                    env['BATON_COMPILE_QUEUE_ROOT'] = str(state_root)
                    if mode == 'native':
                        env['BATON2_COMPILE_QUEUE_BIN'] = native
                    else:
                        env.pop('BATON2_COMPILE_QUEUE_BIN', None)
                        env['BATON2_COMPILE_QUEUE'] = native
                    result = subprocess.run([bun, 'run', str(harness)], cwd=root, env=env,
                                            capture_output=True, text=True, timeout=30)
                    self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                    self.assertEqual(output.read_text(), 'ts-native-queue-artifact\n')


if __name__ == '__main__':
    unittest.main()
