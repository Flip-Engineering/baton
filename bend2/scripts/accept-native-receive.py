#!/usr/bin/env python3
"""Review a source revision with two OMP workers and a native Codex root.

The route JSON uses codex and omp objects with executable, model and effort
fields, as accept-hierarchy.py does. This command starts real native sessions.
All coordinator state, cloned source and native logs remain below --output.
By default the coordinator builds from that clone; BEND selects an installed
compiler. --coordinator uses a supplied executable with unverified source linkage.
--tasks accepts review-native and review-validation objects with initial text and
optional followup text for both workers. Follow-ups verify worker session reuse.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import shutil
import sqlite3
import subprocess
import time

SOURCE = Path(__file__).resolve().parents[2]


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def command(argv, **kwargs):
    result = subprocess.run(list(map(str, argv)), capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr[-2000:]}')
    return result.stdout.strip()


def snapshot(db):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        connection.row_factory = sqlite3.Row
        return {table: [dict(row) for row in connection.execute(f'SELECT * FROM {table}')]
                for table in ['sessions', 'messages', 'turns']}


def frames(path):
    for line in path.read_text().splitlines():
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
        for message in messages:
            if message.get('role') == 'assistant':
                latest = '\n'.join(part['text'] for part in message.get('content', [])
                                   if part.get('type') == 'text')
        if kind == 'agent_end':
            yield latest
            latest = None


def prepare_coordinator(source, repo, out, supplied):
    binary = out / 'baton2'
    if supplied is not None:
        shutil.copy2(supplied.resolve(), binary)
        binary.chmod(0o700)
        return binary, {'mode': 'caller_supplied', 'path': str(supplied.resolve()),
                        'source_linkage': 'Unverified by this driver.'}
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
    return binary, provenance


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
    parser.add_argument('--tasks', type=Path, help='JSON with initial and optional followup worker tasks')
    args = parser.parse_args()
    custom_tasks = json.loads(args.tasks.read_text()) if args.tasks else None
    if custom_tasks is not None:
        worker_names = {'review-native', 'review-validation'}
        if not isinstance(custom_tasks, dict) or set(custom_tasks) != worker_names:
            parser.error('--tasks must define review-native and review-validation')
        for task in custom_tasks.values():
            if (not isinstance(task, dict) or not {'initial'} <= set(task) <= {'initial', 'followup'}
                    or any(not isinstance(text, str) or not text.strip() for text in task.values())):
                parser.error('Each worker task needs nonempty initial text and optional followup text')
        if len({('followup' in task) for task in custom_tasks.values()}) != 1:
            parser.error('Provide followup tasks for both workers or neither')
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
    out.mkdir(parents=True, exist_ok=False)
    db = out / 'state.db'
    repo = out / 'repo'
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

    def call(*argv):
        return json.loads(command([binary, db, *argv], cwd=repo))

    def start_message(ident, recipient, task):
        sender = 'operator' if recipient == 'root' else 'root'
        argv = list(map(str, [binary, db, 'message-file', ident, sender, recipient, 'task', task]))
        with (out / f'{ident}.command.log').open('w') as log:
            process = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                       cwd=repo, start_new_session=True)
        record = {'message': ident, 'sender': sender, 'recipient': recipient,
                  'dispatch_origin': 'acceptance-driver', 'pid': process.pid,
                  'started_unix': time.time(), 'command': argv}
        processes.append((process, record))
        save(out / 'processes.json', [row for _, row in processes])
        return process

    def finish_all(selected):
        for process in selected:
            code = process.wait()
            record = next(row for child, row in processes if child is process)
            record.update(ended_unix=time.time(), exit_code=code)
            save(out / 'processes.json', [row for _, row in processes])
        failed = [row['message'] for child, row in processes if child in selected and row['exit_code']]
        if failed:
            raise RuntimeError(f'Native delivery failed for {failed}; inspect retained command logs')

    coordinator_cli = ' '.join(shlex.quote(str(value)) for value in [binary, db])
    common = f"""Review source revision {base}, compared with {review_base}.
Work only in your assigned clone/worktree below {out}. Read source and Git diffs.
Keep all tracked and untracked source files unchanged. Do not run the repository
test suites, build toolchains, recruit more agents, install anything, change
credentials or global configuration, or push. Use the existing native login.
Coordinator acknowledgment commands may write this run's database at {db}.
Do not send a separate report command: native receive forwards your final text.
Do not send guidance during report delivery. End your turn after your review.
"""
    workers = [
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
        workers = [(worker, marker, custom_tasks[worker]['initial'])
                   for worker, marker, _ in workers]
    has_followups = custom_tasks is not None and 'followup' in custom_tasks['review-native']
    root_task = out / 'root-bootstrap.md'
    root_task.write_text(common + f"""
You are the Codex root for a native receive acceptance run. Two OMP reviewers,
review-native and review-validation, will independently inspect this source.
First inspect the pinned checkout identity and receive entry point, then acknowledge
root-bootstrap using `{coordinator_cli} ack root-bootstrap root RECEIPT`.
Finish this turn. Native receive will resume this same conversation when their
reports arrive. For each report, inspect its cited source and assess its findings
before acknowledging that report ID with a receipt describing your assessment.
Use the pending inbox to identify all report IDs addressed to root. Preserve each
full body; do not acknowledge missing text. Your review may identify unresolved
defects; acceptance of a report records that you read it, not approval of a change.
The reviewers may receive a second task in their existing native sessions.
Do not edit code, run tests or delegate further work. On root-followup, check all
retained reports and receipts, summarize the findings and acknowledge the follow-up.
""")
    call('attach', 'operator', 'terminal', '', '')
    call('role', 'operator', 'operator')
    endpoint = [str(binary), str(db), 'receive', 'root', routes['codex']['executable'],
                routes['codex']['model'], routes['codex']['effort'], str(repo), str(out / 'root.jsonl')]
    call('attach', 'root', 'codex', '', json.dumps(endpoint))
    call('role', 'root', 'conductor')
    tasks = {}

    def worker_task(worker, marker, ident, focus):
        task = out / f'{ident}.md'
        task.write_text(common + f'\n{focus}\n\n'
                        f'Begin your final response with {marker} and the full source revision {base}.\n'
                        f'Before returning it, acknowledge {ident} as {worker} through the\n'
                        'coordinator command provided by receive. Report findings or explain the\n'
                        'specific checks that found no issue. Include material limitations.\n')
        return task

    for worker, marker, focus in workers:
        workspace = out / worker
        call('recruit', worker, 'root', 'omp', routes['omp']['model'], routes['omp']['effort'],
             str(repo), worker, str(workspace), base)
        # Empty route and workspace arguments exercise the registered worker binding.
        endpoint = [str(binary), str(db), 'receive', worker, routes['omp']['executable'],
                    '', '', '', str(out / f'{worker}.jsonl')]
        call('connect', worker, '', json.dumps(endpoint))
        tasks[worker] = worker_task(worker, marker, f'task-{worker}', focus)
    try:
        print(f'Native receive acceptance: {out}', flush=True)
        finish_all([start_message('root-bootstrap', 'root', root_task)])
        initial = snapshot(db)
        save(out / 'bootstrap-state.json', initial)
        root_native = next(row['native'] for row in initial['sessions'] if row['id'] == 'root')
        assert root_native
        assert next(row for row in initial['messages'] if row['id'] == 'root-bootstrap')['receipt']
        children = [start_message(f'task-{worker}', worker, tasks[worker]) for worker, _, _ in workers]
        finish_all(children)
        reviewed = snapshot(db)
        save(out / 'review-state.json', reviewed)
        assert next(row['native'] for row in reviewed['sessions'] if row['id'] == 'root') == root_native
        worker_natives = {worker: next(row['native'] for row in reviewed['sessions'] if row['id'] == worker)
                          for worker, _, _ in workers}

        def check_reports(state, count):
            for worker, marker, _ in workers:
                session = next(row for row in state['sessions'] if row['id'] == worker)
                assert session['parent'] == 'root' and session['native'] == worker_natives[worker]
                assert session['native']
                assert session['model'] == routes['omp']['model']
                assert session['effort'] == routes['omp']['effort']
                reports = sorted((row for row in state['messages']
                                  if row['sender'] == worker and row['kind'] == 'report'),
                                 key=lambda row: row['seq'])
                native_reports = list(omp_reports(out / f'{worker}.jsonl'))
                assert len(reports) == len(native_reports) == count, reports
                for report, text in zip(reports, native_reports):
                    assert report['recipient'] == 'root' and report['receipt']
                    assert marker in report['body'] and base in report['body']
                    assert report['body'] == text
                for prefix in ['task', 'followup'][:count]:
                    assert next(row for row in state['messages'] if row['id'] == f'{prefix}-{worker}')['receipt']

        check_reports(reviewed, 1)
        if has_followups:
            followups = [start_message(f'followup-{worker}', worker,
                         worker_task(worker, marker, f'followup-{worker}', custom_tasks[worker]['followup']))
                         for worker, marker, _ in workers]
            finish_all(followups)
            resumed = snapshot(db)
            save(out / 'worker-followup-state.json', resumed)
            check_reports(resumed, 2)
        followup = out / 'root-followup.md'
        followup.write_text(common + '\nRead all retained reviewer reports and your receipts. '
                            'Summarize what should be addressed next. Acknowledge root-followup '
                            'after this review, then finish your turn.\n')
        finish_all([start_message('root-followup', 'root', followup)])
        final = snapshot(db)
        assert next(row['native'] for row in final['sessions'] if row['id'] == 'root') == root_native
        assert next(row for row in final['messages'] if row['id'] == 'root-followup')['receipt']
        root_events = list(frames(out / 'root.jsonl'))
        native_threads = [row['thread_id'] for row in root_events if row.get('type') == 'thread.started']
        assert native_threads and set(native_threads) == {root_native}
        assert all(row['receipt'] for row in final['messages'])
        for workspace in [repo, *(out / worker for worker, _, _ in workers)]:
            assert not command(['git', '-C', workspace, 'status', '--porcelain']), workspace
            assert command(['git', '-C', workspace, 'rev-parse', 'HEAD']) == base
        save(out / 'evidence.json', {
            **pin, 'ended_unix': time.time(), 'state': final,
            'processes': [row for _, row in processes], 'root_native_threads': native_threads,
            'worker_native_sessions': worker_natives, 'worker_followups_verified': has_followups,
            'assertions': ['Reports match the complete native assistant text.',
                           'Reports and task messages have native acceptance receipts.',
                           'The root retained its native session through reports and follow-up.',
                           'Worker parent, requested route and source revision were retained.',
                           'All cloned source workspaces remain unchanged.'],
            'limitations': ['This run does not establish overlap between root deliveries.',
                            'Provider latency and review conclusions depend on the native sessions.',
                            'No landing, publication or host-restart recovery is exercised.'],
        })
        print(f'Native receive verified: {out / "evidence.json"}', flush=True)
    except BaseException:
        save(out / 'failure-state.json', snapshot(db))
        raise


if __name__ == '__main__':
    main()
