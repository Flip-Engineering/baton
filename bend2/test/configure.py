"""A configured provider-route change keeps an existing Player's assignment, work and pending input."""
import importlib.util
import json
import pathlib
import sqlite3
import unittest
from contextlib import closing

ROOT = pathlib.Path(__file__).resolve().parents[2]


def load(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'),
                                                  pathlib.Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


identity = load('control-identity')


class Configure(unittest.TestCase):
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
    process_rows = identity.ControlIdentity.process_rows
    exited = identity.ControlIdentity.exited
    close_fixtures = identity.ControlIdentity.close_fixtures

    def setUp(self):
        identity.ControlIdentity.setUp(self)
        # The fixture resolves the session it serves from the model it was launched with, so
        # both routes this file configures name the same Player.
        config = self.directory / 'fixture.json'
        settings = json.loads(config.read_text())
        settings['sessions'] = {'kimi-code/k3': 'leaf', 'gpt-6-astra': 'leaf'}
        config.write_text(json.dumps(settings))

    def recruit(self, session, harness='omp', model='kimi-code/k3', effort='low'):
        return self.call('recruit', session, 'root', harness, model, effort, self.repo,
                         session + '-branch', self.checkouts / session, self.base)

    def receiver_endpoint(self, session, model, log):
        return ['node', str(self.helper.resolve()), 'launch', '--registry', str(self.registry.resolve()),
                '--model-key', model, '--', str(self.binary.resolve()), str(self.db.resolve()),
                'receive', session, str(self.fixture.resolve()), '', '', '', str(log.resolve())]

    def route(self, session, harness, model, effort, expected, log=None, ok=True):
        log = log if log is not None else self.directory / (session + '-configure.jsonl')
        return self.call('configure', session, harness, model, effort, self.fixture, log,
                         *expected, ok=ok)

    def assignment(self, session):
        row = self.call('session', session)
        return {key: row[key] for key in ('id', 'parent', 'harness', 'model', 'effort', 'native',
                                          'endpoint', 'endpointArgv', 'workspace', 'branch', 'base')}

    def messages(self):
        with closing(sqlite3.connect(self.db)) as db:
            return db.execute('SELECT id, sender, recipient, kind, body, receipt '
                              'FROM messages ORDER BY seq').fetchall()

    def test_route_change_rebuilds_the_endpoint_and_preserves_the_assignment(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        log = self.directory / 'leaf.jsonl'
        configured = self.call('receiver', 'leaf', self.fixture, log)
        self.assertEqual(configured['endpoint'], self.receiver_endpoint('leaf', 'kimi-code/k3', log))
        before = self.assignment('leaf')
        inbox = self.call('inbox', 'leaf')
        messages = self.messages()
        changed = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'low'), log=log)
        self.assertEqual((changed['harness'], changed['model'], changed['effort']),
                         ('omp', 'gpt-6-astra', 'high'))
        self.assertEqual(changed['endpointArgv'], self.receiver_endpoint('leaf', 'gpt-6-astra', log))
        self.assertIn('gpt-6-astra', changed['endpoint'])
        self.assertNotIn('kimi-code/k3', changed['endpoint'])
        for field in ('id', 'parent', 'native', 'workspace', 'branch', 'base'):
            self.assertEqual(changed[field], before[field], field)
        self.assertEqual(self.call('inbox', 'leaf'), inbox)
        self.assertEqual(self.messages(), messages)
        self.assertEqual(self.rows("SELECT * FROM executions WHERE session='leaf'"), [])
        self.assertEqual(self.call('delivery', 'retained-task')['body'], self.task.read_text())

    def test_route_change_fences_a_delayed_expected_route_and_leaves_the_row_alone(self):
        self.root()
        self.recruit('leaf')
        before = self.assignment('leaf')
        messages = self.messages()
        refused = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'max'), ok=False)
        self.assertEqual(refused['code'], 2)
        self.assertIn('configure-refused', refused['stderr'])
        self.assertEqual(self.assignment('leaf'), before)
        self.assertEqual(self.messages(), messages)
        changed = self.route('leaf', 'omp', 'gpt-6-astra', 'high', ('omp', 'kimi-code/k3', 'low'))
        self.assertEqual(changed['model'], 'gpt-6-astra')
        moved = self.assignment('leaf')
        delayed = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(delayed['code'], 2)
        self.assertIn('configure-refused', delayed['stderr'])
        self.assertEqual(self.assignment('leaf'), moved)

    def test_route_change_refuses_an_owned_attempt_a_stop_and_a_missing_session(self):
        self.root()
        self.recruit('leaf')
        before = self.assignment('leaf')
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("INSERT INTO executions(session,id,mode,directory,phase,status) "
                       "VALUES('leaf','attempt-1','retained','','running','')")
            db.commit()
        active = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                            ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(active['code'], 2)
        self.assertIn('configure-refused', active['stderr'])
        self.assertEqual(self.assignment('leaf'), before)
        with closing(sqlite3.connect(self.db)) as db:
            db.execute("DELETE FROM executions WHERE session='leaf'")
            db.commit()
        self.call('stop', 'leaf', 'idle-stop', 'Controlled idle stop.')
        stopped = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(stopped['code'], 2)
        self.assertIn('configure-refused', stopped['stderr'])
        self.assertEqual(self.assignment('leaf'), before)
        missing = self.route('missing', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(missing['code'], 2)
        self.assertIn('not registered', missing['stderr'])

    def test_route_change_refuses_an_unmapped_model_an_unsupported_harness_and_an_empty_model(self):
        self.root()
        self.recruit('leaf')
        before = self.assignment('leaf')
        unmapped = self.route('leaf', 'omp', 'zai/glm-5.3-flash', 'high',
                              ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(unmapped['code'], 2)
        self.assertIn('does not resolve the recorded model zai/glm-5.3-flash', unmapped['stderr'])
        self.assertEqual(self.assignment('leaf'), before)
        unsupported = self.route('leaf', 'minimax', 'gpt-6-astra', 'high',
                                 ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(unsupported['code'], 2)
        self.assertIn('configure-refused', unsupported['stderr'])
        self.assertEqual(self.assignment('leaf'), before)
        empty = self.route('leaf', 'omp', '', 'high', ('omp', 'kimi-code/k3', 'low'), ok=False)
        self.assertEqual(empty['code'], 2)
        self.assertIn('does not resolve the recorded model ;', empty['stderr'])
        self.assertEqual(self.assignment('leaf'), before)

    def test_route_change_to_muse_and_claude_keeps_delivery_available(self):
        self.root()
        self.recruit('leaf')
        expected = ('omp', 'kimi-code/k3', 'low')
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                log = self.directory / (harness + '-configured.jsonl')
                changed = self.route('leaf', harness, 'gpt-6-astra', 'high', expected, log=log)
                self.assertEqual((changed['harness'], changed['model'], changed['effort']),
                                 (harness, 'gpt-6-astra', 'high'))
                self.assertEqual(changed['endpointArgv'],
                                 self.receiver_endpoint('leaf', 'gpt-6-astra', log))
                self.assertEqual(changed['parent'], 'root')
                self.assertEqual(changed['branch'], 'leaf-branch')
                message = harness + '-configured-task'
                self.dispatch('dispatch-file', message, 'root', 'leaf', 'task', self.task)
                stream, native = self.accept('leaf')
                self.assertIn('[id: ' + message + ']', native['prompt'])
                self.assertEqual(native['args'][native['args'].index('--model') + 1], 'gpt-6-astra')
                self.finish(stream)
                self.exited('leaf')
                self.assertEqual(self.call('delivery', message)['receipt'], 'fixture-native-reviewed')
                expected = (harness, 'gpt-6-astra', 'high')

    def test_the_configured_route_launches_its_next_receive_with_the_new_model(self):
        self.root()
        self.recruit('leaf')
        self.call('message', 'retained-task', 'root', 'leaf', 'task', self.task.read_text())
        log = self.directory / 'leaf.jsonl'
        self.call('receiver', 'leaf', self.fixture, log)
        changed = self.route('leaf', 'omp', 'gpt-6-astra', 'high',
                             ('omp', 'kimi-code/k3', 'low'), log=log)
        self.assertEqual(changed['model'], 'gpt-6-astra')
        self.dispatch('dispatch-file', 'route-task', 'root', 'leaf', 'task', self.task)
        stream, native = self.accept('leaf')
        self.assertEqual(native['args'][native['args'].index('--model') + 1], 'gpt-6-astra')
        self.assertEqual(native['args'][native['args'].index('--thinking') + 1], 'high')
        self.assertEqual(native['cwd'], changed['workspace'])
        self.assertIn('retained-task', native['prompt'])
        self.assertEqual(self.action(stream, ack=True), {'acknowledged': True})
        body = 'The selected provider executed the retained input.'
        self.finish(stream, body)
        self.exited('leaf')
        self.eventually(lambda: any(row['reportBody'] == body for row in self.call('turns', 'leaf')))
        self.assertEqual(self.call('delivery', 'route-task')['receipt'], 'fixture-native-reviewed')


if __name__ == '__main__':
    unittest.main()
