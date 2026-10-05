"""Exercise keeper recovery retry with controlled fresh host processes.

Set BATON2_PROCESS_EXE to the compiled test/process.bend fixture and
BATON2_PROCESS_C to its generated C. The second artifact intercepts pthread_create
only for recovery waiters; production source and native spawning stay intact.
No coordinator admission, delivery, or public direct startup is qualified.
"""
import errno
import json
import os
from pathlib import Path
import signal
import select
import socket
import subprocess
import sys
import tempfile
import time
import unittest

EXE = Path(os.environ.get('BATON2_PROCESS_EXE', '.scratch/bend2/process-test')).resolve()
SOURCE = Path(os.environ.get('BATON2_PROCESS_C', '.scratch/bend2/process-test.c')).resolve()

SCRIPT = '''#!{python}
import json,os,socket,sys
s=socket.create_connection(('127.0.0.1',{port}))
f=s.makefile('rwb',buffering=0)
f.write((json.dumps({{'role':{role!r},'pid':os.getpid(),'ppid':os.getppid()}})+'\\n').encode())
a=f.readline().decode().strip()
f.close();s.close()
if a=='attach': os.execv({exe!r},[{exe!r},'recover-retained',sys.argv[1]])
if a=='finish': print('native-finished',flush=True);sys.exit(0)
sys.exit(7)
'''


class Retry(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.build = tempfile.TemporaryDirectory(prefix='retained-waiter-fault-')
        cls.addClassCleanup(cls.build.cleanup)
        source = SOURCE.read_text()
        start = '#include <errno.h>\n#include <fcntl.h>\n#include <spawn.h>\n#include <sys/wait.h>'
        end = 'static void __attribute__((constructor)) baton_process_signals(void){signal(SIGPIPE,SIG_IGN);}'
        if source.count(start) != 1 or source.count(end) != 1:
            raise AssertionError('generated process fixture boundaries are ambiguous')
        source = source.replace(start, 'static int fixture_thread(pthread_t *,const pthread_attr_t *,void *(*)(void *),void *);\n#define pthread_create fixture_thread\n' + start)
        source = source.replace(end, end + '''
#undef pthread_create
static int fixture_thread(pthread_t *thread,const pthread_attr_t *attr,void *(*fn)(void *),void *arg) {
  if(fn==br_waiter && ((BrWaiter *)arg)->event.kind=='R')return EAGAIN;
  return pthread_create(thread,attr,fn,arg);
}
''')
        code = Path(cls.build.name) / 'fault.c'
        code.write_text(source)
        cls.fault = Path(cls.build.name) / 'process-fault'
        subprocess.run(['clang', '-O1', '-pthread', str(code), '-lm', '-o', str(cls.fault)],
                       check=True, capture_output=True, text=True, timeout=120)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='retained-retry-')
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name).resolve()
        self.attempt = self.home / 'attempt'
        self.db = self.home / 'db'
        self.db.touch()
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.server.settimeout(10)
        self.connections = []
        self.children = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for stream, conn in self.connections:
            stream.close()
            conn.close()
        self.server.close()
        # Kill only process command lines containing this unique owned fixture.
        for _ in range(20):
            rows = subprocess.run(['ps', '-axo', 'pid=,stat=,command='], capture_output=True,
                                  text=True, check=True).stdout.splitlines()
            owned = []
            for row in rows:
                fields = row.strip().split(None, 2)
                if len(fields) == 3 and str(self.home) in fields[2] and not fields[1].startswith('Z'):
                    owned.append(int(fields[0]))
            if not owned:
                break
            for pid in owned:
                try: os.kill(pid, signal.SIGSTOP)
                except ProcessLookupError: pass
            for pid in owned:
                try: os.kill(pid, signal.SIGKILL)
                except ProcessLookupError: pass
            time.sleep(.02)
        for child in self.children:
            child.wait(timeout=5)
            for stream in (child.stdin, child.stdout, child.stderr):
                stream.close()

    def write_program(self, name, role, exe):
        path = self.home / name
        path.write_text(SCRIPT.format(python=sys.executable, port=self.server.getsockname()[1],
                                     role=role, exe=str(exe)))
        path.chmod(0o700)
        return path

    def connect(self, expected):
        conn, _ = self.server.accept()
        conn.settimeout(10)
        stream = conn.makefile('rwb', buffering=0)
        self.connections.append((stream, conn))
        event = json.loads(stream.readline())
        self.assertEqual(event['role'], expected)
        return event, stream

    def wait_file(self, name):
        deadline = time.monotonic() + 10
        path = self.attempt / name
        while not path.exists():
            self.assertLess(time.monotonic(), deadline, name)
            time.sleep(.02)
        return path.read_text()

    def start(self, exe, missing=False):
        native = self.write_program('native', 'native', exe)
        recovery = self.home / 'recovery'
        if not missing:
            self.write_program('recovery', 'recovery', exe)
        observer = subprocess.Popen([str(exe), 'retain-custom', str(self.db), str(self.attempt),
                                     str(self.home), str(recovery), str(native)],
                                    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.children.append(observer)
        event, stream = self.connect('native')
        # The actual native endpoint independently reports that it executed.
        self.keeper = event['ppid']
        self.native = stream
        deadline = time.monotonic() + 10
        while not (self.attempt / 'native.birth').exists():
            self.assertLess(time.monotonic(), deadline)
            time.sleep(.02)
        readable, _, _ = select.select([observer.stdout], [], [], 10)
        self.assertTrue(readable, 'original observer never became ready')
        self.assertEqual(observer.stdout.readline(), b'early-release-refused\n')
        observer.kill()
        observer.wait(timeout=5)

    def settle(self, recovery):
        recovery.write(b'attach\n')
        self.wait_file('recovery-started')
        self.native.write(b'finish\n')
        self.wait_file('acknowledged')
        self.assertEqual((self.attempt / 'status').read_text(), '0\n')
        deadline = time.monotonic() + 10
        while 'retained-complete' not in (self.attempt / 'observer.log').read_text():
            self.assertLess(time.monotonic(), deadline, 'observer did not finish')
            time.sleep(.02)

    def assert_no_second_recovery(self):
        self.server.settimeout(2.2)
        with self.assertRaises(socket.timeout):
            self.server.accept()
        self.server.settimeout(10)

    def test_spawn_failure_keeps_guard_and_retries_when_executable_returns(self):
        self.start(EXE, missing=True)
        original = self.wait_file('observer-first-error')
        locked = subprocess.run([str(EXE), 'lock-try', str(self.db)], capture_output=True, text=True, timeout=10)
        self.assertEqual(locked.stdout, 'busy\n')
        os.kill(self.keeper, 0)
        self.write_program('recovery', 'recovery', EXE)
        _, recovery = self.connect('recovery')
        self.settle(recovery)
        self.assertEqual((self.attempt / 'observer-first-error').read_text(), original)

    def test_pre_attach_exit_retries_and_retains_first_diagnostic(self):
        self.start(EXE)
        _, first = self.connect('recovery')
        self.assert_no_second_recovery()
        first.write(b'fail\n')
        original = self.wait_file('observer-first-error')
        _, second = self.connect('recovery')
        second.write(b'fail\n')
        _, third = self.connect('recovery')
        self.assertNotEqual((self.attempt / 'observer-error').read_text(), original)
        self.assertEqual((self.attempt / 'observer-first-error').read_text(), original)
        self.settle(third)

    def test_waiter_failure_preserves_one_live_recovery_child_until_reaped(self):
        self.start(self.fault)
        _, first = self.connect('recovery')
        diagnostic = self.wait_file('observer-first-error')
        self.assertIn(f'error {errno.EAGAIN} ', diagnostic)
        self.assert_no_second_recovery()
        first.write(b'fail\n')
        _, second = self.connect('recovery')
        self.settle(second)


if __name__ == '__main__':
    unittest.main()
