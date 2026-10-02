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
"""
import argparse
import hashlib
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
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr[-2000:]}')
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
                for table in ['sessions', 'messages', 'turns']}


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


def wait_exit(pid):
    """Wait for an observed local process exit without stopping that process."""
    if not alive(pid):
        return
    queue = select.kqueue()
    try:
        event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                              flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                              fflags=select.KQ_NOTE_EXIT)
        try:
            queue.control([event], 0, 0)
        except ProcessLookupError:
            return
        queue.control(None, 1, None)
    finally:
        queue.close()


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
    row={'kind':'launch','pid':os.getpid(),'ppid':os.getppid(),'unix':time.time(),
         'argv':args,'resume':args[2] if args[:2]==['exec','resume'] else ''}
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
    args = parser.parse_args()
    if not hasattr(select, 'kqueue'):
        parser.error('This process-exit measurement requires macOS/BSD kqueue')
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
    out.mkdir(parents=True, exist_ok=False)
    binary = out / 'baton2'
    shutil.copy2(supplied, binary)
    shutil.copy2(build_log, out / 'build.log')
    repo = out / 'repo'
    command(['git', 'clone', '--shared', '--no-checkout', source, repo])
    command(['git', '-C', repo, 'checkout', '-b', 'accept-receive-recovery', base])
    manifest = {str(path.relative_to(source)): digest(path)
                for path in sorted((source / 'bend2/src').rglob('*')) if path.is_file()}
    save(out / 'runtime-source-manifest.json', manifest)
    db = out / 'state.db'
    native_log = out / 'native.jsonl'
    helper = out / 'control.py'
    helper.write_text(HELPER)
    wrapper = out / 'subscription-codex'
    wrapper.write_text('#!/bin/sh\nexec ' + shlex.join([sys.executable, str(helper), 'launch']) + ' "$@"\n')
    wrapper.chmod(0o700)
    pin = {
        'source': base, 'source_directory': str(source), 'started_unix': time.time(),
        'runtime_source_manifest_sha256': digest(out / 'runtime-source-manifest.json'),
        'runtime_source_files': manifest,
        'coordinator_sha256': digest(binary), 'coordinator_supplied': str(supplied),
        'build_log_sha256': digest(out / 'build.log'), 'build_log_supplied': str(build_log),
        'source_linkage': 'Supplied binary; runtime manifest and build log retained for independent verification.',
        'driver_sha256': digest(Path(__file__)), 'codex_executable': str(codex),
        'codex_sha256': digest(codex), 'model': args.model, 'effort': args.effort,
        'subscription_wrapper_sha256': digest(wrapper), 'control_helper_sha256': digest(helper),
        'subscription_login': login_text, 'login_command': login_argv,
    }
    save(out / 'run.json', pin)
    timeline = []
    receipts = []
    observer = None

    def record(kind, **data):
        row = {'kind': kind, 'unix': time.time(), **data}
        timeline.append(row)
        save(out / 'timeline.json', timeline)
        print(kind, flush=True)
        return row

    def call(*argv):
        return command([binary, db, *argv], cwd=repo)

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
provided in the receive prompt. End the turn after your task and report.
'''
    initial_task = out / 'initial.md'
    initial_task.write_text(common + f'''
Your first tool command must be exactly:
{shell}
This local tool completes the driver's observer-loss injection and returns.
After it returns, inspect bend2/src/coordinator/receive.bend and main.bend.
Create {DOCUMENT} as a short useful usage example covering a registered Codex
worker's receive command, pending inbox inspection and message acknowledgment.
Use shell placeholders for paths. Check every documented command against the
current parser. Commit this one document with a clear commit message, acknowledge
{INITIAL}, then return a final response beginning RECOVERY_INITIAL_DONE with the
commit hash, the commands checked, and any limitation. Leave any later incoming
message for the next native turn; this turn handles only {INITIAL}.
''')
    followup_task = out / 'followup.md'
    followup_task.write_text(common + f'''
Continue your existing conversation and inspect your previous committed example.
Extend {DOCUMENT} with a brief contributor note explaining what a busy receive
returns and how an observer recovery uses the retained attempt. Cite the relevant
source paths, and state the implemented recovery scope precisely. Verify the
claims against the runtime source, then commit the document update. Acknowledge
{FOLLOWUP}, then return a final response beginning RECOVERY_FOLLOWUP_DONE with
both your previous commit hash and the new one. Do not repeat the checkpoint tool.
''')
    receive = ['receive', 'worker', str(wrapper), args.model, args.effort,
               str(repo), str(native_log)]
    first_pid = None
    first_native = None
    loss = None
    try:
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

            def checkpoint_command(label, *argv):
                child = subprocess.Popen([str(binary), str(db), *map(str, argv)], cwd=repo,
                                         stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

                def finished():
                    stdout, stderr = child.communicate()
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
            call('attach', 'root', 'terminal', '', json.dumps(parent))
            call('role', 'root', 'conductor')
            call('worker', 'worker', 'root', 'codex', args.model, args.effort,
                 str(repo), 'accept-receive-recovery', base)
            call('message-file', INITIAL, 'root', 'worker', 'task', str(initial_task))
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
                            before_frames = json_lines(native_log)
                            assert not any(frame.get('type') in ['turn.completed', 'turn.failed']
                                           for frame in before_frames), before_frames
                            record('checkpoint-ready', event=event, native_id=first_native,
                                   original_native=original, processes=owned(), state=state)
                            os.kill(observer.pid, signal.SIGKILL)
                            code = observer.wait()
                            assert code == -signal.SIGKILL, code
                            followup = checkpoint_command('followup-message-queued', 'message-file',
                                                          FOLLOWUP, 'root', 'worker', 'task',
                                                          str(followup_task))
                            retry = json.loads(checkpoint_command('normal-receive-retry', *receive, INITIAL))
                            assert retry == {'session': 'worker', 'status': 'queued'}, retry
                            assert len(json_lines(out / 'launches.jsonl')) == 1
                            assert alive(first_pid)
                            loss = record('observer-killed-retry-queued', observer_pid=observer.pid,
                                          observer_exit=code, original_native_pid=first_pid,
                                          native_id=first_native, retry=retry,
                                          followup_result=followup, processes=owned(),
                                          native_log_bytes_before=native_log.stat().st_size)
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
            # Both reports have reached their parent; observe final keeper and
            # recovery exits before taking the final database and process state.
            while True:
                remaining = owned()
                if not remaining:
                    break
                for process in remaining:
                    wait_exit(process['pid'])
            final = snapshot(db)
            launches = json_lines(out / 'launches.jsonl')
            events = json_lines(native_log)
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
            assert native_log.stat().st_size > loss['native_log_bytes_before']
            save(out / 'evidence.json', {
                **pin, 'ended_unix': time.time(), 'elapsed_seconds': time.time() - pin['started_unix'],
                'observer_exit': observer.returncode, 'original_native_pid': first_pid,
                'native_session': first_native, 'launches': launches, 'native_thread_ids': native_ids,
                'native_terminal_frames': terminal, 'native_log_sha256': digest(native_log),
                'state': final, 'parent_receipts': receipts, 'timeline': timeline,
                'repository_commits': commits, 'document_sha256': digest(repo / DOCUMENT),
                'remaining_processes': owned(),
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
        save(out / 'failure.json', {**pin, 'error': repr(error), 'timeline': timeline,
                                    'remaining_processes': owned(),
                                    'state': snapshot(db) if db.exists() else None})
        raise


if __name__ == '__main__':
    main()
