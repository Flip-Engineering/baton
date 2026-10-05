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


def error_record(error):
    value = {'type': type(error).__name__, 'message': str(error)}
    if isinstance(error, OSError):
        value['errno'] = error.errno
    return value


def run(directory, name, argv, timeout):
    directory = Path(directory)
    stdout_path = directory / f'{name}.stdout'
    stderr_path = directory / f'{name}.stderr'
    outcome_path = directory / f'{name}.outcome.json'
    record = {'argv': argv, 'cwd': os.getcwd(), 'timeoutSeconds': timeout,
              'startedNs': time.time_ns(), 'pid': None, 'state': 'setup',
              'returncode': None, 'exitCode': None, 'signal': None,
              'driverSignal': None, 'platform': list(os.uname()),
              'primaryError': None, 'cleanup': [], 'receiptWrites': [],
              'childCustody': 'not-launched'}
    child = None
    stdout = stderr = None
    owned = False
    handler_installed = False
    previous_term = None
    primary = None
    secondary = []

    def failed(error):
        nonlocal primary
        if primary is None:
            primary = (error, error.__traceback__)
            record['primaryError'] = error_record(error)
            record['errorType'] = type(error).__name__
            record['error'] = str(error)
            if isinstance(error, OSError):
                record['errno'] = error.errno

    def attempt(operation, function, category='cleanup'):
        entry = {'operation': operation, 'state': 'started'}
        record[category].append(entry)
        try:
            value = function()
        except BaseException as error:
            entry.update(state='failed', error=error_record(error))
            secondary.append((error, error.__traceback__))
            return False, None
        entry['state'] = 'returned'
        return True, value

    def receipt(path, value, operation):
        # This entry is included in the saved object; the final returned/failed
        # state is also retained on any propagated exception as capture_record.
        ok, _ = attempt(operation, lambda: save(path, value), 'receiptWrites')
        if not ok:
            error, traceback = secondary[-1]
            raise error.with_traceback(traceback)

    def interrupted(signum, frame):
        record['driverSignal'] = signum
        raise InterruptedError(f'capture received signal {signum}')

    def child_status():
        code = child.returncode
        record.update(returncode=code,
                      exitCode=code if code is not None and code >= 0 else None,
                      signal=-code if code is not None and code < 0 else None,
                      childCustody='reaped' if code is not None else 'unresolved')
        return code

    def finish_child():
        if child is None:
            return
        record['childCustody'] = 'unresolved'
        attempt('poll', child.poll)
        if child_status() is None:
            attempt('terminate', child.terminate)
            attempt('wait-after-terminate', lambda: child.wait(timeout=5))
            if child_status() is None:
                attempt('kill', child.kill)
                attempt('wait-after-kill', lambda: child.wait(timeout=5))
                child_status()

    try:
        # Exclusive ownership prevents evidence-name reuse before another launch.
        (directory / f'{name}.capture').mkdir()
        owned = True
        receipt(directory / f'{name}.argv.json', argv, 'argv')
        receipt(outcome_path, record, 'setup')
        previous_term = signal.getsignal(signal.SIGTERM)
        signal.signal(signal.SIGTERM, interrupted)
        handler_installed = True
        # The child inherits raw files so bytes survive an interrupted driver.
        stdout = stdout_path.open('xb', buffering=0)
        stderr = stderr_path.open('xb', buffering=0)
        record['state'] = 'spawning'
        receipt(outcome_path, record, 'before-spawn')
        child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
        record.update(pid=child.pid, state='running', childCustody='owned')
        receipt(outcome_path, record, 'running')
        child.wait(timeout=timeout)
        child_status()
        record['state'] = 'exited' if child.returncode >= 0 else 'signalled'
    except BaseException as error:
        record['state'] = ('timeout' if isinstance(error, subprocess.TimeoutExpired)
                           else 'setup-error' if record['state'] == 'setup'
                           else 'spawn-error' if child is None
                           else 'interrupted')
        failed(error)
    finally:
        # Each operation runs once. Failures do not replace the first exception
        # or prevent the remaining bounded cleanup attempts.
        finish_child()
        if stdout is not None:
            attempt('close-stdout', stdout.close)
        if stderr is not None:
            attempt('close-stderr', stderr.close)
        if handler_installed:
            attempt('restore-sigterm', lambda: signal.signal(signal.SIGTERM, previous_term))
        if primary is None and secondary:
            failed(secondary[0][0])
            record['state'] = 'cleanup-error'
        record['finishedNs'] = time.time_ns()
        if owned:
            attempt('final', lambda: save(outcome_path, record), 'receiptWrites')
        if primary is None and secondary:
            failed(secondary[0][0])
            record['state'] = 'receipt-error'
    if primary is not None:
        error, traceback = primary
        error.capture_record = record
        raise error.with_traceback(traceback)
    return subprocess.CompletedProcess(argv, child.returncode,
                                       stdout_path.read_bytes(), stderr_path.read_bytes())
