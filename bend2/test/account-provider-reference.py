"""Account provider selection and OMP store credential reads (#1490)."""
import json
import os
import pathlib
import sqlite3
import subprocess
import sys
import tempfile
import unittest

EXE = pathlib.Path(os.environ['BATON2_ACCOUNT_PROVIDER_FIXTURE']).resolve()
RESET = 4070908800000
WINDOWS = [{'window': '7-day', 'usedPercent': 35.72, 'exhausted': False,
            'resetsAt': 1794894082000}]
LIMIT = json.dumps({'type': 'result', 'is_error': True, 'api_error_status': 429,
                    'result': "429 exceeded_current_quota_error: You've reached your weekly (7-day) usage limit"})


class AccountProviderReference(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='account-provider-')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.db = self.directory / 'state.db'
        sqlite3.connect(self.db).close()
        self.addCleanup(self.shutdown)
        self.entry('account', 'read', *[''] * 8)
        self.sql("INSERT INTO sessions(id,parent,harness,model) VALUES('root',NULL,'terminal',''),('worker','root','omp','kimi-code/k3.1-pro')")
        self.sql("INSERT INTO session_roles(session,role) VALUES('root','conductor')")
        self.sql("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task','root','worker','task','Complete the assigned work.')")
        self.helper = self.directory / 'usage-helper'
        self.helper.write_text('#!' + sys.executable + '\n' + '''import json,sys
reference=sys.argv[2]
base={'schema':'baton2-usage-read-v1','provider':sys.argv[1], 'source':'fixture usage','observedAt':1794600000000}
if 'unreadable' in reference or 'openai' in reference:
 base.update(state='unreadable',reason='fixture credential read unavailable')
else:
 used=100 if reference=='omp-models:'+sys.argv[1] else 12
 base.update(state='read',windows=[{'window':'7-day','usedPercent':used,'exhausted':used==100,'resetsAt':4070908800000}])
print(json.dumps(base))
''')
        self.helper.chmod(0o700)

    def shutdown(self):
        for flag in ['--instance-shutdown', '--instance-wait']:
            result = subprocess.run([str(EXE), flag, str(self.db)], capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def sql(self, statement, values=()):
        with sqlite3.connect(self.db) as db:
            db.execute(statement, values)

    def rows(self, statement, values=()):
        with sqlite3.connect(self.db) as db:
            return db.execute(statement, values).fetchall()

    def entry(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def record(self, label, provider, harness='omp', funding='api_key', reference=None, ok=True):
        if reference is None:
            reference = str(self.directory / label)
            pathlib.Path(reference).mkdir(exist_ok=True)
        return self.entry('account', 'record', label, provider, harness, funding, reference, '', '', '', ok=ok)

    def current(self, session='worker', harness='omp'):
        return self.entry('current', session, harness).stdout.strip()

    def wake(self):
        return json.loads(self.entry('provider-wake', 'worker', self.helper).stdout)

    def different_provider_supplies_no_account_move(self, provider, model):
        self.sql("UPDATE sessions SET model=? WHERE id='worker'", (model,))
        self.record('openai-account', 'openai')
        self.assertEqual(self.wake(), {'moved': False, 'account': ''})
        self.assertEqual(self.current(), '')
        moves = self.rows("SELECT body FROM messages WHERE body LIKE 'account move:%'")
        self.assertEqual(moves, [])
        providers = self.rows('SELECT DISTINCT provider FROM usage_reads')
        self.assertEqual(providers, [(provider,)])

    def test_kimi_cannot_move_to_an_openai_account(self):
        self.different_provider_supplies_no_account_move('kimi-code', 'kimi-code/k3.1-pro')

    def test_zai_cannot_move_to_an_openai_account(self):
        self.different_provider_supplies_no_account_move('zai', 'zai/glm-5.3-flash')

    def test_no_compatible_account_reports_the_zai_refusal_to_the_conductor(self):
        self.sql("UPDATE sessions SET model='zai/glm-5.3-flash' WHERE id='worker'")
        self.record('openai-account', 'openai')
        cause = ('429 Usage limit reached for 5 hour. Your limit will reset at 2026-11-14 09:10:07\n'
                 'Usage limit reached for 5 hour. Your limit will reset at 2026-11-14 09:10:07 (type=1308)')
        event = json.dumps({'type': 'agent_end', 'isTerminal': True, 'messages': [{
            'role': 'assistant', 'provider': 'zai', 'model': 'glm-5.3-flash',
            'stopReason': 'error', 'errorMessage': cause}]})
        ended = self.entry('handoff-with', 'worker', 'refused-no-match', event, self.helper)
        self.assertEqual(ended.stdout.strip(), 'exhausted')
        self.assertEqual(self.current(), '')
        self.assertEqual(self.rows("SELECT id FROM messages WHERE body LIKE 'account move:%'"), [])
        reports = self.rows("SELECT recipient,body FROM messages WHERE id='refused-no-match:account-provider-unavailable' AND kind='report'")
        self.assertEqual(len(reports), 1, reports)
        recipient, body = reports[0]
        self.assertEqual(recipient, 'root')
        for text in ['Provider zai ended this attempt', 'No recorded omp account serves this provider',
                     'current store and unfinished work remain recorded', cause]:
            self.assertIn(text, body)

    def test_account_order_and_attempt_use_the_matching_provider(self):
        self.record('openai-account', 'openai')
        self.record('kimi-account', 'kimi-code')
        self.assertEqual(self.wake(), {'moved': True, 'account': 'kimi-account'})
        self.entry('provider-attempt', 'worker', 'omp', 'attempt-matched')
        self.assertEqual(self.rows('SELECT t.account,a.provider FROM account_attempts t JOIN accounts a ON a.id=t.account'),
                         [('kimi-account', 'kimi-code')])
        moves = self.rows("SELECT body FROM messages WHERE body LIKE 'account move:%'")
        self.assertTrue(moves)
        self.assertTrue(all('to kimi-account, entry 1 of 1' in body for body, in moves), moves)

    def test_explicit_binding_refuses_a_recorded_different_provider(self):
        self.record('openai-account', 'openai')
        result = self.entry('account', 'bind', 'openai-account', '', '', '', '', '', '', 'worker', ok=False)
        self.assertNotEqual(result.returncode, 0, result.stdout)
        self.assertEqual(self.current(), '')

    def test_legacy_incompatible_binding_has_no_new_attempt_attribution(self):
        self.record('openai-account', 'openai')
        path = pathlib.Path(self.entry('account-path', 'worker').stdout.strip())
        path.write_text('openai-account\n')
        self.assertEqual(self.current(), '')
        self.entry('provider-attempt', 'worker', 'omp', 'attempt-legacy')
        self.assertEqual(self.rows('SELECT account FROM account_attempts'), [])
        self.entry('handoff-with', 'worker', 'refused-attempt', LIMIT, self.helper)
        self.assertEqual(path.read_text(), 'openai-account\n')
        reports = [body for body, in self.rows("SELECT body FROM messages WHERE kind='report'")]
        self.assertFalse(any('organization API account refused' in body for body in reports), reports)
        self.assertTrue(any('kimi-code' in body for body in reports), reports)

    def test_native_omp_binding_keeps_the_selected_store_directory(self):
        self.record('kimi-account', 'kimi-code')
        self.entry('account', 'bind', 'kimi-account', '', '', '', '', '', '', 'worker')
        result = self.entry('provider-binding', 'worker', 'omp')
        self.assertIn('PI_CODING_AGENT_DIR=' + str(self.directory / 'kimi-account'), result.stdout.splitlines())

    def test_codex_and_claude_account_provider_names_match_their_services(self):
        for session, harness, model, provider in [('codex-seat', 'codex', 'gpt-6.1-sol', 'openai'),
                                                   ('claude-seat', 'claude-code', 'claude-opus-5-5', 'anthropic')]:
            with self.subTest(harness=harness):
                self.sql('INSERT INTO sessions(id,parent,harness,model) VALUES(?,?,?,?)', (session, 'root', harness, model))
                self.record(session, provider, harness=harness, funding='subscription')
                self.entry('account', 'bind', session, '', '', '', '', '', '', session)
                self.assertEqual(self.current(session, harness), session)

    def test_an_unknown_provider_retains_its_explicit_current_binding(self):
        self.sql("UPDATE sessions SET model='' WHERE id='worker'")
        self.record('openai-account', 'openai')
        self.entry('account', 'bind', 'openai-account', '', '', '', '', '', '', 'worker')
        self.assertEqual(self.current(), 'openai-account')

    def test_unsupported_account_references_name_the_row_and_accepted_forms(self):
        cases = [('bad-omp', 'omp', 'api_key', 'literal-credential-value', 'absolute store directory'),
                 ('bad-claude', 'claude-code', 'api_key', 'keychain:missing-account', 'file:PATH, keychain:SERVICE/ACCOUNT'),
                 ('bad-keychain', 'claude-code', 'api_key', 'keychain:service/account/extra', 'file:PATH, keychain:SERVICE/ACCOUNT'),
                 ('bad-file', 'claude-code', 'api_key', 'file:', 'file:PATH, keychain:SERVICE/ACCOUNT')]
        for label, harness, funding, reference, forms in cases:
            with self.subTest(label=label):
                result = self.record(label, 'anthropic' if harness == 'claude-code' else 'kimi-code',
                                     harness=harness, funding=funding, reference=reference, ok=False)
                self.assertNotEqual(result.returncode, 0, result.stdout)
                self.assertIn('Account ' + label, result.stderr)
                self.assertIn('Accepted forms for ' + harness + ' ' + funding + ': ' + forms, result.stderr)
                if reference == 'literal-credential-value':
                    self.assertNotIn(reference, result.stderr)
                self.assertEqual(self.rows('SELECT id FROM accounts WHERE id=?', (label,)), [])

    def test_claude_api_file_and_keychain_reference_forms_are_recorded(self):
        for label, reference in [('file-key', 'file:/fixture/key'), ('keychain-key', 'keychain:fixture/service-account')]:
            with self.subTest(reference=reference):
                self.record(label, 'anthropic', harness='claude-code', funding='api_key', reference=reference)
                self.assertEqual(self.rows('SELECT secret_ref FROM accounts WHERE id=?', (label,)), [(reference,)])

    def read_reference(self, provider, reference, expected, status='200', body=None):
        environment = os.environ.copy()
        environment.pop('HOME', None)
        result = subprocess.run([str(EXE), 'read-reference', provider, str(reference), expected,
                                 status, json.dumps(body if body is not None else {'windows': WINDOWS})],
                                capture_output=True, text=True, env=environment)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertNotIn(expected, result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_models_credentials_are_read_from_the_selected_omp_store_and_provider(self):
        store = self.directory / 'selected store'
        store.mkdir()
        (store / 'models.yml').write_text('providers:\n  openai:\n    apiKey: wrong-provider-key\n  kimi-code:\n    apiKey: selected-kimi-key\n  zai:\n    apiKey: selected-zai-key\n')
        for provider, key in [('kimi-code', 'selected-kimi-key'), ('zai', 'selected-zai-key')]:
            with self.subTest(provider=provider):
                read = self.read_reference(provider, store, key)
                self.assertEqual(read['state'], 'read', read)
                self.assertEqual((read['provider'], read['state'], read['windows']), (provider, 'read', WINDOWS))

    def test_deepseek_credential_is_read_from_the_selected_omp_store(self):
        store = self.directory / 'selected auth store'
        store.mkdir()
        with sqlite3.connect(store / 'agent.db') as db:
            db.execute('CREATE TABLE auth_credentials(id INTEGER PRIMARY KEY,provider TEXT,data TEXT,disabled_cause TEXT,updated_at INTEGER)')
            db.execute('INSERT INTO auth_credentials VALUES(1,?,?,NULL,1)', ('deepseek', json.dumps({'key': 'selected-deepseek-key'})))
        read = self.read_reference('deepseek', store, 'selected-deepseek-key')
        self.assertEqual(read['state'], 'read', read)
        self.assertEqual((read['provider'], read['state'], read['windows']), ('deepseek', 'read', WINDOWS))

    def test_provider_429_response_and_reset_remain_observations(self):
        key = self.directory / 'key'
        key.write_text('fixture-kimi-key\n')
        body = {'type': 'exceeded_current_quota_error', 'status': 429,
                'message': "You've reached your weekly (7-day) usage limit", 'resetsAt': '2026-11-17T05:41:22Z'}
        read = self.read_reference('kimi-code', 'file:' + str(key), 'fixture-kimi-key', '429', body)
        self.assertEqual((read['provider'], read['state']), ('kimi-code', 'unreadable'))
        for text in ['HTTP 429', 'exceeded_current_quota_error', '2026-11-17T05:41:22Z']:
            self.assertIn(text, read['reason'])

    def test_unreadable_report_describes_the_recorded_unknown_state(self):
        self.record('unreadable-kimi', 'kimi-code')
        self.entry('account', 'bind', 'unreadable-kimi', '', '', '', '', '', '', 'worker')
        self.wake()
        reports = [body for body, in self.rows("SELECT body FROM messages WHERE kind='report'")]
        self.assertTrue(any('current provider-window state is unknown' in body for body in reports), reports)
        self.assertFalse(any('keeps any hold' in body for body in reports), reports)
        self.assertEqual(self.rows('SELECT provider,account,state,reason FROM usage_reads'),
                         [('kimi-code', 'unreadable-kimi', 'unreadable', 'fixture credential read unavailable')])


if __name__ == '__main__':
    unittest.main()
