import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
ADAPTER_PATH = ROOT / '.github/scripts/queue-native-checks.py'
SPEC = importlib.util.spec_from_file_location('queue_native_darwin_adapter', ADAPTER_PATH)
ADAPTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ADAPTER)


class DarwinToolchainSelectionTests(unittest.TestCase):
    def run_with_compiler(self, compiler_name, environment):
        temporary = tempfile.TemporaryDirectory(prefix='queue-darwin-selection-')
        self.addCleanup(temporary.cleanup)
        root = Path(temporary.name)
        run = root / 'run'
        run.mkdir()
        state = root / 'state'
        state.mkdir()
        config = run / 'queue-config.json'
        config.write_text(json.dumps({'run': str(run), 'state': str(state),
                                      'client': '/queue/client'}))
        source = root / 'input.c'
        source.write_text('int main(void) { return 0; }\n')
        compiler = root / compiler_name
        compiler.write_text('fake compiler')
        compiler.chmod(0o755)
        variables = {'BATON2_NATIVE_QUEUE': str(config), **environment}
        captured = {}

        def submit(_config, _directory, options, command, _key_only=False):
            captured.update(options=options, command=command)
            return 0

        command = ([str(compiler), '-o', 'output', str(source)] if compiler_name == 'linux-cc'
                   else ['python3', 'tools/cgen-clang-parallel/build_and_measure.py',
                         '--cc', str(compiler), '-o', 'output', str(source)])
        with mock.patch.dict(os.environ, variables, clear=True), \
                mock.patch.object(ADAPTER.shutil, 'which', return_value=str(compiler)), \
                mock.patch.object(ADAPTER.subprocess, 'check_output', return_value='fake cc 1'), \
                mock.patch.object(ADAPTER, 'submit', side_effect=submit):
            self.assertEqual(ADAPTER.compiler('cc', command, key_only=True), 0)
        return captured

    def test_linux_compiler_ignores_inherited_complete_darwin_environment(self):
        captured = self.run_with_compiler('linux-cc', {
            'BATON2_DARWIN_LLVM_ROOT': '/opt/darwin/llvm',
            'BATON2_DARWIN_SDKROOT': '/opt/darwin/sdk',
            'BATON2_DARWIN_SDK_MANIFEST_SHA256': 'a' * 64,
            'BATON2_DARWIN_SDK_TREE_SHA256': 'b' * 64,
        })
        options = captured['options']
        self.assertEqual(options[options.index('--compiler') + 1].rsplit('/', 1)[-1], 'linux-cc')
        self.assertNotIn('target=arm64-apple-macosx11.0', options)
        self.assertNotIn('sdk_manifest_sha256=', '\n'.join(options))

    def test_darwin_wrapper_requires_sdk_metadata_before_queue_submission(self):
        with self.assertRaisesRegex(SystemExit, 'Darwin cross-compiler requires .*SDK_MANIFEST_SHA256'):
            self.run_with_compiler('darwin-arm64-clang.sh', {
                'BATON2_DARWIN_LLVM_ROOT': '/opt/darwin/llvm',
                'BATON2_DARWIN_SDKROOT': '/opt/darwin/sdk',
            })

    def test_darwin_wrapper_records_sdk_identity(self):
        captured = self.run_with_compiler('darwin-arm64-clang.sh', {
            'BATON2_DARWIN_LLVM_ROOT': '/opt/darwin/llvm',
            'BATON2_DARWIN_SDKROOT': '/opt/darwin/sdk',
            'BATON2_DARWIN_SDK_MANIFEST_SHA256': 'a' * 64,
            'BATON2_DARWIN_SDK_TREE_SHA256': 'b' * 64,
        })
        options = captured['options']
        self.assertEqual(options[options.index('--compiler') + 1],
                         '/opt/darwin/llvm/bin/clang')
        self.assertIn('target=arm64-apple-macosx11.0', options)
        self.assertIn('sdk_manifest_sha256=' + 'a' * 64, options)
        self.assertIn('sdk_tree_sha256=' + 'b' * 64, options)


if __name__ == '__main__':
    unittest.main()
