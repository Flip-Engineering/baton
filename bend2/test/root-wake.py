"""Exercise default report delivery and input committed during a live turn.

The coordinator launches generated receiver delivery asynchronously and returns public
App admission results. Fixtures cover receipt ownership, parent reports and continued
input through recorded receivers and the public managed Codex lifecycle.
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

    def public_proxy(self):
        queued = self.directory / 'queue-arguments.json'
        refused = self.directory / 'queue-refused'
        command = self.directory / 'codex'
        command.write_text('#!' + sys.executable + '\n' + '''
import base64,hashlib,json,pathlib,struct,sys
assert sys.argv[1:]==['app-server','proxy'], sys.argv
def exact(n):
    data=b''
    while len(data)<n:
        part=sys.stdin.buffer.read(n-len(data))
        if not part: raise EOFError('fixture input closed')
        data+=part
    return data
def reply(value):
    payload=json.dumps(value).encode()
    n=len(payload)
    size=bytes([n]) if n<126 else bytes([126])+struct.pack('!H',n) if n<65536 else bytes([127])+struct.pack('!Q',n)
    sys.stdout.buffer.write(bytes([129])+size+payload)
    sys.stdout.buffer.flush()
header=b''
while not header.endswith(b'\\r\\n\\r\\n'):header+=exact(1)
key=next(line.split(b':',1)[1].strip() for line in header.split(b'\\r\\n') if line.lower().startswith(b'sec-websocket-key:'))
accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
sys.stdout.buffer.write(b'HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+accept+b'\\r\\n\\r\\n')
sys.stdout.buffer.flush()
while True:
    a,b=exact(2)
    n=b&127
    if n==126:n=struct.unpack('!H',exact(2))[0]
    elif n==127:n=struct.unpack('!Q',exact(8))[0]
    mask=exact(4) if b&128 else None
    data=exact(n)
    if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
    if a&15==8:break
    request=json.loads(data)
    method=request['method']
    if 'id' not in request:continue
    if method=='initialize':result={}
    elif method=='thread/read':result={'thread':{'id':'native-app-root','status':{'type':'active'}}}
    elif method=='thread/turns/list':result={'data':[{'id':'fixture-turn','status':'inProgress'}],'nextCursor':None}
    elif method=='turn/steer':
        with pathlib.Path(__QUEUED__).open('a') as calls:
            calls.write(json.dumps(request)+chr(10))
        if pathlib.Path(__REFUSED__).exists():
            reply({'id':request['id'],'error':{'code':-32600,'message':'Queue is full (100 queued messages): café Ω 🙂'}})
            continue
        result={'turnId':'fixture-turn'}
    else:raise AssertionError(request)
    reply({'id':request['id'],'result':result})
'''.replace('__QUEUED__', repr(str(queued))).replace('__REFUSED__', repr(str(refused))))
        command.chmod(0o700)
        self.environment['PATH'] = str(self.directory) + os.pathsep + self.environment.get('PATH', '')
        return queued, refused

    def test_endpointless_codex_root_coalesces_owed_input_until_recipient_progress(self):
        queued, _ = self.public_proxy()
        self.coord('attach', 'root', 'codex', '', '')
        self.recruit('child', 'root', 'omp')
        owed = {'app-root-early-' + str(index): 'Earlier child work ' + str(index)
                for index in range(3)}
        for ident, body in owed.items():
            pending = self.coord_raw('report', ident, 'child', body)
            self.assertNotEqual(pending.returncode, 0)
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])
        self.assertFalse(queued.exists())
        self.coord('connect', 'root', 'native-app-root', '')
        owed['app-root-report'] = 'Read the completed child work.'
        self.coord('report', 'app-root-report', 'child', 'Read the completed child work.')
        additions = [('app-root-more-' + str(index), 'Additional child work ' + str(index))
                     for index in range(2)]
        children = [subprocess.Popen([str(EXE), str(self.db), 'report', ident, 'child', body],
                                    env=self.environment, text=True, stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE)
                    for ident, body in additions]
        results = [(child, *child.communicate()) for child in children]
        for child, stdout, stderr in results:
            self.assertEqual(child.returncode, 0, stderr)
        owed.update(additions)
        delivery_log = pathlib.Path(str(self.db) + '.root.log')
        self.eventually(lambda: delivery_log.exists() and 'codexInboxAdmission' in delivery_log.read_text(),
                        'the public input admission result was not retained')
        self.eventually(lambda: not any('--dispatch-message' in process['command']
                                        for process in self.owned_processes()),
                        'the public delivery process did not finish')
        calls = [json.loads(line) for line in queued.read_text().splitlines()]
        self.assertEqual(len(calls), 1, calls)
        request = calls[0]
        self.assertEqual(request['method'], 'turn/steer')
        self.assertEqual(request['params']['threadId'], 'native-app-root')
        self.assertEqual(request['params']['expectedTurnId'], 'fixture-turn')
        text = request['params']['input'][0]['text']
        pointer = json.loads(text.splitlines()[1])
        self.assertEqual(pointer, {'database': str(self.db), 'message': 'app-root-report',
                                   'recipient': 'root', 'pendingCount': 4})
        self.assertIn('Read all owed input with baton2 DATABASE inbox RECIPIENT', text)
        inbox = {message['id']: message for message in json.loads(self.coord('inbox', 'root'))}
        self.assertEqual(set(inbox), set(owed))
        for ident, body in owed.items():
            self.assertEqual(inbox[ident]['body'], body)
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])
        self.assertEqual(json.loads(self.coord('turns', 'root')), [])
        root = json.loads(self.coord('session', 'root'))
        self.assertEqual((root['native'], root['endpoint']), ('native-app-root', ''))

        accepted = next(iter(owed))
        self.coord('ack', accepted, 'root', 'root reviewed this input')
        self.coord('report', 'app-root-after-progress', 'child', 'Continue after root progress.')
        calls = [json.loads(line) for line in queued.read_text().splitlines()]
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(json.loads(calls[1]['params']['input'][0]['text'].splitlines()[1])['pendingCount'], len(owed))
        self.assertEqual(json.loads(self.coord('delivery', accepted))['receipt'],
                         'root reviewed this input')
        for ident in set(owed) - {accepted}:
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])

    def test_refused_codex_input_preserves_pending_input_and_failure(self):
        queued, refused_queue = self.public_proxy()
        refused_queue.write_text('The public daemon queue is full.\n')
        self.coord('attach', 'root', 'codex', 'native-app-root', '')
        self.recruit('child', 'root', 'omp')
        refused = subprocess.run([str(EXE), str(self.db), 'report', 'refused-app-input',
                                  'child', 'This report remains owed.'],
                                 env=self.environment, text=True, capture_output=True)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('Message committed; session delivery failed', refused.stderr)
        retained = json.loads(self.coord('delivery', 'refused-app-input'))
        self.assertEqual(retained['body'], 'This report remains owed.')
        self.assertIsNone(retained['receipt'])
        self.assertEqual(json.loads(self.coord('turns', 'root')), [])
        log = pathlib.Path(str(self.db) + '.root.log').read_text()
        self.assertIn('exit 1', log)
        cause = '{"code":-32600,"message":"Queue is full (100 queued messages): café Ω 🙂"}'
        self.assertIn(cause, log)
        self.assertTrue(any(cause in path.read_text()
                            for path in self.directory.glob('state.db.queue-*.stderr')))

        for index in range(3):
            ident = 'refused-app-more-' + str(index)
            additional = self.coord_raw('report', ident, 'child', 'Further work remains owed.')
            self.assertNotEqual(additional.returncode, 0)
            self.assertIn(cause, additional.stderr)
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])
        calls = [json.loads(line) for line in queued.read_text().splitlines()]
        self.assertEqual(len(calls), 1, calls)
        self.assertIsNone(json.loads(self.coord('delivery', 'refused-app-input'))['receipt'])

        refused_queue.unlink()
        self.coord('resume', 'root')
        calls = [json.loads(line) for line in queued.read_text().splitlines()]
        self.assertEqual(len(calls), 2, calls)
        self.assertEqual(calls[1]['method'], 'turn/steer')
        self.assertEqual(calls[1]['params']['threadId'], 'native-app-root')
        self.assertEqual(json.loads(calls[1]['params']['input'][0]['text'].splitlines()[1])['message'],
                         'refused-app-input')
        self.assertEqual(json.loads(calls[1]['params']['input'][0]['text'].splitlines()[1])['pendingCount'], 4)
        owed = ['refused-app-input'] + ['refused-app-more-' + str(index) for index in range(3)]
        for ident in owed:
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])
        self.coord('resume', 'root')
        self.assertEqual(len(queued.read_text().splitlines()), 2)

        self.coord('ack', 'refused-app-input', 'root', 'root reviewed the retained report')
        self.coord('report', 'retry-after-root-progress', 'child', 'Read the remaining inbox.')
        calls = [json.loads(line) for line in queued.read_text().splitlines()]
        self.assertEqual(len(calls), 3, calls)
        self.assertEqual(json.loads(calls[2]['params']['input'][0]['text'].splitlines()[1])['pendingCount'], 4)
        for ident in ['refused-app-more-' + str(index) for index in range(3)] + ['retry-after-root-progress']:
            self.assertIsNone(json.loads(self.coord('delivery', ident))['receipt'])

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

        # The ordinary sender returns while the controlled recipient turn is running.
        admitted = json.loads(self.coord('message-file', 'child-task', 'lead', 'child',
                                         'task', str(self.child_task)))
        self.assertEqual(admitted['id'], 'child-task')
        child_turn = self.eventually(lambda: self.calls('child')[:1], 'the OMP child never started.')
        self.assertEqual(json.loads(self.coord('player', 'child'))['execution']['phase'], 'running')
        os.kill(child_turn[0]['pid'], 0)
        self.assertFalse((self.releases / 'child.1.release').exists())
        self.assertEqual(json.loads(self.coord('turns', 'child')), [])
        # Releasing that turn delivers its completed report to the Muse parent.
        self.release('child', 1)
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
        self.completed('lead', 2)
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
