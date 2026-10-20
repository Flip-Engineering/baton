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


if __name__ == '__main__':
    unittest.main()
