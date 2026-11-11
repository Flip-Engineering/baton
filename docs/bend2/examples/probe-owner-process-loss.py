"""Measure keeper or complete process loss with controlled Codex/OMP event fixtures.

Use an accepted coordinator binary and an unused output directory. The probe
creates its own repository, worktree and database. Before signalling it prints
the captured custody record's SHA-256 and waits for that exact hash on stdin.
Root reviews the actual PID/start/command/ancestry record before approving it.
The operating system and storage remain running. No model provider is invoked.
"""
import argparse
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import select
import signal
import socket
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[3]
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT))
receive = importlib.import_module('bend2.test.receive')


def pin(path):
    data = Path(path).read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}


def save(path, value):
    with Path(path).open('x') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def process_observation(pid):
    argv = ['/bin/ps', '-p', str(pid), '-o', 'pid=,ppid=,lstart=,stat=,command=']
    result = subprocess.run(argv, capture_output=True, text=True)
    observation = {'argv': argv, 'observed_unix': time.time(), 'exit_code': result.returncode,
                   'stdout': result.stdout, 'stderr': result.stderr, 'current': None}
    if not result.stdout.strip() and not result.stderr.strip() and result.returncode in (0, 1):
        return observation
    if result.returncode:
        raise RuntimeError('The selected ps observation failed: ' + json.dumps(observation))
    fields = result.stdout.strip().split(None, 8)
    if len(fields) not in (8, 9):
        raise RuntimeError('The selected process identity could not be parsed.')
    observation['current'] = {'pid': int(fields[0]), 'ppid': int(fields[1]),
                              'start': ' '.join(fields[2:7]), 'state': fields[7],
                              'command': fields[8] if len(fields) == 9 else ''}
    return observation


def process(pid):
    return process_observation(pid)['current']


def selected_birth(saved, observation):
    """Match the selected PID and start even when its command or state changes."""
    current = observation['current']
    return current if current and all(current[key] == saved[key] for key in ('pid', 'start')) else None


def signal_target(saved, observation):
    """Admit only the selected live birth with its approved command."""
    current = selected_birth(saved, observation)
    return current if (current and current['command'] == saved['command']
                       and not current['state'].startswith('Z')
                       and saved['pid'] > 1 and saved['pid'] != os.getpid()) else None


def running(saved):
    current = selected_birth(saved, process_observation(saved['pid']))
    return bool(current and not current['state'].startswith('Z'))


def lock_state(database, player):
    path = Path(str(database.resolve()) + '.lock-' + player.encode().hex())
    with path.open('r+b') as stream:
        info = os.fstat(stream.fileno())
        try:
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            available = True
        except BlockingIOError:
            available = False
    return {'path': str(path), 'device': info.st_dev, 'inode': info.st_ino,
            'exclusive_lock_available': available, 'probe_descriptor_closed': True}


class Probe(receive.Receive):
    """Reuse the existing receive fixture protocol and coordinator command helpers."""

    def __init__(self, binary, directory):
        super().__init__()
        self.binary, self.directory = binary, directory
        self.commands, self.signals, self.children, self.controls = [], [], [], []
        self.selected = []
        self.server = None

    def start(self, argv):
        label = 'command-' + str(len(self.commands))
        stdout, stderr = self.directory / (label + '.stdout'), self.directory / (label + '.stderr')
        started = time.time()
        with stdout.open('xb') as out, stderr.open('xb') as err:
            child = subprocess.Popen(list(map(str, argv)), cwd=self.directory,
                                     stdin=subprocess.DEVNULL, stdout=out, stderr=err)
        receipt = {'argv': list(map(str, argv)), 'cwd': str(self.directory), 'pid': child.pid,
                   'started_unix': started, 'stdout_path': str(stdout), 'stderr_path': str(stderr),
                   'exit_code': None, 'direct_wait_completed': False}
        self.commands.append(receipt)
        self.children.append((child, receipt))
        return child

    def finish(self, child, ok=None):
        receipt = next(row for candidate, row in self.children if candidate is child)
        if not receipt['direct_wait_completed']:
            receipt.update(exit_code=child.wait(), direct_wait_completed=True, ended_unix=time.time())
            receipt['stdout'] = pin(receipt['stdout_path'])
            receipt['stderr'] = pin(receipt['stderr_path'])
        stdout = Path(receipt['stdout_path']).read_text()
        stderr = Path(receipt['stderr_path']).read_text()
        if ok is True and child.returncode:
            raise RuntimeError('Coordinator failed; inspect ' + receipt['stderr_path'])
        return stdout, stderr

    def coord(self, *args, ok=True):
        child = self.start([self.binary, self.db, *args])
        stdout, stderr = self.finish(child, ok=ok)
        if not ok:
            return {'exit_code': child.returncode, 'stdout': stdout, 'stderr': stderr}
        return json.loads(stdout)

    def spawn(self, *args):
        return self.start([self.binary, self.db, *args])

    def setup(self):
        self.repo, self.checkouts = self.directory / 'repository', self.directory / 'checkouts'
        self.repo.mkdir()
        self.checkouts.mkdir()
        for args in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'probe@example.invalid'],
                     ['config', 'user.name', 'Controlled recovery probe']):
            self.finish(self.start(['git', '-C', self.repo, *args]), ok=True)
        (self.repo / 'seed.txt').write_text('controlled recovery probe\n')
        self.finish(self.start(['git', '-C', self.repo, 'add', 'seed.txt']), ok=True)
        self.finish(self.start(['git', '-C', self.repo, 'commit', '-q', '-m', 'Create probe base']), ok=True)
        self.base = self.finish(self.start(['git', '-C', self.repo, 'rev-parse', 'HEAD']), ok=True)[0].strip()
        self.db = self.directory / 'state.db'
        self.fixture = self.directory / 'controlled-native'
        self.fixture.write_text('#!' + sys.executable + '\n' + receive.FIXTURE)
        self.fixture.chmod(0o700)
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        (self.directory / 'fixture.json').write_text(json.dumps({
            'port': self.server.getsockname()[1], 'exe': str(self.binary),
            'db': str(self.db), 'record_launches': True}))
        self.coord('attach', 'root', 'codex', 'native-root', '')
        self.coord('role', 'root', 'principal-conductor')
        self.coord('connect', 'root', 'native-root',
                   json.dumps([str(self.fixture), 'parent_endpoint']))

    def receive_args(self, session, executable=None):
        return ['receive', session, str(executable or self.fixture), session, 'low',
                str(self.checkouts / session), str(self.directory / (session + '.jsonl')), '']

    def next_start(self, producer):
        while True:
            if select.select([self.server], [], [], .01)[0]:
                return self.accept_any()
            if producer.poll() is not None:
                self.finish(producer)
                return None

    def exchange(self, stream, **action):
        self.action(stream, **action)
        line = stream.readline()
        return json.loads(line) if line else None

    def launches(self):
        path = self.directory / 'native-launches.jsonl'
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def observe_start(self, producer, frame, label):
        rows = {'observer': process(producer.pid), 'keeper': process(frame['ppid']),
                'native': process(frame['pid'])}
        if any(row is None for row in rows.values()):
            raise RuntimeError('A started process ended before its identity was captured.')
        for role, row in rows.items():
            self.selected.append({'role': label + ':' + role, **row})
        return rows

    def remaining_owned(self):
        listing = subprocess.run(['/bin/ps', '-axo', 'pid=,ppid=,lstart=,stat=,command='],
                                 capture_output=True, text=True, check=True).stdout
        found = []
        for line in listing.splitlines():
            fields = line.strip().split(None, 8)
            if len(fields) == 9 and int(fields[0]) != os.getpid() and (
                    str(self.db) in fields[8] or str(self.fixture) in fields[8]):
                found.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                              'start': ' '.join(fields[2:7]), 'state': fields[7], 'command': fields[8]})
        return found

    def snapshot(self, phase, player):
        views = {name: self.coord(name, player) for name in ('session', 'worktree', 'turns', 'inbox')}
        with sqlite3.connect(self.db.as_uri() + '?mode=ro', uri=True) as database:
            database.row_factory = sqlite3.Row
            views['executions'] = [dict(row) for row in database.execute(
                'SELECT * FROM executions WHERE session=?', (player,))]
            views['messages'] = [dict(row) for row in database.execute('SELECT * FROM messages ORDER BY seq')]
            with sqlite3.connect(self.directory / (phase + '.db')) as backup:
                database.backup(backup)
        views['launches'] = self.launches()
        save(self.directory / (phase + '.json'), views)
        return views

    def guarded_signal(self, saved, value):
        observation = process_observation(saved['pid'])
        current = selected_birth(saved, observation)
        admitted = signal_target(saved, observation) is not None
        record = {'selected': saved, 'ps': observation, 'target': current,
                  'signal': value.name, 'started_unix': time.time(),
                  'signal_admitted': admitted, 'syscall_attempted': False}
        self.signals.append(record)
        if not admitted:
            record['refusal'] = ('selected-birth-absent' if current is None else
                                 'selected-birth-not-an-admitted-live-command')
            return False
        record['syscall_attempted'] = True
        try:
            os.kill(saved['pid'], value)
            record['syscall_succeeded'] = True
        except ProcessLookupError:
            record['syscall_succeeded'] = False
            record['target_disappeared'] = True
        return record['syscall_succeeded']

    def observe_selected(self, selected, phase):
        rows = []
        for saved in selected:
            observation = process_observation(saved['pid'])
            rows.append({'selected': saved, 'current': selected_birth(saved, observation),
                         'ps': observation})
        with (self.directory / 'selected-process-observations.jsonl').open('a') as stream:
            stream.write(json.dumps({'phase': phase, 'observations': rows}) + '\n')
        return rows

    def close(self):
        # Controlled fixture commands allow natural exit; cleanup sends no signals.
        for stream, connection in self.controls:
            try:
                self.action(stream, exit_fixture=True)
            except (OSError, ValueError):
                pass
            stream.close()
            connection.close()
        # A failed turn can have started its pending successor before it exits.
        while any(child.poll() is None for child, _ in self.children):
            if self.server and select.select([self.server], [], [], .01)[0]:
                stream, frame = self.accept_any()
                native, keeper = process(frame['pid']), process(frame['ppid'])
                for role, row in [('cleanup:native', native), ('cleanup:keeper', keeper)]:
                    if row:
                        self.selected.append({'role': role, **row})
                self.action(stream, exit_fixture=True)
                stream.close()
                self.controls[-1][1].close()
        for child, _ in self.children:
            self.finish(child)
        if self.server:
            self.server.close()


def custody(fixture, observer, frame, attempt, loss):
    native, keeper, owner = process(frame['pid']), process(frame['ppid']), process(observer.pid)
    if not native or not keeper or not owner:
        raise RuntimeError('An initial process ended before custody was captured.')
    if not (native['ppid'] == keeper['pid'] and keeper['ppid'] == owner['pid']
            and owner['ppid'] == os.getpid()
            and '--host-process-keeper' in keeper['command'] and str(attempt) in keeper['command']
            and str(fixture.fixture) in native['command']
            and str(fixture.db) in owner['command']
            and int((attempt / 'native.pid').read_text()) == native['pid']):
        raise RuntimeError('Captured process custody does not match this isolated launch.')
    rows = {'observer': owner, 'keeper': keeper, 'native': native}
    fixture.selected.extend({'role': 'original:' + role, **row} for role, row in rows.items())
    value = {'loss': loss, 'directory': str(fixture.directory), 'attempt': str(attempt),
             'controller_pid': os.getpid(), 'processes': rows,
             'signal_scope': ['keeper'] if loss == 'keeper' else ['observer', 'keeper', 'native']}
    path = fixture.directory / 'custody.json'
    save(path, value)
    approved_hash = pin(path)['sha256']
    print(json.dumps({'event': 'custody-ready', 'custody_sha256': approved_hash, 'custody': value}), flush=True)
    if sys.stdin.readline().strip() != approved_hash:
        raise RuntimeError('Root custody approval was absent or did not match; no loss signal was sent.')
    save(fixture.directory / 'custody-approval.json', {'approved_custody_sha256': approved_hash})
    return rows


def retry_while_original_lives(fixture, player, original, evidence):
    if original is None or not running(original):
        raise RuntimeError('The live retry boundary has no surviving original native process.')
    evidence['launches_before'] = fixture.launches()
    retry = fixture.spawn(*fixture.receive_args(player))
    arrival = fixture.next_start(retry)
    evidence['retry_started_native'] = arrival[1] if arrival else None
    evidence['duplicate_native_while_original_alive'] = bool(arrival and running(original))
    if arrival:
        evidence['retry_custody'] = fixture.observe_start(retry, arrival[1], 'retry')
        fixture.action(arrival[0], exit_fixture=True)
        arrival[0].readline()
    stdout, stderr = fixture.finish(retry)
    evidence['retry_result'] = {'exit_code': retry.returncode, 'stdout': stdout, 'stderr': stderr}
    evidence['launches_after'] = fixture.launches()
    try:
        answer = json.loads(stdout)
    except ValueError:
        answer = None
    evidence['queued_without_new_launch'] = (arrival is None and retry.returncode == 0
        and isinstance(answer, dict) and answer.get('status') == 'queued'
        and evidence['launches_after'] == evidence['launches_before'])
    evidence['retry_classification'] = ('started-native' if arrival else
        'queued' if evidence['queued_without_new_launch'] else 'refused-or-failed')


def resumed_identity(frame, stored, directory):
    value = frame['resume']
    if not value:
        return False
    if '/' not in value:
        return value == stored
    path = Path(value).resolve(strict=True)
    if not path.is_relative_to(directory):
        raise RuntimeError('Fixture resume path escaped the owned directory.')
    return json.loads(path.read_text().splitlines()[0])['id'] == stored


def exercise(fixture, loss, harness, evidence):
    fixture.setup()
    player = 'probe-player'
    fixture.player(player, harness)
    fixture.message('first', player, 'Complete the original controlled turn.')
    fixture.connect(player)
    observer = fixture.spawn(*fixture.receive_args(player))
    original = fixture.next_start(observer)
    if original is None:
        raise RuntimeError('Initial native startup was not observed.')
    stream, frame = original
    evidence['original_start'] = frame
    while fixture.coord('session', player)['native'] != frame['native']:
        if observer.poll() is not None:
            raise RuntimeError('Initial native identity was not recorded before observer exit.')
    marker = 'output written before ' + loss + ' loss'
    evidence['preloss_progress'] = fixture.exchange(stream, progress=marker)
    fixture.message('second', player, 'Complete the input pending at process loss.')
    before = fixture.snapshot('before-loss', player)
    second = next(row for row in before['messages'] if row['id'] == 'second')
    evidence['pending_input_before_loss'] = second
    evidence['stored_native_before_loss'] = before['session']['native']
    evidence['lock_before_loss'] = lock_state(fixture.db, player)
    attempt = Path(before['executions'][0]['directory'])
    rows = custody(fixture, observer, frame, attempt, loss)
    evidence['custody'] = rows
    if loss == 'keeper':
        if not fixture.guarded_signal(rows['keeper'], signal.SIGKILL):
            raise RuntimeError('The selected live keeper was not killed; inspect retained signal evidence.')
        after_marker = 'output written after keeper loss'
        evidence['postloss_progress'] = fixture.exchange(stream, progress=after_marker)
        evidence['original_child_survived_keeper_loss'] = running(rows['native'])
        evidence['observer_result'] = fixture.finish(observer)[0]
        evidence['lock_after_keeper_and_observer_loss'] = lock_state(fixture.db, player)
        retry_while_original_lives(fixture, player, rows['native'], evidence)
        body = 'Original completion after keeper loss'
        fixture.action(stream, body=body)
        stream.readline()
        while running(rows['native']):
            time.sleep(.01)
        evidence['original_completion_wait_status'] = None
        evidence['original_wait_unknown_reason'] = 'Keeper died before its native wait/status receipt.'
        evidence['original_raw_output'] = pin(attempt / 'stdout')
        raw = (attempt / 'stdout').read_text()
        evidence['postloss_output_retained'] = after_marker in raw
        evidence['original_terminal_output_retained'] = body in raw
        after_original = fixture.snapshot('after-original-exit', player)
        evidence['original_completion_recorded'] = any(body in row['body'] for row in after_original['messages'])
    else:
        signal_results = []
        try:
            for name in ('observer', 'keeper', 'native'):
                signal_results.append(fixture.guarded_signal(rows[name], signal.SIGSTOP))
        finally:
            for name in ('native', 'keeper', 'observer'):
                signal_results.append(fixture.guarded_signal(rows[name], signal.SIGKILL))
        evidence['full_loss_signals_completed'] = all(signal_results)
        if not evidence['full_loss_signals_completed']:
            originals = [{'role': 'original:' + name, **row} for name, row in rows.items()]
            observations = fixture.observe_selected(originals, 'failed-injection')
            save(fixture.directory / 'failed-injection.json', {
                'signals': fixture.signals, 'process_observations': observations,
                'restart_attempted': False, 'nondirect_native_exit_code': None,
                'boundary': 'Loss injection was incomplete. Natural fixture cleanup follows; Root may inspect the retained birth observations before closing approved survivors.'})
            raise RuntimeError('Full-loss signal injection was incomplete; restart was not attempted.')
        evidence['observer_result'] = fixture.finish(observer)[0]
        evidence['original_completion_wait_status'] = None
        evidence['original_wait_unknown_reason'] = 'Native was not a direct child; numeric exit status is unavailable.'
        evidence['original_completion_expected'] = False
        evidence['preloss_output_retained'] = marker in (attempt / 'stdout').read_text()
        evidence['originals_running_after_loss'] = {name: running(row) for name, row in rows.items()}
        originals = [{'role': 'original:' + name, **row} for name, row in rows.items()]
        observations = fixture.observe_selected(originals, 'before-restart')
        while any(row['current'] is not None for row in observations):
            time.sleep(.01)
            observations = fixture.observe_selected(originals, 'before-restart')
        evidence['pre_restart_process_observations'] = observations
        evidence['original_processes_absent_before_restart'] = True
    after_loss = fixture.snapshot('after-loss', player)
    evidence['identity_after_loss'] = after_loss['session']['native']
    continuation = fixture.spawn(*fixture.receive_args(player))
    resumed = fixture.next_start(continuation)
    if resumed is None:
        raise RuntimeError('Fresh receive ended without a continuation startup; inspect retained command output.')
    resumed_stream, resumed_frame = resumed
    evidence['continuation_start'] = resumed_frame
    evidence['continuation_custody'] = fixture.observe_start(continuation, resumed_frame, 'continuation')
    evidence['native_identity_preserved'] = (after_loss['session']['native'] == before['session']['native']
        and resumed_frame['native'] == before['session']['native']
        and resumed_identity(resumed_frame, before['session']['native'], fixture.directory))
    evidence['continuation_has_pending_input'] = ('[id: second]' in resumed_frame['prompt']
                                                 and second['body'] in resumed_frame['prompt'])
    retry_while_original_lives(fixture, player, process(resumed_frame['pid']), evidence.setdefault('live_continuation_retry', {}))
    final_body = 'Pending input completed after ' + loss + ' loss'
    fixture.action(resumed_stream, body=final_body)
    resumed_stream.readline()
    evidence['continuation_result'] = fixture.finish(continuation)[0]
    evidence['continuation_exit_code'] = continuation.returncode
    after = fixture.snapshot('after-completion', player)
    evidence['pending_input_drained'] = not after['inbox']
    evidence['pending_input_after_completion'] = next(row for row in after['messages'] if row['id'] == 'second')
    evidence['pending_input_accepted'] = (evidence['pending_input_after_completion']['body'] == second['body']
        and evidence['pending_input_after_completion']['receipt'] == 'native-reviewed')
    evidence['continuation_completion_recorded'] = any(final_body in row['body'] for row in after['messages'])
    parent_path = fixture.directory / 'parent-deliveries.jsonl'
    delivered = [json.loads(line) for line in parent_path.read_text().splitlines()] if parent_path.exists() else []
    evidence['parent_notified'] = any(row['sender'] == player and row['recipient'] == 'root'
                                     and final_body in row['body'] for row in delivered)
    evidence['preserved_branch_and_workspace'] = all(after['worktree'][key] == before['worktree'][key]
                                                    for key in ('workspace', 'branch', 'commit'))
    checks = [evidence['native_identity_preserved'], evidence['continuation_has_pending_input'],
              evidence['pending_input_drained'], evidence['continuation_completion_recorded'],
              evidence['parent_notified'], evidence['preserved_branch_and_workspace'],
              evidence['pending_input_accepted'], evidence['continuation_exit_code'] == 0,
              evidence['live_continuation_retry']['queued_without_new_launch']]
    if loss == 'keeper':
        checks.extend([not evidence['duplicate_native_while_original_alive'],
                       evidence['queued_without_new_launch'], evidence['original_child_survived_keeper_loss'],
                       evidence['postloss_output_retained'], evidence['original_completion_recorded']])
    else:
        checks.extend([evidence['preloss_output_retained'], evidence['full_loss_signals_completed'],
                       evidence['original_processes_absent_before_restart'],
                       not any(evidence['originals_running_after_loss'].values())])
    evidence['status'] = 'passed' if all(checks) else 'failed'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--loss', choices=('keeper', 'all'), required=True)
    parser.add_argument('--harness', choices=('codex', 'omp'), required=True)
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    binary = args.binary.resolve(strict=True)
    args.output.mkdir(parents=True, exist_ok=False)
    directory = args.output.resolve()
    receive.EXE = binary
    fixture = Probe(binary, directory)
    evidence = {'status': 'incomplete', 'loss': args.loss, 'harness': args.harness,
                'binary': pin(binary), 'probe': pin(Path(__file__)),
                'fixture_source': pin(ROOT / 'bend2/test/receive.py'), 'native_provider_used': False,
                'operating_system_restarted': False, 'power_loss_simulated': False,
                'duplicate_native_while_original_alive': None, 'pending_input_drained': None,
                'parent_notified': None}
    try:
        exercise(fixture, args.loss, args.harness, evidence)
    except Exception as error:
        evidence.update(status='failed', error=type(error).__name__ + ': ' + str(error))
    finally:
        try:
            fixture.close()
        except Exception as error:
            evidence.update(status='failed', cleanup_error=type(error).__name__ + ': ' + str(error))
        evidence['commands'], evidence['signals'] = fixture.commands, fixture.signals
        if 'custody' in evidence:
            original_states = fixture.observe_selected(
                [{'role': 'original:' + name, **row} for name, row in evidence['custody'].items()],
                'final-original-closure')
            evidence['final_original_process_observations'] = original_states
            evidence['final_original_process_states'] = {
                row['selected']['role'].split(':', 1)[1]: row['current'] for row in original_states}
        evidence['selected_process_states'] = fixture.observe_selected(fixture.selected, 'final-closure')
        evidence['selected_process_observations'] = pin(directory / 'selected-process-observations.jsonl')
        evidence['remaining_owned_processes'] = fixture.remaining_owned() if hasattr(fixture, 'db') else []
        evidence['closure_observed'] = (not evidence['remaining_owned_processes']
            and all(row['current'] is None for row in evidence['selected_process_states'])
            and all(row['direct_wait_completed'] for row in fixture.commands))
        if evidence['status'] == 'passed' and not evidence['closure_observed']:
            evidence['status'] = 'pending-external-closure'
        save(directory / 'evidence.json', evidence)
    print(json.dumps({'event': 'probe-complete', 'evidence': str(directory / 'evidence.json'),
                      'status': evidence['status']}), flush=True)
    return 0 if evidence['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
