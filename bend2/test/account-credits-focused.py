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

    def history_needed(self, first, second, harness='claude-code'):
        completed = self.entry('history-needed', first, second, harness)
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

    def test_the_pool_names_a_chronological_decrease_without_a_conflict(self):
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
        self.assertFalse(fact['conflict'])
        self.assertEqual(fact['balance'], '184.32')
        self.assertEqual(sorted(row['balance'] for row in fact['readings']), ['184.32', '200.00'])
        chosen = self.json_account('select', harness='claude-code', funding='api_key')
        self.assertEqual((chosen['selected'], chosen['creditEligible'], chosen['observationState']),
                         ('claude-api', True, 'reported'))

    def test_the_pool_names_conflicting_balances_at_the_same_observation_time(self):
        self.record('claude-max')
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.observe('claude-max', 'org-fixture')
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-max', 'org-fixture', '200.00', 1760000002000)
        self.import_credit('claude-api', 'org-fixture', '184.32', 1760000002000)
        pooled = self.json_account('pool', organization='org-fixture')['organizations'][0]
        fact = {row['fact']: row for row in pooled['facts']}['promotional_credit']
        self.assertTrue(fact['conflict'])
        self.assertEqual(sorted(row['balance'] for row in fact['readings']), ['184.32', '200.00'])

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

    def test_account_history_transport_is_needed_only_for_distinct_subscription_stores(self):
        self.record('claude-a', secret='/fixture/store-a')
        self.record('claude-b', secret='/fixture/store-b')
        self.record('claude-c', secret='/fixture/store-a')
        self.record('api-a', funding='api_key', secret='file:/fixture/api-a')
        self.record('api-b', funding='api_key', secret='file:/fixture/api-b')
        self.assertEqual(self.history_needed('claude-a', 'claude-b'), 'yes')
        self.assertEqual(self.history_needed('claude-a', 'claude-c'), 'no')
        self.assertEqual(self.history_needed('api-a', 'api-b'), 'no')

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

    def gate(self, attempt, session='leaf'):
        completed = self.entry('gate', session, 'claude-code', attempt)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def complete(self, attempt, outcome='completed'):
        completed = self.entry('complete', attempt, outcome, '')
        self.assertEqual(completed.returncode, 0, completed.stderr)

    def credit_account(self, balance='200.00'):
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.bind('claude-api', 'leaf')
        self.observe('claude-api', 'org-fixture')
        if balance is not None:
            self.import_credit('claude-api', 'org-fixture', balance)


    def test_gate_holds_an_eligible_credit_account_and_records_no_reservation(self):
        self.credit_account()
        self.assertIn('credit-only routing is not proven', self.gate('attempt-1'))
        self.assertEqual(self.query("SELECT count(*) FROM credit_reservations"), [(0,)])

    def test_gate_refuses_a_reported_zero_balance(self):
        self.credit_account(balance='0.00')
        self.assertIn('promotionalCreditExhausted', self.gate('attempt-1'))

    def test_gate_refuses_an_unverified_organization(self):
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.bind('claude-api', 'leaf')
        self.assertIn('organizationUnverified', self.gate('attempt-1'))

    def test_gate_refuses_without_a_reported_credit_observation(self):
        self.credit_account(balance=None)
        self.assertIn('creditObservationUnavailable', self.gate('attempt-1'))

    def reserve(self, attempt, session='leaf', cap='2026-10'):
        completed = self.entry('reserve', session, 'claude-code', attempt, cap)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip().split('|')

    def reserve_bound(self, attempt, bound, session='leaf', period='2026-10'):
        completed = self.entry('reserve-bound', session, 'claude-code', attempt, period, bound)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip().split('|')

    def settle(self, request, outcome='completed', cost=''):
        completed = self.entry('settle', request, outcome, cost)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def reconcile(self, request, cost):
        completed = self.entry('reconcile', request, cost)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def gate_qualified(self, attempt, session='leaf'):
        completed = self.entry('gate-qualified', session, 'claude-code', attempt)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip().split('|')

    def gate_held(self, attempt, session='leaf'):
        completed = self.entry('gate-held', session, 'claude-code', attempt)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip().split('|')

    def import_spend(self, label, organization, balance, cycle='2026-10', unit='USD'):
        detail = json.dumps({'fact': 'external_spend', 'state': 'reported', 'balance': balance,
                             'unit': unit, 'cycle': cycle,
                             'source': 'anthropic-admin-api:/v1/organizations/cost_report',
                             'observedAt': 1760000005000})
        completed = self.account('import-spend', label, organization=organization, detail=detail, session='')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def test_reservation_reserves_the_lower_bound_and_serializes(self):
        self.credit_account('200.00')
        first = self.reserve('attempt-1')
        self.assertEqual(first[:3], ['admitted', 'org-fixture', 'grant:2026-10-11'])
        self.assertEqual(first[3:], ['200', '0', '0'])
        self.assertEqual(self.reserve('attempt-2'), ['refused', 'creditReservationInFlight'])
        self.assertEqual(self.query("SELECT request,state,max_charge FROM credit_reservations"),
                         [('attempt-1', 'reserved', '200')])

    def test_reservation_uses_the_observed_balance_when_lower(self):
        self.credit_account('150.00')
        admitted = self.reserve('attempt-1')
        self.assertEqual(admitted[:3], ['admitted', 'org-fixture', 'grant:2026-10-11'])
        self.assertEqual(admitted[3:], ['150', '0', '50'])

    def test_a_bounded_reservation_reserves_only_the_request_charge(self):
        self.credit_account('200.00')
        first = self.reserve_bound('attempt-1', '1.25')
        self.assertEqual(first[:3], ['admitted', 'org-fixture', 'grant:2026-10-11'])
        self.assertEqual(first[3:], ['1.25', '198.75', '198.75'])
        self.assertEqual(self.settle('attempt-1', 'completed', '1.25'), 'settled')
        second = self.reserve_bound('attempt-2', '198.75')
        self.assertEqual(second[:3], ['admitted', 'org-fixture', 'grant:2026-10-11'])
        self.assertEqual(second[3:], ['198.75', '1.25', '0'])

    def test_reservation_uses_provider_spend_reconciliation(self):
        self.credit_account('200.00')
        self.import_spend('claude-api', 'org-fixture', '50.00')
        admitted = self.reserve('attempt-1')
        self.assertEqual(admitted[3:], ['150', '50', '0'])

    def test_reservation_refuses_conflicting_readings(self):
        self.credit_account('200.00')
        self.import_credit('claude-api', 'org-fixture', '199.00', 1760000000000)
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditReadingsConflict'])

    def test_reservation_accepts_chronological_balance_decrease(self):
        self.credit_account('200.00')
        self.import_credit('claude-api', 'org-fixture', '199.52', 1760000009000)
        admitted = self.reserve('attempt-1')
        self.assertEqual(admitted[:3], ['admitted', 'org-fixture', 'grant:2026-10-11'])
        self.assertEqual(admitted[3], '199.52')

    def test_reservation_refuses_non_usd_and_unverified_expiry(self):
        self.credit_account('200.00')
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000010000, unit='EUR')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditUnitNotUSD'])
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000011000,
                           unit='USD', expires='1000000000000')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditObservationExpired'])
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000012000,
                           unit='USD', expires='2026-11-14')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditObservationExpiryUnverified'])
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000013000,
                           unit='USD', expires='soon')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditObservationExpiryUnverified'])
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000014000,
                           unit='USD', expires='4102444800000')
        self.assertEqual(self.reserve('attempt-1')[:2], ['admitted', 'org-fixture'])

    def test_reservation_settles_missing_cost_and_reconciles(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.assertEqual(self.settle('attempt-1', 'completed', ''), 'failed')
        self.assertEqual(self.reserve('attempt-2'), ['refused', 'monthlyCapExhausted'])
        self.assertEqual(self.reconcile('attempt-1', '12.50'), 'settled')
        admitted = self.reserve('attempt-2')
        self.assertEqual(admitted[:2], ['admitted', 'org-fixture'])
        self.assertEqual(admitted[3], '187.5')

    def test_reservation_duplicate_request_is_idempotent(self):
        self.credit_account('200.00')
        first = self.reserve('attempt-1')
        self.assertEqual(first, self.reserve('attempt-1'))
        self.assertEqual(self.query("SELECT count(*) FROM credit_reservations WHERE request='attempt-1'"), [(1,)])

    def test_reservation_binding_is_real_when_qualified_and_held(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        qualified = self.gate_qualified('attempt-1')
        self.assertEqual(qualified[0], 'binding')
        self.assertEqual(qualified[1], '/fixture/api-key-exec')
        self.assertEqual(self.query("SELECT state FROM credit_authorizations WHERE attempt='attempt-1'"),
                         [('authorized',)])
        held = self.gate_held('attempt-1')
        self.assertEqual(held[0], 'refused')
        self.assertIn('held', held[1])

    def test_reservation_refuses_missing_observation_and_expired_grant(self):
        self.record('claude-api', funding='api_key', secret='file:/fixture/api')
        self.bind('claude-api', 'leaf')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditObservationUnavailable'])
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000000000,
                           expires='1000000000000', cycle='grant:2026-09-01')
        self.assertEqual(self.reserve('attempt-1'), ['refused', 'creditObservationExpired'])
        self.import_credit('claude-api', 'org-fixture', '200.00', 1760000001000,
                           expires='4102444800000', cycle='grant:2026-10-11')
        self.assertEqual(self.reserve('attempt-1')[:2], ['admitted', 'org-fixture'])

    def test_reservation_process_failure_keeps_the_bound(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.assertEqual(self.settle('attempt-1', 'failed', ''), 'failed')
        self.assertEqual(self.reserve('attempt-2'), ['refused', 'monthlyCapExhausted'])
        self.assertEqual(self.reconcile('attempt-1', '5.00'), 'settled')
        self.assertEqual(self.reserve('attempt-2')[3], '195')

    def test_account_reconcile_dispatches(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.assertEqual(self.settle('attempt-1', 'completed', ''), 'failed')
        completed = self.account('reconcile', 'attempt-1',
                                 detail=json.dumps({'cost': '12.50'}), session='')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(completed.stdout.strip(), 'settled')

    def complete_event(self, attempt, event, outcome='completed'):
        completed = self.entry('complete-event', attempt, outcome, '', event)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_attempt_completion_settles_the_result_cost_once(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        event = json.dumps({'type': 'result', 'subtype': 'success', 'is_error': False,
                            'total_cost_usd': 0.4875489})
        self.assertEqual(self.complete_event('attempt-1', event), 'attempt-completed')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '0.4875489')])
        self.assertEqual(self.complete_event('attempt-1', event), 'attempt-completed')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '0.4875489')])
        self.assertEqual(self.reserve('attempt-2')[3], '199.5124511')

    def test_attempt_completion_without_result_cost_keeps_the_bound(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.assertEqual(self.complete_event('attempt-1', '{"type":"result","is_error":true}', 'failed'),
                         'attempt-completed')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])
        self.assertEqual(self.reserve('attempt-2'), ['refused', 'monthlyCapExhausted'])

    def test_result_cost_rejects_an_exponent(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","total_cost_usd":1e2}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])

    def test_result_cost_reads_the_root_field_past_a_nested_field(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","usage":{"total_cost_usd":0.01},"total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_preserves_the_exact_root_decimal_past_a_nested_field(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","usage":{"total_cost_usd":0.100000000000000001},"total_cost_usd":0.100000000000000002}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '0.100000000000000002')])

    def test_result_cost_ignores_a_nested_exponent_field(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","usage":{"total_cost_usd":1e2},"total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_refuses_duplicate_root_fields(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","total_cost_usd":0.1,"total_cost_usd":100}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])

    def test_result_cost_refuses_duplicate_root_fields_with_equal_values(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","total_cost_usd":0.1,"total_cost_usd":0.1}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])

    def test_result_cost_settles_past_an_escaped_newline(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', r'{"type":"result","result":"line\nbreak","total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_settles_past_an_escaped_quote(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', r'{"type":"result","result":"quote\"inside","total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_settles_past_an_escaped_backslash(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', r'{"type":"result","result":"slash\\inside","total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_settles_past_an_escaped_tab(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', r'{"type":"result","result":"tab\tinside","total_cost_usd":1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def test_result_cost_rejects_malformed_json(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","total_cost_usd":0.1garbage}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])

    def test_result_cost_rejects_a_non_result_frame(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"message","total_cost_usd":0.1}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('failed', '')])

    def test_result_cost_accepts_whitespace_before_the_colon(self):
        self.credit_account('200.00')
        self.assertEqual(self.reserve('attempt-1')[0], 'admitted')
        self.complete_event('attempt-1', '{"type":"result","total_cost_usd" : 1.25}')
        self.assertEqual(self.query("SELECT state,actual_cost FROM credit_reservations WHERE request='attempt-1'"),
                         [('settled', '1.25')])

    def price(self, model, input='0', output='0', cache5='0', cache1='0', cachehit='0', geo='global', fast='0', server='0', tools='0'):
        completed = self.entry('price', model, input, output, cache5, cache1, cachehit, geo, fast, server, tools)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_request_price_uses_the_verified_opus_rates(self):
        self.assertEqual(self.price('claude-opus-5-5', '1000000', '1000000'), 'priced|24.000000000')
        self.assertEqual(self.price('claude-opus-5-5', cache5='1000000'), 'priced|5.000000000')
        self.assertEqual(self.price('claude-opus-5-5', cache1='1000000'), 'priced|8.000000000')
        self.assertEqual(self.price('claude-opus-5-5', cachehit='1000000'), 'priced|0.200000000')

    def test_request_price_uses_the_verified_sonnet_rates(self):
        self.assertEqual(self.price('claude-sonnet-5-5', '1000000', '1000000'), 'priced|12.000000000')

    def test_request_price_applies_the_haiku_long_context_tier(self):
        self.assertEqual(self.price('claude-haiku-5-5', '100000', '100000'), 'priced|0.060000000')
        self.assertEqual(self.price('claude-haiku-5-5', '100001', '100001'), 'priced|0.300003000')

    def test_request_price_applies_fast_mode_residency_and_tools(self):
        self.assertEqual(self.price('claude-opus-5-5', '1000000', '1000000', fast='1'), 'priced|48.000000000')
        self.assertEqual(self.price('claude-opus-5-5', '1000000', '1000000', geo='us'), 'priced|26.400000000')
        self.assertEqual(self.price('claude-opus-5-5', tools='1'), 'priced|0.001624000')

    def test_request_price_refuses_unpriced_actions(self):
        self.assertEqual(self.price('claude-opus-5-5', server='1'), 'refused|creditServerToolUnpriced')
        self.assertEqual(self.price('claude-unknown'), 'refused|creditModelUnpriced')
        self.assertEqual(self.price('claude-sonnet-5-5', fast='1'), 'refused|creditFastModeUnpriced')
        self.assertEqual(self.price('claude-opus-5-5', geo='eu'), 'refused|creditResidencyUnpriced')

    def authorize(self, attempt, session='leaf'):
        completed = self.entry('authorize', session, 'claude-code', attempt)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return completed.stdout.strip()

    def test_authorization_records_actual_reported_balance_only_when_eligible(self):
        self.credit_account()
        self.assertEqual(self.authorize('attempt-1'), 'authorized')
        rows = self.query("SELECT attempt,account,organization,balance,unit FROM credit_authorizations")
        self.assertEqual(rows, [('attempt-1', 'claude-api', 'org-fixture', '200.00', 'USD')])

    def test_authorization_records_nothing_for_an_exhausted_balance(self):
        self.credit_account(balance='0.00')
        self.assertEqual(self.authorize('attempt-1'), 'not-authorized')
        self.assertEqual(self.query("SELECT count(*) FROM credit_authorizations"), [(0,)])

    def test_helper_runs_only_with_marker_and_durable_authorization(self):
        helper = os.environ.get('BATON2_API_KEY_EXEC')
        if not helper:
            self.skipTest('BATON2_API_KEY_EXEC not set')
        directory = self.directory
        secret = directory / 'secret'
        secret.write_text('fixture-secret\n')
        secret.chmod(0o600)
        self.record('claude-api', funding='api_key', secret='file:' + str(secret))
        self.bind('claude-api', 'leaf')
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-api', 'org-fixture', '200.00')
        self.assertEqual(self.authorize('attempt-1'), 'authorized')
        child = directory / 'child.sh'
        child.write_text('#!/bin/sh\nprintf "KEY=${ANTHROPIC_API_KEY:+set}\n"\n')
        child.chmod(0o755)
        base = {'BATON2_CREDIT_RESERVATION': 'attempt-1', 'BATON_ATTEMPT_DIRECTORY': 'attempt-1',
                'BATON_DATABASE': str(self.db), 'PATH': os.environ['PATH']}
        admitted = subprocess.run([helper, 'file:' + str(secret), str(child)],
                                  capture_output=True, text=True, env=base)
        self.assertEqual((admitted.returncode, admitted.stdout.strip()), (0, 'KEY=set'), admitted.stderr)
        replay = subprocess.run([helper, 'file:' + str(secret), str(child)],
                                capture_output=True, text=True, env=base)
        self.assertEqual(replay.returncode, 2, replay.stdout)
        self.assertIn('creditAuthorizationConsumed', replay.stderr)
        self.assertEqual(self.query("SELECT state,consumed<>'' FROM credit_authorizations WHERE attempt='attempt-1'"),
                         [('consumed', 1)])
        refused = subprocess.run([helper, 'file:' + str(secret), str(child)],
                                 capture_output=True, text=True,
                                 env={**base, 'BATON_ATTEMPT_DIRECTORY': 'attempt-2'})
        self.assertEqual(refused.returncode, 2, refused.stdout)
        self.assertIn('creditAdmissionUnavailable', refused.stderr)
        wrong_reference = subprocess.run([helper, 'file:/fixture/other-secret', str(child)],
                                         capture_output=True, text=True, env=base)
        self.assertEqual(wrong_reference.returncode, 2, wrong_reference.stdout)
        self.assertIn('creditAuthorizationMismatch', wrong_reference.stderr)

    def test_one_authorization_admits_exactly_one_concurrent_launch(self):
        helper = os.environ.get('BATON2_API_KEY_EXEC')
        if not helper:
            self.skipTest('BATON2_API_KEY_EXEC not set')
        directory = self.directory
        secret = directory / 'secret'
        secret.write_text('fixture-secret\n')
        secret.chmod(0o600)
        self.record('claude-api', funding='api_key', secret='file:' + str(secret))
        self.bind('claude-api', 'leaf')
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-api', 'org-fixture', '200.00')
        self.assertEqual(self.authorize('attempt-1'), 'authorized')
        child = directory / 'child.sh'
        child.write_text('#!/bin/sh\nprintf "KEY=${ANTHROPIC_API_KEY:+set}\\n"\n')
        child.chmod(0o755)
        environment = {'BATON2_CREDIT_RESERVATION': 'attempt-1', 'BATON_ATTEMPT_DIRECTORY': 'attempt-1',
                       'BATON_DATABASE': str(self.db), 'PATH': os.environ['PATH']}
        commands = [helper, 'file:' + str(secret), str(child)]
        first = subprocess.Popen(commands, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)
        second = subprocess.Popen(commands, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment)
        outputs = [first.communicate(), second.communicate()]
        codes = sorted([first.returncode, second.returncode])
        self.assertEqual(codes, [0, 2], outputs)
        self.assertEqual(self.query("SELECT count(*) FROM credit_authorizations WHERE attempt='attempt-1' AND state='consumed'"),
                         [(1,)])
        refused = [error for code, (out, error) in zip([first.returncode, second.returncode], outputs) if code != 0]
        self.assertIn('creditAuthorizationConsumed', refused[0])

    def test_a_failed_or_zero_change_consume_never_admits(self):
        helper = os.environ.get('BATON2_API_KEY_EXEC')
        if not helper:
            self.skipTest('BATON2_API_KEY_EXEC not set')
        directory = self.directory
        secret = directory / 'secret'
        secret.write_text('fixture-secret\n')
        secret.chmod(0o600)
        self.record('claude-api', funding='api_key', secret='file:' + str(secret))
        self.bind('claude-api', 'leaf')
        self.observe('claude-api', 'org-fixture')
        self.import_credit('claude-api', 'org-fixture', '200.00')
        self.assertEqual(self.authorize('attempt-1'), 'authorized')
        child = directory / 'child.sh'
        child.write_text('#!/bin/sh\nprintf "KEY=${ANTHROPIC_API_KEY:+set}\\n"\n')
        child.chmod(0o755)
        environment = {'BATON2_CREDIT_RESERVATION': 'attempt-1', 'BATON_ATTEMPT_DIRECTORY': 'attempt-1',
                       'BATON_DATABASE': str(self.db), 'PATH': os.environ['PATH']}
        commands = [helper, 'file:' + str(secret), str(child)]
        # RAISE(IGNORE) leaves the row authorized and reports changes()=0.
        self.execute("CREATE TRIGGER block_consume BEFORE UPDATE ON credit_authorizations "
                     "BEGIN SELECT RAISE(IGNORE); END")
        ignored = subprocess.run(commands, capture_output=True, text=True, env=environment)
        self.assertEqual(ignored.returncode, 2, ignored.stderr)
        self.assertIn('creditAdmissionUnavailable', ignored.stderr)
        self.assertEqual(ignored.stdout.strip(), '')
        self.assertEqual(self.query("SELECT state FROM credit_authorizations WHERE attempt='attempt-1'"),
                         [('authorized',)])
        # RAISE(ABORT) makes the guarded update itself fail.
        self.execute("DROP TRIGGER block_consume")
        self.execute("CREATE TRIGGER abort_consume BEFORE UPDATE ON credit_authorizations "
                     "BEGIN SELECT RAISE(ABORT,'fixture abort'); END")
        aborted = subprocess.run(commands, capture_output=True, text=True, env=environment)
        self.assertEqual(aborted.returncode, 2, aborted.stderr)
        self.assertIn('creditAdmissionUnavailable', aborted.stderr)
        self.assertEqual(aborted.stdout.strip(), '')
        self.assertEqual(self.query("SELECT state FROM credit_authorizations WHERE attempt='attempt-1'"),
                         [('authorized',)])

    def test_gate_keeps_the_subscription_binding(self):
        self.record('claude-max')
        self.bind('claude-max', 'leaf')
        self.assertEqual(self.gate('attempt-1'), 'CLAUDE_CONFIG_DIR=/fixture/store')

    def observe(self, label, organization, observed_at=1760000000000):
        return self.observe_detail(label, self.observation_document(organization, observed_at))

    def observe_detail(self, label, detail):
        completed = self.account('observe', label, detail=detail, session='')
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def import_credit(self, label, organization, balance, observed_at=1760000000000, state='reported', fact='promotional_credit', unit='USD', expires='4102444800000', cycle='grant:2026-10-11'):
        detail = json.dumps({'fact': fact, 'state': state, 'balance': balance, 'unit': unit,
                             'cycle': cycle, 'expires': expires, 'source': 'console-billing-display', 'observedAt': observed_at})
        completed = self.account('import-credit', label, organization=organization, detail=detail, session='')
        if completed.returncode != 0:
            return completed
        return json.loads(completed.stdout)


if __name__ == '__main__':
    unittest.main()
