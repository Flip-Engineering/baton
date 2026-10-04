"""Completion output failure keeps the queued continuation joined."""
import json
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
        result = subprocess.run(['sh', 'bend2/scripts/build-native.sh',
                                 'bend2/test/receive-output.bend', str(FIXTURE)],
                                cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

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
                    ready, _, _ = select.select([server, done_read], [], [], 10)
                    self.assertIn(server, ready,
                                  f'Coordinator exit {child.poll()} before gate: '
                                  + (directory / 'stderr').read_text())
                    connection, _ = server.accept()
                    connection.settimeout(10)
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
                child.wait(timeout=10)
                waiter.join(timeout=10)
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
                    child.wait(timeout=10)
                if child is not None:
                    waiter.join(timeout=10)
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


if __name__ == '__main__':
    unittest.main()
