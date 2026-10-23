#!/usr/bin/env python3
"""Jobs queued behind heavy.lock by an older queue executable run after takeover.

BATON2_LEGACY_QUEUE_BIN names a queue executable that serializes jobs with
heavy.lock (the queue deployed before memory admission). BATON2_COMPILE_QUEUE_BIN
names the executable under test. The older executable starts one job that holds
the lock and two jobs that wait for it. The takeover command of the executable
under test then replaces the two waiting supervisors. Each waiting job must
finish with its requester's exit status 0 and its artifact, run exactly once,
and finish while the first job still holds the lock.

BATON2_PRIOR_QUEUE_BIN names an earlier build of the memory-admission queue. It
starts a job and a second job that waits for admission. The takeover command of
the executable under test replaces the waiting supervisor of the earlier build
with a successor that applies the current rule: with a peak recorded for the
kind of the waiting job, the successor runs it beside the first job.
"""
import os
import pathlib
import subprocess
import sys
import tempfile
import time

LEGACY = os.environ.get('BATON2_LEGACY_QUEUE_BIN')
PRIOR = os.environ.get('BATON2_PRIOR_QUEUE_BIN')
BINARY = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
if not BINARY:
    print('Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable', file=sys.stderr)
    sys.exit(2)
if not BINARY:
    print('Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable', file=sys.stderr)
    sys.exit(2)

T = pathlib.Path(tempfile.mkdtemp(prefix='compile-queue-takeover-'))
STATE = T / 'queue'
STATE.mkdir()
STATE.chmod(0o2770)
HOLD = T / 'hold'
LOG = T / 'log'
FAKE = T / 'compiler'
FAKE.write_text('''#!/bin/sh
tag=job; out=''; hold=''; prev=''
for arg in "$@"; do
  case $prev in --tag) tag=$arg ;; --hold) hold=$arg ;; esac
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
printf 'start %s\\n' "$tag" >> "@LOG@"
printf 'mark %s %s\\n' "$tag" "${QUEUE_TEST_MARK:-none}" >> "@LOG@"
if [ -n "$hold" ]; then
  i=0
  while [ ! -e "$hold" ] && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i + 1)); done
fi
[ -n "$out" ] && printf 'artifact-%s' "$tag" > "$out"
printf 'end %s\\n' "$tag" >> "@LOG@"
exit 0
'''.replace('@LOG@', str(LOG)))
FAKE.chmod(0o755)
ENV = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(STATE))
ENV.pop('BATON_COMPILE_QUEUE_TELEMETRY', None)


def request(binary, tag, *extra, state=None, mark=None):
    state = state or STATE
    env = dict(ENV, BATON_COMPILE_QUEUE_ROOT=str(state))
    if mark:
        env['QUEUE_TEST_MARK'] = mark
    out = T / (tag + '.artifact')
    args = [binary, '--', 'run', '--kind', 'cc', '--state-root', str(state), '--cwd', str(T),
            '--source-root', str(T), '--compiler', str(FAKE), '--linker', str(FAKE),
            '--version', 'fake-version', '--artifact', 'result=' + str(out),
            '--option', 'tag=' + tag, '--', str(FAKE), '--tag', tag, *extra, '-o', str(out)]
    return subprocess.Popen(args, env=env, stdout=open(T / (tag + '.out'), 'w'),
                            stderr=open(T / (tag + '.err'), 'w'))


def until(what, test, seconds=60):
    # This deadline detects a broken fixture; it does not bound a compiler.
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if test():
            return
        time.sleep(0.05)
    raise AssertionError((what, T))


def log_lines():
    return LOG.read_text().splitlines() if LOG.exists() else []


def lock_waiters():
    inode = (STATE / 'heavy.lock').stat().st_ino
    count = 0
    for line in pathlib.Path('/proc/locks').read_text().splitlines():
        if '->' in line and (':%d ' % inode) in line:
            count += 1
    return count


procs = []


def scenario_legacy():
    holder = request(LEGACY, 'holder', '--hold', str(HOLD))
    procs.append(holder)
    until('older queue started the job that holds the lock', lambda: 'start holder' in log_lines())
    waiting = [request(LEGACY, tag) for tag in ('queued-one', 'queued-two')]
    procs.extend(waiting)
    until('older queue supervisors wait for heavy.lock', lambda: lock_waiters() == 2)
    assert not any(line.startswith('start queued') for line in log_lines()), log_lines()
    print('PASS two jobs of the older queue wait behind the job that holds heavy.lock')

    taken = subprocess.run([BINARY, '--', 'takeover', '--state-root', str(STATE)], env=ENV,
                           capture_output=True, text=True, timeout=60)
    assert taken.returncode == 0, (taken.stdout, taken.stderr, T)
    assert taken.stdout.count('taken-over ') == 2, (taken.stdout, T)
    print('PASS takeover replaced both waiting supervisors')

    # The older executable records no growth of memory used outside the queue, so
    # the rule starts one job at a time and the holder of heavy.lock counts as
    # that job. The operator records a growth before installing the new
    # executable; the test writes one.
    time.sleep(2)
    assert not any(line.startswith('start queued') for line in log_lines()), log_lines()
    (STATE / 'outside-growth').write_text('growth_kb=0\n')
    print('PASS taken-over jobs wait while no growth of outside memory use is recorded')

    for process in waiting:
        try:
            process.wait(timeout=60)
        except subprocess.TimeoutExpired as error:
            raise AssertionError(('requester of a taken-over job did not return', T)) from error
        assert process.returncode == 0, (process.args, process.returncode, T)
    for tag in ('queued-one', 'queued-two'):
        assert (T / (tag + '.artifact')).read_text() == 'artifact-' + tag, (tag, T)
        assert log_lines().count('start ' + tag) == 1, (log_lines(), T)
        assert log_lines().count('end ' + tag) == 1, (log_lines(), T)
    assert holder.poll() is None, ('the job that holds heavy.lock was stopped', T)
    assert 'end holder' not in log_lines(), (log_lines(), T)
    print('PASS taken-over jobs finished once, with their artifacts, beside the running holder')

    HOLD.touch()
    holder.wait(timeout=60)
    assert holder.returncode == 0, (holder.returncode, T)
    assert (T / 'holder.artifact').read_text() == 'artifact-holder'
    assert lock_waiters() == 0
    print('PASS the holder finished with its lock and artifact intact')


def scenario_prior():
    state2 = T / 'queue-prior'
    state2.mkdir()
    state2.chmod(0o2770)
    (state2 / 'outside-growth').write_text('growth_kb=0\n')
    env2 = dict(ENV, BATON_COMPILE_QUEUE_ROOT=str(state2))
    env_takeover = dict(env2, QUEUE_TEST_MARK='takeover-environment')
    hold2 = T / 'hold-prior'
    holder2 = request(PRIOR, 'prior-holder', '--hold', str(hold2), state=state2)
    procs.append(holder2)
    until('earlier build started the job that holds a claim', lambda: 'start prior-holder' in log_lines())
    waiter2 = request(PRIOR, 'prior-waiter', state=state2, mark='client-environment')
    procs.append(waiter2)

    def waiting_rows():
        shown = subprocess.run([BINARY, '--', 'status', '--state-root', str(state2)], env=env2,
                               capture_output=True, text=True).stdout
        return sum(1 for line in shown.splitlines() if line.startswith('waiting '))
    until('earlier build supervisor waits for admission', lambda: waiting_rows() == 1)
    assert 'start prior-waiter' not in log_lines(), log_lines()
    print('PASS a job of the earlier build waits for admission behind a running job without a recorded peak')

    # A peak recorded for the kind of the waiting job lets the current rule run it
    # beside the first job. Only a supervisor of this executable applies that rule.
    (state2 / 'peaks').mkdir(exist_ok=True)
    (state2 / 'peaks').chmod(0o2770)
    (state2 / 'peaks' / 'k.cc').write_text('peak_kb=64\n')
    time.sleep(1)
    assert 'start prior-waiter' not in log_lines(), ('earlier build applied the new rule', log_lines())
    # takeover takes the admission lock before it stops a supervisor, so a
    # supervisor cannot be stopped while it holds that lock. Hold the lock here: no
    # supervisor may be stopped until it is released.
    import fcntl
    waiting_pid = None
    for ticket in (state2 / 'admission' / 'waiting').iterdir():
        for line in ticket.read_text().splitlines():
            if line.startswith('pid='):
                waiting_pid = int(line[4:])
    assert waiting_pid, ('no ticket', T)

    def stopped(pid):
        return pathlib.Path('/proc/%d/stat' % pid).read_text().rsplit(')', 1)[1].split()[0] == 'T'
    with (state2 / 'admission' / 'lock').open('r+') as lock_file:
        fcntl.flock(lock_file, fcntl.LOCK_EX)
        takeover2 = subprocess.Popen([BINARY, '--', 'takeover', '--state-root', str(state2)], env=env_takeover,
                                     stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        time.sleep(1.5)
        assert takeover2.poll() is None, 'takeover finished while the admission lock was held'
        assert not stopped(waiting_pid), 'a supervisor was stopped while the admission lock was held'
        fcntl.flock(lock_file, fcntl.LOCK_UN)
    out2, err2 = takeover2.communicate(timeout=60)
    assert takeover2.returncode == 0 and out2.count('retaken ') == 1, (out2, err2, T)
    print('PASS takeover waited for the admission lock before it stopped a supervisor')
    print('PASS takeover replaced the waiting supervisor of the earlier build')
    try:
        waiter2.wait(timeout=60)
    except subprocess.TimeoutExpired as error:
        raise AssertionError(('requester of a replaced job did not return', T)) from error
    assert waiter2.returncode == 0, (waiter2.returncode, T)
    assert (T / 'prior-waiter.artifact').read_text() == 'artifact-prior-waiter'
    assert log_lines().count('start prior-waiter') == 1 and log_lines().count('end prior-waiter') == 1, log_lines()
    assert 'mark prior-waiter client-environment' in log_lines(), ('the successor did not keep the environment of the requester', log_lines())
    print('PASS the successor ran the command with the environment of the replaced supervisor')
    assert holder2.poll() is None and 'end prior-holder' not in log_lines(), log_lines()
    print('PASS the replaced job ran once, beside the first job, and its requester got the result')
    hold2.touch()
    holder2.wait(timeout=60)
    assert holder2.returncode == 0
    print('PASS the first job of the earlier build finished intact')


FAKE_SUPERVISOR = '''
import fcntl, os, sys, time
state, attempt = sys.argv[1], sys.argv[-1]
key = attempt.split('/keys/')[1].split('/')[0]
stat = open('/proc/self/stat').read().rsplit(')', 1)[1].split()
queued = int(time.time_ns())
ticket = '%020d-%010d' % (queued, os.getpid())
open(state + '/admission/waiting/' + ticket, 'w').write(
    'pid=%d\\nstarttime=%s\\nkey=%s\\ngroup=\\nentry=\\ncompiler=\\nkind=cc\\nqueued_ns=%d\\n'
    % (os.getpid(), stat[19], key, queued))
lock = open(state + '/admission/lock', 'a+')
while True:
    fcntl.flock(lock, fcntl.LOCK_EX)
    time.sleep(0.3)
    fcntl.flock(lock, fcntl.LOCK_UN)
    time.sleep(0.05)
'''


def scenario_lock_holder():
    """A supervisor that holds the admission lock most of the time is replaced without a stall.

    Stopping such a supervisor while it holds the lock would keep the lock and block
    takeover and every other waiter."""
    state3 = T / 'queue-lock'
    for sub in ('', 'admission', 'admission/waiting', 'admission/running'):
        directory = state3 / sub if sub else state3
        directory.mkdir(exist_ok=True)
        directory.chmod(0o2770)
    script = T / 'fake-supervisor.py'
    script.write_text(FAKE_SUPERVISOR)
    fakes = []
    for number in range(3):
        key = ('%064x' % (number + 1))
        attempt = state3 / 'keys' / key / 'runs' / ('1000000000000000%d-1' % number)
        attempt.mkdir(parents=True)
        for directory in (attempt.parent.parent, attempt.parent, attempt):
            directory.chmod(0o2770)
        (attempt / 'meta').write_text('kind=cc\nkey=%s\n' % key)
        (attempt.parent.parent / 'lock').write_text('')
        process = subprocess.Popen(['python3', '-I', str(script), str(state3), '__supervise', str(attempt)])
        fakes.append(process)
        procs.append(process)
    until('fake supervisors wrote their tickets', lambda: len(list((state3 / 'admission' / 'waiting').iterdir())) == 3)
    env3 = dict(ENV, BATON_COMPILE_QUEUE_ROOT=str(state3))
    try:
        taken3 = subprocess.run([BINARY, '--', 'takeover', '--state-root', str(state3)], env=env3,
                                capture_output=True, text=True, timeout=60)
    except subprocess.TimeoutExpired as error:
        raise AssertionError(('takeover stalled on the admission lock of a stopped supervisor', T)) from error
    assert taken3.returncode == 0 and taken3.stdout.count('retaken ') == 3, (taken3.stdout, taken3.stderr, T)
    print('PASS takeover replaced supervisors that hold the admission lock most of the time, without a stall')


try:
    scenario_lock_holder()
    if LEGACY:
        scenario_legacy()
    if PRIOR:
        scenario_prior()
    print('evidence=' + str(T))
except BaseException:
    print('evidence=' + str(T), file=sys.stderr)
    raise
finally:
    HOLD.touch()
    for process in procs:
        if process.poll() is None:
            process.kill()
