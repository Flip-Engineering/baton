"""Native inbox delivery with controlled harness processes and real coordinator state."""
import fcntl
import glob
import json
import os
import pathlib
import select
import shlex
import signal
import socket
import sqlite3
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def _session_lock_path(db, session):
    info = os.stat(db)
    key = 'owner-%x-%x' % (info.st_dev, info.st_ino)
    return os.path.join(os.environ['XDG_RUNTIME_DIR'], 'baton2', key + '.lock-' + session.encode().hex())

FIXTURE = r'''import json,os,pathlib,re,socket,subprocess,sys,time
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'fixture.json').read_text())
args=sys.argv[1:]
if args[:1] in (['parent_endpoint'],['answering_parent']):
    messages=json.loads(subprocess.check_output([config['exe'],config['db'],'inbox','root'],text=True))
    if args[0]=='answering_parent': messages=[message for message in messages if message['id']==args[1]]
    for message in messages:
        if args[0]=='answering_parent' and message['kind']=='question':
            request=json.loads(message['body'])
            result=subprocess.run([config['exe'],config['db'],'native-reply','root',request['requestId'],json.dumps(config['native_answer'])],capture_output=True,text=True)
            with (home/'parent-answers.jsonl').open('a') as answered:
                answered.write(json.dumps({'request':request,'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})+'\n')
            if result.returncode: sys.exit(result.returncode)
            subprocess.run([config['exe'],config['db'],'ack',message['id'],'root','parent-received'],check=True,stdout=subprocess.DEVNULL)
            (home/'parent-awaiting-delivery').write_text(str(os.getpid()))
            while not (home/'parent-report-delivered').exists(): time.sleep(.01)
            (home/'parent-question-complete').write_text('report received\n')
        subprocess.run([config['exe'],config['db'],'ack',message['id'],'root','parent-received'],check=True,stdout=subprocess.DEVNULL)
        if args[0]=='answering_parent' and message['kind']=='report':
            (home/'parent-report-delivered').write_text(json.dumps(message))
        with (home/'parent-deliveries.jsonl').open('a') as delivered:
            delivered.write(json.dumps(message)+'\n')
    print(json.dumps({'received':args[1]}))
    sys.exit(0)
omp='--mode' in args
model=args[args.index('--model')+1]
native_args=args[2:] if args[:2]==['-c','forced_login_method="chatgpt"'] else args
resume=args[args.index('--resume')+1] if '--resume' in args else (native_args[2] if native_args[:2]==['exec','resume'] else '')
if config.get('record_launches'):
    with (home/'native-launches.jsonl').open('a') as launches:
        launches.write(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'resume':resume,'args':args})+'\n')
if omp and resume and resume==config.get('missing_resume'):
    print('Error: Session '+resume+' not found',file=sys.stderr,flush=True)
    sys.exit(1)
if config.get('early_failure'):
    print(config['early_failure'],file=sys.stderr,flush=True)
    sys.exit(1)
native='native-'+model
if omp:
    json.loads(sys.stdin.readline())
    state=json.loads(sys.stdin.readline())
    prompt=json.loads(sys.stdin.readline())['message']
    storage=pathlib.Path(args[args.index('--session-dir')+1])
    storage.mkdir(parents=True,exist_ok=True)
    if resume:
        selected=pathlib.Path(resume) if '/' in resume else storage/('2026-09-28_'+resume+'.jsonl')
        native=json.loads(selected.read_text().splitlines()[0])['id']
    else:
        (storage/('2026-09-28_'+native+'.jsonl')).write_text(json.dumps({'type':'session','id':native})+'\n')
    print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],'data':{'sessionId':native,'model':{'provider':'fixture','id':model}}}),flush=True)
else:
    prompt=sys.stdin.read()
    native=resume or native
    print(json.dumps({'type':'thread.started','thread_id':native}),flush=True)
client=socket.create_connection(('127.0.0.1',config['port']))
stream=client.makefile('rwb',buffering=0)
def reply(value): stream.write((json.dumps(value)+'\n').encode())
def progress(action):
    print(json.dumps({'type':'fixture_progress','marker':action['progress'],'native_pid':os.getpid()}),flush=True)
    reply({'progress_written':action['progress']})
def session_lock_path(db,session):
    info=os.stat(db)
    key='owner-%x-%x'%(info.st_dev,info.st_ino)
    return os.environ['XDG_RUNTIME_DIR']+'/baton2/'+key+'.lock-'+session.encode().hex()
guard_descriptors=None
if config.get('inspect_session_guard'):
    guard=os.stat(session_lock_path(config['db'],model))
    guard_descriptors=[]
    for descriptor in os.listdir('/dev/fd'):
        try: info=os.fstat(int(descriptor))
        except (ValueError,OSError): continue
        if (info.st_dev,info.st_ino)==(guard.st_dev,guard.st_ino): guard_descriptors.append(int(descriptor))
reply({'pid':os.getpid(),'ppid':os.getppid(),'session':model,'native':native,'resume':resume,'args':args,'prompt':prompt,
       'cwd':os.getcwd(),'apiKeyVariablesPresent':[key for key in ('OPENAI_API_KEY','CODEX_API_KEY') if key in os.environ],
       'sessionGuardDescriptors':guard_descriptors})
while True:
    line=stream.readline()
    if not line: break
    action=json.loads(line)
    if action.get('exit_fixture'): break
    if action.get('progress'):
        progress(action)
        continue
    if action.get('append_file'):
        name,text=action['append_file']
        with pathlib.Path(name).open('a') as target: target.write(text)
        reply({'appended':name})
        continue
    if action.get('read_steer'):
        frame=json.loads(sys.stdin.readline())
        assert frame['type']=='steer',frame
        print(json.dumps({'type':'response','command':'steer','success':True,'id':frame['id']}),flush=True)
        reply({'steer_received':frame})
        continue
    if action.get('native_request'):
        print(json.dumps(action['native_request']),flush=True)
        reply({'request_written':action['native_request']})
        continue
    if action.get('read_native_reply'):
        frame=json.loads(sys.stdin.readline())
        assert frame['type']=='extension_ui_response',frame
        print(json.dumps({'type':'fixture_progress','marker':'native continued after reply','reply_id':frame['id']}),flush=True)
        reply({'native_reply':frame})
        continue
    if action.get('turn'):
        task=home/'self-turn-task'
        task.write_text('Synchronous task for the active session.')
        command=[config['exe'],config['db'],'turn',model,action['turn'],sys.argv[0],model,'low',str(home),str(task),str(home/'self-turn.jsonl'),'']
        result=subprocess.run(command,capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('message'):
        ident,recipient,body=action['message']
        result=subprocess.run([config['exe'],config['db'],'message',ident,model,recipient,'guidance',body],capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('promote'):
        result=subprocess.run([config['exe'],config['db'],'promote',*action['promote']],capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('ack',True):
        for ident in re.findall(r'^Message \([^\n]*\) from [^\n]* \[id: (.*?)\]:$',prompt,re.M):
            subprocess.run([config['exe'],config['db'],'ack',ident,model,'native-reviewed'],check=True,stdout=subprocess.DEVNULL)
    failure=action.get('fail',False)
    body=action.get('body','native review complete')
    if omp:
        print(json.dumps({'type':'agent_end','isTerminal':True,'is_error':failure,'messages':[{'role':'assistant','content':[{'type':'text','text':body}]}]}),flush=True)
        remaining_input=sys.stdin.read()
    elif failure:
        print(json.dumps({'type':'turn.failed','error':{'message':'fixture provider failed'}}),flush=True)
    else:
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':body}}),flush=True)
        print(json.dumps({'type':'turn.completed'}),flush=True)
    if action.get('hold_exit'):
        terminal={'terminal_written':True}
        if action.get('report_input'): terminal['input_after_prompt']=remaining_input if omp else ''
        reply(terminal)
        while True:
            line=stream.readline()
            if not line: break
            action=json.loads(line)
            if action.get('native_request'):
                print(json.dumps(action['native_request']),flush=True)
                reply({'request_written':action['native_request']})
                continue
            if action.get('stdout_line'):
                print(action['stdout_line'],flush=True)
                reply({'line_written':action['stdout_line']})
                continue
            if not action.get('progress'): break
            progress(action)
    break
stream.close()
client.close()
'''


class Receive(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix="receive ' paths ", dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.ipc = tempfile.TemporaryDirectory(prefix='baton2-receive-ipc-', dir='/tmp')
        self.addCleanup(self.ipc.cleanup)
        original_runtime = os.environ.get('XDG_RUNTIME_DIR')
        if original_runtime is None:
            self.addCleanup(os.environ.pop, 'XDG_RUNTIME_DIR', None)
        else:
            self.addCleanup(os.environ.__setitem__, 'XDG_RUNTIME_DIR', original_runtime)
        os.environ['XDG_RUNTIME_DIR'] = self.ipc.name
        (pathlib.Path(self.ipc.name) / 'baton2').mkdir(mode=0o700)
        self.original_path = os.environ.get('PATH')
        if self.original_path is None:
            self.addCleanup(os.environ.pop, 'PATH', None)
        else:
            self.addCleanup(os.environ.__setitem__, 'PATH', self.original_path)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Receive fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.db = self.directory / 'state.db'
        self.codex_calls = self.directory / 'codex-calls.jsonl'
        codex = self.directory / 'codex'
        codex.write_text(
            '#!' + sys.executable + '\n'
            + 'import json,pathlib,sys\n'
            + f'with pathlib.Path({str(self.codex_calls)!r}).open("a") as calls:\n'
            + '    calls.write(json.dumps(sys.argv[1:]) + chr(10))\n'
            + 'print("Queued message fixture-submission for thread native-root", flush=True)\n')
        codex.chmod(0o700)
        os.environ['PATH'] = str(self.directory) + os.pathsep + (self.original_path or '')
        self.fixture = self.directory / 'native fixture'
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.fixture.chmod(0o755)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.addCleanup(self.server.close)
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db),
        }))
        self.children = []
        self.controls = []
        self.addCleanup(self.close_children)
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')

    def close_children(self):
        for stream, connection in self.controls:
            try:
                stream.write(b'{"exit_fixture":true}\n')
            except (OSError, ValueError):
                pass
            try:
                stream.close()
            except OSError:
                pass
            connection.close()
        # A killed observer leaves its keeper and recovery outside Popen's tree.
        # Stop this fixture's processes together so cleanup cannot spawn recovery.
        while True:
            owned = self.owned_processes()
            if not owned:
                break
            for action in (signal.SIGSTOP, signal.SIGKILL):
                for process in owned:
                    try:
                        os.kill(process['pid'], action)
                    except ProcessLookupError:
                        pass
            time.sleep(.01)
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            child.communicate()

    def owned_processes(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                capture_output=True, text=True, check=True)
        found = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and str(self.directory) in fields[3] and not fields[2].startswith('Z'):
                found.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                              'status': fields[2], 'command': fields[3]})
        return found

    def eventually(self, observation, description):
        while True:
            result = observation()
            if result:
                return result
            time.sleep(.01)

    def shutdown_idle_database_owner(self, description):
        expected = f'{EXE.resolve()} --instance-owner {self.db.resolve()}'
        def idle_processes():
            processes = self.owned_processes()
            if not processes or [process['command'] for process in processes] == [expected]:
                return (processes,)
            return None
        processes, = self.eventually(idle_processes, description)
        if processes:
            stopped = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                     capture_output=True, text=True)
            self.assertEqual(stopped.returncode, 0, stopped.stderr)
            self.eventually(lambda: not self.owned_processes(), description)

    def coord(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        return result

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), str(self.db), *map(str, args)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def player(self, name='parent', harness='codex'):
        """Recruit the session into a fixture repository of this run."""
        return self.coord('recruit', name, 'root', harness, name, 'low', str(self.repo),
                          name + '-branch', str(self.checkouts / name), self.base)

    def receive_args(self, session, executable=None):
        return ['receive', session, str(executable or self.fixture), session, 'low',
                str(self.directory), str(self.directory / (session + '.jsonl')), '']

    def output_log(self, session):
        """Return the path registered for the session's current receive attempt."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute(
                "SELECT g.log FROM log_generations g WHERE g.session=? "
                "ORDER BY CASE WHEN g.attempt=(SELECT id FROM executions WHERE session=g.session) "
                "THEN 0 ELSE 1 END, g.rowid DESC LIMIT 1", (session,)).fetchone()
        if row is None:
            self.fail(f'{session} has no registered output log generation')
        return pathlib.Path(row[0])

    def endpoint(self, session):
        return json.dumps([str(EXE), str(self.db), *self.receive_args(session)[:-1]])

    def connect(self, session):
        native = self.coord('player', session)['native']
        self.coord('connect', session, native, self.endpoint(session))

    def prepare_input(self, ident, recipient, body='Review this input.', kind='guidance'):
        sender = 'operator' if recipient == 'root' else 'root'
        result = self.coord('message', ident, sender, recipient, kind, body, ok=False)
        if result.returncode == 0:
            return json.loads(result.stdout)
        self.assertEqual(result.returncode, 2, result.stderr)
        self.assertIn('records no native session identity', result.stderr)
        delivery = self.coord('delivery', ident)
        self.assertEqual((delivery['id'], delivery['sender'], delivery['recipient'],
                          delivery['kind'], delivery['body'], delivery['receipt']),
                         (ident, sender, recipient, kind, body, None))
        self.assertIn(ident, [row['id'] for row in self.coord('inbox', recipient)])
        return delivery

    def message(self, ident, recipient, body='Review this input.'):
        return self.coord('message', ident, 'operator' if recipient == 'root' else 'root',
                          recipient, 'guidance', body)

    def accept_any(self):
        connection, _ = self.server.accept()
        stream = connection.makefile('rwb', buffering=0)
        self.controls.append((stream, connection))
        started = json.loads(stream.readline())
        return stream, started

    def accept(self, session):
        stream, started = self.accept_any()
        self.assertEqual(started['session'], session)
        return stream, started

    def accept_child(self, child, session, description=None, failure_stream=None):
        description = description or f'{session} native did not connect'
        stream, started = self.accept_or_child_exit(child, description, failure_stream)
        self.assertEqual(started['session'], session)
        return stream, started

    def accept_or_child_exit(self, child, description, failure_stream=None):
        stream = failure_stream if failure_stream is not None else child.stdout
        output = bytearray()
        while True:
            ready, _, _ = select.select([self.server, stream], [], [])
            if self.server in ready:
                return self.accept_any()
            chunk = os.read(stream.fileno(), 65536)
            if chunk:
                output.extend(chunk)
                continue
            stdout, stderr = child.communicate()
            self.fail(f'{description}; receive exited {child.returncode}: '
                      f'{bytes(output).decode(errors="replace")}{stdout}{stderr}')

    def action(self, stream, **value):
        stream.write((json.dumps(value) + '\n').encode())

    def finish(self, child, ok=True):
        stdout, stderr = child.communicate()
        if ok:
            self.assertEqual(child.returncode, 0, stderr)
        else:
            self.assertNotEqual(child.returncode, 0, stdout)
        return stdout, stderr

    def assert_no_start(self):
        self.assertEqual(select.select([self.server], [], [], 0)[0], [],
                         'another native process started while its session was active')

    def native_requests(self):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            if not database.execute("SELECT 1 FROM sqlite_master WHERE name='native_requests'").fetchone():
                return []
            return [dict(row) for row in database.execute('SELECT * FROM native_requests ORDER BY rowid')]

    def native_question(self, stream, event):
        self.action(stream, native_request=event)
        self.assertEqual(json.loads(stream.readline()), {'request_written': event})
        return self.eventually(lambda: next((row for row in self.native_requests()
                                            if row['native_id'] == event['id']), None),
                               'native request was not retained')

    def start_question_player(self, answering=False):
        self.player(harness='omp')
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.fixture), 'answering_parent' if answering else 'parent_endpoint']))
        self.prepare_input('question-task', 'parent',
                           'Ask for the required input and complete the task.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept_child(observer, 'parent',
                                            'Question observer exited before native startup')
        return observer, stream, started

    def test_native_question_parent_answers_and_waits_for_full_report(self):
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['native_answer'] = {'value': 'Keep the existing work.\nUse the selected branch.'}
        config_path.write_text(json.dumps(config))
        observer, stream, started = self.start_question_player(answering=True)
        event = {'type': 'extension_ui_request', 'id': 'input request Ω', 'method': 'input',
                 'title': 'Which work should continue?', 'placeholder': 'A complete answer'}
        request = self.native_question(stream, event)
        answers = self.directory / 'parent-answers.jsonl'
        self.eventually(lambda: answers.exists() and answers.read_text(), 'parent did not answer its native question')
        answer = json.loads(answers.read_text().splitlines()[0])
        self.assertEqual(answer['request']['nativeRequest'], event)
        self.assertEqual(answer['request']['requestId'], request['id'])
        self.assertEqual(answer['code'], 0, answer['stderr'])
        self.assertEqual(json.loads(answer['stdout'])['status'], 'stdin-written')
        self.assertIsNone(observer.poll())
        self.eventually(lambda: (self.directory / 'parent-awaiting-delivery').exists(),
                        'answering parent did not wait for actual report delivery')
        self.assertFalse((self.directory / 'parent-question-complete').exists())
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], **config['native_answer']}})
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        body = 'The requested input was applied.\nThe complete native report is retained.'
        self.action(stream, body=body)
        self.finish(observer)
        self.shutdown_idle_database_owner('question worker did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('delivery', request['id'])['receipt'], 'parent-received')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])
        self.assertEqual(json.loads((self.directory / 'parent-report-delivered').read_text())['body'], body)
        self.assertTrue((self.directory / 'parent-question-complete').exists())

    def test_completed_attempt_acknowledged_while_continuation_live(self):
        self.player()
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, _ = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.coord('message', 'second', 'root', 'parent', 'task', 'The exact queued input.')
        self.action(original, body='Original result complete.')
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        # The completed attempt settles independently of the live continuation.
        self.eventually(lambda: (attempt / 'acknowledged').exists(),
                        'completed attempt was not acknowledged while its continuation ran')
        reports = [turn['reportBody'] for turn in self.coord('turns', 'parent')]
        self.assertIn('Original result complete.', reports)
        self.assertIsNone(observer.poll())
        self.action(continuation, body='Queued result complete.')
        self.assertEqual(continuation.readline(), b'')
        self.finish(observer)
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Original result complete.', 'Queued result complete.'])

    def test_ack_failure_still_joins_queued_continuation(self):
        self.player()
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, _ = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'").fetchone()[0])
        # Stage an actual host ACK failure: the acknowledgment marker path
        # exists as a directory, so the real marker write fails at the
        # filesystem layer while the wrapper stays the production path.
        (attempt / 'acknowledged').mkdir()
        self.coord('message', 'second', 'root', 'parent', 'task', 'The exact queued input.')
        self.action(original, body='Original result complete.')
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept('parent')
        self.assertIn('[id: second]', resumed['prompt'])
        # Keep the continuation live while checking the observer remains
        # available to join it after the first attempt's ACK failure.
        self.action(continuation, body='Queued result complete.', hold_exit=True)
        self.assertEqual(json.loads(continuation.readline()), {'terminal_written': True})
        self.assertIsNone(observer.poll(),
                         'observer died on ACK failure instead of joining its live continuation')
        self.action(continuation)
        self.assertEqual(continuation.readline(), b'')
        output, error = self.finish(observer, ok=False)
        self.assertFalse((attempt / 'acknowledged').is_file(),
                         'a fabricated acknowledged marker appeared after an ACK failure')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Original result complete.', 'Queued result complete.'])
        self.assertIn('File exists', output + error)

    def test_native_root_question_reports_unsupported_without_answering(self):
        self.coord('attach', 'root', 'omp', '', '')
        self.prepare_input('root-question-task', 'root', 'Inspect the native request.', kind='task')
        observer = self.spawn(*self.receive_args('root'))
        stream, started = self.accept('root')
        event = {'type': 'extension_ui_request', 'id': 'root-needs-input',
                 'method': 'input', 'title': 'No registered parent'}
        self.action(stream, native_request=event)
        self.assertEqual(json.loads(stream.readline()), {'request_written': event})
        log = self.output_log('root')
        self.eventually(lambda: log.is_file() and event['id'] in log.read_text(),
                        'unsupported root request was not retained')
        self.action(stream, body='The fixture ends its request without an answer.',
                    hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()),
                         {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        output, _ = self.finish(observer, ok=False)
        self.assertIn('unsupported for a session without a registered parent', output)
        self.assertEqual(self.native_requests(), [])
        self.shutdown_idle_database_owner('root fixture did not exit naturally')

    def test_native_question_survives_observer_loss_and_matches_one_reply(self):
        observer, stream, started = self.start_question_player()
        event = {'type': 'extension_ui_request', 'id': 'choose-branch', 'method': 'select',
                 'title': 'Choose a branch', 'options': ['preserve current', 'new branch']}
        request = self.native_question(stream, event)
        self.eventually(lambda: self.coord('delivery', request['id'])['receipt'], 'question did not reach parent')
        observer.kill()
        observer.wait()
        marker = 'original native waiting for its answer after observer loss'
        self.action(stream, progress=marker)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(), 'recovered observer did not consume surviving output')
        self.assertEqual([row['id'] for row in self.native_requests()], [request['id']])
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.assert_no_start()
        for parent, response in [('parent', {'value': 'preserve current'}),
                                 ('root', {'value': 'unlisted branch'}),
                                 ('root', {'confirmed': True}),
                                 ('root', {'value': 'preserve current', 'cancelled': True})]:
            refused = self.coord('native-reply', parent, request['id'], json.dumps(response), ok=False)
            self.assertNotEqual(refused.returncode, 0)
        for malformed in ['not JSON', '{"value":42}']:
            self.assertNotEqual(self.coord('native-reply', 'root', request['id'], malformed, ok=False).returncode, 0)
        reply_path = self.directory / 'native answer.json'
        reply_path.write_text(json.dumps({'value': 'preserve current'}))
        result = self.coord('native-reply-file', 'root', request['id'], str(reply_path))
        self.assertEqual(result['status'], 'stdin-written')
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], 'value': 'preserve current'}})
        recovered = self.eventually(lambda: [p for p in self.owned_processes()
                                             if p['ppid'] == started['ppid'] and '--recover-receive' in p['command']],
                                   'keeper did not attach a replacement observer')[0]
        os.kill(recovered['pid'], signal.SIGKILL)
        marker = 'native output after the delivered answer and second observer loss'
        self.action(stream, progress=marker)
        self.assertEqual(json.loads(stream.readline()), {'progress_written': marker})
        self.eventually(lambda: marker in log.read_text(), 'second observer did not resume the original native output')
        self.assertEqual(self.coord('native-reply-file', 'root', request['id'], str(reply_path))['status'],
                         'stdin-written')
        conflicting = self.coord('native-reply', 'root', request['id'], '{"value":"new branch"}', ok=False)
        self.assertNotEqual(conflicting.returncode, 0)
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        body = 'The original native completed after the selected reply.'
        self.action(stream, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        self.shutdown_idle_database_owner('recovered question worker did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])

    def test_native_reply_saved_before_write_is_sent_by_recovered_observer(self):
        observer, stream, started = self.start_question_player()
        event = {'type': 'extension_ui_request', 'id': 'pending-answer', 'method': 'input',
                 'title': 'Answer after reconnecting the keeper'}
        request = self.native_question(stream, event)
        self.eventually(lambda: self.coord('delivery', request['id'])['receipt'], 'parent did not receive request')
        manifest = (pathlib.Path(request['attempt']) / 'manifest').read_bytes()
        header = struct.Struct('=8s6Q2I')
        magic, *fields = header.unpack_from(manifest)
        self.assertEqual(magic, b'BATONRP1')
        lengths = fields[:6]
        offset = header.size + sum(lengths[:5])
        address = pathlib.Path(os.fsdecode(manifest[offset:offset + lengths[5]]))
        unavailable = address.with_name('controlled-unavailable-socket')
        self.assertFalse(unavailable.exists())
        address.rename(unavailable)
        try:
            failed = self.coord('native-reply', 'root', request['id'], '{"value":"retained answer"}', ok=False)
            self.assertNotEqual(failed.returncode, 0)
            saved = self.native_requests()[0]
            self.assertEqual(json.loads(saved['reply']), {'type': 'extension_ui_response',
                                                         'id': event['id'], 'value': 'retained answer'})
            self.assertEqual(saved['written'], 0)
        finally:
            unavailable.rename(address)
        observer.kill()
        observer.wait()
        self.action(stream, read_native_reply=True)
        self.assertEqual(json.loads(stream.readline()), {'native_reply': {
            'type': 'extension_ui_response', 'id': event['id'], 'value': 'retained answer'}})
        self.eventually(lambda: self.native_requests()[0]['written'] == 1,
                        'recovery did not record transport completion')
        self.assertEqual(self.native_requests()[0]['id'], request['id'])
        self.assertEqual(self.native_requests()[0]['attempt'], request['attempt'])
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.assert_no_start()
        body = 'The same native continued with its durable pending answer.'
        self.action(stream, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.action(stream, exit_fixture=True)
        self.shutdown_idle_database_owner('recovered reply processes did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])

    def test_native_question_cancellation_and_confirmation_keep_native_identity(self):
        observer, stream, started = self.start_question_player()
        for ident, method, response in [('confirm-no', 'confirm', {'confirmed': False}),
                                        ('editor-value', 'editor', {'value': 'Keep existing work.\nFinish Ω and 雨.'}),
                                        ('editor-cancel', 'editor', {'cancelled': True})]:
            event = {'type': 'extension_ui_request', 'id': ident, 'method': method, 'title': ident}
            request = self.native_question(stream, event)
            self.assertEqual(self.coord('native-reply', 'root', request['id'], json.dumps(response))['status'],
                             'stdin-written')
            self.action(stream, read_native_reply=True)
            self.assertEqual(json.loads(stream.readline()), {'native_reply': {
                'type': 'extension_ui_response', 'id': ident, **response}})
        event = {'type': 'extension_ui_request', 'id': 'cancelled-input', 'method': 'input', 'title': 'Dismissed'}
        request = self.native_question(stream, event)
        cancel = {'type': 'extension_ui_request', 'method': 'cancel', 'targetId': event['id']}
        self.action(stream, native_request=cancel)
        self.assertEqual(json.loads(stream.readline()), {'request_written': cancel})
        self.eventually(lambda: next(row for row in self.native_requests() if row['id'] == request['id'])['closed'],
                        'native cancellation did not close its request')
        refused = self.coord('native-reply', 'root', request['id'], '{"value":"too late"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        late = self.native_question(stream, {'type': 'extension_ui_request', 'id': 'closed-input',
                                            'method': 'input', 'title': 'Input closes before this answer'})
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.action(stream, body='Native cancellations and confirmations completed.', hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        refused = self.coord('native-reply', 'root', late['id'], '{"value":"after input closed"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(next(row for row in self.native_requests() if row['id'] == late['id'])['written'], 0)
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        self.shutdown_idle_database_owner('native question keeper did not exit naturally')
        self.assertEqual(self.coord('inbox', 'root'), [])

    def exercise_missing_omp_fallback(self, observer_losses):
        self.player(harness='omp')
        workspace = self.checkouts / 'parent'
        journal = workspace / 'seed.txt'
        partial = 'seed\nWork completed before the conversation was lost.\n'
        journal.write_text(partial)
        missing = 'missing-omp-conversation'
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update({'missing_resume': missing, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        self.coord('connect', 'parent', missing, '')
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))
        task = 'Keep seed.txt and append the final step after reading the existing work.'
        self.prepare_input('original-task', 'parent', task, kind='task')
        receive = self.receive_args('parent')
        receive[5] = str(workspace)
        observer = self.spawn(*receive)
        fresh, started = self.accept('parent')
        self.assertEqual(started['resume'], '')
        self.assertNotIn('--resume', started['args'])
        self.assertNotEqual(started['native'], missing)
        self.assertIn('[id: original-task]', started['prompt'])
        self.assertIn(task, started['prompt'])
        self.assertIn('fresh conversation', started['prompt'])
        self.assertIn(' M seed.txt', started['prompt'])
        self.assertEqual(journal.read_text(), partial)
        launches_path = self.directory / 'native-launches.jsonl'
        launches = [json.loads(line) for line in launches_path.read_text().splitlines()]
        self.assertEqual([row['resume'] for row in launches], [missing, ''])
        self.assertFalse(any(p['pid'] == launches[0]['pid'] for p in self.owned_processes()))
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'fresh conversation identity was not recorded')

        def recovery_reports():
            with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
                database.row_factory = sqlite3.Row
                return [dict(row) for row in database.execute(
                    "SELECT * FROM messages WHERE sender='parent' AND kind='report' AND id LIKE '%:recovery'")]

        diagnostic = self.eventually(recovery_reports, 'missing conversation produced no recovery report')[0]
        self.assertIn('conversation', diagnostic['body'])
        log = self.output_log('parent')
        for loss in range(observer_losses):
            if loss == 0:
                observer.kill()
                observer.wait()
            else:
                recovered = self.eventually(
                    lambda: [p for p in self.owned_processes()
                             if p['ppid'] == started['ppid'] and '--recover-receive' in p['command']],
                    'fresh native keeper did not replace its observer')[0]
                os.kill(recovered['pid'], signal.SIGKILL)
            marker = 'fresh fallback native output after observer loss ' + str(loss)
            self.action(fresh, progress=marker)
            self.assertEqual(json.loads(fresh.readline()), {'progress_written': marker})
            self.eventually(lambda: log.exists() and marker in log.read_text(),
                            'fresh native output was lost with its observer')
            self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
            self.assertEqual(self.coord(*receive)['status'], 'queued')
            self.assert_no_start()
            self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
            self.assertIn('original-task', [m['id'] for m in self.coord('inbox', 'parent')])
            self.assertEqual([row['id'] for row in recovery_reports()], [diagnostic['id']])
            actual = [json.loads(line) for line in launches_path.read_text().splitlines()]
            self.assertEqual([row['pid'] for row in actual], [row['pid'] for row in launches],
                             'observer recovery launched another native process')

        completed = 'Final step completed in the fresh conversation.\n'
        self.action(fresh, append_file=['seed.txt', completed])
        self.assertEqual(json.loads(fresh.readline()), {'appended': 'seed.txt'})
        body = 'Fresh conversation completed the original task.\nExisting workspace work was preserved.'
        self.action(fresh, body=body)
        self.assertEqual(fresh.readline(), b'')
        if observer_losses == 0:
            self.finish(observer)
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'fresh fallback did not drain the original task and notify its parent')
        self.shutdown_idle_database_owner('fallback keeper or observer did not exit naturally')
        self.assertEqual(journal.read_text(), partial + completed)
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [body])
        self.assertNotEqual(turns[0]['id'], diagnostic['id'].removesuffix(':recovery'))
        self.assertEqual(turns[0]['receipt'], 'parent-received')
        self.assertEqual([row['id'] for row in recovery_reports()], [diagnostic['id']])
        self.assertEqual(recovery_reports()[0]['receipt'], 'parent-received')
        delivered = [json.loads(line) for line in (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
        delivered_bodies = {message['id']: message['body'] for message in delivered}
        self.assertEqual(delivered_bodies[diagnostic['id']], diagnostic['body'])
        self.assertEqual(delivered_bodies[turns[0]['id']], body)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        actual = [json.loads(line) for line in launches_path.read_text().splitlines()]
        self.assertEqual([row['pid'] for row in actual], [row['pid'] for row in launches])

    def test_missing_omp_conversation_restarts_pending_receive_with_workspace_state(self):
        self.exercise_missing_omp_fallback(observer_losses=0)

    def test_missing_omp_fresh_fallback_survives_repeated_observer_loss(self):
        self.exercise_missing_omp_fallback(observer_losses=2)

    def test_missing_omp_root_conversation_drains_task_and_recovery_context(self):
        missing = 'missing-root-conversation'
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update({'missing_resume': missing, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        self.coord('attach', 'root', 'omp', missing, '')
        partial = 'seed\nRoot work completed before conversation loss.\n'
        journal = self.repo / 'seed.txt'
        journal.write_text(partial)
        self.prepare_input('root-task', 'root', 'Keep existing root work and finish seed.txt.',
                           kind='task')
        receive = self.receive_args('root')
        receive[5] = str(self.repo)
        observer = self.spawn(*receive)
        fresh, started = self.accept('root')
        self.assertEqual(started['resume'], '')
        self.assertNotEqual(started['native'], missing)
        self.assertIn('[id: root-task]', started['prompt'])
        self.assertIn('fresh conversation', started['prompt'])
        self.assertIn(' M seed.txt', started['prompt'])
        self.action(fresh, append_file=['seed.txt', 'Root task completed.\n'])
        self.assertEqual(json.loads(fresh.readline()), {'appended': 'seed.txt'})
        body = 'Root task completed in a fresh conversation.'
        self.action(fresh, body=body)
        self.finish(observer)
        self.assertEqual(self.coord('inbox', 'root'), [])
        turns = self.coord('turns', 'root')
        self.assertEqual([(turn['player'], turn['eventType'], turn['reportBody']) for turn in turns],
                         [('root', 'agent_end', body)])
        reports = self.coord('inbox', 'operator')
        self.assertEqual([report['body'] for report in reports], [
            "The recorded conversation could not be resumed; pending input will continue in a fresh conversation with the workspace's current state.",
            body])
        self.assertTrue(reports[0]['id'].endswith(':recovery'))
        self.assertNotEqual(turns[0]['id'], reports[0]['id'].removesuffix(':recovery'))
        self.assertEqual(reports[1]['id'], turns[0]['id'])
        self.assertEqual(self.coord('delivery', 'root-task')['receipt'], 'native-reviewed')
        recovery_input = reports[0]['id'].removesuffix(':recovery') + ':recovery-input'
        self.assertEqual(self.coord('delivery', recovery_input)['receipt'], 'native-reviewed')
        for report in reports:
            delivered = self.coord('delivery', report['id'])
            self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind'], delivered['body']),
                             ('root', 'operator', 'report', report['body']))
            self.assertIsNone(delivered['receipt'])
            self.coord('ack', report['id'], 'operator', 'operator-reviewed')
            self.assertEqual(self.coord('delivery', report['id'])['receipt'], 'operator-reviewed')
        self.assertEqual(self.coord('inbox', 'operator'), [])
        self.assertEqual(self.coord('turns', 'root')[0]['receipt'], 'operator-reviewed')
        self.assertEqual(self.coord('player', 'root')['native'], started['native'])
        self.assertEqual(journal.read_text(), partial + 'Root task completed.\n')
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            self.assertEqual(database.execute("SELECT id FROM messages WHERE kind='report' ORDER BY seq").fetchall(),
                             [(report['id'],) for report in reports])
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual([row['resume'] for row in launches], [missing, ''])
        self.shutdown_idle_database_owner('root fallback processes did not exit naturally')

    def test_stale_shared_omp_refusal_does_not_restart_an_unrelated_failure(self):
        self.player(harness='omp')
        native = 'existing-omp-conversation'
        storage = pathlib.Path(str(self.db) + '.session-' + 'parent'.encode().hex())
        storage.mkdir()
        (storage / ('2026-09-28_' + native + '.jsonl')).write_text(json.dumps({'type': 'session', 'id': native}) + '\n')
        self.coord('connect', 'parent', native, '')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        cause = 'Error: Provider unavailable for this fixture'
        config.update({'early_failure': cause, 'record_launches': True})
        config_path.write_text(json.dumps(config))
        (self.directory / 'parent.jsonl.stderr').write_text('Error: Session from a prior attempt not found\n')
        self.coord('message', 'task', 'root', 'parent', 'task', 'Input must remain available after provider failure.')
        result = self.coord(*self.receive_args('parent'), ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['task'])
        self.assertEqual(self.coord('player', 'parent')['native'], native)
        reports = self.coord('inbox', 'root')
        self.assertFalse(any(m['id'].endswith(':recovery') for m in reports))
        launches = [json.loads(line) for line in (self.directory / 'native-launches.jsonl').read_text().splitlines()]
        self.assertEqual(len(launches), 1, 'an unrelated provider failure started a fresh native conversation')
        self.assertIn(native, launches[0]['resume'])
        diagnostics = [path for path in self.directory.glob('state.db.attempt-*/native.stderr')
                       if cause in path.read_text()]
        self.assertTrue(diagnostics, 'the real provider failure was not retained')
        self.assertTrue(any(str(path) in report['body'] for path in diagnostics for report in reports),
                        'parent diagnostic did not name a readable file containing the provider failure')
        self.shutdown_idle_database_owner('failed attempt processes did not exit naturally')

    def exercise_observer_loss(self, harness, retry, terminal_before_loss=False, evidence=None):
        evidence = evidence if evidence is not None else {}
        evidence.update({'harness': harness, 'retryRequested': retry,
                         'terminalBeforeObserverLoss': terminal_before_loss})
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness=harness)
        self.prepare_input('first', 'parent', 'The original input must be sent once.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        evidence.update({'firstSupervisor': observer.pid, 'firstNative': started['pid'],
                         'keeper': started['ppid'], 'originalPrompt': started['prompt']})
        native = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                 'original native identity was not recorded')
        self.assertEqual(native, started['native'])
        evidence['recordedNativeId'] = native
        # Reports remain queued while OMP is active; guidance may be steered live.
        self.coord('message', 'second', 'root', 'parent', 'report', 'Queued before observer loss.')
        original_body = 'Original completion retained through observer loss: ' + harness
        log = self.output_log('parent')
        if terminal_before_loss:
            self.action(original, body=original_body, hold_exit=True, report_input=True)
            self.assertEqual(json.loads(original.readline()),
                             {'terminal_written': True, 'input_after_prompt': ''})
            self.eventually(lambda: log.exists() and original_body in log.read_text(),
                            'terminal event was not observed before killing the observer')
            evidence['turnsBeforeLoss'] = self.coord('turns', 'parent')
        observer.kill()
        observer.wait()
        evidence['supervisorExit'] = observer.returncode
        evidence['survivingNative'] = [p for p in self.owned_processes() if p['pid'] == started['pid']]
        self.assertTrue(evidence['survivingNative'], 'original native exited with its observer')
        if retry:
            queued = self.coord(*self.receive_args('parent'))
            evidence['retryStatus'] = queued['status']
            self.assertEqual(queued['status'], 'queued')
        self.coord('message', 'third', 'root', 'parent', 'report', 'Queued after observer loss.')
        marker = 'output from original native after observer loss: ' + harness
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        self.eventually(lambda: log.exists() and marker in log.read_text(),
                        'automatic recovery did not retain output from the original native')
        evidence['postLossOutputRetained'] = True
        if not terminal_before_loss:
            self.action(original, body=original_body, hold_exit=True, report_input=True)
            self.assertEqual(json.loads(original.readline()),
                             {'terminal_written': True, 'input_after_prompt': ''})
        evidence['originalPromptRepeated'] = False
        self.eventually(lambda: original_body in log.read_text(), 'original terminal output was lost')
        evidence['duplicateNativeSession'] = bool(select.select([self.server], [], [], 0)[0])
        self.assertFalse(evidence['duplicateNativeSession'],
                         'another native started before the original process exited')
        if retry:
            after_terminal = self.coord(*self.receive_args('parent'))
            evidence['retryAfterTerminalStatus'] = after_terminal['status']
            self.assertEqual(after_terminal['status'], 'queued')
            self.assert_no_start()
        evidence['pendingBeforeNativeExit'] = self.coord('inbox', 'parent')
        self.assertEqual([m['id'] for m in evidence['pendingBeforeNativeExit']], ['second', 'third'])
        self.action(original)
        self.assertEqual(original.readline(), b'')

        arrivals = {}
        for _ in range(2):
            control, event = self.accept_any()
            self.assertNotIn(event['session'], arrivals, 'duplicate session launched during recovery')
            arrivals[event['session']] = (control, event)
        self.assertEqual(set(arrivals), {'parent', 'root'})
        continuation, resumed = arrivals['parent']
        parent, notified = arrivals['root']
        evidence['continuation'] = resumed
        evidence['parentNotification'] = notified
        evidence['originalExitedBeforeContinuation'] = not any(
            p['pid'] == started['pid'] for p in self.owned_processes())
        self.assertTrue(evidence['originalExitedBeforeContinuation'])
        self.assertEqual(resumed['native'], native)
        self.assertNotEqual(resumed['pid'], started['pid'])
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertIn('[id: third]', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        self.assertIn(original_body, notified['prompt'])
        evidence['parentNotified'] = True
        follow_up_body = 'Queued inputs completed after recovery: ' + harness
        self.action(continuation, body=follow_up_body)
        self.assertEqual(continuation.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, next_notification = self.accept('root')
        self.assertIn(follow_up_body, next_notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'recovered work or its parent notification remained pending')
        evidence['pendingInputDrained'] = True
        turns = self.coord('turns', 'parent')
        evidence['turnsAfterRecovery'] = turns
        self.assertEqual([t['reportBody'] for t in turns], [original_body, follow_up_body])
        self.assertTrue(all(t['receipt'] == 'native-reviewed' for t in turns))
        if evidence.get('turnsBeforeLoss'):
            self.assertEqual(turns[0]['id'], evidence['turnsBeforeLoss'][0]['id'])
        evidence['originalCompletionRetained'] = turns[0]['reportBody'] == original_body
        evidence['retainedNativeFrames'] = [json.loads(line) for line in log.read_text().splitlines()]
        self.assertEqual(self.coord('player', 'parent')['native'], native)
        self.shutdown_idle_database_owner('fixture keeper or recovery did not exit')
        return evidence

    def test_observer_loss_retry_preserves_native_and_drains_pending_messages(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                # Each harness needs a separate database and native identity.
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=True)
                finally:
                    fixture.doCleanups()

    def test_observer_loss_recovers_without_a_retry(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=False)
                finally:
                    fixture.doCleanups()

    def test_observer_loss_after_terminal_keeps_lock_until_native_exit(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_observer_loss(harness, retry=True, terminal_before_loss=True)
                finally:
                    fixture.doCleanups()

    def selected_process(self, pid):
        result = subprocess.run(['ps', '-p', str(pid), '-o', 'pid=,ppid=,lstart=,stat=,command='],
                                capture_output=True, text=True)
        self.assertEqual(result.stderr, '')
        if not result.stdout.strip():
            self.assertIn(result.returncode, (0, 1))
            return None
        self.assertEqual(result.returncode, 0, result.stderr)
        fields = result.stdout.strip().split(None, 8)
        self.assertIn(len(fields), (8, 9), result.stdout)
        return {'pid': int(fields[0]), 'ppid': int(fields[1]), 'start': ' '.join(fields[2:7]),
                'state': fields[7], 'command': fields[8] if len(fields) == 9 else ''}

    def signal_selected(self, selected, action):
        current = self.selected_process(selected['pid'])
        self.assertIsNotNone(current, 'The selected process ended before loss injection.')
        for field in ('pid', 'start', 'command'):
            self.assertEqual(current[field], selected[field])
        self.assertFalse(current['state'].startswith('Z'))
        self.assertGreater(selected['pid'], 1)
        self.assertNotEqual(selected['pid'], os.getpid())
        os.kill(selected['pid'], action)

    def session_guard_available(self, session):
        path = pathlib.Path(_session_lock_path(self.db, session))
        with path.open('r+b') as stream:
            try:
                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return True
            except BlockingIOError:
                return False

    def exercise_keeper_loss(self, harness, observer_loss):
        self.coord('connect', 'root', 'native-root', json.dumps([str(self.fixture), 'parent_endpoint']))
        self.player(harness=harness)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config.update(record_launches=True, inspect_session_guard=True)
        config_path.write_text(json.dumps(config))
        self.prepare_input('first', 'parent', 'Complete the original input.', kind='task')
        self.connect('parent')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        self.assertEqual(started['sessionGuardDescriptors'], [])
        native_id = self.eventually(lambda: self.coord('player', 'parent')['native'],
                                    'The original native identity was not recorded.')
        self.assertEqual(native_id, started['native'])
        self.coord('message', 'second', 'root', 'parent', 'report', 'The exact queued input.')
        self.assertFalse(self.session_guard_available('parent'))
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        selected = {name: self.selected_process(pid) for name, pid in
                    [('observer', observer.pid), ('keeper', started['ppid']), ('native', started['pid'])]}
        self.assertTrue(all(selected.values()))
        self.assertEqual(selected['observer']['ppid'], os.getpid())
        self.assertEqual(selected['keeper']['ppid'], observer.pid)
        self.assertEqual(selected['native']['ppid'], selected['keeper']['pid'])
        self.assertIn(str(self.db), selected['observer']['command'])
        self.assertIn('--host-process-keeper', selected['keeper']['command'])
        self.assertIn(str(attempt), selected['keeper']['command'])
        self.assertIn(str(self.fixture), selected['native']['command'])
        self.assertEqual(int((attempt / 'native.pid').read_text()), started['pid'])
        if observer_loss:
            self.signal_selected(selected['observer'], signal.SIGSTOP)
        self.signal_selected(selected['keeper'], signal.SIGKILL)
        producer = observer
        if observer_loss:
            self.signal_selected(selected['observer'], signal.SIGKILL)
            observer.wait()
            self.assertEqual(observer.returncode, -signal.SIGKILL)
            before_direct = (self.directory / 'native-launches.jsonl').read_bytes()
            with sqlite3.connect(self.db) as database:
                execution = database.execute("SELECT * FROM executions WHERE session='parent'").fetchone()
            task = self.directory / 'direct-before-recovery.txt'
            task.write_text('A direct task before adopting the surviving original.')
            direct = self.spawn('turn', 'parent', 'direct-before-recovery', self.fixture, 'parent', 'low',
                                self.directory, task, self.directory / 'direct-before-recovery.jsonl', native_id)
            _, stderr = self.finish(direct, ok=False)
            self.assertEqual(direct.returncode, 2)
            self.assertIn('run receive', stderr)
            self.assertEqual((self.directory / 'native-launches.jsonl').read_bytes(), before_direct)
            with sqlite3.connect(self.db) as database:
                self.assertEqual(database.execute("SELECT * FROM executions WHERE session='parent'").fetchone(),
                                 execution, 'Direct admission replaced the unreleased Receive attempt.')
            producer = self.spawn(*self.receive_args('parent'))
        current = self.selected_process(started['pid'])
        self.assertIsNotNone(current)
        self.assertEqual(current['start'], selected['native']['start'])
        self.assertFalse(current['state'].startswith('Z'))
        marker = 'Surviving original stdout after keeper loss.'
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: log.exists() and marker in log.read_text(),
                        'The observer did not retain surviving native stdout.')
        self.assertFalse(self.session_guard_available('parent'))
        launches = self.directory / 'native-launches.jsonl'
        before_retry = launches.read_bytes()
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.assertEqual(launches.read_bytes(), before_retry)
        body = 'Original result retained after keeper loss: ' + harness
        self.action(original, body=body, hold_exit=True)
        self.assertEqual(json.loads(original.readline()), {'terminal_written': True})
        self.eventually(lambda: body in log.read_text(), 'The original terminal frame was not retained.')
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.assertEqual(launches.read_bytes(), before_retry)
        self.assertFalse(self.session_guard_available('parent'))
        self.action(original)
        self.assertEqual(original.readline(), b'')
        continuation, resumed = self.accept('parent')
        original_birth = self.selected_process(started['pid'])
        self.assertTrue(original_birth is None or original_birth['start'] != selected['native']['start']
                        or original_birth['state'].startswith('Z'),
                        'Pending continuation overlapped the original native lifetime.')
        self.assertEqual(resumed['sessionGuardDescriptors'], [])
        self.assertEqual(resumed['native'], native_id)
        if harness == 'codex':
            self.assertEqual(resumed['resume'], native_id)
        else:
            self.assertEqual(json.loads(pathlib.Path(resumed['resume']).read_text().splitlines()[0])['id'],
                             native_id)
        self.assertIn('[id: second]', resumed['prompt'])
        self.assertIn('The exact queued input.', resumed['prompt'])
        self.assertNotIn('[id: first]', resumed['prompt'])
        pending_body = 'Pending result after keeper loss: ' + harness
        self.action(continuation, body=pending_body)
        self.assertEqual(continuation.readline(), b'')
        self.finish(producer, ok=False)
        self.assertEqual(producer.returncode, 1)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        turns = self.coord('turns', 'parent')
        self.assertEqual([row['reportBody'] for row in turns], [body, pending_body])
        self.assertTrue(all(row['receipt'] == 'parent-received' for row in turns))
        with sqlite3.connect(self.db) as database:
            accepted = database.execute("SELECT id,body,receipt FROM messages WHERE id IN ('first','second') ORDER BY seq").fetchall()
        self.assertEqual(accepted, [('first', 'Complete the original input.', 'native-reviewed'),
                                    ('second', 'The exact queued input.', 'native-reviewed')])
        deliveries = [json.loads(line) for line in (self.directory / 'parent-deliveries.jsonl').read_text().splitlines()]
        self.assertTrue(any(row['body'] == body for row in deliveries))
        self.assertTrue(any(row['body'] == pending_body for row in deliveries))
        self.assertTrue(any('unknown after keeper loss' in row['body'] for row in deliveries))
        self.assertEqual(self.coord('player', 'parent')['native'], native_id)
        self.shutdown_idle_database_owner('A fixture owner did not exit naturally.')
        self.assertTrue(self.session_guard_available('parent'))
        task = self.directory / 'direct-after-recovery.txt'
        task.write_text('A direct task after the retained Receive completed.')
        direct = self.spawn('turn', 'parent', 'direct-after-recovery', self.fixture, 'parent', 'low',
                            self.directory, task, self.directory / 'direct-after-recovery.jsonl', native_id)
        current, started_direct = self.accept('parent')
        self.assertEqual(started_direct['native'], native_id)
        self.assertEqual(started_direct['sessionGuardDescriptors'], [])
        self.action(current, body='Direct work after the retained Receive completed.')
        self.assertEqual(current.readline(), b'')
        self.finish(direct)
        self.shutdown_idle_database_owner('A direct owner did not exit naturally.')
        self.assertTrue(self.session_guard_available('parent'))

    def test_keeper_loss_preserves_original_and_drains_pending_input(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_keeper_loss(harness, observer_loss=False)
                finally:
                    fixture.doCleanups()

    def test_keeper_and_observer_loss_adopts_original_before_pending_input(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                fixture = Receive()
                try:
                    fixture.setUp()
                    fixture.exercise_keeper_loss(harness, observer_loss=True)
                finally:
                    fixture.doCleanups()

    def test_completed_omp_attempt_replay_leaves_guidance_for_current_native(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.prepare_input('first', 'parent', 'Original work.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, first = self.accept('parent')
        with sqlite3.connect(self.db) as database:
            attempt = pathlib.Path(database.execute(
                "SELECT directory FROM executions WHERE session='parent' AND mode='retained'"
            ).fetchone()[0])
        self.coord('message', 'second', 'root', 'parent', 'task', 'Work queued before original completion.')
        self.action(original, body='Original report survives completed-attempt replay.')
        self.assertEqual(original.readline(), b'')
        arrivals = {}
        for _ in range(2):
            stream, started = self.accept_any()
            self.assertNotIn(started['session'], arrivals)
            arrivals[started['session']] = (stream, started)
        self.assertEqual(set(arrivals), {'root', 'parent'})
        parent, notification = arrivals['root']
        current, second = arrivals['parent']
        self.assertIn('Original report survives completed-attempt replay.', notification['prompt'])
        self.assertEqual(second['native'], first['native'])
        marker = 'current native state observed before observer loss'
        self.action(current, progress=marker)
        self.assertEqual(json.loads(current.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(), 'current native state was not observed')
        original_report = self.coord('turns', 'parent')[0]
        self.coord('message', 'later-guidance', 'root', 'parent', 'guidance',
                   'Guidance belongs to the current native process.')
        observer.kill()
        observer.wait()
        # The owner settles the old attempt while the current native process
        # keeps its task and accepts pending guidance.
        self.eventually(lambda: (attempt / 'acknowledged').exists(),
                        'completed OMP attempt was not acknowledged while guidance was pending')
        self.assertTrue(any(p['pid'] == second['pid'] for p in self.owned_processes()))
        self.assertIn('later-guidance', [m['id'] for m in self.coord('inbox', 'parent')])
        self.action(current, read_steer=True)
        accepted = json.loads(current.readline())['steer_received']
        self.assertEqual(accepted['id'], 'later-guidance')
        self.assertEqual(accepted['message'], 'Guidance belongs to the current native process.')
        self.eventually(lambda: 'later-guidance' not in [m['id'] for m in self.coord('inbox', 'parent')],
                        'native steer response did not record guidance acceptance')
        self.action(current, body='Current task completed after accepting guidance.')
        self.assertEqual(current.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, notification = self.accept('root')
        self.assertIn('Current task completed after accepting guidance.', notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'replayed completion or current work remained pending')
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [
            'Original report survives completed-attempt replay.',
            'Current task completed after accepting guidance.',
        ])
        self.assertEqual(turns[0]['id'], original_report['id'])
        self.assertTrue(all(turn['receipt'] == 'native-reviewed' for turn in turns))
        self.shutdown_idle_database_owner('keeper or recovery did not exit after replay')

    def test_omp_recovery_after_input_closes_defers_guidance_until_native_exit(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player(harness='omp')
        self.prepare_input('original', 'parent', 'Original work.', kind='task')
        observer = self.spawn(*self.receive_args('parent'))
        original, started = self.accept('parent')
        original_body = ('Original OMP result before observer loss.\n'
                         'The second line must reach the parent unchanged.')
        self.action(original, body=original_body, hold_exit=True, report_input=True)
        # The fixture reports this only after reading EOF from native stdin.
        self.assertEqual(json.loads(original.readline()),
                         {'terminal_written': True, 'input_after_prompt': ''})
        original_report = self.eventually(lambda: self.coord('turns', 'parent'),
                                          'OMP terminal was not recorded before observer loss')[0]
        self.assertEqual(original_report['reportBody'], original_body)
        self.message('pending-guidance', 'parent', 'Work for the next native invocation.')
        observer.kill()
        observer.wait()
        marker = 'original native output after observer loss with stdin already closed'
        self.action(original, progress=marker)
        self.assertEqual(json.loads(original.readline()), {'progress_written': marker})
        log = self.output_log('parent')
        self.eventually(lambda: marker in log.read_text(),
                        'recovery could not read post-loss output while native stdin was closed')
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.assertEqual(self.coord(*self.receive_args('parent'))['status'], 'queued')
        self.assert_no_start()
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['pending-guidance'])
        self.assertEqual(list(self.directory.glob('state.db.attempt-*/observer-error')), [])
        for recovery_log in self.directory.glob('state.db.attempt-*/observer.log'):
            self.assertNotIn('Broken pipe', recovery_log.read_text())
        self.action(original)
        self.assertEqual(original.readline(), b'')

        arrivals = {}
        for _ in range(2):
            control, event = self.accept_any()
            self.assertNotIn(event['session'], arrivals)
            arrivals[event['session']] = (control, event)
        self.assertEqual(set(arrivals), {'parent', 'root'})
        continuation, resumed = arrivals['parent']
        parent, notification = arrivals['root']
        self.assertFalse(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        self.assertEqual(resumed['native'], started['native'])
        self.assertIn('[id: pending-guidance]', resumed['prompt'])
        self.assertNotIn('[id: original]', resumed['prompt'])
        self.assertIn(original_body, notification['prompt'])
        follow_up_body = 'Pending guidance completed by the next native invocation.'
        self.action(continuation, body=follow_up_body)
        self.assertEqual(continuation.readline(), b'')
        self.action(parent)
        self.assertEqual(parent.readline(), b'')
        parent_again, notification = self.accept('root')
        self.assertIn(follow_up_body, notification['prompt'])
        self.action(parent_again)
        self.assertEqual(parent_again.readline(), b'')
        self.eventually(lambda: not self.coord('inbox', 'parent') and not self.coord('inbox', 'root'),
                        'pending guidance or its parent notification was not acknowledged')
        turns = self.coord('turns', 'parent')
        self.assertEqual([turn['reportBody'] for turn in turns], [original_body, follow_up_body])
        self.assertEqual(turns[0]['id'], original_report['id'])
        self.assertTrue(all(turn['receipt'] == 'native-reviewed' for turn in turns))
        self.shutdown_idle_database_owner('keeper or recovery did not exit naturally')
        self.assertEqual(list(self.directory.glob('state.db.attempt-*/observer-error')), [])
        for recovery_log in self.directory.glob('state.db.attempt-*/observer.log'):
            self.assertNotIn('Broken pipe', recovery_log.read_text())

    def test_codex_principal_receive_uses_subscription_and_saved_native_thread(self):
        self.coord('attach','root','codex','','')
        observed=[]
        for ident, body in [('subscription-initial','First Principal input.\n'),
                            ('subscription-followup','Review the saved Principal conversation.\n')]:
            self.prepare_input(ident, 'root', body, kind='task')
            with patch.dict(os.environ, {'OPENAI_API_KEY':'controlled-unused-key', 'CODEX_API_KEY':'controlled-unused-key'}):
                observer=self.spawn(*self.receive_args('root'))
                control, started=self.accept('root')
                owned=self.owned_processes()
                self.action(control, body=body)
                self.finish(observer)
            observed.append((started,owned,ident,body))
        native=observed[0][0]['native']
        for (started,owned,ident,body), subcommand in zip(observed,[['exec'],['exec','resume',native]]):
            self.assertEqual(started['args'][:2],['-c','forced_login_method="chatgpt"'])
            self.assertEqual(started['args'][2:2+len(subcommand)],subcommand)
            configs=[started['args'][i+1] for i,arg in enumerate(started['args']) if arg=='-c']
            self.assertEqual(configs,['forced_login_method="chatgpt"','model_reasoning_effort="low"'])
            self.assertEqual(started['args'][started['args'].index('--model')+1],'root')
            self.assertEqual(started['apiKeyVariablesPresent'],[])
            self.assertEqual(started['cwd'],str(self.directory))
            self.assertIn('[id: '+ident+']',started['prompt'])
            self.assertIn(body,started['prompt'])
            self.assertEqual(started['native'],native)
            self.assertTrue(any(p['pid']==started['pid'] and p['ppid']==started['ppid'] for p in owned))
        self.assertEqual(observed[0][0]['resume'],'')
        self.assertEqual(observed[1][0]['resume'],native)
        self.assertEqual(self.coord('player','root')['native'],native)
        self.assertEqual(self.coord('inbox','root'),[])

    def test_busy_direct_receive_drains_new_input_and_preserves_native_session(self):
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.message('second', 'parent')
        queued = self.coord(*self.receive_args('parent'))
        self.assertEqual(queued['status'], 'queued')
        self.assert_no_start()
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: second]', next_turn['prompt'])
        self.assertEqual(next_turn['resume'], started['native'])
        self.action(control2)
        self.finish(first)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(len(self.coord('turns', 'parent')), 2)

    def test_distinct_sessions_start_before_either_finishes(self):
        for name in ['left', 'right']:
            self.player(name)
            self.prepare_input(name + '-input', name)
        left = self.spawn(*self.receive_args('left'))
        left_control, _ = self.accept('left')
        right = self.spawn(*self.receive_args('right'))
        right_control, _ = self.accept('right')
        self.action(left_control)
        self.action(right_control)
        self.finish(left)
        self.finish(right)

    def test_native_self_message_is_refused_without_disrupting_the_active_turn(self):
        self.player()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.action(control, message=['self-message', 'parent', 'follow up'])
        response = json.loads(control.readline())
        self.assertEqual(response['code'], 2, response['stderr'])
        self.assertIn('message-route-denied', response['stderr'])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['first'])
        self.assert_no_start()
        self.action(control)
        self.finish(first)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_a_native_self_promotion_returns_and_continues_with_its_notice(self):
        self.player()
        self.coord('report', 'self-evidence', 'parent', 'Evidence reviewed by this session.')
        self.coord('record', 'self-finding', 'parent', 'Reviewed finding',
                   'message:self-evidence', 'fixture')
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, original = self.accept('parent')
        self.action(control, promote=['self-share', 'parent', 'parent', 'parent', 'self-finding'])
        response = json.loads(control.readline())
        self.assertEqual(response['code'], 0, response['stderr'])
        self.assertEqual(json.loads(response['stdout'])['id'], 'self-share')
        self.assert_no_start()
        notice = self.coord('delivery', 'self-share:promotion-notice')
        self.assertIsNone(notice['receipt'])
        self.action(control)
        second, started = self.accept('parent')
        self.assertEqual(started['native'], original['native'])
        self.assertIn('[id: self-share:promotion-notice]', started['prompt'])
        self.assertIn(notice['body'], started['prompt'])
        self.action(second)
        self.finish(first)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.coord('delivery', 'self-share:promotion-notice')['receipt'],
                         'native-reviewed')

    def test_synchronous_self_turn_reports_busy_and_native_work_continues(self):
        self.player()
        self.prepare_input('first', 'parent')
        child = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control, turn='self-turn')
        response = json.loads(control.readline())
        self.assertNotEqual(response['code'], 0)
        self.assertIn('active native turn', response['stderr'].lower())
        self.assert_no_start()
        self.action(control)
        self.finish(child)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertNotIn('self-turn', [report['id'] for report in self.coord('inbox', 'root')])
        retried = self.spawn('turn', 'parent', 'self-turn', self.fixture, 'parent', 'low',
                             self.directory, self.directory / 'self-turn-task',
                             self.directory / 'self-turn.jsonl', '')
        retry_control, _ = self.accept('parent')
        self.action(retry_control)
        self.finish(retried)
        self.assertIn('self-turn', [report['id'] for report in self.coord('inbox', 'root')])

    def test_upward_failure_preserves_queued_input_processing(self):
        self.coord('attach', 'root', 'codex', 'native-root',
                   json.dumps([str(self.directory / 'missing receiver')]))
        self.player()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.message('second', 'parent')
        self.action(control)
        second, started = self.accept('parent')
        self.assertIn('[id: second]', started['prompt'])
        self.action(second)
        self.finish(first, ok=False)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertTrue(self.coord('inbox', 'root'))

    def test_queued_failure_joins_concurrent_ancestor_delivery(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.message('second', 'parent')
        self.action(control)
        started = {}
        for _ in range(2):
            connection, _ = self.server.accept()
            stream = connection.makefile('rwb', buffering=0)
            self.controls.append((stream, connection))
            event = json.loads(stream.readline())
            started[event['session']] = stream
        self.assertEqual(set(started), {'root', 'parent'})
        self.action(started['parent'], fail=True, ack=False)
        while True:
            if first.poll() is not None:
                self.fail(f'first delivery exited before the queued failure was reported: {first.returncode}')
            if any('fixture provider failed' in m['body'] for m in self.coord('inbox', 'root')):
                break
            time.sleep(.01)
        self.assertIsNone(first.poll(), 'first delivery exited while root review was pending')
        self.action(started['root'])
        # The failed second turn produces a new report while root was reviewing the first.
        root_again, _ = self.accept('root')
        self.action(root_again)
        self.finish(first, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['second'])
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_startup_and_terminal_failures_leave_input_available_for_retry(self):
        self.player()
        self.prepare_input('input', 'parent')
        missing = self.coord(*self.receive_args('parent', self.directory / 'missing executable'), ok=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        startup_report = next(m for m in self.coord('inbox', 'root') if 'without a native result (exit 127)' in m['body'])
        self.assertIn('Output: '+str(self.output_log('parent')), startup_report['body'])
        startup_stderr = pathlib.Path(startup_report['body'].split(' Stderr: ', 1)[1]).read_text()
        self.assertIn(str(self.directory / 'missing executable'), startup_stderr)
        self.assertIn('No such file or directory', startup_stderr)
        failed = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control, fail=True, ack=False)
        self.finish(failed, ok=False)
        failed_report = next(m for m in self.coord('inbox', 'root') if 'fixture provider failed' in m['body'])
        retry = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control)
        self.finish(retry)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        reports = self.coord('inbox', 'root')
        success_report = next(m for m in reports if m['body'] == 'native review complete')
        self.assertNotEqual(startup_report['id'], failed_report['id'])
        self.assertNotEqual(failed_report['id'], success_report['id'])
        self.assertNotEqual(startup_report['id'], success_report['id'])

    def test_receive_startup_failure_notifies_parent_and_retains_input(self):
        self.coord('attach', 'root', 'codex', 'native-root', self.endpoint('root'))
        self.player()
        self.prepare_input('input', 'parent', 'Input for a missing executable.', kind='task')
        failed = self.spawn(*self.receive_args('parent', self.directory / 'missing executable'))
        parent, notified = self.accept_or_child_exit(failed, 'startup failure did not notify parent')
        self.assertEqual(notified['session'], 'root')
        startup_report = next(m for m in self.coord('inbox', 'root') if 'without a native result (exit 127)' in m['body'])
        self.assertIn(startup_report['body'], notified['prompt'])
        self.assertIn('Output: '+str(self.output_log('parent')), startup_report['body'])
        startup_stderr = pathlib.Path(startup_report['body'].split(' Stderr: ', 1)[1]).read_text()
        self.assertIn(str(self.directory / 'missing executable'), startup_stderr)
        self.assertIn('No such file or directory', startup_stderr)
        self.action(parent)
        self.finish(failed, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_root_failure_after_success_retains_failure_and_quoted_commands(self):
        self.message('first', 'root')
        first = self.spawn(*self.receive_args('root'))
        control, started = self.accept('root')
        inbox_command = next(line.strip() for line in started['prompt'].splitlines() if ' inbox ' in line)
        self.assertEqual(shlex.split(inbox_command), [str(EXE.resolve()), str(self.db.resolve()), 'inbox', 'root'])
        self.action(control)
        self.finish(first)
        self.message('second', 'root')
        second = self.spawn(*self.receive_args('root'))
        control, started = self.accept('root')
        self.assertEqual(started['resume'], 'native-root')
        self.action(control, fail=True, ack=False)
        stdout, _ = self.finish(second, ok=False)
        self.assertIn('fixture provider failed', stdout)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['second'])
        turns = self.coord('turns', 'root')
        self.assertEqual([(turn['player'], turn['eventType']) for turn in turns],
                         [('root', 'result'), ('root', 'result')])
        self.assertNotEqual(turns[0]['id'], turns[1]['id'])
        self.assertEqual(turns[0]['reportBody'], 'native review complete')
        self.assertEqual(json.loads(turns[1]['reportBody']), {
            'type': 'result', 'is_error': 1,
            'nativeEvent': {'type': 'turn.failed', 'error': {'message': 'fixture provider failed'}},
            'result': 'fixture provider failed'})
        reports = self.coord('inbox', 'operator')
        self.assertEqual([report['id'] for report in reports], [turn['id'] for turn in turns])
        self.assertEqual([report['body'] for report in reports], [turn['reportBody'] for turn in turns])
        for report in reports:
            delivered = self.coord('delivery', report['id'])
            self.assertEqual((delivered['sender'], delivered['recipient'], delivered['kind']),
                             ('root', 'operator', 'report'))
            self.assertIsNone(delivered['receipt'])
            self.coord('ack', report['id'], 'operator', 'operator-reviewed')
            self.assertEqual(self.coord('delivery', report['id'])['receipt'], 'operator-reviewed')
        self.assertEqual(self.coord('inbox', 'operator'), [])
        self.assertEqual([turn['receipt'] for turn in self.coord('turns', 'root')],
                         ['operator-reviewed', 'operator-reviewed'])
        self.assertEqual(self.coord('delivery', 'first')['receipt'], 'native-reviewed')
        self.assertIsNone(self.coord('delivery', 'second')['receipt'])
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['second'])
        self.shutdown_idle_database_owner('root success or failure processes did not exit naturally')

    def test_root_failed_receive_can_retry_the_same_pending_input(self):
        self.message('input', 'root')
        failed = self.spawn(*self.receive_args('root'))
        control, original = self.accept('root')
        self.action(control, fail=True, ack=False)
        self.finish(failed, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'root')], ['input'])
        retry = self.spawn(*self.receive_args('root'))
        control, resumed = self.accept_or_child_exit(retry, 'root retry exited before native start')
        self.assertEqual(resumed['session'], 'root')
        self.assertEqual(resumed['native'], original['native'])
        self.assertIn('[id: input]', resumed['prompt'])
        self.action(control)
        self.finish(retry)
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_turn_and_receive_share_ownership_and_omp_session_file(self):
        self.player(harness='omp')
        self.prepare_input('preexisting', 'parent', 'Already pending before turn.', kind='report')
        self.connect('parent')
        task = self.directory / 'initial task'
        task.write_text('Initial work without an inbox batch.')
        alias = self.directory / 'database alias.db'
        alias.symlink_to(self.db)
        child = subprocess.Popen([str(EXE), str(alias), 'turn', 'parent', 'initial-turn',
                                  str(self.fixture), 'parent', 'low', str(self.directory),
                                  str(task), str(self.directory / 'initial.jsonl'), ''],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        control, initial = self.accept('parent')
        self.message('follow-up', 'parent')
        self.assert_no_start()
        self.action(control)
        follow_up, started = self.accept('parent')
        self.assertIn('[id: preexisting]', started['prompt'])
        self.assertIn('[id: follow-up]', started['prompt'])
        self.assertEqual(started['native'], initial['native'])
        self.assertEqual(pathlib.Path(started['resume']).parent, pathlib.Path(str(self.db) + '.sessions'))
        self.action(follow_up)
        self.finish(child)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_terminal_event_retains_ownership_until_native_process_exit(self):
        self.player()
        self.connect('parent')
        task = self.directory / 'task'
        task.write_text('Initial work.')
        child = self.spawn('turn', 'parent', 'initial-turn', self.fixture, 'parent', 'low',
                           self.directory, task, self.directory / 'initial.jsonl', '')
        control, _ = self.accept('parent')
        self.action(control, hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.message('follow-up', 'parent')
        self.assert_no_start()
        self.action(control)
        resumed, started = self.accept('parent')
        self.assertIn('[id: follow-up]', started['prompt'])
        self.action(resumed)
        self.finish(child)

    def test_replayed_turn_wakes_input_queued_while_returning_saved_report(self):
        self.player()
        report = self.directory / 'large report'
        report.write_text('retained report\n' * 30000)
        self.coord('message-file', 'saved-turn', 'parent', 'root', 'report', report)
        self.connect('parent')
        child = self.spawn('turn', 'parent', 'saved-turn', self.fixture, 'parent', 'low',
                           self.directory, self.directory / 'unused task',
                           self.directory / 'unused log', '')
        # A retained report fills stdout while the replay still owns the session.
        self.assertEqual(child.stdout.read(1), '{')
        self.message('queued-during-replay', 'parent')
        self.assert_no_start()
        output = []
        drain = threading.Thread(target=lambda: output.append(child.stdout.read()))
        drain.start()
        control, started = self.accept('parent')
        self.assertIn('[id: queued-during-replay]', started['prompt'])
        self.action(control)
        drain.join(10)
        self.assertFalse(drain.is_alive())
        self.finish(child)
        self.assertIn('retained report', output[0])
        self.assertEqual(self.coord('inbox', 'parent'), [])


    # Canonical claim-table definition, kept identical to
    # Store.claim_schema_sql in bend2/src/coordinator/store.bend. Staging a
    # claim ensures the table exactly as the product does; reading claims
    # from a database that never held any returns no rows.
    CLAIM_SCHEMA = ("CREATE TABLE IF NOT EXISTS wake_claims (session TEXT PRIMARY KEY NOT NULL "
                    "REFERENCES sessions(id), state TEXT NOT NULL DEFAULT 'claimed', "
                    "owner TEXT NOT NULL DEFAULT '', generation INTEGER NOT NULL DEFAULT 0);")

    def claims(self, session=None):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            try:
                rows = database.execute('SELECT session, state FROM wake_claims ORDER BY session').fetchall()
            except sqlite3.OperationalError:
                return []
        return [row for row in rows if session is None or row[0] == session]

    def claim_rows(self, session=None):
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            try:
                rows = database.execute('SELECT session, state, owner, generation FROM wake_claims'
                                        ' ORDER BY session').fetchall()
            except sqlite3.OperationalError:
                return []
        return [row for row in rows if session is None or row[0] == session]

    def execution(self, session):
        """The session's recorded attempt row: phase, status and directory."""
        with sqlite3.connect(f'{self.db.as_uri()}?mode=ro', uri=True) as database:
            row = database.execute('SELECT phase, status, directory FROM executions'
                                   ' WHERE session=?', (session,)).fetchone()
        return row

    def set_phase(self, session, phase):
        with sqlite3.connect(str(self.db)) as database:
            database.execute('UPDATE executions SET phase=? WHERE session=?',
                             (phase, session))

    def claim(self, session, state='claimed', owner='', generation=0):
        with sqlite3.connect(str(self.db)) as database:
            database.execute(self.CLAIM_SCHEMA)
            database.execute('INSERT OR REPLACE INTO wake_claims(session, state, owner, generation)'
                             ' VALUES (?, ?, ?, ?)',
                             (session, state, owner, generation))

    def session_lock_path(self, session):
        return _session_lock_path(self.db, session)

    def hold_session_lock(self, session):
        held = os.open(self.session_lock_path(session), os.O_CREAT | os.O_RDWR, 0o600)
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        self.addCleanup(lambda: (fcntl.flock(held, fcntl.LOCK_UN), os.close(held)))
        return held

    def test_stop_clears_the_wake_claim(self):
        """A terminal stop is the operator resolution: the session's claim goes with it
        while the retained input stays in the inbox."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent')
        self.assertEqual(self.claims('parent'), [('parent', 'claimed')])
        stopped = self.coord('stop', 'parent', 'stop-claim', 'operator resolution')
        self.assertEqual(stopped['status'], 'stopped')
        self.assertEqual(self.claims('parent'), [])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_acknowledgement_clears_the_wake_claim(self):
        """Acknowledgement clears the obligation, and the claim row is deleted with it."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent')
        receipt = self.coord('ack', 'owed', 'parent', 'read-accepted')
        self.assertEqual(receipt['receipt'], 'read-accepted')
        self.assertEqual(self.claims('parent'), [])
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_an_unclaimed_session_with_owed_input_never_starts_a_turn_by_itself(self):
        """The obligation is durable and passive: with no driver and no admission, an idle
        session with owed input starts nothing, keeps its unclaimed row, and retains the
        input in its inbox."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'unclaimed')
        self.assert_no_start()
        self.assertEqual(self.claims('parent'), [('parent', 'unclaimed')])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])


    def test_acknowledgement_with_a_missing_id_is_refused_and_preserves_the_claim(self):
        """A refused acknowledgement writes nothing: the live claim row stays exactly
        as it was, owner and generation included."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        refused = self.coord('ack', 'no-such-message', 'parent', 'read-accepted', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_acknowledgement_to_the_wrong_recipient_is_refused_and_preserves_the_claim(self):
        self.player()
        self.player('other')
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        refused = self.coord('ack', 'owed', 'other', 'read-accepted', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual(self.claim_rows('other'), [])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_acknowledgement_with_remaining_input_keeps_the_claim(self):
        """The Ack guard clears the claim only when no unacknowledged input remains:
        acknowledging one of two owed messages writes its receipt and keeps the row."""
        self.player()
        self.prepare_input('first', 'parent')
        self.prepare_input('second', 'parent')
        self.claim('parent', 'claimed', 'first', 2)
        receipt = self.coord('ack', 'first', 'parent', 'read-accepted')
        self.assertEqual(receipt['receipt'], 'read-accepted')
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'first', 2)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['second'])

    def test_stop_with_an_unsupported_harness_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        with sqlite3.connect(str(self.db)) as database:
            database.execute("UPDATE sessions SET harness='muse' WHERE id='parent'")
        refused = self.coord('stop', 'parent', 'stop-unsupported', 'operator resolution', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stop_with_an_active_direct_execution_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 4)
        with sqlite3.connect(str(self.db)) as database:
            database.execute("INSERT INTO executions(session, id, mode, directory, phase, status)"
                             " VALUES ('parent', 'direct-1', 'direct', '/tmp', 'running', '')")
        refused = self.coord('stop', 'parent', 'stop-direct', 'operator resolution', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 4)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stop_with_a_conflicting_identity_is_refused_and_preserves_the_claim(self):
        self.player()
        self.prepare_input('owed', 'parent')
        stopped = self.coord('stop', 'parent', 'stop-first', 'operator resolution')
        self.assertEqual(stopped['status'], 'stopped')
        self.assertEqual(self.claim_rows('parent'), [])
        self.claim('parent', 'claimed', 'owed', 9)
        refused = self.coord('stop', 'parent', 'stop-second', 'changed reason', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('identity', refused.stderr)
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 9)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_queued_non_owner_cannot_clear_a_live_claim(self):
        """While another driver holds the session lock, the queued sweep returns
        without touching the live claim row: owner and generation survive intact."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'owed', 6)
        self.hold_session_lock('parent')
        queued = self.coord(*self.receive_args('parent'))
        self.assertEqual(queued['status'], 'queued')
        self.assertEqual(self.claim_rows('parent'), [('parent', 'claimed', 'owed', 6)])
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_stale_claim_from_a_dead_driver_is_taken_over_with_a_fenced_generation(self):
        """A claim row left by a driver that died before launch never suppresses the
        wake: the next driver takes the obligation over under the lock, names the
        head message as owner, and fences the takeover past the stale generation."""
        self.player()
        self.prepare_input('owed', 'parent')
        self.claim('parent', 'claimed', 'dead-attempt', 7)
        child = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: owed]', started['prompt'])
        self.action(control, ack=False)
        self.finish(child)
        taken = self.eventually(
            lambda: next((row for row in self.claim_rows('parent')
                          if row[2] == 'owed' and row[3] > 7), None),
            'a live driver never took over the stale claim')
        self.assertEqual(taken[2:], ('owed', taken[3]))
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['owed'])

    def test_wake_behind_an_unreaped_attempt_stands_down_without_reclaiming(self):
        """Two-driver launch handoff: with a claimed obligation whose recorded
        attempt was never reaped, host custody stays ambiguous — launch
        markers without terminal marks — so a second admission's wake stands
        down even though the execution phase still reads running. The row
        keeps its owner and generation and no second launch rewrites the
        obligation. A bare phase value never proves custody."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        self.assertEqual(before[0][2], 'first')
        self.freeze_owned()
        first.kill()
        first.wait()
        self.kill_fixture()
        self.kill_keeper(first)
        self.drain_owned()
        directory = self.execution('parent')[2]
        self.assertTrue(os.path.isfile(os.path.join(directory, 'manifest')))
        self.assertTrue(os.path.isfile(os.path.join(directory, 'launch')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'acknowledged')),
                         'keeper recovered the killed observer before it died')
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')),
                         'keeper reaped the killed native before it died')
        self.message('second', 'parent')
        self.assert_no_start()
        self.assertEqual(self.claim_rows('parent'), before)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])

    def kill_fixture(self):
        """Kill the fixture native processes of this run, leaving keepers."""
        result = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, check=True)
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) == 2 and 'native fixture' in fields[1]:
                try:
                    os.kill(int(fields[0]), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def freeze_owned(self, spare_fixture=False):
        """SIGSTOP run processes so a killed observer cannot be recovered
        before the keepers die. The keeper reaps a dead observer within
        milliseconds, so killing without freezing lets keeper-side recovery
        finish first and leaves receive-side adoption nothing to adopt.
        With spare_fixture the live native keeps running so the test can
        still drive it while the frozen observer cannot observe."""
        for process in self.owned_processes():
            if spare_fixture and 'native fixture' in process['command']:
                continue
            try:
                os.kill(process['pid'], signal.SIGSTOP)
            except ProcessLookupError:
                pass

    @staticmethod
    def spared(command):
        """The live fixture's own command. Receivers name the fixture path
        as an argument, keepers and recoveries supervise it: only the bare
        fixture process itself is spared."""
        return ('native fixture' in command
                and 'receive parent' not in command
                and '--host-process-keeper' not in command
                and '--recover-receive' not in command
                and '--dispatch-message' not in command)

    def drain_others(self):
        """Kill every run process except the live fixture and wait until
        only it remains. A keeper-side recover orphan inherits the session
        lock; leaving it alive lets a second driver queue vacuously
        instead of deciding on custody."""
        for process in self.owned_processes():
            if self.spared(process['command']):
                continue
            try:
                os.kill(process['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.eventually(lambda: all(self.spared(process['command'])
                                    for process in self.run_processes()),
                        'run strays never drained')

    def assert_native_alive(self, directory, message):
        """The recorded native is a live non-zombie process. A test about a
        live child proves nothing if the child died unnoticed."""
        try:
            pid = int(pathlib.Path(directory, 'native.pid').read_text().split()[0])
            state = pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()[0]
        except (FileNotFoundError, ValueError, IndexError):
            self.fail(message)
        self.assertNotEqual(state, 'Z', message)

    def drain_owned(self):
        """Kill run stragglers and wait until none hold attempt pipes. A
        half-reaped keeper keeps the native's stdout open, so an adopter
        would block on read instead of reaching EOF; the status file alone
        does not prove the pipes are free. Zombies count too: an unreaped
        native still answers liveness probes, so adoption must wait for
        init to reap it."""
        for process in self.owned_processes():
            try:
                os.kill(process['pid'], signal.SIGKILL)
            except ProcessLookupError:
                pass
        self.eventually(lambda: not self.run_processes(),
                        'run processes never drained')

    def run_processes(self):
        """Every process of this run, including unreaped zombies."""
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                capture_output=True, text=True, check=True)
        found = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and str(self.directory) in fields[3]:
                found.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                              'status': fields[2], 'command': fields[3]})
        return found

    def kill_keeper(self, leader):
        """Kill the keeper processes of this run, freeing an inherited
        session lock. The leader driver is already dead; fixtures stay."""
        result = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, check=True)
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 1)
            if len(fields) != 2:
                continue
            pid, command = int(fields[0]), fields[1]
            if pid == leader.pid or 'native fixture' in command:
                continue
            if str(self.directory) in command:
                try:
                    os.kill(pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_wake_with_stale_running_phase_and_dead_native_takes_over_and_repairs_metadata(self):
        """A running phase with a genuinely dead native never suppresses the
        wake: the second admission's wake observes host death through the
        reaped status, repairs the stale execution row, and takes the
        obligation over with a fenced generation."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        self.action(control, ack=False)
        self.finish(first)
        self.assertEqual(self.execution('parent')[0], 'exited')
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        self.set_phase('parent', 'running')
        self.message('second', 'parent')
        self.assert_no_start()
        taken = self.claim_rows('parent')
        self.assertEqual(len(taken), 1)
        self.assertEqual(taken[0][2], 'first')
        self.assertGreater(taken[0][3], before[0][3])
        self.assertEqual(self.execution('parent')[:2], ('exited', 'owner-death'))
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])

    def test_direct_receive_recovers_a_dead_attempt_behind_a_stale_running_phase(self):
        """A direct receive reads terminal output after observer and owner loss.
        The adopted attempt records its report and observation markers, clears
        the satisfied claim, and retains the unknown native exit status.
        """
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        directory = self.execution('parent')[2]
        os.kill(first.pid, signal.SIGSTOP)
        self.action(control, body='Adopted result complete.', hold_exit=True)
        self.assertEqual(json.loads(control.readline()), {'terminal_written': True})
        self.eventually(lambda: 'Adopted result complete.' in
                        pathlib.Path(directory, 'stdout').read_text(),
                        'shared owner never spooled the driven native completion')
        self.freeze_owned()
        first.kill()
        first.wait()
        self.kill_keeper(first)
        self.kill_fixture()
        self.drain_owned()
        self.assertTrue(os.path.isfile(os.path.join(directory, 'manifest')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'acknowledged')),
                         'keeper recovered the killed observer before it died')
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')),
                         'keeper reaped the killed native before it died')
        second = self.spawn(*self.receive_args('parent'))
        _, error = self.finish(second, ok=False)
        self.assertIn('Native receive failed', error)
        self.assertEqual(self.execution('parent')[0], 'exited')
        self.assertEqual(self.claim_rows('parent'), [])
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')],
                         ['Adopted result complete.'])
        exits = [row for row in self.coord('inbox', 'root') if row['id'].endswith(':exit')]
        self.assertEqual(len(exits), 1)
        self.assertIn('unknown after keeper loss', exits[0]['body'])
        attempts = glob.glob(str(self.directory / '*.attempt-*'))
        self.assertEqual(len(attempts), 1)
        self.assertEqual(self.execution('parent')[2], attempts[0])
        self.assertTrue(os.path.isfile(os.path.join(directory, 'acknowledged')))
        self.assertTrue(os.path.isfile(os.path.join(directory, 'released')))
        self.assertFalse(os.path.exists(os.path.join(directory, 'status')))

    def test_direct_receive_behind_a_live_child_starts_no_second_turn(self):
        """A live retained child outlives its dead observer with the session
        lock free: a direct receive adopts rather than duplicating, so no
        second native conversation starts and the live claim row is intact."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        first.kill()
        first.wait()
        self.drain_others()
        directory = self.execution('parent')[2]
        self.assert_native_alive(directory, 'retained child died; the live-child premise is void')
        second = self.spawn(*self.receive_args('parent'))
        marker = 'original native observed by the adopted direct receiver'
        self.action(control, progress=marker)
        self.assertEqual(json.loads(control.readline()), {'progress_written': marker})
        log = self.output_log('parent')

        def adopted_output():
            if second.poll() is not None:
                self.fail(f'direct receiver exited before observing the retained child: {second.returncode}')
            return log.exists() and marker in log.read_text()

        self.eventually(adopted_output, 'direct receiver did not observe the retained child')
        self.assert_no_start()
        self.assertIsNone(second.poll(),
                          'direct receive exited instead of adopting the live attempt')
        self.assert_native_alive(directory, 'retained child died during adoption')
        self.assertEqual(self.claim_rows('parent'), before)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')], ['first'])

    def test_racing_wake_behind_a_live_child_launches_nothing_and_reclaims_nothing(self):
        """Two-driver launch handoff with a real live child: the winner holds
        a live native with the lock free, and the loser's admission wake
        stands down, so exactly one native conversation exists and the
        winner's claim row keeps its owner and generation."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        before = self.claim_rows('parent')
        self.assertEqual(len(before), 1)
        first.kill()
        first.wait()
        self.drain_others()
        directory = self.execution('parent')[2]
        self.assert_native_alive(directory, 'retained child died; the live-child premise is void')
        self.message('second', 'parent')
        self.assert_no_start()
        self.assert_native_alive(directory, 'retained child died during the racing wake')
        self.assertEqual(self.claim_rows('parent'), before)
        self.assertEqual([row['id'] for row in self.coord('inbox', 'parent')],
                         ['first', 'second'])

    def test_idle_arrival_starts_one_turn_and_leaves_no_duplicate(self):
        """A message admitted to an idle session with a recorded receiver starts one turn
        carrying that input, and the completed turn leaves no second turn behind."""
        self.player()
        self.connect('parent')
        delivery = self.spawn('message', 'idle-input', 'root', 'parent', 'guidance', 'Idle arrival.')
        control, started = self.accept('parent')
        self.assertIn('[id: idle-input]', started['prompt'])
        self.action(control)
        self.finish(delivery)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 1)

    def test_concurrent_sends_preserve_both_inputs_and_start_one_continuation(self):
        """Two arrivals against one live session are both carried by a single continuation
        turn, and no third turn or second native process appears."""
        self.player()
        self.prepare_input('first', 'parent')
        first = self.spawn(*self.receive_args('parent'))
        control, started = self.accept('parent')
        self.message('second', 'parent')
        self.message('third', 'parent')
        queued = self.coord(*self.receive_args('parent'))
        self.assertEqual(queued['status'], 'queued')
        self.assert_no_start()
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: second]', next_turn['prompt'])
        self.assertIn('[id: third]', next_turn['prompt'])
        self.action(control2)
        self.finish(first)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 2)
        self.assertEqual(self.coord('inbox', 'parent'), [])


    def inject(self, ident, recipient, kind='guidance', body='Injected input.'):
        with sqlite3.connect(str(self.db)) as database:
            database.execute('INSERT INTO messages(id, sender, recipient, kind, body) VALUES (?, ?, ?, ?, ?)',
                             (ident, 'root', recipient, kind, body))

    def test_input_behind_the_live_owner_is_woken_when_the_owner_exits(self):
        """A row inserted behind the live turn's cursor is never carried by that turn, and
        the wake driver hands it to a subsequent turn once the owner exits, once."""
        self.player()
        self.connect('parent')
        delivery = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'Carried input.')
        control, started = self.accept('parent')
        self.assertIn('[id: first]', started['prompt'])
        self.inject('late', 'parent')
        self.action(control)
        control2, next_turn = self.accept('parent')
        self.assertIn('[id: late]', next_turn['prompt'])
        self.action(control2)
        self.finish(delivery)
        self.assert_no_start()
        self.assertEqual(len(self.coord('turns', 'parent')), 2)
        self.assertEqual(self.coord('inbox', 'parent'), [])
        self.assertEqual(self.claims('parent'), [])


if __name__ == '__main__':
    unittest.main()
