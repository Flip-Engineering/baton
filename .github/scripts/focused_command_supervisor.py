#!/usr/bin/env python3
"""Own one command on Linux and reap its descendants in this PID namespace.

This supervisor requires PR_SET_CHILD_SUBREAPER plus pidfd support. It signals
the original process group while its leader identity is live, and addresses
adopted descendants through verified pidfds. Processes placed in a different
PID namespace or made inaccessible by privilege changes are outside this
supervisor's visibility and are not claimed as covered.
"""
import ctypes
import json
import os
import pathlib
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
POLL_SECONDS = 0.05
TERM_GRACE_SECONDS = 5.0


def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def process_identity(pid):
    """Return procfs identity fields while the process still has this PID."""
    try:
        text = pathlib.Path(f'/proc/{pid}/stat').read_text()
    except (FileNotFoundError, ProcessLookupError, PermissionError):
        return None
    close = text.rfind(')')
    if close < 0:
        return None
    fields = text[close + 2:].split()
    try:
        return {'pid': pid, 'state': fields[0], 'ppid': int(fields[1]),
                'starttime': fields[19]}
    except (IndexError, ValueError):
        return None


def require_linux_process_control():
    if sys.platform != 'linux':
        raise RuntimeError('focused command supervision requires Linux')
    if not hasattr(os, 'pidfd_open') or not hasattr(signal, 'pidfd_send_signal'):
        raise RuntimeError('focused command supervision requires pidfd support')


def set_child_subreaper():
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def set_child_subreaper_enabled(enabled):
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, int(enabled), 0, 0, 0) != 0:
        error = ctypes.get_errno()
        raise OSError(error, os.strerror(error))


def open_verified_pidfd(pid, expected_parent=None, expected_starttime=None):
    before = process_identity(pid)
    if before is None:
        raise ProcessLookupError(pid)
    if expected_parent is not None and before['ppid'] != expected_parent:
        raise RuntimeError(f'PID {pid} is not owned by supervisor {expected_parent}')
    if expected_starttime is not None and before['starttime'] != expected_starttime:
        raise RuntimeError(f'PID {pid} start time changed before pidfd open')
    pidfd = os.pidfd_open(pid)
    after = process_identity(pid)
    if (after is None or after['starttime'] != before['starttime']
            or (expected_parent is not None and after['ppid'] != expected_parent)):
        os.close(pidfd)
        raise ProcessLookupError(f'PID {pid} changed identity while opening pidfd')
    return pidfd, after


def signal_pidfd(pidfd, signum):
    try:
        signal.pidfd_send_signal(pidfd, signum)
        return True
    except ProcessLookupError:
        return False


def process_group_exists(pgid):
    try:
        os.killpg(pgid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def direct_children(supervisor_pid):
    found = []
    try:
        entries = pathlib.Path('/proc').iterdir()
    except OSError:
        return found
    for entry in entries:
        if not entry.name.isdecimal():
            continue
        identity = process_identity(int(entry.name))
        if identity is not None and identity['ppid'] == supervisor_pid:
            try:
                identity['pgid'] = os.getpgid(identity['pid'])
            except ProcessLookupError:
                continue
            found.append(identity)
    return found


def reap_exited_children(supervisor_pid, excluded_pid, observed):
    for child in direct_children(supervisor_pid):
        pid = child['pid']
        if pid == excluded_pid or child['state'] != 'Z':
            continue
        try:
            waited, _ = os.waitpid(pid, os.WNOHANG)
        except ChildProcessError:
            waited = pid
        record = observed.setdefault((pid, child['starttime']), {
            'pid': pid, 'starttime': child['starttime'], 'pgid': child['pgid'],
            'term_sent': False, 'kill_sent': False, 'reaped': False})
        if waited == pid:
            record['reaped'] = True


def signal_owned_child(child, supervisor_pid, signum):
    pidfd = None
    try:
        pidfd, identity = open_verified_pidfd(
            child['pid'], expected_parent=supervisor_pid,
            expected_starttime=child['starttime'])
        if identity['state'] == 'Z':
            return False
        return signal_pidfd(pidfd, signum)
    except ProcessLookupError:
        return False
    finally:
        if pidfd is not None:
            os.close(pidfd)


def key_value_file(path):
    try:
        rows = pathlib.Path(path).read_text().splitlines()
    except OSError:
        return None
    values = {}
    for row in rows:
        if '=' in row:
            key, value = row.split('=', 1)
            values[key] = value
    return values


def live_queue_owners(record):
    owners = {}
    owner_dir = pathlib.Path(record['keydir']) / 'owners'
    try:
        entries = list(owner_dir.iterdir())
    except OSError:
        return owners
    for path in entries:
        if not path.is_file():
            continue
        data = key_value_file(path)
        if not data or not data.get('pid') or not data.get('starttime'):
            continue
        try:
            pid = int(data['pid'])
        except ValueError:
            continue
        identity = process_identity(pid)
        if (identity is not None and identity['state'] != 'Z'
                and identity['starttime'] == data['starttime']):
            owners[path.name] = identity
    return owners


def queue_supervisor_custody(pid, starttime, handoff_dir):
    """Match a submitted queue attempt to its live key and owner state."""
    if handoff_dir is None:
        return None
    try:
        command = pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
        command = [os.fsdecode(item) for item in command if item]
        executable = str(pathlib.Path(f'/proc/{pid}/exe').resolve(strict=True))
    except OSError:
        return None
    identity = process_identity(pid)
    if identity is None or identity['starttime'] != starttime:
        return None
    # P.argv passes the queue's user arguments after the `--` separator:
    # [client, '--', '__supervise', attempt]. Match that exact maintained form.
    if len(command) != 4 or command[1] != '--' or command[2] != '__supervise':
        return None
    try:
        attempt = pathlib.Path(command[3]).resolve(strict=True)
    except OSError:
        return None
    try:
        handoffs = list(pathlib.Path(handoff_dir).glob('*.json'))
    except OSError:
        return None
    for path in handoffs:
        try:
            record = json.loads(path.read_text())
        except (OSError, json.JSONDecodeError):
            continue
        if record.get('schema') != 'baton2-focused-queue-owner-v1':
            continue
        try:
            client = str(pathlib.Path(record['client']).resolve(strict=True))
            state = str(pathlib.Path(record['state_root']).resolve(strict=True))
            keydir = str(pathlib.Path(record['keydir']).resolve(strict=True))
            request = json.loads(pathlib.Path(record['request_path']).read_text())
        except (KeyError, OSError):
            continue
        except json.JSONDecodeError:
            continue
        if executable != client or str(pathlib.Path(command[0]).resolve()) != client:
            continue
        request_argv = request.get('argv')
        if (request.get('key') != record.get('key')
                or request.get('token') != record.get('token')
                or not isinstance(request_argv, list)
                or not request_argv
                or str(pathlib.Path(request_argv[0]).resolve()) != client):
            continue
        if not any(request_argv[index] == '--token'
                   and index + 1 < len(request_argv)
                   and request_argv[index + 1] == record.get('token')
                   for index in range(len(request_argv))):
            continue
        if not any(request_argv[index] == '--state-root'
                   and index + 1 < len(request_argv)
                   and str(pathlib.Path(request_argv[index + 1]).resolve()) == state
                   for index in range(len(request_argv))):
            continue
        meta = key_value_file(attempt / 'meta')
        if not meta:
            continue
        expected_keydir = str(pathlib.Path(state) / 'keys' / record.get('key', ''))
        if (meta.get('attempt') != str(attempt)
                or meta.get('state_root') != state
                or meta.get('keydir') != keydir
                or meta.get('key') != record.get('key')
                or keydir != expected_keydir
                or attempt.parent.parent != pathlib.Path(keydir)):
            continue
        active = key_value_file(pathlib.Path(keydir) / 'active')
        if active and active.get('pid'):
            if active.get('pid') != str(pid) or active.get('starttime') != starttime:
                continue
        owners = live_queue_owners(record)
        owner_dir = pathlib.Path(keydir) / 'owners'
        try:
            registered_tokens = {owner.name for owner in owner_dir.iterdir() if owner.is_file()}
        except OSError:
            registered_tokens = set()
        token = record.get('token')
        other_live = sorted(name for name in owners if name != token)
        requester_registered = token in registered_tokens
        status = record.get('status')
        if not requester_registered and not other_live:
            if status == 'finished':
                continue
        return {'pid': pid, 'starttime': starttime, 'key': record.get('key'),
                'token': token, 'status': status,
                'requester_owner_live': token in owners,
                'requester_token_registered': requester_registered,
                'other_live_owners': other_live,
                'owner_count': len(owners), 'attempt': str(attempt),
                'keydir': keydir, 'client': client,
                'cancel_result': record.get('cancel_result', [])}
    return None


def cleanup_owned_tree(process, process_pidfd, process_starttime, evidence, reason,
                       queue_handoff_dir=None, initial_signal=signal.SIGTERM):
    """Terminate the command group and adopted setsid descendants, then reap them."""
    supervisor_pid = os.getpid()
    pgid = process.pid
    observed = {}
    queue_handoffs = {}
    term_sent = False
    kill_sent = False
    started = time.monotonic()
    deadline = started + TERM_GRACE_SECONDS
    leader_identity = process_identity(process.pid)
    if leader_identity is not None and leader_identity['starttime'] != process_starttime:
        raise RuntimeError('owned command process identity changed before cleanup')
    # The command may already have exited and been reaped by poll(). Its held
    # pidfd still identifies that process; remaining members of its original
    # process group keep the PGID allocated while they exist.
    group_signal_verified = leader_identity is not None
    if group_signal_verified:
        try:
            os.killpg(pgid, initial_signal)
            term_sent = True
        except ProcessLookupError:
            pass
    while True:
        process.poll()
        current = direct_children(supervisor_pid)
        for child in current:
            if child['pid'] == process.pid:
                continue
            identity_key = (child['pid'], child['starttime'])
            record = observed.setdefault(identity_key, {
                'pid': child['pid'], 'starttime': child['starttime'],
                'pgid': child['pgid'], 'term_sent': False,
                'kill_sent': False, 'reaped': False})
            record['pgid'] = child['pgid']
            queue_custody = queue_supervisor_custody(
                child['pid'], child['starttime'], queue_handoff_dir)
            if queue_custody is not None:
                queue_handoffs[identity_key] = queue_custody
                record['queue_custody'] = True
                record['queue_key'] = queue_custody['key']
                record['queue_token'] = queue_custody['token']
                record['queue_custody_state'] = (
                    'requester-token-registered' if queue_custody['requester_token_registered']
                    else 'other-live-requesters' if queue_custody['other_live_owners']
                    else 'queue-cancel-returned-no-live-owner'
                    if queue_custody['status'] == 'cancelled'
                    else 'queue-cancel-pending')
                record['queue_cancel_result'] = queue_custody['cancel_result']
                continue
            queue_handoffs.pop(identity_key, None)
            if not record['term_sent'] and (child['pgid'] != pgid or not group_signal_verified):
                record['term_sent'] = signal_owned_child(child, supervisor_pid, signal.SIGTERM)
            if time.monotonic() >= deadline and not record['kill_sent']:
                record['kill_sent'] = signal_owned_child(child, supervisor_pid, signal.SIGKILL)
        reap_exited_children(supervisor_pid, process.pid, observed)
        group_alive = process_group_exists(pgid)
        current = direct_children(supervisor_pid)
        live_children = [child for child in current
                         if child['pid'] != process.pid and child['state'] != 'Z'
                         and (child['pid'], child['starttime']) not in queue_handoffs]
        zombies = [child for child in current
                   if child['pid'] != process.pid and child['state'] == 'Z']
        reap_exited_children(supervisor_pid, process.pid, observed)
        if not group_alive and not live_children and not zombies:
            break
        if time.monotonic() >= deadline and not kill_sent and group_signal_verified:
            leader_identity = process_identity(process.pid)
            if leader_identity is not None and leader_identity['starttime'] == process_starttime:
                try:
                    os.killpg(pgid, signal.SIGKILL)
                    kill_sent = True
                except ProcessLookupError:
                    pass
        time.sleep(POLL_SECONDS)
    code = process.wait()
    current = direct_children(supervisor_pid)
    live_queue_handoffs = [handoff for key, handoff in queue_handoffs.items()
                           if any((child['pid'], child['starttime']) == key
                                  and child['state'] != 'Z' for child in current)]
    if live_queue_handoffs:
        # The queue handoff record, attempt metadata and live owner files now
        # establish custody outside this focused command. Let that process be
        # reparented when this one-command supervisor exits.
        set_child_subreaper_enabled(False)
    record = {
        'schema': 'baton2-focused-command-cleanup-v1',
        'reason': reason,
        'supervisor': {'pid': supervisor_pid},
        'command': {'pid': process.pid, 'starttime': process_starttime, 'pgid': pgid},
        'initial_signal': initial_signal,
        'term_sent_to_group': term_sent,
        'kill_sent_to_group': kill_sent,
        'group_exists': process_group_exists(pgid),
        'command_exit_code': code,
        'elapsed_seconds': time.monotonic() - started,
        'descendants': list(observed.values()),
        'live_adopted_children': [child['pid'] for child in current
                                  if child['pid'] != process.pid and child['state'] != 'Z'
                                  and (child['pid'], child['starttime']) not in queue_handoffs],
        'queue_custody_handoffs': live_queue_handoffs,
    }
    if record['group_exists'] or record['live_adopted_children']:
        raise RuntimeError('owned process tree remains after cleanup')
    return record


def run_command(result_path, cwd, argv, queue_handoff_dir=None):
    require_linux_process_control()
    set_child_subreaper()
    pending = []

    def request_cleanup(signum, frame):
        if not pending:
            pending.append(signum)

    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
        signal.signal(signum, request_cleanup)
    if pending:
        raise SystemExit(128 + pending[0])
    process = subprocess.Popen(argv, cwd=cwd, start_new_session=True)
    process_pidfd, process_identity_row = open_verified_pidfd(
        process.pid, expected_parent=os.getpid())
    process_starttime = process_identity_row['starttime']
    try:
        while True:
            if pending:
                cleanup = cleanup_owned_tree(
                    process, process_pidfd, process_starttime, result_path,
                    'cancellation', queue_handoff_dir, pending[0])
                write_json(result_path, {
                    'schema': 'baton2-focused-command-supervisor-v1',
                    'command': argv, 'cwd': str(cwd), 'cancelled_signal': pending[0],
                    'cleanup': cleanup})
                signum = pending[0]
                if signum not in (signal.SIGKILL, signal.SIGSTOP):
                    signal.signal(signum, signal.SIG_DFL)
                os.kill(os.getpid(), signum)
                return 128 + signum
            code = process.poll()
            if code is not None:
                leftovers = [child for child in direct_children(os.getpid())
                             if child['pid'] != process.pid]
                if leftovers or process_group_exists(process.pid):
                    cleanup = cleanup_owned_tree(
                        process, process_pidfd, process_starttime, result_path,
                        'command-exited-with-descendants', queue_handoff_dir)
                else:
                    cleanup = {
                        'schema': 'baton2-focused-command-cleanup-v1',
                        'reason': 'command-exited-clean',
                        'supervisor': {'pid': os.getpid()},
                        'command': {'pid': process.pid, 'starttime': process_starttime,
                                    'pgid': process.pid},
                        'term_sent_to_group': False, 'kill_sent_to_group': False,
                        'group_exists': False, 'command_exit_code': code,
                        'elapsed_seconds': 0.0, 'descendants': [],
                        'live_adopted_children': [],
                    }
                result = {'schema': 'baton2-focused-command-supervisor-v1',
                          'command': argv, 'cwd': str(cwd), 'exit_code': code,
                          'cleanup': cleanup}
                write_json(result_path, result)
                if code < 0:
                    signum = -code
                    if signum not in (signal.SIGKILL, signal.SIGSTOP):
                        signal.signal(signum, signal.SIG_DFL)
                    os.kill(os.getpid(), signum)
                    return 128 + signum
                return code
            time.sleep(POLL_SECONDS)
    finally:
        os.close(process_pidfd)


def main(argv):
    try:
        separator = argv.index('--')
    except ValueError:
        raise SystemExit('focused-command-supervisor requires -- before the command')
    prefix = argv[:separator]
    if len(prefix) not in (4, 6) or prefix[0] != '--result' or prefix[2] != '--cwd':
        raise SystemExit('usage: focused-command-supervisor --result PATH --cwd DIR [--queue-handoff-dir DIR] -- COMMAND...')
    if len(prefix) == 6:
        if prefix[4] != '--queue-handoff-dir':
            raise SystemExit('unknown focused-command-supervisor option')
        queue_handoff_dir = prefix[5]
    else:
        queue_handoff_dir = None
    return run_command(prefix[1], prefix[3], argv[separator + 1:], queue_handoff_dir)


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
