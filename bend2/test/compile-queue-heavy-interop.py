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
* a history-backed cc job waits for a legacy holder whose expected peak is unknown;
* history-backed jobs from this queue share measured memory admission.

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

os.umask(0o007)
T = pathlib.Path(tempfile.mkdtemp(prefix='compile-queue-heavy-interop-'))
LOG = T / 'log'
PAD = T / 'pad-exec.py'
PAD.write_text("""import os, sys
for target in range(3, 10):
    fd = os.open('/dev/null', os.O_RDONLY)
    if fd != target:
        os.dup2(fd, target)
        os.close(fd)
    os.set_inheritable(target, True)
os.execv(sys.argv[1], sys.argv[1:])
""")
LEGACY = T / 'legacy-holder.py'
LEGACY.write_text("""import fcntl, os, pathlib, sys, time
handle = open(sys.argv[1], 'a+')
fcntl.flock(handle, fcntl.LOCK_EX)
memory = bytearray(int(sys.argv[4]) * 1024 * 1024)
for offset in range(0, len(memory), 4096):
    memory[offset] = 1
pathlib.Path(sys.argv[2]).write_text(str(os.getpid()))
while not pathlib.Path(sys.argv[3]).exists():
    time.sleep(0.05)
""")
FAKE = T / 'compiler'
FAKE.write_text('''#!/bin/sh
tag=job; out=''; hold=''; prev=''
for arg in "$@"; do
  case $prev in --tag) tag=$arg ;; --hold) hold=$arg ;; esac
  [ "$prev" = -o ] && out=$arg
  prev=$arg
done
for fd in /proc/$$/fd/*; do
  target=$(readlink "$fd" 2>/dev/null)
  case "$target" in */heavy.lock) printf 'heavy-descriptor %s\\n' "$tag" >> "@LOG@" ;; esac
  [ "${fd##*/}" = 10 ] && case "$target" in */admission/running/*) printf 'claim-descriptor %s\\n' "$tag" >> "@LOG@" ;; esac
  [ "${fd##*/}" = 11 ] && case "$target" in */cc-execution.lock) printf 'cc-descriptor %s\\n' "$tag" >> "@LOG@" ;; esac
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
(T / 'entry.bend').write_text('def main() -> Unit:\n  Unit{}\n')

procs = []
releases = []


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


def command(binary, state, kind, tag, hold=None, pad_fds=False, priority=0):
    if hold is not None:
        releases.append(hold)
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
            '--state-root', str(state), '--cwd', str(T), '--source-root', str(T), '--priority', str(priority), *selection, '--',
            str(FAKE), '--tag', tag, *(['--hold', str(hold)] if hold else []), '-o', str(out)]
    if pad_fds:
        launcher = [sys.executable, str(PAD), *args]
    else:
        launcher = args
    process = subprocess.Popen(launcher, env=env, stdout=open(T / (tag + '.out'), 'w'),
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
    return sum(1 for path in (state / 'waiters').rglob('*') if path.is_file())


def start_legacy_holder(state, tag, megabytes=16):
    started = T / (tag + '.legacy-started')
    release = T / (tag + '.legacy-release')
    releases.append(release)
    process = subprocess.Popen([sys.executable, str(LEGACY), str(state / 'heavy.lock'),
                                str(started), str(release), str(megabytes)],
                               start_new_session=True)
    procs.append(process)
    until('legacy heavy holder started', lambda: started.exists())
    return process, release


def finish_legacy_holder(process, release):
    release.touch()
    process.wait(timeout=60)
    assert process.returncode == 0


def lock_file(state):
    return open(state / 'heavy.lock', 'a+')


def try_exclusive(state):
    with lock_file(state) as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            return False
        return True


def cgen_key(state, tag, hold):
    out = T / (tag + '.artifact.c')
    env = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))
    args = [BINARY, '--', 'key', '--kind', 'cgen', '--state-root', str(state),
            '--cwd', str(T), '--root', str(T), '--source-root', str(T),
            '--entry', 'entry.bend', '--compiler', str(FAKE),
            '--artifact', 'c.c=' + str(out), '--option', 'tag=' + tag,
            '--', str(FAKE), '--tag', tag, '--hold', str(hold), '-o', str(out)]
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    assert result.returncode == 0, (result.stdout, result.stderr, T)
    return result.stdout.strip()


def cc_key(state, tag, hold):
    out = T / (tag + '.artifact')
    env = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))
    args = [BINARY, '--', 'key', '--kind', 'cc', '--state-root', str(state),
            '--cwd', str(T), '--source-root', str(T), '--compiler', str(FAKE), '--linker', str(FAKE),
            '--version', 'fake-version', '--artifact', 'result=' + str(out),
            '--option', 'tag=' + tag, '--', str(FAKE), '--tag', tag,
            '--hold', str(hold), '-o', str(out)]
    result = subprocess.run(args, env=env, capture_output=True, text=True)
    assert result.returncode == 0, (result.stdout, result.stderr, T)
    return result.stdout.strip()


def scenario_measured_parallel():
    state = new_state("queue-measured-parallel")
    (state / "meminfo").write_text("total_kb=1000000\navailable_kb=100000\n")
    hold_a, hold_b = T / "hold-measured-a", T / "hold-measured-b"
    for tag, hold in (("measured-a", hold_a), ("measured-b", hold_b)):
        key = cgen_key(state, tag, hold)
        keydir = state / "keys" / key
        keydir.mkdir(parents=True, exist_ok=True)
        (keydir / "peak").write_text("peak_kb=1000\nmeasured_ns=1\n")
    first, _ = command(BINARY, state, "cgen", "measured-a", hold_a)
    second, _ = command(BINARY, state, "cgen", "measured-b", hold_b)
    until("both measured jobs started", lambda: "start measured-a" in log_lines() and "start measured-b" in log_lines())
    claims = list((state / "admission" / "running").iterdir())
    assert len(claims) == 2, ("both jobs need live measured claims", claims, T)
    print("PASS two history-backed cgen jobs run concurrently with two live claims")
    hold_a.touch(); hold_b.touch()
    finish(first, "measured-a"); finish(second, "measured-b")


def scenario_claim_fd10_inheritance():
    state = new_state("queue-claim-fd10-alias")
    (state / "meminfo").write_text("total_kb=1000000\navailable_kb=100000\n")
    hold = T / "hold-claim-fd10"
    job, _ = command(BINARY, state, "cgen", "claim-fd10-alias", hold, pad_fds=True)
    until("claim fd 10 job started", lambda: "start claim-fd10-alias" in log_lines())
    assert "claim-descriptor claim-fd10-alias" in log_lines(), ("FD 10 did not retain the claim lock", log_lines(), T)
    claims = list((state / "admission" / "running").iterdir())
    assert len(claims) == 1, ("claim file disappeared while the child held FD 10", claims, T)
    hold.touch()
    finish(job, "claim-fd10-alias")
    print("PASS the command retains its claim on FD 10 with inherited descriptors occupied")


def scenario_unknown_does_not_join():
    state = new_state("queue-unknown-does-not-join")
    (state / "meminfo").write_text("total_kb=1000000\navailable_kb=100000\n")
    hold_a, hold_b = T / "hold-unknown-a", T / "hold-unknown-b"
    key_b = cgen_key(state, "known-after-unknown", hold_b)
    keydir_b = state / "keys" / key_b
    keydir_b.mkdir(parents=True, exist_ok=True)
    (keydir_b / "peak").write_text("peak_kb=1000\n")
    first, _ = command(BINARY, state, "cgen", "unknown-first", hold_a)
    until("unmeasured first job started", lambda: "start unknown-first" in log_lines())
    assert "claim-descriptor unknown-first" in log_lines(), ("the command lost its admission claim", log_lines(), T)
    assert len(list((state / "admission" / "running").iterdir())) == 1, ("the unmeasured first job has no claim", T)
    second, _ = command(BINARY, state, "cgen", "known-after-unknown", hold_b)
    time.sleep(2)
    assert "start known-after-unknown" not in log_lines(), ("a known job joined an unmeasured active job", log_lines(), T)
    hold_a.touch()
    finish(first, "unknown-first")
    until("second job started after first claim released", lambda: "start known-after-unknown" in log_lines())
    hold_b.touch()
    finish(second, "known-after-unknown")
    print("PASS a first unmeasured job runs alone, then releases admission for a measured job")


def scenario_exclusive_first():
    state = new_state('queue-exclusive-first')
    holder = lock_file(state)
    fcntl.flock(holder, fcntl.LOCK_EX)
    job, out = command(BINARY, state, 'cgen', 'after-exclusive')
    until('the supervisor wrote its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(3)
    assert waiting_tickets(state) == 1 and 'start after-exclusive' not in log_lines(), (log_lines(), T)
    assert not list((state / 'admission' / 'running').glob('*')), ('a claim exists', T)
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
    assert 'claim-descriptor running-first' in log_lines(), ('normal host meminfo did not produce a retained claim', log_lines(), T)
    assert len(list((state / 'admission' / 'running').glob('*'))) == 1, ('normal host meminfo did not enter measured admission', T)
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
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    hold = T / 'hold-cc'
    key = cc_key(state, 'cc-after-exclusive', hold)
    keydir = state / 'keys' / key
    keydir.mkdir(parents=True, exist_ok=True)
    (keydir / 'peak').write_text('peak_kb=1000\n')
    legacy, release = start_legacy_holder(state, 'unknown-growth-legacy')
    job, out = command(BINARY, state, 'cc', 'cc-after-exclusive', hold)
    until('history-backed cc supervisor wrote its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start cc-after-exclusive' not in log_lines(), ('cc joined legacy work with unknown expected growth', log_lines(), T)
    assert not list((state / 'admission' / 'running').iterdir()), ('cc published a claim beside unknown legacy work', T)
    finish_legacy_holder(legacy, release)
    until('history-backed cc started after legacy holder exited', lambda: 'start cc-after-exclusive' in log_lines())
    assert 'heavy-descriptor cc-after-exclusive' in log_lines(), ('the cc command lost shared heavy.lock', T)
    assert 'cc-descriptor cc-after-exclusive' in log_lines(), ('the cc command lost its per-key execution lock on FD 11', T)
    assert len(list((state / 'admission' / 'running').iterdir())) == 1, ('the cc job has no measured claim', T)
    hold.touch()
    finish(job, 'cc-after-exclusive')
    assert out.read_text() == 'artifact-cc-after-exclusive', T
    print('PASS a history-backed cc waits for legacy work with unknown expected growth')


def scenario_measured_cc_parallel():
    state = new_state('queue-measured-cc-parallel')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    hold_a, hold_b = T / 'hold-measured-cgen', T / 'hold-measured-cc'
    for key in (cgen_key(state, 'measured-cgen', hold_a), cc_key(state, 'measured-cc', hold_b)):
        keydir = state / 'keys' / key
        keydir.mkdir(parents=True, exist_ok=True)
        (keydir / 'peak').write_text('peak_kb=1000\n')
    first, _ = command(BINARY, state, 'cgen', 'measured-cgen', hold_a)
    until('history-backed cgen started', lambda: 'start measured-cgen' in log_lines())
    second, _ = command(BINARY, state, 'cc', 'measured-cc', hold_b)
    until('history-backed cc joined the new-queue cgen', lambda: 'start measured-cc' in log_lines())
    assert len(list((state / 'admission' / 'running').iterdir())) == 2, ('the two jobs need live claims', T)
    hold_a.touch(); hold_b.touch()
    finish(first, 'measured-cgen'); finish(second, 'measured-cc')
    print('PASS history-backed cgen and cc jobs from the new queue run concurrently')


def scenario_cc_first():
    state = new_state('queue-cc-first')
    hold = T / 'hold-cc-first'
    job, out = command(BINARY, state, 'cc', 'cc-running-first', hold)
    until('cc command started first', lambda: 'start cc-running-first' in log_lines())
    assert 'heavy-descriptor cc-running-first' in log_lines(), ('cc command has no shared heavy.lock', log_lines(), T)
    assert 'cc-descriptor cc-running-first' in log_lines(), ('cc command has no per-key execution lock on FD 11', log_lines(), T)
    assert not try_exclusive(state), ('legacy exclusive lock was granted beside running cc', T)
    legacy = subprocess.Popen([sys.executable, '-c', '''
import fcntl, sys
handle = open(sys.argv[1], "a+")
fcntl.flock(handle, fcntl.LOCK_EX)
open(sys.argv[2], "w").write("granted")
''', str(state / 'heavy.lock'), str(T / 'cc-exclusive-granted')])
    procs.append(legacy)
    time.sleep(1)
    assert legacy.poll() is None and not (T / 'cc-exclusive-granted').exists(), ('legacy work overlapped cc', T)
    hold.touch()
    finish(job, 'cc-running-first')
    legacy.wait(timeout=60)
    assert legacy.returncode == 0 and (T / 'cc-exclusive-granted').exists(), T
    assert out.read_text() == 'artifact-cc-running-first', T
    print('PASS an exclusive legacy request waits until the running cc command releases shared heavy.lock')


def scenario_unknown_legacy_cc():
    state = new_state('queue-unknown-legacy-cc')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    legacy, release = start_legacy_holder(state, 'unknown-legacy')
    hold = T / 'hold-unknown-legacy-cc'
    job, out = command(BINARY, state, 'cc', 'unknown-legacy-cc', hold)
    until('unknown cc supervisor wrote its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start unknown-legacy-cc' not in log_lines(), ('an unmeasured cc joined unknown legacy work', log_lines(), T)
    assert not list((state / 'admission' / 'running').iterdir()), ('an unmeasured claim was published beside legacy work', T)
    finish_legacy_holder(legacy, release)
    until('unknown cc started after legacy holder exited', lambda: 'start unknown-legacy-cc' in log_lines())
    hold.touch()
    finish(job, 'unknown-legacy-cc')
    assert out.read_text() == 'artifact-unknown-legacy-cc', T
    print('PASS an unmeasured cc waits for an unknown legacy heavy workload to finish')


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


def seed_peak(state, kind, tag, hold, peak):
    key = cgen_key(state, tag, hold) if kind == 'cgen' else cc_key(state, tag, hold)
    keydir = state / 'keys' / key
    keydir.mkdir(parents=True, exist_ok=True)
    (keydir / 'peak').write_text('peak_kb=%d\n' % peak)
    return key


def scenario_first_known_capacity():
    state = new_state('queue-first-known-capacity')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=1000\n')
    hold = T / 'hold-first-known'
    seed_peak(state, 'cgen', 'first-known-capacity', hold, 2000)
    job, _ = command(BINARY, state, 'cgen', 'first-known-capacity', hold)
    until('first known job published its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start first-known-capacity' not in log_lines(), ('known peak exceeded available memory', T)
    assert not list((state / 'admission' / 'running').glob('*')), ('insufficient capacity produced a claim', T)
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    until('first known job started when capacity increased', lambda: 'start first-known-capacity' in log_lines())
    assert 'claim-descriptor first-known-capacity' in log_lines(), T
    hold.touch(); finish(job, 'first-known-capacity')
    print('PASS a first history-backed cgen waits for enough measured capacity and then proceeds')


def scenario_measured_capacity_wait():
    state = new_state('queue-measured-capacity-wait')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    hold_a, hold_b = T / 'hold-capacity-a', T / 'hold-capacity-b'
    for tag, hold in (('capacity-a', hold_a), ('capacity-b', hold_b)):
        seed_peak(state, 'cgen', tag, hold, 80000)
    first, _ = command(BINARY, state, 'cgen', 'capacity-a', hold_a)
    until('first capacity job started', lambda: 'start capacity-a' in log_lines())
    second, _ = command(BINARY, state, 'cgen', 'capacity-b', hold_b)
    until('second capacity job published its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start capacity-b' not in log_lines(), ('combined expected peaks exceeded measured capacity', T)
    hold_a.touch(); finish(first, 'capacity-a')
    until('waiting capacity job started after release', lambda: 'start capacity-b' in log_lines())
    hold_b.touch(); finish(second, 'capacity-b')
    assert try_exclusive(state), ('completed jobs retained heavy.lock', T)
    print('PASS known jobs wait when combined expected memory exceeds measured capacity and proceed after release')


def scenario_owned_cancellation_release():
    state = new_state('queue-cancel-release')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    hold_a, hold_b = T / 'hold-cancel-first', T / 'hold-cancel-second'
    key = cgen_key(state, 'cancel-first', hold_a)
    seed_peak(state, 'cgen', 'cancel-second', hold_b, 1000)
    first, _ = command(BINARY, state, 'cgen', 'cancel-first', hold_a)
    until('owned cancel target started', lambda: 'start cancel-first' in log_lines())
    second, _ = command(BINARY, state, 'cgen', 'cancel-second', hold_b)
    until('cancel waiter published its ticket', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start cancel-second' not in log_lines(), T
    canceled = subprocess.run([BINARY, '--', 'cancel', '--state-root', str(state),
                              '--key', key, '--token', 'interop-cancel-first'], capture_output=True, text=True)
    assert canceled.returncode == 0, (canceled.stdout, canceled.stderr, T)
    first.wait(timeout=60)
    results = list((state / 'keys' / key / 'runs').glob('*/result'))
    assert results and 'status=canceled' in results[-1].read_text(), (results, T)
    until('waiter started after owned cancellation', lambda: 'start cancel-second' in log_lines())
    assert 'claim-descriptor cancel-second' in log_lines(), T
    hold_b.touch(); finish(second, 'cancel-second')
    assert try_exclusive(state), ('owned cancellation retained heavy.lock', T)
    print('PASS supported owned cancellation releases the claim and lock so a waiting job proceeds')


def scenario_fallback_cc_interop():
    for order in ('legacy-first', 'fallback-cc-first', 'accounted-first', 'fallback-before-accounted'):
        state = new_state('queue-fallback-' + order)
        tag = 'fallback-' + order
        hold_cc = T / ('hold-' + tag)
        # A nonempty unparseable override represents unavailable host measurement.
        (state / 'meminfo').write_text('measurement unavailable\n')
        if order == 'legacy-first':
            legacy, release = start_legacy_holder(state, tag)
            cc, _ = command(BINARY, state, 'cc', tag, hold_cc)
            until('fallback cc published a ticket', lambda: waiting_tickets(state) == 1)
            time.sleep(1)
            assert 'start ' + tag not in log_lines(), ('fallback cc overlapped legacy heavy work', T)
            finish_legacy_holder(legacy, release)
            until('fallback cc started after legacy release', lambda: 'start ' + tag in log_lines())
        elif order == 'fallback-cc-first':
            cc, _ = command(BINARY, state, 'cc', tag, hold_cc)
            until('fallback cc started first', lambda: 'start ' + tag in log_lines())
            assert not try_exclusive(state), ('fallback cc did not retain exclusive heavy.lock', T)
        elif order == 'accounted-first':
            (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
            hold_cgen = T / ('hold-accounted-' + order)
            cgen, _ = command(BINARY, state, 'cgen', 'accounted-' + order, hold_cgen)
            until('accounted cgen started first', lambda: 'start accounted-' + order in log_lines())
            (state / 'meminfo').write_text('measurement unavailable\n')
            cc, _ = command(BINARY, state, 'cc', tag, hold_cc)
            until('fallback cc ticket beside accounted work', lambda: waiting_tickets(state) == 1)
            time.sleep(1)
            assert 'start ' + tag not in log_lines(), ('fallback cc overlapped accounted work', T)
            hold_cgen.touch(); finish(cgen, 'accounted-' + order)
            until('fallback cc started after accounted release', lambda: 'start ' + tag in log_lines())
        else:
            cc, _ = command(BINARY, state, 'cc', tag, hold_cc)
            until('fallback cc started before accounted request', lambda: 'start ' + tag in log_lines())
            (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
            hold_cgen = T / ('hold-accounted-' + order)
            cgen, _ = command(BINARY, state, 'cgen', 'accounted-' + order, hold_cgen)
            until('accounted waiter beside fallback cc', lambda: waiting_tickets(state) == 1)
            time.sleep(1)
            assert 'start accounted-' + order not in log_lines(), ('accounted job overlapped fallback cc', T)
        assert 'heavy-descriptor ' + tag in log_lines(), ('fallback cc lost heavy.lock at exec', T)
        assert 'cc-descriptor ' + tag in log_lines(), ('fallback cc lost per-key FD 11', T)
        hold_cc.touch(); finish(cc, tag)
        if order == 'fallback-before-accounted':
            until('accounted job started after fallback release', lambda: 'start accounted-' + order in log_lines())
            hold_cgen.touch(); finish(cgen, 'accounted-' + order)
        assert try_exclusive(state), ('fallback completion retained heavy.lock', T)
        print('PASS unavailable-meminfo cc excludes heavy work: ' + order)


def scenario_fallback_priority():
    state = new_state('queue-fallback-priority')
    (state / 'meminfo').write_text('measurement unavailable\n')
    legacy, release = start_legacy_holder(state, 'fallback-priority-holder')
    hold_cc, hold_cgen = T / 'hold-priority-cc', T / 'hold-priority-cgen'
    cc, _ = command(BINARY, state, 'cc', 'priority-cc', hold_cc, priority=100)
    until('fallback cc moved to heavy waiter directory', lambda: len([p for p in (state / 'waiters').glob('*') if p.is_file()]) == 1)
    cgen, _ = command(BINARY, state, 'cgen', 'priority-cgen', hold_cgen, priority=1)
    until('both fallback tickets published', lambda: waiting_tickets(state) == 2)
    finish_legacy_holder(legacy, release)
    until('higher priority fallback cc started', lambda: 'start priority-cc' in log_lines())
    assert 'start priority-cgen' not in log_lines(), ('lower priority fallback job bypassed cc ticket', T)
    hold_cc.touch(); finish(cc, 'priority-cc')
    until('lower priority fallback cgen started after cc', lambda: 'start priority-cgen' in log_lines())
    hold_cgen.touch(); finish(cgen, 'priority-cgen')
    print('PASS fallback compiler kinds use the same heavy ticket order without stranding cc')



def scenario_priority_capacity():
    state = new_state('queue-priority-capacity')
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=1000\n')
    large_hold, small_hold = T / 'hold-priority-large', T / 'hold-priority-small'
    seed_peak(state, 'cgen', 'priority-large', large_hold, 2000)
    seed_peak(state, 'cgen', 'priority-small', small_hold, 500)
    large, _ = command(BINARY, state, 'cgen', 'priority-large', large_hold, priority=100)
    until('large high priority request is waiting', lambda: waiting_tickets(state) == 1)
    time.sleep(1)
    assert 'start priority-large' not in log_lines(), ('high priority bypassed capacity', T)
    assert try_exclusive(state), ('memory waiter reserved heavy.lock', T)
    small, _ = command(BINARY, state, 'cgen', 'priority-small', small_hold, priority=1)
    until('smaller lower priority request started', lambda: 'start priority-small' in log_lines())
    assert 'start priority-large' not in log_lines(), T
    small_hold.touch(); finish(small, 'priority-small')
    assert 'start priority-large' not in log_lines(), T
    assert try_exclusive(state), ('memory waiter retained heavy.lock after smaller job finished', T)
    (state / 'meminfo').write_text('total_kb=1000000\navailable_kb=100000\n')
    until('large request started after capacity increased', lambda: 'start priority-large' in log_lines())
    large_hold.touch(); finish(large, 'priority-large')
    print('PASS a memory-blocked high priority request permits a smaller runnable request and starts when capacity increases')


try:
    scenario_first_known_capacity()
    scenario_priority_capacity()
    scenario_measured_capacity_wait()
    scenario_owned_cancellation_release()
    scenario_fallback_cc_interop()
    scenario_fallback_priority()
    scenario_exclusive_first()
    scenario_job_first()
    scenario_cc()
    scenario_cc_first()
    scenario_unknown_legacy_cc()
    scenario_measured_parallel()
    scenario_measured_cc_parallel()
    scenario_claim_fd10_inheritance()
    scenario_unknown_does_not_join()
    if EXCLUSIVE:
        scenario_exclusive_queue_binary()
    else:
        print('SKIP exclusive-lock queue executable: BATON2_EXCLUSIVE_QUEUE_BIN is not set')
finally:
    for release in releases:
        release.touch()
    for process in procs:
        process.wait(timeout=60)
for process in procs:
    assert process.poll() is not None, ('process left running', process.args, T)
