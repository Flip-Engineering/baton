#!/usr/bin/env python3
"""Run a command in its own systemd user scope, keeping its PID and birth.

    service-run.py --role ROLE [--record DIRECTORY] -- COMMAND [ARGS...]

A long-lived command started from a login session or a build command stays in
the Linux cgroup of that session, so ending the session's scope ends it. This
helper asks the systemd user manager for a transient scope with
`systemd-run --user --scope`. systemd-run moves itself into the new scope and
then execs, so COMMAND runs as the same process: the PID, start time, process
group, inherited descriptors and the owner identity that a queue client records
about itself are unchanged. The scope sets no memory, runtime or task limit.

Placement does not isolate COMMAND from signals. Processes of one Unix user stay
within that user's signal authority, so a same-user kill reaches a placed
process. Lifecycle actions address a process by PID plus start time and by its
custody token. The records written to --record keep the identities (cgroup,
session, process group, parent) that let a later reader compare a caller
shutdown, an explicit cancellation, a provider exit and a runtime loss. They do
not decide which one happened.

BATON_SERVICE_PLACEMENT is auto (the default: place when the user manager
answers and record the reason otherwise), off, or require (exit 75 when
placement is not possible). BATON_SYSTEMD_RUN names the systemd-run program.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid

INSIDE = '--inside'
TEMPFAIL = 75


def mode():
    value = os.environ.get('BATON_SERVICE_PLACEMENT') or 'auto'
    if value not in ('auto', 'off', 'require'):
        raise SystemExit('service-run: BATON_SERVICE_PLACEMENT must be auto, off or require')
    return value


def systemd_run():
    named = os.environ.get('BATON_SYSTEMD_RUN')
    if named:
        return named
    for candidate in ('/usr/bin/systemd-run', '/bin/systemd-run'):
        if os.access(candidate, os.X_OK):
            return candidate
    return None


def unit_option(role, seed):
    digest = hashlib.sha256(seed.encode()).hexdigest()[:16]
    return 'baton-%s-%s-%d-%x' % (role, digest, os.getpid(), time.time_ns())


def probe(run):
    """Start and wait for one throwaway scope, so the answer reflects the user
    manager, its bus and the caller's permission."""
    true = '/usr/bin/true' if os.access('/usr/bin/true', os.X_OK) else '/bin/true'
    try:
        result = subprocess.run(
            [run, '--user', '--scope', '--quiet', '--collect',
             '--unit=baton-probe-%d-%x' % (os.getpid(), time.time_ns()), '--', true],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    except OSError as error:
        return False, 'systemd-run probe could not start: %s' % error.strerror
    if result.returncode == 0:
        return True, ''
    lines = result.stderr.decode(errors='replace').splitlines()
    return False, lines[0] if lines else 'systemd-run probe status %d' % result.returncode


def identity(pid):
    """Process identity as /proc reports it; absent fields are omitted."""
    record = {'pid': pid, 'uid': os.getuid()}
    try:
        raw = Path('/proc/%d/stat' % pid).read_text()
        tail = raw[raw.rfind(')') + 2:].split()
        record.update(starttime=tail[19], ppid=int(tail[1]), pgid=int(tail[2]),
                      sid=int(tail[3]), tty=int(tail[4]))
    except (OSError, IndexError, ValueError):
        pass
    try:
        record['cgroup'] = Path('/proc/%d/cgroup' % pid).read_text().strip().replace('\n', ';')
    except OSError:
        pass
    return record


def write_record(directory, name, value):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    temporary = directory / ('.%s.%s.tmp' % (name, uuid.uuid4().hex))
    with temporary.open('x') as stream:
        json.dump(value, stream, indent=2, sort_keys=True)
        stream.write('\n')
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, directory / name)


def plan(role, record, command):
    """Returns (argv, launch_record). argv is the command itself when it is not placed."""
    requested = mode()
    launch = {'schema': 'baton-service-launch-v1', 'role': role, 'requested': requested,
              'command': command[0], 'time_ns': time.time_ns(), 'launcher': identity(os.getpid())}
    if requested == 'off':
        launch.update(placement='none', reason='placement is off')
        return command, launch
    run = systemd_run()
    if run is None:
        ok, reason = False, 'systemd-run is not installed'
    else:
        ok, reason = probe(run)
    if not ok:
        launch.update(placement='none', reason=reason)
        if requested == 'require':
            return None, launch
        return command, launch
    unit = unit_option(role, record or command[0])
    launch.update(placement='scope', manager='systemd-user', unit=unit + '.scope')
    inside = [sys.executable, str(Path(__file__).resolve()), INSIDE, record or '', '--']
    return [run, '--user', '--scope', '--quiet', '--collect', '--unit=' + unit,
            '--description=Baton ' + role, '--', *inside, *command], launch


def execute(argv):
    try:
        os.execvp(argv[0], argv)
    except OSError as error:
        sys.stderr.write('service-run: cannot execute %s: %s\n' % (argv[0], error.strerror))
        return 127


def main(argv):
    if argv and argv[0] == INSIDE:
        # Stage two runs inside the scope: record where it landed, then become COMMAND.
        record, command = argv[1], argv[argv.index('--') + 1:]
        if record:
            write_record(record, 'service-inside.json', {
                'schema': 'baton-service-inside-v1', 'time_ns': time.time_ns(),
                'process': identity(os.getpid())})
        return execute(command)
    role, record, command = None, None, None
    arguments = list(argv)
    while arguments:
        head = arguments.pop(0)
        if head == '--role' and arguments:
            role = arguments.pop(0)
        elif head == '--record' and arguments:
            record = arguments.pop(0)
        elif head == '--':
            command = arguments
            break
        else:
            raise SystemExit('usage: service-run.py --role ROLE [--record DIRECTORY] -- COMMAND [ARGS...]')
    if not role or not command:
        raise SystemExit('usage: service-run.py --role ROLE [--record DIRECTORY] -- COMMAND [ARGS...]')
    argv_out, launch = plan(role, record, command)
    if record:
        write_record(record, 'service-launch.json', launch)
    if argv_out is None:
        sys.stderr.write('service-run: placement required but not possible: %s\n' % launch['reason'])
        return TEMPFAIL
    return execute(argv_out)


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
