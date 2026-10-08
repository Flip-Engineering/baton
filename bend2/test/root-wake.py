"""Integration tests for committed-report completion and the late-message wake race.

A committed report invokes its recipient's recorded endpoint, and each harness this
runtime supports starts a turn from that endpoint: Codex and OMP through the native
receive operation, Muse through the same operation with its task in a prompt file.
These tests drive the real coordinator over one database holding all three harnesses,
with a controlled fixture that speaks each adapter's protocol. They cover the
parentless principal root addressed through the operator-role rule, the three-hop
report chain, and the case where input committed while a turn is live is consumed by
a later turn exactly once.
"""
import importlib.util
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

spec = importlib.util.spec_from_file_location('receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)

# The fixture serves whichever adapter started it: Codex, OMP and Muse each name the
# harness with a distinct argv shape. Every turn records its own invocation, accepts
# the delivered input through the coordinator CLI, publishes the identity frames its
# adapter records, and holds its terminal event until the test releases that turn, so
# the test controls when the completion path runs.
FIXTURE = '''#!__PYTHON__
import json,os,pathlib,re,subprocess,sys,time
EXE=__EXE__
DB=__DB__
CALLS=pathlib.Path(__CALLS__)
RELEASES=pathlib.Path(__RELEASES__)
args=sys.argv[1:]
session=args[args.index('--model')+1]
omp='--mode' in args
muse='--prompt-file' in args
claude='--input-format' in args
frame=''
if muse:
    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
    resume=args[args.index('--session-id')+1] if '--session-id' in args else ''
elif claude:
    frame=sys.stdin.readline()
    prompt=json.loads(frame)['message']['content']
    resume=args[args.index('--resume')+1] if '--resume' in args else ''
elif omp:
    json.loads(sys.stdin.readline())
    state=json.loads(sys.stdin.readline())
    prompt=json.loads(sys.stdin.readline())['message']
    resume=args[args.index('--resume')+1] if '--resume' in args else ''
else:
    prompt=sys.stdin.read()
    resume=args[args.index('resume')+1] if 'resume' in args else ''
native=resume or ('native-'+session)
record=pathlib.Path(CALLS,session+'.jsonl')
with record.open('a') as output:
    output.write(json.dumps({'pid':os.getpid(),'args':args,'cwd':os.getcwd(),'prompt':prompt,
                             'native':native,'resume':resume,'frame':frame})+chr(10))
turn=len([line for line in record.read_text().splitlines() if line.strip()])
for ident in re.findall(r'\\[id: (.*?)\\]:',prompt):
    accepted=subprocess.run([EXE,DB,'ack',ident,session,'fixture reviewed'],capture_output=True,text=True)
    assert accepted.returncode==0, accepted.stderr
if omp:
    print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],
                      'data':{'sessionId':native,'model':{'provider':'fixture','id':session}}}),flush=True)
elif muse:
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user',
                      'payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}),flush=True)
elif claude:
    print(json.dumps({'type':'system','subtype':'init','session_id':native,'model':session}),flush=True)
else:
    print(json.dumps({'type':'thread.started','thread_id':native}),flush=True)
while not pathlib.Path(RELEASES,session+'.'+str(turn)+'.release').exists():
    time.sleep(0.05)
body='Fixture turn '+str(turn)+' for '+session+' completed.'
if omp:
    print(json.dumps({'type':'agent_end','isTerminal':True,
                      'messages':[{'role':'assistant','content':[{'type':'text','text':body}]}]}),flush=True)
    sys.stdin.read()
elif muse:
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.completed',
                      'payload':{'kind':'run_terminal','terminal':'completed',
                                 'command_id':'fixture-primary','text':body}}),flush=True)
elif claude:
    print(json.dumps({'type':'result','session_id':native,'result':body,'is_error':False}),flush=True)
else:
    print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':body}}),flush=True)
    print(json.dumps({'type':'turn.completed'}),flush=True)
'''


class RootWake(unittest.TestCase):
    """Delivery wake for a Codex principal root and for Muse and OMP sessions."""

    close_children = receive.Receive.close_children
    owned_processes = receive.Receive.owned_processes

    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.directory = pathlib.Path(self.temp.name)
        self.children = []
        self.controls = []
        self.home = self.directory / 'isolated-home'
        self.home.mkdir()
        self.environment = dict(os.environ, HOME=str(self.home))
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Root wake fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True,
                           env=self.environment)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True,
                       capture_output=True, env=self.environment)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'], check=True,
                       capture_output=True, env=self.environment)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'], check=True,
                                   capture_output=True, text=True,
                                   env=self.environment).stdout.strip()
        self.db = self.directory / 'state.db'
        self.calls_directory = self.directory / 'calls'
        self.calls_directory.mkdir()
        self.releases = self.directory / 'releases'
        self.releases.mkdir()
        self.fixture = self.directory / 'native fixture'
        self.fixture.write_text(FIXTURE
                                .replace('__PYTHON__', sys.executable)
                                .replace('__EXE__', repr(str(EXE)))
                                .replace('__DB__', repr(str(self.db)))
                                .replace('__CALLS__', repr(str(self.calls_directory)))
                                .replace('__RELEASES__', repr(str(self.releases))))
        self.fixture.chmod(0o700)
        self.root_log = self.directory / 'root.jsonl'
        self.task = self.write('start-task.txt', 'Start the principal.\n')
        self.report_body = self.write('report.txt', 'Report body for the root.\n')
        self.question_body = self.write('question.txt', 'Question for the root.\n')
        self.child_task = self.write('child-task.txt', 'Task for the OMP child.\n')
        self.late_lead = self.write('late-lead.txt', 'Late guidance for the Muse lead.\n')
        self.late_root = self.write('late-root.txt', 'Late report for the Codex root.\n')
        self.leaf_task = self.write('leaf-task.txt', 'Task for the Claude player.\n')
        self.leaf_followup = self.write('leaf-followup.txt', 'Follow-up for the Claude player.\n')

    def tearDown(self):
        self.close_children()
        self.temp.cleanup()

    def write(self, name, text):
        path = self.directory / name
        path.write_text(text)
        return path

    def coord(self, *args, ok=True):
        child = subprocess.run([str(EXE), str(self.db), *map(str, args)], env=self.environment,
                               text=True, capture_output=True)
        if ok:
            self.assertEqual(child.returncode, 0, child.stderr)
        return child.stdout.strip()

    def coord_raw(self, *args):
        return subprocess.run([str(EXE), str(self.db), *map(str, args)], env=self.environment,
                              text=True, capture_output=True)

    def rows(self, sql):
        with sqlite3.connect(f'file:{self.db}?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute(sql)]

    def calls(self, session):
        path = self.calls_directory / f'{session}.jsonl'
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]

    def prompt_ids(self, call):
        return re.findall(r'\[id: (.*?)\]:', call['prompt'])

    def release(self, session, turn):
        (self.releases / f'{session}.{turn}.release').write_text('go\n')

    def eventually(self, observation, description):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(0.05)

    def dispatch(self, *args):
        result = json.loads(self.coord(*args))
        self.assertEqual(result['state'], 'launched')
        self.assertGreater(result['deliveryPid'], 0)
        return result

    def recruit(self, session, parent, harness):
        return json.loads(self.coord('recruit', session, parent, harness, session, 'low', str(self.repo),
                                     session + '-branch', str(self.checkouts / session), self.base))

    def accepted(self, ident):
        return self.eventually(lambda: json.loads(self.coord('delivery', ident))['receipt'],
                               f'{ident} was never accepted by its recipient')

    def completed(self, session, turn):
        body = f'Fixture turn {turn} for {session} completed.'
        return self.eventually(lambda: any(row['reportBody'] == body
                                           for row in json.loads(self.coord('turns', session))),
                               f'{session} did not retain its completed report')

    def assert_consumed_once_and_by_its_recipient(self, sessions):
        """Every delivered input appeared in exactly one prompt, in its own session."""
        seen = [ident for session in sessions for call in self.calls(session)
                for ident in self.prompt_ids(call)]
        self.assertEqual(len(seen), len(set(seen)), f'an input was consumed twice: {seen}')
        stored = {row['id']: row for row in self.rows('SELECT id,recipient,receipt FROM messages')}
        self.assertEqual(set(seen), {ident for ident, row in stored.items() if row['receipt']})
        for session in sessions:
            own = {ident for call in self.calls(session) for ident in self.prompt_ids(call)}
            self.assertTrue(all(stored[ident]['recipient'] == session for ident in own),
                            f'{session} consumed a row addressed to another session')

    def test_codex_root_endpoint_wakes_the_root_and_routes_to_the_operator(self):
        self.release('root', 1)
        self.dispatch('start', 'root', 'codex', str(self.fixture), 'root', 'low', str(self.repo),
                      str(self.root_log), 'start-task', str(self.task))
        first = self.eventually(lambda: self.calls('root')[:1], 'the principal never started its task turn.')
        self.assertEqual(self.accepted('start-task'), 'fixture reviewed')
        root = json.loads(self.coord('player', 'root'))
        operator = json.loads(self.coord('session', 'operator'))
        self.assertEqual((root['role'], root['parent']), ('principal-conductor', None))
        self.assertEqual(root['workspace'], str(self.repo.resolve()))
        # The operator-role rule: the routed row is parentless and holds the operator role.
        self.assertEqual((operator['parent'], operator['role']), (None, 'operator'))
        # The wake address is the session's recorded endpoint, built from its own command.
        self.assertEqual(json.loads(self.coord('session', 'root'))['endpointArgv'],
                         [str(EXE.resolve()), str(self.db.resolve()), 'receive', 'root',
                          str(self.fixture.resolve()), '', '', '', str(self.root_log.resolve())])
        # The Codex adapter requests the subscription login and removes the API keys.
        self.assertEqual(first[0]['args'][:2], ['-c', 'forced_login_method="chatgpt"'])
        configs = [first[0]['args'][index + 1] for index, arg in enumerate(first[0]['args'])
                   if arg == '-c']
        self.assertEqual(configs, ['forced_login_method="chatgpt"', 'model_reasoning_effort="low"'])
        self.assertEqual(first[0]['args'][first[0]['args'].index('--model') + 1], 'root')
        self.assertEqual(first[0]['native'], 'native-root')

        # A child's report and question each start a turn in the idle root through
        # the recorded endpoint, resuming the thread the first turn recorded.
        self.recruit('child', 'root', 'omp')
        self.release('root', 2)
        self.release('root', 3)
        self.dispatch('dispatch-file', 'child-report', 'child', 'root', 'report', str(self.report_body))
        second = self.eventually(lambda: self.calls('root')[1:2], 'the report never woke the root.')
        self.dispatch('dispatch-file', 'child-question', 'child', 'root', 'question',
                      str(self.question_body))
        third = self.eventually(lambda: self.calls('root')[2:3], 'the question never woke the root.')
        self.eventually(lambda: len(self.calls('root')) == 3, 'the root started a fourth turn.')
        self.assertEqual(len(self.calls('root')), 3)
        for call in (second[0], third[0]):
            self.assertEqual(call['args'][call['args'].index('resume') + 1], 'native-root')
        self.assertIn('Report body for the root.', second[0]['prompt'])
        self.assertNotIn('Question for the root.', second[0]['prompt'])
        self.assertIn('Question for the root.', third[0]['prompt'])
        for ident, kind in (('child-report', 'report'), ('child-question', 'question')):
            self.assertEqual(self.accepted(ident), 'fixture reviewed')
            saved = json.loads(self.coord('delivery', ident))
            self.assertEqual((saved['sender'], saved['recipient'], saved['kind']),
                             ('child', 'root', kind))
        self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-root')

        # Each principal terminal result reaches the operator row.
        self.completed('root', 3)
        inbox = json.loads(self.coord('inbox', 'operator'))
        self.assertEqual({row['sender'] for row in inbox}, {'root'})
        self.assertEqual(len(inbox), len(json.loads(self.coord('turns', 'root'))))
        self.assert_consumed_once_and_by_its_recipient(['root'])

    def test_muse_and_omp_reports_chain_to_the_codex_root_on_one_database(self):
        self.release('root', 1)
        self.dispatch('start', 'root', 'codex', str(self.fixture), 'root', 'low', str(self.repo),
                      str(self.root_log), 'start-task', str(self.task))
        self.eventually(lambda: self.calls('root')[:1], 'the principal never started its task turn.')
        self.assertEqual(self.accepted('start-task'), 'fixture reviewed')
        self.recruit('lead', 'root', 'muse')
        self.coord('role', 'lead', 'associate-conductor')
        self.coord('receiver', 'lead', str(self.fixture), str(self.directory / 'lead.jsonl'))
        self.recruit('child', 'lead', 'omp')
        self.coord('receiver', 'child', str(self.fixture), str(self.directory / 'child.jsonl'))

        # The OMP child's completed turn reports to its Muse parent, which starts a turn.
        self.release('child', 1)
        self.dispatch('dispatch-file', 'child-task', 'lead', 'child', 'task', str(self.child_task))
        child_turn = self.eventually(lambda: self.calls('child')[:1], 'the OMP child never started.')
        self.eventually(lambda: self.calls('lead')[:1], 'the child report never woke the Muse lead.')
        self.assertEqual(len(self.calls('child')), 1)
        self.assertIn('Task for the OMP child.', child_turn[0]['prompt'])
        self.assertEqual(child_turn[0]['cwd'], str(self.checkouts / 'child'))

        # Input committed while the lead's turn is live waits for the session owner.
        self.dispatch('dispatch-file', 'late-lead', 'root', 'lead', 'guidance', str(self.late_lead))
        self.assertEqual(len(self.calls('lead')), 1)
        self.assertIsNone(json.loads(self.coord('delivery', 'late-lead'))['receipt'])
        self.release('lead', 1)

        # The lead's completion report starts the Codex root's second turn, and the
        # lead's own drain starts a second Muse turn that continues the conversation.
        self.eventually(lambda: self.calls('root')[1:2], 'the lead report never woke the Codex root.')
        drained = self.eventually(lambda: self.calls('lead')[1:2], 'the queued lead input was never drained.')
        self.assertEqual(drained[0]['args'][drained[0]['args'].index('--session-id') + 1], 'native-lead')
        self.assertIn('Late guidance for the Muse lead.', drained[0]['prompt'])
        self.assertNotIn('Task for the OMP child.', drained[0]['prompt'])

        # A report committed while the root's turn is live waits for the root.
        self.dispatch('dispatch-file', 'late-root', 'lead', 'root', 'report', str(self.late_root))
        self.assertEqual(len(self.calls('root')), 2)
        self.assertIsNone(json.loads(self.coord('delivery', 'late-root'))['receipt'])
        self.release('lead', 2)

        # The lead's second completion reaches the live root, and the root's own drain
        # then consumes that report and the late input in one turn.
        self.eventually(lambda: len(self.calls('lead')) == 2, 'the lead started a third turn.')
        self.release('root', 2)
        root_drain = self.eventually(lambda: self.calls('root')[2:3], 'the root never drained its late input.')
        self.assertIn('Late report for the Codex root.', root_drain[0]['prompt'])
        self.assertIn('Fixture turn 2 for lead completed.', root_drain[0]['prompt'])
        self.assertNotIn('Start the principal.', root_drain[0]['prompt'])
        self.release('root', 3)
        self.completed('root', 3)

        self.eventually(lambda: len(self.calls('root')) == 3, 'the root started a fourth turn.')
        self.assertEqual([len(self.calls(session)) for session in ('root', 'lead', 'child')], [3, 2, 1])
        self.assertEqual([len(json.loads(self.coord('turns', session)))
                          for session in ('root', 'lead', 'child')], [3, 2, 1])
        # Each turn after the first resumed the identity its own session recorded.
        self.assertEqual([call['resume'] for call in self.calls('root')[1:]], ['native-root'] * 2)
        self.assertEqual(self.calls('lead')[1]['resume'], 'native-lead')
        for session in ('root', 'lead', 'child'):
            self.assertEqual(json.loads(self.coord('player', session))['native'], f'native-{session}')
        # Every hop reached its own recipient, and each input was consumed once.
        self.assertEqual(json.loads(self.coord('delivery', 'child-task'))['recipient'], 'child')
        self.assertEqual(self.accepted('late-lead'), 'fixture reviewed')
        self.assertEqual(self.accepted('late-root'), 'fixture reviewed')
        self.assertEqual({row['recipient'] for row in self.rows("SELECT recipient FROM messages WHERE sender='lead'")},
                         {'root', 'child'})
        inbox = json.loads(self.coord('inbox', 'operator'))
        self.assertEqual({row['sender'] for row in inbox}, {'root'})
        self.assertEqual(len(inbox), 3)
        self.assert_consumed_once_and_by_its_recipient(['root', 'lead', 'child'])

    def test_receiver_requires_a_model_and_directory_and_records_the_supplied_directory(self):
        # An existing Codex session is registered for wake by recording the model,
        # effort and working directory its turns need, or by passing the directory.
        self.coord('attach', 'root', 'codex', 'native-attached', '')
        self.coord('role', 'root', 'principal-conductor')
        self.recruit('child', 'root', 'omp')
        refused = self.coord_raw('receiver', 'root', str(self.fixture), str(self.root_log))
        self.assertEqual(refused.returncode, 2)
        self.assertIn('receiver-refused', refused.stderr)
        self.assertIn('recorded model', refused.stderr)
        self.assertIn('start SESSION HARNESS', refused.stderr)
        self.assertIsNone(json.loads(self.coord('session', 'root'))['endpointArgv'])

        # start records the model, effort, working directory and endpoint for the
        # existing session, preserves its native conversation and starts a turn.
        self.release('root', 1)
        self.dispatch('start', 'root', 'codex', str(self.fixture), 'root', 'low', str(self.repo),
                      str(self.root_log), 'start-task', str(self.task))
        first = self.eventually(lambda: self.calls('root')[:1], 'the registered root never started a turn.')
        self.assertEqual(self.accepted('start-task'), 'fixture reviewed')
        binding = first[0]['args']
        self.assertEqual(binding[binding.index('resume') + 1], 'native-attached')
        self.assertEqual(first[0]['cwd'], str(self.repo.resolve()))
        self.assertEqual(json.loads(self.coord('session', 'root'))['endpointArgv'],
                         [str(EXE.resolve()), str(self.db.resolve()), 'receive', 'root',
                          str(self.fixture.resolve()), '', '', '', str(self.root_log.resolve())])

        # A supplied working directory is recorded by receiver, and the next wake
        # starts the turn in it.
        directory = self.checkouts / 'child'
        configured = json.loads(self.coord('receiver', 'root', str(self.fixture), str(self.root_log),
                                          str(directory)))
        self.assertEqual(configured['workspace'], str(directory.resolve()))
        self.release('root', 2)
        self.dispatch('dispatch-file', 'child-report', 'child', 'root', 'report', str(self.report_body))
        second = self.eventually(lambda: self.calls('root')[1:2], 'the report never woke the registered root.')
        self.assertEqual(second[0]['cwd'], str(directory.resolve()))
        self.assertIn('Report body for the root.', second[0]['prompt'])
        self.assertEqual(self.accepted('child-report'), 'fixture reviewed')
        self.assertEqual(json.loads(self.coord('player', 'root'))['native'], 'native-attached')
        self.assert_consumed_once_and_by_its_recipient(['root', 'child'])

    def test_a_claude_player_wakes_through_the_same_receive_endpoint(self):
        # A Claude Player's recorded endpoint starts its turn with the pending input
        # as one user frame and resumes the conversation the first turn recorded.
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')
        self.recruit('leaf', 'root', 'claude-code')
        self.coord('receiver', 'leaf', str(self.fixture), str(self.directory / 'leaf.jsonl'))
        self.release('leaf', 1)
        self.release('leaf', 2)
        self.dispatch('dispatch-file', 'leaf-task', 'root', 'leaf', 'task', str(self.leaf_task))
        first = self.eventually(lambda: self.calls('leaf')[:1], 'the Claude player never started a turn.')
        self.assertEqual(first[0]['cwd'], str(self.checkouts / 'leaf'))
        self.assertEqual(first[0]['args'][first[0]['args'].index('--model') + 1], 'leaf')
        self.assertNotIn('--resume', first[0]['args'])
        frame = json.loads(first[0]['frame'])
        self.assertEqual(frame['message']['role'], 'user')
        self.assertIn('Task for the Claude player.', frame['message']['content'])
        self.assertIn('[id: leaf-task]', frame['message']['content'])

        self.dispatch('dispatch-file', 'leaf-followup', 'root', 'leaf', 'guidance', str(self.leaf_followup))
        second = self.eventually(lambda: self.calls('leaf')[1:2], 'the follow-up never woke the leaf.')
        self.assertEqual(second[0]['args'][second[0]['args'].index('--resume') + 1], 'native-leaf')
        self.assertIn('Follow-up for the Claude player.', json.loads(second[0]['frame'])['message']['content'])
        self.completed('leaf', 2)
        self.eventually(lambda: len(self.calls('leaf')) == 2, 'the leaf started a third turn.')
        self.assertEqual([len(self.calls('leaf')), len(json.loads(self.coord('turns', 'leaf')))], [2, 2])
        self.assertEqual(json.loads(self.coord('player', 'leaf'))['native'], 'native-leaf')
        self.assertEqual({row['recipient'] for row in self.rows("SELECT recipient FROM messages WHERE sender='leaf'")},
                         {'root'})
        self.assertEqual(self.accepted('leaf-task'), 'fixture reviewed')
        self.assert_consumed_once_and_by_its_recipient(['leaf'])

    def test_a_parentless_conductor_without_the_operator_role_reaches_no_inbox(self):
        self.release('root', 1)
        self.release('root', 2)
        self.dispatch('start', 'root', 'codex', str(self.fixture), 'root', 'low', str(self.repo),
                      str(self.root_log), 'start-task', str(self.task))
        self.assertEqual(self.accepted('start-task'), 'fixture reviewed')
        self.completed('root', 1)
        before = (len(json.loads(self.coord('turns', 'root'))), len(json.loads(self.coord('inbox', 'operator'))))
        self.assertEqual(before, (1, 1))
        # Withdrawing the operator role from the parentless row removes the routing.
        self.coord('role', 'operator', 'player')
        self.recruit('child', 'root', 'omp')
        self.dispatch('dispatch-file', 'after-role-change', 'child', 'root', 'report', str(self.report_body))
        self.assertEqual(self.accepted('after-role-change'), 'fixture reviewed')
        self.eventually(lambda: len(self.calls('root')) == 2, 'the root did not start a second turn.')
        after = (len(json.loads(self.coord('turns', 'root'))), len(json.loads(self.coord('inbox', 'operator'))))
        self.assertEqual(after, before)


if __name__ == '__main__':
    unittest.main()
