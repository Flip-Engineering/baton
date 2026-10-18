#!/usr/bin/env python3
"""Review a source revision with two OMP Players and a native Codex Principal Conductor.

The route JSON uses codex and omp objects with executable, model and effort
fields, as accept-hierarchy.py does. This command starts real native sessions.
All coordinator state, cloned source and native logs remain below --output.
By default the coordinator builds from that clone; BEND selects an installed
compiler. --coordinator uses a supplied executable with unverified source linkage.
--tasks accepts review-native and review-validation objects with initial text and
optional followup text for both Players. Follow-ups verify Player session reuse.
--resume continues a retained bootstrap-only run after its original admission.
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
import sqlite3
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def command(argv, **kwargs):
    command_argv = list(map(str, argv))
    result = subprocess.run(command_argv, capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{command_argv!r} exited {result.returncode}\n'
                           f'stdout:\n{result.stdout}\nstderr:\n{result.stderr}')
    return result.stdout.strip()


def snapshot(db):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        return {table: [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]
                for table in ['sessions', 'messages', 'turns', 'executions']}

def read_rows(db, sql, parameters=()):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        return [dict(row) for row in connection.execute(sql, parameters)]


def process_row(pid):
    result = subprocess.run(['ps', '-p', str(pid), '-o', 'pid=,lstart=,stat=,command='],
                            capture_output=True, text=True)
    line = result.stdout.strip()
    if result.returncode or not line:
        return None
    fields = line.split(None, 7)
    if len(fields) != 8:
        return None
    return {'pid': int(fields[0]), 'started': ' '.join(fields[1:6]),
            'status': fields[6], 'command': fields[7]}


class ExitWatch:
    """Wait for one exact process identity to exit. A pidfd pins the process;
    the recorded start time refuses a reused pid before registration."""
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


def native_birth(directory):
    birth = Path(directory) / 'native.birth'
    if not birth.is_file():
        return None
    data = birth.read_bytes()
    # struct BrBirth { int32_t pid; uint64_t first, second } with its aligned
    # 8-byte fields. The first is the process start time; the second is btime.
    if len(data) < 24:
        return None
    pid = int.from_bytes(data[0:4], 'little', signed=True)
    first = int.from_bytes(data[8:16], 'little')
    second = int.from_bytes(data[16:24], 'little')
    return {'pid': pid, 'first': first, 'second': second} if pid > 0 else None


def linux_start_time(pid):
    try:
        stat = Path(f'/proc/{pid}/stat').read_text()
    except OSError:
        return None
    fields = stat[stat.rfind(')') + 2:].split()
    try:
        return int(fields[19])
    except (IndexError, ValueError):
        return None


def birth_matches(birth, row):
    """The recorded birth must name this live process, not a reused pid."""
    if birth is None or row is None:
        return False
    if hasattr(os, 'pidfd_open'):
        return linux_start_time(birth['pid']) == birth['first']
    try:
        started = time.mktime(time.strptime(' '.join(row['started'].split()),
                                            '%a %b %d %H:%M:%S %Y'))
    except ValueError:
        return False
    return int(started) == birth['first']


def wait_native_exit(directory, observations, label):
    """Observe the exact admitted native process until it exits."""
    birth = native_birth(directory)
    observation = {'observation': label, 'native_birth': birth}
    observations.append(observation)
    if birth is None:
        return
    before = process_row(birth['pid'])
    observation['before_registration'] = before
    if before is None:
        return
    observation['identity_matches'] = birth_matches(birth, before)
    if not observation['identity_matches']:
        observation['identity_changed'] = before
        return
    watch = ExitWatch(birth['pid'])
    try:
        current = process_row(birth['pid'])
        observation.update(backend=watch.backend, registered_unix=watch.registered_unix,
                           after_registration=current)
        if current is not None and birth_matches(birth, current):
            watch.wait()
            observation['exit_observed_unix'] = time.time()
            observation['after_exit'] = process_row(birth['pid'])
        else:
            observation['identity_changed'] = current
    finally:
        watch.close()


def wait_settlement(db, session, message, label, out=None, previous_execution=None):
    """Wait for the recipient's recorded execution and handling settlement.

    A successful native turn records a recipient-owned receipt whose
    `native-turn:` suffix names the exact admitted attempt. The predicate is
    durable coordinator state: that attempt reached `exited` with `exit 0`, its
    recorded native birth exited, the released and acknowledged custody markers
    exist, and the task message carries the receipt. A new execution that
    settled non-zero before writing a receipt is reported, never waited through.
    There is no elapsed limit.
    """
    observations = []
    while True:
        messages = read_rows(db, 'SELECT id,recipient,receipt FROM messages WHERE id=?', (message,))
        execution_rows = read_rows(db, 'SELECT * FROM executions WHERE session=?', (session,))
        execution = execution_rows[0] if execution_rows else None
        session_rows = read_rows(db, 'SELECT native FROM sessions WHERE id=?', (session,))
        receipt = messages[0]['receipt'] if messages else None
        attempt = (receipt[len('native-turn:'):]
                   if receipt and receipt.startswith('native-turn:') else None)
        new_execution = execution is not None and execution['id'] != previous_execution
        if new_execution and execution['directory']:
            start_error = Path(execution['directory']) / 'native-start-error'
            if start_error.exists():
                raise RuntimeError(f'{label}: native start failed: ' + start_error.read_text())
        if attempt and execution and execution['id'] == attempt:
            directory = Path(execution['directory']) if execution['directory'] else None
            if execution['phase'] == 'exited':
                if execution['status'] != 'exit 0':
                    raise RuntimeError(f'{label}: recorded execution settled as '
                                       f'{execution["status"]}: {execution}')
                if directory is not None and directory.exists():
                    wait_native_exit(directory, observations, label)
                    while not ((directory / 'acknowledged').exists()
                               and (directory / 'released').exists()):
                        time.sleep(0.05)
                else:
                    observations.append({'observation': label, 'directory': str(directory),
                                         'absent': True})
                native = session_rows[0]['native'] if session_rows else ''
                if native:
                    state = snapshot(db)
                    if out is not None:
                        save(out / f'{label}.settlement.json', {
                            'message': message, 'receipt': receipt, 'execution': execution,
                            'native': native, 'observations': observations})
                    return {'execution': execution, 'state': state, 'receipt': receipt,
                            'native': native, 'observations': observations}
        elif (not receipt and new_execution and execution['phase'] == 'exited'
              and execution['status'] != 'exit 0'):
            raise RuntimeError(f'{label}: the new execution settled as '
                               f'{execution["status"]} without a handling receipt: {execution}')
        time.sleep(0.05)


def dispatch_task(binary, db, repo, recipient, text, log_path, sender=None):
    """Admit complete task input through the database dispatch operation.

    Baton generates the message, request and session identities. The operation's
    complete JSON result, argv, exit status and captured streams are retained.
    """
    argv = [str(binary), str(db), 'dispatch', '--project', str(repo),
            '--to', recipient, '--stdin']
    env = dict(os.environ)
    env.pop('CODEX_THREAD_ID', None)
    if sender:
        env['BATON_SESSION'] = sender
    else:
        env.pop('BATON_SESSION', None)
    started = time.time()
    result = subprocess.run(argv, input=text, capture_output=True, text=True,
                            cwd=repo, env=env)
    ended = time.time()
    with Path(log_path).open('w') as log:
        log.write(json.dumps({'argv': argv, 'recipient': recipient, 'started_unix': started,
                              'ended_unix': ended, 'exit': result.returncode,
                              'input_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
                              'stdout': result.stdout, 'stderr': result.stderr}, indent=2) + '\n')
    try:
        answer = json.loads(result.stdout)
    except ValueError:
        raise RuntimeError(f'dispatch to {recipient} did not return JSON: '
                           f'{result.stdout}{result.stderr}')
    record = {'label': Path(log_path).stem, 'recipient': recipient, 'argv': argv,
              'started_unix': started, 'ended_unix': ended, 'exit': result.returncode,
              'log': str(log_path), 'input_sha256': hashlib.sha256(text.encode('utf-8')).hexdigest(),
              'result': answer, 'task': answer.get('task'), 'session': answer.get('session'),
              'request': answer.get('requestId'), 'status': answer.get('status'),
              'admission': answer.get('admission')}
    if result.returncode:
        raise RuntimeError(f'dispatch to {recipient} exited {result.returncode}: {record}')
    if not record['task'] or not record['request']:
        raise RuntimeError(f'dispatch to {recipient} did not derive task and request identities: {record}')
    return record


def public_logs(db, session):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        return [dict(attempt=attempt, path=path) for attempt, path in connection.execute(
            'SELECT attempt, log FROM log_generations WHERE session=? ORDER BY rowid',
            (session,))]


def frames(path):
    for line in Path(path).read_text().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            yield value


def omp_reports(path):
    latest = None
    for frame in frames(path):
        kind = frame.get('type')
        if kind == 'message_end':
            messages = [frame.get('message', {})]
        elif kind == 'agent_end' and frame.get('isTerminal') is not False:
            messages = frame.get('messages', [])
        else:
            continue
        if frame.get('compacted') and isinstance(frame.get('text'), str):
            latest = frame['text']
        for message in messages:
            if message.get('role') == 'assistant':
                latest = '\n'.join(part['text'] for part in message.get('content', [])
                                   if part.get('type') == 'text')
        if kind == 'agent_end':
            yield latest
            latest = None


def codex_reports(events):
    latest = None
    for frame in events:
        if frame.get('type') == 'item.completed' and frame.get('item', {}).get('type') == 'agent_message':
            latest = frame['item'].get('text')
        elif frame.get('type') == 'turn.completed':
            assert isinstance(latest, str) and latest.strip(), frame
            yield latest
            latest = None
        elif frame.get('type') == 'turn.failed':
            raise AssertionError({'native_root_failure': frame})


def stage_native_assets(repo, out):
    packaging = repo / 'bend2/scripts/package-native.py'
    spec = importlib.util.spec_from_file_location('acceptance_package_native', packaging)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.stage_adapters(out)
    return {'packaging_source': str(packaging),
            'packaging_sha256': hashlib.sha256(packaging.read_bytes()).hexdigest(),
            'files': {str(path.relative_to(out)): hashlib.sha256(path.read_bytes()).hexdigest()
                      for path in sorted((out / 'libexec/baton2').rglob('*')) if path.is_file()}}


def prepare_coordinator(source, repo, out, supplied):
    binary = out / 'bin/baton2'
    binary.parent.mkdir()
    if supplied is not None:
        shutil.copy2(supplied.resolve(), binary)
        binary.chmod(0o700)
        provenance = {'mode': 'caller_supplied', 'path': str(supplied.resolve()),
                      'source_linkage': 'Unverified by this driver.'}
        provenance['native_assets'] = stage_native_assets(repo, out)
        compatibility = out / 'baton2'
        compatibility.symlink_to(Path('bin/baton2'))
        return compatibility, provenance
    environment = dict(os.environ)
    compiler = environment.get('BEND')
    if compiler:
        compiler = str(Path(shutil.which(compiler) or compiler).resolve())
    else:
        compiler = next((str(path) for path in [source / '.bend/bin/bend',
                        source / 'node_modules/.bend/bin/bend'] if path.is_file()), None)
    if compiler:
        environment['BEND'] = compiler
    argv = ['sh', str(repo / 'bend2/scripts/build-native.sh'),
            'bend2/src/coordinator/main.bend', str(binary)]
    with (out / 'build.log').open('w') as log:
        subprocess.run(argv, cwd=repo, env=environment, stdout=log,
                       stderr=subprocess.STDOUT, check=True)
    provenance = {'mode': 'built_from_selected_clone', 'command': argv,
                  'build_log': str(out / 'build.log'),
                  'generated_c_sha256': hashlib.sha256(binary.with_suffix('.c').read_bytes()).hexdigest()}
    if compiler:
        provenance['compiler'] = {'path': compiler,
                                  'version': command([compiler, 'version'],
                                                     env={**environment, 'BEND_NO_TELEMETRY': '1'}),
                                  'executable_sha256': hashlib.sha256(Path(compiler).read_bytes()).hexdigest()}
    provenance['native_assets'] = stage_native_assets(repo, out)
    compatibility = out / 'baton2'
    compatibility.symlink_to(Path('bin/baton2'))
    return compatibility, provenance


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--coordinator', type=Path,
                        help='Use a supplied binary; its source linkage is not verified by the driver')
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--review-base', default='9e008263')
    parser.add_argument('--tasks', type=Path, help='JSON with initial and optional followup Player tasks')
    parser.add_argument('--resume', action='store_true',
                        help='Continue an existing bootstrap-only run without delivering bootstrap again')
    args = parser.parse_args()
    if not (hasattr(os, 'pidfd_open') or hasattr(select, 'kqueue')):
        parser.error('Process-exit observation requires Linux pidfds or macOS/BSD kqueue')
    custom_tasks = json.loads(args.tasks.read_text()) if args.tasks else None
    if custom_tasks is not None:
        player_names = {'review-native', 'review-validation'}
        if not isinstance(custom_tasks, dict) or set(custom_tasks) != player_names:
            parser.error('--tasks must define review-native and review-validation')
        for task in custom_tasks.values():
            if (not isinstance(task, dict) or not {'initial'} <= set(task) <= {'initial', 'followup'}
                    or any(not isinstance(text, str) or not text.strip() for text in task.values())):
                parser.error('Each Player task needs nonempty initial text and optional followup text')
        if len({('followup' in task) for task in custom_tasks.values()}) != 1:
            parser.error('Provide followup tasks for both Players or neither')
    source = args.source.resolve()
    configured = json.loads(args.config.read_text())
    routes = {kind: {key: configured[kind][key] for key in ['executable', 'model', 'effort']}
              for kind in ['codex', 'omp']}
    for route in routes.values():
        route['executable'] = shutil.which(route['executable']) or route['executable']
        if not Path(route['executable']).is_file():
            parser.error('A configured native executable is unavailable')
        route['executable'] = str(Path(route['executable']).resolve())
    base = command(['git', '-C', source, 'rev-parse', f'{args.revision}^{{commit}}'])
    review_base = command(['git', '-C', source, 'rev-parse', f'{args.review_base}^{{commit}}'])
    command(['git', '-C', source, 'diff', '--exit-code', base, '--', 'bend2/src'])
    if command(['git', '-C', source, 'ls-files', '--others', '--exclude-standard', '--', 'bend2/src']):
        parser.error('Commit new runtime source files before selecting the acceptance revision')
    out = args.output.resolve()
    db = out / 'state.db'
    repo = out / 'repo'
    resumed_label = f'resume-{time.time_ns()}' if args.resume else None
    if args.resume:
        pin = json.loads((out / 'run.json').read_text())
        binary = out / 'baton2'
        for key, expected in {'source': base, 'review_base': review_base, 'routes': routes,
                              'custom_tasks': custom_tasks}.items():
            assert pin[key] == expected, (key, pin[key], expected)
        assert hashlib.sha256(binary.read_bytes()).hexdigest() == pin['coordinator_sha256']
        assert command(['git', '-C', repo, 'rev-parse', 'HEAD']) == base
        assert not command(['git', '-C', repo, 'status', '--porcelain'])
        initial = snapshot(db)
        admitted = [(row['id'], row['sender'], row['recipient'], row['kind'])
                    for row in initial['messages'] if row['kind'] != 'report']
        assert len(admitted) == 1 and admitted[0][1:] == ('operator', 'root', 'task'), initial
        processes = json.loads((out / 'processes.json').read_text())
        assert len(processes) == 1 and processes[0]['label'] == 'root-bootstrap'
        assert processes[0]['task'] == admitted[0][0] and processes[0]['exit'] == 0, processes
        save(out / f'{resumed_label}.json', {
            'started_unix': time.time(), 'original_run': pin, 'original_state': initial,
            'original_failure_sha256': hashlib.sha256((out / 'failure-state.json').read_bytes()).hexdigest(),
            'driver_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
            'original_processes': processes})
    else:
        out.mkdir(parents=True, exist_ok=False)
        command(['git', 'clone', '--shared', '--no-checkout', source, repo])
        command(['git', '-C', repo, 'checkout', '--detach', base])
        binary, build = prepare_coordinator(source, repo, out, args.coordinator)
        pin = {'source': base, 'review_base': review_base, 'source_directory': str(source),
               'coordinator_sha256': hashlib.sha256(binary.read_bytes()).hexdigest(),
               'coordinator_build': build,
               'driver_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
               'routes': routes, 'custom_tasks': custom_tasks, 'started_unix': time.time()}
        save(out / 'run.json', pin)
        processes = []

    def save_state(name, state):
        save(out / (f'{resumed_label}.{name}' if resumed_label else name), state)

    def call(*argv):
        return json.loads(command([binary, db, *argv], cwd=repo))
    def dispatch(recipient, text, label, sender=None):
        previous = read_rows(db, 'SELECT id FROM executions WHERE session=?', (recipient,))
        record = dispatch_task(binary, db, repo, recipient, text,
                               out / f'{label}.dispatch.json', sender=sender)
        record['previous_execution'] = previous[0]['id'] if previous else None
        message = read_rows(db, 'SELECT * FROM messages WHERE id=?', (record['task'],))[0]
        assert (message['sender'], message['recipient'], message['body']) == (
            sender or 'operator', recipient, text), message
        assert message['kind'] in ('task', 'task-continuation'), message
        processes.append(record)
        save(out / 'processes.json', processes)
        return record

    def settle(record):
        return wait_settlement(db, record['session'], record['task'], record['label'], out,
                               previous_execution=record.get('previous_execution'))

    coordinator_cli = ' '.join(shlex.quote(str(value)) for value in [binary, db])
    common = f"""Review source revision {base}, compared with {review_base}.
Work only in your assigned clone/worktree below {out}. Read source and Git diffs.
Keep all tracked and untracked source files unchanged. Do not run the repository
test suites, build toolchains, recruit more agents, install anything, change
credentials or global configuration, or push. Use the existing native login.
Coordinator input reads and automatic handling write this run's database at {db}.
Do not send a separate report command: native receive forwards your final text.
Do not send guidance during report delivery. End your turn after your review.
"""
    players = [
        ('review-native', 'NATIVE_RECEIVE_REVIEW',
         'Review bend2/src/coordinator/receive.bend and its changes to turn, store, root, '
         'host process supervision and session locking. Trace concurrent incoming messages, '
         'native session resume, parent reports, acknowledgment boundaries and failure paths. '
         'Identify concrete correctness risks with file and line references; distinguish '
         'observed source behavior from hypotheses. List the files you actually inspected.'),
        ('review-validation', 'MEASUREMENT_VALIDATION_REVIEW',
         'Review bend2/scripts/compare-coordinators.py, compare-old-coordinator.mjs, '
         'check-native.sh, and the relevant native receive/root/turn/end-to-end tests. '
         'Read docs/bend2/comparison-2026-09-28.md and its final measurement JSON. '
         'Check measurement boundaries, source pins, correctness assertions, stated '
         'limitations and coverage of the new receive path. Identify concrete defects '
         'with file and line references; list the files you actually inspected.'),
    ]
    if custom_tasks is not None:
        players = [(player, marker, custom_tasks[player]['initial'])
                   for player, marker, _ in players]
    has_followups = custom_tasks is not None and 'followup' in custom_tasks['review-native']
    root_task = common + f"""
You are the Codex root for a native receive acceptance run. Two OMP reviewers,
review-native and review-validation, will independently inspect this source.
First inspect the pinned checkout identity and receive entry point and handle
the complete assigned input. Finish this native turn; Baton records handling
automatically. Native receive will resume this same conversation when their
reports arrive. For each report, inspect its cited source and assess its findings
and finish your native turn. Use `{coordinator_cli} inbox` to
read complete pending input. Preserve each full body; handle complete text.
Include your assessment in your authored response. Your review may identify unresolved
defects; acceptance of a report records that you read it, not approval of a change.
The reviewers may receive a second task in their existing native sessions.
Do not edit code, run tests or delegate further work. On root-followup, check all
retained reports and receipts, summarize the findings and finish the follow-up turn.
"""
    if not args.resume:
        call('attach', 'operator', 'terminal', '', '')
        call('role', 'operator', 'operator')
        call('start-setup', 'root', 'codex', routes['codex']['executable'],
             routes['codex']['model'], routes['codex']['effort'], str(repo),
             str(out / 'root.jsonl'))
        call('role', 'root', 'principal-conductor')
    else:
        root_session = next(row for row in initial['sessions'] if row['id'] == 'root')
        for key, expected in {'harness': 'codex', 'model': routes['codex']['model'],
                              'effort': routes['codex']['effort'],
                              'workspace': str(repo)}.items():
            assert root_session[key] == expected, (key, root_session)
        bootstrap = next(row for row in initial['messages'] if row['id'] == processes[0]['task'])
        assert bootstrap['body'] == root_task, bootstrap
    tasks = {}

    def player_task(marker, focus):
        return (common + f'\n{focus}\n\n'
                f'Begin your final response with {marker} and the full source revision {base}.\n'
                'Report findings or explain the specific checks that found no issue, then finish\n'
                'your native turn. Baton automatically records complete input handling.\n'
                'Include material limitations.\n')

    for player, marker, focus in players:
        workspace = out / player
        if not args.resume:
            call('recruit', player, 'root', 'omp', routes['omp']['model'], routes['omp']['effort'],
                 str(repo), player, str(workspace), base)
        # Empty route and workspace arguments exercise the registered Player binding.
        endpoint = [str(binary), str(db), 'receive', player, routes['omp']['executable'],
                    '', '', '', str(out / f'{player}.jsonl')]
        if not args.resume:
            call('connect', player, '', json.dumps(endpoint))
        else:
            session = next(row for row in initial['sessions'] if row['id'] == player)
            for key, expected in {'parent': 'root', 'harness': 'omp', 'model': routes['omp']['model'],
                                  'effort': routes['omp']['effort'], 'workspace': str(workspace)}.items():
                assert session[key] == expected, (key, session)
            assert not session['native'], session
            assert command(['git', '-C', workspace, 'rev-parse', 'HEAD']) == base
            assert not command(['git', '-C', workspace, 'status', '--porcelain'])
        tasks[player] = player_task(marker, focus)
    try:
        print(f'Native receive acceptance: {out}', flush=True)
        if args.resume:
            wait_settlement(db, 'root', processes[0]['task'], resumed_label + '-bootstrap',
                            out, previous_execution=processes[0].get('previous_execution'))
        else:
            settle(dispatch('root', root_task, 'root-bootstrap'))
        initial = snapshot(db)
        save_state('bootstrap-state.json', initial)
        root_native = next(row['native'] for row in initial['sessions'] if row['id'] == 'root')
        assert root_native
        assert next(row for row in initial['messages'] if row['id'] == processes[0]['task'])['receipt']
        task_records = {player: dispatch(player, tasks[player], f'task-{player}', sender='root')
                        for player, _, _ in players}
        for record in task_records.values():
            settle(record)
        reviewed = snapshot(db)
        save_state('review-state.json', reviewed)
        assert next(row['native'] for row in reviewed['sessions'] if row['id'] == 'root') == root_native
        player_natives = {player: next(row['native'] for row in reviewed['sessions'] if row['id'] == player)
                          for player, _, _ in players}

        def check_reports(state, count, records):
            for player, marker, _ in players:
                session = next(row for row in state['sessions'] if row['id'] == player)
                assert session['parent'] == 'root' and session['native'] == player_natives[player]
                assert session['native']
                assert session['model'] == routes['omp']['model']
                assert session['effort'] == routes['omp']['effort']
                reports = sorted((row for row in state['messages']
                                  if row['sender'] == player and row['kind'] == 'report'),
                                 key=lambda row: row['seq'])
                native_reports = [text for generation in public_logs(db, player)
                                  for text in omp_reports(generation['path'])]
                assert len(reports) == len(native_reports) == count, reports
                for report, text in zip(reports, native_reports):
                    assert report['recipient'] == 'root' and report['receipt']
                    assert marker in report['body'] and base in report['body']
                    assert report['body'] == text
                assert len(records[player]) == count, records[player]
                for record in records[player]:
                    message = next(row for row in state['messages'] if row['id'] == record['task'])
                    assert message['receipt'] and message['recipient'] == player, message

        check_reports(reviewed, 1, {player: [record] for player, record in task_records.items()})
        if has_followups:
            followup_records = {player: dispatch(
                player, player_task(marker, custom_tasks[player]['followup']),
                f'followup-{player}', sender='root') for player, marker, _ in players}
            for record in followup_records.values():
                settle(record)
            resumed = snapshot(db)
            save_state('worker-followup-state.json', resumed)
            check_reports(resumed, 2, {player: [*task_records[player], followup_records[player]]
                                       for player, _, _ in players})
        followup = (common + '\nRead all retained reviewer reports and their handling state. '
                    'Summarize what should be addressed next, then finish your native turn. '
                    'Baton automatically records complete input handling.\n')
        root_followup = dispatch('root', followup, 'root-followup')
        settle(root_followup)
        final = snapshot(db)
        assert next(row['native'] for row in final['sessions'] if row['id'] == 'root') == root_native
        assert next(row for row in final['messages'] if row['id'] == root_followup['task'])['receipt']
        root_generations = public_logs(db, 'root')
        root_events = [frame for generation in root_generations
                       for frame in frames(generation['path'])]
        native_threads = [row['thread_id'] for row in root_events if row.get('type') == 'thread.started']
        assert native_threads and set(native_threads) == {root_native}
        assert all(row['receipt'] for row in final['messages'] if row['recipient'] != 'operator')
        operator_reports = sorted((row for row in final['messages'] if row['recipient'] == 'operator'),
                                  key=lambda row: row['seq'])
        root_native_reports = list(codex_reports(root_events))
        assert operator_reports and len(operator_reports) == len(root_native_reports), operator_reports
        turns = {row['id']: row for row in final['turns']}
        for report, text in zip(operator_reports, root_native_reports):
            assert report['sender'] == 'root' and report['kind'] == 'report', report
            assert report['receipt'] is None and report['body'] == text, report
            turn = turns[report['id']]
            event = json.loads(turn['event'])
            assert turn['worker'] == 'root' and event['type'] == 'result', turn
            assert event['result'] == report['body'] and event['nativeEvent']['type'] == 'turn.completed', turn
        for workspace in [repo, *(out / player for player, _, _ in players)]:
            assert not command(['git', '-C', workspace, 'status', '--porcelain']), workspace
            assert command(['git', '-C', workspace, 'rev-parse', 'HEAD']) == base
        save(out / 'evidence.json', {
            **pin, 'ended_unix': time.time(), 'state': final,
            'processes': processes, 'root_native_threads': native_threads,
            'resumption': resumed_label,
            'public_log_generations': {session: public_logs(db, session)
                                       for session in ['root', *(p for p, _, _ in players)]},
            'player_native_sessions': player_natives, 'player_followups_verified': has_followups,
            'operator_reports_pending_review': operator_reports,
            'assertions': ['Reports match the complete native assistant text.',
                           'Player reports and participant task inputs have recipient-owned receipts.',
                           'Native root reports retain their complete text and turn lineage for operator review.',
                           'The root retained its native session through reports and follow-up.',
                           'Player parent, requested route and source revision were retained.',
                           'All cloned source workspaces remain unchanged.'],
            'limitations': ['This run does not establish overlap between root deliveries.',
                            'The operator must review the retained native root reports and record its own receipts.',
                            'Provider latency and review conclusions depend on the native sessions.',
                            'No landing, publication or host-restart recovery is exercised.'],
        })
        print(f'Native receive verified: {out / "evidence.json"}', flush=True)
    except BaseException:
        save_state('failure-state.json', snapshot(db))
        raise


if __name__ == '__main__':
    main()
