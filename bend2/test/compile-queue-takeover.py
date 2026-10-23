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
if not LEGACY and not PRIOR:
    print('SKIP takeover: set BATON2_LEGACY_QUEUE_BIN (uses heavy.lock) or BATON2_PRIOR_QUEUE_BIN (earlier admission build)')
    sys.exit(0)
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


def request(binary, tag, *extra, state=None):
    state = state or STATE
    env = dict(ENV, BATON_COMPILE_QUEUE_ROOT=str(state))
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
    hold2 = T / 'hold-prior'
    holder2 = request(PRIOR, 'prior-holder', '--hold', str(hold2), state=state2)
    procs.append(holder2)
    until('earlier build started the job that holds a claim', lambda: 'start prior-holder' in log_lines())
    waiter2 = request(PRIOR, 'prior-waiter', state=state2)
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
    taken2 = subprocess.run([BINARY, '--', 'takeover', '--state-root', str(state2)], env=env2,
                            capture_output=True, text=True, timeout=60)
    assert taken2.returncode == 0 and taken2.stdout.count('retaken ') == 1, (taken2.stdout, taken2.stderr, T)
    print('PASS takeover replaced the waiting supervisor of the earlier build')
    try:
        waiter2.wait(timeout=60)
    except subprocess.TimeoutExpired as error:
        raise AssertionError(('requester of a replaced job did not return', T)) from error
    assert waiter2.returncode == 0, (waiter2.returncode, T)
    assert (T / 'prior-waiter.artifact').read_text() == 'artifact-prior-waiter'
    assert log_lines().count('start prior-waiter') == 1 and log_lines().count('end prior-waiter') == 1, log_lines()
    assert holder2.poll() is None and 'end prior-holder' not in log_lines(), log_lines()
    print('PASS the replaced job ran once, beside the first job, and its requester got the result')
    hold2.touch()
    holder2.wait(timeout=60)
    assert holder2.returncode == 0
    print('PASS the first job of the earlier build finished intact')


try:
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
