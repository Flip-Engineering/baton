"""Exercise recovery driver observations with controlled local subprocesses."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
TEXT = 'Initial Unicode cause Ω:\n' + 'é漢λ ' * 1024 + '\nFinal Unicode cause 🚦.'
OBSERVATIONS = []


def load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


acceptance = load('recovery_acceptance_driver', 'bend2/scripts/accept-receive-recovery.py')
models = load('recovery_model_driver', 'docs/bend2/examples/probe-recovery-real-models.py')
host = load('recovery_host_driver', 'docs/bend2/examples/probe-host-restart.py')


class RecoveryDrivers(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='recovery-driver-', dir=ROOT / '.scratch/bend2')
        self.directory = Path(self.temp.name)
        self.addCleanup(self.temp.cleanup)
        self.children = []
        self.observers = []
        self.addCleanup(self.reap)

    def start(self, source, *args):
        script = self.directory / ('child-' + str(len(self.children)) + '.py')
        script.write_text(source)
        child = subprocess.Popen([sys.executable, str(script), *map(str, args)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def reap(self):
        for child in self.children:
            stdout, stderr = child.communicate()
            OBSERVATIONS.append({'child_pid': child.pid, 'exit': child.returncode,
                                 'stdout': stdout, 'stderr': stderr})
        for observer in self.observers:
            observer.join()

    def listener(self):
        server = socket.socket()
        server.bind(('127.0.0.1', 0))
        server.listen()
        fixture = SimpleNamespace(server=server, controls=[], directory=self.directory)
        def close():
            for stream, connection in fixture.controls:
                stream.close()
                connection.close()
            server.close()
        self.addCleanup(close)
        return fixture

    def thread(self, function):
        answer = {}
        def run():
            try:
                answer['value'] = function()
            except BaseException as error:
                answer['error'] = error
        observer = threading.Thread(target=run)
        observer.start()
        self.observers.append(observer)
        return observer, answer

    def test_full_unicode_command_failure(self):
        pid = self.directory / 'diagnostic.pid'
        source = ('import os,pathlib,sys; pathlib.Path(sys.argv[1]).write_text(str(os.getpid())); '
                  'sys.stderr.write(sys.argv[2]); raise SystemExit(17)')
        with self.assertRaises(RuntimeError) as caught:
            acceptance.command([sys.executable, '-c', source, str(pid), TEXT])
        self.assertEqual(str(caught.exception), f'{sys.executable} exited 17: {TEXT}')
        OBSERVATIONS.append({'name': self.id(), 'child_pid': int(pid.read_text()),
                             'exit': 17, 'expected_stderr': TEXT, 'error': str(caught.exception)})

    def test_launch_record_after_producer_completion(self):
        record = self.directory / 'launches.jsonl'
        child = self.start('''import json,os,pathlib,subprocess,sys
writer="import json,os,pathlib,sys; pathlib.Path(sys.argv[1]).write_text(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'argv':sys.argv})+chr(10))"
subprocess.run([sys.executable,'-c',writer,sys.argv[1]],check=True)
''', record)
        self.assertEqual(child.wait(), 0)
        answer = models.harness_argv({'launchRecord': record}, child)
        self.assertEqual(answer, [json.loads(record.read_text())])
        self.assertEqual(answer[0]['ppid'], child.pid)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'launches': answer})

    def test_producer_exit_before_launch_record(self):
        child = self.start('raise SystemExit(17)')
        self.assertEqual(child.wait(), 17)
        with self.assertRaises(RuntimeError) as caught:
            models.harness_argv({'launchRecord': self.directory / 'absent.jsonl'}, child)
        self.assertIn(f'{child.pid} exited 17 without its launch record', str(caught.exception))
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'error': str(caught.exception)})

    def test_delayed_launch_is_released_explicitly(self):
        record = self.directory / 'launches.jsonl'
        child = self.start('''import subprocess,sys
print('ready',flush=True)
sys.stdin.readline()
writer="import json,os,pathlib,sys; pathlib.Path(sys.argv[1]).write_text(json.dumps({'pid':os.getpid(),'ppid':os.getppid(),'argv':sys.argv})+chr(10))"
subprocess.run([sys.executable,'-c',writer,sys.argv[1]],check=True)
''', record)
        self.assertEqual(child.stdout.readline(), 'ready\n')
        inspected = threading.Event()
        original = models.wait_for
        def observe(predicate):
            def sample():
                value = predicate()
                inspected.set()
                return value
            return original(sample)
        with patch.object(models, 'wait_for', observe):
            observer, answer = self.thread(lambda: models.harness_argv({'launchRecord': record}, child))
            inspected.wait()
            self.assertIsNone(child.poll())
            self.assertTrue(observer.is_alive())
            child.stdin.write('release\n')
            child.stdin.flush()
            observer.join()
        self.assertNotIn('error', answer)
        self.assertEqual(answer['value'], [json.loads(record.read_text())])
        self.assertEqual(child.wait(), 0)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'launches': answer['value']})

    def test_host_producer_exit_without_startup(self):
        fixture = self.listener()
        child = self.start('raise SystemExit(17)', self.directory)
        self.assertEqual(child.wait(), 17)
        with self.assertRaises(RuntimeError) as caught:
            host.accept_any(fixture, child)
        self.assertIn(f'{child.pid} exited 17 without a native startup frame', str(caught.exception))
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'error': str(caught.exception)})

    def test_host_startup_eof(self):
        fixture = self.listener()
        address = fixture.server.getsockname()
        child = self.start('''import socket,sys
with socket.create_connection(('127.0.0.1',int(sys.argv[1]))): pass
''', address[1], self.directory)
        with self.assertRaisesRegex(RuntimeError, 'closed before its frame'):
            host.accept_any(fixture, child)
        self.assertEqual(child.wait(), 0)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'observed_eof': True})

    def test_ready_startup_precedes_absence_inspection(self):
        fixture = self.listener()
        child = self.start('''import json,os,socket,sys
with socket.create_connection(('127.0.0.1',int(sys.argv[1]))) as stream:
    stream.sendall((json.dumps({'pid':os.getpid(),'session':'controlled','prompt':sys.argv[2]})+'\\n').encode())
''', fixture.server.getsockname()[1], TEXT, self.directory)
        self.assertEqual(child.wait(), 0)
        with patch.object(host, 'owned_processes', side_effect=AssertionError('Ready event must be read first')):
            _, started = host.accept_any(fixture, child)
        self.assertEqual(started['prompt'], TEXT)
        self.assertEqual(started['pid'], child.pid)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': child.pid, 'frame': started})

    def test_surviving_owned_process_preserves_startup_wait(self):
        fixture = self.listener()
        producer = self.start('raise SystemExit(17)')
        self.assertEqual(producer.wait(), 17)
        continuation = self.start('''import json,os,socket,sys
print('ready',flush=True)
sys.stdin.readline()
with socket.create_connection(('127.0.0.1',int(sys.argv[1]))) as stream:
    stream.sendall((json.dumps({'pid':os.getpid(),'session':'controlled','prompt':sys.argv[2]})+'\\n').encode())
''', fixture.server.getsockname()[1], TEXT, self.directory)
        self.assertEqual(continuation.stdout.readline(), 'ready\n')
        inspected = threading.Event()
        original = host.owned_processes
        def observe(directory):
            try:
                rows = original(directory)
            finally:
                inspected.set()
            return rows
        with patch.object(host, 'owned_processes', observe):
            observer, answer = self.thread(lambda: host.accept_any(fixture, producer))
            inspected.wait()
            self.assertTrue(observer.is_alive())
            continuation.stdin.write('release\n')
            continuation.stdin.flush()
            observer.join()
        self.assertNotIn('error', answer)
        self.assertEqual(answer['value'][1]['pid'], continuation.pid)
        self.assertEqual(answer['value'][1]['prompt'], TEXT)
        self.assertEqual(continuation.wait(), 0)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': producer.pid,
                             'continuation_pid': continuation.pid, 'frame': answer['value'][1]})

    def test_failed_process_inspection_preserves_error(self):
        fixture = self.listener()
        producer = self.start('raise SystemExit(17)')
        self.assertEqual(producer.wait(), 17)
        binary = self.directory / 'bin'
        binary.mkdir()
        executable = binary / 'ps'
        executable.write_text('#!' + sys.executable + '\nimport sys\nsys.stderr.write(' + repr(TEXT) + ')\nraise SystemExit(19)\n')
        executable.chmod(0o755)
        with patch.dict(os.environ, {'PATH': str(binary) + os.pathsep + os.environ['PATH']}):
            with self.assertRaises(subprocess.CalledProcessError) as caught:
                host.accept_any(fixture, producer)
        self.assertEqual(caught.exception.returncode, 19)
        self.assertEqual(caught.exception.stderr, TEXT)
        OBSERVATIONS.append({'name': self.id(), 'producer_pid': producer.pid,
                             'inspection_exit': 19, 'stderr': caught.exception.stderr})

    @unittest.skipUnless(EXE.exists(), 'Native coordinator is required')
    def test_actual_coordinator_call_preserves_pending_input(self):
        db = self.directory / 'state.db'
        with patch.object(models, 'EXE', EXE):
            models.coord(db, 'attach', 'root', 'terminal', '', '')
            models.coord(db, 'role', 'root', 'principal-conductor')
            models.coord(db, 'attach', 'operator', 'terminal', '', '')
            models.coord(db, 'role', 'operator', 'operator')
            models.coord(db, 'message', 'pending', 'operator', 'root', 'task', TEXT)
            inbox = models.coord(db, 'inbox', 'root')
        self.assertEqual(inbox[0]['body'], TEXT)
        self.assertEqual(inbox[0]['id'], 'pending')
        with sqlite3.connect(db) as stored:
            self.assertEqual(stored.execute('SELECT native FROM sessions WHERE id=?', ('root',)).fetchone()[0], '')
            self.assertEqual(stored.execute('SELECT body,receipt FROM messages WHERE id=?', ('pending',)).fetchone(), (TEXT, None))
        OBSERVATIONS.append({'name': self.id(), 'inbox': inbox})

    @unittest.skipUnless(EXE.exists(), 'Native coordinator is required')
    def test_cleanup_after_observer_loss(self):
        fixture = host.receive.Receive()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        host.report_pid(fixture)
        fixture.player('controlled')
        fixture.message('pending', 'controlled', TEXT)
        observer = fixture.spawn(*fixture.receive_args('controlled'))
        _, started = host.accept_any(fixture, observer)
        observer.kill()
        observer.wait()
        before = fixture.owned_processes()
        self.assertTrue(any(row['pid'] == started['pid'] for row in before))
        fixture.close_children()
        self.assertEqual(fixture.owned_processes(), [])
        self.assertTrue(all(child.poll() is not None for child in fixture.children))
        OBSERVATIONS.append({'name': self.id(), 'observer_pid': observer.pid,
                             'observer_exit': observer.returncode, 'native_frame': started,
                             'owned_before_cleanup': before, 'owned_after_cleanup': []})

    @unittest.skipUnless(EXE.exists(), 'Native coordinator is required')
    def test_host_recovery_retains_complete_prompts(self):
        original = host.receive.Receive.message
        def message(fixture, ident, recipient, body='Review this input.'):
            return original(fixture, ident, recipient, body + '\n' + TEXT)
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(host.receive.Receive, 'message', message), contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            status = host.main()
        self.assertEqual(status, 0, stderr.getvalue())
        report = json.loads(stdout.getvalue())
        self.assertEqual(report['failures'], [])
        self.assertEqual(report['afterCompletion']['ownedProcesses'], [])
        for name, session in report['sessions'].items():
            self.assertEqual(session['secondInvocation']['status'], 'queued')
            self.assertEqual(session['inboxAfter'], [])
            pending = [start for start in session['starts'] if '[id: pending-' + name + ']' in start['prompt']]
            self.assertTrue(pending)
            self.assertTrue(all(TEXT in start['prompt'] for start in pending))
        OBSERVATIONS.append({'name': self.id(), 'exit': status, 'stdout': stdout.getvalue(), 'stderr': stderr.getvalue()})


if __name__ == '__main__':
    unittest.main()
