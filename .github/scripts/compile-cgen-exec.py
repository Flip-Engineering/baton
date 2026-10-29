#!/usr/bin/env python3
"""Execute one queued compiler invocation for a staged C-generation attempt.

Execution-only module. The queue adapter submits this file as a queue input:
staging verifies its bytes against the key's input digest, and the executed
command names the staged copy. Every byte here is therefore part of the cache
key and of the executed closure. Keep diagnostics in queue-native-checks.py;
an edit to this file is an executed-semantics change and produces a new key.

The compiler keeps emitted units in a directory it reads from
BEND_CGEN_CACHE_DIR. This module chooses that directory and passes it to the
compiler explicitly; a value inherited from the job environment is ignored,
because any step of a job can set it.

A run whose GitHub record shows a dispatch or push of this repository, still in
progress and consistent with the job's own run id, attempt and commit, shares
<state root>/cgen-cache/trusted with other such runs. Every other run, and any run
whose record cannot be read, uses a directory private to the runner user under
<state root>/cgen-cache/untrusted. The decision and its reason are written to
cache-selection.json in the attempt directory.
"""
import json
import os
import signal
import stat
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

TRUSTED_EVENTS = ('workflow_dispatch', 'push')


def state_root(output):
    """The queue state root that owns this attempt: the directory that holds keys/."""
    for parent in Path(output).resolve().parents:
        if parent.name == 'keys' and (parent.parent / 'heavy.lock').exists():
            return parent.parent
    return None


def run_record(environment):
    """GitHub's record of the run this job belongs to, and why it could not be read."""
    repository, run_id, token = (environment.get(name) for name in ('GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_TOKEN'))
    if not (repository and run_id and token):
        return None, 'the job exposes no run identity or token'
    api = environment.get('GITHUB_API_URL', 'https://api.github.com')
    request = urllib.request.Request(
        '%s/repos/%s/actions/runs/%s' % (api, repository, run_id),
        headers={'Authorization': 'Bearer ' + token, 'Accept': 'application/vnd.github+json',
                 'X-GitHub-Api-Version': '2022-11-28'})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response), ''
    except Exception as error:
        return None, 'run lookup failed: ' + error.__class__.__name__


def trust(environment):
    """(trusted, reason, record). Trusted only when GitHub's record and the job agree."""
    record, why = run_record(environment)
    if record is None:
        return False, why, None
    repository = environment['GITHUB_REPOSITORY'].lower()
    head = (record.get('head_repository') or {}).get('full_name', '')
    base = (record.get('repository') or {}).get('full_name', '')
    expected = [
        (str(record.get('id')) == environment['GITHUB_RUN_ID'], 'the record is for another run'),
        (record.get('status') == 'in_progress', 'the run is not in progress'),
        (str(record.get('run_attempt')) == environment.get('GITHUB_RUN_ATTEMPT'), 'the run attempt differs'),
        (base.lower() == repository and head.lower() == repository, 'the run is for another repository or a fork'),
        (record.get('head_sha') == environment.get('GITHUB_SHA'), 'the job commit is not the run commit'),
        (environment.get('GITHUB_EVENT_NAME') == record.get('event'), 'the job names another event than the run record'),
        (record.get('event') in TRUSTED_EVENTS, 'the run event is ' + str(record.get('event'))),
    ]
    for holds, reason in expected:
        if not holds:
            return False, reason, record
    return True, 'dispatch or push of this repository', record


def make(path, mode):
    """Create the directory with exactly `mode`, whatever umask the job has."""
    previous = os.umask(~mode & 0o777)
    try:
        path.mkdir(mode=mode, parents=True, exist_ok=True)
    finally:
        os.umask(previous)
    return path.stat()


def shared_directory(state):
    """The trusted cache, accepted only while it carries the state root's group and setgid bit."""
    path = state / 'cgen-cache' / 'trusted'
    try:
        info, root = make(path, 0o770), state.stat()
    except OSError as error:
        return None, 'cannot create the shared cache: ' + error.__class__.__name__
    sound = (info.st_mode & stat.S_ISGID and info.st_gid == root.st_gid and (info.st_mode & 0o070) == 0o070)
    if not sound:
        return None, 'the shared cache does not inherit the state root group and setgid bit'
    return path, ''


def private_directory(state):
    path = state / 'cgen-cache' / 'untrusted' / str(os.getuid())
    try:
        info = make(path, 0o700)
    except OSError as error:
        return None, 'cannot create the private cache: ' + error.__class__.__name__
    if info.st_uid != os.getuid() or info.st_mode & 0o077:
        return None, 'the private cache is not private to this user'
    return path, ''


def select(output, environment):
    """(directory, selection) for this attempt."""
    inherited = environment.get('BEND_CGEN_CACHE_DIR')
    selection = {'schema': 'baton2-cgen-cache-selection-v1', 'inherited_cache_dir': inherited,
                 'inherited_xdg_cache_home': environment.get('XDG_CACHE_HOME'), 'uid': os.getuid(),
                 'decided_at': time.time(), 'trusted': False, 'reason': '', 'event': None}
    state = state_root(output)
    trusted, reason, record = trust(environment)
    selection.update(reason=reason, event=(record or {}).get('event'), run_id=environment.get('GITHUB_RUN_ID'),
                     run_attempt=environment.get('GITHUB_RUN_ATTEMPT'), repository=environment.get('GITHUB_REPOSITORY'),
                     commit=(record or {}).get('head_sha'))
    if state is None:
        directory = Path(output).resolve().parent / 'cgen-cache'
        selection.update(reason='the attempt is not inside a queue state root; ' + reason, kind='attempt')
    else:
        directory, problem = (shared_directory(state) if trusted else (None, ''))
        if directory is not None:
            selection.update(trusted=True, kind='shared')
        else:
            if problem:
                selection['reason'] = problem
            directory, problem = private_directory(state)
            if directory is None:
                directory = Path(output).resolve().parent / 'cgen-cache'
                selection.update(reason=selection['reason'] + '; ' + problem, kind='attempt')
            else:
                selection['kind'] = 'private'
    directory.mkdir(parents=True, exist_ok=True)
    info = directory.stat()
    selection.update(directory=str(directory), mode=oct(stat.S_IMODE(info.st_mode)), setgid=bool(info.st_mode & stat.S_ISGID),
                     owner=info.st_uid, group=info.st_gid, inode=info.st_ino)
    return directory, selection


def main():
    output, *command = sys.argv[1:]
    environment = dict(os.environ)
    directory, selection = select(output, environment)
    environment['BEND_CGEN_CACHE_DIR'] = str(directory)
    try:
        (Path(output).resolve().parent.parent / 'cache-selection.json').write_text(json.dumps(selection, indent=2) + '\n')
    except OSError:
        # Evidence only; the compiler must still run.
        pass
    code = subprocess.run(command, env=environment).returncode
    if code < 0:
        # OOM #1068 killed the compiler with SIGKILL. Preserve its signal
        # disposition when the queue observes this process.
        signum = -code
        if signum not in (signal.SIGKILL, signal.SIGSTOP):
            signal.signal(signum, signal.SIG_DFL)
        os.kill(os.getpid(), signum)
        return 128 + signum
    if not code and '-o' not in command:
        Path(output).write_text('/* Compiler check completed successfully. */\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())
