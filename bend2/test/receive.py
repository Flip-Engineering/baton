"""Native inbox delivery with controlled harness processes and real coordinator state."""
import json
import pathlib
import select
import shlex
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

FIXTURE = r'''import json,pathlib,re,socket,subprocess,sys
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'fixture.json').read_text())
args=sys.argv[1:]
omp='--mode' in args
model=args[args.index('--model')+1]
resume=args[args.index('--resume')+1] if '--resume' in args else (args[2] if args[:2]==['exec','resume'] else '')
native='native-'+model
if omp:
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
client=socket.create_connection(('127.0.0.1',config['port']),timeout=10)
client.settimeout(20)
stream=client.makefile('rwb',buffering=0)
def reply(value): stream.write((json.dumps(value)+'\n').encode())
reply({'session':model,'native':native,'resume':resume,'args':args,'prompt':prompt})
while True:
    action=json.loads(stream.readline())
    if action.get('turn'):
        task=home/'self-turn-task'
        task.write_text('Synchronous task for the active session.')
        command=[config['exe'],config['db'],'turn',model,action['turn'],sys.argv[0],model,'low',str(home),str(task),str(home/'self-turn.jsonl'),'']
        try:
            result=subprocess.run(command,capture_output=True,text=True,timeout=2)
            reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        except subprocess.TimeoutExpired:
            reply({'timed_out':True})
        continue
    if action.get('message'):
        ident,recipient,body=action['message']
        result=subprocess.run([config['exe'],config['db'],'message',ident,model,recipient,'guidance',body],capture_output=True,text=True)
        reply({'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr})
        continue
    if action.get('ack',True):
        for ident in re.findall(r'^Message \([^\n]*\) from [^\n]* \[id: (.*?)\]:$',prompt,re.M):
            subprocess.run([config['exe'],config['db'],'ack',ident,model,'native-reviewed'],check=True,stdout=subprocess.DEVNULL)
    failure=action.get('fail',False)
    if omp:
        print(json.dumps({'type':'agent_end','isTerminal':True,'is_error':failure,'messages':[{'role':'assistant','content':[{'type':'text','text':'native review complete'}]}]}),flush=True)
        sys.stdin.read()
    elif failure:
        print(json.dumps({'type':'turn.failed','error':{'message':'fixture provider failed'}}),flush=True)
    else:
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':'native review complete'}}),flush=True)
        print(json.dumps({'type':'turn.completed'}),flush=True)
    if action.get('hold_exit'):
        reply({'terminal_written':True})
        json.loads(stream.readline())
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
        self.db = self.directory / 'state.db'
        self.fixture = self.directory / 'native fixture'
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.fixture.chmod(0o755)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(10)
        self.addCleanup(self.server.close)
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db),
        }))
        self.children = []
        self.controls = []
        self.addCleanup(self.close_children)
        self.coord('attach', 'root', 'codex', 'native-root', '')

    def close_children(self):
        for stream, connection in self.controls:
            try:
                stream.write(b'{"ack":false,"fail":true}\n')
            except (OSError, ValueError):
                pass
            try:
                stream.close()
            except OSError:
                pass
            connection.close()
        for child in self.children:
            if child.poll() is None:
                child.terminate()
            try:
                child.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()

    def coord(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, timeout=10)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)
        return result

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), str(self.db), *map(str, args)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def worker(self, name='parent', harness='codex'):
        self.coord('worker', name, 'root', harness, name, 'low', self.directory, name + '-branch', 'base')

    def receive_args(self, session, executable=None):
        return ['receive', session, str(executable or self.fixture), session, 'low',
                str(self.directory), str(self.directory / (session + '.jsonl')), '']

    def endpoint(self, session):
        return json.dumps([str(EXE), str(self.db), *self.receive_args(session)[:-1]])

    def connect(self, session):
        native = self.coord('session', session)['native']
        self.coord('connect', session, native, self.endpoint(session))

    def message(self, ident, recipient, body='Review this input.'):
        return self.coord('message', ident, 'root', recipient, 'guidance', body)

    def accept(self, session):
        connection, _ = self.server.accept()
        connection.settimeout(10)
        stream = connection.makefile('rwb', buffering=0)
        self.controls.append((stream, connection))
        started = json.loads(stream.readline())
        self.assertEqual(started['session'], session)
        return stream, started

    def action(self, stream, **value):
        stream.write((json.dumps(value) + '\n').encode())

    def finish(self, child, ok=True):
        stdout, stderr = child.communicate(timeout=15)
        if ok:
            self.assertEqual(child.returncode, 0, stderr)
        else:
            self.assertNotEqual(child.returncode, 0, stdout)
        return stdout, stderr

    def assert_no_start(self):
        self.assertEqual(select.select([self.server], [], [], .15)[0], [],
                         'another native process started while its session was active')

    def test_busy_direct_receive_drains_new_input_and_preserves_native_session(self):
        self.worker()
        self.message('first', 'parent')
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
            self.worker(name)
            self.message(name + '-input', name)
        left = self.spawn(*self.receive_args('left'))
        left_control, _ = self.accept('left')
        right = self.spawn(*self.receive_args('right'))
        right_control, _ = self.accept('right')
        self.action(left_control)
        self.action(right_control)
        self.finish(left)
        self.finish(right)

    def test_self_message_returns_and_continues_after_native_exit(self):
        self.worker()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.action(control, message=['self-message', 'parent', 'follow up'])
        response = json.loads(control.readline())
        self.assertEqual(response['code'], 0, response['stderr'])
        self.assert_no_start()
        self.action(control)
        second, started = self.accept('parent')
        self.assertIn('[id: self-message]', started['prompt'])
        self.action(second)
        self.finish(first)
        self.assertEqual(self.coord('inbox', 'parent'), [])

    def test_synchronous_self_turn_reports_busy_and_native_work_continues(self):
        self.worker()
        self.message('first', 'parent')
        child = self.spawn(*self.receive_args('parent'))
        control, _ = self.accept('parent')
        self.action(control, turn='self-turn')
        response = json.loads(control.readline())
        self.assertFalse(response.get('timed_out'), 'synchronous self-turn waited for its own session lock')
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
        self.worker()
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
        self.worker()
        self.connect('parent')
        first = self.spawn('message', 'first', 'root', 'parent', 'guidance', 'first input')
        control, _ = self.accept('parent')
        self.message('second', 'parent')
        self.action(control)
        started = {}
        for _ in range(2):
            connection, _ = self.server.accept()
            connection.settimeout(10)
            stream = connection.makefile('rwb', buffering=0)
            self.controls.append((stream, connection))
            event = json.loads(stream.readline())
            started[event['session']] = stream
        self.assertEqual(set(started), {'root', 'parent'})
        self.action(started['parent'], fail=True, ack=False)
        deadline = time.monotonic() + 10
        while not any('fixture provider failed' in m['body'] for m in self.coord('inbox', 'root')):
            self.assertLess(time.monotonic(), deadline, 'failed queued turn did not report')
            time.sleep(.01)
        with self.assertRaises(subprocess.TimeoutExpired):
            first.wait(timeout=.15)
        self.action(started['root'])
        # The failed second turn produces a new report while root was reviewing the first.
        root_again, _ = self.accept('root')
        self.action(root_again)
        self.finish(first, ok=False)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['second'])
        self.assertEqual(self.coord('inbox', 'root'), [])

    def test_startup_and_terminal_failures_leave_input_available_for_retry(self):
        self.worker()
        self.message('input', 'parent')
        missing = self.coord(*self.receive_args('parent', self.directory / 'missing executable'), ok=False)
        self.assertNotEqual(missing.returncode, 0)
        self.assertEqual([m['id'] for m in self.coord('inbox', 'parent')], ['input'])
        startup_report = next(m for m in self.coord('inbox', 'root') if 'could not start' in m['body'])
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
        self.assertEqual(self.coord('turns', 'root'), [])

    def test_turn_and_receive_share_ownership_and_omp_session_file(self):
        self.worker(harness='omp')
        self.coord('message', 'preexisting', 'root', 'parent', 'report', 'Already pending before turn.')
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
        self.worker()
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
        self.worker()
        report = self.directory / 'large report'
        report.write_text('retained report\n' * 30000)
        self.coord('report-file', 'saved-turn', 'parent', report)
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


if __name__ == '__main__':
    unittest.main()
