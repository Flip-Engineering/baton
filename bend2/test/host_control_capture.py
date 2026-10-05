"""Retain compiler and fixture streams directly in an execution directory."""
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def save(path, value):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    temporary.replace(path)


def run(directory, name, argv, timeout):
    directory = Path(directory)
    (directory / f'{name}.capture').mkdir()
    stdout_path = directory / f'{name}.stdout'
    stderr_path = directory / f'{name}.stderr'
    outcome_path = directory / f'{name}.outcome.json'
    record = {'argv': argv, 'cwd': os.getcwd(), 'timeoutSeconds': timeout,
              'startedNs': time.time_ns(), 'pid': None, 'state': 'setup',
              'returncode': None, 'exitCode': None, 'signal': None,
              'driverSignal': None, 'platform': list(os.uname())}
    save(directory / f'{name}.argv.json', argv)
    save(outcome_path, record)
    child = None
    previous_term = signal.getsignal(signal.SIGTERM)

    def interrupted(signum, frame):
        record['driverSignal'] = signum
        raise InterruptedError(f'capture received signal {signum}')

    def finish_child():
        if child is None:
            return
        if child.poll() is None:
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill()
                child.wait()
        record['returncode'] = child.returncode
        record['exitCode'] = child.returncode if child.returncode >= 0 else None
        record['signal'] = -child.returncode if child.returncode < 0 else None

    signal.signal(signal.SIGTERM, interrupted)
    try:
        # Exclusive creation makes evidence-name reuse fail before another launch.
        # The child inherits these files; output survives an interrupted driver.
        with stdout_path.open('xb', buffering=0) as stdout, stderr_path.open('xb', buffering=0) as stderr:
            record['state'] = 'spawning'
            save(outcome_path, record)
            child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
            record.update(pid=child.pid, state='running')
            save(outcome_path, record)
            try:
                child.wait(timeout=timeout)
            except subprocess.TimeoutExpired:
                record['state'] = 'timeout'
                finish_child()
                raise
            record['state'] = 'exited' if child.returncode >= 0 else 'signalled'
            finish_child()
    except BaseException as error:
        if record['state'] != 'timeout':
            record['state'] = ('spawn-error' if record['state'] == 'spawning' and child is None
                               else 'setup-error' if record['state'] == 'setup'
                               else 'interrupted')
        record['errorType'] = type(error).__name__
        record['error'] = str(error)
        if isinstance(error, OSError):
            record['errno'] = error.errno
        finish_child()
        raise
    finally:
        signal.signal(signal.SIGTERM, previous_term)
        record['finishedNs'] = time.time_ns()
        save(outcome_path, record)
    return subprocess.CompletedProcess(argv, child.returncode,
                                       stdout_path.read_bytes(), stderr_path.read_bytes())
