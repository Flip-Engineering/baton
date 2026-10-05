"""Composed integration of the checker API with the package validator.

This file calls the checker's real modes and the package's real functions. It
fails while an API is absent; it never skips and it stubs nothing. The unit
fixtures in package-gate-receipt.py own the reconciliation rules instead.
"""
import hashlib
import importlib.util
import json
import pathlib
import subprocess
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)
CHECKER = ROOT / 'bend2/scripts/laws-check.mjs'
NODE_ENV = {'PATH': '/usr/bin:/bin:/usr/sbin:/sbin', 'BEND_NO_TELEMETRY': '1'}


class CapacityControlsIntegration(unittest.TestCase):
    def checker(self, mode, stdin=None):
        completed = subprocess.run(['node', str(CHECKER), mode], cwd=ROOT, env=NODE_ENV,
                                   input=stdin, text=True, capture_output=True)
        return completed

    def test_the_checker_answers_the_discovery_api(self):
        completed = self.checker('--discover')
        self.assertEqual(completed.returncode, 0,
                         'the checker --discover mode is absent or failed: '
                         + completed.stderr.strip()[:200])
        controls = []
        for line in completed.stdout.splitlines():
            if line.strip():
                controls.append(json.loads(line))
        self.assertTrue(controls, 'the checker discovery returned no control')
        for control in controls:
            for field in PACKAGE.CONTROL_FIELDS:
                self.assertIn(field, control)
            self.assertIn(control['kind'], ('proof-removal', 'mutation'))

    def test_the_package_reads_the_checker_discovery(self):
        discovery = PACKAGE.discover_controls()
        self.assertTrue(discovery['controls'])
        self.assertEqual(len(discovery['controls']), len(discovery['by_id']))
        self.assertEqual(discovery['sha256'],
                         hashlib.sha256(PACKAGE.binding_bytes(discovery['controls'])).hexdigest())

    def test_a_duplicate_discovery_id_is_refused_before_any_map(self):
        original = PACKAGE.subprocess.check_output
        rows = [{'id': 'proof:duplicate', 'kind': 'proof-removal', 'law': 'duplicate',
                 'module': 'bend2/src/json/laws.bend',
                 'definition_sha256': hashlib.sha256(b'one').hexdigest()},
                {'id': 'proof:duplicate', 'kind': 'proof-removal', 'law': 'duplicate',
                 'module': 'bend2/src/json/laws.bend',
                 'definition_sha256': hashlib.sha256(b'two').hexdigest()}]
        PACKAGE.subprocess.check_output = lambda *args, **kwargs: '\n'.join(
            json.dumps(row) for row in rows) + '\n'
        try:
            with self.assertRaisesRegex(RuntimeError, 'duplicate control id'):
                PACKAGE.discover_controls()
        finally:
            PACKAGE.subprocess.check_output = original

    def test_the_checker_answers_or_refuses_the_classification_request(self):
        payload = {'case': {'id': 'proof:absent', 'kind': 'proof-removal', 'law': 'absent',
                            'module': 'bend2/src/json/laws.bend',
                            'definition_sha256': '0' * 64},
                   'outcome': {'state': 'exited', 'exit_code': 1, 'signal': None,
                               'spawn_error': None},
                   'streams': {'stdout': {'path': '/nonexistent/stdout', 'bytes': 0,
                                          'sha256': '0' * 64},
                               'stderr': {'path': '/nonexistent/stderr', 'bytes': 0,
                                          'sha256': '0' * 64}},
                   'baseline': {'outcome': {'state': 'exited', 'exit_code': 0, 'signal': None,
                                            'spawn_error': None},
                                'streams': {'stdout': {'path': '/nonexistent/bout', 'bytes': 0,
                                                       'sha256': '0' * 64},
                                            'stderr': {'path': '/nonexistent/berr', 'bytes': 0,
                                                       'sha256': '0' * 64}}},
                   'evidence_root': str(ROOT),
                   'source': {'head': '0' * 40, 'tree': '0' * 40, 'bend2_tree': '0' * 40},
                   'toolchain': {'compiler_sha256': '0' * 64}}
        completed = self.checker('--classify', json.dumps(payload))
        if completed.returncode == 0:
            verdict = json.loads(completed.stdout.strip())
            self.assertEqual(verdict['schema'], 'capacity-controls/classify-verdict@1')
            self.assertIn('match', verdict)
        else:
            self.assertEqual(completed.returncode, 2,
                             'the checker --classify mode is absent or failed: '
                             + completed.stderr.strip()[:200])
            self.assertEqual(completed.stdout, '')
            self.assertTrue(completed.stderr.startswith('classify: '),
                            'the checker refusal does not name its reason: '
                            + completed.stderr[:120])


if __name__ == '__main__':
    unittest.main()
