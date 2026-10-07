"""Check the #683 models read and provider probe over controlled harness fixtures.

The provider reads run against small executables the test writes, so the read is
checked against a stated catalog, a failing read and an unparseable read without
contacting a real provider. The registry and HOME are controlled by the test, so
the alias and unknown-registry answers are deterministic.
"""
import json
import os
import pathlib
import sqlite3
import stat
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


class Models(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.home = self.directory / 'home'
        self.home.mkdir()
        self.db = self.directory / 'state.db'
        self.env = {'HOME': str(self.home), 'PATH': os.environ.get('PATH', '/usr/bin:/bin'),
                    'TMPDIR': os.environ.get('TMPDIR', '/tmp')}
        self.registry = self.directory / 'series.json'
        self.write_registry({'deepseek/deepseek-flash': 'deepseek'},
                            {'deepseek': self.series_directory('deepseek', 'DeepSeek')})
        self.env['BATON2_GIT_REGISTRY'] = str(self.registry)
        # A coordinator database is created by the coordinator's own commands; the
        # read selects from it and starts no process and no transaction of its own.
        initialized = self.call('players')
        self.assertEqual(initialized.returncode, 0, initialized.stderr)

    def write_registry(self, models, series):
        self.registry.write_text(json.dumps({'models': models, 'series': series}))

    def series_directory(self, key, display):
        directory = self.directory / f'series-{key}'
        directory.mkdir(exist_ok=True)
        (directory / 'identity-series.json').write_text(
            json.dumps({'seriesKey': key, 'displaySeries': display}))
        return str(directory)

    def harness(self, name, body):
        path = self.directory / name
        path.write_text('#!/bin/sh\n' + body)
        path.chmod(path.stat().st_mode | stat.S_IXUSR)
        return str(path)

    # The Codex probe runs two reads in one action: the catalog and the access
    # report. This fixture answers each by its own subcommand.
    def codex_harness(self, name, catalog, doctor):
        return self.harness(name,
                            'case "$1" in\n'
                            '  doctor) cat <<\'DOC\'\n' + doctor + '\nDOC\n  ;;\n'
                            '  debug) cat <<\'CAT\'\n' + catalog + '\nCAT\n  ;;\n'
                            'esac\n')

    def call(self, *args, env=None):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)],
                              text=True, capture_output=True, env=env or self.env)

    def read(self, *args):
        result = self.call('models', *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def probe(self, *args):
        result = self.call('provider-probe', *args)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def refused(self, *args):
        result = self.call(*args)
        self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
        self.assertEqual(result.stdout, '')
        return json.loads(result.stderr)

    def session(self, session, harness, model, effort='high', native=''):
        connection = sqlite3.connect(self.db)
        connection.execute(
            'INSERT OR REPLACE INTO sessions(id,parent,harness,model,effort,native)'
            ' VALUES(?,?,?,?,?,?)', (session, None, harness, model, effort, native))
        connection.commit()
        connection.close()

    def message(self, identity, recipient):
        connection = sqlite3.connect(self.db)
        connection.execute('INSERT OR REPLACE INTO messages(id,sender,recipient,kind,body)'
                           ' VALUES(?,?,?,?,?)', (identity, 'sender', recipient, 'task', 'body'))
        connection.commit()
        connection.close()

    def provider(self, document, harness):
        return next(entry for entry in document['providers'] if entry['harness'] == harness)

    def test_empty_read_separates_alias_observation_and_unknown_capacity(self):
        document = self.read()
        self.assertEqual(document['schema'], 'baton2-models-v1')
        self.assertEqual(document['registry']['state'], 'known')
        self.assertEqual([alias['model'] for alias in document['aliases']],
                         ['deepseek/deepseek-flash'])
        self.assertEqual(document['aliases'][0]['series'], 'deepseek')
        self.assertEqual(document['aliases'][0]['display'], 'DeepSeek')
        self.assertEqual(document['aliases'][0]['provenance'], 'recorded-configuration')
        self.assertEqual(document['observed'], [])
        self.assertEqual(document['providers'], [])
        self.assertIsNone(document['continuation'])
        self.assertEqual(len(document['limits']), 6)

    def test_missing_registry_reports_unknown_not_empty(self):
        env = dict(self.env)
        env.pop('BATON2_GIT_REGISTRY')
        document = json.loads(self.call('models', env=env).stdout)
        self.assertEqual(document['registry']['state'], 'absent')
        self.assertIsNone(document['aliases'])
        self.assertIn('not empty', document['registry']['cause'])

    def test_probe_records_the_provider_catalog_and_leaves_capacity_unknown(self):
        catalog = self.harness('catalog', 'echo \'{"models":[{"slug":"gpt-6-sol"},{"slug":"gpt-6-luna"}]}\'\n')
        recorded = self.probe('codex', catalog)
        self.assertEqual(recorded['outcome'], 'ok')
        self.assertEqual(recorded['metadata']['models'], ['gpt-6-sol', 'gpt-6-luna'])
        self.assertIsNone(recorded['capacity']['limit'])
        self.assertIsNone(recorded['capacity']['resetAt'])
        self.assertEqual(recorded['capacity']['absent'],
                         ['limit', 'used', 'remaining', 'resetAt'])
        document = self.read()
        codex = self.provider(document, 'codex')
        self.assertEqual(codex['metadata']['state'], 'known')
        self.assertEqual(codex['metadata']['models'], ['gpt-6-sol', 'gpt-6-luna'])
        self.assertEqual(codex['capacity']['state'], 'unknown')
        self.assertEqual(codex['probe']['outcome'], 'ok')
        self.assertEqual(codex['probe']['reportedBytes'],
                         len('{"models":[{"slug":"gpt-6-sol"},{"slug":"gpt-6-luna"}]}'))
        self.assertIsNone(codex['probe']['cause'])

    def test_unobserved_harness_answers_unknown_not_an_empty_catalog(self):
        self.session('seat', 'omp', 'deepseek/deepseek-flash')
        omp = self.provider(self.read(), 'omp')
        self.assertEqual(omp['metadata']['state'], 'unknown')
        self.assertIsNone(omp['metadata']['models'])
        self.assertIsNone(omp['probe'])
        self.assertEqual(omp['capacity']['state'], 'unknown')
        self.assertEqual(omp['seats'], 1)

    def test_failed_probe_records_the_cause_and_no_catalog(self):
        failing = self.harness('failing', 'exit 1\n')
        recorded = self.probe('omp', failing)
        self.assertEqual(recorded['outcome'], 'error')
        self.assertIn('status 1', recorded['cause'])
        omp = self.provider(self.read(), 'omp')
        self.assertEqual(omp['metadata']['state'], 'error')
        self.assertIsNone(omp['metadata']['models'])
        self.assertEqual(omp['metadata']['cause'], recorded['cause'])

    def test_unparseable_probe_is_an_error_not_an_empty_catalog(self):
        empty = self.harness('empty', 'echo \'{"models":[]}\'\n')
        recorded = self.probe('omp', empty)
        self.assertEqual(recorded['outcome'], 'error')
        self.assertEqual(recorded['cause'], 'the provider output stated no model catalog')
        omp = self.provider(self.read(), 'omp')
        self.assertEqual(omp['metadata']['state'], 'error')
        self.assertIsNone(omp['metadata']['models'])
        self.assertNotEqual(omp['metadata']['models'], [])

    def test_adapter_without_a_read_is_recorded_refused(self):
        recorded = self.probe('claude-code', '/bin/echo')
        self.assertEqual(recorded['outcome'], 'refused')
        self.assertEqual(recorded['metadata']['models'], None)
        claude = self.provider(self.read(), 'claude-code')
        self.assertEqual(claude['metadata']['state'], 'error')
        self.assertEqual(claude['probe']['outcome'], 'refused')
        self.assertIn('no non-interactive metadata read', claude['probe']['cause'])

    def test_probe_refusals_name_their_condition(self):
        self.assertEqual(self.refused('provider-probe', 'gemini', '/bin/echo')['error'],
                         'probe-harness-unsupported')
        self.assertEqual(self.refused('provider-probe', 'muse', '/bin/echo')['error'],
                         'probe-model-required')
        self.assertEqual(self.refused('provider-probe', 'omp', '/no/such/binary')['error'],
                         'probe-command-unresolved')
        self.assertEqual(self.refused('models', 'absent-seat')['error'],
                         'session-not-registered')

    def test_later_probe_is_the_one_reported(self):
        first = self.harness('first', 'echo \'{"models":[{"id":"one"}]}\'\n')
        second = self.harness('second', 'echo \'{"models":[{"id":"two"}]}\'\n')
        self.probe('codex', first)
        self.probe('codex', second)
        codex = self.provider(self.read(), 'codex')
        self.assertEqual(codex['metadata']['models'], ['two'])

    def test_codex_access_report_is_recorded_beside_the_catalog(self):
        catalog = '{"models":[{"slug":"gpt-6-sol"}]}'
        doctor = ('{"overallStatus":"warning","checks":{"auth.credentials":{"status":"ok",'
                  '"details":{"stored auth mode":"chatgpt","stored ChatGPT tokens":true,'
                  '"stored API key":false}}}}')
        codex = self.codex_harness('codex', catalog, doctor)
        recorded = self.probe('codex', codex)
        self.assertEqual(recorded['outcome'], 'ok')
        self.assertEqual(recorded['metadata']['models'], ['gpt-6-sol'])
        access = recorded['metadata']['access']
        self.assertEqual(access['state'], 'known')
        self.assertEqual(access['status'], 'ok')
        self.assertEqual(access['authMode'], 'chatgpt')
        self.assertEqual(access['chatgptTokens'], True)
        self.assertEqual(access['apiKey'], False)
        self.assertEqual(recorded['metadata']['absent'], [])
        self.assertEqual(self.provider(self.read(), 'codex')['capacity']['state'], 'unknown')

    def test_access_report_without_the_credential_check_is_unknown(self):
        catalog = '{"models":[{"slug":"gpt-6-sol"}]}'
        codex = self.codex_harness('codex', catalog, '{"overallStatus":"ok","checks":{}}')
        access = self.probe('codex', codex)['metadata']['access']
        self.assertEqual(access['state'], 'unknown')
        self.assertIsNone(access['authMode'])
        self.assertEqual(sorted(access['absent']),
                         ['apiKey', 'authMode', 'chatgptTokens', 'status'])

    def test_adapter_without_an_access_read_reports_null(self):
        empty = self.harness('omp-catalog', 'echo \'{"models":[{"selector":"kimi-code/k3"}]}\'\n')
        recorded = self.probe('omp', empty)
        self.assertIsNone(recorded['metadata']['access'])

    def test_continuation_refuses_unknown_capacity_and_keeps_the_candidates(self):
        self.session('seat', 'omp', 'deepseek/deepseek-flash', 'high')
        self.session('other', 'codex', 'gpt-6-astra', 'high')
        self.message('owed', 'seat')
        document = self.read('seat')
        continuation = document['continuation']
        self.assertEqual(continuation['seat']['harness'], 'omp')
        self.assertEqual(continuation['seat']['pendingInputs'], 1)
        self.assertEqual(continuation['seat']['stopped'], False)
        self.assertIsNone(continuation['proposal'])
        refusal = continuation['refusal']
        self.assertEqual(refusal['error'], 'continuation-capacity-unknown')
        self.assertEqual(sorted(candidate['harness'] for candidate in refusal['unknown']),
                         ['codex', 'omp'])
        self.assertTrue(all(candidate['proposed'] is False
                            for candidate in continuation['candidates']))
        self.assertTrue(all(candidate['why-not'] for candidate in continuation['candidates']))

    def test_continuation_proposes_a_probed_alternative_and_keeps_the_seat(self):
        self.session('seat', 'omp', 'deepseek/deepseek-flash', 'high')
        self.session('other', 'codex', 'gpt-6-astra', 'high')
        self.message('owed', 'seat')
        catalog = self.harness('codex-catalog', 'echo \'{"models":[{"slug":"gpt-6-astra"}]}\'\n')
        self.probe('codex', catalog)
        continuation = self.read('seat')['continuation']
        self.assertIsNone(continuation['refusal'])
        self.assertEqual(continuation['proposal']['harness'], 'codex')
        self.assertEqual(continuation['proposal']['model'], 'gpt-6-astra')
        self.assertEqual(continuation['proposal']['basis'], 'listed-exact-selector')
        self.assertEqual(continuation['proposal']['capacity'], 'unknown')
        self.assertEqual(continuation['seat']['pendingInputs'], 1)
        proposed = [candidate for candidate in continuation['candidates'] if candidate['proposed']]
        self.assertEqual(len(proposed), 1)

    def test_observed_route_keeps_its_recorded_and_declared_provenance(self):
        self.session('seat', 'omp', 'deepseek/deepseek-flash')
        connection = sqlite3.connect(self.db)
        connection.execute('UPDATE sessions SET observed_model=?,observed_harness=?,observed_effort=?'
                           ' WHERE id=?', ('deepseek/deepseek-v4-flash', 'omp', 'high', 'seat'))
        connection.commit()
        connection.close()
        observed = self.read()['observed']
        self.assertEqual(len(observed), 1)
        self.assertEqual(observed[0]['model'], 'deepseek/deepseek-v4-flash')
        self.assertEqual(observed[0]['modelProvenance'], 'observed-provider')
        self.assertEqual(observed[0]['routeProvenance'], 'recorded-configuration')
        self.assertEqual(observed[0]['declaredHarnessAtBind'], ['omp'])
        self.assertEqual(observed[0]['seats'], ['seat'])

    def test_pretty_read_prints_the_same_document(self):
        plain = self.read()
        result = self.call('models', '--pretty')
        if 'no such function: json_pretty' in result.stderr:
            self.skipTest('this host SQLite predates json_pretty')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), plain)


if __name__ == '__main__':
    unittest.main()
