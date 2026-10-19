"""Focused tests for the keeper service PATH construction (#893)."""
import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'bend2/scripts/service-environment.py'


def load_module():
    spec = importlib.util.spec_from_file_location('service_environment', SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ServiceEnvironment(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.existing = os.pathsep.join(['/usr/local/bin', '/usr/bin', '/bin'])

    def test_required_directories_are_added_and_existing_ones_preserved(self):
        constructed = self.module.construct_path(
            self.existing, ['/opt/baton/bin', '/opt/node/bin', '/opt/clients'])
        entries = constructed.split(os.pathsep)
        self.assertEqual(entries[:3],
                         ['/opt/baton/bin', '/opt/node/bin', '/opt/clients'])
        self.assertEqual(entries[3:], ['/usr/local/bin', '/usr/bin', '/bin'])

    def test_no_existing_directory_is_removed_or_reordered(self):
        existing = os.pathsep.join(['/a', '/b', '/c', '/d'])
        constructed = self.module.construct_path(existing, ['/required'])
        self.assertEqual(constructed.split(os.pathsep)[1:],
                         ['/a', '/b', '/c', '/d'])

    def test_construction_is_idempotent_and_deduplicates(self):
        required = ['/opt/node/bin', '/usr/bin']
        once = self.module.construct_path(self.existing, required)
        twice = self.module.construct_path(once, required)
        self.assertEqual(once, twice)
        self.assertEqual(once.split(os.pathsep).count('/usr/bin'), 1)

    def test_drop_in_carries_the_constructed_path(self):
        constructed = self.module.construct_path(self.existing, ['/opt/node/bin'])
        text = self.module.drop_in(constructed)
        self.assertEqual(text, '[Service]\nEnvironment=PATH=' + constructed + '\n')

    def test_cli_checks_required_directories_and_prints_drop_in(self):
        with tempfile.TemporaryDirectory() as directory:
            node_bin = pathlib.Path(directory) / 'node-bin'
            node_bin.mkdir()
            result = subprocess.run(
                [sys.executable, str(SCRIPT), '--existing', self.existing,
                 '--require', str(node_bin), '--check', '--drop-in'],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn(str(node_bin), result.stdout)
            self.assertIn('/usr/local/bin', result.stdout)
            refused = subprocess.run(
                [sys.executable, str(SCRIPT), '--existing', self.existing,
                 '--require', str(node_bin / 'absent'), '--check'],
                capture_output=True, text=True)
            self.assertEqual(refused.returncode, 1)
            self.assertIn('absent', refused.stderr)


if __name__ == '__main__':
    unittest.main()
