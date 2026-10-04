"""Prove process-loss recovery with a real run: kill the coordinator process and
its harness children, start fresh, and read back every session's worktree,
branch and one native turn. The host, its filesystem and its storage stay up,
so this does not measure power-loss durability.

Run from the repository root after building .scratch/bend2/baton2:

    python3 docs/bend2/examples/probe-host-restart.py

The run is a real one: real coordinator invocations over one database, real Git
worktrees on real branches, real native harness processes, and a SIGKILL of the
supervisors and their children. JSON reports the observations, and the probe
exits non-zero when a session's worktree, branch or single native turn does not
come back.
"""
import importlib
import json
import os
import pathlib
import select
import signal
import sqlite3
import subprocess
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
receive = importlib.import_module('bend2.test.receive')

NAMES = ['lead', 'worker']


def git(*args, cwd):
    return subprocess.run(['git', '-C', str(cwd), *args], capture_output=True,
                          text=True, check=True).stdout.strip()


def note(message):
    print(message, file=sys.stderr, flush=True)

def message_rows(fixture):
    with sqlite3.connect(fixture.db) as database:
        database.row_factory = sqlite3.Row
        return [dict(row) for row in database.execute(
            'SELECT seq,id,sender,recipient,kind,body,receipt FROM messages ORDER BY seq')]

def report_pid(fixture):
    """The fixture reports its own PID so the probe can kill each harness child.

    The same source edit is what the supervisor-loss probe uses.
    """
    source = fixture.fixture.read_text()
    source = source.replace('import json,pathlib,re,socket,subprocess,sys',
                            'import json,pathlib,re,socket,subprocess,sys,os')
    source = source.replace("reply({'session':model,",
                            "reply({'pid':os.getpid(),'session':model,")
    fixture.fixture.write_text(source)


def kill(pid):
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def alive(pid):
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def owned_processes(directory):
    """Read live processes whose arguments name this probe's unique directory."""
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                            capture_output=True, text=True, check=True)
    rows = []
    for line in result.stdout.splitlines():
        fields = line.strip().split(None, 3)
        if len(fields) == 4 and str(directory) in fields[3] and not fields[2].startswith('Z'):
            rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                         'status': fields[2], 'command': fields[3]})
    return rows


def kill_owned(directory):
    """Stop owned processes before killing them so none can launch recovery."""
    captured = {}
    try:
        while True:
            rows = owned_processes(directory)
            captured.update((row['pid'], row) for row in rows)
            if all(row['status'].startswith('T') for row in rows):
                break
            for row in rows:
                try:
                    os.kill(row['pid'], signal.SIGSTOP)
                except ProcessLookupError:
                    pass
    finally:
        for pid in captured:
            kill(pid)
    while owned_processes(directory):
        time.sleep(.01)
    return list(captured.values())


def accept_any(fixture, producer=None):
    """Read a startup frame, preserving live owned continuations while waiting."""
    while True:
        if select.select([fixture.server], [], [], 1)[0]:
            connection, _ = fixture.server.accept()
            stream = connection.makefile('rwb', buffering=0)
            fixture.controls.append((stream, connection))
            line = stream.readline()
            if not line:
                raise RuntimeError('Native startup connection closed before its frame')
            return stream, json.loads(line)
        if producer is None:
            return None
        if producer.poll() is not None and not owned_processes(fixture.directory):
            raise RuntimeError(f'Receive producer {producer.pid} exited {producer.returncode} without a native startup frame')


def main():
    fixture = receive.Receive()
    evidence = {'started': [], 'sessions': {}}
    failures = []
    try:
        fixture.setUp()
        report_pid(fixture)
        directory = fixture.directory

        # A real repository with a real base commit, and one worktree per session.
        repo = fixture.repo
        base = fixture.base

        parent = 'root'
        for name in NAMES:
            fixture.coord('recruit', name, parent, 'codex', name, 'low', repo,
                          'bend2/' + name, directory / (name + '-wt'), base)
            parent = name

        # Input that must survive: one message per session, queued before any
        # endpoint is connected, so posting does not start a native turn.
        for name in NAMES:
            fixture.message('pending-' + name, name, 'work after process loss')
        for name in NAMES:
            fixture.coord('connect', name, 'native-' + name, fixture.endpoint(name))

        # Real native turns: each supervisor starts one fixture child, which holds
        # its session open until this probe releases it.
        controls = {}
        for name in NAMES:
            child = fixture.spawn(*fixture.receive_args(name))
            stream, started = accept_any(fixture, child)
            if started['session'] != name:
                raise RuntimeError('%s: unexpected initial session %s' % (name, started['session']))
            controls[name] = stream
            evidence['started'].append({
                'session': name, 'supervisor': child.pid, 'native': started['pid'],
                'resume': started['resume'],
                'promptHasPending': '[id: pending-%s]' % name in started['prompt'],
            })

        evidence['beforeKill'] = {
            'processes': owned_processes(directory),
            'status': fixture.coord('status'),
            'worktrees': git('worktree', 'list', '--porcelain', cwd=repo).splitlines(),
            'branches': {n: git('rev-parse', 'bend2/' + n, cwd=repo) for n in NAMES},
            'inbox': {n: fixture.coord('inbox', n) for n in NAMES},
            'messages': message_rows(fixture),
        }

        # Include retained process owners and their replacement observers.
        evidence['killedProcesses'] = kill_owned(directory)
        for child in list(fixture.children):
            child.communicate()
        evidence['afterKill'] = {
            'ownedProcesses': owned_processes(directory),
            'supervisorsAlive': [e['supervisor'] for e in evidence['started'] if alive(e['supervisor'])],
            'nativesAlive': [e['native'] for e in evidence['started'] if alive(e['native'])],
            'worktrees': git('worktree', 'list', '--porcelain', cwd=repo).splitlines(),
            'branches': {n: git('rev-parse', 'bend2/' + n, cwd=repo) for n in NAMES},
        }
        if evidence['afterKill']['supervisorsAlive'] or evidence['afterKill']['nativesAlive']:
            failures.append('a process survived the SIGKILL')

        # Fresh coordinator processes, same database.
        evidence['afterRestart'] = {
            'status': fixture.coord('status'),
            'workers': fixture.coord('workers'),
            'worktree': {n: fixture.coord('worktree', n) for n in NAMES},
            'turns': {n: fixture.coord('turns', n) for n in NAMES},
            'inbox': {n: fixture.coord('inbox', n) for n in NAMES},
        }

        # Every session's worktree and branch are back.
        listed = git('worktree', 'list', '--porcelain', cwd=repo)
        for name in NAMES:
            worktree = directory / (name + '-wt')
            recovered = {
                'pathExists': worktree.is_dir(),
                'registered': 'worktree %s' % worktree in listed,
                'branchTip': git('rev-parse', 'bend2/' + name, cwd=repo),
                'reported': evidence['afterRestart']['worktree'][name],
            }
            evidence['sessions'].setdefault(name, {})['recovered'] = recovered
            if not recovered['pathExists'] or not recovered['registered']:
                failures.append('%s: worktree not recovered' % name)
            if recovered['branchTip'] != base:
                failures.append('%s: branch tip moved' % name)
            if recovered['reported'].get('commit') != base:
                failures.append('%s: coordinator reports another commit' % name)

        # After the restart each session's first native turn resumes its stored
        # identity and carries the input that was pending when the host died. A
        # second invocation while that turn runs is told queued, and no second
        # native for the session is ever admitted while the first is alive.
        starts = {name: [] for name in NAMES}
        controls = {}
        recovery_receives = []

        for name in NAMES:
            note('resume ' + name)
            producer = fixture.spawn(*fixture.receive_args(name))
            recovery_receives.append((name, producer))
            resumed = accept_any(fixture, producer)
            stream, started = resumed
            if started['session'] != name:
                raise RuntimeError('%s: unexpected resumed session %s' % (name, started['session']))
            starts[name].append(started)
            controls[name] = stream
            entry = evidence['sessions'][name]
            entry['restartNative'] = started['pid']
            entry['restartResume'] = started['resume']
            entry['restartPromptHasPending'] = '[id: pending-%s]' % name in started['prompt']
            entry['secondInvocation'] = fixture.coord(*fixture.receive_args(name))
            fixture.assert_no_start()

        # Release every resumed turn, then drain whatever the supervisors start
        # before they exit, recording each start by session.
        for name in NAMES:
            if name in controls:
                fixture.action(controls[name])
        while owned_processes(directory):
            got = accept_any(fixture)
            if got is None:
                continue
            stream, started = got
            starts.setdefault(started['session'], []).append(started)
            fixture.action(stream)
        for child in fixture.children:
            child.communicate()
        evidence['afterCompletion'] = {
            'ownedProcesses': owned_processes(directory),
            'recoveryReceives': [{'session': name, 'pid': child.pid, 'exit': child.returncode}
                                 for name, child in recovery_receives],
            'messages': message_rows(fixture),
        }

        for name in NAMES:
            entry = evidence['sessions'][name]
            entry['starts'] = [{'pid': row['pid'], 'resume': row['resume'],
                                'promptHasPending': '[id: pending-%s]' % name in row['prompt'],
                                'prompt': row['prompt']}
                               for row in starts.get(name, [])]
            entry['inboxAfter'] = fixture.coord('inbox', name)
            entry['turnsAfter'] = fixture.coord('turns', name)
            if not entry.get('restartPromptHasPending'):
                failures.append('%s: pending input was not resumed' % name)
            if entry.get('secondInvocation', {}).get('status') != 'queued':
                failures.append('%s: a second native turn was admitted' % name)
            if entry.get('restartResume') != 'native-' + name:
                failures.append('%s: resumed another identity: %s' % (name, entry.get('restartResume')))
            if entry['inboxAfter']:
                failures.append('%s: input stayed pending after the turn' % name)

        evidence['startsPerSession'] = {name: len(starts.get(name, [])) for name in NAMES}
        evidence['startsBySession'] = {name: starts.get(name, []) and
                                      [row['session'] for row in starts.get(name, [])]
                                      for name in NAMES}


        evidence['source'] = git('rev-parse', 'HEAD', cwd=ROOT)
        evidence['failures'] = failures
        print(json.dumps(evidence, indent=2, sort_keys=True))
        return 1 if failures else 0
    finally:
        try:
            if hasattr(fixture, 'directory'):
                kill_owned(fixture.directory)
        finally:
            fixture.doCleanups()


if __name__ == '__main__':
    sys.exit(main())
