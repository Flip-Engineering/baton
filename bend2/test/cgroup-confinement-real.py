"""Real delegated cgroup lifetime qualification for the keeper native spawn.

This script must run inside the root-provided unit. It refuses with exit status
77 unless the process is inside a writable, bounded delegated cgroup; a
refusal is not a pass.

Root scope request:
  systemd-run --unit=baton-env931-cgroup-real-<unique> --collect --wait \
    -p Type=exec -p User=batonci -p Group=batonci \
    -p Delegate=yes -p DelegateSubgroup=baton \
    -p MemoryMax=16G -p MemorySwapMax=0 -p TasksMax=infinity \
    -p RuntimeMaxSec=600 -p WorkingDirectory=<candidate-worktree> \
    -E HOME=<baton home> -E TMPDIR=<scratch> \
    -- python3 bend2/test/cgroup-confinement-real.py

The test uses the existing keeper path: process-test retain calls
Custody.Instance.admit and the database owner's br_keeper_spawn. The native
forks a persistent descendant. Assertions: native and descendant are in the
same per-native cgroup under the delegated unit, the effective nearest finite
memory.max is 17179869184 and memory.swap.max is 0, native.cgroup evidence
names that child and bound, and a sibling attempt's keeper/native cgroup and
process identity are unchanged. Live PID 1248282, the live examples and
session-6448.scope limits/procs are recorded read-only before and after. The
live session scope is never used as the fixture.
"""
import hashlib
import json
import os
import pathlib
import shutil
import signal
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/process-test'
NATIVE = ROOT / '.scratch/bend2/cgroup-confinement'
REQUIRED_MEMORY = 17179869184
LIVE_PIDS = (1248282, 1730231, 1772845)
LIVE_SCOPE = '/user.slice/user-1000.slice/session-6448.scope'


def blocked(cause):
    print(json.dumps({'status': 'blocked', 'cause': cause}, sort_keys=True))
    raise SystemExit(77)


def read_text(path):
    try:
        return pathlib.Path(path).read_text()
    except OSError:
        return None


def read_bytes(path):
    try:
        return pathlib.Path(path).read_bytes()
    except OSError:
        return None


def digest(value):
    return hashlib.sha256(value or b'').hexdigest()


def proc_cgroup(pid):
    value = read_text(f'/proc/{pid}/cgroup')
    return value.strip() if value is not None else None


def proc_identity(pid):
    value = read_text(f'/proc/{pid}/stat')
    if value is None:
        return None
    closing = value.rfind(')')
    opening = value.find('(')
    if closing < 0 or opening < 0:
        return None
    fields = value[closing + 2:].split()
    if len(fields) < 20:
        return None
    return {'pid': pid, 'comm': value[opening + 1:closing], 'state': fields[0],
            'ppid': int(fields[1]), 'pgrp': int(fields[2]),
            'session': int(fields[3]), 'starttime': fields[19]}


def proc_cmdline(pid):
    return read_bytes(f'/proc/{pid}/cmdline')


def wait_for(predicate, description, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(0.02)
    raise AssertionError(f'timed out waiting for {description}')


def own_cgroup():
    value = read_text('/proc/self/cgroup')
    if value is None:
        return None
    for line in value.splitlines():
        if line.startswith('0::/'):
            return line[3:]
    return None


def cgroup_value(path, name):
    value = read_text(pathlib.Path('/sys/fs/cgroup') / path.lstrip('/') / name)
    return value.strip() if value is not None else None


def cgroup_limits(path):
    memory = None
    swap = None
    current = path
    while True:
        value = cgroup_value(current, 'memory.max')
        if value is not None and value != 'max':
            parsed = int(value)
            memory = parsed if memory is None else min(memory, parsed)
        value = cgroup_value(current, 'memory.swap.max')
        if value is not None and value != 'max':
            parsed = int(value)
            swap = parsed if swap is None else min(swap, parsed)
        if current == '/':
            break
        current = current.rsplit('/', 1)[0] or '/'
    return memory, swap


def live_observation():
    result = {'pids': {}, 'scope': {}}
    for pid in LIVE_PIDS:
        cgroup = proc_cgroup(pid)
        result['pids'][str(pid)] = {
            'alive': cgroup is not None,
            'cgroup': cgroup,
            'identity': proc_identity(pid),
            'cmdlineSha256': digest(proc_cmdline(pid)),
        }
    scope = pathlib.Path('/sys/fs/cgroup') / LIVE_SCOPE.lstrip('/')
    procs = read_bytes(scope / 'cgroup.procs')
    result['scope'] = {
        'path': LIVE_SCOPE,
        'memoryMax': read_text(scope / 'memory.max'),
        'memorySwapMax': read_text(scope / 'memory.swap.max'),
        'memoryCurrent': read_text(scope / 'memory.current'),
        'memoryPeak': read_text(scope / 'memory.peak'),
        'memorySwapCurrent': read_text(scope / 'memory.swap.current'),
        'memorySwapPeak': read_text(scope / 'memory.swap.peak'),
        'procsCount': len(procs.splitlines()) if procs is not None else None,
        'procsSha256': digest(procs),
    }
    return result


def start_attempt(database, attempt, cwd, payload, native_flag):
    return subprocess.Popen(
        [str(EXE), 'retain', str(database), str(attempt), str(cwd),
         str(payload), 'close', str(NATIVE), native_flag],
        stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
        stderr=subprocess.PIPE, text=True)


def attempt_pid(attempt):
    pid_path = attempt / 'native.pid'
    if not pid_path.exists() or not (attempt / 'native.cgroup').exists():
        return None
    try:
        return int(pid_path.read_text())
    except ValueError:
        return None


def parse_lines(attempt, names):
    text = read_text(attempt / 'stdout') or ''
    values = {}
    for name in names:
        marker = name + ' '
        for line in text.splitlines():
            if line.startswith(marker):
                values[name] = int(line[len(marker):])
    return values


def stop_attempt(process, pid):
    if pid:
        try:
            os.killpg(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if process.stdin:
        try:
            process.stdin.close()
        except OSError:
            pass
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def cgroup_controller_enabled(path, controller):
    value = cgroup_value(path, 'cgroup.subtree_control')
    return value is not None and controller in value.split()


def ensure_controller(path, controller):
    if cgroup_controller_enabled(path, controller):
        return True
    target = pathlib.Path('/sys/fs/cgroup') / path.lstrip('/') / 'cgroup.subtree_control'
    try:
        with target.open('a') as handle:
            handle.write(f'+{controller}\n')
    except OSError:
        return False
    return cgroup_controller_enabled(path, controller)


def require_delegated_parent():
    if sys.platform != 'linux':
        blocked('native cgroup confinement is Linux-specific')
    if not pathlib.Path('/sys/fs/cgroup/cgroup.controllers').exists():
        blocked('cgroup v2 is not mounted at /sys/fs/cgroup')
    cgroup = own_cgroup()
    if not cgroup:
        blocked('the process has no cgroup v2 membership line')
    if cgroup == LIVE_SCOPE or cgroup.startswith(LIVE_SCOPE + '/'):
        blocked(f'refusing to use the live session scope as fixture: {cgroup}')
    current = cgroup
    while True:
        if current != '/':
            if current == LIVE_SCOPE or current.startswith(LIVE_SCOPE + '/'):
                blocked(f'refusing to use the live session scope as fixture: {current}')
            memory, swap = cgroup_limits(current)
            if memory is not None and swap == 0 and ensure_controller(current, 'memory'):
                if memory != REQUIRED_MEMORY:
                    blocked(f'the delegated ancestor {current} has effective memory.max {memory}, '
                            f'expected {REQUIRED_MEMORY}')
                probe = pathlib.Path('/sys/fs/cgroup') / current.lstrip('/') / f'baton-cgroup-probe-{os.getpid()}'
                try:
                    probe.mkdir()
                    probe.rmdir()
                except OSError as error:
                    blocked(f'the delegated cgroup {current} is not writable: {error}')
                return cgroup, current, memory, swap
        if current == '/':
            break
        current = current.rsplit('/', 1)[0] or '/'
    blocked(f'no delegated ancestor of {cgroup} has a finite memory.max, memory.swap.max=0 and the memory controller')


def main():
    if os.environ.get('BATON2_REAL_CGROUP_TEST') not in (None, '1'):
        blocked('BATON2_REAL_CGROUP_TEST has an unexpected value')
    if os.environ.get('BATON2_CGROUP_ROOT') or os.environ.get('BATON2_CGROUP_PARENT'):
        blocked('BATON2_CGROUP_ROOT and BATON2_CGROUP_PARENT must be unset for the real delegated test')
    if not EXE.exists() or not NATIVE.exists():
        blocked(f'candidate binaries are missing: {EXE} and {NATIVE}; build them before the scope run')
    delegated, placement, delegated_memory, delegated_swap = require_delegated_parent()
    before = live_observation()
    work = pathlib.Path(tempfile.mkdtemp(prefix='baton-real-cgroup-'))
    processes = []
    result = {'status': 'pass', 'delegatedCgroup': delegated,
              'delegatedPlacement': placement,
              'delegatedMemoryMax': delegated_memory,
              'delegatedMemorySwapMax': delegated_swap,
              'liveBefore': before, 'paths': {'work': str(work)}}
    try:
        cwd = work / 'cwd'
        cwd.mkdir()
        sibling_db = work / 'sibling.db'
        sibling_db.touch()
        sibling_payload = work / 'sibling.payload'
        sibling_payload.write_text('sibling\n')
        sibling_attempt = work / 'sibling-attempt'
        sibling = start_attempt(sibling_db, sibling_attempt, cwd, sibling_payload,
                                '--sibling-keeper')
        processes.append((sibling, sibling_attempt, sibling_db))
        sibling_native = wait_for(lambda: attempt_pid(sibling_attempt),
                                  'sibling native custody', 30)
        sibling_owner = proc_identity(sibling_native)['ppid']
        sibling_state = {
            'ownerCgroup': proc_cgroup(sibling_owner),
            'ownerIdentity': proc_identity(sibling_owner),
            'nativeCgroup': proc_cgroup(sibling_native),
            'nativeIdentity': proc_identity(sibling_native),
            'nativeCmdline': proc_cmdline(sibling_native),
        }
        result['siblingBefore'] = {
            'keeperPid': sibling_owner,
            'keeperCgroup': sibling_state['ownerCgroup'],
            'nativePid': sibling_native,
            'nativeCgroup': sibling_state['nativeCgroup'],
        }

        database = work / 'main.db'
        database.touch()
        payload = work / 'main.payload'
        payload.write_text('main\n')
        attempt = work / 'main-attempt'
        main_process = start_attempt(database, attempt, cwd, payload,
                                     '--native-descendant')
        processes.append((main_process, attempt, database))
        native = wait_for(lambda: attempt_pid(attempt), 'main native custody', 30)
        lines = wait_for(lambda: parse_lines(attempt, ('native-pid', 'descendant-pid')),
                         'main native and descendant PIDs', 30)
        if 'native-pid' not in lines or 'descendant-pid' not in lines:
            raise AssertionError(f'native output lacks the expected PIDs: {lines}')
        if lines['native-pid'] != native:
            raise AssertionError(f'recorded native PID {native} differs from its report {lines["native-pid"]}')
        descendant = lines['descendant-pid']
        evidence = read_text(attempt / 'native.cgroup') or ''
        fields = dict(part.split('=', 1) for part in evidence.split() if '=' in part)
        per_native = fields.get('cgroup')
        if not per_native:
            raise AssertionError(f'native.cgroup has no cgroup path: {evidence!r}')
        if not per_native.startswith(placement.rstrip('/') + '/'):
            raise AssertionError(f'per-native cgroup {per_native} is not under the delegated placement {placement}')
        native_cgroup = proc_cgroup(native)
        descendant_cgroup = proc_cgroup(descendant)
        expected = '0::' + per_native
        if native_cgroup != expected:
            raise AssertionError(f'native cgroup membership is {native_cgroup!r}, expected {expected!r}')
        if descendant_cgroup != expected:
            raise AssertionError(f'descendant cgroup membership is {descendant_cgroup!r}, expected {expected!r}')
        if proc_identity(descendant)['ppid'] != native:
            raise AssertionError('the descendant is not a child of the native')
        effective_memory, effective_swap = cgroup_limits(per_native)
        if effective_memory != REQUIRED_MEMORY:
            raise AssertionError(f'effective memory.max is {effective_memory}, expected {REQUIRED_MEMORY}')
        if effective_swap != 0:
            raise AssertionError(f'effective memory.swap.max is {effective_swap}, expected 0')
        if fields.get('memory.max') != str(REQUIRED_MEMORY):
            raise AssertionError(f'native.cgroup memory.max evidence is {fields.get("memory.max")}')
        if fields.get('memory.swap.max') != '0':
            raise AssertionError(f'native.cgroup memory.swap.max evidence is {fields.get("memory.swap.max")}')

        if proc_cgroup(sibling_owner) != sibling_state['ownerCgroup']:
            raise AssertionError('the sibling keeper cgroup changed')
        if proc_identity(sibling_owner) != sibling_state['ownerIdentity']:
            raise AssertionError('the sibling keeper process identity changed')
        if proc_cgroup(sibling_native) != sibling_state['nativeCgroup']:
            raise AssertionError('the sibling native cgroup changed')
        if proc_identity(sibling_native) != sibling_state['nativeIdentity']:
            raise AssertionError('the sibling native process identity changed')
        if proc_cmdline(sibling_native) != sibling_state['nativeCmdline']:
            raise AssertionError('the sibling native argv changed')
        try:
            os.kill(sibling_owner, 0)
        except ProcessLookupError:
            raise AssertionError('the sibling keeper exited')

        after = live_observation()
        before_keeper = before['pids'].get('1248282', {})
        after_keeper = after['pids'].get('1248282', {})
        if before_keeper.get('alive'):
            if not after_keeper.get('alive'):
                raise AssertionError('live keeper PID 1248282 exited during the test')
            if (after_keeper.get('cgroup') != before_keeper.get('cgroup') or
                    after_keeper.get('identity') != before_keeper.get('identity')):
                raise AssertionError('live keeper PID 1248282 changed cgroup or identity')
        if before['scope'].get('memoryMax') != after['scope'].get('memoryMax'):
            raise AssertionError('session-6448.scope memory.max changed')
        if before['scope'].get('memorySwapMax') != after['scope'].get('memorySwapMax'):
            raise AssertionError('session-6448.scope memory.swap.max changed')

        result.update({
            'perNativeCgroup': per_native,
            'memoryMax': effective_memory,
            'memorySwapMax': effective_swap,
            'nativePid': native,
            'descendantPid': descendant,
            'nativeMembership': native_cgroup,
            'descendantMembership': descendant_cgroup,
            'nativeCgroupEvidence': evidence.strip(),
            'siblingAfter': {
                'keeperPid': sibling_owner,
                'keeperCgroup': proc_cgroup(sibling_owner),
                'nativePid': sibling_native,
                'nativeCgroup': proc_cgroup(sibling_native),
            },
            'siblingUnchanged': True,
            'liveAfter': after,
            'liveKeeperUnchanged': (not before_keeper.get('alive') or
                (after_keeper.get('cgroup') == before_keeper.get('cgroup') and
                 after_keeper.get('identity') == before_keeper.get('identity'))),
            'liveScopeLimitsUnchanged': True,
        })
        receipt = os.environ.get('BATON2_CGROUP_RECEIPT')
        if not receipt:
            receipt = os.path.join(os.environ.get('TMPDIR', '/tmp'),
                                   f'baton-env931-cgroup-real-{os.getpid()}.json')
        pathlib.Path(receipt).write_text(json.dumps(result, indent=2, sort_keys=True) + '\n')
        result['paths']['receipt'] = receipt
        print(json.dumps(result, sort_keys=True))
        print('cgroup-confinement-real PASS')
        return 0
    finally:
        for process, attempt, database in processes:
            pid = None
            try:
                pid = int((attempt / 'native.pid').read_text())
            except (OSError, ValueError):
                pass
            stop_attempt(process, pid)
            subprocess.run([str(EXE), 'shutdown', str(database)],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           timeout=10)
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
