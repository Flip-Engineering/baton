"""Regression for the check-install dispatch runtime guard (#947).

The guard validates the packaged runtime layout listed in
docs/bend2/installation.md: task-start.mjs plus either bin/node or
libexec/baton2/repl/bun. A package with no runtime must be refused.
"""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'baton_check_install', ROOT / 'bend2/scripts/check-install.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class DispatchRuntimeGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.prefix = pathlib.Path(self.temp.name)
        self.helper = self.prefix / 'libexec/baton2/task-start.mjs'
        self.helper.parent.mkdir(parents=True)
        self.helper.write_text('fixture dispatch operation\n')

    def runtime(self, relative):
        path = self.prefix / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text('#!/bin/sh\nexit 0\n')
        path.chmod(0o755)
        return path

    def test_missing_dispatch_operation_is_refused(self):
        self.helper.unlink()
        with self.assertRaisesRegex(RuntimeError, 'lacks the dispatch operation'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_missing_runtime_is_refused(self):
        with self.assertRaisesRegex(RuntimeError, 'no Node or bundled Bun runtime'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_packaged_bin_node_is_accepted(self):
        self.runtime('bin/node')
        CHECK.verify_dispatch_runtime(self.prefix)

    def test_packaged_repl_bun_is_accepted(self):
        self.runtime('libexec/baton2/repl/bun')
        CHECK.verify_dispatch_runtime(self.prefix)

    def test_non_executable_runtime_is_refused(self):
        path = self.prefix / 'bin/node'
        path.parent.mkdir(parents=True)
        path.write_text('not executable\n')
        with self.assertRaisesRegex(RuntimeError, 'no Node or bundled Bun runtime'):
            CHECK.verify_dispatch_runtime(self.prefix)

    def test_package_check_can_skip_compiler_probe_and_keeps_required_runtime(self):
        manifest = self.prefix / 'manifest.json'
        manifest.write_text(json.dumps({'required_system_dependencies': []}) + '\n')
        (self.prefix / 'install-receipt.json').write_text('{}\n')
        (self.prefix / 'SHA256SUMS').write_text('')
        output = self.prefix / 'result'
        output.mkdir()
        dependency = {'path': 'libexec/baton2/repl', 'sha256': 'a' * 64}
        calls = []

        def run(argv, **kwargs):
            calls.append(list(map(str, argv)))
            stdout = '1.3.14\n' if argv[-1] == '--version' else ''
            return CHECK.subprocess.CompletedProcess(argv, 0, stdout=stdout, stderr='')

        with mock.patch.object(CHECK, 'verify_checksums', return_value={}), \
                mock.patch.object(CHECK, 'verify_payload_checksums'), \
                mock.patch.object(CHECK, 'verify_binaries', return_value=[]), \
                mock.patch.object(CHECK, 'verify_repl', return_value=dependency), \
                mock.patch.object(CHECK, 'verify_dispatch_runtime'), \
                mock.patch.object(CHECK, 'system_dependencies', return_value=[]), \
                mock.patch.object(CHECK.platform, 'system', return_value='Darwin'), \
                mock.patch.object(CHECK.subprocess, 'run', side_effect=run):
            result = CHECK.check(self.prefix, output, probe_native_compiler=False)

        self.assertEqual(result['native_compiler_probe'], 'not-run')
        self.assertEqual(result['runtime_version'], '1.3.14')
        self.assertEqual([pathlib.Path(argv[0]).name for argv in calls],
                         ['baton', 'baton-full', 'bun'])
        self.assertFalse((output / 'sqlite-probe.c').exists())


if __name__ == '__main__':
    unittest.main()
