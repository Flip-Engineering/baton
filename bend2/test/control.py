"""Native control commands with retained fixture processes and real Git worktrees."""
import json
import os
import pathlib
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'

FIXTURE = r'''import json,os,pathlib,re,socket,subprocess,sys
home=pathlib.Path(__file__).resolve().parent
with (home/'child-entries.jsonl').open('a') as entry:
    entry.write(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),
                            'argv':sys.argv,'cwd':os.getcwd()})+'\n')
config=json.loads((home/'fixture.json').read_text())
args=sys.argv[1:]
model=args[args.index('--model')+1]
session=config.get('sessions',{}).get(model,model)
omp='--mode' in args
muse='--prompt-file' in args
claude='--input-format' in args
native_args=args[2:] if args[:2]==['-c','forced_login_method="chatgpt"'] else args
resume=args[args.index('--resume')+1] if '--resume' in args else (
    args[args.index('--session-id')+1] if '--session-id' in args else (
    native_args[2] if native_args[:2]==['exec','resume'] else ''))
native=resume or ('native-'+session)
if omp:
    json.loads(sys.stdin.readline())
    state=json.loads(sys.stdin.readline())
    prompt=json.loads(sys.stdin.readline())['message']
    storage=pathlib.Path(args[args.index('--session-dir')+1])
    storage.mkdir(parents=True,exist_ok=True)
    if resume and pathlib.Path(resume).is_file():
        native=json.loads(pathlib.Path(resume).read_text().splitlines()[0])['id']
    else:
        (storage/('fixture_'+native+'.jsonl')).write_text(json.dumps({'type':'session','id':native})+'\n')
    print(json.dumps({'type':'response','command':'get_state','success':True,'id':state['id'],
                     'data':{'sessionId':native,'model':{'provider':'fixture','id':model}}}),flush=True)
elif muse:
    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.model.configured',
                     'payload':{'kind':'run_model_configured','model_id':model}}),flush=True)
elif claude:
    prompt=json.loads(sys.stdin.readline())['message']['content']
    print(json.dumps({'type':'system','subtype':'init','session_id':native,'model':model}),flush=True)
else:
    prompt=sys.stdin.read()
    print(json.dumps({'type':'thread.started','thread_id':native}),flush=True)
client=socket.create_connection(('127.0.0.1',config['port']))
stream=client.makefile('rwb',buffering=0)
def reply(value): stream.write((json.dumps(value)+'\n').encode())
def command(*value):
    result=subprocess.run([config['exe'],config['db'],*value],capture_output=True,text=True)
    return {'code':result.returncode,'stdout':result.stdout,'stderr':result.stderr}
def acknowledge():
    for ident in re.findall(r'^Message \([^\n]*\) from [^\n]* \[id: (.*?)\]:$',prompt,re.M):
        accepted=command('ack',ident,session,'fixture-native-reviewed')
        assert accepted['code']==0,accepted
reply({'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'session':session,
       'native':native,'resume':resume,'args':args,'prompt':prompt,'cwd':os.getcwd(),
       'apiKeyVariablesPresent':[key for key in ('OPENAI_API_KEY','CODEX_API_KEY') if key in os.environ]})
while True:
    line=stream.readline()
    if not line: break
    action=json.loads(line)
    if action.get('exit_fixture'): break
    if action.get('ack'):
        acknowledge()
        reply({'acknowledged':True})
        continue
    if action.get('public_report'):
        ident,body=action['public_report']
        reply(command('message',ident,session,'operator','report',body))
        continue
    if action.get('read_steer'):
        print(json.dumps({'type':'tool_execution_start','toolName':'fixture-guidance-boundary'}),flush=True)
        frame=json.loads(sys.stdin.readline())
        assert frame['type']=='steer',frame
        print(json.dumps({'type':'response','command':'steer','success':True,'id':frame['id']}),flush=True)
        reply({'steer':frame})
        continue
    if action.get('output'):
        text=action['output']
        print(json.dumps({'type':'fixture_output','text':text}),flush=True)
        print('fixture diagnostic',file=sys.stderr,flush=True)
        reply({'output_written':len(text)})
        continue
    acknowledge()
    body=action['finish']
    if omp:
        print(json.dumps({'type':'agent_end','isTerminal':True,
                         'messages':[{'role':'assistant','content':[{'type':'text','text':body}]}]}),flush=True)
        sys.stdin.read()
    elif muse:
        print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.completed',
                         'payload':{'kind':'run_terminal','terminal':'completed','text':body}}),flush=True)
    elif claude:
        print(json.dumps({'type':'result','session_id':native,'result':body,'is_error':False}),flush=True)
    else:
        print(json.dumps({'type':'item.completed','item':{'type':'agent_message','text':body}}),flush=True)
        print(json.dumps({'type':'turn.completed'}),flush=True)
    reply({'terminal_written':True})
    break
stream.close()
client.close()
'''


class Control(unittest.TestCase):
    def setUp(self, *, preserve_home=False):
        self.assertTrue(EXE.is_file(), f'Coordinator must be built at {EXE}')
        retained = ROOT / '.scratch/bend2/control-fixtures'
        retained.mkdir(parents=True, exist_ok=True)
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix="control ' λ ", dir=retained))
        self.home = self.directory / 'isolated-home'
        self.home.mkdir()
        self.environment = dict(os.environ, OPENAI_API_KEY='fixture-unused', CODEX_API_KEY='fixture-unused')
        if preserve_home:
            for key in list(self.environment):
                if key in ('GIT_CONFIG_PARAMETERS', 'GIT_CONFIG_COUNT') or key.startswith(('GIT_CONFIG_KEY_', 'GIT_CONFIG_VALUE_')):
                    del self.environment[key]
            self.environment.update(GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM='1')
        else:
            self.environment['HOME'] = str(self.home)
        self.environment.pop('BATON2_GIT_REGISTRY', None)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for args in (['init', '-q', '-b', 'main'], ['config', 'user.name', 'Control fixture'],
                     ['config', 'user.email', 'fixture@example.invalid']):
            self.git(*args)
        (self.repo / 'seed.txt').write_text('seed\n')
        self.git('add', 'seed.txt')
        self.git('commit', '-q', '-m', 'Fixture seed')
        self.base = self.git('rev-parse', 'HEAD').stdout.strip()
        self.db = self.directory / 'state.db'
        self.task = self.directory / 'task.txt'
        self.task.write_text('Retain the assigned work.\nReview "quotes", λ and 🙂.\n')
        self.fixture = self.directory / 'native fixture'
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.fixture.chmod(0o755)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(10)
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db)}))
        self.controls = []
        self.dispatches = []
        self.addCleanup(self.close_fixtures)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], env=self.environment,
                              check=True, capture_output=True, text=True, timeout=10)

    def call(self, *args, ok=True, raw=False):
        child = subprocess.Popen([str(EXE), str(self.db), *map(str, args)],
                                 env=self.environment, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        stdout, stderr = child.communicate(timeout=10)
        record = {'argv': list(map(str, args)), 'pid': child.pid, 'code': child.returncode,
                  'stdout': stdout, 'stderr': stderr, 'direct_wait_completed': True}
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps(record) + '\n')
        if ok:
            self.assertEqual(child.returncode, 0, stderr)
        else:
            self.assertNotEqual(child.returncode, 0, stdout)
        return record if raw or not ok else json.loads(stdout)

    def root(self):
        self.call('attach', 'root', 'codex', 'saved-root', '')
        self.call('role', 'root', 'principal-conductor')
        self.call('attach', 'operator', 'operator', '', '')
        self.call('role', 'operator', 'operator')

    def recruit(self, session, harness='omp', parent='root'):
        return self.call('recruit', session, parent, harness, session, 'low',
                         self.repo, session + '-branch', self.checkouts / session, self.base)

    def receiver(self, session):
        log = self.directory / (session + '.jsonl')
        result = self.call('receiver', session, self.fixture, log)
        self.assertEqual(result['endpoint'], [str(EXE.resolve()), str(self.db.resolve()),
                                             'receive', session, str(self.fixture.resolve()),
                                             '', '', '', str(log.resolve())])
        return log

    def dispatch(self, *args):
        result = self.call(*args)
        self.assertEqual(result['state'], 'launched')
        self.assertGreater(result['deliveryPid'], 0)
        self.dispatches.append(result['deliveryPid'])
        return result

    def accept(self, session):
        connection, _ = self.server.accept()
        connection.settimeout(10)
        stream = connection.makefile('rwb', buffering=0)
        self.controls.append((stream, connection))
        start = json.loads(stream.readline())
        self.assertEqual(start['session'], session)
        entries = [json.loads(line) for line in
                   (self.directory / 'child-entries.jsonl').read_text().splitlines()]
        entry = next(row for row in entries if row['pid'] == start['pid'])
        self.assertEqual(entry['argv'], [str(self.fixture.resolve()), *start['args']])
        self.assertEqual(entry['cwd'], start['cwd'])
        with (self.directory / 'native-starts.jsonl').open('a') as output:
            output.write(json.dumps(start) + '\n')
        return stream, start

    def action(self, stream, **value):
        connection = next(connection for candidate, connection in self.controls if candidate is stream)
        connection.sendall((json.dumps(value) + '\n').encode())
        return json.loads(stream.readline())

    def finish(self, stream, body='Fixture native task completed.'):
        self.assertEqual(self.action(stream, finish=body), {'terminal_written': True})
        self.assertEqual(stream.readline(), b'')

    def rows(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute(sql, parameters)]

    def eventually(self, observation):
        deadline = time.monotonic() + 10
        while True:
            result = observation()
            if result:
                return result
            self.assertLess(time.monotonic(), deadline, 'Controlled fixture did not complete its requested state.')
            time.sleep(.01)

    def process_rows(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                check=True, capture_output=True, text=True)
        return [line for line in result.stdout.splitlines()
                if str(self.directory) in line and not line.strip().split(None, 3)[2].startswith('Z')]

    def exited(self, session):
        row = self.eventually(lambda: next((row for row in self.rows(
            'SELECT * FROM executions WHERE session=?', (session,))
            if row['phase'] == 'exited'), None))
        self.assertEqual(row['status'], 'exit 0')
        return row

    def close_fixtures(self):
        for stream, connection in self.controls:
            try:
                connection.sendall(b'{"exit_fixture":true}\n')
            except (OSError, ValueError):
                pass
            try:
                stream.close()
            except OSError:
                pass
            connection.close()
        self.server.close()
        self.eventually(lambda: not self.process_rows())

    def test_start_detaches_native_subscription_and_operator_report(self):
        for harness in ('codex', 'omp'):
            with self.subTest(harness=harness):
                name = 'principal-' + harness
                log = self.directory / (name + '.jsonl')
                launched = self.dispatch('start', name, harness, self.fixture, name, 'low',
                                         self.repo, log, name + '-task', self.task)
                stream, native = self.accept(name)
                self.assertEqual(os.getpgid(launched['deliveryPid']), launched['deliveryPid'])
                self.assertEqual(native['cwd'], str(self.repo.resolve()))
                self.assertIn(self.task.read_text(), native['prompt'])
                self.assertEqual(native['args'][native['args'].index('--model') + 1], name)
                if harness == 'codex':
                    self.assertEqual(native['args'][:2], ['-c', 'forced_login_method="chatgpt"'])
                    configs = [native['args'][index + 1] for index, arg in enumerate(native['args']) if arg == '-c']
                    self.assertEqual(configs, ['forced_login_method="chatgpt"', 'model_reasoning_effort="low"'])
                    self.assertEqual(native['apiKeyVariablesPresent'], [])
                else:
                    self.assertEqual(native['args'][native['args'].index('--thinking') + 1], 'low')
                player = self.call('player', name)
                self.assertEqual(player['role'], 'principal-conductor')
                self.assertIsNone(player['parent'])
                self.assertEqual((player['model'], player['effort'], player['workspace']),
                                 (name, 'low', str(self.repo.resolve())))
                endpoint = json.loads(player['endpoint'])
                self.assertEqual(endpoint[-4:], ['', '', '', str(log.resolve())])
                report = "Reviewed native operator report λ.\nIt's complete. 🙂\n" * 6000
                self.finish(stream, report)
                self.exited(name)
                turns = self.eventually(lambda: self.call('turns', name))
                self.assertEqual(len(turns), 1)
                saved = self.call('delivery', turns[0]['id'])
                self.assertEqual((saved['sender'], saved['recipient'], saved['kind'], saved['body']),
                                 (name, 'operator', 'report', report))
                self.assertEqual(turns[0]['reportBody'], report)
                self.assertIsNone(saved['receipt'])
                inbox = self.call('inbox', 'operator')
                self.assertEqual(next(row for row in inbox if row['id'] == saved['id'])['body'], report)
                self.call('ack', saved['id'], 'operator', 'operator-reviewed-native-result')
                self.assertEqual(self.call('delivery', saved['id'])['receipt'], 'operator-reviewed-native-result')
                self.assertEqual(self.call('delivery', name + '-task')['receipt'], 'fixture-native-reviewed')

    def test_start_upgrades_compatible_parentless_assignment_and_resumes_saved_native(self):
        self.call('attach', 'principal', 'codex', 'saved-native', '')
        launched = self.dispatch('start', 'principal', 'codex', self.fixture, 'principal', 'low',
                                 self.repo, self.directory / 'principal.jsonl', 'start-task', self.task)
        stream, native = self.accept('principal')
        self.assertEqual(native['args'][2:5], ['exec', 'resume', 'saved-native'])
        self.assertEqual(self.call('player', 'principal')['role'], 'principal-conductor')
        self.assertGreater(launched['deliveryPid'], 0)
        self.finish(stream)
        self.exited('principal')
        self.assertEqual(self.call('player', 'principal')['native'], 'saved-native')

    def test_start_assignment_conflicts_keep_native_parent_and_pending_input(self):
        self.root()
        self.recruit('assigned', 'codex')
        self.call('connect', 'assigned', 'saved-native', '')
        self.call('message', 'pending-task', 'root', 'assigned', 'task', self.task.read_text())
        before = self.rows('SELECT * FROM sessions ORDER BY id'), self.rows('SELECT * FROM messages ORDER BY seq')
        self.call('start', 'assigned', 'codex', self.fixture, 'assigned', 'low', self.repo,
                  self.directory / 'refused.jsonl', 'refused-task', self.task, ok=False)
        self.assertEqual((self.rows('SELECT * FROM sessions ORDER BY id'),
                          self.rows('SELECT * FROM messages ORDER BY seq')), before)
        self.assertEqual(self.call('player', 'assigned')['parent'], 'root')
        self.assertEqual(self.call('player', 'assigned')['native'], 'saved-native')
        self.dispatch('start', 'root', 'codex', self.fixture, 'root', 'high', self.repo,
                      self.directory / 'root-assignment.jsonl', 'root-assignment', self.task)
        stream, _ = self.accept('root')
        self.finish(stream)
        self.exited('root')
        before = self.call('player', 'root')
        for harness, model, effort, cwd in (('omp', 'root', 'high', self.repo),
                                           ('codex', 'other-model', 'high', self.repo),
                                           ('codex', 'root', 'low', self.repo),
                                           ('codex', 'root', 'high', self.directory)):
            self.call('start', 'root', harness, self.fixture, model, effort, cwd,
                      self.directory / 'refused-root.jsonl', 'conflicting-task', self.task, ok=False)
            self.assertEqual(self.call('player', 'root'), before)
        self.assertEqual(self.rows("SELECT * FROM executions WHERE session='assigned'"), [])
        self.assertFalse(self.dispatch_log('refused-task').exists())
        self.assertFalse(self.dispatch_log('conflicting-task').exists())
        self.assertIsNone(self.call('delivery', 'pending-task')['receipt'])

    def test_receiver_refuses_unsupported_stopped_and_missing_sessions(self):
        self.root()
        for harness in ('muse', 'claude-code'):
            self.recruit(harness, harness)
            self.call('connect', harness, 'saved-' + harness, '')
            before = self.call('player', harness)
            self.call('receiver', harness, self.fixture, self.directory / (harness + '.jsonl'), ok=False)
            self.assertEqual(self.call('player', harness), before)
        self.recruit('stopped')
        self.call('message', 'retained', 'root', 'stopped', 'task', self.task.read_text())
        self.call('stop', 'stopped', 'idle-stop', 'Controlled idle stop.')
        before = self.call('player', 'stopped')
        self.call('receiver', 'stopped', self.fixture, self.directory / 'stopped.jsonl', ok=False)
        self.call('dispatch-turn', 'stopped', 'refused-turn', self.fixture,
                  self.directory / 'stopped.jsonl', self.task, ok=False)
        self.assertEqual(self.call('player', 'stopped'), before)
        self.assertIsNone(self.call('delivery', 'retained')['receipt'])
        self.call('receiver', 'missing', self.fixture, self.directory / 'missing.jsonl', ok=False)
        self.assertEqual(self.rows('SELECT * FROM executions'), [])

    def test_detached_file_dispatch_uses_recorded_route_and_live_omp_guidance(self):
        self.root()
        assignment = self.recruit('leaf')
        log = self.receiver('leaf')
        self.dispatch('dispatch-file', 'leaf-task', 'root', 'leaf', 'task', self.task)
        stream, native = self.accept('leaf')
        self.assertEqual(native['cwd'], assignment['workspace'])
        self.assertEqual(native['args'][native['args'].index('--thinking') + 1], 'low')
        self.assertEqual(self.action(stream, ack=True), {'acknowledged': True})
        guidance = self.directory / 'guidance.txt'
        guidance.write_text('Preserve existing work.\nApply this mid-task correction λ.')
        self.dispatch('dispatch-file', 'leaf-guidance', 'root', 'leaf', 'guidance', guidance)
        accepted = self.action(stream, read_steer=True)['steer']
        self.assertIn(guidance.read_text(), accepted['message'])
        self.eventually(lambda: self.call('delivery', 'leaf-guidance')['receipt'])
        self.assertEqual(self.call('player', 'leaf')['native'], native['native'])
        self.finish(stream, 'Live guidance applied.')
        self.exited('leaf')
        self.assertEqual(self.call('turns', 'leaf')[0]['reportBody'], 'Live guidance applied.')
        self.assertTrue(log.is_file())
        denied = self.call('dispatch-file', 'wrong-route', 'operator', 'leaf', 'task', self.task, ok=False)
        self.assertIn('message-route-denied', denied['stderr'])
        self.assertEqual(self.rows("SELECT * FROM messages WHERE id='wrong-route'"), [])
        self.assertFalse(self.dispatch_log('wrong-route').exists())

    def test_independent_players_overlap_and_large_output_uses_regular_dispatch_streams(self):
        self.root()
        streams = []
        for name, harness in (('omp-leaf', 'omp'), ('codex-leaf', 'codex')):
            self.recruit(name, harness)
            self.receiver(name)
            self.dispatch('dispatch-file', name + '-task', 'root', name, 'task', self.task)
            stream, native = self.accept(name)
            streams.append((name, stream, native))
        for name, _, native in streams:
            self.assertTrue(os.getpgid(native['pid']))
            self.eventually(lambda: self.call('player', name)['native'] == native['native'])
        text = 'fixture output λ ' * 30000
        self.assertEqual(self.action(streams[0][1], output=text), {'output_written': len(text)})
        for name, stream, _ in streams:
            body = text if name == 'omp-leaf' else 'Concurrent Codex task completed.'
            self.finish(stream, body)
            self.exited(name)
            self.assertEqual(self.call('turns', name)[0]['reportBody'], body)
            stdout = self.dispatch_log(name + '-task')
            stderr = self.dispatch_log(name + '-task', '.stderr')
            self.assertTrue(stat.S_ISREG(stdout.stat().st_mode))
            self.assertTrue(stat.S_ISREG(stderr.stat().st_mode))
            self.eventually(lambda: self.report_logged(body))
        frames = [json.loads(line) for line in (self.directory / 'omp-leaf.jsonl').read_text().splitlines()]
        self.assertIn(text, [frame.get('text') for frame in frames])

    def dispatch_log(self, ident, suffix='.stdout'):
        return pathlib.Path(str(self.db) + '.dispatch-' + ident.encode().hex() + suffix)

    def report_logged(self, body):
        log = pathlib.Path(str(self.db) + '.root.log')
        if not log.exists():
            return False
        for line in log.read_text().splitlines():
            if not line.startswith('{'):
                continue
            try:
                saved = json.loads(line)
            except json.JSONDecodeError:
                return False
            if saved.get('body') == body:
                return True
        return False

    def test_dispatch_stream_refuses_symlink_and_fifo_and_retains_committed_input(self):
        self.root()
        self.recruit('leaf')
        original = self.directory / 'preserved-output'
        original.write_text('Unrelated fixture bytes remain.\n')
        for kind in ('symlink', 'fifo'):
            ident = 'unsafe-' + kind
            output = self.dispatch_log(ident)
            if kind == 'symlink':
                output.symlink_to(original)
            else:
                os.mkfifo(output)
            self.call('dispatch-file', ident, 'root', 'leaf', 'task', self.task, ok=False)
            saved = self.call('delivery', ident)
            self.assertEqual((saved['sender'], saved['recipient'], saved['body'], saved['receipt']),
                             ('root', 'leaf', self.task.read_text(), None))
            self.assertEqual(original.read_text(), 'Unrelated fixture bytes remain.\n')
            self.assertEqual(self.rows('SELECT * FROM executions'), [])
            mode = output.lstat().st_mode
            self.assertTrue(stat.S_ISLNK(mode) if kind == 'symlink' else stat.S_ISFIFO(mode))

    def test_dispatch_turn_uses_saved_muse_and_claude_assignment_and_native_identity(self):
        self.root()
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'direct-' + harness
                assignment = self.recruit(session, harness)
                self.call('connect', session, 'saved-' + session, '')
                native = 'saved-' + session
                for step in ('first', 'second'):
                    ident = session + '-' + step
                    log = self.directory / (ident + '.jsonl')
                    self.dispatch('dispatch-turn', session, ident, self.fixture, log, self.task)
                    stream, start = self.accept(session)
                    self.assertEqual(start['cwd'], assignment['workspace'])
                    self.assertEqual(start['resume'], native)
                    self.assertEqual(start['prompt'], self.task.read_text())
                    effort_option = '--reasoning-effort' if harness == 'muse' else '--effort'
                    self.assertEqual(start['args'][start['args'].index(effort_option) + 1], 'low')
                    self.finish(stream, ident + ' completed.')
                    self.eventually(lambda: any(row['id'] == ident for row in self.call('turns', session)))
                    self.assertEqual(self.call('delivery', ident)['recipient'], 'root')
                    self.assertEqual(self.call('player', session)['native'], native)
                    self.eventually(lambda: not self.process_rows())

    def test_pretty_reads_preserve_complete_machine_fields_and_long_report(self):
        self.root()
        self.recruit('leaf', 'muse')
        body = 'A complete retained report λ.\n' * 100
        self.call('report', 'review-report', 'leaf', body)
        event = self.directory / 'pretty-event.json'
        event.write_text(json.dumps({'type': 'result', 'session_id': 'native-pretty',
                                     'result': body, 'is_error': False}))
        self.call('observe-file', 'review-report', 'leaf', event)
        for args in (('status',), ('players',), ('orchestra',), ('pending',), ('player', 'leaf'),
                     ('session', 'leaf'), ('inbox', 'root'), ('delivery', 'review-report'), ('turns', 'leaf')):
            with self.subTest(args=args):
                ordinary = self.call(*args, raw=True)
                readable = self.call(*args, '--pretty', raw=True)
                self.assertEqual(json.loads(readable['stdout']), json.loads(ordinary['stdout']))
                self.assertIn('\n', readable['stdout'].strip())
        self.assertEqual(self.call('delivery', 'review-report', '--pretty')['body'], body)
        missing = self.call('player', 'missing-player', '--pretty', ok=False)
        self.assertEqual(missing['code'], 1)
        self.assertEqual(missing['stdout'], '')
        self.assertEqual(missing['stderr'].strip(),
                         'No matching session or message; inspect status and the requested ID.')
        self.assertEqual(self.rows("SELECT * FROM sessions WHERE id='missing-player'"), [])

    def test_readers_present_the_registered_endpoint_argv_and_keep_the_stored_text(self):
        self.root()
        self.recruit('leaf', 'muse')
        endpoint = json.dumps(['/usr/bin/true', 'leaf', ''])
        connected = self.call('connect', 'leaf', 'native-leaf', endpoint)
        self.assertEqual(connected['endpoint'], endpoint)
        self.assertEqual(connected['endpointArgv'], ['/usr/bin/true', 'leaf', ''])
        self.call('message', 'leaf-guide', 'root', 'leaf', 'guidance', 'Continue.')
        session = self.call('session', 'leaf')
        self.assertEqual(session['endpoint'], endpoint)
        self.assertEqual(session['endpointArgv'], ['/usr/bin/true', 'leaf', ''])
        self.assertEqual(self.call('player', 'leaf')['endpointArgv'], ['/usr/bin/true', 'leaf', ''])
        self.assertIsNone(self.call('session', 'root')['endpointArgv'])
        rows = {row['id']: row for row in self.call('status')}
        self.assertEqual(rows['leaf']['endpointArgv'], ['/usr/bin/true', 'leaf', ''])
        self.assertIsNone(rows['root']['endpointArgv'])
        self.assertEqual(self.call('delivery', 'leaf-guide')['endpointArgv'], ['/usr/bin/true', 'leaf', ''])
        pending = {row['id']: row for row in self.call('pending')}
        self.assertEqual(pending['leaf-guide']['endpointArgv'], ['/usr/bin/true', 'leaf', ''])

    def test_pretty_knowledge_preserves_visibility_and_complete_finding(self):
        self.root()
        self.recruit('researcher', 'muse')
        self.recruit('sibling', 'muse')
        body = 'Retained evidence λ.\nFull details with "quotes".\n'
        self.call('report', 'finding-evidence', 'researcher', body)
        self.call('record', 'finding', 'researcher', 'Observed claim λ.',
                  'message:finding-evidence', 'One controlled fixture.')
        for reader in ('researcher', 'root', 'sibling', 'missing-reader'):
            with self.subTest(reader=reader):
                ordinary = self.call('knowledge', reader, raw=True)
                before = self.rows('SELECT * FROM knowledge'), self.rows('SELECT * FROM knowledge_promotions'), self.rows('SELECT * FROM messages')
                readable = self.call('knowledge', reader, '--pretty', raw=True)
                value = json.loads(readable['stdout'])
                self.assertEqual(value, json.loads(ordinary['stdout']))
                self.assertEqual(before, (self.rows('SELECT * FROM knowledge'), self.rows('SELECT * FROM knowledge_promotions'), self.rows('SELECT * FROM messages')))
                if reader in ('researcher', 'root'):
                    self.assertEqual(value[0]['evidenceMessage']['body'], body)
                    self.assertEqual(value[0]['limits'], 'One controlled fixture.')
                    self.assertIn('\n', readable['stdout'].strip())
                else:
                    self.assertEqual(value, [])

    def test_pretty_worktree_reads_fresh_status_and_preserves_fields(self):
        self.root()
        assignment = self.recruit('leaf-λ', 'muse')
        for dirty in (False, True):
            with self.subTest(dirty=dirty):
                if dirty:
                    (pathlib.Path(assignment['workspace']) / 'untracked λ.txt').write_text('retained work\n')
                ordinary = self.call('worktree', 'leaf-λ', raw=True)
                readable = self.call('worktree', 'leaf-λ', '--pretty', raw=True)
                value = json.loads(readable['stdout'])
                self.assertEqual(value, json.loads(ordinary['stdout']))
                self.assertEqual(value, {'id': 'leaf-λ', 'workspace': assignment['workspace'],
                                         'branch': 'leaf-λ-branch', 'commit': self.base, 'dirty': dirty})
                self.assertIn('\n', readable['stdout'].strip())

    def test_pretty_worktree_preserves_missing_session_refusal(self):
        self.root()
        ordinary = self.call('worktree', 'missing-player', ok=False)
        readable = self.call('worktree', 'missing-player', '--pretty', ok=False)
        self.assertEqual(readable['code'], 2)
        self.assertEqual(readable['stdout'], ordinary['stdout'])
        self.assertEqual(readable['stderr'], ordinary['stderr'])
        self.assertEqual(readable['stderr'].strip(), 'The player has no recorded workspace.')
        self.assertEqual(self.rows("SELECT * FROM sessions WHERE id='missing-player'"), [])


if __name__ == '__main__':
    unittest.main()
