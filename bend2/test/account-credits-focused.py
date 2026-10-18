"""Focused native account/fallback behavior tests.

These drive the focused native account-credits-entry, which imports the same
accounts.bend functions the coordinator uses. They run without a full Main.
"""
import json
import os
import pathlib
import sqlite3
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
ENTRY = pathlib.Path(os.environ.get('BATON2_ACCOUNT_ENTRY', ROOT / '.scratch/bend2/account-credits-entry'))
CREDIT_EVENT = json.dumps({
    'type': 'result', 'is_error': True,
    'result': 'Your credit balance is too low to access the Anthropic API.',
    'api_error_status': 402,
})


class FocusedAccountCredits(unittest.TestCase):
    def setUp(self):
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix='account-focused-'))
        self.addCleanup(lambda: __import__('shutil').rmtree(self.directory, ignore_errors=True))
        self.db = self.directory / 'test.db'
        sqlite3.connect(self.db).close()
        # First account read installs the coordinator schema.
        self.assertEqual(self.account('read').returncode, 0)
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('root',NULL,'claude-code')")
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('leaf','root','claude-code')")
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('other','root','claude-code')")
        self.execute("INSERT INTO messages(id,sender,recipient,kind,body) VALUES('task-1','root','leaf','task','original task')")

    def execute(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            database.execute(sql, parameters)
            database.commit()

    def query(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            return database.execute(sql, parameters).fetchall()

    def entry(self, *arguments):
        return subprocess.run([str(ENTRY), str(self.db), *arguments], capture_output=True, text=True)

    def account(self, action, label='', provider='', harness='', funding='', secret='', organization='', detail='', session=''):
        completed = self.entry('account', action, label, provider, harness, funding, secret, organization, detail, session)
        return completed

    def json_account(self, action, **fields):
        completed = self.account(action, **fields)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def record(self, label, harness='claude-code', funding='subscription', secret='/fixture/store', provider='anthropic'):
        return self.account('record', label, provider, harness, funding, secret)

    def current(self, session, harness='claude-code'):
        completed = self.entry('current', session, harness)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def bind(self, label, session):
        completed = self.account('bind', label, session=session)
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def handoff(self, session, event=CREDIT_EVENT):
        completed = self.entry('handoff', session, 'turn-' + session, event)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_record_and_read_keep_the_funding_route_and_leave_the_organization_unknown(self):
        row = self.json_account('record', label='claude-max', provider='anthropic', harness='claude-code', funding='subscription', secret='/fixture/store')['accounts'][0]
        self.assertEqual((row['id'], row['funding'], row['organization'], row['organizationKnown']),
                         ('claude-max', 'subscription', '', 0))
        self.assertEqual(self.json_account('read', label='claude-max')['accounts'][0], row)

    def test_record_refuses_a_label_a_route_or_a_reference_it_cannot_use(self):
        for label, provider, harness, funding, secret in (
                ('two words', 'anthropic', 'claude-code', 'subscription', '/fixture/store'),
                ('claude-max', '', 'claude-code', 'subscription', '/fixture/store'),
                ('claude-max', 'anthropic', 'gemini', 'subscription', '/fixture/store'),
                ('claude-max', 'anthropic', 'claude-code', 'trial', '/fixture/store'),
                ('claude-max', 'anthropic', 'claude-code', 'subscription', '')):
            refused = self.record(label, harness, funding, secret, provider)
            self.assertEqual(refused.returncode, 2, refused.stderr)
        self.assertEqual(self.json_account('read')['accounts'], [])

    def test_api_key_funding_records_only_for_the_claude_code_harness(self):
        refused = self.record('omp-api', harness='omp', funding='api_key', secret='file:/fixture/api')
        self.assertEqual(refused.returncode, 2, refused.stderr)
        self.assertEqual(self.json_account('read')['accounts'], [])

    def test_rerecording_a_label_with_different_fields_is_refused(self):
        self.record('claude-api', funding='api_key', secret='file:/fixture/one')
        same = self.record('claude-api', funding='api_key', secret='file:/fixture/one')
        self.assertEqual(same.returncode, 0, same.stderr)
        refused = self.record('claude-api', funding='api_key', secret='file:/fixture/rotated')
        self.assertEqual(refused.returncode, 2, refused.stderr)
        self.assertEqual(self.json_account('read', label='claude-api')['accounts'][0]['secretRef'], 'file:/fixture/one')

    def test_the_pool_names_conflicting_readings_and_unknown_credit_state(self):
        self.record('claude-max')
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.observe('claude-max', 'org-fixture')
        self.observe('claude-api', 'org-fixture')
        pooled = self.json_account('pool', organization='org-fixture')['organizations'][0]
        self.assertEqual(pooled['observationState'], 'unknown')
        self.import_credit('claude-max', 'org-fixture', '200.00', 1760000001000)
        self.import_credit('claude-api', 'org-fixture', '184.32', 1760000002000)
        pooled = self.json_account('pool', organization='org-fixture')['organizations'][0]
        fact = {row['fact']: row for row in pooled['facts']}['promotional_credit']
        self.assertTrue(fact['conflict'])
        self.assertEqual(sorted(row['balance'] for row in fact['readings']), ['184.32', '200.00'])
        chosen = self.json_account('select', harness='claude-code', funding='api_key')
        self.assertEqual((chosen['selected'], chosen['creditEligible'], chosen['observationState']),
                         ('claude-api', True, 'reported'))

    def test_bind_requires_a_session_whose_harness_the_account_records(self):
        self.execute("INSERT INTO sessions(id,parent,harness) VALUES('omp-leaf','root','omp')")
        self.record('claude-max')
        refused = self.account('bind', 'claude-max', session='omp-leaf')
        self.assertEqual(refused.returncode, 2, refused.stderr)
        self.record('omp-main', harness='omp', secret='/fixture/omp')
        self.bind('omp-main', 'omp-leaf')

    def test_an_observation_verifies_the_organization_and_records_its_source(self):
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        saved = self.observe('claude-api', 'org-fixture')
        row = saved['accounts'][0]
        self.assertEqual((row['organization'], row['verifiedAt']), ('org-fixture', '1760000000000'))
        self.assertEqual((saved['observation']['state'], saved['observation']['authority']), ('reported', 'operator'))

    def test_an_unavailable_observation_keeps_the_condition_and_leaves_the_amount_unknown(self):
        self.record('claude-max')
        self.observe('claude-max', 'org-fixture')
        saved = self.observe_detail('claude-max', json.dumps({
            'operation': 'cost', 'state': 'unavailable', 'observedAt': 1760000002000,
            'source': 'anthropic-admin-api:/v1/organizations/cost_report',
            'condition': 'httpError', 'detail': '403 Forbidden'}))
        self.assertEqual((saved['observation']['fact'], saved['observation']['state'], saved['observation']['balance']),
                         ('external_spend', 'unavailable', ''))
        pooled = self.json_account('pool', organization='org-fixture')['organizations'][0]
        facts = {row['fact']: row for row in pooled['facts']}
        self.assertEqual(facts['external_spend']['state'], 'unavailable')

    def test_a_credit_import_requires_a_verified_organization_and_a_canonical_decimal(self):
        self.record('claude-max')
        refused = self.import_credit('claude-max', 'org-fixture', '200.00')
        self.assertEqual(refused.returncode, 2, refused.stderr)
        self.observe('claude-max', 'org-fixture')
        for balance in ('two hundred', '-200', '1e3', '1.2.3', ''):
            refused = self.import_credit('claude-max', 'org-fixture', balance)
            self.assertEqual(refused.returncode, 2, refused.stderr)
        saved = self.import_credit('claude-max', 'org-fixture', '200.00')
        self.assertEqual((saved['observation']['fact'], saved['observation']['balance']), ('promotional_credit', '200.00'))

    def test_the_pool_counts_two_accounts_of_one_organization_once(self):
        self.record('claude-max')
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.observe('claude-max', 'org-fixture')
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-max', 'org-fixture', '200.00')
        pooled = self.json_account('pool')['organizations']
        self.assertEqual(len(pooled), 1)
        self.assertEqual(sorted(pooled[0]['accounts']), ['claude-api', 'claude-max'])

    def test_selection_prefers_an_unavailable_free_organization_and_never_gates_on_a_balance(self):
        self.record('claude-max')
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.observe('claude-max', 'org-max')
        self.observe('claude-api', 'org-api')
        self.import_credit('claude-max', 'org-max', '0.00', 1760000001000)
        self.assertEqual(self.json_account('select', harness='claude-code')['selected'], 'claude-max')
        self.import_credit('claude-max', 'org-max', '', 1760000004000, state='unavailable')
        chosen = self.json_account('select', harness='claude-code', funding='subscription')
        self.assertEqual((chosen['selected'], chosen['preferredByObservation']), ('claude-max', False))

    def test_the_launch_records_the_funding_route_for_the_attempt(self):
        self.record('claude-max')
        self.bind('claude-max', 'leaf')
        self.execute("INSERT INTO executions(session,id,mode,directory,phase,status) VALUES('leaf','exec-1','direct','attempt-1','running','')")
        completed = self.entry('attempt', 'leaf', 'claude-code', 'attempt-1', '')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        attempts = self.json_account('attempts', session='leaf')['attempts']
        self.assertEqual((attempts[0]['account'], attempts[0]['funding'], attempts[0]['turn']),
                         ('claude-max', 'subscription', 'exec-1'))

    def test_exhaustion_advances_the_bound_account_and_records_the_next_attempt(self):
        self.record('claude-a')
        self.record('claude-b')
        self.bind('claude-a', 'leaf')
        self.assertEqual(self.handoff('leaf'), 'advanced')
        self.assertEqual(self.current('leaf'), 'claude-b')

    def test_the_last_account_exhaustion_records_the_fact_and_wakes_the_conductor(self):
        self.record('claude-only')
        self.bind('claude-only', 'leaf')
        self.assertEqual(self.handoff('leaf'), 'exhausted')
        bodies = [row[0] for row in self.query("SELECT body FROM messages WHERE kind='report' AND sender='leaf'")]
        self.assertTrue(any('accounts exhausted' in body for body in bodies), bodies)

    def test_exhaustion_on_one_session_leaves_another_sessions_binding_untouched(self):
        for label in ('claude-a', 'claude-b', 'claude-c'):
            self.record(label)
        self.bind('claude-a', 'leaf')
        self.bind('claude-c', 'other')
        self.assertEqual(self.handoff('leaf'), 'advanced')
        self.assertEqual(self.current('leaf'), 'claude-b')
        self.assertEqual(self.current('other'), 'claude-c')

    def test_exhaustion_preserves_the_owed_task_input(self):
        self.record('claude-a')
        self.record('claude-b')
        self.bind('claude-a', 'leaf')
        self.handoff('leaf')
        self.assertEqual(self.query("SELECT body FROM messages WHERE id='task-1'"), [('original task',)])
        self.assertEqual(self.query("SELECT count(*) FROM messages WHERE kind='guidance' AND recipient='leaf'"), [(0,)])

    def test_a_subscription_usage_fact_is_not_a_credit_import(self):
        self.record('claude-max')
        self.observe('claude-max', 'org-fixture')
        refused = self.import_credit('claude-max', 'org-fixture', '200.00', fact='subscription_usage')
        self.assertEqual(refused.returncode, 2, refused.stderr)

    # Helpers for observations and imports.
    def observation_document(self, organization, observed_at=1760000000000):
        return json.dumps({'operation': 'organization', 'state': 'reported', 'observedAt': observed_at,
                           'source': 'anthropic-admin-api:/v1/organizations/me',
                           'document': {'type': 'organization', 'id': organization, 'name': 'Fixture'}})

    def observe(self, label, organization, observed_at=1760000000000):
        return self.observe_detail(label, self.observation_document(organization, observed_at))

    def observe_detail(self, label, detail):
        completed = self.account('observe', label, detail=detail, session='')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def import_credit(self, label, organization, balance, observed_at=1760000000000, state='reported', fact='promotional_credit'):
        detail = json.dumps({'fact': fact, 'state': state, 'balance': balance, 'unit': 'USD',
                             'cycle': '2026-10', 'source': 'console-billing-display', 'observedAt': observed_at})
        completed = self.account('import-credit', label, organization=organization, detail=detail, session='')
        if completed.returncode != 0:
            return completed
        return json.loads(completed.stdout)


if __name__ == '__main__':
    unittest.main()
