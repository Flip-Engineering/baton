#!/usr/bin/env python3
"""Run a native Codex root, Kimi OMP lead, and concurrent DeepSeek/Muse workers.

--config supplies codex, lead, omp and muse routes with executable, model and
effort. Optional observed_model names the expected native model; native_executable
adds an underlying executable pin when executable is a launcher script.
--tasks supplies deepseek/muse task text, files and checks, guidance text, and
optional file_checks with path, contains and absent lists. Selected checks run as
Python files in each checked tree. This command starts real native sessions.
Final worker and target changes must stay within the run's assigned files.
Worker assigned files must match their latest landing and the final target.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import threading
import time

SOURCE = Path(__file__).resolve().parents[2]
WORKERS = ('deepseek', 'muse')


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2) + '\n')
    temporary.replace(path)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def command(argv, **kwargs):
    result = subprocess.run(list(map(str, argv)), capture_output=True, text=True, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} exited {result.returncode}: {result.stderr[-3000:]}')
    return result.stdout.strip()


def records(out, seat=None):
    rows = [json.loads(path.read_text()) for path in out.glob('native-*.process.json')]
    return sorted((row for row in rows if seat is None or row['seat'] == seat),
                  key=lambda row: row['started_unix'])


def frames(path):
    for line in path.read_text().splitlines():
        try:
            value = json.loads(line)
        except ValueError:
            continue
        if isinstance(value, dict):
            yield value


def native_wrapper(seat, out, arguments):
    run = json.loads((out / 'run.json').read_text())
    route = run['routes'][{'root': 'codex', 'deepseek': 'omp'}.get(seat, seat)]
    harness = 'codex' if seat == 'root' else 'muse' if seat == 'muse' else 'omp'
    stem = out / f'native-{seat}-{os.getpid()}'
    argv = [route['executable']]
    environment = dict(os.environ)
    if seat == 'root':
        argv += ['-c', 'forced_login_method="chatgpt"']
        for key in ['OPENAI_API_KEY', 'CODEX_API_KEY']:
            environment.pop(key, None)
    argv += arguments
    row = {'seat': seat, 'harness': harness, 'pid': os.getpid(),
           'ppid': os.getppid(), 'argv': argv, 'started_unix': time.time(),
           'frames': str(stem.with_suffix('.native.jsonl')),
           'events': str(stem.with_suffix('.events.jsonl'))}
    save(stem.with_suffix('.process.json'), row)
    try:
        child = subprocess.Popen(argv, stdout=subprocess.PIPE, env=environment)
        row['child_pid'] = child.pid
        row['child_started_unix'] = time.time()
        save(stem.with_suffix('.process.json'), row)

        def reap():
            row['child_exit_code'] = child.wait()
            row['child_ended_unix'] = time.time()
            save(stem.with_suffix('.process.json'), row)

        reaper = threading.Thread(target=reap)
        reaper.start()
        with child.stdout, Path(row['frames']).open('wb') as log, Path(row['events']).open('w') as events:
            for line in child.stdout:
                received = time.time()
                try:
                    frame = json.loads(line)
                except ValueError:
                    frame = {}
                if not isinstance(frame, dict):
                    frame = {}
                if harness != 'omp' or frame.get('type') != 'message_update':
                    event = {key: frame[key] for key in ['type', 'command', 'id', 'success', 'payload_type', 'isTerminal']
                             if key in frame}
                    event.update(received_unix=received, offset=log.tell(), bytes=len(line))
                    log.write(line)
                    log.flush()
                    events.write(json.dumps(event) + '\n')
                    events.flush()
                sys.stdout.buffer.write(line)
                sys.stdout.buffer.flush()
        reaper.join()
        code = row['child_exit_code']
        row.update(ended_unix=time.time(), exit_code=code)
        save(stem.with_suffix('.process.json'), row)
        return code if code >= 0 else 128 - code
    except BaseException as error:
        row.update(wrapper_error=repr(error), ended_unix=time.time())
        save(stem.with_suffix('.process.json'), row)
        raise


def start_workers(out):
    run = json.loads((out / 'run.json').read_text())
    launched = []
    for seat in WORKERS:
        route = run['routes']['omp' if seat == 'deepseek' else 'muse']
        argv = [str(out / 'baton2'), str(out / 'state.db'), 'turn', seat, f'{seat}-turn',
                str(out / f'{seat}-native'), route['model'], route['effort'],
                str(out / seat), str(out / f'{seat}.md'), str(out / f'{seat}.jsonl'), '']
        with (out / f'{seat}.command.log').open('w') as log:
            child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT,
                                     cwd=out / 'lead', start_new_session=True)
        launched.append({'seat': seat, 'pid': child.pid, 'started_unix': time.time(), 'argv': argv})
        save(out / 'worker-launches.json', launched)
    print(json.dumps(launched))


def observe_tool(out):
    while True:
        rows = records(out, 'deepseek')
        for row in rows:
            events = Path(row['events'])
            if events.exists():
                first = next((event for event in frames(events)
                              if event.get('type') == 'tool_execution_start'), None)
                if first:
                    if 'child_ended_unix' in row:
                        raise RuntimeError('DeepSeek completed before the lead observed its tool event')
                    proof = {'observed_unix': time.time(), 'process': row['pid'], 'event': first}
                    save(out / 'guidance-observation.json', proof)
                    print(json.dumps(proof))
                    return
        if rows and all('ended_unix' in row for row in rows):
            raise RuntimeError('DeepSeek ended without a usable active tool event')
        time.sleep(0.1)


def native_id(frame):
    if frame.get('type') == 'response' and frame.get('command') == 'get_state':
        return frame.get('data', {}).get('sessionId')
    if frame.get('type') == 'thread.started':
        return frame.get('thread_id')
    if frame.get('session_id'):
        return frame['session_id']
    if frame.get('type') == 'session':
        return frame.get('id')
    if frame.get('stream', {}).get('kind') == 'session':
        return frame['stream'].get('id')
    return None


def git_entry(repo, revision, path):
    """Return the stored mode, object and path, including absence after deletion."""
    return command(['git', '-C', repo, 'ls-tree', revision, '--', path])


def verify_landings(out, run, sessions):
    repo, base = out / 'repo', run['source']
    tips = {seat: command(['git', '-C', repo, 'rev-parse', branch]) for seat, branch in
            [('target', 'bend2-trial'), ('lead', 'hierarchy-lead'),
             ('deepseek', 'hierarchy-deepseek'), ('muse', 'hierarchy-muse')]}
    receipts = {path.name: json.loads(path.read_text()) for path in out.glob('landing-*.json')}
    landings = {'root': receipts['landing-root.json']}
    assert landings['root']['status'] == 'landed' and landings['root']['target'] == 'bend2-trial'
    assert tips['target'] == landings['root']['commit']
    tree = lambda revision: command(['git', '-C', repo, 'rev-parse', f'{revision}^{{tree}}'])
    assert tree(tips['target']) == tree(tips['lead'])
    assigned = {seat: set(run['tasks'][seat]['files']) for seat in WORKERS}
    allowed = set.union(*assigned.values())
    changed = set(command(['git', '-C', repo, 'diff', '--name-only', '--no-renames',
                           base, tips['target']]).splitlines())
    assert changed and changed <= allowed, ('Unassigned target changes', changed)
    selected = {}

    def ancestor(older, newer):
        return command(['git', '-C', repo, 'merge-base', older, newer]) == older

    for seat in WORKERS:
        base = sessions[seat]['base']
        assert ancestor(base, tips[seat]), ('Worker lost its recorded base', seat)
        changed = set(command(['git', '-C', repo, 'diff', '--name-only', '--no-renames',
                               base, tips[seat]]).splitlines())
        assert changed <= allowed, ('Unassigned worker changes', seat, changed)
        assert changed & assigned[seat], ('Worker left no change in its assigned files', seat)
        candidates = [(name, receipt) for name, receipt in receipts.items()
                      if (name == f'landing-{seat}.json' or name.startswith(f'landing-{seat}-'))
                      and receipt['status'] == 'landed']
        assert candidates, ('Missing successful worker landing', seat)
        latest_name, latest = candidates[0]
        for name, receipt in candidates:
            assert receipt['target'] == 'hierarchy-lead' and ancestor(receipt['commit'], tips['lead'])
            if ancestor(latest['commit'], receipt['commit']):
                latest_name, latest = name, receipt
            else:
                assert ancestor(receipt['commit'], latest['commit']), 'Worker landings have divergent histories'
        landings[seat], selected[seat] = latest, latest_name
        for path in assigned[seat]:
            entry = git_entry(repo, tips[seat], path)
            assert entry == git_entry(repo, latest['commit'], path), ('Worker correction was not landed', seat, path)
            assert entry == git_entry(repo, tips['target'], path), ('Target changed worker content or mode', seat, path)
    return {'tips': tips, 'landings': landings, 'landing_receipts': receipts,
            'selected_worker_receipts': selected}


def verify(out, state, run, helpers):
    repo = out / 'repo'
    sessions = {row['id']: row for row in state['sessions']}
    messages = {row['id']: row for row in state['messages']}
    processes = records(out)
    assert processes and all(row.get('exit_code') == 0 for row in processes), processes
    for seat, parent, harness, route_key in [('root', None, 'codex', 'codex'),
            ('lead', 'root', 'omp', 'lead'), ('deepseek', 'lead', 'omp', 'omp'),
            ('muse', 'lead', 'muse', 'muse')]:
        session, route = sessions[seat], run['routes'][route_key]
        assert session['parent'] == parent and session['harness'] == harness
        assert session['native']
        if seat != 'root':
            assert session['model'] == route['model'] and session['effort'] == route['effort']
            assert session['observed_model'] == route.get('observed_model', route['model']), session
        seen = {native_id(frame) for row in records(out, seat) for frame in frames(Path(row['frames']))}
        seen.discard(None)
        assert seen == {session['native']}, (seat, seen, session['native'])
    assert len(records(out, 'root')) > 1 and len(records(out, 'lead')) > 1
    assert all(row['receipt'] for row in state['messages'] if row['recipient'] != 'operator')
    for seat in WORKERS:
        report = messages[f'{seat}-turn']
        assert report['sender'] == seat and report['recipient'] == 'lead' and report['receipt']
        assert report['body'] and any(row['id'] == report['id'] for row in state['turns'])
    deepseek_text = list(helpers.omp_reports(Path(records(out, 'deepseek')[0]['frames'])))
    assert deepseek_text == [messages['deepseek-turn']['body']]
    muse_terminal = [frame for frame in frames(Path(records(out, 'muse')[0]['frames']))
                     if frame.get('payload', {}).get('kind') == 'run_terminal']
    assert muse_terminal and muse_terminal[-1]['payload']['terminal'] == 'completed'
    assert muse_terminal[-1]['payload']['text'] == messages['muse-turn']['body']
    assert any(row['sender'] == 'lead' and row['recipient'] == 'root' and row['kind'] == 'report'
               and row['receipt'] for row in state['messages'])
    guidance = messages['unexpected-success-guidance']
    receipt = json.loads(guidance['receipt'])
    assert guidance['sender'] == 'lead' and guidance['recipient'] == 'deepseek'
    assert guidance['body'] == run['tasks']['guidance']
    assert receipt['command'] == 'steer' and receipt['success'] is True
    worker_runs = {seat: records(out, seat) for seat in WORKERS}
    assert all(worker_runs.values()), worker_runs
    deepseek, muse = (worker_runs[seat][0] for seat in WORKERS)
    overlap = min(deepseek['child_ended_unix'], muse['child_ended_unix']) - max(
        deepseek['child_started_unix'], muse['child_started_unix'])
    assert overlap > 0, overlap
    concurrency = json.loads((out / 'concurrent-native-processes.json').read_text())
    assert set(concurrency['child_pids']) == {deepseek['child_pid'], muse['child_pid']}
    observed = json.loads((out / 'guidance-observation.json').read_text())
    steer = next(event for event in frames(Path(deepseek['events']))
                 if event.get('type') == 'response' and event.get('command') == 'steer'
                 and event.get('id') == guidance['id'] and event.get('success') is True)
    assert deepseek['child_started_unix'] <= observed['event']['received_unix'] <= observed['observed_unix']
    terminal = next(event for event in frames(Path(deepseek['events']))
                    if event.get('type') == 'agent_end' and event.get('isTerminal') is not False)
    assert observed['observed_unix'] <= steer['received_unix'] <= terminal['received_unix']
    lead_calls = [frame for row in records(out, 'lead') for frame in frames(Path(row['frames']))
                  if frame.get('type') == 'tool_execution_start'
                  and 'unexpected-success-guidance' in json.dumps(frame.get('args', frame.get('input', {})))
                  and 'message-file' in json.dumps(frame.get('args', frame.get('input', {})))]
    assert lead_calls, 'Guidance command missing from actual lead tool-call arguments'
    landed = verify_landings(out, run, sessions)
    tips = landed['tips']
    for workspace in [repo, out / 'lead']:
        assert not command(['git', '-C', workspace, 'status', '--porcelain'])
    for seat in WORKERS:
        assert not command(['git', '-C', out / seat, 'status', '--porcelain'])
    for check in run['tasks'].get('file_checks', []):
        text = command(['git', '-C', repo, 'show', f'{tips["target"]}:{check["path"]}'])
        assert all(value in text for value in check.get('contains', [])), check
        assert all(value not in text for value in check.get('absent', [])), check
    return {'processes': processes, **landed,
            'worker_overlap_seconds': overlap, 'guidance_observation': observed,
            'concurrent_native_processes': concurrency, 'lead_guidance_calls': lead_calls,
            'native_steer_event': steer, 'state': state}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--config', type=Path, required=True)
    parser.add_argument('--tasks', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source', type=Path, default=SOURCE)
    parser.add_argument('--revision', default='HEAD')
    args = parser.parse_args()
    tasks = json.loads(args.tasks.read_text())
    assert isinstance(tasks['guidance'], str) and tasks['guidance'].strip()
    for seat in WORKERS:
        assert tasks[seat]['task'].strip() and tasks[seat]['files'] and tasks[seat]['checks']
        for path in tasks[seat]['files'] + tasks[seat]['checks']:
            assert not Path(path).is_absolute() and '..' not in Path(path).parts and ' ' not in path
    routes = json.loads(args.config.read_text())
    for key in ['codex', 'lead', 'omp', 'muse']:
        route = routes[key]
        for name in ['executable', 'native_executable']:
            if name in route:
                path = Path(shutil.which(route[name]) or route[name]).resolve()
                assert path.is_file(), path
                route[name] = str(path)
                route[name + '_sha256'] = digest(path)
        assert route['model'] and 'effort' in route
    source = args.source.resolve()
    base = command(['git', '-C', source, 'rev-parse', f'{args.revision}^{{commit}}'])
    command(['git', '-C', source, 'diff', '--exit-code', base, '--', 'bend2/src'])
    assert not command(['git', '-C', source, 'ls-files', '--others', '--exclude-standard', '--', 'bend2/src'])
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    repo, db = out / 'repo', out / 'state.db'
    environment = {**os.environ, 'GIT_AUTHOR_NAME': 'Bend2 hierarchy',
                   'GIT_AUTHOR_EMAIL': 'hierarchy@example.invalid',
                   'GIT_COMMITTER_NAME': 'Bend2 hierarchy', 'GIT_COMMITTER_EMAIL': 'hierarchy@example.invalid'}
    login_env = {key: value for key, value in environment.items() if key not in ['OPENAI_API_KEY', 'CODEX_API_KEY']}
    login = subprocess.run([routes['codex']['executable'], '-c', 'forced_login_method="chatgpt"',
                            'login', 'status'], capture_output=True, text=True, env=login_env)
    login_text = login.stdout + login.stderr
    if login.returncode or 'Logged in using ChatGPT' not in login_text:
        raise RuntimeError('Configured Codex launcher did not confirm an existing ChatGPT login')
    command(['git', 'clone', '--shared', '--no-checkout', source, repo], env=environment)
    command(['git', '-C', repo, 'checkout', '--detach', base], env=environment)
    command(['git', '-C', repo, 'branch', 'bend2-trial', base], env=environment)
    helper_path = Path(__file__).with_name('accept-native-receive.py')
    spec = importlib.util.spec_from_file_location('native_acceptance', helper_path)
    helpers = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helpers)
    binary, build = helpers.prepare_coordinator(source, repo, out, None)
    shutil.copy2(__file__, out / 'acceptance.py')
    run = {'source': base, 'source_directory': str(source), 'started_unix': time.time(),
           'routes': routes, 'tasks': tasks, 'coordinator_build': build,
           'coordinator_sha256': digest(binary), 'driver_sha256': digest(Path(__file__)),
           'helper_sha256': digest(helper_path), 'python': sys.executable,
           'codex_login': {'method': 'chatgpt', 'exit_code': login.returncode,
                           'status_sha256': hashlib.sha256(login_text.encode()).hexdigest()}}
    save(out / 'run.json', run)
    wrappers = {}
    for seat in ['root', 'lead', *WORKERS]:
        wrapper = out / f'{seat}-native'
        wrapper.write_text('#!/bin/sh\nexec ' + ' '.join(shlex.quote(str(value)) for value in
                           [sys.executable, out / 'acceptance.py', 'native', seat, out]) + ' "$@"\n')
        wrapper.chmod(0o700)
        wrappers[seat] = str(wrapper)
    check = out / 'check.sh'
    check.write_text('set -eu\nmkdir -p .scratch/bend2\npython3 "$1"\n')
    (out / 'guidance.txt').write_text(tasks['guidance'])
    lead_endpoint = [str(binary), str(db), 'receive', 'lead', wrappers['lead'], '', '', '', str(out / 'lead.jsonl')]
    save(out / 'lead-endpoint.json', lead_endpoint)
    settings = {'B2': str(binary), 'DB': str(db), 'REPO': str(repo), 'STATE': str(out),
                'CHECK': str(check), 'PYTHON': sys.executable}
    for seat, key in [('LEAD', 'lead'), ('DEEPSEEK', 'omp'), ('MUSE', 'muse')]:
        settings.update({seat + '_MODEL': routes[key]['model'], seat + '_EFFORT': routes[key]['effort']})
    (out / 'environment.sh').write_text(''.join(f'export {key}={shlex.quote(value)}\n' for key, value in settings.items()))
    common = f"""Work only inside {out}; source {out / 'environment.sh'} in each shell.
Use the supplied native launchers and existing login. Keep credentials, global
configuration, historical trials and other checkouts unchanged. Preserve this
run's sessions, branches and worktrees. Do not push. Use coordinator recruitment,
acknowledgments and checked landings. Run only the selected Python checks.
If a task cannot be completed, explain the concrete failure in your parent report.
"""
    for seat in WORKERS:
        workspace = (f'Your assigned workspace is {out / seat}, on branch hierarchy-{seat}.\n'
                     'Run file edits, tests and Git commits in that workspace.\n'
                     'REPO names the shared repository for coordinator recruitment and landing.\n')
        (out / f'{seat}.md').write_text(common + '\n' + workspace + '\nAllowed source files: ' +
                                      ', '.join(tasks[seat]['files']) + '\n\n' + tasks[seat]['task'] + '\n')
    checks = sorted({path for seat in WORKERS for path in tasks[seat]['checks']})
    (out / 'lead.md').write_text(common + f"""
You are the Kimi lead, session lead under root. Deliver the two assigned changes
through DeepSeek and Muse. Review their actual diffs and tests, then land them.
Your native final responses report to root automatically. Acknowledge each incoming
task/report after reading it. Do not issue a duplicate manual report.

Recruit deepseek and muse under lead with harnesses omp and muse, models/efforts
DEEPSEEK_MODEL/DEEPSEEK_EFFORT and MUSE_MODEL/MUSE_EFFORT. Use repository REPO,
branches hierarchy-deepseek and hierarchy-muse, workspaces STATE/deepseek and
STATE/muse, and base hierarchy-lead. Command:
`B2 DB recruit ID lead HARNESS MODEL EFFORT REPO BRANCH WORKSPACE hierarchy-lead`.
Detach your lead workspace so land-checked can advance hierarchy-lead.
Run `PYTHON STATE/acceptance.py start-workers STATE` once to start both registered
workers concurrently. It records their coordinator processes and returns promptly.
Run `PYTHON STATE/acceptance.py observe-tool STATE` to observe DeepSeek's first
tool event. Then YOU must issue this coordinator command in your native tool call:
`B2 DB message-file unexpected-success-guidance lead deepseek guidance STATE/guidance.txt`.
Inspect its result and finish this delegation turn with a progress report. Continue
when child reports invoke your native session. No waiting for worker completion.

For each worker report, inspect its actual diff and check output, acknowledge it,
and run `B2 DB land-checked WORKER REPO hierarchy-lead CHECK FILES`, with the worker's
selected checks in one quoted space-separated FILES argument. Save the exact JSON
answer in STATE/landing-WORKER.json. For a correction, preserve earlier answers
and save the new answer as STATE/landing-WORKER-CORRECTION.json with a distinct
CORRECTION suffix. Require status landed. Worker checks:
deepseek: {json.dumps(tasks['deepseek']['checks'])}
muse: {json.dumps(tasks['muse']['checks'])}
Once both landings succeed, inspect the composed lead tree and run the selected
checks there using CHECK. Verify the native steering receipt and required regression.
Report LEAD_READY with actual worker/landing/lead SHAs and review/test evidence.
If blocked, report LEAD_BLOCKED with the evidence. Keep working source changes
limited to the worker task files; you review and integrate their implementations.
""")
    (out / 'root.md').write_text(common + f"""
You are the subscription Codex root. Recruit lead under root, harness omp,
LEAD_MODEL/LEAD_EFFORT, REPO, branch hierarchy-lead, workspace STATE/lead,
base bend2-trial. Connect its native endpoint from STATE/lead-endpoint.json using
`B2 DB connect lead '' ENDPOINT_JSON`. Start `B2 DB message-file lead-task root lead
task STATE/lead.md` in a new background process session with stdout/stderr redirected
to STATE/lead-task.command.log. Acknowledge hierarchy-task, then finish this turn.

Each lead report resumes this same native root. Read and acknowledge progress.
On LEAD_READY, independently inspect both worker diffs, their bindings, guidance
receipt, the lead branch diff, and all selected checks. Run checked landing of
lead onto bend2-trial with CHECK and this one quoted FILES argument:
{' '.join(checks)}
Save the exact JSON answer to STATE/landing-root.json and require status landed.
Verify the target tree equals the lead tree and run the selected checks on that
target tree. Preserve a report of both levels' commits and actual review/check
evidence in STATE/root-report.md. Deliver it using
`B2 DB message-file hierarchy-complete root operator report STATE/root-report.md`.
Only send hierarchy-complete after the final checked landing and checks succeed.
If the hierarchy cannot complete, send hierarchy-failed to operator with concrete
evidence. Do not send guidance during report delivery or launch a direct turn for
an active session. Your own repository checkout is detached; leave it detached.
""")

    def call(*argv):
        return json.loads(command([binary, db, *argv], cwd=repo, env=environment))

    call('attach', 'operator', 'terminal', '', '')
    endpoint = [str(binary), str(db), 'receive', 'root', wrappers['root'], routes['codex']['model'],
                routes['codex']['effort'], str(repo), str(out / 'root.jsonl')]
    call('attach', 'root', 'codex', '', json.dumps(endpoint))
    try:
        with (out / 'seed.log').open('w') as log:
            seed = subprocess.Popen([str(binary), str(db), 'message-file', 'hierarchy-task',
                                     'operator', 'root', 'task', str(out / 'root.md')],
                                    cwd=repo, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                    start_new_session=True)
            save(out / 'seed-process.json', {'pid': seed.pid, 'started_unix': time.time()})
            print(f'Kimi hierarchy started: {out}', flush=True)
            while True:
                state = helpers.snapshot(db)
                terminal = next((row for row in state['messages']
                                 if row['id'] in ['hierarchy-complete', 'hierarchy-failed']), None)
                native = records(out)
                if not (out / 'concurrent-native-processes.json').exists():
                    first = [records(out, seat)[:1] for seat in WORKERS]
                    if all(first) and all('child_pid' in rows[0] and 'child_ended_unix' not in rows[0]
                                          for rows in first):
                        child_pids = [rows[0]['child_pid'] for rows in first]
                        observation = subprocess.run(['ps', '-p', ','.join(map(str, child_pids)),
                            '-o', 'pid=,ppid=,stat=,comm='], capture_output=True, text=True)
                        rows = [line.split(None, 3) for line in observation.stdout.splitlines()]
                        parents = {item[0]['child_pid']: item[0]['pid'] for item in first}
                        if (len(rows) == 2 and all('Z' not in row[2] for row in rows)
                                and all(parents.get(int(row[0])) == int(row[1]) for row in rows)):
                            save(out / 'concurrent-native-processes.json', {'observed_unix': time.time(),
                                 'child_pids': child_pids, 'processes': rows})
                if terminal and native and all('ended_unix' in row for row in native):
                    break
                if seed.poll() not in (None, 0):
                    raise RuntimeError(f'Seed exited {seed.returncode}; inspect seed.log')
                time.sleep(1)
            assert seed.wait() == 0
        assert terminal['id'] == 'hierarchy-complete', terminal
        result = verify(out, state, run, helpers)
        save(out / 'evidence.json', {**run, **result, 'ended_unix': time.time(),
             'limitations': ['Native lifetimes overlap; this does not measure simultaneous model computation.',
                             'Codex events do not supply an observed model.',
                             'The target is a local isolated branch; no remote publication is exercised.']})
        print(f'Kimi hierarchy verified: {out / "evidence.json"}', flush=True)
    except BaseException:
        save(out / 'failure-state.json', helpers.snapshot(db))
        raise


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == 'native':
        sys.exit(native_wrapper(sys.argv[2], Path(sys.argv[3]), sys.argv[4:]))
    elif len(sys.argv) == 3 and sys.argv[1] in ['start-workers', 'observe-tool']:
        {'start-workers': start_workers, 'observe-tool': observe_tool}[sys.argv[1]](Path(sys.argv[2]))
    else:
        main()
