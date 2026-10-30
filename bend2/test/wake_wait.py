"""Waiting and cleanup for the wake fixtures (#1396).

A wake fixture waits for an event that its own processes produce: a receiver, a
keeper, a native fixture or a dispatch. When every process of the fixture is an
idle database owner (or none is left), nothing remains that could produce the
awaited event, so the wait fails with the evidence the fixture holds. A wait on
a slow but live fixture continues until its processes finish. No duration
decides either outcome.
"""
import json
import pathlib
import signal
import subprocess
import time

EVIDENCE_FILES = ('status', 'launch', 'released', 'acknowledged', 'native.pid', 'native.stderr',
                  'observer-error', 'observer.log', 'keeper.log', 'keeper-error',
                  'native-start-error', 'recovery-blocked', 'checkpoint-error')
TAIL = 2000


def is_owner(process, database):
    return ' --instance-owner ' in process['command'] and str(database) in process['command']


def stalled(processes, database):
    """True when the fixture has no process but idle database owners."""
    return all(is_owner(process, database) for process in processes)


def tail(path, limit=TAIL):
    try:
        data = pathlib.Path(path).read_bytes()
    except OSError as error:
        return f'<unreadable: {error.strerror}>'
    return data[-limit:].decode(errors='replace')


def evidence(directory, database, processes, rows):
    """The fixture's processes, calls, message, claim and execution rows, and the
    markers and logs of every retained attempt, as one text."""
    directory = pathlib.Path(directory)
    parts = ['processes: ' + json.dumps(processes, default=str)]
    for name, sql in (
            ('messages', 'SELECT id, sender, recipient, kind, seq FROM messages ORDER BY seq'),
            ('executions', 'SELECT session, id, mode, phase, status FROM executions'),
            ('wake_claims', 'SELECT session, state, owner, generation FROM wake_claims'),
            ('wake_claim_tickets', 'SELECT session, owner, generation FROM wake_claim_tickets')):
        try:
            parts.append(f'{name}: ' + json.dumps(rows(sql), default=str))
        except Exception as error:  # the table may not exist yet
            parts.append(f'{name}: <unavailable: {error}>')
    calls = directory / 'calls'
    if calls.is_dir():
        parts.append('calls: ' + json.dumps({path.stem: len(path.read_text().splitlines())
                                              for path in sorted(calls.glob('*.jsonl'))}))
    log = pathlib.Path(str(database) + '.root.log')
    if log.exists():
        parts.append('delivery log tail: ' + tail(log))
    for attempt in sorted(directory.glob(pathlib.Path(database).name + '.attempt-*')):
        parts.append(f'attempt {attempt.name[-40:]}: ' + ' '.join(sorted(path.name for path in attempt.iterdir())))
        for name in EVIDENCE_FILES:
            if (attempt / name).is_file():
                parts.append(f'  {name}: ' + tail(attempt / name, 400).strip())
    return '\n'.join(parts)


def wait_for(observation, description, processes, database, diagnostics, interval=0.05):
    """Returns the first true observation. Fails with the diagnostics when the
    observation is false while the fixture is stalled on two successive samples
    (the processes are sampled before each observation, so nothing that was
    running can have produced the event unseen)."""
    quiet = 0
    while True:
        alive = processes()
        result = observation()
        if result:
            return result
        quiet = quiet + 1 if stalled(alive, database) else 0
        if quiet >= 2:
            raise AssertionError(f'{description}\nThe fixture has no process left that could produce '
                                 f'this event.\n{diagnostics()}')
        time.sleep(interval)


def stop_owners(executable, database, processes, run=subprocess.run):
    """Shut idle database owners down through the supported command. Returns the
    command result, or None when no owner is left or other fixture processes remain."""
    alive = processes()
    if not alive or not stalled(alive, database):
        return None
    return run([str(executable), '--instance-shutdown', str(database)], capture_output=True, text=True)


def on_termination(cleanup):
    """Run cleanup when this process receives SIGTERM, then stop the run as an
    interrupt. Returns the previous handler, or None outside the main thread."""
    def handler(number, frame):
        try:
            cleanup()
        finally:
            raise KeyboardInterrupt
    try:
        return signal.signal(signal.SIGTERM, handler)
    except ValueError:
        return None


def restore_termination(previous):
    if previous is not None:
        signal.signal(signal.SIGTERM, previous)
