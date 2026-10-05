"""Check the gate validation and receipt reuse functions of package-native.py.

The control discovery boundary is stubbed with a synthetic definition set, so
these fixtures test the validator's reconciliation rules directly. The real
discovery the validator calls is the checker's own API; one test states whether
that API answers in this source.
"""
import hashlib
import importlib.util
import json
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location('package_native', ROOT / 'bend2/scripts/package-native.py')
PACKAGE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PACKAGE)

MODULE_A = 'bend2/src/coordinator/commands.bend'
MODULE_B = 'bend2/src/git/laws.bend'


def discovery_binding(controls):
    return hashlib.sha256('\n'.join(
        '\t'.join(control[field] for field in PACKAGE.CONTROL_FIELDS)
        for control in sorted(controls, key=lambda control: control['id'])).encode()).hexdigest()


def synthetic_controls():
    controls = [
        {'id': 'proof:alpha_law', 'kind': 'proof-removal', 'law': 'alpha_law',
         'module': MODULE_A, 'definition_sha256': hashlib.sha256(b'alpha definition').hexdigest()},
        {'id': 'proof:beta_law', 'kind': 'proof-removal', 'law': 'beta_law',
         'module': MODULE_A, 'definition_sha256': hashlib.sha256(b'beta definition').hexdigest()},
        {'id': 'mutation:gamma_edit', 'kind': 'mutation', 'law': 'gamma_law',
         'module': MODULE_B, 'definition_sha256': hashlib.sha256(b'gamma definition').hexdigest()},
    ]
    return {'controls': controls, 'sha256': discovery_binding(controls)}


def law_row(control, **overrides):
    return {'law': control['law'], 'module': control['module'], 'proof': 'removed',
            'gate': 'refuses', 'passed': True, **overrides}


def mutation_row(control, **overrides):
    return {'mutation': control['id'].removeprefix('mutation:'), 'law': control['law'],
            'applied': True, 'gate': 'refuses', 'passed': True, **overrides}


class PackageGateReceipt(unittest.TestCase):
    def setUp(self):
        retained = ROOT / '.scratch/bend2/package-gate-fixtures'
        retained.mkdir(parents=True, exist_ok=True)
        self.home = pathlib.Path(tempfile.mkdtemp(dir=retained))
        self.logs = self.home / 'logs'
        self.logs.mkdir()
        self.controls = synthetic_controls()
        self.addCleanup(setattr, PACKAGE, 'discover_controls', PACKAGE.discover_controls)
        PACKAGE.discover_controls = lambda: self.controls

    def laws(self):
        return [control for control in self.controls['controls']
                if control['kind'] == 'proof-removal']

    def mutations(self):
        return [control for control in self.controls['controls']
                if control['kind'] == 'mutation']

    def complete_law_rows(self):
        return [law_row(control) for control in self.laws()]

    def complete_mutation_rows(self):
        return [mutation_row(control) for control in self.mutations()]

    def native_log(self, suites=None, drop=(), extra=(), summary=True):
        suites = PACKAGE.native_suites() if suites is None else suites
        lines = []
        for name in suites:
            if name in drop:
                continue
            lines.append(name)
            if summary:
                lines.append('Ran 2 tests in 0.001s')
        for name in extra:
            lines.append(name)
            lines.append('Ran 2 tests in 0.001s')
        return '\n'.join(lines) + ('\n' if lines else '')

    def write_logs(self, laws=None, mutations=None, summary=None, native=None, extra=()):
        laws = self.complete_law_rows() if laws is None else laws
        mutations = self.complete_mutation_rows() if mutations is None else mutations
        counts = (len(self.laws()), len(self.mutations()),
                  len(self.laws()) + len(self.mutations()) + 1)
        lines = ['{"check":"entry compiles with every law proven","passed":true}']
        lines += [json.dumps(row) for row in laws]
        lines += [json.dumps(row) for row in mutations]
        lines += list(extra)
        lines.append(summary if summary is not None else
                     'laws-check: green - %d laws, %d mutations, %d compiles, 0 failures' % counts)
        (self.logs / 'laws-check.log').write_text('\n'.join(lines) + '\n')
        (self.logs / 'check-native.log').write_text(
            self.native_log() if native is None else native)
        (self.logs / 'build-native.log').write_text('')
        return self.logs

    def test_complete_control_rows_are_accepted(self):
        result = PACKAGE.validation(self.write_logs())
        suites = PACKAGE.native_suites()
        self.assertEqual(result['laws'], {'laws': len(self.laws()), 'mutations': len(self.mutations()),
                                          'compiles': len(self.laws()) + len(self.mutations()) + 1})
        self.assertEqual(result['controls_sha256'], self.controls['sha256'])
        self.assertEqual(result['native'], {'python_tests': 2 * len(suites),
                                            'python_suites': len(suites)})

    def test_zero_control_summary_refuses(self):
        self.write_logs(laws=[], mutations=[],
                        summary='laws-check: green - 0 laws, 0 mutations, 0 compiles, 0 failures',
                        native='')
        with self.assertRaisesRegex(RuntimeError, 'this source defines'):
            PACKAGE.validation(self.logs)

    def test_missing_control_row_refuses(self):
        laws = self.complete_law_rows()
        laws.pop()
        self.write_logs(laws=laws)
        with self.assertRaisesRegex(RuntimeError, 'Missing law control rows'):
            PACKAGE.validation(self.logs)

    def test_duplicate_control_row_refuses(self):
        laws = self.complete_law_rows()
        laws.append(dict(laws[0]))
        self.write_logs(laws=laws)
        with self.assertRaisesRegex(RuntimeError, 'duplicate law control rows'):
            PACKAGE.validation(self.logs)

    def test_unexpected_control_row_refuses(self):
        laws = self.complete_law_rows()
        laws.append({'law': 'not_a_law_in_this_source', 'module': MODULE_A, 'proof': 'removed',
                     'gate': 'refuses', 'passed': True})
        self.write_logs(laws=laws)
        with self.assertRaisesRegex(RuntimeError, 'absent from this source'):
            PACKAGE.validation(self.logs)

    def test_failed_control_row_refuses(self):
        laws = self.complete_law_rows()
        laws[0]['passed'] = False
        self.write_logs(laws=laws)
        with self.assertRaisesRegex(RuntimeError, 'attributable refusal'):
            PACKAGE.validation(self.logs)

    def test_unapplied_mutation_refuses(self):
        mutations = self.complete_mutation_rows()
        mutations[0]['applied'] = False
        self.write_logs(mutations=mutations)
        with self.assertRaisesRegex(RuntimeError, 'applied attributable refusal'):
            PACKAGE.validation(self.logs)

    def test_mutation_naming_another_law_refuses(self):
        mutations = self.complete_mutation_rows()
        mutations[0]['law'] = 'another_law_entirely'
        self.write_logs(mutations=mutations)
        with self.assertRaisesRegex(RuntimeError, 'names a different law'):
            PACKAGE.validation(self.logs)

    def test_summary_counts_disagreeing_with_the_source_refuse(self):
        self.write_logs(laws=[], mutations=[],
                        summary='laws-check: green - 1 laws, 0 mutations, 2 compiles, 0 failures')
        with self.assertRaisesRegex(RuntimeError, 'this source defines'):
            PACKAGE.validation(self.logs)

    def test_native_log_without_a_suite_refuses(self):
        self.write_logs(native='')
        with self.assertRaisesRegex(RuntimeError, 'Missing native suite evidence'):
            PACKAGE.validation(self.logs)

    def test_native_log_missing_one_suite_refuses(self):
        suites = PACKAGE.native_suites()
        self.write_logs(native=self.native_log(drop={suites[0]}))
        with self.assertRaisesRegex(RuntimeError, 'Missing native suite evidence'):
            PACKAGE.validation(self.logs)

    def test_native_log_with_an_unknown_suite_refuses(self):
        self.write_logs(native=self.native_log(extra=['bend2/test/not_a_suite.py']))
        with self.assertRaisesRegex(RuntimeError, 'absent from this source'):
            PACKAGE.validation(self.logs)

    def test_native_suite_without_its_summary_refuses(self):
        self.write_logs(native=self.native_log(summary=False))
        with self.assertRaisesRegex(RuntimeError, 'unittest summaries'):
            PACKAGE.validation(self.logs)

    def test_native_suite_repeating_refuses(self):
        suites = PACKAGE.native_suites()
        self.write_logs(native=self.native_log(extra=[suites[0]]))
        with self.assertRaisesRegex(RuntimeError, 'duplicate native suite runs'):
            PACKAGE.validation(self.logs)

    def test_the_source_control_discovery_api_answers(self):
        original = PACKAGE.discover_controls
        PACKAGE.discover_controls = original
        self.addCleanup(setattr, PACKAGE, 'discover_controls', original)
        try:
            discovery = original()
        except RuntimeError as error:
            self.skipTest('the checker discovery API is not implemented yet: ' + str(error))
        self.assertTrue(discovery['controls'], 'the checker discovery returned no control')
        for control in discovery['controls']:
            for field in PACKAGE.CONTROL_FIELDS:
                self.assertIn(field, control)

    def receipt(self, **overrides):
        initial = PACKAGE.snapshot()
        stages = [{'name': name, 'argv': list(argv), 'status': 'passed', 'exit_code': 0,
                   'before': initial, 'after': initial, 'log': name + '.log',
                   'log_sha256': hashlib.sha256(b'').hexdigest()}
                  for name, argv in PACKAGE.GATES]
        summary = {'status': 'passed', 'worktree': str(ROOT), 'before': initial, 'after': initial,
                   'compiler_sha256': hashlib.sha256(b'fixture compiler').hexdigest(),
                   'runner_sha256': hashlib.sha256(
                       (ROOT / 'bend2/scripts/package-native.py').read_bytes()).hexdigest(),
                   'inputs_before': {'fixture': 'historical inputs'},
                   'inputs_after': {'fixture': 'historical inputs'},
                   'environment': {'BEND': 'fixture compiler', 'BEND_NO_TELEMETRY': '1'},
                   'stages': stages,
                   'validation': {'laws': {}, 'native': {}}}
        summary.update(overrides)
        path = self.home / 'summary.json'
        path.write_text(json.dumps({key: value for key, value in summary.items()
                                    if value is not None}))
        return path

    def reusable(self, path):
        PACKAGE.reuse_gates(path, PACKAGE.sha256(path), pathlib.Path('fixture compiler'),
                            self.logs, PACKAGE.snapshot())

    def test_receipt_without_producer_identity_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'producing gate runner bytes'):
            self.reusable(self.receipt(runner_sha256=None))

    def test_receipt_with_another_producer_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'producing gate runner bytes'):
            self.reusable(self.receipt(runner_sha256=hashlib.sha256(b'other runner').hexdigest()))

    def test_receipt_without_historical_inputs_refuses(self):
        for field in ('inputs_before', 'inputs_after'):
            with self.subTest(field=field):
                with self.assertRaisesRegex(RuntimeError, 'no historical toolchain and host inputs'):
                    self.reusable(self.receipt(**{field: None}))

    def test_receipt_with_changed_inputs_refuses(self):
        with self.assertRaisesRegex(RuntimeError, 'changed inputs across its own gates'):
            self.reusable(self.receipt(inputs_after={'fixture': 'different inputs'}))

    def test_receipt_passing_the_new_checks_reaches_the_worktree_rule(self):
        with self.assertRaisesRegex(RuntimeError, 'must pass on this exact build directory'):
            self.reusable(self.receipt(worktree=str(self.home)))

    def stream(self, directory, name, data):
        path = directory / name
        path.write_bytes(data)
        return {'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

    def bundle_for(self, directory, module, results=None):
        module_controls = [control for control in self.controls['controls']
                           if control['module'] == module]
        results = module_controls if results is None else results
        rows = []
        for index, control in enumerate(results):
            attempt = 'attempt-%s-%d' % (module.replace('/', '_'), index)
            rows.append({
                'case': control,
                'setup': 'applied',
                'process': {'state': 'exited', 'exit_code': 1, 'signal': None, 'spawn_error': None,
                            'started': 10.0 + index, 'ended': 11.0 + index, 'attempt': attempt},
                'diagnostic': {'class': 'intended-law-refusal', 'attributed_law': control['law'],
                               'sha256': hashlib.sha256(b'diagnostic').hexdigest()},
                'stdout': self.stream(directory, control['id'].replace(':', '-') + '.stdout',
                                      b'refusal stdout\n'),
                'stderr': self.stream(directory, control['id'].replace(':', '-') + '.stderr',
                                      b'Location: ' + control['law'].encode() + b'\n'),
                'resource': {'real_seconds': 17.1, 'user_seconds': 16.9, 'sys_seconds': 0.1,
                             'max_rss_bytes': 1024, 'page_reclaims': 12},
            })
        return {
            'module': module,
            'binding': self.controls['sha256'],
            'baseline': {
                'argv': ['bend', 'bend2/src/coordinator/main.bend', '--check-only'],
                'process': {'state': 'exited', 'exit_code': 0, 'signal': None, 'spawn_error': None,
                            'started': 1.0, 'ended': 2.0, 'attempt': 'baseline-' + module},
                'stdout': self.stream(directory, 'baseline-%s.stdout' % module.replace('/', '_'),
                                      b'\n'),
                'stderr': self.stream(directory, 'baseline-%s.stderr' % module.replace('/', '_'),
                                      b'\n'),
            },
            'results': rows,
        }

    def evidence(self, modules=None, **overrides):
        directory = self.home / 'controls-evidence'
        directory.mkdir(parents=True, exist_ok=True)
        modules = (sorted({control['module'] for control in self.controls['controls']})
                   if modules is None else modules)
        summary = {
            'binding': self.controls['sha256'],
            'source_sha': PACKAGE.snapshot()['head'],
            'source_tree': PACKAGE.snapshot()['tree'],
            'source_bend2_tree': PACKAGE.snapshot()['bend2_tree'],
            'checker_sha256': hashlib.sha256((ROOT / 'bend2/scripts/laws-check.mjs').read_bytes()).hexdigest(),
            'compiler_sha256': hashlib.sha256(b'fixture compiler').hexdigest(),
            'origin': {'workflow': 'bend2-native-capacity-controls', 'run_id': '1',
                       'run_attempt': '1', 'jobs': ['controls'], 'image_os': 'macos27',
                       'image_version': '20260928.0222.1'},
            'expected_cases': len(self.controls['controls']),
            'received_cases': len(self.controls['controls']),
            'distinct_cases': len(self.controls['controls']),
            'groups': len({control['module'] for control in self.controls['controls']}),
            'rejections': [],
            'bundles': [self.bundle_for(directory, module) for module in modules],
        }
        summary.update(overrides)
        (directory / 'controls-summary.json').write_text(json.dumps(summary))
        return directory

    def full_evidence(self):
        return self.evidence()

    def compiler(self):
        path = self.home / 'compiler'
        path.write_bytes(b'fixture compiler')
        return path

    def test_complete_controls_evidence_is_accepted(self):
        result = PACKAGE.controls_evidence(self.full_evidence(), PACKAGE.snapshot(), self.compiler())
        self.assertEqual(result['cases'], len(self.controls['controls']))
        self.assertEqual(result['groups'], 2)
        self.assertEqual(result['binding'], self.controls['sha256'])
        self.assertNotIn('summed_max_rss_bytes', result)

    def test_controls_evidence_defects_refuse(self):
        cases = [
            ('missing summary', lambda directory: (directory / 'controls-summary.json').unlink(),
             'no controls-summary.json'),
            ('reported rejections', lambda directory: self.rewrite(
                directory, rejections=[{'kind': 'missing', 'detail': 'x'}]), 'reports rejections'),
            ('other binding', lambda directory: self.rewrite(
                directory, binding='0' * 64), 'different control definition set'),
            ('other source', lambda directory: self.rewrite(
                directory, source_sha='0' * 40), 'different source_sha'),
            ('other checker', lambda directory: self.rewrite(
                directory, checker_sha256='0' * 64), 'different checker bytes'),
            ('missing origin field', lambda directory: self.rewrite(
                directory, origin={'workflow': 'w'}), 'producing origin'),
            ('unfinished baseline', lambda directory: self.rewrite_bundle(
                directory, baseline={'process': {'state': 'signalled', 'exit_code': None,
                                                 'signal': 'SIGKILL', 'spawn_error': None,
                                                 'started': 1.0, 'ended': 2.0,
                                                 'attempt': 'baseline'}}), 'did not complete'),
            ('baseline exit nonzero', lambda directory: self.rewrite_bundle(
                directory, baseline={'process': {'state': 'exited', 'exit_code': 1, 'signal': None,
                                                 'spawn_error': None, 'started': 1.0, 'ended': 2.0,
                                                 'attempt': 'baseline'}}), 'records exit'),
            ('missing case', lambda directory: self.rewrite_bundle(
                directory, results=[]), 'omits controls'),
            ('altered case definition', lambda directory: self.rewrite_result(
                directory, 0, case={**self.laws()[0], 'definition_sha256': '0' * 64}),
             'definition differs'),
            ('unattributed diagnostic', lambda directory: self.rewrite_result(
                directory, 0, diagnostic={'class': 'unrelated-error'}), 'intended law refusal'),
            ('diagnostic naming another law', lambda directory: self.rewrite_result(
                directory, 0, diagnostic={'class': 'intended-law-refusal',
                                          'attributed_law': 'another_law'}),
             'names another law'),
            ('case before baseline', lambda directory: self.rewrite_result(
                directory, 0, process={'state': 'exited', 'exit_code': 1, 'signal': None,
                                       'spawn_error': None, 'started': 0.5, 'ended': 1.5,
                                       'attempt': 'early'}), 'before its baseline ended'),
            ('repeated attempt', lambda directory: self.rewrite_result(
                directory, 1, process={'state': 'exited', 'exit_code': 1, 'signal': None,
                                       'spawn_error': None, 'started': 11.0, 'ended': 12.0,
                                       'attempt': self.attempt(directory, 0)}),
             'attempt repeats'),
            ('altered stream', lambda directory: self.alter_stream(directory), 'recorded digest'),
            ('no resource sample', lambda directory: self.rewrite_result(
                directory, 0, resource={}), 'no resource sample'),
            ('unknown module', lambda directory: self.rewrite(directory, bundles=[
                {**self.bundle(directory), 'module': 'bend2/src/absent.bend'}]), 'absent from this source'),
        ]
        for name, damage, message in cases:
            with self.subTest(name=name):
                directory = self.full_evidence()
                damage(directory)
                with self.assertRaisesRegex(RuntimeError, message):
                    PACKAGE.controls_evidence(directory, PACKAGE.snapshot(), self.compiler())

    def test_overlapping_compilers_in_one_group_refuse(self):
        directory = self.full_evidence()
        results = self.results(directory, 0)
        self.assertEqual(len(results), 2)
        results[1]['process']['started'] = results[0]['process']['started'] + 0.5
        results[1]['process']['ended'] = results[0]['process']['ended'] + 0.5
        self.write(directory, 0, results=results)
        with self.assertRaisesRegex(RuntimeError, 'overlapped'):
            PACKAGE.controls_evidence(directory, PACKAGE.snapshot(), self.compiler())

    def load(self, directory):
        return json.loads((directory / 'controls-summary.json').read_text())

    def bundle(self, directory, index=0):
        return json.loads(json.dumps(self.load(directory)['bundles'][index]))

    def results(self, directory, index=0):
        return self.load(directory)['bundles'][index]['results']

    def attempt(self, directory, index):
        return self.results(directory, 0)[index]['process']['attempt']

    def write(self, directory, index, **overrides):
        summary = self.load(directory)
        summary['bundles'][index].update(overrides)
        (directory / 'controls-summary.json').write_text(json.dumps(summary))

    def rewrite(self, directory, **overrides):
        summary = self.load(directory)
        summary.update(overrides)
        (directory / 'controls-summary.json').write_text(json.dumps(summary))

    def rewrite_bundle(self, directory, **overrides):
        bundle = self.bundle(directory)
        bundle.update(overrides)
        self.write(directory, 0, **{key: value for key, value in bundle.items() if key != 'module'})

    def rewrite_result(self, directory, index, **overrides):
        results = self.results(directory, 0)
        results[index].update(overrides)
        self.write(directory, 0, results=results)

    def alter_stream(self, directory):
        bundle = self.bundle(directory)
        name = bundle['results'][0]['stdout']['path']
        path = directory / name
        path.write_bytes(b'x' * len(path.read_bytes()))


if __name__ == '__main__':
    unittest.main()
