"""Completion output failure keeps the queued continuation joined."""
import json
import importlib.util
import os
import pathlib
import select
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
FIXTURE = ROOT / '.scratch/bend2/receive-output'
CONTROL = ROOT / '.scratch/bend2/control-output'
GATE = '''import json,os,pathlib,socket,sys
home=pathlib.Path(__file__).resolve().parent
sock=socket.create_connection(('127.0.0.1',int((home/'port').read_text())))
stream=sock.makefile('rwb',buffering=0)
stream.write((json.dumps({'gate':sys.argv[1],'pid':os.getpid(),'ppid':os.getppid()})+'\\n').encode())
assert stream.readline()==b'release\\n'
stream.close();sock.close()
sys.exit(int((home/'delivery-status').read_text()) if sys.argv[1]=='delivery' else 0)
'''


class ReceiveOutput(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not EXE.exists():
            raise unittest.SkipTest(f'Coordinator not built at {EXE}')
        env = os.environ.copy()
        for source, output in [('receive-output', FIXTURE), ('control-output', CONTROL)]:
            result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                     f'bend2/test/{source}.bend', str(output)],
                                    cwd=ROOT, env=env, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)

    def test_failed_output_does_not_poison_empty_or_successful_output(self):
        with tempfile.TemporaryDirectory(prefix='control-output-', dir=ROOT / '.scratch/bend2') as name:
            result = subprocess.run([str(CONTROL)], cwd=name, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            observed = (pathlib.Path(name) / 'results').read_text().splitlines()
            self.assertEqual(len(observed), 4)
            self.assertIn('Could not write coordinator control output.', observed[0])
            self.assertEqual(observed[1], 'done')
            self.assertIn('Could not write coordinator control output.', observed[2])
            self.assertEqual(observed[3], 'done')
            self.assertEqual(result.stdout, 'after failure: café λ\n')
            self.assertEqual(result.stderr, '')
            print(json.dumps({'test': self.id(), 'coordinatorExit': result.returncode,
                              'results': observed, 'stdout': result.stdout, 'stderr': result.stderr}))

    def exercise(self, broken, delivery_status=0):
        with tempfile.TemporaryDirectory(prefix='receive-output-', dir=ROOT / '.scratch/bend2') as name:
            directory = pathlib.Path(name)
            server = socket.socket()
            server.bind(('127.0.0.1', 0))
            server.listen()
            (directory / 'port').write_text(str(server.getsockname()[1]))
            (directory / 'delivery-status').write_text(str(delivery_status))
            (directory / 'gate.py').write_text(GATE)
            database = directory / 'state.db'

            def coord(*args):
                result = subprocess.run([str(EXE), str(database), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return result.stdout

            coord('attach', 'root', 'codex', 'native-root', '')
            coord('role', 'root', 'principal-conductor')
            coord('attach', 'parent', 'codex', 'native-parent', '')
            with sqlite3.connect(database) as connection:
                connection.execute("UPDATE sessions SET parent='root' WHERE id='parent'")
            coord('report', 'completed', 'parent', 'Exact completion bytes: café λ.')
            coord('message', 'queued', 'root', 'parent', 'task', 'Queued work.')
            coord('connect', 'root', 'native-root',
                  json.dumps([sys.executable, str(directory / 'gate.py'), 'delivery']))
            expected = coord('delivery', 'completed')
            done_read, done_write = socket.socketpair()
            gates = {}
            child = None
            try:
                with (directory / 'stderr').open('w') as stderr:
                    child = subprocess.Popen([str(FIXTURE)], cwd=directory,
                                             stdout=subprocess.PIPE, stderr=stderr)

                def exited():
                    child.wait()
                    done_write.sendall(b'exited')

                waiter = threading.Thread(target=exited)
                waiter.start()

                def accept_gate():
                    ready, _, _ = select.select([server, done_read], [], [])
                    self.assertIn(server, ready,
                                  f'Coordinator exit {child.poll()} before gate: '
                                  + (directory / 'stderr').read_text())
                    connection, _ = server.accept()
                    stream = connection.makefile('rwb', buffering=0)
                    event = json.loads(stream.readline())
                    self.assertEqual(event['ppid'], child.pid)
                    self.assertNotIn(event['gate'], gates)
                    gates[event['gate']] = (stream, connection)
                    return event['gate']

                self.assertEqual({accept_gate(), accept_gate()}, {'delivery', 'continuation'})
                if broken:
                    child.stdout.close()
                gates['delivery'][0].write(b'release\n')
                self.assertEqual(gates['delivery'][0].readline(), b'')
                self.assertEqual(accept_gate(), 'acknowledged')
                self.assertTrue((directory / 'acknowledged').exists())
                self.assertIsNone(child.poll())
                self.assertFalse((directory / 'continued').exists())
                gates['acknowledged'][0].write(b'release\n')
                self.assertEqual(gates['acknowledged'][0].readline(), b'')
                gates['continuation'][0].write(b'release\n')
                self.assertEqual(gates['continuation'][0].readline(), b'')
                child.wait()
                waiter.join()
                self.assertTrue((directory / 'continued').exists())
                joined = (directory / 'joined').read_text()
                if delivery_status:
                    self.assertEqual(child.returncode, 1)
                    self.assertIn('session delivery failed', joined)
                elif broken:
                    self.assertNotEqual(child.returncode, 0)
                    self.assertIn('Could not write coordinator control output.', joined)
                else:
                    self.assertEqual(child.returncode, 0, (directory / 'stderr').read_text())
                    self.assertEqual(joined, 'done')
                    self.assertEqual(child.stdout.read().decode(), expected)
                self.assertNotIn('short write on a standard stream', (directory / 'stderr').read_text())
                print(json.dumps({'test': self.id(), 'coordinatorExit': child.returncode,
                                  'stderr': (directory / 'stderr').read_text(),
                                  'completionResult': joined,
                                  'continuationCompleted': (directory / 'continued').exists()}))
            finally:
                for stream, connection in gates.values():
                    try:
                        stream.write(b'release\n')
                    except OSError:
                        pass
                    stream.close()
                    connection.close()
                server.close()
                if child is not None and child.poll() is None:
                    child.terminate()
                    child.wait()
                if child is not None:
                    waiter.join()
                    if child.stdout and not child.stdout.closed:
                        child.stdout.close()
                done_read.close()
                done_write.close()

    def test_successful_output_preserves_bytes_and_joins_continuation(self):
        self.exercise(False)

    def test_closed_output_acknowledges_and_joins_continuation(self):
        self.exercise(True)

    def test_delivery_failure_precedes_output_failure_after_continuation(self):
        self.exercise(True, delivery_status=7)


SPEC = importlib.util.spec_from_file_location('receive_fixture', ROOT / 'bend2/test/receive.py')
RECEIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECEIVE)


class NativeFailureOutput(unittest.TestCase):
    def test_native_failure_prepares_report_with_closed_output_and_drains_queued_work(self):
        fixture = RECEIVE.Receive()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        with fixture.fixture.open('a') as script:
            script.write("\nsys.exit(7 if globals().get('failure', False) else 0)\n")
        fixture.coord('connect', 'root', 'native-root', json.dumps([str(fixture.fixture), 'parent_endpoint']))
        fixture.player(harness='omp')
        fixture.coord('message', 'first', 'root', 'parent', 'task', 'Fail the first task.')
        observer = fixture.spawn(*fixture.receive_args('parent'))
        original, started = fixture.accept_or_child_exit(
            observer, 'Initial native did not start', observer.stdout)
        self.assertEqual(started['session'], 'parent')
        with sqlite3.connect(fixture.db) as database:
            ident, directory = database.execute(
                "SELECT id,directory FROM executions WHERE session='parent'").fetchone()
        attempt = pathlib.Path(directory)
        fixture.coord('message', 'second', 'root', 'parent', 'task', 'Complete the queued task.')
        observer.stdout.close()
        observer.stdout = None
        fixture.action(original, fail=True, body='Original native failure retained.')
        self.assertEqual(original.readline(), b'')
        continuation, resumed = fixture.accept_or_child_exit(
            observer, 'Queued native did not start', observer.stderr)
        self.assertEqual(resumed['session'], 'parent')
        self.assertIn('[id: second]', resumed['prompt'])
        observer_status = observer.poll()
        if observer_status is not None:
            observer_stderr = observer.stderr.read() if observer.stderr is not None else ''
            self.fail('Output failure ended the observer before queued work finished; '
                      f'exit={observer_status}; stderr={observer_stderr}')
        report = json.loads(fixture.coord('delivery', ident)['body'])
        self.assertTrue(report['is_error'])
        self.assertEqual(report['messages'][0]['content'][0]['text'], 'Original native failure retained.')
        failure = fixture.coord('delivery', ident + ':exit')
        self.assertIn('Player process ended with exit ', failure['body'])
        self.assertNotEqual((attempt / 'status').read_text().strip(), '0')
        native_status = int((attempt / 'status').read_text().strip())
        self.assertEqual(os.waitstatus_to_exitcode(native_status), 7)
        fixture.action(continuation, body='Queued task completed after failure preparation.')
        self.assertEqual(continuation.readline(), b'')
        _, stderr = fixture.finish(observer, ok=False)
        self.assertIn('Could not write coordinator control output.', stderr)
        self.assertNotIn('short write on a standard stream', stderr)
        self.assertEqual(fixture.coord('inbox', 'parent'), [])
        self.assertEqual(fixture.coord('inbox', 'root'), [])
        self.assertTrue((attempt / 'released').exists())
        self.assertFalse((attempt / 'acknowledged').exists(),
                         'A failed native outcome must keep its retained attempt available for recovery.')
        fixture.shutdown_idle_database_owner('The fixture retained a process after completion.')
        print(json.dumps({'test': self.id(), 'coordinatorExit': observer.returncode,
                          'nativeWaitStatus': native_status,
                          'nativeExit': os.waitstatus_to_exitcode(native_status), 'stderr': stderr,
                          'retainedFailure': failure['body'], 'continuationCompleted': True}))

    def test_direct_replay_with_closed_output_releases_and_wakes_queued_input(self):
        fixture = RECEIVE.Receive()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        fixture.coord('connect', 'root', 'native-root', json.dumps([str(fixture.fixture), 'parent_endpoint']))
        fixture.player()
        fixture.coord('report', 'completed-direct', 'parent', 'Stored direct report.')
        fixture.prepare_input('queued-direct', 'parent', 'Queued after direct completion.',
                              kind='task')
        fixture.coord('connect', 'parent', 'native-parent', fixture.endpoint('parent'))
        read_fd, write_fd = os.pipe()
        os.close(read_fd)
        try:
            child = subprocess.Popen([str(EXE), str(fixture.db), 'turn', 'parent', 'completed-direct',
                                      str(fixture.fixture), 'parent', 'low', str(fixture.directory),
                                      str(fixture.directory / 'unused-task'),
                                      str(fixture.directory / 'direct.jsonl'), 'native-parent'],
                                     stdout=write_fd, stderr=subprocess.PIPE, text=True)
        finally:
            os.close(write_fd)
        fixture.children.append(child)
        continuation, resumed = fixture.accept_or_child_exit(
            child, 'Direct replay did not wake queued input', child.stderr)
        self.assertEqual(resumed['session'], 'parent')
        self.assertIn('[id: queued-direct]', resumed['prompt'])
        self.assertEqual(resumed['native'], 'native-parent')
        self.assertIsNone(child.poll())
        fixture.action(continuation, body='Queued input after direct replay completed.')
        self.assertEqual(continuation.readline(), b'')
        _, stderr = fixture.finish(child, ok=False)
        self.assertIn('Could not write coordinator control output.', stderr)
        self.assertNotIn('short write on a standard stream', stderr)
        self.assertEqual(fixture.coord('delivery', 'completed-direct')['body'], 'Stored direct report.')
        self.assertEqual(fixture.coord('player', 'parent')['native'], 'native-parent')
        self.assertEqual(fixture.coord('inbox', 'parent'), [])
        self.assertEqual(fixture.coord('inbox', 'root'), [])
        fixture.shutdown_idle_database_owner('Direct replay left a fixture process.')
        print(json.dumps({'test': self.id(), 'coordinatorExit': child.returncode,
                          'stderr': stderr, 'queuedInputCompleted': True,
                          'nativeIdentity': resumed['native']}))


if __name__ == '__main__':
    unittest.main()
