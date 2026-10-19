"""Regression for the check-install dispatch runtime guard (#947).

The guard validates the packaged runtime layout listed in
docs/bend2/installation.md: task-start.mjs plus either bin/node or
libexec/baton2/repl/bun. A package with no runtime must be refused.
"""
import importlib.util
import os
import pathlib
import tempfile
import unittest


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


if __name__ == '__main__':
    unittest.main()
