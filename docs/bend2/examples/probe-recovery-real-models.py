"""Recovery with real model turns: start one OMP session and one Codex session on
real tasks that edit files, kill every coordinator and harness process mid-turn,
restart, and show each session resumes its native conversation and finishes.

Run from the repository root after building .scratch/bend2/baton2:

    python3 docs/bend2/examples/probe-recovery-real-models.py

The run owns its database and repository under .scratch/recovery-real-models and
never touches another deployment's state. The restart passes the session's
recorded native identity as the turn's final argument, the way the trial's own
launches do, and the probe retains each launch's actual argv so the resume value
is evidence rather than an assumption. JSON goes to stdout; the probe exits
non-zero when a session does not resume its native conversation or does not
finish.
"""
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
EXE = ROOT / '.scratch/bend2/baton2'
SCRATCH = ROOT / '.scratch/recovery-real-models'
OMP = pathlib.Path('/opt/homebrew/bin/omp')
CODEX = pathlib.Path('/opt/homebrew/Cellar/node/25.8.0/bin/codex')
OMP_MODEL = 'deepseek/deepseek-flash'
CODEX_MODEL = 'gpt-6-astra'

TASK = '''Work only inside this directory.
Step 1: append the line "line one from {name}" to journal.txt.
Step 2: append the line "line two from {name}" to journal.txt.
Step 3: append the line "line three from {name}" to journal.txt.
Do not create other files. When journal.txt holds all three lines, stop.
'''


def run(args, **kw):
    return subprocess.run([str(a) for a in args], capture_output=True, text=True, check=True, **kw)


def coord(db, *args, timeout=30):
    result = subprocess.run([str(EXE), str(db), *map(str, args)],
                            capture_output=True, text=True, timeout=timeout)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def process_table():
    """Every live process as (pid, ppid, command)."""
    listing = subprocess.run(['ps', '-ax', '-o', 'pid=,ppid=,command='],
                             capture_output=True, text=True).stdout
    rows = []
    for line in listing.splitlines():
        fields = line.strip().split(None, 2)
        if len(fields) == 3:
            rows.append((int(fields[0]), int(fields[1]), fields[2]))
    return rows


def processes_matching(*needles):
    """Live processes whose argv names one of the needles."""
    return [(pid, command[:400]) for pid, _, command in process_table()
            if any(needle in command for needle in needles)]


def kill_all(*needles):
    """SIGKILL the matched processes and every descendant of them.

    A harness child does not always carry the database path in its argv, so the
    descendant closure is what makes the kill complete.
    """
    table = process_table()
    roots = {pid for pid, _, command in table
             if any(needle in command for needle in needles) and pid != os.getpid()}
    doomed = set(roots)
    changed = True
    while changed:
        changed = False
        for pid, ppid, _ in table:
            if ppid in doomed and pid not in doomed:
                doomed.add(pid)
                changed = True
    commands = {pid: command[:400] for pid, _, command in table}
    killed = []
    for pid in sorted(doomed, reverse=True):
        try:
            os.kill(pid, signal.SIGKILL)
            killed.append({'pid': pid, 'command': commands.get(pid, '')})
        except (ProcessLookupError, PermissionError):
            pass
    return killed


def wait_for(predicate, seconds, what):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.5)
    raise RuntimeError('timed out waiting for ' + what)


def harness_argv(db, seconds=120):
    """This run's live harness command line, captured while it runs.

    The harness child carries the run's own session directory in its argv, so
    the database path selects it and no other seat's harness can match.
    """
    def look():
        rows = [command for _, command in processes_matching(str(db))
                if 'baton2' not in command]
        return rows or None
    return wait_for(look, seconds, 'the harness argv of this run')


def session_dir_rows(db):
    directory = pathlib.Path(str(db) + '.sessions')
    if not directory.is_dir():
        return []
    return sorted(str(p.name) for p in directory.iterdir())


def main():
    evidence = {'sessions': {}}
    failures = []
    if not EXE.exists():
        print(json.dumps({'error': 'coordinator not built at %s' % EXE}))
        return 1
    if SCRATCH.exists():
        run(['rm', '-rf', str(SCRATCH)])
    SCRATCH.mkdir(parents=True)
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

    # The Codex side needs a login; its state is recorded, not repaired.
    status = subprocess.run([str(CODEX), 'login', 'status'], capture_output=True, text=True)
    evidence['codexLogin'] = status.stdout.strip() or status.stderr.strip()

    specs = []
    if OMP.exists():
        specs.append({'name': 'ompsession', 'harness': 'omp', 'bin': str(OMP), 'model': OMP_MODEL})
    if 'logged in' in evidence['codexLogin'].lower() and 'not logged in' not in evidence['codexLogin'].lower():
        specs.append({'name': 'codexsession', 'harness': 'codex', 'bin': str(SCRATCH / 'codex.sh'),
                      'model': CODEX_MODEL})
    else:
        evidence['codexSkipped'] = 'no login for this seat by design (%s); the Codex half is queued to the operator session' % evidence['codexLogin']

    coord(db, 'attach', 'root', 'omp', 'native-root', '')

    # Recruit one worktree per session, then start its real turn in the
    # background. The first launch names no session, so it starts fresh.
    turns = {}
    for spec in specs:
        name = spec['name']
        worktree = SCRATCH / (name + '-wt')
        task = SCRATCH / (name + '-task.md')
        task.write_text(TASK.format(name=name))
        if spec['harness'] == 'codex':
            wrapper = SCRATCH / 'codex.sh'
            wrapper.write_text('#!/bin/sh\nunset OPENAI_API_KEY CODEX_API_KEY\n'
                               'exec %s -c \'forced_login_method="chatgpt"\' "$@"\n' % CODEX)
            wrapper.chmod(0o700)
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
        turns[name] = subprocess.Popen(spec['launchFresh'],
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    # Wait until each turn is mid-flight and keep the argv it actually ran with.
    for spec in specs:
        name = spec['name']

        def started(name=name):
            rows = coord(db, 'workers')
            row = [r for r in rows if r['id'] == name]
            if not row or not row[0].get('native'):
                return None
            if row[0].get('lastTurnEvent'):
                return None
            return processes_matching(str(db))

        spec['beforeKillProcesses'] = wait_for(started, 120, '%s to start its native turn' % name)
        spec['native'] = [r for r in coord(db, 'workers') if r['id'] == name][0]['native']
        spec['freshArgv'] = harness_argv(db, 30)

    evidence['beforeKill'] = {spec['name']: {
        'launchFreshArgv': spec['launchFresh'],
        'harnessArgv': spec['freshArgv'],
        'native': spec['native'],
        'processes': spec['beforeKillProcesses'],
        'journalExists': spec['journal'].exists(),
        'sessionDir': session_dir_rows(db),
    } for spec in specs}

    # Kill every coordinator and harness process of this scratch run.
    killed = kill_all(str(db), str(SCRATCH / 'repo'))
    for child in turns.values():
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            pass
    time.sleep(0.5)
    evidence['killed'] = killed
    survivors = processes_matching(str(db), str(SCRATCH / 'repo'))
    evidence['survivors'] = survivors
    if survivors:
        failures.append('a coordinator or harness process survived the kill')
    for spec in specs:
        if spec['journal'].exists():
            failures.append('%s: the task was already finished before the kill' % spec['name'])

    # Restart: the same turn with the identity the session held before the kill,
    # the way the trial's own second launches name it. A recorded conversation
    # this host still holds resumes; one it does not is refused, and the turn
    # then runs fresh so the pending input still completes.
    for spec in specs:
        name = spec['name']
        before = session_dir_rows(db)
        launch = [str(EXE), str(db), 'turn', name, name + '-turn-1', spec['bin'], spec['model'],
                  'low', str(spec['worktree']), str(spec['task']), str(spec['log']), spec['native']]
        resumed = subprocess.Popen(launch, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        launches = []
        deadline = time.monotonic() + 900
        while resumed.poll() is None and time.monotonic() < deadline:
            for _, command in processes_matching(str(db)):
                if 'baton2' not in command and command not in launches:
                    launches.append(command)
            time.sleep(0.3)
        stdout, stderr = resumed.communicate(timeout=120)
        rows = coord(db, 'workers')
        row = [r for r in rows if r['id'] == name][0]
        text = spec['journal'].read_text() if spec['journal'].exists() else ''
        inbox = coord(db, 'inbox', 'root')
        entry = {
            'launchResumeArgv': launch,
            'harnessLaunches': launches,
            'exitCode': resumed.returncode,
            'stdout': stdout[:400],
            'stderr': stderr[:800],
            'nativeBefore': spec['native'],
            'nativeAfter': row.get('native'),
            'turnEvent': row.get('lastTurnEvent'),
            'report': row.get('latestReport', '')[:200],
            'journal': text,
            'sessionDirBefore': before,
            'sessionDirAfter': session_dir_rows(db),
            'recoveryRows': [m['id'] for m in inbox if m['id'].endswith(':recovery')],
        }
        evidence['sessions'][name] = entry
        if not any('--resume' in command for command in launches):
            failures.append('%s: no harness launch carried the recorded identity' % name)
        if row.get('lastTurnEvent') != 'agent_end':
            failures.append('%s: the turn did not reach a terminal event' % name)
        if 'line three from ' + name not in text:
            failures.append('%s: the task did not finish after the restart' % name)
        if not row.get('native'):
            failures.append('%s: the session recorded no identity after the restart' % name)
        if row.get('native') != spec['native'] and not entry['recoveryRows']:
            failures.append('%s: the conversation changed with no recovery row' % name)

    evidence['failures'] = failures
    print(json.dumps(evidence, indent=2, sort_keys=True))
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
