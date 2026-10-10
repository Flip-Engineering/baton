#!/usr/bin/env python3
"""Fixed-coordinator gate for the shared native runtime.

One owner plus one serve holds each database. The serve takes the physical
coordinator role before subscribing, drives every session with actionable
pending input as a concurrent native task through one event channel, and
replays the full snapshot on every task completion and every owner notice.
These legs gate that contract through ordinary CLI verbs against the elected
owner; they do not depend on Store publication. A failed leg retains its
fixture database, serve and owner outputs, and source pins under /tmp.
"""
import hashlib
import json
import os
import pathlib
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

TESTDIR = pathlib.Path(__file__).resolve().parent
ROOT = TESTDIR.parent.parent
EXE = ROOT / '.scratch/bend2/baton2'
MCP = ROOT / 'bend2/scripts/mcp-conductor.mjs'

sys.path.insert(0, str(TESTDIR))
from receive import FIXTURE, write_public_queue_codex


class FixedCoordinator(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix='fixed-coord ', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.original_path = os.environ.get('PATH')
        self.addCleanup(self.restore_path)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Fixed coordinator fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'],
                       check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.db = self.directory / 'state.db'
        self.codex_calls = self.directory / 'codex-calls.jsonl'
        write_public_queue_codex(self.directory, self.codex_calls)
        os.environ['PATH'] = str(self.directory) + os.pathsep + (self.original_path or '')
        self.co_dir = self.directory / 'co'
        self.co_dir.mkdir()
        self.fixture = self.co_dir / 'native-fixture'
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        self.fixture.chmod(0o755)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(1)
        self.addCleanup(self.server.close)
        (self.co_dir / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(EXE), 'db': str(self.db)}))
        self._lock = threading.Lock()
        self._queues = {}
        self._greetings = []
        self._streams = {}
        self._stop = threading.Event()
        self._acceptor = threading.Thread(target=self._accept_loop, daemon=True)
        self._acceptor.start()
        self.children = []
        self.addCleanup(self.close_children)
        self.owner_pid = None
        self.serve_proc = None
        self.coord('attach', 'root', 'terminal', '', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')

    def restore_path(self):
        if self.original_path is None:
            os.environ.pop('PATH', None)
        else:
            os.environ['PATH'] = self.original_path

    def _accept_loop(self):
        while not self._stop.is_set():
            try:
                connection, _ = self.server.accept()
            except socket.timeout:
                continue
            except OSError:
                break
            stream = connection.makefile('rwb', buffering=0)
            try:
                greeting = json.loads(stream.readline())
            except (ValueError, OSError):
                connection.close()
                continue
            session = greeting.get('session')
            with self._lock:
                self._greetings.append((session, greeting))
                queue = self._queues.setdefault(session, [])
                action = queue.pop(0) if queue else {'body': f'{session} fixed default completion'}
                try:
                    stream.write((json.dumps(action) + '\n').encode())
                except OSError:
                    connection.close()
                    continue
                self._streams.setdefault(session, []).append((stream, connection))

    def close_children(self):
        self._stop.set()
        with self._lock:
            streams = [pair for pairs in self._streams.values() for pair in pairs]
        for stream, connection in streams:
            try:
                stream.write(b'{"exit_fixture":true}\n')
            except (OSError, ValueError):
                pass
            try:
                stream.close()
            except OSError:
                pass
            connection.close()
        self._acceptor.join()
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

    def is_serve(self, process):
        return process['command'].endswith(' serve') or ' serve ' in process['command']

    def is_owner(self, process):
        return '--instance-owner' in process['command']

    def tearDown(self):
        outcome = getattr(self, '_outcome', None)
        failed = False
        if outcome is not None:
            result = getattr(outcome, 'result', None)
            if result is not None:
                failed = any(test is self and error for test, error in result.errors + result.failures)
        if failed and hasattr(self, 'directory'):
            keep = (pathlib.Path(tempfile.gettempdir())
                    / f'fixed676-{self._testMethodName}-{int(time.time())}')
            keep.mkdir(parents=True)
            shutil.copytree(self.directory, keep / 'fixture')
            for name, process in (('serve', self.serve_proc),):
                if process is None:
                    continue
                try:
                    if process.poll() is None:
                        process.kill()
                    out, err = process.communicate()
                except Exception as exc:
                    out, err = '', f'collect-failed: {exc}'
                (keep / f'{name}.stdout').write_text(out or '')
                (keep / f'{name}.stderr').write_text(err or '')
            try:
                owned = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                       capture_output=True, text=True).stdout
            except Exception as exc:
                owned = f'ps-failed: {exc}'
            (keep / 'processes.txt').write_text(owned)
            digest = hashlib.sha256(EXE.read_bytes()).hexdigest()
            try:
                bend_version = subprocess.run(
                    [str(EXE), '--help'], capture_output=True, text=True).stderr.splitlines()[0:1]
            except Exception as exc:
                bend_version = [f'help-failed: {exc}']
            (keep / 'pins.txt').write_text(
                '\n'.join([f'exe={EXE}', f'sha256={digest}',
                           f'version={bend_version}',
                           f'sqlite={sqlite3.sqlite_version}']) + '\n')
            print(f'\nRETAINED-FAILURE {keep}')

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
            time.sleep(.05)

    def coord(self, *args, ok=True):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout) if result.stdout.strip().startswith(('[', '{')) else result.stdout
        return result

    def query(self, sql):
        while True:
            try:
                with sqlite3.connect(str(self.db)) as database:
                    return database.execute(sql).fetchall()
            except sqlite3.OperationalError as error:
                if error.sqlite_errorcode != sqlite3.SQLITE_BUSY:
                    raise

    def recruit(self, name, harness):
        session = self.coord('recruit', name, 'root', harness, name, 'low', str(self.repo),
                             name + '-branch', str(self.checkouts / name), self.base)
        if harness == 'codex':
            self.coord('connect', name, 'native-' + name, '')
        return session

    def receiver(self, name, log=None):
        return self.coord('receiver', name, str(self.fixture), str(log or self.co_dir / (name + '.jsonl')))

    def dispatch(self, ident, recipient, body, kind='task', sender='root'):
        return self.coord('message', ident, sender, recipient, kind, body)

    def queue(self, session, *actions):
        with self._lock:
            self._queues.setdefault(session, []).extend(actions)

    def connections(self, session):
        with self._lock:
            return [greeting for name, greeting in self._greetings if name == session]

    def stream_for(self, session, index=0):
        def have():
            with self._lock:
                streams = self._streams.get(session, [])
                return streams[index] if len(streams) > index else None
        return self.eventually(have, f'no fixture connection {index} for {session}')

    def release(self, session, index=0, **action):
        stream, _ = self.stream_for(session, index)
        stream.write((json.dumps(action or {'released': True}) + '\n').encode())
        try:
            return json.loads(stream.readline())
        except (ValueError, OSError):
            return None

    def inbox(self, recipient):
        return self.coord('inbox', recipient)

    def await_inbox(self, recipient, predicate, description):
        # Reports land through the keeper observe pipeline after the native
        # exits; read until the requested durable row is present.
        while True:
            if self.serve_proc is not None and self.serve_proc.poll() is not None:
                stdout, stderr = self.serve_proc.communicate()
                self.fail(f'serve exited before the inbox event arrived: {stdout} {stderr}')
            found = predicate(self.inbox(recipient))
            if found:
                return found
            time.sleep(.5)

    def start_owner(self):
        self.coord('owner-status')
        owners = [process for process in self.owned_processes() if self.is_owner(process)]
        self.assertEqual(len(owners), 1, owners)
        self.owner_pid = owners[0]['pid']

    def start_serve(self, db=None):
        self.serve_proc = subprocess.Popen([str(EXE), str(db or self.db), 'serve'],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(self.serve_proc)

        def first_line():
            if self.serve_proc.poll() is not None:
                self.fail(f'serve exited before subscribing: {self.serve_proc.stderr.read()}')
            line = self.serve_proc.stdout.readline()
            return line or None
        line = self.eventually(first_line, 'serve never printed its subscription readiness')
        return json.loads(line)

    def shutdown(self, expect_serve=0, db=None):
        result = subprocess.run([str(EXE), '--instance-shutdown', str(db or self.db)],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        if self.serve_proc is not None:
            stdout, stderr = self.serve_proc.communicate()
            self.assertEqual(self.serve_proc.returncode, expect_serve, stderr)

    def managed_app_proxy(self):
        real_node = shutil.which('node')
        self.assertIsNotNone(real_node, 'the managed App fixture requires Node')
        self.app_follow_events = self.directory / 'app-follow-events.jsonl'
        node = self.directory / 'node'
        node.write_text('#!' + sys.executable + '\n' + r'''
import os,pathlib,signal,subprocess,sys
real_node=__NODE__
argv=sys.argv[1:]
if len(argv)<2 or pathlib.Path(argv[0]).name!='codex-inbox-wake.mjs' or argv[1]!='--follow':
    os.execv(real_node,[real_node,*argv])
child=subprocess.Popen([real_node,*argv],stdout=subprocess.PIPE)
for signum in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
    signal.signal(signum,lambda signum,frame:child.send_signal(signum))
with pathlib.Path(__EVENTS__).open('ab',buffering=0) as events:
    for line in child.stdout:
        events.write(line)
        sys.stdout.buffer.write(line)
        sys.stdout.buffer.flush()
code=child.wait()
if code<0:
    signal.signal(-code,signal.SIG_DFL)
    os.kill(os.getpid(),-code)
sys.exit(code)
'''.replace('__NODE__', repr(real_node))
           .replace('__EVENTS__', repr(str(self.app_follow_events))))
        node.chmod(0o700)
        state = self.directory / 'managed-app.json'
        state.write_text(json.dumps({'status': 'active', 'turn': 'app-initial', 'number': 0}))
        command = self.directory / 'codex'
        command.write_text('#!' + sys.executable + '\n' + r'''
import base64,hashlib,json,os,pathlib,socket,struct,sys,threading
assert sys.argv[1:]==['app-server','proxy'], sys.argv
state=pathlib.Path(__STATE__)
calls=pathlib.Path(__CALLS__)
write_lock=threading.Lock()
control=None
def read_state():
    return json.loads(state.read_text())
def save_state(value):
    temporary=state.with_name(state.name+'.'+str(os.getpid()))
    temporary.write_text(json.dumps(value))
    temporary.replace(state)
def exact(n):
    data=b''
    while len(data)<n:
        part=sys.stdin.buffer.read(n-len(data))
        if not part:raise EOFError('fixture input closed')
        data+=part
    return data
def reply(value):
    payload=json.dumps(value).encode()
    n=len(payload)
    size=bytes([n]) if n<126 else bytes([126])+struct.pack('!H',n) if n<65536 else bytes([127])+struct.pack('!Q',n)
    with write_lock:
        sys.stdout.buffer.write(bytes([129])+size+payload)
        sys.stdout.buffer.flush()
def completion_events(stream):
    for line in stream:
        action=json.loads(line)
        if action.get('settle'):
            current=read_state()
            terminal={'id':current['turn'],'status':action.get('status','completed'),'error':action.get('error')}
            save_state({**current,'status':'idle','terminal':terminal})
            reply({'method':'turn/completed','params':{'threadId':'native-w1','turn':terminal}})
            reply({'method':'thread/status/changed','params':{'threadId':'native-w1','status':{'type':'idle'}}})
            stream.write((json.dumps({'settled':current['turn']})+'\n').encode())
header=b''
while not header.endswith(b'\r\n\r\n'):header+=exact(1)
key=next(line.split(b':',1)[1].strip() for line in header.split(b'\r\n') if line.lower().startswith(b'sec-websocket-key:'))
accept=base64.b64encode(hashlib.sha1(key+b'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest())
sys.stdout.buffer.write(b'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+b'\r\n\r\n')
sys.stdout.buffer.flush()
try:
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
        if 'id' not in request:
            with calls.open('a') as output:output.write(json.dumps(request)+'\n')
            continue
        thread=request.get('params',{}).get('threadId')
        current=read_state() if thread=='native-w1' else {'status':'active','turn':'fixture-turn'}
        if method=='initialize':result={}
        elif method in ('thread/read','thread/resume'):
            result={'thread':{'id':thread,'status':{'type':current['status']},'turns':[]}}
            if method=='thread/resume' and thread=='native-w1':
                connection=socket.create_connection(('127.0.0.1',__PORT__))
                control=connection.makefile('rwb',buffering=0)
                control.write((json.dumps({'session':'w1-app','thread':thread,'pid':os.getpid()})+'\n').encode())
                assert json.loads(control.readline())=={'controlReady':True}
                threading.Thread(target=completion_events,args=(control,),daemon=True).start()
        elif method=='thread/turns/list':
            turn=({'id':current['turn'],'status':'inProgress'} if current['status']=='active'
                  else current.get('terminal',{'id':current['turn'],'status':'completed'}))
            result={'data':[turn],'nextCursor':None}
        elif method=='turn/steer':
            assert current['status']=='active' and request['params']['expectedTurnId']==current['turn'], request
            result={'turnId':current['turn']}
        elif method=='turn/start':
            assert thread=='native-w1' and current['status']=='idle', request
            current={**current,'number':current['number']+1,'status':'active'}
            current['turn']='app-turn-'+str(current['number'])
            save_state(current)
            result={'turn':{'id':current['turn'],'status':'inProgress','items':[],'error':None}}
        else:raise AssertionError(request)
        reply({'id':request['id'],'result':result})
        with calls.open('a') as output:output.write(json.dumps(request)+'\n')
finally:
    if control is not None:
        connection.shutdown(socket.SHUT_RDWR)
        control.close()
        connection.close()
'''.replace('__STATE__', repr(str(state)))
           .replace('__CALLS__', repr(str(self.codex_calls)))
           .replace('__PORT__', str(self.server.getsockname()[1])))
        command.chmod(0o700)

    def test_01_serve_drives_concurrent_sessions_with_guidance(self):
        self.recruit('w1', 'codex')
        self.recruit('w2', 'omp')
        self.queue('w1', {'body': 'w1 turn one complete', 'hold_exit': True},
                   {'body': 'w1 guidance turn complete'})
        self.queue('w2', {'body': 'w2 turn one complete', 'hold_exit': True})
        self.dispatch('t1', 'w1', 'First task.')
        self.dispatch('t2', 'w2', 'Second task.')
        self.receiver('w1')
        self.receiver('w2')
        self.start_owner()
        ready = self.start_serve()
        self.assertIn('generation', ready)
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        first_w2, _ = self.stream_for('w2')
        self.assertEqual(json.loads(first_w2.readline()), {'terminal_written': True})
        residents = [p for p in self.owned_processes() if self.is_serve(p)]
        self.assertEqual(len(residents), 1, 'one serve holds the database while two sessions run')
        self.dispatch('g1', 'w1', 'Guidance issued while turn one is held.', kind='guidance')
        self.assertEqual(len(self.connections('w1')), 1,
                         'guidance queues instead of starting a second native while the turn is held')
        self.release('w1')
        second_w1, _ = self.stream_for('w1', 1)
        second_w1.close()
        self.release('w2')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 turn one complete' in m['body'] for m in messages)
            and any('w1 guidance turn complete' in m['body'] for m in messages)
            and any('w2 turn one complete' in m['body'] for m in messages) else None),
            'concurrent turn reports never reached the root inbox')
        for ident in ('t1', 't2', 'g1'):
            row = self.query(f"SELECT receipt FROM messages WHERE id='{ident}'")
            self.assertNotEqual(row, [(None,)], f'{ident} was not acknowledged')
        self.shutdown()

    def test_01_wrapped_receivers_use_the_recorded_harness_and_log(self):
        binary = self.directory / 'installed/bin/baton2'
        helper = self.directory / 'installed/libexec/baton2/git-series.mjs'
        binary.parent.mkdir(parents=True)
        helper.parent.mkdir(parents=True)
        shutil.copy2(EXE, binary)
        shutil.copy2(ROOT / 'bend2/harness/git-series.mjs', helper)
        shutil.copy2(ROOT / 'bend2/scripts/codex-inbox-wake.mjs',
                     helper.parent / 'codex-inbox-wake.mjs')
        profile = self.directory / 'gpt'
        profile.mkdir()
        slug = 'fixture-series-gpt'
        metadata = profile / 'identity-series.json'
        metadata.write_text(json.dumps({
            'seriesKey': 'gpt', 'displaySeries': 'GPT',
            'github': {
                'appId': 20000, 'clientId': 'fixture-client-gpt', 'slug': slug,
                'botLogin': slug + '[bot]', 'botId': 10000,
                'commitEmail': f'10000+{slug}[bot]@users.noreply.github.com',
                'installationId': 30000, 'repositoryFullName': 'Flip-Engineering/baton',
                'repositoryId': 40000,
                'permissions': {'contents': 'write', 'pull_requests': 'write', 'metadata': 'read'},
            },
        }))
        metadata.chmod(0o600)
        registry = self.directory / 'series.json'
        registry.write_text(json.dumps({
            'models': {'wrapped-codex': 'gpt', 'wrapped-omp': 'gpt'},
            'series': {'gpt': str(profile)},
        }))
        registry.chmod(0o600)
        binary_digest = hashlib.sha256(binary.read_bytes()).hexdigest()
        with patch(__name__ + '.EXE', binary), patch.dict(
                os.environ, {'BATON2_GIT_REGISTRY': str(registry)}):
            assignments = {}
            for name, harness in (('wrapped-codex', 'codex'), ('wrapped-omp', 'omp')):
                assignments[name] = self.recruit(name, harness)
                self.dispatch(name + '-task', name, 'Task for the wrapped receiver.')
                configured = self.receiver(name)
                self.assertEqual(configured['endpoint'], [
                    'node', str(helper.resolve()),
                    'launch', '--registry', str(registry.resolve()), '--model-key', name, '--',
                    str(EXE.resolve()), str(self.db.resolve()), 'receive', name,
                    str(self.fixture.resolve()), '', '', '',
                    str((self.co_dir / (name + '.jsonl')).resolve()),
                ])
            self.start_owner()
            self.start_serve()
            for name in assignments:
                reports = self.await_inbox('root', lambda messages: [
                    message for message in messages if message['sender'] == name
                ], f'{name} report never reached the root inbox')
                self.assertTrue(any(name + ' fixed default completion' in report['body']
                                    for report in reports), reports)
                native = self.connections(name)[0]
                self.assertEqual(native['args'][native['args'].index('--model') + 1], name)
                self.assertEqual(native['cwd'], assignments[name]['workspace'])
                saved = self.coord('player', name)
                self.assertEqual(saved['native'], native['native'])
                self.assertEqual(saved['model'], name)
                self.assertEqual(saved['workspace'], assignments[name]['workspace'])
                self.assertNotEqual(self.query(
                    f"SELECT receipt FROM messages WHERE id='{name}-task'"), [(None,)])
                registered = self.query(
                    "SELECT g.log,g.base FROM log_generations g JOIN executions e "
                    "ON e.session=g.session AND e.id=g.attempt "
                    f"WHERE g.session='{name}'")
                self.assertEqual(len(registered), 1, registered)
                self.assertEqual(registered[0][1], str(self.co_dir / (name + '.jsonl')))
                log = pathlib.Path(registered[0][0])
                self.assertIn(name + ' fixed default completion', log.read_text())
            self.shutdown()
        self.assertEqual(hashlib.sha256(binary.read_bytes()).hexdigest(), binary_digest)

    def test_02_stopped_session_keeps_input_unexecuted(self):
        self.recruit('w4', 'codex')
        self.dispatch('t4', 'w4', 'Task for a session that stops before service.')
        self.coord('stop', 'w4', 'stop-1', 'halted before service')
        self.recruit('scan-worker', 'codex')
        self.receiver('scan-worker')
        self.dispatch('scan-task', 'scan-worker', 'Complete the live input in this scan.')
        self.start_owner()
        self.start_serve()
        self.await_inbox('root', lambda messages: any(
            'scan-worker fixed default completion' in message['body'] for message in messages),
            'the coordinator did not process the live input beside the stopped session')
        serve = [p for p in self.owned_processes() if self.is_serve(p)]
        self.assertEqual(len(serve), 1, 'the serve stays up with only stopped input pending')
        bodies = [m['body'] for m in self.inbox('root')]
        self.assertFalse(any('w4' in body for body in bodies), 'stopped input executed')
        row = self.query("SELECT receipt FROM messages WHERE id='t4'")
        self.assertEqual(row, [(None,)], 'stopped input must stay pending and unexecuted')
        self.shutdown()

    def test_03_killed_serve_is_adopted_without_duplicate_resume(self):
        self.recruit('w7', 'codex')
        self.queue('w7', {'body': 'w7 adopted turn complete', 'hold_exit': True})
        self.dispatch('t7', 'w7', 'Task surviving its first serve.')
        self.receiver('w7')
        self.start_owner()
        self.start_serve()
        held, _ = self.stream_for('w7')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        self.serve_proc.kill()
        self.serve_proc.wait()
        native_pid = self.connections('w7')[0]['pid']
        try:
            os.kill(native_pid, 0)
        except ProcessLookupError:
            self.fail('the native died with its serve')
        self.serve_proc = None
        self.start_serve()
        self.assertEqual(len(self.connections('w7')), 1,
                         'adoption reuses the live native instead of resuming a duplicate')
        self.release('w7')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages if m['sender'] == 'w7'
             and 'w7 adopted turn complete' in m['body']] or None),
            'adopted report never reached the root inbox')
        bodies = [m['body'] for m in self.inbox('root') if m['sender'] == 'w7']
        self.assertEqual(len([b for b in bodies if 'w7 adopted turn complete' in b]), 1)
        row = self.query("SELECT receipt FROM messages WHERE id='t7'")
        self.assertNotEqual(row, [(None,)], 'adopted input was lost')
        owners = [p for p in self.owned_processes() if self.is_owner(p)]
        self.assertEqual(len(owners), 1, 'adoption keeps exactly one shared owner')
        attempt = self.query("SELECT directory, mode FROM executions WHERE session='w7'")
        self.assertEqual(len(attempt), 1, 'adoption keeps one admitted attempt')
        self.assertTrue(attempt[0][0], 'adopted attempt lost its directory')
        self.assertEqual(attempt[0][1], 'retained', 'adopted attempt lost its mode')
        self.shutdown()

    def test_04_owner_loss_preserves_live_native_and_receipted_input(self):
        # Keepers run inside the owner process on the owner admission path, so
        # owner loss is the keeper-loss drill: the keeper dies with the owner
        # while the native survives as an orphan. Full orphan re-adoption waits
        # on owner recovery; this leg proves the failure boundary evidence.
        self.recruit('w8', 'codex')
        self.queue('w8', {'body': 'w8 owner-loss turn', 'hold_exit': True})
        self.dispatch('t8', 'w8', 'Task surviving its owner.')
        self.receiver('w8')
        self.start_owner()
        self.start_serve()
        held, _ = self.stream_for('w8')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        native_pid = self.connections('w8')[0]['pid']
        killed_owner = self.owner_pid
        os.kill(killed_owner, signal.SIGKILL)
        self.eventually(lambda: all(process['pid'] != killed_owner for process in self.owned_processes()),
                        'the killed owner remained live')
        try:
            os.kill(native_pid, 0)
        except ProcessLookupError:
            self.fail('the native died with its owner')
        row = self.query("SELECT receipt FROM messages WHERE id='t8'")
        self.assertNotEqual(row, [(None,)], 'owner-loss input was lost')
        rows = self.query("SELECT phase FROM executions WHERE session='w8'")
        self.assertTrue(rows, 'owner-loss execution record was lost')
        owners = [p for p in self.owned_processes() if self.is_owner(p)]
        self.assertNotIn(killed_owner, [process['pid'] for process in owners])
        self.assertLessEqual(len(owners), 1, 'owner recovery started multiple owners')
        # The stranded serve joined its task through the keeper death and only
        # returns when that join does; the supervisor restarts the generation.
        self.serve_proc.kill()
        self.serve_proc.wait()
        self.serve_proc = None
        self.owner_pid = None
        self.shutdown()

    def test_06_owner_status_and_mcp_discovery(self):
        self.start_owner()
        status = self.coord('owner-status')
        self.assertIn('generation', status)
        self.assertIn('cursor', status)
        replies = subprocess.run(
            ['node', str(MCP), str(self.db), str(EXE), '--session', 'root'],
            input=''.join(json.dumps(row) + '\n' for row in [
                {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                 'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                            'clientInfo': {'name': 'm', 'version': '0'}}},
                {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
                {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
                 'params': {'name': 'baton2_owner', 'arguments': {}}}]),
            text=True, capture_output=True)
        self.assertEqual(replies.returncode, 0, replies.stderr)
        by_id = {reply['id']: reply for reply in
                 (json.loads(line) for line in replies.stdout.splitlines())}
        names = [tool['name'] for tool in by_id[2]['result']['tools']]
        self.assertIn('baton2_owner', names)
        owner_json = json.loads(by_id[3]['result']['content'][0]['text'])
        self.assertEqual(owner_json['generation'], status['generation'])
        self.assertEqual(owner_json['cursor'], status['cursor'])
        self.shutdown()

    def test_07_late_commit_served_while_first_task_held(self):
        self.recruit('w1', 'codex')
        self.recruit('w2', 'omp')
        self.recruit('w3', 'codex')
        self.queue('w1', {'body': 'w1 held turn', 'hold_exit': True})
        self.queue('w2', {'body': 'w2 quick turn'})
        self.queue('w3', {'body': 'w3 late turn'})
        self.dispatch('t1', 'w1', 'First task, held.')
        self.dispatch('t2', 'w2', 'Second task, quick.')
        self.receiver('w1')
        self.receiver('w2')
        self.receiver('w3')
        self.start_owner()
        self.start_serve()
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        self.stream_for('w2')
        self.dispatch('c1', 'w3', 'Late task, older pending one.')
        self.dispatch('c2', 'w3', 'Late task, older pending two.')
        self.stream_for('w3')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w2 quick turn' in m['body'] for m in messages)
            and any('w3 late turn' in m['body'] for m in messages) else None),
            'late work never finished while the first task was held')
        bodies = [m['body'] for m in self.inbox('root')]
        self.assertFalse(any('w1 held turn' in body for body in bodies),
                         'the held task reported before its release')
        self.await_inbox('root', lambda messages: (
            messages if self.query("SELECT count(*) FROM messages WHERE id IN ('c1','c2') AND receipt IS NULL")[0][0] == 0
            else None), 'the second late input never completed while the first session was held')
        self.release('w1')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 held turn' in m['body'] for m in messages) else None),
            'held turn report never reached the root inbox')
        for ident in ('t1', 't2'):
            row = self.query(f"SELECT receipt FROM messages WHERE id='{ident}'")
            self.assertNotEqual(row, [(None,)], f'{ident} was not acknowledged')
        self.shutdown()

    def test_08_second_serve_on_alias_is_refused_short(self):
        self.recruit('w9', 'codex')
        self.queue('w9', {'body': 'w9 held turn', 'hold_exit': True})
        self.dispatch('t9', 'w9', 'Task holding the first serve.')
        self.receiver('w9')
        self.start_owner()
        self.start_serve()
        held, _ = self.stream_for('w9')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        alias = self.directory / 'state-alias.db'
        os.link(self.db, alias)
        second = subprocess.Popen([str(EXE), str(alias), 'serve'],
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                  text=True)
        self.children.append(second)
        stdout, stderr = second.communicate()
        self.assertNotEqual(second.returncode, 0,
                            f'second serve exited {second.returncode}: {stdout} {stderr}')
        self.assertIn('coordinator-held', stderr,
                      f'second serve refusal names no role: {stdout} {stderr}')
        residents = [p for p in self.owned_processes() if self.is_serve(p)]
        self.assertEqual(len(residents), 1, 'two serves hold one database')
        owners = [p for p in self.owned_processes() if self.is_owner(p)]
        self.assertEqual(len(owners), 1, 'two serve paths elect two owners')
        status_main = self.coord('owner-status')
        status_alias = subprocess.run([str(EXE), str(alias), 'owner-status'],
                                      capture_output=True, text=True)
        self.assertEqual(status_alias.returncode, 0, status_alias.stderr)
        self.assertEqual(json.loads(status_alias.stdout)['generation'],
                         status_main['generation'],
                         'alias path sees a different owner')
        self.release('w9')
        self.shutdown()
        self.start_owner()
        self.start_serve(db=alias)
        self.queue('w9', {'body': 'w9 alias second task'})
        self.dispatch('t9b', 'w9', 'Second task through the alias serve.')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w9 alias second task' in m['body'] for m in messages)
            else None),
            'serve on the alias never serviced the database after release')
        self.shutdown()

    def test_09_muse_receiver_continues_owed_input_in_the_same_session(self):
        self.recruit('m1', 'muse')
        self.dispatch('tm1', 'm1', 'Task for a Muse session.')
        self.queue('m1', {'body': 'Muse first completed turn', 'ack': False, 'hold_exit': True},
                   {'body': 'Muse resumed handled input'})
        self.receiver('m1')
        self.start_owner()
        self.start_serve()
        first, _ = self.stream_for('m1')
        self.assertEqual(json.loads(first.readline()), {'terminal_written': True})
        original = self.connections('m1')[0]
        self.assertIn('[id: tm1]', original['prompt'])
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='tm1'"), [(None,)])
        self.dispatch('gm1', 'm1', 'Complete the owed task and this new guidance.', kind='guidance')
        self.assertEqual(len(self.connections('m1')), 1, 'guidance started a second live Muse process')
        self.release('m1')
        self.stream_for('m1', 1)
        resumed = self.connections('m1')[1]
        self.assertEqual(resumed['native'], original['native'])
        self.assertEqual(resumed['resume'], original['native'])
        self.assertIn('[id: tm1]', resumed['prompt'])
        self.assertIn('[id: gm1]', resumed['prompt'])
        self.await_inbox('root', lambda messages: (
            messages if any('Muse resumed handled input' in message['body'] for message in messages)
            else None), 'the resumed Muse report never reached its conductor')
        self.assertEqual(self.inbox('m1'), [])
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id IN ('tm1','gm1') ORDER BY id"),
                         [('native-reviewed',), ('native-reviewed',)])
        self.assertEqual(len(self.connections('m1')), 2, 'Muse input was executed more than once')
        self.shutdown()

    def test_10_completed_session_serves_later_dispatch(self):
        def phase(text):
            print(f'FIXED10 {text}', file=sys.stderr, flush=True)

        def native_settled():
            rows = self.query("SELECT directory,phase,status FROM executions WHERE session='w1'")
            if len(rows) != 1 or rows[0][1] != 'exited':
                return False
            self.assertEqual(rows[0][2], '0', rows)
            attempt = pathlib.Path(rows[0][0])
            return all((attempt / marker).exists() for marker in ('released', 'acknowledged'))

        # The first completed task is followed by a later dispatch. The second
        # native task remains held while its session moves to the App receiver.
        self.recruit('w1', 'codex')
        self.queue('w1', {'body': 'w1 first turn complete', 'hold_exit': True})
        self.dispatch('t1', 'w1', 'First task.')
        self.receiver('w1')
        self.start_owner()
        phase('starting the shared subscription')
        self.start_serve()
        phase('waiting for the first native terminal')
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        self.release('w1')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 first turn complete' in m['body'] for m in messages) else None),
            'first turn report never reached the root inbox')
        phase('waiting for the first native attempt to settle')
        self.eventually(native_settled, 'the first native attempt was not consumed')
        phase('dispatching the later native task')
        self.queue('w1', {'body': 'w1 second turn complete', 'hold_exit': True})
        self.dispatch('t2', 'w1', 'Second task after the first completion.')
        second_w1, _ = self.stream_for('w1', 1)
        self.assertEqual(json.loads(second_w1.readline()), {'terminal_written': True})
        row = self.query("SELECT receipt FROM messages WHERE id='t2'")
        self.assertNotEqual(row, [(None,)], 't2 was not acknowledged')

        phase('changing the receiver while the second native attempt remains held')
        self.managed_app_proxy()
        previous_calls = len(self.codex_calls.read_text().splitlines()) if self.codex_calls.exists() else 0
        self.queue('w1-app', {'controlReady': True})
        self.coord('connect', 'w1', 'native-w1', json.dumps([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w1']))

        def app_calls(method):
            lines = self.codex_calls.read_text().splitlines(keepends=True)
            rows = [json.loads(line) for line in lines[previous_calls:] if line.endswith('\n')]
            return [row for row in rows if row['method'] == method
                    and row.get('params', {}).get('threadId') == 'native-w1']

        self.dispatch('t3', 'w1', 'Handle the remaining input when this App turn settles.')
        self.assertTrue(app_calls('turn/steer'), 'the short sender admitted input to the active App turn')
        phase('releasing the old native task after the receiver changed')
        self.release('w1', 1)
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 second turn complete' in m['body'] for m in messages) else None),
            'later dispatch for a completed session never ran')
        phase('waiting for the current managed receiver')
        def managed_connected():
            self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='t3'"), [(None,)],
                             'the old native continuation acknowledged managed input')
            self.assertEqual(len(self.connections('w1')), 2,
                             'the previous native receiver ran after the managed route was recorded')
            return self.connections('w1-app')
        self.eventually(managed_connected, 'the current managed receiver did not connect')
        self.stream_for('w1-app')
        self.assertTrue(app_calls('turn/steer'), 'the short sender admitted input to the active App turn')
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='t3'"), [(None,)])

        def follow_events(kind):
            if not self.app_follow_events.exists():
                return []
            return [row for line in self.app_follow_events.read_text().splitlines(keepends=True)
                    if line.endswith('\n') and (row := json.loads(line))['type'] == kind]

        self.eventually(lambda: follow_events('codexInboxSubscribed'),
                        'the managed follower never subscribed to the active App thread')
        phase('settling the App turn while the database writer is held')
        writer = sqlite3.connect(str(self.db))
        try:
            writer.execute('BEGIN EXCLUSIVE')
            self.release('w1-app', settle=True)
            busy = self.eventually(lambda: follow_events('codexInboxDatabaseBusy'),
                                   'the held writer did not reach the follower read')
            self.assertEqual(busy[0]['errcode'] & 255, sqlite3.SQLITE_BUSY)
            self.assertEqual(app_calls('turn/start'), [],
                             'the follower continued before its pending-input read succeeded')
            writer.commit()
        finally:
            writer.close()
        self.coord('report', 'app-writer-released', 'w1',
                   'The fixture writer released after the App settled with input still owed.')
        phase('waiting for managed continuation after the writer committed')
        self.eventually(lambda: follow_events('codexInboxDatabaseReady'),
                        'the ordinary commit did not resume the held follower read')
        self.eventually(lambda: app_calls('turn/start'), 'App completion did not prompt its remaining inbox')
        self.assertEqual(len(follow_events('codexInboxSubscribed')), 1,
                         'writer contention replaced the existing App follower')
        self.assertIn('"recipient":"w1"', app_calls('turn/start')[0]['params']['input'][0]['text'])
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='t3'"), [(None,)],
                         'the lifecycle watcher acknowledged input')
        self.dispatch('g3', 'w1', 'New input while the same App watcher remains active.', kind='guidance')
        self.coord('ack', 't3', 'w1', 'w1-app-handled-t3')
        self.dispatch('g4', 'w1', 'Later guidance after the recipient handled its earlier input.', kind='guidance')
        self.assertEqual(len(self.connections('w1-app')), 1, 'own ACK or new input duplicated the App watcher')
        phase('settling the App turn with later guidance')
        self.release('w1-app', settle=True)
        self.eventually(lambda: len(app_calls('turn/start')) >= 2,
                        'the next actual App completion did not prompt still-owed guidance')
        self.assertEqual(len(app_calls('turn/start')), 2, 'one actual continuation follows each observed settlement')
        self.assertEqual(len(self.connections('w1-app')), 1, 'settlement duplicated the App watcher')
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id IN ('g3','g4') ORDER BY id"),
                         [(None,), (None,)], 'App input admission changed recipient receipts')
        self.assertEqual(len(self.connections('w1')), 2,
                         'the previous native receiver ran while later App guidance was pending')
        phase('settling a recoverable App stream failure with guidance still owed')
        error = {'message': 'The response stream disconnected before completion.',
                 'codexErrorInfo': {'responseStreamDisconnected': {'httpStatusCode': None}}}
        self.release('w1-app', settle=True, status='failed', error=error)
        self.eventually(lambda: len(app_calls('turn/start')) >= 3,
                        'a recoverable App failure did not continue its owed input')
        self.assertEqual(len(app_calls('turn/start')), 3)
        retained_failure = self.await_inbox('root', lambda messages: next((message for message in messages
            if 'codex-inbox-continuation-failed' in message['body']
            and 'responseStreamDisconnected' in message['body']), None),
            'the recoverable App failure cause was not retained')
        self.assertEqual(json.loads(retained_failure['body'])['threadId'], 'native-w1')
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id IN ('g3','g4') ORDER BY id"),
                         [(None,), (None,)])
        phase('interrupting the continued App turn with guidance still owed')
        self.release('w1-app', settle=True, status='interrupted')
        self.eventually(lambda: any(event['turn']['status'] == 'interrupted'
            for event in follow_events('codexInboxTurnRetained')),
            'the interrupted App turn was not retained')
        self.coord('report', 'app-interruption-observed', 'w1', 'The operator interrupted the App turn.')
        self.assertEqual(len(app_calls('turn/start')), 3,
                         'the follower resumed an interrupted App turn')
        self.assertEqual(len(self.connections('w1-app')), 1)
        self.coord('stop', 'w1', 'app-operator-stop', 'Retain the remaining App guidance.')
        phase('waiting for the explicitly stopped watcher to exit')
        self.eventually(lambda: not any('--follow' in process['command'] and str(self.db) in process['command']
                                       for process in self.owned_processes()),
                        'the managed watcher remained live after the explicit stop')
        self.assertEqual([message['id'] for message in self.inbox('w1')], ['g3', 'g4'])
        self.assertEqual(self.query("SELECT id,reason FROM session_stops WHERE session='w1'"),
                         [('app-operator-stop', 'Retain the remaining App guidance.')])
        phase('shutting down the completed fixture')
        self.shutdown()

    def test_managed_worker_keeps_its_open_assignment_after_own_inbox_ack(self):
        self.recruit('w1', 'codex')
        self.managed_app_proxy()
        self.queue('w1-app', {'controlReady': True})
        self.coord('connect', 'w1', 'native-w1', json.dumps([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w1']))
        self.dispatch('managed-task', 'w1', 'Continue this task until the coordinator confirms completion.')
        self.start_owner()
        self.start_serve()
        self.stream_for('w1-app')

        def events(kind):
            if not self.app_follow_events.exists(): return []
            return [event for line in self.app_follow_events.read_text().splitlines(keepends=True)
                    if line.endswith('\n') and (event := json.loads(line))['type'] == kind]

        def starts():
            if not self.codex_calls.exists(): return []
            return [call for line in self.codex_calls.read_text().splitlines(keepends=True)
                    if line.endswith('\n') and (call := json.loads(line))['method'] == 'turn/start']

        self.coord('ack', 'managed-task', 'w1', 'The worker handled its original task input.')
        self.eventually(lambda: events('codexInboxTaskAwaitingConfirmation'),
                        'Own inbox ACK ended observation of an unconfirmed task.')
        self.assertEqual(self.inbox('w1'), [])
        self.assertTrue(self.coord('session', 'w1')['taskCompletion']['open'])
        self.assertTrue(any('--follow' in process['command'] for process in self.owned_processes()))
        self.release('w1-app', settle=True)
        self.eventually(starts, 'Successful App settlement did not continue its open assignment.')
        self.assertEqual(len(starts()), 1)
        self.assertEqual(len(self.connections('w1-app')), 1)
        continuation = self.inbox('w1')
        self.assertEqual([message['kind'] for message in continuation], ['task-continuation'])
        self.assertIsNone(continuation[0]['receipt'])

        self.coord('message', 'managed-ready', 'w1', 'root', 'completion-request',
                   'The managed worker task result is ready.')
        self.coord('ack', 'managed-ready', 'root', 'The immediate coordinator reviewed the result.')
        self.coord('message', 'managed-confirmed', 'root', 'w1', 'completion-confirmed', 'managed-ready')
        self.coord('ack', continuation[0]['id'], 'w1', 'The worker handled its continuation input.')
        self.coord('ack', 'managed-confirmed', 'w1', 'The worker handled coordinator confirmation.')
        self.eventually(lambda: events('codexInboxReleased'), 'The confirmed App worker did not settle.')
        self.assertFalse(self.coord('session', 'w1')['taskCompletion']['open'])
        self.assertEqual(self.inbox('w1'), [])
        self.shutdown()

    def test_11_owner_drain_leaves_no_duplicate_serve_admission(self):
        # An ordinary Receive owns the native attempt before the serve starts.
        self.recruit('w1', 'codex')
        self.queue('w1', {'body': 'w1 turn one complete', 'hold_exit': True},
                   {'body': 'w1 guidance turn complete'})
        self.dispatch('t1', 'w1', 'First task.')
        self.receiver('w1')
        self.start_owner()
        original_receive = subprocess.Popen([
            str(EXE), str(self.db), 'receive', 'w1', str(self.fixture), 'w1', 'low',
            str(self.checkouts / 'w1'), str(self.co_dir / 'w1.jsonl'), ''],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(original_receive)
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        held_attempt = self.query("SELECT id FROM executions WHERE session='w1'")
        self.dispatch('g1', 'w1', 'Guidance issued while turn one is held.', kind='guidance')
        self.start_serve()
        self._serve_lines = []

        def _drain():
            try:
                for line in self.serve_proc.stdout:
                    self._serve_lines.append(line)
            except (OSError, ValueError):
                pass
        drain = threading.Thread(target=_drain, daemon=True)
        drain.start()
        queued = self.coord('receive', 'w1', str(self.fixture), 'w1', 'low',
                            str(self.checkouts / 'w1'), str(self.co_dir / 'w1.jsonl'), '')
        self.assertEqual(queued['status'], 'queued', 'ordinary receive waited for the active native turn')
        self.assertEqual(self.query("SELECT id FROM executions WHERE session='w1'"), held_attempt,
                         'the queued receive replaced the original native attempt')
        self.assertEqual(len(self.connections('w1')), 1,
                         'guidance forked a second native while the turn is held')
        self.release('w1')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 turn one complete' in m['body'] for m in messages)
            and any('w1 guidance turn complete' in m['body'] for m in messages) else None),
            'turn and guidance reports never reached the root inbox')
        self.assertEqual(len(self.connections('w1')), 2,
                         'guidance ran without exactly one resume')
        bodies = [m['body'] for m in self.inbox('root')]
        self.assertEqual(len([b for b in bodies if 'w1 guidance turn complete' in b]), 1,
                         'guidance executed more than once')
        log = ''.join(self._serve_lines)
        self.assertNotIn('serve-refused w1', log,
                         'the serve refused work the owner drain consumed')
        for ident in ('t1', 'g1'):
            row = self.query(f"SELECT receipt FROM messages WHERE id='{ident}'")
            self.assertNotEqual(row, [(None,)], f'{ident} was not acknowledged')
        stdout, stderr = original_receive.communicate()
        self.assertEqual(original_receive.returncode, 0, stdout + stderr)
        self.shutdown()

    def test_12_failed_session_keeps_other_sessions_and_subscription_active(self):
        self.recruit('bad', 'omp')
        self.recruit('held', 'codex')
        self.recruit('late', 'codex')
        self.queue('bad', {'fail_status': 403, 'fail_message': 'fixture subscription exhausted'})
        self.queue('held', {'body': 'Held work completed after another session failed',
                            'hold_exit': True})
        self.queue('late', {'body': 'Later work completed through the existing subscription'})
        self.dispatch('failed-task', 'bad', 'Accepted work whose provider fails.')
        self.dispatch('held-task', 'held', 'Keep this native work active.')
        for session in ('bad', 'held', 'late'):
            self.receiver(session)
        self.start_owner()
        self.start_serve()
        serve_lines = []

        def drain():
            try:
                for line in self.serve_proc.stdout:
                    serve_lines.append(line)
            except (OSError, ValueError):
                pass

        threading.Thread(target=drain, daemon=True).start()
        held_stream, _ = self.stream_for('held')
        self.assertEqual(json.loads(held_stream.readline()), {'terminal_written': True})
        self.await_inbox('root', lambda messages: (
            messages if any('fixture subscription exhausted' in message['body']
                            for message in messages) else None),
            'the actual failed provider report was not retained')
        self.eventually(lambda: any('Serve task bad failed:' in line for line in serve_lines),
                        'the failed session result never reached the shared event loop')
        self.assertIsNone(self.serve_proc.poll(), 'one session failure ended the serve')
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='failed-task'"),
                         [('native-reviewed',)])
        self.assertEqual(len(self.connections('bad')), 1,
                         'the failed session was immediately launched again')
        self.assertEqual(len(self.connections('held')), 1,
                         'the unrelated active native was replaced')
        self.dispatch('late-task', 'late', 'New work after the other session failed.')
        self.await_inbox('root', lambda messages: (
            messages if any('Later work completed through the existing subscription'
                            in message['body'] for message in messages) else None),
            'the shared subscription stopped admitting unrelated new work')
        self.assertEqual(self.connections('late')[0]['ppid'], self.owner_pid)
        self.release('held')
        self.await_inbox('root', lambda messages: (
            messages if any('Held work completed after another session failed'
                            in message['body'] for message in messages) else None),
            'the unrelated native lost its completion observer')
        self.assertEqual(self.inbox('held'), [])
        self.assertEqual(self.inbox('late'), [])
        self.assertEqual(self.query("SELECT count(*) FROM session_stops"), [(0,)])
        self.shutdown(expect_serve=1)

    def test_13_endpointless_codex_continues_owed_input_after_settlement(self):
        self.recruit('w1', 'codex')
        self.managed_app_proxy()
        self.queue('w1-app', {'controlReady': True})
        self.dispatch('endpointless-task', 'w1', 'Continue this original task after the App turn settles.')
        self.start_owner()
        self.start_serve()
        self.stream_for('w1-app')

        def app_calls(method):
            lines = self.codex_calls.read_text().splitlines(keepends=True)
            return [row for line in lines if line.endswith('\n')
                    for row in [json.loads(line)] if row['method'] == method
                    and row.get('params', {}).get('threadId') == 'native-w1']

        self.assertEqual(self.query("SELECT native,endpoint FROM sessions WHERE id='w1'"),
                         [('native-w1', '')])
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='endpointless-task'"),
                         [(None,)])
        self.assertTrue(app_calls('turn/steer'), 'the public sender did not admit the original input')
        self.release('w1-app', settle=True)
        self.eventually(lambda: app_calls('turn/start'),
                        'the endpointless App session did not continue its original owed input')
        self.assertEqual(len(app_calls('turn/start')), 1)
        self.dispatch('endpointless-guidance', 'w1', 'Handle this guidance with the original task.',
                      kind='guidance')
        self.release('w1-app', settle=True)
        self.eventually(lambda: len(app_calls('turn/start')) >= 2,
                        'the endpointless App session lost later owed guidance')
        self.assertEqual(len(app_calls('turn/start')), 2)
        pointer = app_calls('turn/start')[-1]['params']['input'][0]['text']
        self.assertIn('"pendingCount":2', pointer)
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE recipient='w1' ORDER BY seq"),
                         [(None,), (None,)])
        self.assertEqual(len(self.connections('w1-app')), 1,
                         'the original App follower was replaced')
        self.assertEqual(len(self.connections('w1')), 0,
                         'the endpointless App session launched a native CLI receiver')
        self.coord('stop', 'w1', 'endpointless-operator-stop', 'Retain the remaining App input.')
        self.eventually(lambda: not any('--follow' in process['command'] and str(self.db) in process['command']
                                       for process in self.owned_processes()),
                        'the endpointless follower remained live after the explicit stop')
        self.assertEqual([message['id'] for message in self.inbox('w1')],
                         ['endpointless-task', 'endpointless-guidance'])
        self.assertEqual(self.query("SELECT native,endpoint FROM sessions WHERE id='w1'"),
                         [('native-w1', '')])
        self.shutdown()

    def test_14_one_shot_session_read_waits_out_a_held_database_writer(self):
        def phase(text):
            print(f'FIXED14 {text}', file=sys.stderr, flush=True)

        self.recruit('w1', 'codex')
        self.managed_app_proxy()
        self.queue('w1-app', {'controlReady': True})
        self.coord('connect', 'w1', 'native-w1', json.dumps([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w1']))
        self.dispatch('busy-task', 'w1', 'Admit this input once the held writer releases.')
        self.start_owner()
        self.start_serve()
        self.stream_for('w1-app')

        def app_calls(method):
            lines = self.codex_calls.read_text().splitlines(keepends=True)
            return [row for line in lines if line.endswith('\n')
                    for row in [json.loads(line)] if row['method'] == method
                    and row.get('params', {}).get('threadId') == 'native-w1']

        self.eventually(lambda: app_calls('turn/steer'),
                        'the recorded endpoint did not admit the original input')
        wake_events = []

        def drain(stream):
            try:
                for line in stream:
                    wake_events.append(json.loads(line))
            except (OSError, ValueError):
                pass

        def spawn_session_wake(thread):
            wake = subprocess.Popen([
                'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
                str(EXE), str(self.db), 'w1', thread, 'busy-task'],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.children.append(wake)
            threading.Thread(target=drain, args=(wake.stdout,), daemon=True).start()
            return wake

        phase('holding the database writer across the one-shot session read')
        writer = sqlite3.connect(str(self.db))
        try:
            writer.execute('BEGIN EXCLUSIVE')
            # Readiness needs no database read and an external empty commit
            # publishes no committed-change notification, so the one-shot
            # reread relies on the native busy handler waiting through the
            # held lock itself.
            wake = spawn_session_wake('native-w1')
            busy = self.eventually(lambda: [event for event in wake_events
                                            if event['type'] == 'codexInboxDatabaseBusy'],
                                   'the held writer did not reach the one-shot session read')
            self.assertEqual(busy[0]['errcode'] & 255, sqlite3.SQLITE_BUSY)
            self.assertEqual(len(app_calls('turn/steer')), 1,
                             'the one-shot delivery continued before its committed read succeeded')
            self.assertIsNone(wake.poll(), 'the one-shot delivery exited while the writer was still held')
            writer.commit()
        finally:
            writer.close()
        phase('waiting for the committed read after the writer released')
        self.eventually(lambda: [event for event in wake_events
                                 if event['type'] == 'codexInboxDatabaseReady'],
                        'the released writer did not resume the one-shot committed read')
        self.eventually(lambda: len(app_calls('turn/steer')) == 2,
                        'the released writer did not lead to a fresh committed admission')
        steers = app_calls('turn/steer')
        self.assertEqual(len(steers), 2, 'the one-shot delivery admitted its input more than once')
        self.assertIn('"recipient":"w1"', steers[1]['params']['input'][0]['text'])
        self.assertIn('"message":"busy-task"', steers[1]['params']['input'][0]['text'])
        self.assertEqual(self.query("SELECT receipt FROM messages WHERE id='busy-task'"),
                         [(None,)], 'the one-shot admission acknowledged the input')
        self.eventually(lambda: wake.poll() is not None,
                        'the one-shot delivery did not settle after its admission')
        self.assertEqual(wake.returncode, 0, ''.join(wake.stderr.readlines()))

        phase('changing the recorded native conversation before another one-shot read')
        self.coord('connect', 'w1', 'native-w2', json.dumps([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w2']))
        changed = subprocess.run([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w1', 'busy-task'],
            capture_output=True, text=True)
        self.assertEqual(changed.returncode, 1, 'a superseded native identity did not fail the one-shot delivery')
        self.assertIn('another native conversation', changed.stderr)

        phase('stopping the session before another one-shot read')
        self.coord('stop', 'w1', 'one-shot-operator-stop', 'Retain the remaining one-shot input.')
        retained = subprocess.run([
            'node', str(ROOT / 'bend2/scripts/codex-inbox-wake.mjs'), '--session',
            str(EXE), str(self.db), 'w1', 'native-w2', 'busy-task'],
            capture_output=True, text=True)
        self.assertEqual(retained.returncode, 0, retained.stderr)
        retained_events = [json.loads(line) for line in retained.stdout.splitlines()]
        self.assertEqual([event['type'] for event in retained_events], ['codexInboxRetained'],
                         'the stopped session produced an unexpected one-shot record')
        self.assertTrue(retained_events[0]['stopped'])
        self.assertEqual(len(app_calls('turn/steer')), 2, 'the stopped session was admitted again')
        self.shutdown()


if __name__ == '__main__':
    unittest.main()
