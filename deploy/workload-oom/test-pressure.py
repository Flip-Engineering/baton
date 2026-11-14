#!/usr/bin/env python3
"""Check monitor registration and an OOM daemon kill in a bounded fixture."""
import argparse
import configparser
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import uuid


def run(argv):
    result = subprocess.run(argv, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError(str(argv) + '\n' + result.stdout + result.stderr)
    return result.stdout.strip()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--policy', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=False)
    policy = configparser.ConfigParser()
    policy.read(args.policy)
    mode = policy.get('Slice', 'ManagedOOMMemoryPressure', fallback='auto')
    identity = uuid.uuid4().hex
    slice_name = 'baton-oom-qualification-' + identity + '.slice'
    scope = 'baton-workload-oom-' + identity + '.scope'
    control = ['systemctl', '--user']
    previous = run([*control, 'show', 'app.slice', '-p', 'ManagedOOMPreference', '--value'])
    state = {'policy': str(args.policy), 'mode': mode, 'slice': slice_name, 'scope': scope,
             'controller_pid': os.getpid(), 'started_at': time.time(), 'samples': []}
    child = monitor = None
    group = None
    started = time.monotonic()
    try:
        # Keep the agent providers in app.slice outside this fixture's victim set.
        run([*control, 'set-property', '--runtime', 'app.slice', 'ManagedOOMPreference=omit'])
        run([*control, 'start', slice_name])
        run([*control, 'set-property', '--runtime', slice_name,
             'MemoryAccounting=yes', 'ManagedOOMMemoryPressure=' + mode])
        slice_group = run([*control, 'show', slice_name, '-p', 'ControlGroup', '--value'])
        dump = run(['oomctl', '--no-pager'])
        (args.output / 'oomctl.txt').write_text(dump + '\n')
        assert 'Path: ' + slice_group + '\n' in dump + '\n', 'the workload slice is absent from OOM monitoring'
        worker = args.output / 'worker.py'
        worker.write_text('import mmap,time\n'
                          'deadline=time.monotonic()+70\n'
                          'data=mmap.mmap(-1,32*1024*1024)\n'
                          'while time.monotonic()<deadline:\n'
                          ' for i in range(0,len(data),4096): data[i]=1\n')
        with (args.output / 'signals.txt').open('w') as signals, (args.output / 'worker.log').open('w') as log:
            monitor = subprocess.Popen(['stdbuf', '-oL', 'gdbus', 'monitor', '--system',
                '--dest', 'org.freedesktop.oom1', '--object-path', '/org/freedesktop/oom1'],
                stdout=signals, stderr=subprocess.STDOUT)
            argv = ['systemd-run', '--user', '--scope', '--quiet', '--unit=' + scope,
                '--slice=' + slice_name, '--property=MemoryAccounting=yes',
                '--property=MemoryHigh=4096', '--property=MemoryMax=134217728',
                '--', sys.executable, str(worker)]
            state['argv'] = argv
            child = subprocess.Popen(argv, stdout=log, stderr=subprocess.STDOUT)
            state['child_pid'] = child.pid
            while child.poll() is None and time.monotonic() - started < 80:
                if group is None:
                    observed = subprocess.run([*control, 'show', scope, '-p', 'ControlGroup', '--value'],
                                              capture_output=True, text=True)
                    if observed.returncode == 0 and observed.stdout.strip():
                        group = Path('/sys/fs/cgroup' + observed.stdout.strip())
                        state['cgroup'] = str(group)
                if group is not None:
                    sample = {'at': time.time()}
                    for name in ['memory.current', 'memory.pressure', 'memory.events']:
                        try:
                            sample[name] = (group / name).read_text()
                        except FileNotFoundError:
                            pass
                    state['samples'].append(sample)
                time.sleep(.2)
            if child.poll() is None:
                run([*control, 'set-property', '--runtime', scope, 'MemoryHigh=infinity'])
            code = child.wait(timeout=30)
            state['worker_exit'] = code
            # The daemon emits this broadcast signal with the victim and cause.
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                if identity in (args.output / 'signals.txt').read_text():
                    break
                time.sleep(.1)
            signal_text = (args.output / 'signals.txt').read_text()
            assert code == 137, 'the bounded workload was not killed: ' + str(code)
            assert identity in signal_text and 'memory-pressure' in signal_text, signal_text
            state['successful'] = True
    finally:
        if child is not None and child.poll() is None:
            subprocess.run([*control, 'set-property', '--runtime', scope, 'MemoryHigh=infinity'])
            child.wait(timeout=90)
        if monitor is not None:
            monitor.terminate()
            monitor.wait()
        subprocess.run([*control, 'stop', slice_name], capture_output=True)
        subprocess.run([*control, 'set-property', '--runtime', 'app.slice',
                        'ManagedOOMPreference=' + previous], check=True)
        state['finished_at'] = time.time()
        (args.output / 'result.json').write_text(json.dumps(state, indent=2) + '\n')


if __name__ == '__main__':
    main()
