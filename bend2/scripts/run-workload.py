#!/usr/bin/env python3
"""Admit a test and its disposable services through the shared host queue."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import uuid


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inside', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command
    if command[:1] == ['--']:
        command = command[1:]
    if not command:
        parser.error('a command is required after --')
    if sys.platform != 'linux':
        parser.error('the workload queue requires Linux cgroup v2 and a user systemd manager')
    script = Path(__file__).resolve()
    invocation = uuid.uuid4().hex
    if not args.inside:
        os.environ.setdefault('XDG_RUNTIME_DIR', '/run/user/' + str(os.getuid()))
        os.execvp('systemd-run', ['systemd-run', '--user', '--scope', '--quiet',
            '--unit=baton-workload-' + invocation, '--slice=baton-workloads.slice',
            '--property=MemoryAccounting=yes', '--', sys.executable, str(script),
            '--inside', '--', *command])
    group = Path('/proc/self/cgroup').read_text().strip().removeprefix('0::')
    if not (Path(group).name.startswith('baton-workload-') and group.endswith('.scope')):
        parser.error('the queue must run in its dedicated workload scope')
    state = Path(os.environ.get('BATON_COMPILE_QUEUE_ROOT', '/var/tmp/baton2-compile-queue'))
    client = os.environ.get('BATON2_COMPILE_QUEUE_BIN', str(state / 'compile-queue-runner'))
    executable = shutil.which(command[0])
    if executable is None:
        parser.error('command is unavailable: ' + command[0])
    cwd = Path.cwd()
    evidence = cwd / '.scratch' / 'workloads' / invocation
    evidence.mkdir(parents=True)
    receipt = evidence / 'receipt'
    request = [client, '--', 'run', '--kind', 'workload', '--state-root', str(state),
        '--cwd', str(cwd), '--root', str(cwd), '--source-root', str(cwd),
        '--compiler', executable, '--receipt', str(receipt), '--token', invocation,
        '--option', 'invocation=' + invocation, '--per-run', 'invocation=' + invocation,
        '--input', str(script), '--', *command]
    print('workload evidence: ' + str(evidence), file=sys.stderr, flush=True)
    keyed = subprocess.run([request[0], '--', 'key', *request[3:]], capture_output=True)
    if keyed.returncode:
        sys.stdout.buffer.write(keyed.stdout)
        sys.stderr.buffer.write(keyed.stderr)
        return keyed.returncode
    keydir = state / 'keys' / keyed.stdout.decode().strip()
    key = keydir.name
    offsets = {'stdout': 0, 'stderr': 0}
    attempt = None
    high_applied = False

    def apply_memory_high():
        nonlocal high_applied
        if high_applied:
            return
        for claim in (state / 'admission/running').glob('*'):
            if not claim.is_file():
                continue
            try:
                values = dict(line.split('=', 1) for line in claim.read_text().splitlines() if '=' in line)
            except FileNotFoundError:
                continue
            if values.get('key') != key:
                continue
            measured = int(values['expected_kb'])
            if not measured:
                # A host with no history establishes its first peak alone.
                measured = int(next(line.split()[1] for line in
                    Path('/proc/meminfo').read_text().splitlines() if line.startswith('MemAvailable:')))
            subprocess.run(['systemctl', '--user', 'set-property', '--runtime',
                Path(group).name, 'MemoryHigh=' + str(measured * 1024)], check=True)
            print('workload memory.high: ' + str(measured) + ' KiB', file=sys.stderr, flush=True)
            high_applied = True
            return

    def drain():
        nonlocal attempt
        if attempt is None:
            attempts = list(keydir.glob('runs/*'))
            if attempts:
                attempt = attempts[0]
        if attempt is None:
            return
        for name, stream in (('stdout', sys.stdout.buffer), ('stderr', sys.stderr.buffer)):
            try:
                with (attempt / name).open('rb') as source:
                    source.seek(offsets[name])
                    shutil.copyfileobj(source, stream)
                    offsets[name] = source.tell()
                stream.flush()
            except FileNotFoundError:
                pass

    with (evidence / 'queue.stdout').open('wb') as out, (evidence / 'queue.stderr').open('wb') as err:
        child = subprocess.Popen(request, stdout=out, stderr=err)
        try:
            while child.poll() is None:
                apply_memory_high()
                drain()
                time.sleep(.1)
        except BaseException:
            subprocess.run([client, '--', 'cancel', '--state-root', str(state),
                '--key', key, '--token', invocation], check=True)
            child.wait()
            drain()
            raise
        code = child.wait()
    drain()
    if code and (attempt is None or not (attempt / 'result').exists()):
        for name, stream in (('queue.stdout', sys.stdout.buffer), ('queue.stderr', sys.stderr.buffer)):
            with (evidence / name).open('rb') as source:
                shutil.copyfileobj(source, stream)
            stream.flush()
    return code


if __name__ == '__main__':
    raise SystemExit(main())
