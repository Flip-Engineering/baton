"""Shared owner matrix for #676: one serve drives concurrent native sessions.

One resident `serve` per database admits ordinary CLI and MCP clients, runs
one concurrent task per session with pending input across Codex, OMP and Muse
harnesses, preserves queued guidance as continued turns under a stable native
conversation identity, skips stopped sessions, refuses a second owner while
one holds the claim, and preserves surviving native work across coordinator
loss. Measurements distinguish resident coordinator count from transient
keepers and fixtures.

The dual-protocol fixture is imported read-only from the receive suite, which
owns that harness protocol; this file owns only the driver choreography.
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
sys.path.insert(0, str(TESTDIR))
from receive import FIXTURE

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
MCP = ROOT / 'bend2/scripts/mcp-conductor.mjs'

MUSE_FIXTURE = '''import json,sys,pathlib
args=sys.argv
assert args[1]=='exec'
prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
session=args[args.index('--session-id')+1] if '--session-id' in args else 'native-muse'
print(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.model.configured','payload':{'kind':'run_model_configured','model_id':'actual-muse'}}))
print(json.dumps({'stream':{'kind':'session','id':session},'payload_type':'run.terminal.completed','payload':{'kind':'run_terminal','terminal':'completed','text':prompt}}))
'''


class Matrix(unittest.TestCase):
    def setUp(self):
        if not EXE.exists():
            self.skipTest(f'Coordinator not built at {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix='shared-matrix ', dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.repo = self.directory / 'repository'
        self.repo.mkdir()
        self.checkouts = self.directory / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Shared matrix fixture']):
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
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('attach', 'operator', 'terminal', '', '')
        self.coord('role', 'operator', 'operator')
        self._rss_stop = threading.Event()
        self._rss_peak = {}
        self._count_peak = {}
        self._rss_thread = None

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
                action = queue.pop(0) if queue else {'body': f'{session} matrix default completion'}
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
            return json.loads(result.stdout)
        return result

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), str(self.db), *map(str, args)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

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

    def pending(self):
        return self.coord('pending')

    def start_sampler(self):
        self._rss_stop.clear()
        self._rss_peak = {}
        self._count_peak = {}
        directory = str(self.directory)

        def sample():
            while not self._rss_stop.is_set():
                try:
                    result = subprocess.run(['ps', '-axo', 'rss=,command='],
                                            capture_output=True, text=True, timeout=5)
                except subprocess.TimeoutExpired:
                    continue
                totals = {}
                counts = {}
                for line in result.stdout.splitlines():
                    fields = line.strip().split(None, 1)
                    if len(fields) != 2 or directory not in fields[1]:
                        continue
                    try:
                        rss = int(fields[0])
                    except ValueError:
                        continue
                    first = fields[1].split(None, 1)[0]
                    is_baton = first.endswith('/baton2') or first == 'baton2'
                    if '--host-process-keeper' in fields[1]:
                        kind = 'keeper'
                    elif ' serve ' in fields[1]:
                        kind = 'serve'
                    elif ' receive ' in fields[1]:
                        kind = 'receive'
                    elif 'dispatch-message' in fields[1]:
                        kind = 'dispatch'
                    elif 'native-fixture' in fields[1]:
                        kind = 'fixture'
                    elif is_baton:
                        kind = 'cli'
                    else:
                        continue
                    totals[kind] = totals.get(kind, 0) + rss
                    counts[kind] = counts.get(kind, 0) + 1
                for kind, total in totals.items():
                    self._rss_peak[kind] = max(self._rss_peak.get(kind, 0), total)
                for kind, count in counts.items():
                    self._count_peak[kind] = max(self._count_peak.get(kind, 0), count)
                time.sleep(.1)

        self._rss_thread = threading.Thread(target=sample, daemon=True)
        self._rss_thread.start()

    def stop_sampler(self):
        self._rss_stop.set()
        if self._rss_thread is not None:
            self._rss_thread.join(10)
        return dict(self._rss_peak), dict(self._count_peak)

    def assert_pending(self, ident):
        row = self.query(f"SELECT receipt FROM messages WHERE id='{ident}'")
        self.assertEqual(row, [(None,)], f'{ident} did not stay queued')

    def ack_inbox(self, recipient):
        for message in self.inbox(recipient):
            self.coord('ack', message['id'], recipient, 'matrix-reviewed')

    def test_01_serve_drives_concurrent_codex_and_omp_with_queued_guidance(self):
        self.recruit('w1', 'codex')
        self.recruit('w2', 'omp')
        self.queue('w1', {'body': 'w1 turn one complete', 'hold_exit': True},
                   {'body': 'w1 guidance turn complete'})
        self.queue('w2', {'body': 'w2 turn one complete', 'hold_exit': True})
        self.dispatch('t1', 'w1', 'First task for w1.')
        self.dispatch('t2', 'w2', 'First task for w2.')
        self.assert_pending('t1')
        self.assert_pending('t2')
        self.receiver('w1')
        self.receiver('w2')
        self.start_sampler()
        serve = self.spawn('serve', 'matrix-owner-1')
        first_w1, _ = self.stream_for('w1')
        self.assertEqual(json.loads(first_w1.readline()), {'terminal_written': True})
        first_w2, _ = self.stream_for('w2')
        self.assertEqual(json.loads(first_w2.readline()), {'terminal_written': True})
        residents = [p for p in self.owned_processes() if ' serve ' in p['command']]
        self.assertEqual(len(residents), 1, 'one serve holds the database while two sessions run')
        self.assertEqual(len([p for p in self.owned_processes() if '--host-process-keeper' in p['command']]), 2)
        self.dispatch('g1', 'w1', 'Guidance issued while turn one is held.', kind='guidance')
        time.sleep(2)
        self.assertEqual(len(self.connections('w1')), 1,
                         'guidance queues instead of starting a second native while the turn is held')
        self.release('w1')
        second_w1, _ = self.stream_for('w1', 1)
        second_w1.close()
        self.release('w2')
        stdout, stderr = serve.communicate(timeout=90)
        self.assertEqual(serve.returncode, 0, stderr)
        peak_rss, peak_count = self.stop_sampler()
        print(f'matrix dual-session peak RSS KiB: {peak_rss} peak counts: {peak_count}')
        natives_w1 = [greeting['native'] for greeting in self.connections('w1')]
        self.assertEqual(len(natives_w1), 2)
        self.assertEqual(natives_w1[0], natives_w1[1], 'guidance continues the recorded native conversation')
        self.assertEqual(self.coord('player', 'w1')['native'], natives_w1[0])
        natives_w2 = [greeting['native'] for greeting in self.connections('w2')]
        self.assertEqual(len(natives_w2), 1)
        turns_w1 = self.coord('turns', 'w1')
        self.assertGreaterEqual(len(turns_w1), 1)
        bodies = self.coord('inbox', 'root')
        texts = [message['body'] for message in bodies]
        self.assertTrue(any('w1 turn one complete' in text for text in texts))
        self.assertTrue(any('w1 guidance turn complete' in text for text in texts))
        self.assertTrue(any('w2 turn one complete' in text for text in texts))
        for ident in ('t1', 't2', 'g1'):
            row = self.query(f"SELECT receipt FROM messages WHERE id='{ident}'")
            self.assertNotEqual(row, [(None,)], f'{ident} was not acknowledged')
        self.assertIsNone(self.coord('owner-status'))

    def test_02_second_owner_refused_while_serve_holds_with_live_mcp_and_cli(self):
        self.recruit('w3', 'codex')
        self.queue('w3', {'body': 'w3 held turn complete', 'hold_exit': True})
        self.dispatch('t3', 'w3', 'Task for the held owner test.')
        self.assert_pending('t3')
        self.receiver('w3')
        first = self.spawn('serve', 'matrix-owner-A')
        held, _ = self.stream_for('w3')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        refused = self.coord('serve', 'matrix-owner-B', ok=False, timeout=20)
        self.assertNotEqual(refused.returncode, 0)
        combined = refused.stdout + refused.stderr
        self.assertIn('duplicate-owner', combined)
        self.assertIn('matrix-owner-A', combined)
        status = self.coord('owner-status')
        self.assertEqual(status['owner'], 'matrix-owner-A')
        for verb in (['pending'], ['inbox', 'root'], ['owner-status'], ['subscribe']):
            started = time.monotonic()
            self.coord(*verb)
            self.assertLess(time.monotonic() - started, 5, f'{verb} stalled beside the resident serve')
        replies = self.mcp(
            {'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
             'params': {'protocolVersion': '2024-11-05', 'capabilities': {}, 'clientInfo': {'name': 'm', 'version': '0'}}},
            {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list', 'params': {}},
            {'jsonrpc': '2.0', 'id': 3, 'method': 'tools/call',
             'params': {'name': 'baton2_owner', 'arguments': {}}},
            {'jsonrpc': '2.0', 'id': 4, 'method': 'tools/call',
             'params': {'name': 'baton2_subscribe', 'arguments': {}}})
        by_id = {reply['id']: reply for reply in replies}
        names = [tool['name'] for tool in by_id[2]['result']['tools']]
        self.assertIn('baton2_owner', names)
        self.assertIn('baton2_subscribe', names)
        owner_text = json.dumps(by_id[3]['result'])
        self.assertIn('matrix-owner-A', owner_text)
        subscribe_text = json.dumps(by_id[4]['result'])
        self.assertIn('matrix-owner-A', subscribe_text)
        self.release('w3')
        stdout, stderr = first.communicate(timeout=90)
        self.assertEqual(first.returncode, 0, stderr)
        texts = [message['body'] for message in self.inbox('root')]
        self.assertTrue(any('w3 held turn complete' in text for text in texts))
        self.assertIsNone(self.coord('owner-status'))

    def mcp(self, *requests):
        result = subprocess.run(
            ['node', str(MCP), str(self.db), str(EXE), '--session', 'root'],
            input=''.join(json.dumps(row) + '\n' for row in requests),
            text=True, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        return [json.loads(line) for line in result.stdout.splitlines()]

    def test_03_killed_serve_is_adopted_without_duplicate_resume(self):
        self.recruit('w7', 'codex')
        self.queue('w7', {'body': 'w7 adopted turn complete', 'hold_exit': True})
        self.dispatch('t7', 'w7', 'Task surviving its first owner.')
        self.assert_pending('t7')
        self.receiver('w7')
        first = self.spawn('serve', 'matrix-owner-adopt')
        held, _ = self.stream_for('w7')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        first.kill()
        first.wait(timeout=10)
        keepers = [p for p in self.owned_processes() if '--host-process-keeper' in p['command']]
        self.assertEqual(len(keepers), 1, 'the keeper survives its coordinator')
        self.assertEqual(self.coord('owner-status')['owner'], 'matrix-owner-adopt')
        second = self.spawn('serve', 'matrix-owner-adopt')
        time.sleep(3)
        self.assertEqual(len(self.connections('w7')), 1,
                         'adoption reuses the live native instead of resuming a duplicate')
        self.release('w7')
        stdout, stderr = second.communicate(timeout=90)
        self.assertEqual(second.returncode, 0, stderr)
        bodies = [m['body'] for m in self.inbox('root') if m['sender'] == 'w7']
        self.assertEqual(len([b for b in bodies if 'w7 adopted turn complete' in b]), 1)
        row = self.query("SELECT receipt FROM messages WHERE id='t7'")
        self.assertNotEqual(row, [(None,)], 'adopted input was lost')
        self.assertIsNone(self.coord('owner-status'))

    def test_04_keeper_loss_completes_exactly_once(self):
        self.recruit('w8', 'codex')
        self.queue('w8', {'body': 'w8 keeper-loss turn complete', 'hold_exit': True})
        self.receiver('w8')
        msg = subprocess.Popen([str(EXE), str(self.db), 'message', 't8', 'root', 'w8',
                                'task', 'Task surviving its keeper.'],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(msg)
        held, _ = self.stream_for('w8')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        keeper = self.eventually(
            lambda: next((p for p in self.owned_processes()
                          if '--host-process-keeper' in p['command']), None),
            'no keeper for the held turn')
        native_pid = self.connections('w8')[0]['pid']
        os.kill(keeper['pid'], signal.SIGKILL)
        try:
            os.kill(native_pid, 0)
        except ProcessLookupError:
            self.fail('the native died with its keeper')
        self.release('w8')
        try:
            msg.communicate(timeout=120)
        except subprocess.TimeoutExpired:
            msg.kill()
            self.fail('the surviving observer never reconciled the keeper loss')
        bodies = [m['body'] for m in self.inbox('root') if m['sender'] == 'w8']
        self.assertEqual(len([b for b in bodies if 'w8 keeper-loss turn complete' in b]), 1)
        row = self.query("SELECT receipt FROM messages WHERE id='t8'")
        self.assertNotEqual(row, [(None,)], 'keeper-loss input was lost')
        self.ack_inbox('root')
        serve = self.spawn('serve', 'matrix-owner-after-loss')
        stdout, stderr = serve.communicate(timeout=60)
        self.assertEqual(serve.returncode, 0, stderr)
        self.assertIsNone(self.coord('owner-status'))

    def test_05_stopped_session_keeps_input_unexecuted(self):
        self.recruit('w4', 'codex')
        self.dispatch('t4', 'w4', 'Task for a session that stops before service.')
        self.assert_pending('t4')
        self.coord('stop', 'w4', 'stop-1', 'halted before service')
        serve = self.spawn('serve', 'matrix-owner-stop')
        stdout, stderr = serve.communicate(timeout=60)
        self.assertEqual(serve.returncode, 0, stderr)
        self.assertFalse(self.coord('turns', 'w4'))
        row = self.query("SELECT receipt FROM messages WHERE id='t4'")
        self.assertEqual(row, [(None,)], 'stopped input must stay pending and unexecuted')

    def test_06_muse_turn_runs_beside_the_resident_serve(self):
        muse_fixture = self.co_dir / 'muse-fixture'
        muse_fixture.write_text('#!' + sys.executable + '\n' + MUSE_FIXTURE)
        muse_fixture.chmod(0o755)
        self.recruit('m1', 'muse')
        self.recruit('w5', 'codex')
        self.queue('w5', {'body': 'w5 held turn complete', 'hold_exit': True})
        self.dispatch('t5', 'w5', 'Task held while Muse runs.')
        self.assert_pending('t5')
        self.receiver('w5')
        serve = self.spawn('serve', 'matrix-owner-muse')
        held, _ = self.stream_for('w5')
        self.assertEqual(json.loads(held.readline()), {'terminal_written': True})
        task = self.co_dir / 'muse-task.txt'
        task.write_text('Muse runs beside the resident serve.')
        log = self.co_dir / 'muse-turn.jsonl'
        turned = time.monotonic()
        self.coord('turn', 'm1', 'muse-1', str(muse_fixture), 'requested-model', 'low',
                   str(self.directory), str(task), str(log), '', timeout=60)
        print(f'matrix muse turn seconds beside resident serve: {time.monotonic() - turned:.2f}')
        residents = [p for p in self.owned_processes() if ' serve ' in p['command']]
        self.assertEqual(len(residents), 1, 'the serve stays the single resident while Muse turns')
        reports = self.inbox('root')
        self.assertEqual([r['id'] for r in reports if r['sender'] == 'm1'], ['muse-1'])
        self.assertEqual(self.coord('player', 'm1')['native'], 'native-muse')
        self.release('w5')
        stdout, stderr = serve.communicate(timeout=90)
        self.assertEqual(serve.returncode, 0, stderr)
        self.assertIsNone(self.coord('owner-status'))

    def test_07_killed_client_leaves_atomic_commit_for_service(self):
        self.recruit('w6', 'codex')
        self.receiver('w6')
        bodies = {}
        for seq in range(3):
            ident = f'c{seq}'
            bodies[ident] = f'client-loss body {seq}'
            child = self.spawn('message', ident, 'root', 'w6', 'task', bodies[ident])
            time.sleep(.05)
            if child.poll() is None:
                child.kill()
        committed = []
        for ident, body in bodies.items():
            row = self.query(f"SELECT body, receipt FROM messages WHERE id='{ident}'")
            if row:
                self.assertEqual(row[0][0], body, f'{ident} committed partially')
                committed.append(ident)
        self.ack_inbox('root')
        serve = self.spawn('serve', 'matrix-owner-client-loss')
        stdout, stderr = serve.communicate(timeout=90)
        self.assertIn(serve.returncode, (0, 1),
                      f'unexpected serve exit: {stderr}')
        def serviced():
            return all(self.query(f"SELECT receipt FROM messages WHERE id='{ident}'") != [(None,)]
                       for ident in committed)
        self.eventually(serviced, 'committed input was never serviced', timeout=60)
        reported = self.query("SELECT COUNT(*) FROM messages WHERE sender='w6' AND kind='report'")
        self.assertGreaterEqual(reported[0][0], len(committed),
                                'committed input was lost without a report')
        adapter = subprocess.Popen(
            ['node', str(MCP), str(self.db), str(EXE), '--session', 'root'],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(adapter)
        adapter.stdin.write(json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
                                        'params': {'protocolVersion': '2024-11-05', 'capabilities': {},
                                                   'clientInfo': {'name': 'm', 'version': '0'}}}) + '\n')
        adapter.stdin.flush()
        time.sleep(.5)
        adapter.kill()
        self.assertIsNone(self.coord('owner-status'))
        self.assertEqual(self.query('SELECT COUNT(*) FROM instance_owner'), [(0,)])

    def arm(self, prefix, driver):
        names = [f'{prefix}1', f'{prefix}2']
        self.recruit(names[0], 'codex')
        self.recruit(names[1], 'omp')
        self.dispatch(f'{prefix}-t1', names[0], f'{prefix} first task.')
        self.dispatch(f'{prefix}-t2', names[1], f'{prefix} second task.')
        self.assert_pending(f'{prefix}-t1')
        self.assert_pending(f'{prefix}-t2')
        self.ack_inbox('root')
        self.receiver(names[0])
        self.receiver(names[1])
        self.start_sampler()
        started = time.monotonic()
        driver(names)
        wall = time.monotonic() - started
        peak_rss, peak_count = self.stop_sampler()
        print(f'matrix {prefix} wall {wall:.2f}s peak RSS KiB: {peak_rss} peak counts: {peak_count}')
        return wall, peak_count

    def test_08_one_serve_replaces_two_resident_receivers(self):
        def hold_both(names):
            for name in names:
                stream, _ = self.stream_for(name)
                self.assertEqual(json.loads(stream.readline()), {'terminal_written': True})
            time.sleep(1.5)
            for name in names:
                self.release(name)

        def direct(names):
            for name in names:
                self.queue(name, {'body': f'{name} direct turn complete', 'hold_exit': True})
            first = self.spawn('receive', names[0], str(self.fixture), '', '', '',
                               str(self.co_dir / (names[0] + '.jsonl')), '')
            second = self.spawn('receive', names[1], str(self.fixture), '', '', '',
                                str(self.co_dir / (names[1] + '.jsonl')), '')
            hold_both(names)
            for child in (first, second):
                stdout, stderr = child.communicate(timeout=60)
                self.assertEqual(child.returncode, 0, stderr)

        def served(names):
            for name in names:
                self.queue(name, {'body': f'{name} served turn complete', 'hold_exit': True})
            serve = self.spawn('serve', 'matrix-owner-before-after')
            hold_both(names)
            stdout, stderr = serve.communicate(timeout=90)
            self.assertEqual(serve.returncode, 0, stderr)

        direct_wall, direct_count = self.arm('direct', direct)
        served_wall, served_count = self.arm('served', served)
        self.assertEqual(served_count.get('serve', 0), 1)
        self.assertEqual(served_count.get('receive', 0), 0)
        self.assertEqual(direct_count.get('serve', 0), 0)
        self.assertEqual(direct_count.get('receive', 0), 2)
        print(f'matrix before/after walls direct={direct_wall:.2f}s served={served_wall:.2f}s')
        self.assertIsNone(self.coord('owner-status'))


if __name__ == '__main__':
    unittest.main()
