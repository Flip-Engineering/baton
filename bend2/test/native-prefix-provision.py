"""Check native-suite role inputs, isolated prefixes and platform REPL selection."""
import argparse
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[2]


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


REPL = load('test_prefix_repl', ROOT / '.github/scripts/repl-package.py')
PARALLEL = load('test_prefix_parallel', ROOT / 'bend2/scripts/check-native-parallel.py')


class NativePrefixProvision(unittest.TestCase):
    def runtime(self, system, machine, member):
        temporary = tempfile.TemporaryDirectory(prefix='native-prefix-runtime-')
        self.addCleanup(temporary.cleanup)
        output = Path(temporary.name) / 'runtime'
        downloads = []

        def download(pin, destination):
            downloads.append(pin)
            if destination.suffix == '.zip':
                with zipfile.ZipFile(destination, 'w') as archive:
                    archive.writestr(member, b'platform runtime fixture')
            else:
                destination.write_text('runtime notices fixture')

        with patch.object(REPL.platform, 'system', return_value=system), \
                patch.object(REPL.platform, 'machine', return_value=machine), \
                patch.object(REPL, 'download', side_effect=download):
            REPL.runtime_inputs(argparse.Namespace(output=output))
        self.assertEqual((output / 'bun').read_bytes(), b'platform runtime fixture')
        self.assertEqual((output / 'bun').stat().st_mode & 0o777, 0o755)
        self.assertEqual((output / 'Bun-NOTICES').read_text(), 'runtime notices fixture')
        return json.loads((output / 'runtime.json').read_text()), downloads

    def test_linux_x64_selects_the_pinned_linux_release(self):
        runtime, downloads = self.runtime('Linux', 'x86_64', 'bun-linux-x64/bun')
        self.assertEqual(runtime['platform'], 'linux-x64')
        self.assertEqual(downloads[0]['url'],
                         'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-linux-x64.zip')
        self.assertEqual(downloads[0]['sha256'],
                         '951ee2aee855f08595aeec6225226a298d3fea83a3dcd6465c09cbccdf7e848f')

    def test_darwin_arm64_preserves_its_pinned_release(self):
        runtime, downloads = self.runtime('Darwin', 'arm64', 'bun-darwin-aarch64/bun')
        self.assertEqual(runtime['platform'], 'darwin-arm64')
        self.assertEqual(downloads[0]['url'],
                         'https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-darwin-aarch64.zip')
        self.assertEqual(downloads[0]['sha256'],
                         'd8b96221828ad6f97ac7ac0ab7e95872341af763001e8803e8267652c2652620')

    def test_router_relink_keeps_the_original_compile_and_link_inputs(self):
        prepare = load('test_prefix_prepare', ROOT / 'bend2/scripts/prepare-native-test-prefix.py')
        producer = {'compile_flags': ['-O1', '-pthread', '-I/source with spaces',
                                      '-Dmain=baton2_runtime_main'],
                    'link_flags': ['-O1', '-pthread', '-I/source with spaces',
                                   '/source with spaces/native-entry.c', '-lsqlite3', '-lm'],
                    'source': {'path': '/producer/generated.c'},
                    'compiler': {'path': '/selected/clang', 'ccache': '/selected/cache'}}
        command = prepare.relink_command(producer, Path('/owned/output'))
        self.assertEqual(command[command.index('--cc') + 1], '/selected/clang')
        self.assertEqual(command[command.index('--ccache') + 1], '/selected/cache')
        self.assertIn('--cflag=-I/source with spaces', command)
        import shlex
        extra = shlex.split(next(value.split('=', 1)[1]
                                 for value in command if value.startswith('--link-flags=')))
        self.assertEqual(extra, ['/source with spaces/native-entry.c', '-lsqlite3', '-lm',
                                 '-DBATON2_NATIVE_RECEIVER_ROUTER'])

    def test_suite_prefixes_belong_to_the_selected_worker_copy(self):
        for source in [Path('/owned/worker-a/source'), Path('/owned/worker-b/source')]:
            expected = source / '.scratch/bend2/production-prefix'
            environment = PARALLEL.production_environment(source)
            self.assertEqual(environment['BATON2_NATIVE_DELIVERY_PREFIX'], str(expected))
            self.assertEqual(environment['BATON2_CODEX_BACKEND_PREFIX'], str(expected))
            self.assertEqual(environment['BATON2_CODEX_FOCUSED_BINARY'], str(expected / 'bin/baton'))


if __name__ == '__main__':
    unittest.main()
