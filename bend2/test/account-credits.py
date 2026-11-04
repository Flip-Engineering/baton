"""Account funding routes, the organization credit pool and the attempt funding record."""
import importlib.util
import json
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                                  pathlib.Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


identity = load('control-identity')


def credit(**fields):
    return json.dumps(fields)


def organization_document(organization, name='Fixture Console organization'):
    return credit(operation='organization', state='reported', observedAt=1760000000000,
                  source='anthropic-admin-api:/v1/organizations/me',
                  document={'type': 'organization', 'id': organization, 'name': name})


def unavailable(operation, condition, detail, observed_at=1760000002000):
    return credit(operation=operation, state='unavailable', observedAt=observed_at,
                  source='anthropic-admin-api:/v1/organizations/' + operation,
                  condition=condition, detail=detail)


def unavailable_credit(cycle, detail, observed_at=1760000004000):
    return credit(fact='promotional_credit', state='unavailable', observedAt=observed_at,
                  cycle=cycle, source='console-billing-display', condition='noReading',
                  detail=detail)


class AccountCredits(unittest.TestCase):
    # The shared fixture harness is reused without inheriting its own cases.
    git = identity.ControlIdentity.git
    call = identity.ControlIdentity.call
    root = identity.ControlIdentity.root
    dispatch = identity.ControlIdentity.dispatch
    accept = identity.ControlIdentity.accept
    action = identity.ControlIdentity.action
    finish = identity.ControlIdentity.finish
    rows = identity.ControlIdentity.rows
    eventually = identity.ControlIdentity.eventually
    exited = identity.ControlIdentity.exited
    close_fixtures = identity.ControlIdentity.close_fixtures

    def setUp(self):
        identity.ControlIdentity.setUp(self)
        # The fixture resolves the session it serves from the model it was launched with.
        config = self.directory / 'fixture.json'
        settings = json.loads(config.read_text())
        settings['sessions'] = {'kimi-code/k3': 'leaf'}
        config.write_text(json.dumps(settings))

    def recruit(self, session, harness='omp', model='kimi-code/k3', effort='low'):
        return self.call('recruit', session, 'root', harness, model, effort, self.repo,
                         session + '-branch', self.checkouts / session, self.base)

    def send(self, action, ok=True, **fields):
        # account ACTION ID PROVIDER HARNESS FUNDING SECRET_REF ORGANIZATION DETAIL SESSION
        keys = ('id', 'provider', 'harness', 'funding', 'secret_ref', 'organization', 'detail', 'session')
        self.assertFalse(set(fields) - set(keys), sorted(set(fields) - set(keys)))
        return self.call('account', action, *[fields.get(key, '') for key in keys], ok=ok)

    def record(self, label, provider, harness, funding, secret_ref, ok=True):
        return self.send('record', id=label, provider=provider, harness=harness,
                         funding=funding, secret_ref=secret_ref, ok=ok)

    def observe(self, label, document, ok=True):
        return self.send('observe', id=label, detail=document, ok=ok)

    def imported(self, label, organization, document, ok=True):
        return self.send('import-credit', id=label, organization=organization,
                         detail=document, ok=ok)

    def test_record_and_read_keep_the_funding_route_and_leave_the_organization_unknown(self):
        self.root()
        row = self.record('claude-max', 'anthropic', 'claude-code', 'subscription',
                          '/fixture/stores/claude-max')['accounts'][0]
        self.assertEqual((row['id'], row['provider'], row['harness'], row['funding']),
                         ('claude-max', 'anthropic', 'claude-code', 'subscription'))
        self.assertEqual(row['secretRef'], '/fixture/stores/claude-max')
        self.assertEqual((row['organization'], row['organizationKnown'], row['verifiedAt']),
                         ('', 0, ''))
        self.assertEqual(self.send('read', id='claude-max')['accounts'][0], row)
        self.assertEqual(self.send('read')['accounts'], [row])

    def test_record_refuses_a_label_a_route_or_a_reference_it_cannot_use(self):
        self.root()
        for label, provider, harness, funding, secret_ref in (
                ('two words', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude'),
                ('claude-max', '', 'claude-code', 'subscription', '/fixture/stores/claude'),
                ('claude-max', 'anthropic', 'gemini', 'subscription', '/fixture/stores/claude'),
                ('claude-max', 'anthropic', 'claude-code', 'trial', '/fixture/stores/claude'),
                ('claude-max', 'anthropic', 'claude-code', 'subscription', '')):
            refused = self.record(label, provider, harness, funding, secret_ref, ok=False)
            self.assertEqual(refused['code'], 2, refused)
            self.assertIn('No account was recorded', refused['stderr'])
        self.assertEqual(self.send('read')['accounts'], [])

    def test_api_key_funding_records_only_for_the_claude_code_harness(self):
        self.root()
        refused = self.record('omp-api', 'anthropic', 'omp', 'api_key',
                              'file:/fixture/secrets/api', ok=False)
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('No account was recorded', refused['stderr'])
        self.assertEqual(self.send('read')['accounts'], [])

    def test_rerecording_a_label_with_different_fields_is_refused(self):
        self.root()
        self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/one')
        same = self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/one')
        self.assertEqual(same['accounts'][0]['secretRef'], 'file:/fixture/secrets/one')
        refused = self.record('claude-api', 'anthropic', 'claude-code', 'api_key',
                              'file:/fixture/secrets/rotated', ok=False)
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('already recorded with a different', refused['stderr'])
        self.assertEqual(self.send('read', id='claude-api')['accounts'][0]['secretRef'],
                         'file:/fixture/secrets/one')

    def test_the_pool_names_conflicting_readings_and_unknown_credit_state(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/api')
        self.observe('claude-max', organization_document('org-fixture'))
        self.observe('claude-api', organization_document('org-fixture'))
        pooled = self.send('pool', organization='org-fixture')['organizations'][0]
        self.assertEqual(pooled['observationState'], 'unknown')
        self.imported('claude-max', 'org-fixture', credit(
            fact='promotional_credit', balance='200.00', unit='USD', cycle='2026-10',
            source='console-billing-display', observedAt=1760000001000))
        self.imported('claude-api', 'org-fixture', credit(
            fact='promotional_credit', balance='184.32', unit='USD', cycle='2026-10',
            source='console-billing-display', observedAt=1760000002000))
        pooled = self.send('pool', organization='org-fixture')['organizations'][0]
        self.assertEqual(pooled['observationState'], 'reported')
        fact = {row['fact']: row for row in pooled['facts']}['promotional_credit']
        self.assertTrue(fact['conflict'])
        self.assertEqual(sorted(row['balance'] for row in fact['readings']), ['184.32', '200.00'])
        chosen = self.send('select', harness='claude-code', funding='api_key')
        self.assertEqual((chosen['selected'], chosen['creditEligible'], chosen['observationState']),
                         ('claude-api', True, 'reported'))

    def test_bind_requires_a_session_whose_harness_the_account_records(self):
        self.root()
        self.recruit('leaf')
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude-max')
        refused = self.send('bind', id='claude-max', session='leaf', ok=False)
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('No binding was recorded', refused['stderr'])
        self.record('omp-main', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp')
        self.assertEqual(self.send('bind', id='omp-main', session='leaf'),
                         {'account': 'bound', 'session': 'leaf', 'accountId': 'omp-main'})

    def test_an_observation_verifies_the_organization_and_records_its_source(self):
        self.root()
        self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/api')
        self.assertEqual(self.send('read', id='claude-api')['accounts'][0]['organizationKnown'], 0)
        saved = self.observe('claude-api', organization_document('org-fixture'))
        row = saved['accounts'][0]
        self.assertEqual((row['organization'], row['organizationKnown']), ('org-fixture', 1))
        self.assertEqual(row['verifiedAt'], '1760000000000')
        observation = saved['observation']
        self.assertEqual((observation['fact'], observation['state'], observation['organization']),
                         ('organization', 'reported', 'org-fixture'))
        self.assertEqual(observation['source'], 'anthropic-admin-api:/v1/organizations/me')
        self.assertEqual(observation['observedAt'], '1760000000000')
        self.assertEqual(observation['authority'], 'operator')

    def test_a_subscription_usage_fact_is_not_a_credit_import(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        self.observe('claude-max', organization_document('org-fixture'))
        refused = self.imported('claude-max', 'org-fixture', credit(
            fact='subscription_usage', balance='200.00', unit='USD',
            source='console-billing-display'), ok=False)
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('No reading was recorded', refused['stderr'])
        refused = self.observe('missing-account', organization_document('org-fixture'), ok=False)
        self.assertEqual(refused['code'], 2, refused)
        self.assertIn('No observation was recorded', refused['stderr'])

    def test_an_unavailable_observation_keeps_the_condition_and_leaves_the_amount_unknown(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        self.observe('claude-max', organization_document('org-fixture'))
        saved = self.observe('claude-max', unavailable(
            'cost', 'httpError', '403 Forbidden: this credential cannot read organization cost'))
        observation = saved['observation']
        self.assertEqual((observation['fact'], observation['state']),
                         ('external_spend', 'unavailable'))
        self.assertEqual((observation['balance'], observation['unit']), ('', ''))
        facts = {fact['fact']: fact for fact in
                 self.send('pool', organization='org-fixture')['organizations'][0]['facts']}
        self.assertEqual(facts['external_spend']['state'], 'unavailable')
        self.assertEqual(facts['external_spend']['balance'], '')
        self.assertEqual(facts['organization']['state'], 'reported')

    def test_a_credit_import_requires_a_verified_organization_and_a_canonical_decimal(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        unverified = self.imported('claude-max', 'org-fixture', credit(
            fact='promotional_credit', balance='200.00', unit='USD',
            source='console-billing-display'), ok=False)
        self.assertEqual(unverified['code'], 2, unverified)
        self.assertIn('No reading was recorded', unverified['stderr'])
        self.observe('claude-max', organization_document('org-fixture'))
        for balance in ('two hundred', '-200', '1e3', '1.2.3', ''):
            refused = self.imported('claude-max', 'org-fixture', credit(
                fact='promotional_credit', balance=balance, unit='USD',
                source='console-billing-display'), ok=False)
            self.assertEqual(refused['code'], 2, refused)
        saved = self.imported('claude-max', 'org-fixture', credit(
            fact='promotional_credit', balance='200.00', unit='USD', expires='2026-11-01',
            cycle='2026-10', source='console-billing-display'))
        observation = saved['observation']
        self.assertEqual((observation['fact'], observation['balance'], observation['unit']),
                         ('promotional_credit', '200.00', 'USD'))
        self.assertEqual((observation['expires'], observation['cycle']),
                         ('2026-11-01', '2026-10'))
        self.assertEqual(observation['authority'], 'operator')

    def test_the_pool_counts_two_accounts_of_one_organization_once(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/api')
        self.observe('claude-max', organization_document('org-fixture'))
        self.observe('claude-api', organization_document('org-fixture'))
        self.imported('claude-max', 'org-fixture', credit(
            fact='promotional_credit', balance='200.00', unit='USD', cycle='2026-10',
            source='console-billing-display'))
        pooled = self.send('pool')
        self.assertEqual(len(pooled['organizations']), 1, pooled)
        organization = pooled['organizations'][0]
        self.assertEqual(organization['organization'], 'org-fixture')
        self.assertEqual(sorted(organization['accounts']), ['claude-api', 'claude-max'])
        facts = {fact['fact']: fact for fact in organization['facts']}
        self.assertEqual(facts['promotional_credit']['balance'], '200.00')

    def test_selection_prefers_an_unavailable_free_organization_and_never_gates_on_a_balance(self):
        self.root()
        self.record('claude-max', 'anthropic', 'claude-code', 'subscription', '/fixture/stores/claude')
        self.record('claude-api', 'anthropic', 'claude-code', 'api_key', 'file:/fixture/secrets/api')
        self.record('codex-main', 'openai', 'codex', 'subscription', '/fixture/stores/codex')
        self.observe('claude-max', organization_document('org-max'))
        self.observe('claude-api', organization_document('org-api'))
        # A reported amount is a fact the conductor reads; it never refuses work.
        self.imported('claude-max', 'org-max', credit(
            fact='promotional_credit', balance='0.00', unit='USD', cycle='2026-10',
            source='console-billing-display', observedAt=1760000001000))
        chosen = self.send('select', harness='claude-code')
        self.assertEqual(chosen['selected'], 'claude-max')
        self.assertTrue(chosen['preferredByObservation'])
        chosen = self.send('select', harness='claude-code', funding='api_key')
        self.assertEqual(chosen['selected'], 'claude-api')
        # A reading that found no value for this cycle is a preference key only.
        self.imported('claude-max', 'org-max', unavailable_credit(
            '2026-11', 'the billing display did not render the promotional balance'))
        chosen = self.send('select', harness='claude-code', funding='subscription')
        self.assertEqual((chosen['selected'], chosen['preferredByObservation']),
                         ('claude-max', False))
        refused = self.send('select', harness='muse', ok=False)
        self.assertEqual(refused['code'], 2, refused)

    def test_the_launch_records_the_funding_route_for_the_attempt(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        self.record('omp-main', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp')
        self.send('bind', id='omp-main', session='leaf')
        stream, start = self.accept('leaf')
        self.assertEqual(start['session'], 'leaf')
        attempts = self.send('attempts', session='leaf')['attempts']
        self.assertEqual(len(attempts), 1, attempts)
        self.assertEqual((attempts[0]['account'], attempts[0]['funding'], attempts[0]['session']),
                         ('omp-main', 'subscription', 'leaf'))
        self.assertEqual(attempts[0]['secretRef'], '/fixture/stores/omp')
        execution = self.rows("SELECT id, directory FROM executions WHERE session='leaf'")
        self.assertEqual(attempts[0]['attempt'], execution[0]['directory'])
        self.assertEqual(attempts[0]['turn'], execution[0]['id'])
        self.finish(stream)
        self.exited('leaf')
        self.assertEqual(self.send('attempts', session='leaf')['attempts'], attempts)

    def test_exhaustion_advances_the_bound_account_and_records_the_next_attempt(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        self.record('omp-main', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-a')
        self.record('omp-next', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-b')
        self.send('bind', id='omp-main', session='leaf')
        first, started = self.accept('leaf')
        cause = "You've hit your session limit. Try again later."
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept('leaf')
        self.assertEqual(resumed['native'], started['native'])
        self.finish(second)
        self.exited('leaf')
        attempts = self.send('attempts', session='leaf')['attempts']
        self.assertEqual([row['account'] for row in attempts], ['omp-main', 'omp-next'], attempts)
        self.assertEqual([row['session'] for row in attempts], ['leaf', 'leaf'])
        self.assertEqual(attempts[1]['secretRef'], '/fixture/stores/omp-b')
        handoff = [row for row in self.rows(
            "SELECT body FROM messages WHERE body LIKE 'account handoff:%'")]
        self.assertEqual(len(handoff), 1, handoff)
        self.assertIn('refused account=omp-main', handoff[0]['body'])
        self.assertIn('bound account=omp-next', handoff[0]['body'])
        self.assertIn(cause, handoff[0]['body'])

    def test_the_last_account_exhaustion_records_the_fact_and_wakes_the_conductor(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        self.record('omp-only', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-only')
        self.send('bind', id='omp-only', session='leaf')
        first, started = self.accept('leaf')
        cause = "You've hit your session limit. Try again later."
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        self.exited('leaf')
        attempts = self.send('attempts', session='leaf')['attempts']
        self.assertEqual([row['account'] for row in attempts], ['omp-only'], attempts)
        exhausted = [row for row in self.rows(
            "SELECT body FROM messages WHERE body LIKE 'accounts exhausted:%'")]
        self.assertEqual(len(exhausted), 1, exhausted)
        self.assertIn('account=omp-only', exhausted[0]['body'])
        self.assertIn('no later selectable operator-recorded account remains', exhausted[0]['body'])
        self.assertIn(cause, exhausted[0]['body'])


    def test_exhaustion_on_one_session_leaves_another_sessions_binding_untouched(self):
        self.root()
        self.recruit('leaf')
        self.recruit('leaf2')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        self.call('message', 'isolated-task', 'root', 'leaf2', 'task', self.task.read_text())
        self.record('omp-main', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-a')
        self.record('omp-next', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-b')
        self.record('omp-two', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-c')
        self.send('bind', id='omp-main', session='leaf')
        self.send('bind', id='omp-two', session='leaf2')
        first, started = self.accept('leaf')
        cause = "You've hit your session limit. Try again later."
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept('leaf')
        self.assertEqual(resumed['native'], started['native'])
        self.finish(second)
        self.exited('leaf')
        self.assertEqual([row['account'] for row in self.send('attempts', session='leaf')['attempts']],
                         ['omp-main', 'omp-next'])
        third, started2 = self.accept('leaf2')
        self.finish(third)
        self.exited('leaf2')
        self.assertEqual([row['account'] for row in self.send('attempts', session='leaf2')['attempts']],
                         ['omp-two'])
        self.assertEqual(self.rows("SELECT account FROM account_attempts WHERE session='leaf2'"),
                         [('omp-two',)])


    def test_exhaustion_delivers_owed_input_to_the_continuation_without_guidance(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        owed = 'Second retained task: finish the λ review before the handoff report.'
        self.record('omp-main', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-a')
        self.record('omp-next', 'anthropic', 'omp', 'subscription', '/fixture/stores/omp-b')
        self.send('bind', id='omp-main', session='leaf')
        first, started = self.accept('leaf')
        self.assertIn(self.task.read_text(), started['prompt'])
        self.call('message', 'owed-task', 'root', 'leaf', 'task', owed)
        cause = "You've hit your session limit. Try again later."
        self.action(first, fail=True, ack=False, fail_message=cause)
        self.action(first, exit_fixture=True)
        second, resumed = self.accept('leaf')
        self.assertEqual(resumed['native'], started['native'])
        self.assertIn(owed, resumed['prompt'])
        self.assertNotIn(self.task.read_text(), resumed['prompt'])
        guidance = [row for row in self.rows(
            "SELECT body FROM messages WHERE recipient='leaf' AND kind='guidance'")]
        self.assertEqual(guidance, [], guidance)
        handoff = [row for row in self.rows(
            "SELECT body FROM messages WHERE body LIKE 'account handoff:%'")]
        self.assertEqual(len(handoff), 1, handoff)
        owed_rows = self.rows(
            "SELECT EXISTS(SELECT 1 FROM message_reads r WHERE r.message=messages.id "
            "AND r.recipient=messages.recipient) AS acknowledged FROM messages "
            "WHERE recipient='leaf' AND kind='task' AND body LIKE '%λ review%'")
        self.assertEqual([row['acknowledged'] for row in owed_rows], [1])
        self.finish(second)
        self.exited('leaf')
        self.assertEqual([row['account'] for row in self.send('attempts', session='leaf')['attempts']],
                         ['omp-main', 'omp-next'])


if __name__ == '__main__':
    unittest.main()
