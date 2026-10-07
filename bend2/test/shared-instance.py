"""One shared custody owner serves concurrent attempts on one database.

The owner holds every attempt's stdin writer, wait authority and stdout spool.
These tests exercise concurrent attempts, an owner that starts once per
database, observer loss with the owner alive, database-binding refusals, the
retired-capability refusal and owner shutdown.
"""
import json
import os
import pathlib
import queue
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/instance-test'

FIXTURE = r'''import json,os,sys
print(json.dumps({"role":"native","pid":os.getpid(),"ppid":os.getppid()}),flush=True)
for line in sys.stdin:
    if line.strip()=="exit": break
    print("echo:"+line.strip(),flush=True)
print("native-done",flush=True)
'''


class SharedInstance(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="b2 shared instance's ")
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.db = self.home / 'instance.db'
        self.db.touch()
        self.fixture = self.home / 'native.py'
        self.fixture.write_text(FIXTURE)
        self.children = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        subprocess.run([str(EXE), 'shutdown', str(self.db)], capture_output=True,
                       text=True, timeout=10)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and self.owner_processes():
            time.sleep(.02)
        for line in self.owner_processes():
            pid = int(line.split()[0])
            for sig in [signal.SIGKILL]:
                try:
                    os.kill(pid, sig)
                except ProcessLookupError:
                    pass
        for child in self.children:
            if child.poll() is None:
                child.kill()
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            child.wait(timeout=10)
            child.stdout.close()
            child.stderr.close()

    # -- harness ----------------------------------------------------------

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), *map(str, args)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        child.lines = queue.Queue()
        child.output = []

        def read():
            for line in child.stdout:
                child.output.append(line)
                child.lines.put(line.rstrip('\n'))
            child.lines.put(None)

        threading.Thread(target=read, daemon=True).start()
        return child

    def line(self, child, expected):
        while True:
            value = child.lines.get(timeout=30)
            self.assertIsNotNone(value, ''.join(child.output))
            if value == expected:
                return

    def wait_run(self, child):
        child.stdin.close()
        child.wait(timeout=60)
        self.assertEqual(child.returncode, 0, child.stderr.read())
        return ''.join(child.output)

    def command(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], capture_output=True,
                              text=True, timeout=30)

    def begin(self, label, session=None, mode='admit', payload='hello\n'):
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        child = self.spawn(mode, self.db, session or label, directory, self.home,
                           payload, sys.executable, self.fixture)
        return directory, child

    def native(self, output):
        for line in output.splitlines():
            if line.startswith('{'):
                return json.loads(line)
        self.fail('no native summary in ' + output)

    def owner_processes(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,command='], capture_output=True,
                                text=True, timeout=10)
        return [line for line in result.stdout.splitlines()
                if '--instance-owner' in line and str(self.db) in line]

    def write(self, directory, text):
        path = self.home / 'control.payload'
        path.write_text(text)
        result = self.command('control-write', directory, path)
        self.assertIn('control-write-complete', result.stdout, result.stderr)

    def hold(self, path, expected, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists() and expected in path.read_text(errors='replace'):
                return path.read_text(errors='replace')
            time.sleep(.05)
        self.fail(f'{expected!r} never reached {path}: ' +
                  (path.read_text(errors='replace') if path.exists() else 'missing'))

    # -- tests ------------------------------------------------------------

    def test_concurrent_attempts_share_one_owner_process(self):
        runs = [self.begin(f'a{index}', session=f's{index}', payload=f'hello-{index}\n')
                for index in range(3)]
        outputs = [self.wait_run(child) for _, child in runs]
        for index, output in enumerate(outputs):
            self.assertIn('admitted', output)
            self.assertIn(f'echo:hello-{index}', output)
            self.assertIn('native-done', output)
            self.assertIn('native-exit 0', output)
            self.assertIn('release-ok', output)
            self.assertIn('acknowledge-ok', output)
            self.assertIn('attempt-complete', output)
            for other in range(3):
                if other != index:
                    self.assertNotIn(f'echo:hello-{other}', output)
        summaries = [self.native(output) for output in outputs]
        parents = {summary['ppid'] for summary in summaries}
        self.assertEqual(len(parents), 1, summaries)
        self.assertNotIn(os.getpid(), parents)
        owners = self.owner_processes()
        self.assertEqual(len(owners), 1, owners)
        owner_pid = int(owners[0].split()[0])
        self.assertEqual(parents, {owner_pid}, (owners, summaries))
        print('evidence owner', owners[0].strip())
        print('evidence natives', [summary['pid'] for summary in summaries])
        print('evidence outputs', [output.replace('\n', '|') for output in outputs])

    def test_second_owner_for_one_database_is_refused(self):
        directory, child = self.begin('a0')
        self.line(child, 'admitted')
        result = self.command('owner-try', self.db)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owner-refused:', result.stdout)
        self.assertIn('busy', result.stdout.lower())
        self.assertEqual(len(self.owner_processes()), 1)
        print('evidence second-owner', result.stdout.strip())

    def test_multiply_linked_database_is_refused(self):
        link = self.home / 'alias.db'
        os.link(self.db, link)
        result = self.command('owner-try', link)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('owner-refused:', result.stdout)
        self.assertIn('link', result.stdout.lower())
        print('evidence multiply-linked', result.stdout.strip())

    def test_observer_loss_keeps_native_work_and_retained_output(self):
        directory, child = self.begin('held', mode='hold', payload='one\n')
        self.line(child, 'admitted')
        spool = directory / 'stdout'
        self.hold(spool, 'echo:one')
        summary = self.native(spool.read_text(errors='replace'))
        child.kill()
        child.wait(timeout=10)
        os.kill(summary['pid'], 0)
        log = directory / 'observer.log'
        text = self.hold(log, 'echo:one')
        self.assertIn('"role": "native"', text)
        self.write(directory, 'two\n')
        self.hold(log, 'echo:two')
        self.write(directory, 'exit\n')
        self.hold(log, 'native-exit 0')
        print('evidence native-pid', summary['pid'], 'alive-after-observer-kill', True)
        print('evidence recovery-log', text.replace('\n', '|'))

    def test_retired_capability_refuses_the_old_generation(self):
        directory, child = self.begin('cycle')
        output = self.wait_run(child)
        self.assertIn('retire-ok', output)
        self.assertIn('stale-write-failed:', output)
        self.assertNotIn('stale-write-ok', output)
        print('evidence retirement', output.replace('\n', '|'))

    def test_shutdown_releases_the_database_for_a_new_owner(self):
        directory, child = self.begin('a0')
        self.wait_run(child)
        self.assertEqual(len(self.owner_processes()), 1)
        result = self.command('shutdown', self.db)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('shutdown-ok', result.stdout)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self.owner_processes():
            time.sleep(.05)
        self.assertEqual(self.owner_processes(), [])
        directory, second = self.begin('b0', payload='again\n')
        output = self.wait_run(second)
        self.assertIn('echo:again', output)
        self.assertEqual(len(self.owner_processes()), 1)
        print('evidence after-shutdown', self.owner_processes()[0].strip())
        print('evidence new-attempt', output.replace('\n', '|'))


if __name__ == '__main__':
    unittest.main()
