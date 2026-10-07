"""Qualify parallel gate receipt assembly for the hosted native gate.

Each CI gate job runs one exact-source gate on its own isolated runner and
records a receipt. Assembly accepts only the complete authentic set and
rejects omitted, duplicated, altered, or unfinished producer work, receipts
from another run, compiler identity mismatches, wrong producer jobs, and
incomplete run fields in hosted mode. The compiler is bound by bytes,
version, architecture, and C toolchain, never by its absolute install path.
No compiler, binary, or network is needed.
"""
import importlib.util
import json
import os
import pathlib
import platform
import tempfile
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)

LAWS_LOG = '\n'.join([
    '{"check": "entry compiles with every law proven", "passed": true}',
    '{"law": "example_law", "module": "bend2/src/coordinator/laws.bend",',
    ' "proof": "removed", "gate": "refuses", "passed": true}',
    'laws-check: green - 214 laws, 121 mutations, 336 compiles, 0 failures',
    '',
])
NATIVE_LOG = '\n'.join([
    'bend2/test/coordinator.py',
    'Ran 12 tests in 3.4s',
    'OK',
    '',
])
BUILD_LOG = 'baton2\n'

RUN_BINDING = {'workflow': 'bend2-native-development', 'run_id': '37579232858',
               'run_attempt': '1', 'sha': '70e53a2'}
GITHUB_KEYS = ('GITHUB_WORKFLOW', 'GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_JOB', 'GITHUB_SHA')


class Receipts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='parallel-gate-receipts-')
        self.home = pathlib.Path(self.temp.name)
        self.compiler = self.home / 'bend'
        self.compiler.write_bytes(b'fake-bend-2.0.25')
        self.initial = {'head': '70e53a2', 'tree': 'tree1', 'bend2_tree': 'bend2tree1',
                        'status': '', 'binary_sha256': None}
        self.previous_root = PACKAGE.ROOT
        PACKAGE.ROOT = self.home
        self.addCleanup(setattr, PACKAGE, 'ROOT', self.previous_root)
        self.previous_snapshot = PACKAGE.snapshot
        PACKAGE.snapshot = lambda: dict(self.initial,
                                        binary_sha256=PACKAGE.sha256(self.compiler))
        self.addCleanup(setattr, PACKAGE, 'snapshot', self.previous_snapshot)
        self.previous_bend_version = PACKAGE.bend_version
        PACKAGE.bend_version = lambda compiler: 'bend 2.0.25'
        self.addCleanup(setattr, PACKAGE, 'bend_version', self.previous_bend_version)
        self.previous_cc_version = PACKAGE.cc_version
        PACKAGE.cc_version = lambda cc: 'fake-cc 1.0'
        self.addCleanup(setattr, PACKAGE, 'cc_version', self.previous_cc_version)
        saved = {key: os.environ.pop(key) for key in GITHUB_KEYS if key in os.environ}
        self.addCleanup(os.environ.update, saved)

    def tearDown(self):
        self.temp.cleanup()

    def log_text(self, gate):
        return {'build-native': BUILD_LOG, 'laws-check': LAWS_LOG,
                'check-native': NATIVE_LOG}.get(gate, 'unknown\n')

    def gate_argv(self, gate):
        return list(dict(PACKAGE.GATES).get(gate, ['unknown']))

    def write_receipt(self, receipts, gate, producer=None, mutate=None):
        directory = receipts / gate
        if directory.exists():
            for path in sorted(directory.iterdir()):
                path.unlink()
        else:
            directory.mkdir(parents=True)
        (directory / (gate + '.log')).write_text(self.log_text(gate))
        binary_sha = generated_sha = None
        if gate == 'build-native':
            binary_sha = PACKAGE.sha256(self.compiler)
            generated_sha = PACKAGE.sha256(self.compiler)
        if producer is None:
            producer = dict(RUN_BINDING, job='gate-' + gate, runner=None)
        summary = {
            'gate': gate,
            'stage': {
                'name': gate,
                'argv': self.gate_argv(gate),
                'status': 'passed',
                'before': dict(self.initial),
                'log': gate + '.log',
                'exit_code': 0,
                'elapsed_seconds': 1.0,
                'after': dict(self.initial),
                'log_sha256': PACKAGE.sha256(directory / (gate + '.log')),
            },
            'before': dict(self.initial),
            'after': dict(self.initial),
            'environment': {'BEND': str(self.compiler), 'BEND_NO_TELEMETRY': '1',
                            'CC': 'clang'},
            'compiler_sha256': PACKAGE.sha256(self.compiler),
            'compiler_version': 'bend 2.0.25',
            'compiler_arch': platform.machine(),
            'cc_version': 'fake-cc 1.0',
            'runner_sha256': PACKAGE.sha256(pathlib.Path(PACKAGE.__file__)),
            'producer': producer,
            'binary_sha256': binary_sha,
            'generated_sha256': generated_sha,
        }
        if mutate:
            mutate(summary, directory)
        (directory / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
        return summary

    def refresh_log_sha(self, receipts, gate):
        path = receipts / gate / 'summary.json'
        summary = json.loads(path.read_text())
        summary['stage']['log_sha256'] = PACKAGE.sha256(receipts / gate / (gate + '.log'))
        path.write_text(json.dumps(summary, indent=2) + '\n')

    def complete_set(self, receipts):
        for gate in PACKAGE.GATE_NAMES:
            self.write_receipt(receipts, gate)

    def build_outputs(self):
        outputs = self.home / 'outputs'
        outputs.mkdir(exist_ok=True)
        (outputs / 'baton2').write_bytes(self.compiler.read_bytes())
        (outputs / 'baton2.c').write_bytes(self.compiler.read_bytes())
        return outputs

    def assemble(self, receipts):
        logs = self.home / 'logs'
        logs.mkdir(exist_ok=True)
        return PACKAGE.assemble_gate_receipts(receipts, self.build_outputs(),
                                             self.compiler, {'CC': 'clang'}, logs,
                                             dict(self.initial), {'before': True})

    def test_complete_authentic_set_assembles(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        _, summary = self.assemble(receipts)
        self.assertEqual([stage['name'] for stage in summary['stages']],
                         list(PACKAGE.GATE_NAMES))
        self.assertEqual(summary['validation']['laws'],
                         {'laws': 214, 'mutations': 121, 'compiles': 336})
        self.assertEqual(summary['validation']['native'],
                         {'python_tests': 12, 'python_suites': 1})
        self.assertEqual(set(summary['assembled_from']), set(PACKAGE.GATE_NAMES))
        self.assertEqual((self.home / '.scratch/bend2/baton2').read_bytes(),
                         self.compiler.read_bytes())

    def test_omitted_gate_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        for gate in ('build-native', 'laws-check'):
            self.write_receipt(receipts, gate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_duplicated_gate_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        extra = receipts / 'extra'
        extra.mkdir()
        (extra / 'laws-check.log').write_text(LAWS_LOG)
        laws = json.loads((receipts / 'laws-check/summary.json').read_text())
        laws['stage']['log_sha256'] = PACKAGE.sha256(extra / 'laws-check.log')
        (extra / 'summary.json').write_text(json.dumps(laws))
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_altered_log_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        with (receipts / 'laws-check/laws-check.log').open('a') as stream:
            stream.write('altered\n')
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_altered_source_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['stage']['after']['head'] = 'altered'

        self.write_receipt(receipts, 'laws-check', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_unfinished_gate_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['stage']['status'] = 'failed'
            summary['stage']['exit_code'] = 1

        self.write_receipt(receipts, 'check-native', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_unfinished_log_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        (receipts / 'laws-check/laws-check.log').write_text('{"passed": true}\n')
        self.refresh_log_sha(receipts, 'laws-check')
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_foreign_producer_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        foreign = dict(RUN_BINDING, run_id='999', job='gate-check-native')
        self.write_receipt(receipts, 'check-native', producer=foreign)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_altered_runner_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['runner_sha256'] = '0' * 64

        self.write_receipt(receipts, 'build-native', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_absolute_bend_path_ignored(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['environment']['BEND'] = '/elsewhere/toolchain-home/bin/bend'

        self.write_receipt(receipts, 'build-native', mutate=mutate)
        _, summary = self.assemble(receipts)
        self.assertEqual([stage['name'] for stage in summary['stages']],
                         list(PACKAGE.GATE_NAMES))

    def test_compiler_version_mismatch_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['compiler_version'] = 'bend 9.9.9'

        self.write_receipt(receipts, 'laws-check', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_cc_toolchain_mismatch_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['cc_version'] = 'other-cc 2.0'

        self.write_receipt(receipts, 'build-native', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_arch_mismatch_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)

        def mutate(summary, directory):
            summary['compiler_arch'] = 'other-arch'

        self.write_receipt(receipts, 'check-native', mutate=mutate)
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_wrong_producer_job_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        wrong = dict(RUN_BINDING, job='gate-laws-check', runner=None)
        self.write_receipt(receipts, 'build-native', producer=wrong)
        current = {'GITHUB_WORKFLOW': RUN_BINDING['workflow'],
                   'GITHUB_RUN_ID': RUN_BINDING['run_id'],
                   'GITHUB_RUN_ATTEMPT': RUN_BINDING['run_attempt'],
                   'GITHUB_JOB': 'darwin-arm64',
                   'GITHUB_SHA': RUN_BINDING['sha']}
        with mock.patch.dict(os.environ, current):
            with self.assertRaises(RuntimeError):
                self.assemble(receipts)

    def test_missing_run_fields_rejected_in_hosted_mode(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        for gate in PACKAGE.GATE_NAMES:
            path = receipts / gate / 'summary.json'
            summary = json.loads(path.read_text())
            producer = {key: value for key, value in summary['producer'].items()
                        if key != 'run_attempt'}
            self.write_receipt(receipts, gate, producer=producer)
        current = {'GITHUB_WORKFLOW': RUN_BINDING['workflow'],
                   'GITHUB_RUN_ID': RUN_BINDING['run_id'],
                   'GITHUB_RUN_ATTEMPT': RUN_BINDING['run_attempt'],
                   'GITHUB_JOB': 'darwin-arm64',
                   'GITHUB_SHA': RUN_BINDING['sha']}
        with mock.patch.dict(os.environ, current):
            with self.assertRaises(RuntimeError):
                self.assemble(receipts)

    def test_unknown_gate_rejected(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        self.write_receipt(receipts, 'extra')
        with self.assertRaises(RuntimeError):
            self.assemble(receipts)

    def test_runner_provenance_not_compared(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        for gate in PACKAGE.GATE_NAMES:
            path = receipts / gate / 'summary.json'
            summary = json.loads(path.read_text())
            producer = dict(summary['producer'], runner='runner-for-' + gate)
            self.write_receipt(receipts, gate, producer=producer)
        _, summary = self.assemble(receipts)
        self.assertEqual(len(summary['stages']), len(PACKAGE.GATE_NAMES))

    def test_run_binding_accepts_matching_run(self):
        receipts = self.home / 'receipts'
        receipts.mkdir()
        self.complete_set(receipts)
        current = {'GITHUB_WORKFLOW': RUN_BINDING['workflow'],
                   'GITHUB_RUN_ID': RUN_BINDING['run_id'],
                   'GITHUB_RUN_ATTEMPT': RUN_BINDING['run_attempt'],
                   'GITHUB_JOB': 'darwin-arm64',
                   'GITHUB_SHA': RUN_BINDING['sha']}
        with mock.patch.dict(os.environ, current):
            _, summary = self.assemble(receipts)
            self.assertEqual(PACKAGE.producer_run_binding(summary['producer']), RUN_BINDING)
        foreign = dict(current, GITHUB_RUN_ID='999')
        with mock.patch.dict(os.environ, foreign):
            with self.assertRaises(RuntimeError):
                self.assemble(receipts)


if __name__ == '__main__':
    unittest.main()
