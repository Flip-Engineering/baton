"""Retained process control shares native ownership with the existing observer."""
import errno
import hashlib
import json
import os
import pathlib
import queue
import signal
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/process-test'

FIXTURE = r'''import hashlib,json,os,pathlib,signal,socket,sys
home=pathlib.Path(__file__).resolve().parent
port=int(sys.argv[1]); mode=sys.argv[2]
def connect(role):
    sock=socket.create_connection(('127.0.0.1',port))
    stream=sock.makefile('rwb',buffering=0)
    def send(value): stream.write((json.dumps(value)+'\n').encode())
    signal.signal(signal.SIGUSR1,lambda sig,frame: send({'signal':sig,'pid':os.getpid()}))
    send({'role':role,'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp()})
    return sock,stream,send
sock,stream,send=connect('native')
prefix=b''
if mode=='signals':
    child=os.fork()
    if child==0:
        stream.close();sock.close()
        sock,stream,send=connect('group-child')
        while stream.readline(): pass
        sys.exit(0)
for line in stream:
    action=json.loads(line)
    if action.get('prefix'):
        prefix=sys.stdin.buffer.read(1)
        send({'prefix':prefix.decode()})
    elif action.get('read'):
        frames=[prefix+sys.stdin.buffer.readline()]
        frames.extend(sys.stdin.buffer.readline() for _ in range(action['read']-1))
        prefix=b''
        (home/'frames.bin').write_bytes(b''.join(frames))
        summaries=[]
        for frame in frames:
            parsed=json.loads(frame)
            summaries.append({'label':parsed['label'],'bytes':len(frame),'sha256':hashlib.sha256(frame).hexdigest()})
            print('frame:'+parsed['label'],flush=True)
        send({'frames':summaries})
    elif action.get('eof'):
        data=sys.stdin.buffer.read()
        (home/'frames.bin').write_bytes(data)
        print('native-stdin-eof',flush=True)
        send({'eof':True,'bytes':len(data)})
    elif action.get('finish'):
        break
'''


class RetainedControl(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="b2 control's ")
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.db = self.home / 'session.db'
        self.db.touch()
        self.attempt = self.home / 'attempt'
        self.fixture = self.home / 'native.py'
        self.fixture.write_text(FIXTURE)
        self.children = []
        self.connections = []
        self.server = socket.socket()
        self.server.bind(('127.0.0.1', 0))
        self.server.listen()
        self.addCleanup(self.server.close)
        self.addCleanup(self.cleanup_processes)

    def processes(self):
        result = subprocess.run(['ps', '-axo', 'pid=,ppid=,stat=,command='],
                                text=True, capture_output=True, check=True)
        rows = []
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 3)
            if len(fields) == 4 and str(self.home) in fields[3] and not fields[2].startswith('Z'):
                rows.append({'pid': int(fields[0]), 'ppid': int(fields[1]),
                             'status': fields[2], 'command': fields[3]})
        return rows

    def cleanup_processes(self):
        for stream, connection in self.connections:
            stream.close()
            connection.close()
        while True:
            owned = self.processes()
            if not owned:
                break
            for sig in [signal.SIGSTOP, signal.SIGKILL]:
                for process in owned:
                    try:
                        os.kill(process['pid'], sig)
                    except ProcessLookupError:
                        pass
            time.sleep(.01)
        for child in self.children:
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            child.wait()
            child.stdout.close()
            child.stderr.close()

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
            value = child.lines.get()
            self.assertIsNotNone(value, ''.join(child.output))
            if value == expected:
                return

    def run_control(self, *args, ok=True):
        result = subprocess.run([str(EXE), *map(str, args)], text=True,
                                capture_output=True)
        if ok:
            self.assertEqual(result.returncode, 0, result.stderr)
        return result

    def payload(self, label, size=0):
        raw = (json.dumps({'label': label, 'body': label * size}) + '\n').encode()
        path = self.home / (label + '.input')
        path.write_bytes(raw)
        return path, raw

    def accept(self):
        connection, _ = self.server.accept()
        stream = connection.makefile('rwb', buffering=0)
        self.connections.append((stream, connection))
        return stream, json.loads(stream.readline())

    def send(self, stream, **value):
        stream.write((json.dumps(value) + '\n').encode())

    def control_address(self):
        manifest = (self.attempt / 'manifest').read_bytes()
        header = struct.Struct('=8s6Q2I')
        magic, *fields = header.unpack_from(manifest)
        self.assertEqual(magic, b'BATONRP1')
        lengths = fields[:6]
        offset = header.size + sum(lengths[:5])
        return manifest[offset:offset + lengths[5]].decode()

    def wire(self, operation, serial, payload, value=0):
        frame = struct.Struct('=IiQQq')
        with socket.socket(socket.AF_UNIX) as client:
            client.connect(self.control_address())
            client.sendall(frame.pack(operation, 0, serial, len(payload), value) + payload)
            response = b''
            while len(response) < frame.size:
                chunk = client.recv(frame.size - len(response))
                self.assertTrue(chunk, repr(response))
                response += chunk
            self.assertEqual(client.recv(1), b'')
            return frame.unpack(response)

    def start(self, payload, mode='open', native_mode='frames'):
        observer = self.spawn('retain', self.db, self.attempt, self.home, payload, mode,
                              sys.executable, self.fixture, self.server.getsockname()[1], native_mode)
        stream, native = self.accept()
        self.assertEqual(native['role'], 'native')
        self.line(observer, 'early-release-refused')
        self.line(observer, 'observer-write-start')
        keeper = next(row for row in self.processes() if row['pid'] == native['ppid'])
        self.assertEqual(keeper['ppid'], observer.pid)
        self.assertIn('--host-process-keeper', keeper['command'])
        self.assertEqual(native['pgid'], native['pid'])
        return observer, stream, native

    def assert_observer_unchanged(self, observer, native):
        self.assertIsNone(observer.poll())
        owned = self.processes()
        self.assertTrue(any(row['pid'] == native['pid'] and row['ppid'] == native['ppid'] for row in owned))
        self.assertFalse((self.attempt / 'recovery-started').exists())
        self.assertFalse((self.attempt / 'observer-error').exists())

    def finish(self, observer, status='exit 0', status_observed=False):
        if not status_observed:
            self.line(observer, 'native-' + status)
        observer.stdin.close()
        self.assertEqual(observer.wait(), 0, observer.stderr.read())
        self.line(observer, 'retained-complete')
        while self.processes():
            time.sleep(.01)
        self.assertEqual(self.run_control('lock-try', self.db).stdout, 'acquired\n')
        self.assertFalse((self.attempt / 'recovery-started').exists())

    def test_observer_and_control_writes_preserve_complete_frames(self):
        initial, first = self.payload('observer', 40000)
        observer, stream, native = self.start(initial)
        self.send(stream, prefix=True)
        self.assertEqual(json.loads(stream.readline()), {'prefix': '{'})
        payloads = [self.payload('left', 80000), self.payload('right', 80000)]
        controls = [self.spawn('control-write', self.attempt, path) for path, _ in payloads]
        for control in controls:
            self.line(control, 'control-write-start')
        self.send(stream, read=3)
        received = json.loads(stream.readline())['frames']
        self.assertEqual(received[0]['label'], 'observer')
        for control in controls:
            self.line(control, 'control-write-complete')
            self.assertEqual(control.wait(), 0, control.stderr.read())
        self.line(observer, 'observer-write-complete')
        expected = {json.loads(raw)['label']: {'label': json.loads(raw)['label'],
                    'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}
                    for raw in [first, *[raw for _, raw in payloads]]}
        self.assertEqual({row['label']: row for row in received}, expected)
        self.assertEqual(len(received), 3)
        self.assert_observer_unchanged(observer, native)
        self.assertEqual(self.run_control('lock-try', self.db).stdout, 'busy\n')
        self.send(stream, finish=True)
        self.finish(observer)

    def test_control_write_refuses_closed_input_while_native_is_alive(self):
        initial, raw = self.payload('observer')
        observer, stream, native = self.start(initial, mode='close')
        self.send(stream, eof=True)
        self.assertEqual(json.loads(stream.readline()), {'eof': True, 'bytes': len(raw)})
        self.line(observer, 'observer-input-closed')
        late, _ = self.payload('late')
        result = self.run_control('control-write', self.attempt, late, ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('control-write-complete', result.stdout)
        self.assertEqual((self.home / 'frames.bin').read_bytes(), raw)
        self.assert_observer_unchanged(observer, native)
        self.send(stream, finish=True)
        self.finish(observer)

    def test_copied_manifest_cannot_control_original_attempt(self):
        initial, first = self.payload('observer')
        observer, stream, native = self.start(initial)
        copied = self.home / 'another attempt'
        copied.mkdir()
        shutil.copyfile(self.attempt / 'manifest', copied / 'manifest')
        extra, second = self.payload('control')
        refused = self.run_control('control-write', copied, extra, ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertNotIn('control-write-complete', refused.stdout)
        self.assert_observer_unchanged(observer, native)
        alias = self.home / 'attempt alias'
        alias.symlink_to(self.attempt, target_is_directory=True)
        self.run_control('control-write', alias, extra)
        self.send(stream, read=2)
        self.assertEqual([row['label'] for row in json.loads(stream.readline())['frames']],
                         ['observer', 'control'])
        self.assertEqual((self.home / 'frames.bin').read_bytes(), first + second)
        self.send(stream, finish=True)
        self.finish(observer)

    def test_invalid_transient_requests_leave_observer_attached(self):
        initial, first = self.payload('observer')
        observer, stream, native = self.start(initial)
        identity = os.fsencode(self.attempt) + b'\0'
        requests = [(12, 71, identity[:-1]), (999, 72, identity),
                    (11, 0, identity + b'extra'), (11, 0, identity)]
        for operation, serial, payload in requests:
            with self.subTest(operation=operation, serial=serial, payload=payload):
                reply, error, received, length, value = self.wire(operation, serial, payload)
                self.assertIn(reply, [1, 4])
                self.assertNotEqual(error, 0)
                self.assertEqual(received, serial)
                self.assertEqual(length, 0)
                self.assert_observer_unchanged(observer, native)
        extra, second = self.payload('control')
        self.run_control('control-write', self.attempt, extra)
        self.send(stream, read=2)
        self.assertEqual([row['label'] for row in json.loads(stream.readline())['frames']],
                         ['observer', 'control'])
        self.assertEqual((self.home / 'frames.bin').read_bytes(), first + second)
        self.send(stream, finish=True)
        self.finish(observer)

    def test_control_signal_targets_retained_group_and_requires_actual_exit(self):
        payload = self.home / 'empty.input'
        payload.write_bytes(b'')
        observer, stream, native = self.start(payload, native_mode='signals')
        child_stream, child = self.accept()
        self.assertEqual(child['role'], 'group-child')
        self.assertEqual(child['pgid'], native['pgid'])
        self.run_control('control-signal', self.attempt, signal.SIGUSR1)
        self.assertEqual(json.loads(stream.readline()), {'signal': signal.SIGUSR1, 'pid': native['pid']})
        self.assertEqual(json.loads(child_stream.readline()), {'signal': signal.SIGUSR1, 'pid': child['pid']})
        self.assert_observer_unchanged(observer, native)
        self.assertEqual(self.run_control('lock-try', self.db).stdout, 'busy\n')
        self.run_control('control-signal', self.attempt, signal.SIGTERM)
        self.line(observer, 'native-signal 15')
        result = self.run_control('control-signal', self.attempt, signal.SIGUSR1, ok=False)
        self.assertNotEqual(result.returncode, 0)
        late, _ = self.payload('after-exit')
        self.assertNotEqual(self.run_control('control-write', self.attempt, late, ok=False).returncode, 0)
        # The observer still holds its copy until the controlled completion step.
        self.assertEqual(self.run_control('lock-try', self.db).stdout, 'busy\n')
        self.finish(observer, status='signal 15', status_observed=True)

    def test_spawned_child_is_reaped_when_birth_persistence_fails(self):
        payload = self.home / 'empty.input'
        payload.write_bytes(b'')
        stderr = self.home / 'setup.stderr'
        os.mkfifo(stderr)
        observer = self.spawn('retain', self.db, self.attempt, self.home, payload,
                              'setup-failure', sys.executable, self.fixture,
                              self.server.getsockname()[1], 'normal')
        while not (self.attempt / 'manifest').exists():
            self.assertIsNone(observer.poll(), 'retain exited before creating its manifest')
            time.sleep(.01)
        # The keeper waits for a reader before spawning with this stderr FIFO.
        # The birth path then causes an ordinary filesystem error after spawn.
        (self.attempt / 'native.birth').mkdir()
        reader = os.open(stderr, os.O_RDONLY | os.O_NONBLOCK)
        try:
            observer.stdin.close()
            status = observer.wait()
            while observer.lines.get() is not None:
                pass
            output = ''.join(observer.output)
            error = observer.stderr.read()
        finally:
            os.close(reader)
        native = int((self.attempt / 'native.pid').read_text().strip())
        print('evidence spawned-setup-failure', json.dumps({
            'native': native, 'error': error.strip(), 'exit': status}))
        self.assertNotEqual(status, 0, output)
        self.assertIn(os.strerror(errno.EEXIST), error)
        self.assertGreater(native, 0)
        # A zombie still answers kill(pid, 0), so absence checks both exit and reap.
        with self.assertRaises(ProcessLookupError):
            os.kill(native, 0)
        lock = self.run_control('lock-try', self.db)
        self.assertEqual(lock.stdout, 'acquired\n')
        print('evidence spawned-setup-failure', json.dumps({
            'native': native, 'error': error.strip(), 'exit': status,
            'absentAndReaped': True, 'guard': lock.stdout.strip()}))

    def test_ended_orphan_first_wait_preserves_retained_status(self):
        probe = self.home / 'orphan-first-wait'
        compiled = subprocess.run([
            os.environ.get('CC', 'clang'), '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + json.dumps(str(EXE.with_suffix('.c'))),
            str(ROOT / 'bend2/test/orphan-first-wait.c'),
            '-lsqlite3', '-lm', '-o', str(probe),
        ], capture_output=True, text=True)
        self.assertEqual(compiled.returncode, 0, compiled.stderr)
        for mode, expected in [('absent', 'unknown after keeper loss'),
                               ('malformed', 'unknown after keeper loss'),
                               ('nonzero', 'exit 13'), ('zero', 'exit 0'),
                               ('signal', 'signal 15')]:
            with self.subTest(mode=mode):
                attempt = self.home / ('orphan-' + mode)
                attempt.mkdir()
                result = subprocess.run([str(probe), mode, str(attempt)],
                                        capture_output=True, text=True)
                print('evidence ended-orphan-first-wait', result.stdout.strip())
                self.assertEqual(result.returncode, 0, result.stderr)
                observed = json.loads(result.stdout)
                self.assertEqual(observed['case'], mode)
                self.assertEqual(observed['firstWait'], expected)
                self.assertEqual(observed['afterFollower'], expected)

    def test_native_waiter_keeps_exited_identity_until_keeper_reaps(self):
        source = self.home / 'waiter.c'
        probe = self.home / 'waiter'
        generated = EXE.with_suffix('.c')
        source.write_text('#define main generated_main\n#include ' + json.dumps(str(generated)) + r'''
#undef main
#define REQUIRE(test) do { if (!(test)) { perror(#test); return __LINE__; } } while (0)
int main(void) {
  int wake[2], status;
  pid_t native;
  char *argv[] = {"/bin/sh", "-c", "exit 17", NULL};
  REQUIRE(pipe(wake) == 0);
  REQUIRE(posix_spawn(&native, argv[0], NULL, NULL, argv, environ) == 0);
  BrWaiter *waiter = calloc(1, sizeof(*waiter));
  REQUIRE(waiter != NULL);
  waiter->event = (BrWake){.kind='N', .pid=native, .generation=7};
  waiter->descriptor = wake[1];
  br_waiter(waiter);
  BrWake event;
  REQUIRE(br_read_all(wake[0], &event, sizeof(event)) == 0);
  REQUIRE(event.kind == 'N' && event.pid == native && event.generation == 7);
  REQUIRE(event.status >= 0);
  close(wake[0]);
  siginfo_t observed = {0};
  REQUIRE(waitid(P_PID, native, &observed, WEXITED | WNOWAIT) == 0);
  REQUIRE(observed.si_pid == native && observed.si_code == CLD_EXITED && observed.si_status == 17);
  REQUIRE(waitpid(native, &status, 0) == native);
  REQUIRE(WIFEXITED(status) && WEXITSTATUS(status) == 17);
  errno = 0;
  REQUIRE(waitpid(native, &status, WNOHANG) == -1 && errno == ECHILD);
  printf("{\"native\":%d,\"wakePid\":%d,\"retainedPid\":%d,\"retainedExit\":%d,\"reaped\":true}\n",
         native, event.pid, observed.si_pid, observed.si_status);
  return 0;
}
''')
        compiled = subprocess.run([os.environ.get('CC', 'clang'), '-O0', '-pthread', str(source),
                                   '-lsqlite3', '-lm', '-o', str(probe)],
                                  capture_output=True, text=True)
        self.assertEqual(compiled.returncode, 0, compiled.stderr)
        result = subprocess.run([str(probe)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        observed = json.loads(result.stdout)
        self.assertEqual(observed['native'], observed['wakePid'])
        self.assertEqual(observed['native'], observed['retainedPid'])
        self.assertEqual(observed['retainedExit'], 17)
        self.assertTrue(observed['reaped'])


if __name__ == '__main__':
    unittest.main()
