"""Regression for the check-install DSH helper guard (#1215).

A DSH launch resolves dsh-worker.mjs and dsh-baton-hooks.mjs beside the
receiver executable. An overlay receiver that carries a new binary over an
older libexec can lack either file; the installation check must refuse that
layout before activation.
"""
import importlib.util
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'baton_check_install', ROOT / 'bend2/scripts/check-install.py')
CHECK = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(CHECK)


class DshHelperGuard(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.prefix = pathlib.Path(self.temp.name)
        self.directory = self.prefix / 'libexec/baton2'
        self.directory.mkdir(parents=True)

    def stage(self, name):
        path = self.directory / name
        path.write_text('fixture DSH helper\n')
        return path

    def test_staged_dsh_helpers_are_accepted(self):
        self.stage('dsh-worker.mjs')
        self.stage('dsh-baton-hooks.mjs')
        CHECK.verify_dsh_helpers(self.prefix)

    def test_missing_worker_bridge_is_refused(self):
        self.stage('dsh-baton-hooks.mjs')
        with self.assertRaisesRegex(RuntimeError, 'lacks the DSH helper libexec/baton2/dsh-worker.mjs'):
            CHECK.verify_dsh_helpers(self.prefix)

    def test_missing_hooks_plugin_is_refused(self):
        self.stage('dsh-worker.mjs')
        with self.assertRaisesRegex(RuntimeError, 'lacks the DSH helper libexec/baton2/dsh-baton-hooks.mjs'):
            CHECK.verify_dsh_helpers(self.prefix)


if __name__ == '__main__':
    unittest.main()
