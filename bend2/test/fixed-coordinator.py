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
        self.coord('attach', 'root', 'codex', 'native-root', '')
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

    def test_09_muse_session_is_refused_with_its_turn_route(self):
        self.recruit('m1', 'muse')
        self.dispatch('tm1', 'm1', 'Task for a Muse session.')
        self.start_owner()
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

        def refusal():
            log = ''.join(self._serve_lines)
            return log if 'serve-refused m1 muse' in log else None
        log = self.eventually(refusal, 'serve never refused the Muse session')
        self.assertIn('dispatch-turn', log, 'refusal names no Turn route')
        self.assertEqual(self.connections('m1'), [],
                         'the serve started a native for a refused session')
        self.assertIsNone(self.serve_proc.poll(), 'serve died on a refused session')
        row = self.query("SELECT receipt FROM messages WHERE id='tm1'")
        self.assertEqual(row, [(None,)], 'refused input was consumed or lost')
        self.shutdown()

    def test_10_completed_session_serves_later_dispatch(self):
        # The TaskDone drop is load-bearing in the post-quiescence window: a
        # row dispatched after the previous task fully drained must fork anew.
        # Without without_id the completed session stays in-flight forever and
        # the later row is refused aloud instead of served.
        self.recruit('w1', 'codex')
        self.queue('w1', {'body': 'w1 first turn complete', 'hold_exit': True})
        self.dispatch('t1', 'w1', 'First task.')
        self.receiver('w1')
        self.start_owner()
        self.start_serve()
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        self.release('w1')
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 first turn complete' in m['body'] for m in messages) else None),
            'first turn report never reached the root inbox')
        self.queue('w1', {'body': 'w1 second turn complete'})
        self.dispatch('t2', 'w1', 'Second task after the first completion.')
        self.stream_for('w1', 1)
        self.await_inbox('root', lambda messages: (
            [m['body'] for m in messages]
            if any('w1 second turn complete' in m['body'] for m in messages) else None),
            'later dispatch for a completed session never ran')
        row = self.query("SELECT receipt FROM messages WHERE id='t2'")
        self.assertNotEqual(row, [(None,)], 't2 was not acknowledged')
        self.shutdown()

    def test_11_owner_drain_leaves_no_duplicate_serve_admission(self):
        # The actual owner/native topology: the owner/Receive drain runs
        # queued guidance inside the open call while the serve must not
        # fork a duplicate native nor refuse aloud what the drain consumes.
        self.recruit('w1', 'codex')
        self.queue('w1', {'body': 'w1 turn one complete', 'hold_exit': True},
                   {'body': 'w1 guidance turn complete'})
        self.dispatch('t1', 'w1', 'First task.')
        self.receiver('w1')
        self.start_owner()
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
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        self.dispatch('g1', 'w1', 'Guidance issued while turn one is held.', kind='guidance')
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
        self.shutdown()


if __name__ == '__main__':
    unittest.main()
