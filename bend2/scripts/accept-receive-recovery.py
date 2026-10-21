#!/usr/bin/env python3
"""Exercise receive observer loss with subscription Codex and an isolated clone.

The first native tool call contacts this driver's loopback checkpoint. The driver
kills the active Bend receive observer, queues a second task and verifies a normal
receive retry returns queued before allowing the tool call to return. Codex then
edits and commits a usage example. The queued follow-up edits it in the same native
conversation after the first native process exits. A local parent endpoint records
and acknowledges the complete reports. This command starts real model sessions.

All coordinator state, cloned source, process records and logs remain below
--output. --coordinator and --build-log identify an already built executable; this
driver records their hashes and the runtime source manifest, but cannot establish
that the supplied executable was built from that source. It never automatically
stops the native agents after a failed assertion. Retained failure evidence names
any processes that still belong to the run.
--resume continues an initial pending task before any native launch occurred.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import shlex
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time

SOURCE = Path(__file__).resolve().parents[2]
DOCUMENT = 'docs/bend2/receive-recovery-example.md'
INITIAL = 'recovery-initial'
FOLLOWUP = 'recovery-followup'


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(argv, **kwargs):
    result = subprocess.run(list(map(str, argv)), capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr}')
    return result.stdout.strip()


def process_rows():
    rows = []
    for line in command(['ps', '-axo', 'pid=,ppid=,stat=,command=']).splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) == 4:
            rows.append(dict(pid=int(fields[0]), ppid=int(fields[1]),
                             status=fields[2], command=fields[3]))
    return rows


def alive(pid, rows=None):
    return next((row for row in (process_rows() if rows is None else rows)
                 if row['pid'] == pid and not row['status'].startswith('Z')), None)


def snapshot(db):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        return {table: [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]
                for table in ['sessions', 'messages', 'turns', 'executions']}


def json_lines(path):
    if not path.exists():
        return []
    result = []
    for line in path.read_text().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            result.append(value)
    return result


def native_logs(db, base):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        if not connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name='log_generations'").fetchone():
            return []
        rows = connection.execute(
            'SELECT session, attempt, base, log FROM log_generations '
            'WHERE session=? AND base=? ORDER BY rowid', ('worker', str(base))).fetchall()
    return [{'session': session, 'attempt': attempt, 'base': original, 'path': path,
             'size_bytes': Path(path).stat().st_size if Path(path).exists() else 0,
             'sha256': digest(Path(path)) if Path(path).exists() else None}
            for session, attempt, original, path in rows]


def native_frames(logs):
    return [frame for log in logs for frame in json_lines(Path(log['path']))]


class ExitWatch:
    def __init__(self, pid):
        self.pid = pid
        self.handle = None
        self.backend = 'pidfd' if hasattr(os, 'pidfd_open') else 'kqueue'
        self.registered_unix = time.time()
        try:
            if self.backend == 'pidfd':
                self.handle = os.pidfd_open(pid)
            else:
                self.handle = select.kqueue()
                event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                      flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                      fflags=select.KQ_NOTE_EXIT)
                self.handle.control([event], 0, 0)
        except ProcessLookupError:
            self.close()
        except BaseException:
            self.close()
            raise

    def wait(self):
        if self.handle is not None:
            if self.backend == 'pidfd':
                select.select([self.handle], [], [])
            else:
                self.handle.control(None, 1, None)

    def close(self):
        if self.handle is not None:
            if self.backend == 'pidfd':
                os.close(self.handle)
            else:
                self.handle.close()
            self.handle = None


def wait_exit(pid):
    """Wait for an observed local process exit without stopping that process."""
    if not alive(pid):
        return
    watch = ExitWatch(pid)
    try:
        watch.wait()
    finally:
        watch.close()


HELPER = r'''import json,os,pathlib,socket,sqlite3,subprocess,sys,time
home=pathlib.Path(__file__).resolve().parent
config=json.loads((home/'control.json').read_text())
def append(name,value):
    descriptor=os.open(home/name,os.O_WRONLY|os.O_CREAT|os.O_APPEND,0o600)
    try: os.write(descriptor,(json.dumps(value)+'\n').encode())
    finally: os.close(descriptor)
def notify(value):
    try:
        with socket.create_connection(('127.0.0.1',config['port'])) as connection:
            connection.sendall((json.dumps(value)+'\n').encode())
            with connection.makefile('rb') as stream: stream.readline()
    except OSError:
        pass
kind=sys.argv[1]
if kind=='launch':
    args=sys.argv[2:]
    native_args=args[2:] if args[:2]==['-c','forced_login_method="chatgpt"'] else args
    row={'kind':'launch','pid':os.getpid(),'ppid':os.getppid(),'unix':time.time(),
         'argv':args,'resume':native_args[2] if native_args[:2]==['exec','resume'] else ''}
    append('launches.jsonl',row)
    notify(row)
    os.execv('/usr/bin/env',['env','-u','OPENAI_API_KEY','-u','CODEX_API_KEY',
             config['codex'],'-c','forced_login_method=chatgpt',*args])
elif kind=='checkpoint':
    row={'kind':'checkpoint','pid':os.getpid(),'ppid':os.getppid(),'unix':time.time()}
    append('tool-checkpoints.jsonl',row)
    notify(row)
    print('Observer-loss checkpoint completed. Continue the repository task.')
elif kind=='parent':
    ident=sys.argv[2]
    with sqlite3.connect('file:'+config['db']+'?mode=ro',uri=True) as connection:
        connection.row_factory=sqlite3.Row
        row=dict(connection.execute('SELECT * FROM messages WHERE id=?',(ident,)).fetchone())
    assert row['kind']=='report' and row['recipient']=='root',row
    receipt='parent received complete report '+ident
    subprocess.run([config['exe'],config['db'],'ack',ident,'root',receipt],
                   check=True,stdout=subprocess.DEVNULL)
    event={'kind':'parent-report','pid':os.getpid(),'unix':time.time(),
           'message':row,'receipt':receipt}
    append('parent-receipts.jsonl',event)
    notify(event)
    print(json.dumps({'received':ident}))
else:
    raise SystemExit('Unknown control operation')
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--coordinator', type=Path, required=True)
    parser.add_argument('--build-log', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--codex', default='codex')
    parser.add_argument('--model', required=True,
                        help='A model advertised by the local subscription Codex runtime')
    parser.add_argument('--effort', default='medium')
    parser.add_argument('--resume', action='store_true',
                        help='Continue the existing sole pending initial task without admitting it again')
    args = parser.parse_args()
    if not (hasattr(os, 'pidfd_open') or hasattr(select, 'kqueue')):
        parser.error('Process-exit observation requires Linux pidfds or macOS/BSD kqueue')
    source = args.source.resolve()
    codex = Path(shutil.which(args.codex) or args.codex).resolve()
    supplied = args.coordinator.resolve()
    build_log = args.build_log.resolve()
    if not all(path.is_file() for path in [codex, supplied, build_log]):
        parser.error('Codex, coordinator and build log must be existing files')
    base = command(['git', '-C', source, 'rev-parse', f'{args.revision}^{{commit}}'])
    command(['git', '-C', source, 'diff', '--exit-code', base, '--', 'bend2/src'])
    if command(['git', '-C', source, 'ls-files', '--others', '--exclude-standard', '--', 'bend2/src']):
        parser.error('Commit new runtime files before starting the live acceptance')
    login_argv = ['/usr/bin/env', '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY',
                  str(codex), '-c', 'forced_login_method=chatgpt', 'login', 'status']
    login = subprocess.run(login_argv, text=True, capture_output=True)
    login_text = (login.stdout + login.stderr).strip()
    if login.returncode or login_text != 'Logged in using ChatGPT':
        parser.error('Codex must report a ChatGPT subscription login; login output was not retained')
    out = args.output.resolve()
    resumed_label = f'resume-{time.time_ns()}' if args.resume else None
    original_pin = json.loads((out / 'run.json').read_text()) if args.resume else None
    if not args.resume:
        out.mkdir(parents=True, exist_ok=False)
    seed = out / 'seed'
    if not args.resume:
        command(['git', 'clone', '--shared', '--no-checkout', source, seed])
        command(['git', '-C', seed, 'checkout', '--detach', base])
    assert command(['git', '-C', seed, 'rev-parse', 'HEAD']) == base
    assert not command(['git', '-C', seed, 'branch', '--show-current'])
    helper_path = seed / 'bend2/scripts/accept-native-receive.py'
    spec = importlib.util.spec_from_file_location('recovery_native_acceptance', helper_path)
    native_acceptance = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(native_acceptance)
    if args.resume:
        binary = out / 'baton2'
        coordinator_provenance = original_pin['coordinator_provenance']
    else:
        binary, coordinator_provenance = native_acceptance.prepare_coordinator(source, seed, out, supplied)
        shutil.copy2(build_log, out / 'build.log')
    repo = out / 'repo'
    branch = 'accept-receive-recovery'
    manifest = {str(path.relative_to(source)): digest(path)
                for path in sorted((source / 'bend2/src').rglob('*')) if path.is_file()}
    if args.resume:
        assert json.loads((out / 'runtime-source-manifest.json').read_text()) == manifest
    else:
        save(out / 'runtime-source-manifest.json', manifest)
    db = out / 'state.db'
    native_log = out / 'native.jsonl'
    helper = out / 'control.py'
    wrapper = out / 'subscription-codex'
    wrapper_text = '#!/bin/sh\nexec ' + shlex.join([sys.executable, str(helper), 'launch']) + ' "$@"\n'
    if args.resume:
        assert helper.read_text() == HELPER and wrapper.read_text() == wrapper_text
    else:
        helper.write_text(HELPER)
        wrapper.write_text(wrapper_text)
        wrapper.chmod(0o700)
    pin = {
        'source': base, 'source_directory': str(source), 'started_unix': time.time(),
        'seed_repository': str(seed), 'seed_revision': base, 'seed_detached': True,
        'player_workspace': str(repo), 'player_branch': branch,
        'runtime_source_manifest_sha256': digest(out / 'runtime-source-manifest.json'),
        'runtime_source_files': manifest,
        'coordinator_sha256': digest(binary), 'coordinator_supplied': str(supplied),
        'coordinator_provenance': coordinator_provenance,
        'build_log_sha256': digest(out / 'build.log'), 'build_log_supplied': str(build_log),
        'source_linkage': 'Supplied binary; runtime manifest and build log retained for independent verification.',
        'driver_sha256': digest(Path(__file__)), 'codex_executable': str(codex),
        'codex_sha256': digest(codex), 'model': args.model, 'effort': args.effort,
        'subscription_wrapper_sha256': digest(wrapper), 'control_helper_sha256': digest(helper),
        'subscription_login': login_text, 'login_command': login_argv,
        'process_exit_observation': 'pidfd' if hasattr(os, 'pidfd_open') else 'kqueue',
    }
    if args.resume:
        for key in ['source', 'seed_revision', 'player_workspace', 'player_branch',
                    'runtime_source_manifest_sha256', 'runtime_source_files',
                    'coordinator_sha256', 'build_log_sha256', 'codex_executable',
                    'codex_sha256', 'model', 'effort', 'subscription_wrapper_sha256',
                    'control_helper_sha256']:
            assert original_pin[key] == pin[key], (key, original_pin[key], pin[key])
        assert digest(supplied) == original_pin['coordinator_sha256']
        assert digest(build_log) == original_pin['build_log_sha256']
        save(out / f'{resumed_label}.json', {
            'started_unix': time.time(), 'original_run': original_pin,
            'original_failure_sha256': digest(out / 'failure.json'),
            'original_control': json.loads((out / 'control.json').read_text()),
            'driver_sha256': pin['driver_sha256']})
        pin = original_pin
    else:
        save(out / 'run.json', pin)
    timeline = []
    receipts = []
    observer = None

    def record(kind, **data):
        row = {'kind': kind, 'unix': time.time(), **data}
        timeline.append(row)
        save(out / (f'{resumed_label}.timeline.json' if resumed_label else 'timeline.json'), timeline)
        print(kind, flush=True)
        return row

    def call(*argv, input=None):
        return command([binary, db, *argv], cwd=seed, input=input)

    def owned():
        rows = process_rows()
        by_pid = {row['pid']: row for row in rows}
        ancestors = {os.getpid()}
        parent_pid = os.getppid()
        while parent_pid in by_pid and parent_pid not in ancestors:
            ancestors.add(parent_pid)
            parent_pid = by_pid[parent_pid]['ppid']
        native_pids = {row['pid'] for row in json_lines(out / 'launches.jsonl')}
        return [row for row in rows if row['pid'] not in ancestors
                and (row['pid'] in native_pids or str(out) in row['command'])
                and not row['status'].startswith('Z')]

    shell = shlex.join([sys.executable, str(helper), 'checkpoint'])
    common = f'''Work only in this scratch clone: {repo}.
It is pinned to {base}; it is an acceptance run for native receive recovery.
Read AGENTS.md. Change only {DOCUMENT}. Do not alter runtime source, run the
full test suites, build, recruit agents, install tools, change authentication,
change global configuration, or push. Use the existing Git identity.
Do not send a report command: receive forwards your final assistant text.
Acknowledge only the task assigned in this turn, using the coordinator CLI
provided in the receive prompt: use the acknowledge action after handling its
complete text. End the turn after your task and report.
'''
    initial_task = common + f'''
Your first tool command must be exactly:
{shell}
This local tool completes the driver's observer-loss injection and returns.
After it returns, inspect bend2/src/coordinator/receive.bend and main.bend.
Create {DOCUMENT} as a short useful usage example covering a registered Codex
Player's receive command, pending inbox inspection and message acknowledgment.
Use shell placeholders for paths. Check every documented command against the
current parser. Commit this one document with a clear commit message, acknowledge
the assigned input, then return a final response beginning RECOVERY_INITIAL_DONE with the
commit hash, the commands checked, and any limitation. Leave any later incoming
message for the next native turn; this turn handles the initial assignment.
'''
    followup_task = common + f'''
Continue your existing conversation and inspect your previous committed example.
Extend {DOCUMENT} with a brief contributor note explaining what a busy receive
returns and how an observer recovery uses the retained attempt. Cite the relevant
source paths, and state the implemented recovery scope precisely. Verify the
claims against the runtime source, then commit the document update. Acknowledge
the assigned input, then return a final response beginning RECOVERY_FOLLOWUP_DONE with
both your previous commit hash and the new one. Do not repeat the checkpoint tool.
'''
    receive = ['receive', 'worker', str(wrapper), args.model, args.effort,
               str(repo), str(native_log)]
    first_pid = None
    first_native = None
    loss = None
    try:
        if args.resume:
            assert not json_lines(out / 'launches.jsonl')
            assert not json_lines(out / 'tool-checkpoints.jsonl')
            assert not json_lines(out / 'parent-receipts.jsonl')
            assert not any(log['size_bytes'] for log in native_logs(db, native_log))
            state = snapshot(db)
            assert not state['executions'] and not state['turns'], state
            assert len(state['messages']) == 1, state
            admitted = state['messages'][0]
            assert (admitted['id'], admitted['sender'], admitted['recipient'], admitted['kind'],
                    admitted['body'], admitted['receipt']) == (
                        INITIAL, 'root', 'worker', 'task', initial_task, None), admitted
            worker = next(row for row in state['sessions'] if row['id'] == 'worker')
            assert not worker['native'], worker
            assert command(['git', '-C', repo, 'rev-parse', 'HEAD']) == base
            assert command(['git', '-C', repo, 'branch', '--show-current']) == branch
            assert not command(['git', '-C', repo, 'status', '--porcelain'])
            assert not [row for row in owned() if '--instance-owner' not in row['command']], owned()
            record('initial-task-resumed', state=state, resumption=resumed_label)
        with socket.socket() as server:
            server.bind(('127.0.0.1', 0))
            server.listen()
            save(out / 'control.json', {'port': server.getsockname()[1], 'codex': str(codex),
                                       'exe': str(binary), 'db': str(db)})

            def notify(event):
                try:
                    with socket.create_connection(server.getsockname()) as connection:
                        connection.sendall((json.dumps(event) + '\n').encode())
                except OSError:
                    pass

            def checkpoint_command(label, *argv, input=None):
                child = subprocess.Popen([str(binary), str(db), *map(str, argv)], cwd=repo,
                                         stdin=subprocess.PIPE if input is not None else None,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

                def finished():
                    stdout, stderr = child.communicate(input=input)
                    notify({'kind': 'checkpoint-command-exit', 'label': label, 'pid': child.pid,
                            'code': child.returncode, 'stdout': stdout, 'stderr': stderr})

                threading.Thread(target=finished, daemon=True).start()
                while True:
                    pending, _ = server.accept()
                    with pending, pending.makefile('rb') as incoming:
                        event = json.loads(incoming.readline())
                        try:
                            if event['kind'] == 'observer-exit':
                                assert event['code'] == -signal.SIGKILL, event
                                continue
                            if event['kind'] != 'checkpoint-command-exit':
                                record('unexpected-event-during-checkpoint', event=event,
                                       processes=owned())
                                raise AssertionError('Native work started before checkpoint retry completed')
                            record(label, event=event)
                            assert event['label'] == label and event['code'] == 0, event
                            return event['stdout'].strip()
                        finally:
                            try:
                                pending.sendall(b'{"continue":true}\n')
                            except BrokenPipeError:
                                pass
            parent = [sys.executable, str(helper), 'parent']
            if args.resume:
                player = json.loads(call('session', 'worker'))
            else:
                call('attach', 'root', 'terminal', '', json.dumps(parent))
                call('role', 'root', 'principal-conductor')
                player = json.loads(call('recruit', 'worker', 'root', 'codex', args.model,
                                         args.effort, str(seed), branch, str(repo), base))
            for field, value in {'id': 'worker', 'parent': 'root', 'harness': 'codex',
                                 'model': args.model, 'effort': args.effort,
                                 'workspace': str(repo), 'branch': branch, 'base': base}.items():
                assert player[field] == value, player
            workspace = json.loads(call('worktree', 'worker'))
            assert workspace == {'id': 'worker', 'workspace': str(repo), 'branch': branch,
                                 'commit': base, 'dirty': False}, workspace
            if not args.resume:
                save(out / 'recruitment.json', {'seed': str(seed), 'session': player,
                                               'worktree': workspace})
                initial_admission = json.loads(call('message-batch-file', 'root', '-', input=json.dumps([
                    {'id': INITIAL, 'recipient': 'worker', 'kind': 'task', 'body': initial_task}],
                    ensure_ascii=False)))
                record('initial-task-admitted', result=initial_admission, state=snapshot(db))
                assert len(initial_admission) == 1, initial_admission
                assert initial_admission[0]['admission']['status'] == 'admitted', initial_admission
            admitted = next(row for row in snapshot(db)['messages'] if row['id'] == INITIAL)
            assert (admitted['sender'], admitted['recipient'], admitted['kind'], admitted['body'],
                    admitted['receipt']) == ('root', 'worker', 'task', initial_task, None), admitted
            assert not json.loads(call('session', 'worker'))['native']
            call('connect', 'worker', '', json.dumps([str(binary), str(db), *receive]))
            with (out / 'observer.log').open('w') as log:
                observer = subprocess.Popen([str(binary), str(db), *receive, INITIAL], cwd=repo,
                                             stdout=log, stderr=subprocess.STDOUT,
                                             start_new_session=True)
            record('observer-started', pid=observer.pid)

            def observe_exit():
                code = observer.wait()
                notify({'kind': 'observer-exit', 'code': code})

            threading.Thread(target=observe_exit, daemon=True).start()
            while len(receipts) < 2:
                connection, _ = server.accept()
                with connection, connection.makefile('rb') as stream:
                    event = json.loads(stream.readline())
                    try:
                        kind = event['kind']
                        if kind == 'observer-exit':
                            assert event['code'] == -signal.SIGKILL and loss is not None, event
                        elif kind == 'launch':
                            launches = json_lines(out / 'launches.jsonl')
                            assert len(launches) <= 2, launches
                            if len(launches) == 1:
                                first_pid = event['pid']
                                assert not event['resume'], event
                            else:
                                previous = alive(first_pid)
                                record('followup-launch', event=event, original_native=previous)
                                assert previous is None, previous
                                assert event['resume'] == first_native, event
                            record('native-launch', event=event, processes=owned())
                        elif kind == 'checkpoint':
                            assert loss is None and first_pid is not None
                            state = snapshot(db)
                            first_native = next(row['native'] for row in state['sessions']
                                                if row['id'] == 'worker')
                            assert first_native, state
                            original = alive(first_pid)
                            assert original and str(codex) in original['command'], original
                            original['started'] = command(['ps', '-p', str(first_pid), '-o', 'lstart='])
                            before_logs = native_logs(db, native_log)
                            before_frames = native_frames(before_logs)
                            assert not any(frame.get('type') in ['turn.completed', 'turn.failed']
                                           for frame in before_frames), before_frames
                            record('checkpoint-ready', event=event, native_id=first_native,
                                   original_native=original, processes=owned(), state=state)
                            os.kill(observer.pid, signal.SIGKILL)
                            code = observer.wait()
                            assert code == -signal.SIGKILL, code
                            followup = checkpoint_command('followup-message-queued', 'agent-native-input',
                                input=json.dumps(['message', FOLLOWUP, 'root', 'worker', 'task',
                                                  followup_task], ensure_ascii=False))
                            retry = json.loads(checkpoint_command('normal-receive-retry', *receive, INITIAL))
                            assert retry['receive'] == 'none' and retry['attempt'] == '', retry
                            assert len(json_lines(out / 'launches.jsonl')) == 1
                            assert alive(first_pid)
                            loss = record('observer-killed-retry-queued', observer_pid=observer.pid,
                                          observer_exit=code, original_native_pid=first_pid,
                                          native_id=first_native, retry=retry,
                                          followup_result=followup, processes=owned(),
                                          native_logs_before=before_logs,
                                          native_log_bytes_before=sum(log['size_bytes'] for log in before_logs))
                        elif kind == 'parent-report':
                            assert loss is not None, event
                            receipts.append(event)
                            record('parent-report', event=event)
                        else:
                            raise AssertionError(event)
                    finally:
                        try:
                            connection.sendall(b'{"continue":true}\n')
                        except BrokenPipeError:
                            pass
            # Both reports have reached their parent. Request the run's owner
            # to finish after ordinary attempt settlement, then observe all exits.
            owner_command = f'{binary.resolve()} --instance-owner {db.resolve()}'
            owners = [row for row in owned() if row['command'] == owner_command]
            assert len(owners) <= 1, owners
            watches = []
            owner_exits = []
            try:
                for owner in owners:
                    watch = ExitWatch(owner['pid'])
                    watches.append((owner, watch))
                    current = alive(owner['pid'])
                    assert current and current['command'] == owner_command and watch.handle is not None, current
                    owner['started'] = command(['ps', '-p', owner['pid'], '-o', 'lstart='])
                    owner['exit_watch'] = {'backend': watch.backend,
                                           'registered_unix': watch.registered_unix}
                shutdown_argv = [str(binary), '--instance-shutdown', str(db)]
                shutdown = {'argv': shutdown_argv, 'started_unix': time.time(), 'owners': owners}
                record('owner-shutdown-started', shutdown=shutdown, processes=owned())
                result = subprocess.run(shutdown_argv, capture_output=True, text=True, cwd=repo)
                shutdown.update(ended_unix=time.time(), exit=result.returncode,
                                stdout=result.stdout, stderr=result.stderr)
                record('owner-shutdown-result', shutdown=shutdown)
                if result.returncode:
                    raise RuntimeError(f'Owner shutdown failed: {shutdown}')
                for owner, watch in watches:
                    watch.wait()
                    owner_exits.append(record('owner-exit-observed', owner=owner,
                                              owner_after=alive(owner['pid'])))
            finally:
                for _, watch in watches:
                    watch.close()
            ended_processes = []
            while True:
                remaining = owned()
                if not remaining:
                    break
                for process in remaining:
                    wait_exit(process['pid'])
                    ended_processes.append(record('process-exit-observed', process=process,
                                                  process_after=alive(process['pid'])))
            final = snapshot(db)
            launches = json_lines(out / 'launches.jsonl')
            logs = native_logs(db, native_log)
            assert logs and all(log['sha256'] is not None for log in logs), logs
            events = native_frames(logs)
            reports = sorted((row for row in final['messages'] if row['kind'] == 'report'),
                             key=lambda row: row['seq'])
            terminal = [row for row in events if row.get('type') in ['turn.completed', 'turn.failed']]
            texts = []
            latest = None
            for event in events:
                if event.get('type') == 'item.completed' and event.get('item', {}).get('type') == 'agent_message':
                    latest = event['item']['text']
                if event.get('type') == 'turn.completed':
                    texts.append(latest)
                    latest = None
            native_ids = [event['thread_id'] for event in events if event.get('type') == 'thread.started']
            assert len(launches) == len(reports) == len(terminal) == len(texts) == 2
            assert all(frame['type'] == 'turn.completed' for frame in terminal), terminal
            assert native_ids and set(native_ids) == {first_native}, native_ids
            assert [row['body'] for row in reports] == texts
            assert all(row['receipt'] for row in final['messages']), final
            assert [row['body'].startswith(marker) for row, marker in zip(
                reports, ['RECOVERY_INITIAL_DONE', 'RECOVERY_FOLLOWUP_DONE'])] == [True, True]
            received = {event['message']['id']: event for event in receipts}
            assert set(received) == {row['id'] for row in reports}
            assert all(received[row['id']]['message']['body'] == row['body'] for row in reports)
            assert next(row['native'] for row in final['sessions'] if row['id'] == 'worker') == first_native
            assert not json.loads(call('inbox', 'worker')) and not json.loads(call('inbox', 'root'))
            assert not command(['git', '-C', repo, 'status', '--porcelain'])
            commits = command(['git', '-C', repo, 'rev-list', '--reverse', f'{base}..HEAD']).splitlines()
            assert len(commits) == 2, commits
            assert command(['git', '-C', repo, 'diff', '--name-only', base, 'HEAD']) == DOCUMENT
            for commit, report in zip(commits, reports):
                assert commit in report['body'] or commit[:7] in report['body'], (commit, report)
            assert sum(log['size_bytes'] for log in logs) > loss['native_log_bytes_before']
            save(out / 'evidence.json', {
                **pin, 'ended_unix': time.time(), 'elapsed_seconds': time.time() - pin['started_unix'],
                'observer_exit': observer.returncode, 'original_native_pid': first_pid,
                'native_session': first_native, 'launches': launches, 'native_thread_ids': native_ids,
                'native_terminal_frames': terminal, 'native_logs': logs,
                'state': final, 'parent_receipts': receipts, 'timeline': timeline,
                'repository_commits': commits, 'document_sha256': digest(repo / DOCUMENT),
                'owner_shutdown': shutdown, 'owner_exit_observations': owner_exits,
                'process_exit_observations': ended_processes,
                'remaining_processes': owned(),
                'resumption': resumed_label,
                'assertions': [
                    'The actual initial Bend receive observer exited from SIGKILL.',
                    'The original Codex process remained alive and normal retry returned queued.',
                    'Exactly two native launches occurred; follow-up began after original process exit.',
                    'The follow-up resumed the original native conversation.',
                    'Native output after observer loss produced complete matching parent reports.',
                    'Both task messages and both parent reports have receipts; both inboxes are empty.',
                    'Codex made two document commits in the isolated clone and all run processes exited.',
                ],
                'limitations': [
                    'One receive observer was killed while its keeper and native Codex process survived.',
                    'The parent endpoint records and acknowledges reports; it is a local deterministic process.',
                    'No keeper loss, host restart, direct-turn loss, landing or remote publication is exercised.',
                ],
            })
            print(f'Native receive recovery verified: {out / "evidence.json"}', flush=True)
    except BaseException as error:
        save(out / (f'{resumed_label}.failure.json' if resumed_label else 'failure.json'),
             {**pin, 'error': repr(error), 'timeline': timeline,
                                    'remaining_processes': owned(),
                                    'state': snapshot(db) if db.exists() else None})
        raise


if __name__ == '__main__':
    main()
