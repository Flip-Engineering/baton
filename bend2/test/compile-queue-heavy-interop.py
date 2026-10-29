#!/usr/bin/env python3
"""A queue that takes heavy.lock exclusively and the jobs of this queue exclude each other.

BATON2_COMPILE_QUEUE_BIN names the executable under test. The exclusive-lock queue
on main takes flock(LOCK_EX) on $state/heavy.lock for every job that is not a cc job
(#1266). This test plays that queue with flock(2) calls on the same file, in both
orders:

* the exclusive lock is held first: a cgen job of the executable under test stays
  a ticket, whatever memory is free, and runs after the lock is released;
* a cgen job of the executable under test runs first: its command holds the lock
  shared, so the exclusive request waits and is granted after the job ended;
* a cc job does not take the lock, and a cc job is not held back by it.

BATON2_EXCLUSIVE_QUEUE_BIN optionally names an executable of the exclusive-lock
queue (the shared runner of main). It then takes the place of the flock(2) calls:
it starts a cgen job under each order, and the two commands must not run together.
"""
import fcntl
import os
import pathlib
import subprocess
import sys
import tempfile
import time

BINARY = os.environ.get('BATON2_COMPILE_QUEUE_BIN')
EXCLUSIVE = os.environ.get('BATON2_EXCLUSIVE_QUEUE_BIN')
if not BINARY:
    print('Set BATON2_COMPILE_QUEUE_BIN to the built Bend2 queue executable', file=sys.stderr)
    sys.exit(2)

T = pathlib.Path(tempfile.mkdtemp(prefix='compile-queue-heavy-interop-'))
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
for fd in /proc/$$/fd/*; do
  case "$(readlink "$fd" 2>/dev/null)" in */heavy.lock) printf 'heavy-descriptor %s\\n' "$tag" >> "@LOG@" ;; esac
done
if [ -n "$hold" ]; then
  i=0
  while [ ! -e "$hold" ] && [ "$i" -lt 600 ]; do sleep 0.1; i=$((i + 1)); done
fi
[ -n "$out" ] && printf 'artifact-%s' "$tag" > "$out"
printf 'end %s\\n' "$tag" >> "@LOG@"
exit 0
'''.replace('@LOG@', str(LOG)))
FAKE.chmod(0o755)
(T / 'entry.bend').write_text('def main() -> Unit:\n  Unit{}\n')

procs = []


def new_state(name):
    state = T / name
    state.mkdir()
    state.chmod(0o2770)
    return state


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


def command(binary, state, kind, tag, hold=None):
    out = T / (tag + '.artifact')
    env = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))
    env.pop('BATON_COMPILE_QUEUE_TELEMETRY', None)
    if kind == 'cgen':
        selection = ['--kind', 'cgen', '--root', str(T), '--entry', 'entry.bend', '--compiler', str(FAKE),
                     '--artifact', 'c.c=' + str(out) + '.c', '--option', 'tag=' + tag]
        out = pathlib.Path(str(out) + '.c')
    else:
        selection = ['--kind', 'cc', '--compiler', str(FAKE), '--linker', str(FAKE), '--version', 'fake-version',
                     '--artifact', 'result=' + str(out), '--option', 'tag=' + tag]
    args = [binary, '--', 'run', '--token', 'interop-' + tag, '--receipt', str(T / (tag + '.receipt')),
            '--state-root', str(state), '--cwd', str(T), '--source-root', str(T), *selection, '--',
            str(FAKE), '--tag', tag, *(['--hold', str(hold)] if hold else []), '-o', str(out)]
    process = subprocess.Popen(args, env=env, stdout=open(T / (tag + '.out'), 'w'),
                               stderr=open(T / (tag + '.err'), 'w'))
    procs.append(process)
    return process, out


def finish(process, tag):
    try:
        process.wait(timeout=60)
    except subprocess.TimeoutExpired as error:
        raise AssertionError(('requester did not return', tag, T)) from error
    assert process.returncode == 0, (tag, process.returncode, (T / (tag + '.err')).read_text(), T)


def waiting_tickets(state):
    shown = subprocess.run([BINARY, '--', 'status', '--state-root', str(state)],
                           env=dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state)),
                           capture_output=True, text=True).stdout
    return sum(1 for line in shown.splitlines() if line.startswith('waiting '))


def lock_file(state):
    return open(state / 'heavy.lock', 'a+')


def try_exclusive(state):
    with lock_file(state) as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True


def scenario_exclusive_first():
    state = new_state('queue-exclusive-first')
    holder = lock_file(state)
    fcntl.flock(holder, fcntl.LOCK_EX)
    job, out = command(BINARY, state, 'cgen', 'after-exclusive')
    until('the supervisor wrote its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(3)
    assert waiting_tickets(state) == 1 and 'start after-exclusive' not in log_lines(), (log_lines(), T)
    assert not list((state / 'admission' / 'running').iterdir()), ('a claim exists', T)
    print('PASS a cgen job stays a ticket for 3 s while another queue holds heavy.lock exclusively')
    fcntl.flock(holder, fcntl.LOCK_UN)
    holder.close()
    finish(job, 'after-exclusive')
    assert out.read_text() == 'artifact-after-exclusive' and log_lines().count('start after-exclusive') == 1, T
    print('PASS the job ran once, with its artifact, after the exclusive lock was released')


def scenario_job_first():
    state = new_state('queue-job-first')
    hold = T / 'hold-job-first'
    job, out = command(BINARY, state, 'cgen', 'running-first', hold)
    until('the job started', lambda: 'start running-first' in log_lines())
    assert 'heavy-descriptor running-first' in log_lines(), ('the command has no heavy.lock descriptor', log_lines(), T)
    assert not try_exclusive(state), ('an exclusive lock was granted beside a running job', T)
    print('PASS the command of an admitted cgen job holds heavy.lock; an exclusive request is refused')
    waiter = subprocess.Popen([sys.executable, '-c', '''
import fcntl, sys, time
handle = open(sys.argv[1], "a+")
fcntl.flock(handle, fcntl.LOCK_EX)
open(sys.argv[2], "w").write(str(time.time_ns()))
''', str(state / 'heavy.lock'), str(T / 'exclusive-granted')])
    procs.append(waiter)
    time.sleep(2)
    assert waiter.poll() is None and not (T / 'exclusive-granted').exists(), ('the exclusive request ran beside the job', T)
    hold.touch()
    finish(job, 'running-first')
    waiter.wait(timeout=60)
    assert waiter.returncode == 0 and (T / 'exclusive-granted').exists(), T
    assert out.read_text() == 'artifact-running-first', T
    print('PASS the blocked exclusive request was granted after the job ended')


def scenario_cc():
    state = new_state('queue-cc')
    holder = lock_file(state)
    fcntl.flock(holder, fcntl.LOCK_EX)
    hold = T / 'hold-cc'
    job, out = command(BINARY, state, 'cc', 'cc-beside-exclusive', hold)
    until('a cc job started beside an exclusive heavy.lock holder', lambda: 'start cc-beside-exclusive' in log_lines())
    assert 'heavy-descriptor cc-beside-exclusive' not in log_lines(), ('a cc job holds heavy.lock', T)
    hold.touch()
    finish(job, 'cc-beside-exclusive')
    fcntl.flock(holder, fcntl.LOCK_UN)
    holder.close()
    print('PASS a cc job takes no heavy.lock descriptor and is not held back by the exclusive holder')


def scenario_exclusive_queue_binary():
    for order in ('exclusive-queue-first', 'this-queue-first'):
        state = new_state('queue-' + order)
        hold_a, hold_b = T / ('hold-a-' + order), T / ('hold-b-' + order)
        first_binary, second_binary = (EXCLUSIVE, BINARY) if order == 'exclusive-queue-first' else (BINARY, EXCLUSIVE)
        first_tag, second_tag = order + '-first', order + '-second'
        first, first_out = command(first_binary, state, 'cgen', first_tag, hold_a)
        until('first job started', lambda: 'start ' + first_tag in log_lines())
        second, second_out = command(second_binary, state, 'cgen', second_tag, hold_b)
        time.sleep(5)
        assert 'start ' + second_tag not in log_lines(), ('commands overlapped', order, log_lines(), T)
        hold_a.touch()
        finish(first, first_tag)
        until('second job started after the first ended', lambda: 'start ' + second_tag in log_lines())
        assert log_lines().index('end ' + first_tag) < log_lines().index('start ' + second_tag), (order, log_lines(), T)
        hold_b.touch()
        finish(second, second_tag)
        print('PASS %s: the second command started after the first ended' % order)


scenario_exclusive_first()
scenario_job_first()
scenario_cc()
if EXCLUSIVE:
    scenario_exclusive_queue_binary()
else:
    print('SKIP exclusive-lock queue executable: BATON2_EXCLUSIVE_QUEUE_BIN is not set')
for process in procs:
    assert process.poll() is not None, ('process left running', process.args, T)
