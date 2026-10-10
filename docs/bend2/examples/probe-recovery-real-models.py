"""Manual direct-turn recovery after killing the run's coordinator and harness.

Selected OMP or Codex sessions edit files. The driver kills their owned process
trees, requests each recorded native conversation, and checks the task. An OMP
conversation unavailable on this host restarts fresh with a recovery diagnostic
and the existing workspace state.

Run from the repository root after building .scratch/bend2/baton2:

    python3 docs/bend2/examples/probe-recovery-real-models.py --harness codex

The run creates a new output directory, retains full native argv/PID records and
logs, and writes evidence.json on success or failure. The restart passes the
recorded identity as the turn's final argument. This exercises manual direct-turn
resumption after native process loss. Runtime source remains unchanged.
"""
import argparse
import hashlib
import json
import os
import pathlib
import shlex
import shutil
import signal
import sqlite3
import subprocess
import sys
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[3]
EXE = ROOT / '.scratch/bend2/baton2'
SCRATCH = ROOT / '.scratch/recovery-real-models'
OMP = pathlib.Path('/opt/homebrew/bin/omp')
CODEX = pathlib.Path('/opt/homebrew/Cellar/node/25.8.0/bin/codex')
OMP_MODEL = 'deepseek/deepseek-flash'
CODEX_MODEL = 'gpt-6-astra'
EVIDENCE = {}
OUTPUT_CREATED = False
OWNED_ROOTS = set()

TASK = '''Work only inside this directory.
Step 1: append the line "line one from {name}" to journal.txt.
Step 2: append the line "line two from {name}" to journal.txt.
Step 3: append the line "line three from {name}" to journal.txt.
Do not create other files. When journal.txt holds all three lines, stop.
'''


def run(args, **kw):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, check=True, **kw)


def coord(db, *args):
    argv = [str(EXE), str(db), *map(str, args)]
    result = subprocess.run(argv, capture_output=True, text=True)
    assert result.returncode == 0, {
        'argv': argv,
        'returncode': result.returncode,
        'stdout': result.stdout,
        'stderr': result.stderr,
    }
    return json.loads(result.stdout)


def generation_log(db, session, attempt):
    with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
        row = connection.execute(
            'SELECT log FROM log_generations WHERE session=? AND attempt=?',
            (session, attempt)).fetchone()
    if row is None:
        raise RuntimeError('No public log generation recorded for %s/%s' % (session, attempt))
    return pathlib.Path(row[0])


def process_table():
    """Every live process as (pid, ppid, command)."""
    listing = run(['ps', '-ax', '-o', 'pid=,ppid=,stat=,command=']).stdout
    rows = []
    for line in listing.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) == 4 and not fields[2].startswith('Z'):
            rows.append((int(fields[0]), int(fields[1]), fields[3]))
    return rows


def descendants(roots, table):
    doomed = set(roots)
    changed = True
    while changed:
        changed = False
        for pid, ppid, _ in table:
            if ppid in doomed and pid not in doomed:
                doomed.add(pid)
                changed = True
    return [(pid, ppid, command) for pid, ppid, command in table if pid in doomed]


def kill_all(roots):
    """Freeze this run's Popen trees before injecting complete process loss."""
    assert set(roots) <= OWNED_ROOTS and os.getpid() not in roots
    frozen = {}
    killed = []
    try:
        while True:
            rows = descendants(roots, process_table())
            fresh = [row for row in rows if row[0] not in frozen]
            if not fresh:
                break
            # Stop parents first, then discover children created before the stop.
            pending = {row[0]: row for row in fresh}
            while pending:
                ready = [row for row in pending.values() if row[1] not in pending]
                assert ready, pending
                for pid, ppid, command in ready:
                    try:
                        os.kill(pid, signal.SIGSTOP)
                        frozen[pid] = {'pid': pid, 'ppid': ppid, 'command': command}
                    except ProcessLookupError:
                        pass
                    del pending[pid]
    finally:
        for pid in reversed(frozen):
            try:
                os.kill(pid, signal.SIGKILL)
                killed.append(frozen[pid])
            except ProcessLookupError:
                pass
    return killed


def wait_for(predicate):
    while True:
        value = predicate()
        if value:
            return value
        time.sleep(0.5)


def harness_argv(spec, observer):
    """Read argv recorded by this launch's wrapper before exec."""
    def look():
        rows = []
        if spec['launchRecord'].exists():
            for line in spec['launchRecord'].read_text().splitlines():
                row = json.loads(line)
                if row['ppid'] == observer.pid:
                    rows.append(row)
        if rows:
            return rows
        if observer.poll() is not None:
            raise RuntimeError(f'Harness producer {observer.pid} exited {observer.returncode} without its launch record')
        return None
    return wait_for(look)


def start_turn(argv, prefix):
    with prefix.with_suffix('.stdout').open('w') as stdout, prefix.with_suffix('.stderr').open('w') as stderr:
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr, text=True)
    OWNED_ROOTS.add(child.pid)
    return child


def write_wrapper(spec):
    helper = SCRATCH / (spec['name'] + '-launch.py')
    spec['launchRecord'] = SCRATCH / (spec['name'] + '-launches.jsonl')
    helper.write_text('''import json,os,pathlib,sys,time
config=json.loads(pathlib.Path(__file__).with_suffix('.json').read_text())
argv=[config['executable'],*config['prefix'],*sys.argv[1:]]
with open(config['record'],'a') as output:
    output.write(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'argv':argv,'unix':time.time()})+'\\n')
if config['subscription']:
    os.environ.pop('OPENAI_API_KEY',None)
    os.environ.pop('CODEX_API_KEY',None)
os.execv(argv[0],argv)
''')
    helper.with_suffix('.json').write_text(json.dumps({
        'executable': spec['bin'], 'record': str(spec['launchRecord']),
        'subscription': spec['harness'] == 'codex',
        'prefix': ['-c', 'forced_login_method="chatgpt"'] if spec['harness'] == 'codex' else [],
    }))
    wrapper = SCRATCH / (spec['name'] + '-harness')
    wrapper.write_text('#!/bin/sh\nexec ' + shlex.join([sys.executable, str(helper)]) + ' "$@"\n')
    wrapper.chmod(0o700)
    spec['bin'] = str(wrapper)


def session_dir_rows(db):
    directory = pathlib.Path(str(db) + '.sessions')
    if not directory.is_dir():
        return []
    return sorted(str(p.name) for p in directory.iterdir())


def main():
    global SCRATCH, CODEX, OUTPUT_CREATED
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--harness', choices=['codex', 'omp', 'both'], default='both')
    parser.add_argument('--codex', default=shutil.which('codex') or str(CODEX))
    parser.add_argument('--output', type=pathlib.Path)
    args = parser.parse_args()
    CODEX = pathlib.Path(args.codex).expanduser().resolve()
    SCRATCH = (args.output or ROOT / '.scratch' / ('recovery-real-models-' + uuid.uuid4().hex[:12])).resolve()
    evidence = EVIDENCE
    evidence.update({'sessions': {}, 'harness': args.harness, 'output': str(SCRATCH),
                     'source': run(['git', '-C', ROOT, 'rev-parse', 'HEAD']).stdout.strip(),
                     'driverSha256': hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
                     'boundary': 'Owned coordinator and native process loss; explicit direct-turn resume.'})
    failures = []
    evidence['failures'] = failures
    if not EXE.exists():
        raise RuntimeError('coordinator not built at %s' % EXE)
    evidence['coordinatorSha256'] = hashlib.sha256(EXE.read_bytes()).hexdigest()
    SCRATCH.mkdir(parents=True, exist_ok=False)
    OUTPUT_CREATED = True
    db = SCRATCH / 'state.db'

    # Own repository with its own base commit.
    repo = SCRATCH / 'repo'
    repo.mkdir()
    run(['git', 'init', '-q', '-b', 'main', str(repo)])
    run(['git', '-C', str(repo), 'config', 'user.email', 'probe@example.invalid'])
    run(['git', '-C', str(repo), 'config', 'user.name', 'Real model recovery probe'])
    (repo / 'README.txt').write_text('scratch repository for the recovery probe\n')
    run(['git', '-C', str(repo), 'add', 'README.txt'])
    run(['git', '-C', str(repo), 'commit', '-q', '-m', 'base'])
    base = run(['git', '-C', str(repo), 'rev-parse', 'HEAD']).stdout.strip()
    evidence['repo'] = {'path': str(repo), 'base': base}

    # Codex uses the operator's subscription login.
    codex_logged_in = False
    if args.harness in ['codex', 'both']:
        status = subprocess.run(['/usr/bin/env', '-u', 'OPENAI_API_KEY', '-u', 'CODEX_API_KEY',
                                 str(CODEX), '-c', 'forced_login_method="chatgpt"', 'login', 'status'],
                                capture_output=True, text=True)
        evidence['codexLogin'] = (status.stdout + status.stderr).strip()
        codex_logged_in = status.returncode == 0 and evidence['codexLogin'] == 'Logged in using ChatGPT'
        if not codex_logged_in:
            evidence['codexSkipped'] = 'Codex requires the operator subscription login: ' + evidence['codexLogin']
            if args.harness == 'codex':
                failures.append('Codex must be logged in using ChatGPT')

    specs = []
    if args.harness in ['omp', 'both'] and OMP.exists():
        specs.append({'name': 'ompsession', 'harness': 'omp', 'bin': str(OMP), 'model': OMP_MODEL})
    if args.harness in ['codex', 'both'] and codex_logged_in:
        specs.append({'name': 'codexsession', 'harness': 'codex', 'bin': str(CODEX),
                      'model': CODEX_MODEL})
    if not specs:
        raise RuntimeError('Selected harness is unavailable')

    coord(db, 'attach', 'root', 'omp', 'native-root', '')

    # Recruit one worktree per session, then start its real turn in the
    # background. The first launch names no session, so it starts fresh.
    turns = {}
    for spec in specs:
        name = spec['name']
        worktree = SCRATCH / (name + '-wt')
        task = SCRATCH / (name + '-task.md')
        task.write_text(TASK.format(name=name))
        write_wrapper(spec)
        coord(db, 'recruit', name, 'root', spec['harness'], spec['model'], 'low',
              repo, 'bend2/' + name, worktree, base)
        log = SCRATCH / (name + '.jsonl')
        task_path = SCRATCH / (name + '-task.md')
        spec['worktree'] = worktree
        spec['task'] = task_path
        spec['journal'] = worktree / 'journal.txt'
        spec['log'] = log
        spec['launchFresh'] = [str(EXE), str(db), 'turn', name, name + '-turn-1', spec['bin'],
                               spec['model'], 'low', str(worktree), str(task_path), str(log), '']
        turns[name] = start_turn(spec['launchFresh'], SCRATCH / (name + '-fresh'))

    # Wait until each turn is mid-flight and keep the argv it actually ran with.
    for spec in specs:
        name = spec['name']

        def started(name=name):
            if turns[name].poll() is not None:
                raise RuntimeError(name + ' ended before fault injection; inspect fresh stdout/stderr')
            rows = coord(db, 'workers')
            row = [r for r in rows if r['id'] == name]
            if not row or not row[0].get('native'):
                return None
            if row[0].get('lastTurnEvent'):
                return None
            return descendants([turns[name].pid], process_table())

        spec['beforeKillProcesses'] = wait_for(started)
        spec['native'] = [r for r in coord(db, 'workers') if r['id'] == name][0]['native']
        spec['freshArgv'] = harness_argv(spec, turns[name])
        spec['generationLog'] = generation_log(db, name, name + '-turn-1')

    evidence['beforeKill'] = {spec['name']: {
        'launchFreshArgv': spec['launchFresh'],
        'harnessArgv': spec['freshArgv'],
        'native': spec['native'],
        'publicLogGeneration': str(spec['generationLog']),
        'processes': spec['beforeKillProcesses'],
        'journalExists': spec['journal'].exists(),
        'journal': spec['journal'].read_text() if spec['journal'].exists() else '',
        'sessionDir': session_dir_rows(db),
    } for spec in specs}

    # Kill every coordinator and harness process of this scratch run.
    killed = kill_all([child.pid for child in turns.values()])
    for child in turns.values():
        child.wait()
    evidence['killed'] = killed
    killed_pids = {row['pid'] for row in killed}
    evidence['coordinatorExitCodes'] = {name: child.returncode for name, child in turns.items()}
    required_pids = {child.pid for child in turns.values()}
    required_pids.update(record['pid'] for spec in specs for record in spec['freshArgv'])
    if not required_pids <= killed_pids or any(child.returncode != -signal.SIGKILL for child in turns.values()):
        raise RuntimeError('Fault injection did not kill every initial coordinator and harness')
    def killed_processes_absent():
        evidence['survivors'] = [(pid, command) for pid, _, command in process_table() if pid in killed_pids]
        return not evidence['survivors']
    wait_for(killed_processes_absent)
    for spec in specs:
        expected = ['line ' + word + ' from ' + spec['name'] for word in ['one', 'two', 'three']]
        if spec['journal'].exists() and spec['journal'].read_text().splitlines() == expected:
            failures.append('%s: the task was already finished before the kill' % spec['name'])

    # Request the previous conversation. OMP can refuse an unavailable
    # conversation and restart fresh with the pending task and workspace state.
    for spec in specs:
        name = spec['name']
        before = session_dir_rows(db)
        journal_before = spec['journal'].read_text() if spec['journal'].exists() else ''
        launch = [str(EXE), str(db), 'turn', name, name + '-turn-1', spec['bin'], spec['model'],
                  'low', str(spec['worktree']), str(spec['task']), str(spec['log']), spec['native']]
        selected_log = generation_log(db, name, name + '-turn-1')
        log_offset = selected_log.stat().st_size if selected_log.exists() else 0
        resumed_prefix = SCRATCH / (name + '-resumed')
        resumed = start_turn(launch, resumed_prefix)
        resumed.wait()
        # The wrapper records every launch, including OMP's fresh fallback.
        argv = harness_argv(spec, resumed)
        stdout = resumed_prefix.with_suffix('.stdout').read_text()
        stderr = resumed_prefix.with_suffix('.stderr').read_text()
        rows = coord(db, 'workers')
        row = [r for r in rows if r['id'] == name][0]
        text = spec['journal'].read_text() if spec['journal'].exists() else ''
        with selected_log.open('rb') as native_log:
            native_log.seek(log_offset)
            resumed_events = [json.loads(line) for line in native_log if line.strip()]
        with sqlite3.connect(f'{db.as_uri()}?mode=ro', uri=True) as connection:
            stored = connection.execute('SELECT event FROM turns WHERE id=?', (name + '-turn-1',)).fetchone()
        terminal = json.loads(stored[0]) if stored else None
        recovery_messages = [message for message in coord(db, 'inbox', 'root')
                             if message['sender'] == name and message['id'] == name + '-turn-1:recovery']
        entry = {
            'launchResumeArgv': launch,
            'harnessArgv': argv,
            'harnessLaunches': argv,
            'exitCode': resumed.returncode,
            'stdout': stdout,
            'stderr': stderr,
            'nativeBefore': spec['native'],
            'nativeAfter': row.get('native'),
            'turnEvent': row.get('lastTurnEvent'),
            'report': row.get('latestReport', ''),
            'terminal': terminal,
            'publicLogGeneration': str(selected_log),
            'resumedLogOffset': log_offset,
            'resumedNativeEvents': resumed_events,
            'recoveryRows': [message['id'] for message in recovery_messages],
            'recoveryMessages': recovery_messages,
            'journalBeforeRestart': journal_before,
            'journal': text,
            'sessionDirBefore': before,
            'sessionDirAfter': session_dir_rows(db),
        }
        evidence['sessions'][name] = entry
        if spec['harness'] == 'codex':
            resumed_arg = any(['exec', 'resume', spec['native']] == record['argv'][i:i + 3]
                              for record in argv for i in range(len(record['argv']) - 2))
        else:
            resumed_arg = any('--resume' in record['argv'] and
                              spec['native'] in record['argv'][record['argv'].index('--resume') + 1]
                              for record in argv)
        if not resumed_arg:
            failures.append('%s: the restarted harness argv carries no resume value' % name)
        if not row.get('native'):
            failures.append('%s: the session recorded no identity after the restart' % name)
        elif row['native'] != spec['native']:
            if spec['harness'] == 'codex':
                failures.append('%s: the restarted turn ran under another identity (%s -> %s)'
                                % (name, spec['native'], row['native']))
            elif not recovery_messages:
                failures.append('%s: the conversation changed with no recovery row' % name)
        expected_event = 'result' if spec['harness'] == 'codex' else 'agent_end'
        if row.get('lastTurnEvent') != expected_event:
            failures.append('%s: the turn did not reach a terminal event' % name)
        if resumed.returncode or not terminal or terminal.get('is_error'):
            failures.append('%s: resumed turn failed' % name)
        if spec['harness'] == 'codex' and (not terminal or terminal.get('nativeEvent', {}).get('type') != 'turn.completed'):
            failures.append('%s: Codex did not report native turn.completed' % name)
        if spec['harness'] == 'codex':
            resumed_ids = [event.get('thread_id') for event in resumed_events if event.get('type') == 'thread.started']
            if not resumed_ids or any(native_id != spec['native'] for native_id in resumed_ids):
                failures.append('%s: resumed native output did not confirm the recorded conversation' % name)
        expected = ['line ' + word + ' from ' + name for word in ['one', 'two', 'three']]
        if text.splitlines() != expected:
            failures.append('%s: journal must contain each of the three expected lines once, in order' % name)
        if not text.startswith(journal_before):
            failures.append('%s: restart did not preserve the journal written before process loss' % name)
        changed = run(['git', '-C', spec['worktree'], 'status', '--porcelain', '--untracked-files=all']).stdout.splitlines()
        entry['changedFiles'] = changed
        if changed != ['?? journal.txt']:
            failures.append('%s: unexpected worktree changes' % name)

    return 1 if failures else 0


if __name__ == '__main__':
    try:
        code = main()
    except Exception as error:
        EVIDENCE['error'] = repr(error)
        if isinstance(error, subprocess.CalledProcessError):
            EVIDENCE['commandFailure'] = {
                'argv': error.cmd,
                'returncode': error.returncode,
                'stdout': error.stdout,
                'stderr': error.stderr,
            }
        code = 1
    if EVIDENCE:
        known = set(OWNED_ROOTS)
        if OUTPUT_CREATED:
            for path in SCRATCH.glob('*-launches.jsonl'):
                known.update(json.loads(line)['pid'] for line in path.read_text().splitlines())
        EVIDENCE['remainingProcesses'] = descendants(known, process_table())
        if EVIDENCE['remainingProcesses']:
            EVIDENCE.setdefault('failures', []).append('owned processes remain after the probe')
            code = 1
        EVIDENCE['status'] = 'passed' if code == 0 else 'failed'
        serialized = json.dumps(EVIDENCE, indent=2, sort_keys=True) + '\n'
        if OUTPUT_CREATED:
            (SCRATCH / 'evidence.json').write_text(serialized)
        print(serialized, end='')
    sys.exit(code)
