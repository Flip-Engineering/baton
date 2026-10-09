"""Native control commands with retained fixture processes and real Git worktrees."""
import json
import os
import pathlib
import signal
import socket
import sqlite3
import stat
import subprocess
import sys
import tempfile
import time
import unittest

from receive import install_public_queue_codex


ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'


def shutdown_fixture_owner(case):
    config = json.loads((case.directory / 'fixture.json').read_text())
    argv = [config['exe'], '--instance-shutdown', str(case.db)]
    result = subprocess.run(argv, env=case.environment, capture_output=True,
                            text=True)
    with (case.directory / 'commands.jsonl').open('a') as output:
        output.write(json.dumps({'argv': argv, 'code': result.returncode,
                                 'stdout': result.stdout, 'stderr': result.stderr,
                                 'direct_wait_completed': True}) + '\n')
    case.assertEqual(result.returncode, 0, result.stderr)


FIXTURE = r'''import json,os,pathlib,re,socket,subprocess,sys
home=pathlib.Path(__file__).resolve().parent
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
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user',
                     'payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}),flush=True)
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
                         'payload':{'kind':'run_terminal','terminal':'completed',
                                    'command_id':'fixture-primary','text':body}}),flush=True)
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
    def setUp(self):
        self.assertTrue(EXE.is_file(), f'Coordinator must be built at {EXE}')
        evidence = os.environ.get('FINAL_NATIVE_CONTEXT_EVIDENCE')
        retained = (pathlib.Path(evidence) if evidence else ROOT / '.scratch/bend2') / 'control-fixtures'
        retained.mkdir(parents=True, exist_ok=True)
        self.directory = pathlib.Path(tempfile.mkdtemp(prefix="control ' λ ", dir=retained))
        self.public_queue_calls = install_public_queue_codex(self, self.directory)
        self.home = self.directory / 'isolated-home'
        self.home.mkdir()
        self.environment = dict(os.environ, HOME=str(self.home),
                                OPENAI_API_KEY='fixture-unused', CODEX_API_KEY='fixture-unused')
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
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db)}))
        self.controls = []
        self.dispatches = []
        self.addCleanup(self.close_fixtures)

    def git(self, *args):
        return subprocess.run(['git', '-C', str(self.repo), *args], env=self.environment,
                              check=True, capture_output=True, text=True)

    def call(self, *args, ok=True, raw=False):
        child = subprocess.Popen([str(EXE), str(self.db), *map(str, args)],
                                 env=self.environment, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        stdout, stderr = child.communicate()
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

    def project_call(self, path, *args, ok=True):
        argv = ['--project', str(path), *map(str, args)]
        result = subprocess.run([str(EXE), *argv], env=self.environment,
                                capture_output=True, text=True)
        record = {'argv': argv, 'code': result.returncode,
                  'stdout': result.stdout, 'stderr': result.stderr}
        with (self.directory / 'commands.jsonl').open('a') as output:
            output.write(json.dumps(record) + '\n')
        if not ok:
            self.assertNotEqual(result.returncode, 0, result.stdout)
            return record
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

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

    def output_log(self, session):
        rows = self.rows(
            "SELECT g.log FROM log_generations g WHERE g.session=? "
            "ORDER BY CASE WHEN g.attempt=(SELECT id FROM executions WHERE session=g.session) "
            "THEN 0 ELSE 1 END, g.rowid DESC LIMIT 1", (session,))
        self.assertTrue(rows, f'{session} has no registered output log generation')
        return pathlib.Path(rows[0]['log'])

    def dispatch(self, *args):
        result = self.call(*args)
        self.assertEqual(result['state'], 'launched')
        self.assertGreater(result['deliveryPid'], 0)
        self.dispatches.append(result['deliveryPid'])
        return result

    def accept(self, session):
        connection, _ = self.server.accept()
        stream = connection.makefile('rwb', buffering=0)
        self.controls.append((stream, connection))
        start = json.loads(stream.readline())
        self.assertEqual(start['session'], session)
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
        while True:
            result = observation()
            if result:
                return result
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
        shutdown_fixture_owner(self)
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

    def test_receiver_refreshes_stopped_and_refuses_unsupported_or_missing_sessions(self):
        self.root()
        harness = 'unsupported-harness'
        self.call('attach', harness, harness, 'saved-' + harness, '')
        before = self.call('player', harness)
        self.call('receiver', harness, self.fixture, self.directory / (harness + '.jsonl'), ok=False)
        self.assertEqual(self.call('player', harness), before)
        self.recruit('stopped')
        self.call('connect', 'stopped', 'saved-stopped-native', '')
        self.call('message', 'retained', 'root', 'stopped', 'task', self.task.read_text())
        self.call('stop', 'stopped', 'idle-stop', 'Controlled idle stop.')
        before = self.call('player', 'stopped')
        stops = self.rows('SELECT * FROM session_stops WHERE session=?', ('stopped',))
        self.receiver('stopped')
        refreshed = self.call('player', 'stopped')
        for field in ('id', 'parent', 'native', 'harness', 'model', 'effort',
                      'workspace', 'branch', 'base', 'stop'):
            self.assertEqual(refreshed[field], before[field])
        self.call('receiver', 'stopped', self.fixture, self.directory / 'stopped.jsonl',
                  self.repo)
        moved = self.call('player', 'stopped')
        self.assertEqual(moved['workspace'], str(self.repo.resolve()))
        for field in ('id', 'parent', 'native', 'harness', 'model', 'effort', 'base', 'stop'):
            self.assertEqual(moved[field], before[field])
        self.call('dispatch-turn', 'stopped', 'refused-turn', self.fixture,
                  self.directory / 'stopped.jsonl', self.task, ok=False)
        self.assertEqual(self.call('player', 'stopped'), moved)
        self.assertEqual(self.rows('SELECT * FROM session_stops WHERE session=?', ('stopped',)), stops)
        self.assertIsNone(self.call('delivery', 'retained')['receipt'])
        self.call('receiver', 'missing', self.fixture, self.directory / 'missing.jsonl', ok=False)
        self.assertEqual(self.rows('SELECT * FROM executions'), [])

    def test_project_discovery_keeps_worktree_sessions_and_shared_knowledge(self):
        self.root()
        assignment = self.recruit('project-linked', 'muse')
        workspace = pathlib.Path(assignment['workspace'])
        shared_workspace = self.repo / 'shared λ 🙂'
        shared_workspace.mkdir()
        self.call('join', 'project-shared', 'root', 'muse', 'project-shared',
                  'low', shared_workspace)
        self.call('connect', 'project-linked', 'saved-project-native', '')
        self.call('message', 'project-owed', 'root', 'project-linked', 'task',
                  'Continue the retained project work.')
        self.call('record', 'project-finding', 'project-shared',
                  'The retained project finding remains available.',
                  'seed.txt', 'Fixture project.')

        unrelated = self.repo / 'nested unrelated repository'
        unrelated.mkdir()
        for args in (('init', '-q', '-b', 'main'),
                     ('config', 'user.name', 'Control fixture'),
                     ('config', 'user.email', 'fixture@example.invalid'),
                     ('commit', '-q', '--allow-empty', '-m', 'Unrelated fixture')):
            subprocess.run(['git', '-C', str(unrelated), *args],
                           env=self.environment, check=True,
                           capture_output=True, text=True)
        self.call('join', 'project-unrelated', 'root', 'muse',
                  'project-unrelated', 'low', unrelated)

        subdirectory = self.repo / 'project subdirectory'
        subdirectory.mkdir()
        linked_subdirectory = workspace / 'linked subdirectory'
        linked_subdirectory.mkdir()
        described = self.call('project', subdirectory)
        linked = self.call('project', linked_subdirectory)
        common = pathlib.Path(self.git('rev-parse', '--path-format=absolute',
                                       '--git-common-dir').stdout.strip()).resolve()
        self.assertEqual(described['project'], str(common))
        self.assertEqual(linked['project'], described['project'])
        self.assertEqual(described['rule'], 'common-dir')
        self.assertEqual(described['git']['ok'], 1)
        self.assertEqual(described['database'], str(self.db.resolve()))
        pointer = common / 'baton2' / 'database'
        self.assertEqual(described['pointer'], str(pointer))
        self.assertEqual(pointer.read_text().rstrip('\n'), str(self.db.resolve()))

        selected = self.project_call(linked_subdirectory, 'project-sessions', subdirectory)
        sessions = {row['id']: row for row in selected['sessions']}
        self.assertEqual(set(sessions), {'project-linked', 'project-shared'})
        self.assertEqual(selected['project']['project'], str(common))
        self.assertEqual(sessions['project-linked']['native'], 'saved-project-native')
        self.assertEqual(sessions['project-shared']['workspace'], str(shared_workspace.resolve()))
        self.assertEqual(sessions['project-linked']['pendingCount'], 1)
        self.assertEqual(self.project_call(subdirectory, 'inbox', 'project-linked')[0]['id'],
                         'project-owed')
        self.assertEqual(self.project_call(linked_subdirectory, 'knowledge', 'project-shared'),
                         self.call('knowledge', 'project-shared'))
        self.assertEqual(self.project_call(subdirectory, 'knowledge', 'project-shared')[0]['claim'],
                         'The retained project finding remains available.')

    def test_project_resume_continues_same_native_and_preserves_tab_message_id(self):
        self.root()
        session = 'project-resumed-muse'
        assignment = self.recruit(session, 'muse')
        self.call('project', self.repo)
        log = self.receiver(session)
        self.dispatch('dispatch-turn', session, 'project-original-turn',
                      self.fixture, log, self.task)
        stream, first = self.accept(session)
        self.finish(stream, 'Original project report.')
        self.exited(session)
        shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())
        original = self.call('session', session)
        endpoint = original['endpointArgv']
        unfinished = pathlib.Path(assignment['workspace']) / 'unfinished.txt'
        unfinished.write_text('Retained unfinished project source.\n')
        self.call('connect', session, first['native'], '')
        ident = 'project-input\twith-tab λ 🙂'
        self.call('message', ident, 'root', session, 'task', 'Resume the original project task.')
        self.assertIsNone(self.call('delivery', ident)['receipt'])
        self.call('connect', session, first['native'], json.dumps(endpoint))

        resumed = subprocess.Popen([str(EXE), '--project', assignment['workspace'],
                                    'resume', session], env=self.environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        continued, start = self.accept(session)
        self.assertEqual(start['native'], first['native'])
        self.assertEqual(start['resume'], first['native'])
        self.assertEqual(start['cwd'], assignment['workspace'])
        self.assertIn('[id: ' + ident + ']', start['prompt'])
        self.assertIn('Resume the original project task.', start['prompt'])
        self.finish(continued, 'Resumed project work completed.')
        stdout, stderr = resumed.communicate()
        self.assertEqual(resumed.returncode, 0, stderr)
        answer = json.loads(stdout)
        self.assertEqual((answer['session'], answer['message']), (session, ident))
        self.assertEqual(answer['delivery']['id'], ident)
        self.assertEqual(answer['delivery']['receipt'], 'fixture-native-reviewed')
        self.exited(session)
        self.assertEqual(answer['latestReport'], 'Resumed project work completed.')
        self.assertEqual(answer['latestReportId'], self.call('turns', session)[-1]['id'])
        self.assertEqual(self.call('inbox', session), [])
        final = self.call('session', session)
        for field in ('id', 'parent', 'harness', 'workspace', 'branch', 'native'):
            self.assertEqual(final[field], original[field])
        self.assertEqual(unfinished.read_text(), 'Retained unfinished project source.\n')

    def test_project_resume_keeps_queued_delivery_separate_from_history_and_preserves_stops(self):
        self.root()
        session = 'project-active-muse'
        self.recruit(session, 'muse')
        self.call('project', self.repo)
        log = self.receiver(session)
        self.dispatch('dispatch-turn', session, 'project-history-turn',
                      self.fixture, log, self.task)
        original_stream, first = self.accept(session)
        self.finish(original_stream, 'Historical project report.')
        self.exited(session)
        shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())

        self.dispatch('dispatch-file', 'project-active-task', 'root', session, 'task', self.task)
        active, started = self.accept(session)
        self.assertEqual(started['resume'], first['native'])
        self.assertEqual(self.action(active, ack=True), {'acknowledged': True})
        self.call('message', 'project-next-task', 'root', session, 'task',
                  'Input queued behind the active project turn.')
        queued = self.project_call(self.repo, 'resume', session)
        self.assertEqual((queued['session'], queued['message']), (session, 'project-next-task'))
        self.assertEqual(queued['delivery']['id'], 'project-next-task')
        self.assertIsNone(queued['delivery']['receipt'])
        self.assertEqual(queued['latestReportId'], 'project-history-turn')
        self.assertEqual(queued['latestReport'], 'Historical project report.')
        self.assertEqual(self.rows('SELECT phase FROM executions WHERE session=?',
                                   (session,))[0]['phase'], 'running')
        self.finish(active, 'The active project task completed.')
        continued, later = self.accept(session)
        self.assertEqual(later['native'], first['native'])
        self.assertEqual(later['resume'], first['native'])
        self.assertIn('[id: project-next-task]', later['prompt'])
        self.finish(continued, 'The queued project task completed.')
        self.exited(session)
        self.assertEqual(self.call('delivery', 'project-next-task')['receipt'],
                         'fixture-native-reviewed')
        self.assertEqual(self.call('inbox', session), [])

        stopped = 'project-stopped-muse'
        stopped_assignment = self.recruit(stopped, 'muse')
        self.call('connect', stopped, 'saved-stopped-project-native', '')
        self.call('message', 'project-stopped-task', 'root', stopped, 'task',
                  'This input remains recorded under the operator stop.')
        stopped_log = self.receiver(stopped)
        self.dispatch('dispatch-turn', stopped, 'project-stopped-turn',
                      self.fixture, stopped_log, self.task)
        stopped_stream, stopped_native = self.accept(stopped)
        unfinished = pathlib.Path(stopped_assignment['workspace']) / 'unfinished.txt'
        unfinished.write_text('Preserved work from the stopped conversation.\n')
        self.call('stop', stopped, 'project-stop', 'Operator stopped this project session.')
        stopped_attempt = self.eventually(lambda: next((row for row in self.rows(
            'SELECT * FROM executions WHERE session=?', (stopped,))
            if row['phase'] == 'exited'), None))
        self.assertEqual(stopped_attempt['status'], 'exit 143')
        self.eventually(lambda: (pathlib.Path(stopped_attempt['directory']) / 'acknowledged').exists())
        report_id = 'stop-result:' + 'project-stop'.encode().hex()
        stop_report = self.call('delivery', report_id)
        refusal = self.project_call(self.repo, 'resume', stopped, ok=False)
        self.assertIn('terminally stopped', refusal['stderr'])
        self.assertEqual(self.rows('SELECT id,status FROM executions WHERE session=?', (stopped,)),
                         [{'id': 'project-stopped-turn', 'status': 'exit 143'}])
        self.assertIsNone(self.call('delivery', 'project-stopped-task')['receipt'])
        self.assertEqual(self.call('session', stopped)['native'], 'saved-stopped-project-native')
        self.assertEqual(self.rows('SELECT id FROM session_stops WHERE session=?',
                                   (stopped,)), [{'id': 'project-stop'}])
        refreshed_log = self.directory / 'project-stopped-refreshed.jsonl'
        refreshed = self.call('receiver', stopped, self.fixture, refreshed_log)
        self.assertEqual(refreshed['endpoint'], [str(EXE.resolve()), str(self.db.resolve()),
                                                'receive', stopped, str(self.fixture.resolve()),
                                                '', '', '', str(refreshed_log.resolve())])
        self.assertEqual(self.rows('SELECT id,status FROM executions WHERE session=?', (stopped,)),
                         [{'id': 'project-stopped-turn', 'status': 'exit 143'}])
        self.assertEqual(self.rows('SELECT id FROM session_stops WHERE session=?',
                                   (stopped,)), [{'id': 'project-stop'}])
        self.assertIsNone(self.call('delivery', 'project-stopped-task')['receipt'])
        self.assertEqual(self.call('session', stopped)['native'], stopped_native['native'])
        lifted = subprocess.Popen([str(EXE), '--project', stopped_assignment['workspace'],
                                   'resume', stopped, '--lift-stop'], env=self.environment,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        continued, lifted_native = self.accept(stopped)
        self.assertEqual(lifted_native['native'], stopped_native['native'])
        self.assertEqual(lifted_native['resume'], stopped_native['native'])
        self.assertEqual(lifted_native['cwd'], stopped_assignment['workspace'])
        self.assertIn('[id: project-stopped-task]', lifted_native['prompt'])
        self.finish(continued, 'Explicitly resumed stopped project work.')
        stdout, stderr = lifted.communicate()
        self.assertEqual(lifted.returncode, 0, stdout + stderr)
        self.assertEqual(json.loads(stdout)['delivery']['receipt'], 'fixture-native-reviewed')
        self.assertEqual(self.rows('SELECT * FROM session_stops WHERE session=?', (stopped,)), [])
        self.assertEqual(self.call('delivery', report_id)['body'], stop_report['body'])
        self.assertEqual(self.call('session', stopped)['native'], stopped_native['native'])
        self.assertEqual(unfinished.read_text(), 'Preserved work from the stopped conversation.\n')
        self.assertEqual(self.call('inbox', stopped), [])

    def test_completed_player_moves_to_shared_checkout_and_resumes_after_task_retirement(self):
        self.root()
        assignment = self.recruit('completed', 'codex')
        workspace = pathlib.Path(assignment['workspace'])
        (workspace / 'completed.txt').write_text('Completed contribution.\n')
        for args in (('add', 'completed.txt'), ('commit', '-q', '-m', 'Completed contribution')):
            subprocess.run(['git', '-C', str(workspace), *args], env=self.environment,
                           check=True, capture_output=True, text=True)
        log = self.receiver('completed')
        self.dispatch('dispatch-file', 'completed-task', 'root', 'completed', 'task', self.task)
        stream, first = self.accept('completed')
        self.assertEqual(first['cwd'], str(workspace))
        self.finish(stream, 'Completed contribution is ready to integrate.')
        self.exited('completed')
        shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())
        original = self.call('session', 'completed')
        history = self.rows('SELECT * FROM messages ORDER BY seq'), self.rows('SELECT * FROM turns')
        stops = self.rows('SELECT * FROM session_stops')

        self.assertEqual(self.call('land', 'completed', self.repo, 'main')['status'], 'landed')
        remote = self.directory / 'published.git'
        self.git('init', '--bare', '-q', str(remote))
        self.assertEqual(self.call('push', self.repo, 'main', remote)['status'], 'pushed')
        unfinished = self.repo / 'unfinished.txt'
        unfinished.write_text('Shared work remains unfinished.\n')
        self.call('receiver', 'completed', self.fixture, log, self.repo)
        moved = self.call('session', 'completed')
        self.assertEqual((moved['workspace'], moved['branch']), (str(self.repo.resolve()), 'main'))
        for field in ('id', 'parent', 'harness', 'model', 'effort', 'base', 'native'):
            self.assertEqual(moved[field], original[field])
        self.assertEqual((self.rows('SELECT * FROM messages ORDER BY seq'),
                          self.rows('SELECT * FROM turns')), history)
        self.assertEqual(self.rows('SELECT * FROM session_stops'), stops)
        self.git('worktree', 'remove', str(workspace))
        self.git('branch', '-d', assignment['branch'])
        self.assertFalse(workspace.exists())
        self.assertNotIn(assignment['branch'], self.git('branch', '--format=%(refname:short)').stdout.splitlines())
        self.receiver('completed')
        self.assertEqual(self.call('session', 'completed'), moved)

        self.dispatch('dispatch-file', 'shared-task', 'root', 'completed', 'task', self.task)
        continued, second = self.accept('completed')
        self.assertEqual(second['cwd'], str(self.repo.resolve()))
        self.assertEqual(second['native'], first['native'])
        self.assertEqual(second['resume'], first['native'])
        self.finish(continued, 'Original conversation continued in the shared checkout.')
        self.exited('completed')
        self.assertEqual(unfinished.read_text(), 'Shared work remains unfinished.\n')
        self.assertEqual((self.repo / 'completed.txt').read_text(), 'Completed contribution.\n')
        self.assertEqual(self.call('session', 'completed')['branch'], 'main')
        turns = self.call('turns', 'completed')
        self.assertEqual({row['reportBody'] for row in turns}, {
            'Completed contribution is ready to integrate.',
            'Original conversation continued in the shared checkout.'})
        for ident in ('completed-task', 'shared-task'):
            self.assertEqual(self.call('delivery', ident)['receipt'], 'fixture-native-reviewed')

    def test_receiver_empty_cwd_keeps_assignment_and_non_git_cwd_is_supported(self):
        self.root()
        assignment = self.recruit('ordinary', 'codex')
        self.call('connect', 'ordinary', 'saved-ordinary', '')
        log = self.receiver('ordinary')
        before = self.call('session', 'ordinary')
        self.call('receiver', 'ordinary', self.fixture, log, '')
        self.assertEqual(self.call('session', 'ordinary'), before)
        plain = self.directory / 'plain workspace'
        plain.mkdir()
        self.call('receiver', 'ordinary', self.fixture, log, plain)
        moved = self.call('session', 'ordinary')
        self.assertEqual(moved['workspace'], str(plain.resolve()))
        self.assertEqual((moved['branch'], moved['base'], moved['parent'], moved['native']),
                         (assignment['branch'], assignment['base'], 'root', 'saved-ordinary'))
        self.dispatch('dispatch-file', 'plain-task', 'root', 'ordinary', 'task', self.task)
        stream, native = self.accept('ordinary')
        self.assertEqual(native['cwd'], str(plain.resolve()))
        self.assertEqual(native['resume'], 'saved-ordinary')
        self.finish(stream)
        self.exited('ordinary')

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
        self.assertTrue(self.output_log('leaf').is_file())
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
        frames = [json.loads(line) for line in self.output_log('omp-leaf').read_text().splitlines()]
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
                    shutdown_fixture_owner(self)
                    self.eventually(lambda: not self.process_rows())

    def instant_direct_harness(self, name):
        executable = self.directory / name
        executable.write_text('#!' + sys.executable + '\n' + r'''
import json,pathlib,sys
args=sys.argv[1:]
if '--prompt-file' in args:
    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
else:
    prompt=json.loads(sys.stdin.readline())['message']['content']
pathlib.Path(__file__).with_suffix('.effect').write_text(prompt)
if '--prompt-file' in args:
    print(json.dumps({'stream':{'kind':'session','id':'instant-native'},
                      'payload_type':'run.model.configured',
                      'payload':{'kind':'run_model_configured',
                                 'model_id':args[args.index('--model')+1]}}))
    print(json.dumps({'stream':{'kind':'session','id':'instant-native'},
                      'payload_type':'turn.input.user',
                      'payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}))
    print(json.dumps({'stream':{'kind':'session','id':'instant-native'},
                      'payload_type':'run.terminal.completed',
                      'payload':{'kind':'run_terminal','terminal':'completed',
                                 'command_id':'fixture-primary','text':prompt}}))
else:
    print(json.dumps({'type':'result','result':prompt,
                      'session_id':'instant-native','is_error':False}))
''')
        executable.chmod(0o700)
        return executable

    def test_completed_direct_id_rejects_changed_request(self):
        self.root()
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'completed-' + harness
                self.recruit(session, harness)
                assignment = self.call('player', session)
                first = self.instant_direct_harness('first-' + harness)
                ident = session + '-turn'
                argv = ['turn', session, ident, first, assignment['model'],
                        assignment['effort'], assignment['workspace'], self.task,
                        self.directory / (ident + '.jsonl'), assignment['native']]
                self.call(*argv, raw=True)
                self.assertEqual(first.with_suffix('.effect').read_text(), self.task.read_text())
                retained = self.call('delivery', ident)
                self.assertEqual(retained['body'], self.task.read_text())
                self.call(*argv, raw=True)
                self.assertEqual(self.call('delivery', ident), retained)
                changed = self.instant_direct_harness('changed-' + harness)
                changed_task = self.directory / ('changed-' + harness + '.txt')
                changed_task.write_text('Different task and executable under the same turn ID.\n')
                result = self.call('turn', session, ident, changed, assignment['model'],
                                   assignment['effort'], assignment['workspace'], changed_task,
                                   self.directory / ('changed-' + harness + '.jsonl'),
                                   assignment['native'], ok=False)
                self.assertIn('different retained request', result['stderr'])
                self.assertEqual(self.call('delivery', ident), retained)
                self.assertFalse(changed.with_suffix('.effect').exists())

    def test_direct_observer_loss_recovers_the_surviving_child(self):
        self.root()
        for harness in ('muse', 'claude-code'):
            with self.subTest(harness=harness):
                session = 'unresolved-' + harness
                self.recruit(session, harness)
                assignment = self.call('player', session)
                first_id = session + '-first'
                launched = self.dispatch('dispatch-turn', session, first_id, self.fixture,
                                         self.directory / (first_id + '.jsonl'), self.task)
                stream, start = self.accept(session)
                before = self.rows('SELECT * FROM executions WHERE session=?', (session,))[0]
                self.assertEqual((before['id'], before['mode']), (first_id, 'direct'))
                self.assertTrue(before['directory'])
                self.assertIn(before['phase'], ('starting', 'running'))
                self.assertEqual(self.rows('SELECT id FROM messages WHERE id=?', (first_id,)), [])
                observer = launched['deliveryPid']
                selected = subprocess.run(['ps', '-p', str(observer), '-o', 'pid=,lstart=,stat=,command='],
                                          capture_output=True, text=True, check=True).stdout.strip()
                self.assertIn(str(self.db), selected)
                self.assertIn(first_id, selected)
                self.assertIn(' turn ', selected)
                self.assertNotEqual(observer, start['ppid'])
                replacement = self.instant_direct_harness('replacement-' + harness)
                argv = ['turn', session, session + '-replacement', replacement,
                        assignment['model'], assignment['effort'], assignment['workspace'],
                        self.task, self.directory / (session + '-replacement.jsonl'),
                        assignment['native']]
                self.call(*argv, ok=False)
                self.assertFalse(replacement.with_suffix('.effect').exists())
                current = subprocess.run(['ps', '-p', str(observer), '-o', 'pid=,lstart=,stat=,command='],
                                         capture_output=True, text=True, check=True).stdout.strip()
                selected_fields = selected.split(None, 7)
                current_fields = current.split(None, 7)
                self.assertEqual(len(selected_fields), 8, selected)
                self.assertEqual(len(current_fields), 8, current)
                self.assertEqual(current_fields[:6], selected_fields[:6])
                self.assertEqual(current_fields[7], selected_fields[7])
                self.assertFalse(current_fields[6].startswith('Z'))
                os.kill(observer, signal.SIGKILL)
                self.eventually(lambda: not any(row.split(None, 1)[0] == str(observer)
                                               for row in self.process_rows()))
                self.assertEqual(self.action(stream, ack=True), {'acknowledged': True})
                recovery = self.eventually(lambda: next((row for row in self.process_rows()
                    if '--recover-direct' in row and first_id in row and str(self.db) in row), None))
                result = self.call(*argv, ok=False)
                after = self.rows('SELECT * FROM executions WHERE session=?', (session,))[0]
                survived = self.action(stream, ack=True)
                self.assertEqual(survived, {'acknowledged': True})
                self.assertFalse(replacement.with_suffix('.effect').exists())
                self.assertEqual((after['id'], after['directory']), (before['id'], before['directory']))
                self.assertEqual(self.rows('SELECT id FROM messages WHERE id=?', (first_id,)), [])
                with (self.directory / 'direct-boundary.jsonl').open('a') as evidence:
                    evidence.write(json.dumps({'harness': harness, 'firstStart': start,
                        'observer': selected, 'recovery': recovery, 'before': before, 'after': after,
                        'retry': result, 'firstFixtureStillResponsive': survived}) + '\n')
                self.finish(stream, 'The surviving direct child completed through recovery.')
                self.exited(session)
                self.eventually(lambda: any(row['id'] == first_id for row in self.call('turns', session)))
                self.assertEqual(self.call('delivery', first_id)['body'],
                                 'The surviving direct child completed through recovery.')
                self.assertEqual(self.call('player', session)['native'], start['native'])
                self.assertEqual(self.rows('SELECT id FROM messages WHERE id=?',
                                          (session + '-replacement',)), [])
                shutdown_fixture_owner(self)
                self.eventually(lambda: not self.process_rows())

    def test_direct_turn_delivers_pending_input_after_native_exit(self):
        self.root()
        for launch in ('dispatch-turn', 'turn'):
            for harness in ('muse', 'omp', 'claude-code', 'codex'):
                with self.subTest(launch=launch, harness=harness):
                    session = launch + '-' + harness
                    assignment = self.recruit(session, harness)
                    native = 'saved-' + session
                    self.call('connect', session, native, '')
                    ident = session + '-initial'
                    log = self.directory / (ident + '.jsonl')
                    child = None
                    if launch == 'dispatch-turn':
                        self.dispatch(launch, session, ident, self.fixture, log, self.task)
                    else:
                        child = subprocess.Popen([
                            str(EXE), str(self.db), 'turn', session, ident, str(self.fixture),
                            session, 'low', assignment['workspace'], str(self.task), str(log), native],
                            env=self.environment, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, text=True)
                    stream, start = self.accept(session)
                    self.assertEqual(start['resume'], native)
                    endpoint = self.call('session', session)['endpointArgv']
                    self.assertEqual(endpoint, [str(EXE.resolve()), str(self.db.resolve()),
                                               'receive', session, str(self.fixture), session,
                                               'low', assignment['workspace'], str(log.resolve())])
                    messages = [(session + '-pending-first', 'Finish the first pending task λ.'),
                                (session + '-pending-second', 'Finish the second pending task 🙂.')]
                    for message, body in messages:
                        self.call('message', message, 'root', session, 'task', body)
                        self.assertIsNone(self.call('delivery', message)['receipt'])
                    self.finish(stream, 'The initial direct turn ended.')
                    continued, resumed = self.accept(session)
                    self.assertEqual(resumed['native'], native)
                    self.assertEqual(resumed['cwd'], assignment['workspace'])
                    for message, body in messages:
                        self.assertIn('[id: ' + message + ']', resumed['prompt'])
                        self.assertIn(body, resumed['prompt'])
                        self.assertIsNone(self.call('delivery', message)['receipt'])
                    self.finish(continued, 'Both pending tasks were handled.')
                    self.exited(session)
                    for message, _ in messages:
                        self.assertEqual(self.call('delivery', message)['receipt'],
                                         'fixture-native-reviewed')
                    self.assertEqual(self.call('inbox', session), [])
                    self.assertEqual(self.call('session', session)['endpointArgv'], endpoint)
                    self.assertEqual(self.call('session', 'root')['endpoint'], '')
                    if child is not None:
                        stdout, stderr = child.communicate()
                        self.assertEqual(child.returncode, 0, stderr)
                    shutdown_fixture_owner(self)
                    self.eventually(lambda: not self.process_rows())

    def test_direct_turn_preserves_a_configured_receiver(self):
        self.root()
        assignment = self.recruit('configured', 'muse')
        self.receiver('configured')
        endpoint = self.call('session', 'configured')['endpointArgv']
        self.dispatch('dispatch-turn', 'configured', 'configured-turn', self.fixture,
                      self.directory / 'direct.jsonl', self.task)
        stream, _ = self.accept('configured')
        self.assertEqual(self.call('session', 'configured')['endpointArgv'], endpoint)
        self.finish(stream)
        self.exited('configured')
        self.assertEqual(self.call('session', 'configured')['endpointArgv'], endpoint)
        self.assertEqual(self.call('session', 'configured')['workspace'], assignment['workspace'])

    def test_receiver_registration_wakes_already_owed_muse_input(self):
        self.root()
        for registration in ('receiver', 'configure'):
            with self.subTest(registration=registration):
                session = 'registered-' + registration
                assignment = self.recruit(session, 'muse')
                native = 'saved-' + session
                self.call('connect', session, native, '')
                message = session + '-owed'
                body = 'Handle the input already pending before receiver registration.'
                self.call('message', message, 'root', session, 'task', body)
                self.assertEqual(self.call('session', session)['endpoint'], '')
                self.assertIsNone(self.call('delivery', message)['receipt'])
                self.assertEqual(self.rows('SELECT * FROM executions WHERE session=?', (session,)), [])

                log = self.directory / (session + '.jsonl')
                if registration == 'receiver':
                    self.receiver(session)
                else:
                    self.call('configure', session, 'muse', session, 'low', self.fixture, log,
                              'muse', session, 'low')
                stream, start = self.accept(session)
                self.assertEqual(start['resume'], native)
                self.assertEqual(start['native'], native)
                self.assertEqual(start['cwd'], assignment['workspace'])
                self.assertIn('[id: ' + message + ']', start['prompt'])
                self.assertIn(body, start['prompt'])
                self.assertIsNone(self.call('delivery', message)['receipt'])
                self.finish(stream, 'The input present before registration is complete.')
                self.exited(session)
                self.assertEqual(self.call('delivery', message)['receipt'], 'fixture-native-reviewed')
                self.assertEqual(self.call('inbox', session), [])
                self.assertEqual(self.call('session', session)['native'], native)
                self.assertEqual(len(self.call('turns', session)), 1)
                shutdown_fixture_owner(self)
                self.eventually(lambda: not self.process_rows())

    def test_completed_turn_replay_repairs_an_absent_receiver_and_delivers_pending_input(self):
        self.root()
        assignment = self.recruit('legacy-muse', 'muse')
        native = 'saved-legacy-muse'
        self.call('connect', 'legacy-muse', native, '')
        log = self.directory / 'legacy-muse.jsonl'
        self.dispatch('dispatch-turn', 'legacy-muse', 'completed-legacy-turn',
                      self.fixture, log, self.task)
        stream, _ = self.accept('legacy-muse')
        self.finish(stream, 'The original task is complete.')
        self.exited('legacy-muse')
        shutdown_fixture_owner(self)
        self.eventually(lambda: not self.process_rows())

        self.call('connect', 'legacy-muse', native, '')
        self.call('message', 'owed-legacy-input', 'root', 'legacy-muse', 'task',
                  'Continue the original conversation.')
        self.assertIsNone(self.call('delivery', 'owed-legacy-input')['receipt'])
        replay = subprocess.Popen([str(EXE), str(self.db), 'turn', 'legacy-muse',
                                   'completed-legacy-turn', str(self.fixture),
                                   'legacy-muse', 'low', assignment['workspace'],
                                   str(self.task), str(log), native],
                                  env=self.environment, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        continued, start = self.accept('legacy-muse')
        self.assertEqual(start['resume'], native)
        self.assertIn('[id: owed-legacy-input]', start['prompt'])
        self.assertNotEqual(start['prompt'], self.task.read_text())
        self.finish(continued, 'The owed input is complete.')
        replay_stdout, replay_stderr = replay.communicate()
        self.assertEqual(replay.returncode, 0, replay_stderr)
        self.assertEqual(json.loads(replay_stdout)['id'], 'completed-legacy-turn')
        self.exited('legacy-muse')
        self.assertEqual(self.call('delivery', 'owed-legacy-input')['receipt'],
                         'fixture-native-reviewed')
        self.assertEqual(self.call('inbox', 'legacy-muse'), [])

        self.call('connect', 'legacy-muse', native, '')
        self.call('stop', 'legacy-muse', 'legacy-stop', 'Operator stopped this session.')
        self.call('turn', 'legacy-muse', 'completed-legacy-turn', self.fixture,
                  'legacy-muse', 'low', assignment['workspace'], self.task, log, native)
        self.assertEqual(self.call('session', 'legacy-muse')['endpoint'], '')

    def test_pretty_reads_preserve_complete_machine_fields_and_long_report(self):
        self.root()
        self.recruit('leaf', 'muse')
        body = 'A complete retained report λ.\n' * 100
        self.call('report', 'review-report', 'leaf', body)
        event = self.directory / 'pretty-event.json'
        event.write_text(json.dumps({'type': 'result', 'session_id': 'native-pretty',
                                     'result': body, 'is_error': False}))
        self.call('observe-file', 'review-report', 'leaf', event)
        queued = [json.loads(line) for line in self.public_queue_calls.read_text().splitlines()]
        self.assertTrue(any(request['method'] == 'turn/steer'
                            and request['params']['threadId'] == 'saved-root'
                            for request in queued))
        for args in (('status',), ('players',), ('orchestra',), ('pending',), ('player', 'leaf'),
                     ('session', 'leaf'), ('inbox', 'root'), ('delivery', 'review-report'), ('turns', 'leaf')):
            with self.subTest(args=args):
                ordinary = self.call(*args, raw=True)
                readable = self.call(*args, '--pretty', raw=True)
                self.assertEqual(json.loads(readable['stdout']), json.loads(ordinary['stdout']))
                self.assertIn('\n', readable['stdout'].strip())
        saved = self.call('delivery', 'review-report', '--pretty')
        self.assertEqual(saved['body'], body)
        self.assertIsNone(saved['receipt'])
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

    def test_pretty_knowledge_preserves_shared_finding_for_registered_readers(self):
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
                if reader != 'missing-reader':
                    self.assertEqual(value[0]['author'], 'researcher')
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
