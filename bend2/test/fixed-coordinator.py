#!/usr/bin/env python3
"""Fixed-coordinator gate for the shared native runtime.

One owner plus one serve holds each database. The serve subscribes before its
first snapshot, drives every session with actionable pending input as a
concurrent native task, re-snapshots after every joined task, and blocks on
the owner notice while idle. These legs gate that contract through ordinary
CLI verbs against the elected owner; they do not depend on Store publication.
"""
import json
import os
import pathlib
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import unittest

TESTDIR = pathlib.Path(__file__).resolve().parent
ROOT = TESTDIR.parent.parent
EXE = ROOT / '.scratch/bend2/baton2'
MCP = ROOT / 'bend2/scripts/mcp-conductor.mjs'

sys.path.insert(0, str(TESTDIR))
from receive import FIXTURE


class FixedCoordinator(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix='fixed-coord ', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
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
        self.owner_proc = None
        self.serve_proc = None
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')

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
        self._acceptor.join(10)
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
            try:
                child.communicate(timeout=10)
            except subprocess.TimeoutExpired:
                child.kill()
                child.communicate()

    def is_serve(self, process):
        return process['command'].endswith(' serve') or ' serve ' in process['command']

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

    def eventually(self, observation, description, timeout=30):
        deadline = time.monotonic() + timeout
        while True:
            result = observation()
            if result:
                return result
            self.assertLess(time.monotonic(), deadline, description)
            time.sleep(.05)

    def coord(self, *args, ok=True, timeout=30):
        result = subprocess.run([str(EXE), str(self.db), *map(str, args)],
                                capture_output=True, text=True, timeout=timeout)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout) if result.stdout.strip().startswith(('[', '{')) else result.stdout
        return result

    def query(self, sql):
        with sqlite3.connect(str(self.db), timeout=30) as database:
            return database.execute(sql).fetchall()

    def recruit(self, name, harness):
        return self.coord('recruit', name, 'root', harness, name, 'low', str(self.repo),
                          name + '-branch', str(self.checkouts / name), self.base)

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

    def await_inbox(self, recipient, predicate, description, timeout=60):
        # Reports land through the keeper observe pipeline after the native
        # exits; poll instead of reading once.
        deadline = time.monotonic() + timeout
        while True:
            found = predicate(self.inbox(recipient))
            if found:
                return found
            self.assertLess(time.monotonic(), deadline, description)
            time.sleep(.5)

    def start_owner(self):
        self.owner_proc = subprocess.Popen([str(EXE), '--instance-owner', str(self.db)],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(self.owner_proc)

        def ready():
            result = self.coord('owner-status', ok=False)
            if result.returncode != 0:
                return None
            return json.loads(result.stdout)
        self.eventually(ready, 'no elected owner', timeout=30)

    def start_serve(self):
        self.serve_proc = subprocess.Popen([str(EXE), str(self.db), 'serve'],
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(self.serve_proc)

        def first_line():
            if self.serve_proc.poll() is not None:
                self.fail(f'serve exited before subscribing: {self.serve_proc.stderr.read()}')
            line = self.serve_proc.stdout.readline()
            return line or None
        line = self.eventually(first_line, 'serve never printed its subscription readiness',
                               timeout=30)
        return json.loads(line)

    def shutdown(self, expect_serve=0):
        result = subprocess.run([str(EXE), '--instance-shutdown', str(self.db)],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        if self.serve_proc is not None:
            stdout, stderr = self.serve_proc.communicate(timeout=60)
            self.assertEqual(self.serve_proc.returncode, expect_serve, stderr)
        if self.owner_proc is not None:
            try:
                self.owner_proc.communicate(timeout=60)
            except subprocess.TimeoutExpired:
                self.owner_proc.kill()
                self.owner_proc.communicate()
                self.fail('the owner stayed resident after shutdown with no attempts')

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

    def test_02_stopped_session_keeps_input_unexecuted(self):
        self.recruit('w4', 'codex')
        self.dispatch('t4', 'w4', 'Task for a session that stops before service.')
        self.coord('stop', 'w4', 'stop-1', 'halted before service')
        self.start_owner()
        self.start_serve()
        time.sleep(5)
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
        self.serve_proc.wait(timeout=10)
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
        time.sleep(3)
        bodies = [m['body'] for m in self.inbox('root') if m['sender'] == 'w7']
        self.assertEqual(len([b for b in bodies if 'w7 adopted turn complete' in b]), 1)
        row = self.query("SELECT receipt FROM messages WHERE id='t7'")
        self.assertNotEqual(row, [(None,)], 'adopted input was lost')
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
        owner = self.owner_proc
        os.kill(owner.pid, signal.SIGKILL)
        owner.wait(timeout=10)
        try:
            os.kill(native_pid, 0)
        except ProcessLookupError:
            self.fail('the native died with its owner')
        row = self.query("SELECT receipt FROM messages WHERE id='t8'")
        self.assertNotEqual(row, [(None,)], 'owner-loss input was lost')
        rows = self.query("SELECT phase FROM executions WHERE session='w8'")
        self.assertTrue(rows, 'owner-loss execution record was lost')
        # The stranded serve joined its task through the keeper death and only
        # returns when that join does; the supervisor restarts the generation.
        self.serve_proc.kill()
        self.serve_proc.wait(timeout=10)
        self.serve_proc = None
        self.owner_proc = None
        self.shutdown()

    def test_05_killed_client_leaves_atomic_commit_for_service(self):
        self.recruit('w6', 'codex')
        self.receiver('w6')
        bodies = {}
        for seq in range(3):
            ident = f'c{seq}'
            bodies[ident] = f'client-loss body {seq}'
            child = subprocess.Popen([str(EXE), str(self.db), 'message', ident, 'root', 'w6',
                                              'task', bodies[ident]],
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            self.children.append(child)
            time.sleep(.05)
            if child.poll() is None:
                child.kill()
        committed = []
        for ident, body in bodies.items():
            row = self.query(f"SELECT body, receipt FROM messages WHERE id='{ident}'")
            if row:
                self.assertEqual(row[0][0], body, f'{ident} committed partially')
                committed.append(ident)
        self.assertTrue(committed, 'no client input committed')
        self.start_owner()
        self.start_serve()
        self.await_inbox('root', lambda messages: (
            messages if len([m for m in messages if m['sender'] == 'w6']) >= len(committed)
            else None),
            'committed input was never serviced')
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
            text=True, capture_output=True, timeout=30)
        self.assertEqual(replies.returncode, 0, replies.stderr)
        by_id = {reply['id']: reply for reply in
                 (json.loads(line) for line in replies.stdout.splitlines())}
        names = [tool['name'] for tool in by_id[2]['result']['tools']]
        self.assertIn('baton2_owner', names)
        owner_json = json.loads(by_id[3]['result']['content'][0]['text'])
        self.assertEqual(owner_json['generation'], status['generation'])
        self.assertEqual(owner_json['cursor'], status['cursor'])
        self.shutdown()


if __name__ == '__main__':
    unittest.main()
