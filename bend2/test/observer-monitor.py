"""Isolated coordinator recovery of an adopted monitor-only attempt.

The fixture starts one retained native under the database owner, then ends the
observer and the keeper. No status is retained. The focused coordinator entry
adopts the attempt as monitor-only custody, reads its spool, advances the
durable checkpoint once and leaves the owed input unread. The native identity,
PID, UUID argument and manifest stay unchanged.

When BATON_MONITOR_REPLAY_SPOOL_FIXTURE names a read-only data-only spool, an
additional test replays it through test-owned monitor custody to normal EOF.
"""
import hashlib
import json
import os
import pathlib
import shutil
import signal
import sqlite3
import struct
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE = pathlib.Path(os.environ.get('OBSERVER_MONITOR_FIXTURE', ROOT / '.scratch/bend2/monitor-fixture'))
COORDINATOR = pathlib.Path(os.getenv('OBSERVER_RECOVERY_BIN', ROOT / '.scratch/bend2/observer-recovery'))
OBSERVER_ENTRY = ROOT / 'bend2/test/observer-recovery-entry.bend'
NATIVE_UUID = '01a14948-63f9-7000-abc2-89573aa39352'


def build(entry, output):
    result = subprocess.run(
        ['sh', 'bend2/scripts/build-native.sh', str(entry), str(output)],
        cwd=ROOT, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


def checkpoint_offset(directory):
    path = pathlib.Path(directory) / 'checkpoint'
    if not path.exists():
        return None
    data = path.read_bytes()
    if data[:8] != b'BATONC03':
        return None
    return struct.unpack_from('=Q', data, 56)[0]


def checkpoint_state(directory):
    data = (pathlib.Path(directory) / 'checkpoint').read_bytes()
    if data[:8] != b'BATONC03' or len(data) < 104:
        return None
    return json.loads(data[104:])


def checkpoint_record(header, state):
    # Rebuilds a host checkpoint record around a new state. The host checksum is
    # FNV-1a 64 over the header with its check field (bytes 72..80) excluded,
    # then over the state bytes (bend2/src/host/process-spawn.c).
    record = bytearray(header)
    struct.pack_into('=Q', record, 64, len(state))
    struct.pack_into('=Q', record, 72, 0)
    digest = 0xcbf29ce484222325
    for byte in bytes(record[:72]) + bytes(record[80:104]) + state:
        digest = ((digest ^ byte) * 0x100000001b3) & 0xffffffffffffffff
    struct.pack_into('=Q', record, 72, digest)
    return bytes(record) + state


def file_sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def custody_flags(directory):
    path = pathlib.Path(directory) / 'custody'
    if not path.exists():
        return None
    data = path.read_bytes()
    if data[:8] != b'BATONCUS':
        return None
    return struct.unpack_from('=I', data, 12)[0]


def custody_offset(directory):
    path = pathlib.Path(directory) / 'custody'
    if not path.exists():
        return None
    data = path.read_bytes()
    if data[:8] != b'BATONCUS':
        return None
    return struct.unpack_from('=Q', data, 40)[0]


def receive_pid(database, session, attempt):
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = [part.decode(errors='replace') for part in (entry / 'cmdline').read_bytes().split(bytes([0])) if part]
        except OSError:
            continue
        if (len(argv) >= 5 and argv[1] == '--recover-receive' and
                argv[2] == str(database) and argv[3] == session and argv[4] == attempt):
            return int(entry.name), argv
    return None, None


def owner_pid(database):
    for entry in pathlib.Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            argv = (entry / 'cmdline').read_bytes().split(b'\0')
        except OSError:
            continue
        if b'--instance-owner' in argv and str(database).encode() in argv:
            return int(entry.name)
    return None


class ObserverMonitor(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not FIXTURE.exists():
            build(ROOT / 'bend2/test/monitor-fixture.bend', FIXTURE)
        if not COORDINATOR.exists():
            build(OBSERVER_ENTRY, COORDINATOR)

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='observer-monitor-', dir=ROOT / '.scratch/bend2')
        if os.environ.get('KEEP_OBSERVER_FIXTURE'):
            print('fixture_directory=' + self.temp.name, flush=True)
            self.temp._finalizer.detach()
        else:
            self.addCleanup(self.temp.cleanup)
        self.directory = pathlib.Path(self.temp.name)
        self.runtime = pathlib.Path(tempfile.mkdtemp(prefix='br-'))
        self.addCleanup(shutil.rmtree, str(self.runtime), True)
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))
        self.db = self.directory / 'state.db'
        self.attempt = self.directory / 'attempt'
        self.workspace = self.directory / 'workspace'
        self.workspace.mkdir()
        self.log = self.directory / 'native.log'
        self.uuid_marker = self.directory / 'native-uuid.txt'
        self.release_marker = self.directory / 'release-later-output'
        self.hold_marker = self.directory / 'let-native-exit'
        self.native = self.directory / 'native.py'
        self.native.write_text(
            '#!' + sys.executable + '\n'
            'import pathlib,sys,time\n'
            'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])\n'
            'sys.stdout.write("monitor-line\\n")\n'
            'sys.stdout.flush()\n'
            'time.sleep(8)\n')
        self.native.chmod(0o700)
        self.native_process = None

    def tearDown(self):
        if self.native_process is not None:
            try:
                os.kill(self.native_process, signal.SIGKILL)
            except ProcessLookupError:
                pass
        subprocess.run([str(FIXTURE), 'shutdown', str(self.db)],
                       env=self.environment, capture_output=True, timeout=20)

    def fixture(self, *args, ok=True):
        result = subprocess.run([str(FIXTURE), *map(str, args)], text=True,
                                capture_output=True, env=self.environment, timeout=30)
        if ok:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def start_attempt(self, stderr_text='', native_uuid=NATIVE_UUID, attempt_id='attempt1',
                      stdout_text='monitor-line\n', sleep_seconds=8,
                      later_stdout_text='', stdout_file=None, later_stdout_file=None,
                      stdout_fixture=None, harness='codex', spool_timeout=10, hold=False):
        native_lines = [
            '#!' + sys.executable,
            'import pathlib,sys,time',
            'pathlib.Path(sys.argv[2]).write_text(sys.argv[1])',
        ]
        if stderr_text:
            native_lines.append('sys.stderr.write(' + repr(stderr_text) + ')')

        def stream(path):
            return [
                'source = open(' + repr(str(path)) + ', "rb")',
                'while True:',
                '    chunk = source.read(65536)',
                '    if not chunk: break',
                '    sys.stdout.buffer.write(chunk)',
                '    sys.stdout.buffer.flush()',
                'source.close()',
            ]

        if stdout_fixture is not None:
            native_lines.extend([
                'with open(sys.argv[3], "rb") as source:',
                '    for chunk in iter(lambda: source.read(1024 * 1024), b""):',
                '        sys.stdout.buffer.write(chunk)',
                '        sys.stdout.buffer.flush()',
                'while not pathlib.Path(sys.argv[4]).exists(): time.sleep(0.02)',
            ])
        else:
            if stdout_file is None:
                native_lines.extend([
                    'sys.stdout.write(' + repr(stdout_text) + ')',
                    'sys.stdout.flush()',
                ])
            else:
                native_lines.extend(stream(stdout_file))
            if later_stdout_text or later_stdout_file is not None:
                native_lines.append('while not pathlib.Path(sys.argv[3]).exists(): time.sleep(0.02)')
                if later_stdout_text:
                    native_lines.extend([
                        'sys.stdout.write(' + repr(later_stdout_text) + ')',
                        'sys.stdout.flush()',
                    ])
                if later_stdout_file is not None:
                    native_lines.extend(stream(later_stdout_file))
        if hold:
            native_lines.append('while not pathlib.Path(' + repr(str(self.hold_marker)) + ').exists(): time.sleep(0.02)')
        else:
            native_lines.append('time.sleep(' + repr(sleep_seconds) + ')')
        self.native.write_text('\n'.join(native_lines) + '\n')
        self.native.chmod(0o700)
        self.attempt_id = attempt_id
        self.native_uuid = native_uuid
        self.stdout_text = stdout_text
        if stdout_fixture is not None:
            expected_spool_size = pathlib.Path(stdout_fixture).stat().st_size
        elif stdout_file is not None:
            expected_spool_size = pathlib.Path(stdout_file).stat().st_size
        else:
            expected_spool_size = len(stdout_text.encode())
        self.fixture('init', self.db, harness)
        with sqlite3.connect(self.db) as database:
            database.execute("UPDATE sessions SET native=? WHERE id='parent'", (native_uuid,))
        start = subprocess.Popen(
            [str(FIXTURE), 'start', str(self.db), attempt_id, str(self.attempt),
            str(self.workspace), str(self.log), native_uuid, str(COORDINATOR), harness,
             'controlled-model', 'low', sys.executable, str(self.native),
            native_uuid, str(self.uuid_marker),
            *([str(stdout_fixture), str(self.release_marker)] if stdout_fixture is not None else []),
            *([str(self.release_marker)] if stdout_fixture is None and (later_stdout_text or later_stdout_file is not None) else [])],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        stdout, stderr = start.communicate(timeout=30)
        self.assertEqual(start.returncode, 0, stdout + stderr)
        self.assertIn('started', stdout)
        deadline = time.monotonic() + spool_timeout
        while time.monotonic() < deadline:
            if (self.attempt / 'native.pid').exists() and (self.attempt / 'stdout').exists():
                if ((self.attempt / 'stdout').stat().st_size >= expected_spool_size and
                        self.uuid_marker.exists()):
                    break
            time.sleep(0.02)
        self.assertTrue((self.attempt / 'native.pid').exists(), 'native.pid was not written')
        self.native_process = int((self.attempt / 'native.pid').read_text())
        self.assertEqual(self.uuid_marker.read_text(), native_uuid)
        birth = (self.attempt / 'native.birth').read_bytes()
        manifest = (self.attempt / 'manifest').read_bytes()
        self.assertTrue((self.attempt / 'capabilities').exists(),
                        'the owner keeper did not advertise reconcile')
        owner = owner_pid(self.db)
        self.assertIsNotNone(owner, 'database owner was not found')
        observer, observer_argv = receive_pid(self.db, 'parent', self.attempt_id)
        self.assertIsNotNone(observer, 'fixture receive child was not found by exact DB/session/attempt argv')
        self.observer_argv = observer_argv
        os.kill(owner, signal.SIGKILL)
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and owner_pid(self.db) is not None:
            time.sleep(0.02)
        os.kill(observer, signal.SIGKILL)
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                stat = (pathlib.Path('/proc') / str(observer) / 'stat').read_text()
                state = stat.rsplit(')', 1)[1].strip().split()[0]
            except (OSError, IndexError):
                break
            if state == 'Z':
                break
            time.sleep(0.02)
        else:
            self.fail('fixture receiver did not exit after owned SIGKILL')
        os.kill(self.native_process, 0)
        return observer, birth, manifest

    def recover(self, observer, timeout=60):
        result = subprocess.run(
            [str(COORDINATOR), '--recover-observer', str(self.db), 'parent', str(observer)],
            text=True, capture_output=True, env=self.environment, timeout=timeout)
        return result

    @staticmethod
    def stop_owned_process(process):
        if process.poll() is None:
            process.kill()
            process.communicate(timeout=10)

    def row(self, sql, *args):
        with sqlite3.connect(self.db) as database:
            return database.execute(sql, args).fetchone()

    def wait_native_exit(self, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                stat = (pathlib.Path('/proc') / str(self.native_process) / 'stat').read_text()
                state = stat.rsplit(')', 1)[1].strip().split()[0]
            except (OSError, IndexError):
                return
            if state == 'Z':
                return
            time.sleep(0.02)
        self.fail('fixture native child did not exit before terminal-status assertion')

    def assert_unknown_pending(self, native_exited=False):
        flags = custody_flags(self.attempt)
        self.assertIsNotNone(flags)
        self.assertEqual(flags & 3, 3, 'monitor custody must retain unknown status and unfinished input')
        execution = self.row("SELECT phase,status FROM executions WHERE session='parent' AND id=?", self.attempt_id)
        if native_exited:
            self.assertEqual(execution, ('exited', 'unavailable: native exit status was not retained'),
                             'terminal observer must preserve unknown native status')
            self.assertFalse((self.attempt / 'status').exists(),
                             'unknown native status must not be synthesized')
        else:
            self.assertEqual(execution, ('running', ''), 'live native status must remain pending')

    def test_codex_large_assistant_frame_stays_spanned_through_report(self):

        assistant_bytes = 8 * 1024 * 1024
        prefix = b'{"type":"item.completed","item":{"id":"bounded-large-message","type":"agent_message","text":"'
        suffix = b'"}}\n'
        terminal = b'{"type":"turn.completed"}\n'
        text_bytes = assistant_bytes - len(prefix) - len(suffix)
        self.assertGreater(text_bytes, 0)
        output_file = self.directory / 'large-codex-stdout.jsonl'
        digest = hashlib.sha256()
        remaining = text_bytes
        block = b'x' * 65536
        with output_file.open('wb') as output:
            output.write(prefix)
            while remaining:
                chunk = block[:min(remaining, len(block))]
                output.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
            output.write(suffix)
        expected_offset = assistant_bytes

        observer, birth, manifest = self.start_attempt(
            stdout_text='', stdout_file=output_file, sleep_seconds=15,
            later_stdout_text=terminal.decode())
        argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                'parent', str(observer)]
        monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, monitor)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if checkpoint_offset(self.attempt) == expected_offset and custody_offset(self.attempt) == expected_offset:
                break
            if monitor.poll() is not None:
                out, err = monitor.communicate(timeout=10)
                self.fail('large Codex stream stopped before checkpoint: %r %r' % (out, err))
            time.sleep(0.02)

        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        checkpoint = (self.attempt / 'checkpoint').read_bytes()
        header_size = struct.calcsize('@8sII8Qi4xQQ')
        fields = struct.unpack_from('@8sII8Qi4xQQ', checkpoint)
        self.assertEqual(fields[0], b'BATONC03')
        self.assertEqual(fields[8], expected_offset)
        state = json.loads(checkpoint[header_size:])
        codex_log = state['codex_log']
        self.assertLess(len(codex_log.encode()), 1024)
        codex_parts = codex_log.split('\n')
        self.assertEqual(codex_parts[0], 'codex-span-v1')
        self.assertIn('\x1e' + str(self.attempt / 'stdout') + '\x1e', codex_parts[1])
        self.assertEqual(codex_parts[2], '-')
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertEqual((self.attempt / 'stdout').stat().st_size, expected_offset)
        self.assertEqual(hashlib.sha256((self.attempt / 'stdout').read_bytes()).digest(),
                         hashlib.sha256(output_file.read_bytes()).digest())
        self.assert_unknown_pending()
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

        # Stop only this fixture-owned monitor while the native child remains
        # blocked before the terminal frame. Reopen from the durable assistant
        # cursor and verify the checkpoint does not replay the large message.
        self.stop_owned_process(monitor)
        os.kill(self.native_process, 0)
        second_monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, second_monitor)
        time.sleep(0.25)
        self.assertIsNone(second_monitor.poll(), 'reopened monitor exited before native completion')
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        reopened_state = json.loads((self.attempt / 'checkpoint').read_bytes()[header_size:])
        self.assertEqual(reopened_state['codex_log'], codex_log)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

        self.release_marker.touch()
        expected_offset += len(terminal)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if ((self.attempt / 'stdout').stat().st_size == expected_offset and
                    checkpoint_offset(self.attempt) == expected_offset and
                    custody_offset(self.attempt) == expected_offset):
                break
            if second_monitor.poll() is not None:
                out, err = second_monitor.communicate(timeout=10)
                self.fail('reopened monitor stopped before terminal checkpoint: %r %r' % (out, err))
            time.sleep(0.02)
        self.assertEqual((self.attempt / 'stdout').stat().st_size, expected_offset)
        self.assertEqual((self.attempt / 'stdout').read_bytes(), output_file.read_bytes() + terminal)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.wait_native_exit(timeout=20)
        out, err = second_monitor.communicate(timeout=20)
        self.assertNotEqual(second_monitor.returncode, 0, out + err)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assert_unknown_pending(native_exited=True)
        report = self.row("SELECT body FROM messages WHERE kind='report' AND sender='parent' LIMIT 1")
        self.assertIsNotNone(report, 'completed Codex result report was not persisted')
        self.assertEqual(len(report[0].encode()), text_bytes)
        self.assertEqual(hashlib.sha256(report[0].encode()).digest(), digest.digest())
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (1,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        turn_event = self.row("SELECT event FROM turns WHERE worker='parent' LIMIT 1")
        self.assertIsNotNone(turn_event)
        result_event = json.loads(turn_event[0])
        self.assertEqual(result_event['type'], 'result')
        self.assertEqual(result_event['is_error'], 0)
        self.assertEqual(result_event['result'], report[0])
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_codex_large_failed_terminal_replaces_legacy_checkpoint(self):

        error_bytes = 8 * 1024 * 1024
        prefix = b'{"type":"turn.failed","error":{"message":"'
        suffix = b'"}}\n'
        text_bytes = error_bytes - len(prefix) - len(suffix)
        output_file = self.directory / 'large-codex-legacy-failure.jsonl'
        digest = hashlib.sha256()
        remaining = text_bytes
        block = b'f' * 65536
        with output_file.open('wb') as output:
            output.write(prefix)
            while remaining:
                chunk = block[:min(remaining, len(block))]
                output.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
            output.write(suffix)
        expected_offset = output_file.stat().st_size

        legacy = ('{"type":"item.completed","item":{"id":"legacy","type":"agent_message",'
                  '"text":"prior assistant result"}}\n')
        observer, birth, manifest = self.start_attempt(
            stdout_text=legacy, later_stdout_file=output_file, sleep_seconds=5)
        argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                'parent', str(observer)]
        monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, monitor)
        legacy_offset = len(legacy.encode())
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if checkpoint_offset(self.attempt) == legacy_offset and custody_offset(self.attempt) == legacy_offset:
                break
            if monitor.poll() is not None:
                out, err = monitor.communicate(timeout=10)
                self.fail('legacy assistant checkpoint did not settle before failed frame: %r %r' % (out, err))
            time.sleep(0.02)
        self.assertEqual(checkpoint_offset(self.attempt), legacy_offset)
        self.assertEqual(custody_offset(self.attempt), legacy_offset)
        checkpoint = (self.attempt / 'checkpoint').read_bytes()
        header_size = struct.calcsize('@8sII8Qi4xQQ')
        state = json.loads(checkpoint[header_size:])
        self.assertEqual(state['codex_log'], legacy.rstrip('\n'))

        # Restart only this fixture observer while the native waits for release.
        self.stop_owned_process(monitor)
        os.kill(self.native_process, 0)
        monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, monitor)
        time.sleep(0.25)
        self.assertIsNone(monitor.poll(), 'reopened monitor exited before failed frame')
        self.assertEqual(checkpoint_offset(self.attempt), legacy_offset)
        self.assertEqual(custody_offset(self.attempt), legacy_offset)
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))

        self.release_marker.touch()
        final_offset = legacy_offset + expected_offset
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if (checkpoint_offset(self.attempt) == final_offset and
                    custody_offset(self.attempt) == final_offset and
                    (self.attempt / 'stdout').stat().st_size == final_offset):
                break
            if monitor.poll() is not None:
                out, err = monitor.communicate(timeout=10)
                self.fail('reopened monitor stopped before failed terminal checkpoint: %r %r' % (out, err))
            time.sleep(0.02)
        self.assertEqual(checkpoint_offset(self.attempt), final_offset)
        self.assertEqual(custody_offset(self.attempt), final_offset)
        self.wait_native_exit(timeout=30)
        out, err = monitor.communicate(timeout=20)
        self.assertNotEqual(monitor.returncode, 0, out + err)
        self.assert_unknown_pending(native_exited=True)
        report = self.row("SELECT body FROM messages WHERE kind='report' AND sender='parent' LIMIT 1")
        self.assertIsNotNone(report, 'failed Codex result report was not persisted')
        self.assertEqual(len(report[0].encode()), text_bytes)
        self.assertEqual(hashlib.sha256(report[0].encode()).digest(), digest.digest())
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (1,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        turn_event = self.row("SELECT event FROM turns WHERE worker='parent' LIMIT 1")
        self.assertIsNotNone(turn_event)
        result_event = json.loads(turn_event[0])
        self.assertEqual(result_event['type'], 'result')
        self.assertEqual(result_event['is_error'], 1)
        self.assertEqual(result_event['result'], report[0])
        self.assertEqual(result_event['nativeEvent']['type'], 'turn.failed')
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)

    def test_codex_large_failed_terminal_stays_spanned_through_report(self):

        error_bytes = 8 * 1024 * 1024
        prefix = b'{"type":"turn.failed","error":{"message":"'
        suffix = b'"}}\n'
        text_bytes = error_bytes - len(prefix) - len(suffix)
        self.assertGreater(text_bytes, 0)
        output_file = self.directory / 'large-codex-failure.jsonl'
        digest = hashlib.sha256()
        remaining = text_bytes
        block = b'e' * 65536
        with output_file.open('wb') as output:
            output.write(prefix)
            while remaining:
                chunk = block[:min(remaining, len(block))]
                output.write(chunk)
                digest.update(chunk)
                remaining -= len(chunk)
            output.write(suffix)
        expected_offset = output_file.stat().st_size

        observer, birth, manifest = self.start_attempt(
            stdout_text='', stdout_file=output_file, sleep_seconds=30)
        argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                'parent', str(observer)]
        monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, monitor)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if checkpoint_offset(self.attempt) == expected_offset and custody_offset(self.attempt) == expected_offset:
                break
            if monitor.poll() is not None:
                out, err = monitor.communicate(timeout=10)
                self.fail('large failure frame stopped before checkpoint: %r %r' % (out, err))
            time.sleep(0.02)

        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        checkpoint = (self.attempt / 'checkpoint').read_bytes()
        header_size = struct.calcsize('@8sII8Qi4xQQ')
        fields = struct.unpack_from('@8sII8Qi4xQQ', checkpoint)
        self.assertEqual(fields[0], b'BATONC03')
        self.assertEqual(fields[8], expected_offset)
        state = json.loads(checkpoint[header_size:])
        codex_log = state['codex_log']
        self.assertLess(len(codex_log.encode()), 1024)
        codex_parts = codex_log.split('\n')
        self.assertEqual(codex_parts[0], 'codex-span-v1')
        self.assertEqual(codex_parts[1], '-')
        self.assertIn('\x1e' + str(self.attempt / 'stdout') + '\x1e', codex_parts[2])
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertEqual((self.attempt / 'stdout').stat().st_size, expected_offset)
        self.assertEqual(hashlib.sha256((self.attempt / 'stdout').read_bytes()).digest(),
                         hashlib.sha256(output_file.read_bytes()).digest())
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))
        self.assert_unknown_pending()
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

        self.stop_owned_process(monitor)
        os.kill(self.native_process, 0)
        second_monitor = subprocess.Popen(
            argv, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            env=self.environment)
        self.addCleanup(self.stop_owned_process, second_monitor)
        time.sleep(0.25)
        self.assertIsNone(second_monitor.poll(), 'reopened monitor exited before native completion')
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        reopened_state = json.loads((self.attempt / 'checkpoint').read_bytes()[header_size:])
        self.assertEqual(reopened_state['codex_log'], codex_log)
        self.assertEqual(hashlib.sha256((self.attempt / 'stdout').read_bytes()).digest(),
                         hashlib.sha256(output_file.read_bytes()).digest())
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

        self.wait_native_exit(timeout=40)
        out, err = second_monitor.communicate(timeout=20)
        self.assertNotEqual(second_monitor.returncode, 0, out + err)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assert_unknown_pending(native_exited=True)
        report = self.row("SELECT body FROM messages WHERE kind='report' AND sender='parent' LIMIT 1")
        self.assertIsNotNone(report, 'failed Codex result report was not persisted')
        result_body = json.loads(report[0])
        self.assertEqual(result_body['type'], 'result')
        self.assertEqual(result_body['is_error'], 1)
        self.assertEqual(len(result_body['result'].encode()), text_bytes)
        self.assertEqual(hashlib.sha256(result_body['result'].encode()).digest(), digest.digest())
        self.assertEqual(result_body['nativeEvent']['type'], 'turn.failed')
        self.assertEqual(result_body['nativeEvent']['error']['message'], result_body['result'])
        turn_event = self.row("SELECT event FROM turns WHERE worker='parent' LIMIT 1")
        self.assertEqual(turn_event, report)
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (1,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))

    def test_protected_spool_replays_to_normal_eof_with_unknown_monitor_custody(self):
        fixture = os.environ.get('BATON_MONITOR_REPLAY_SPOOL_FIXTURE')
        if not fixture:
            self.skipTest('BATON_MONITOR_REPLAY_SPOOL_FIXTURE is not set')
        spool_fixture = pathlib.Path(fixture)
        self.assertTrue(spool_fixture.is_file() and not spool_fixture.is_symlink(),
                        'replay fixture must be a regular data-only spool file')
        source_size = spool_fixture.stat().st_size
        self.assertGreater(source_size, 40_000_000,
                           'replay fixture must contain the retained large spool')
        source_digest = file_sha256(spool_fixture)
        observer, birth, manifest = self.start_attempt(
            stdout_fixture=spool_fixture, sleep_seconds=0, harness='omp',
            spool_timeout=60)
        self.assertEqual((self.attempt / 'stdout').stat().st_size, source_size)
        self.assertEqual(file_sha256(self.attempt / 'stdout'), source_digest)

        self.release_marker.touch()
        self.wait_native_exit(timeout=30)
        recovered = self.recover(observer, timeout=900)
        self.assertNotEqual(recovered.returncode, 0,
                            recovered.stdout + recovered.stderr)

        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(checkpoint_offset(self.attempt), source_size,
                         'normal EOF did not commit the final spool cursor')
        self.assertEqual(custody_offset(self.attempt), source_size,
                         'monitor custody cursor differs from the final checkpoint')
        state = checkpoint_state(self.attempt)
        self.assertIsNotNone(state, 'monitor recovery did not leave a readable checkpoint')
        self.assertTrue(state['output_done'], 'normal EOF did not finalize the output cursor')
        self.assertGreater(len(state['terminal'].encode()), 900_000,
                           'the retained terminal was not carried through full replay')
        output_log = pathlib.Path(str(self.log) + '.attempt-' + self.attempt_id)
        self.assertGreater(output_log.stat().st_size, 0,
                           'replay did not materialize native output')
        self.assertEqual(int(state['output']), output_log.stat().st_size,
                         'final output cursor does not match the materialized log')

    def test_spanned_agent_end_monitor_keeps_unknown_custody(self):
        frame = ('{"type":"agent_end","isTerminal":true,"messages":[{"role":"assistant",'
                 '"content":[{"type":"text","text":"terminal"}]}],"padding":"'
                 + ('x' * 8192) + '"}\n')
        observer, birth, manifest = self.start_attempt(
            stdout_text=frame, hold=True, harness='omp')
        self.assertEqual(self.observer_argv[11], 'omp',
                         'the persisted receive argv must retain the bare OMP harness')
        self.hold_marker.touch()
        self.wait_native_exit(timeout=10)
        recovered = self.recover(observer)
        self.assertNotEqual(recovered.returncode, 0,
                            recovered.stdout + recovered.stderr)
        self.assertNotIn('Operation not permitted', recovered.stdout + recovered.stderr,
                         'monitor frame handling attempted a forbidden stdin close')
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(checkpoint_offset(self.attempt), len(frame.encode()),
                         'spanned turn_end did not advance the final spool cursor')
        self.assertEqual(custody_offset(self.attempt), len(frame.encode()),
                         'monitor custody cursor differs from the final checkpoint')
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assert_unknown_pending(native_exited=True)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_quiet_spool_awake_span_wakes_for_delayed_stdout(self):
        delayed_line = 'wake-line-after-quiet-spool\n'
        observer, birth, manifest = self.start_attempt(
            stdout_text='', later_stdout_text=delayed_line, sleep_seconds=15,
            harness='omp')
        recover_argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                        'parent', str(observer)]
        recovery = subprocess.Popen(
            recover_argv, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, recovery)

        # The spool is empty. Recovery must wait for the retained process event
        # before it can checkpoint the delayed line.
        time.sleep(0.5)
        if recovery.poll() is not None:
            stdout, stderr = recovery.communicate(timeout=10)
            self.fail('recovery exited before delayed stdout: exit=%r stdout=%r stderr=%r' %
                      (recovery.returncode, stdout, stderr))
        self.release_marker.write_text('release\n')

        expected_offset = len(delayed_line.encode())
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if checkpoint_offset(self.attempt) == expected_offset:
                break
            if recovery.poll() is not None:
                break
            time.sleep(0.02)
        stdout, stderr = recovery.communicate(timeout=30)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset,
                         'awake span did not read and checkpoint delayed stdout; exit=%r stdout=%r stderr=%r' %
                         (recovery.returncode, stdout, stderr))
        self.assertNotEqual(recovery.returncode, 0,
                            'unknown native status must remain a pending monitor result')
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.wait_native_exit(timeout=5)
        self.assert_unknown_pending(native_exited=True)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_unknown_status_monitor_advances_once_and_keeps_owed_input(self):
        first_line = 'monitor-line\n'
        second_line = 'monitor-line-after-log-removal\n'
        observer, birth, manifest = self.start_attempt(
            stdout_text=first_line, later_stdout_text=second_line,
            sleep_seconds=12)
        recover_argv = [str(COORDINATOR), '--recover-observer', str(self.db),
                        'parent', str(observer)]
        first = subprocess.Popen(
            recover_argv, text=True, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, first)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if (checkpoint_offset(self.attempt) == len(first_line.encode()) and
                    custody_offset(self.attempt) == len(first_line.encode())):
                break
            if first.poll() is not None:
                break
            time.sleep(0.02)
        if checkpoint_offset(self.attempt) != len(first_line.encode()):
            if first.poll() is None: first.kill()
            out, err = first.communicate(timeout=10)
            self.fail("cursor not persisted; exit=%r stdout=%r stderr=%r" % (first.returncode, out, err))
        self.assertEqual(checkpoint_offset(self.attempt), len(first_line.encode()),
                         'first monitor recovery did not persist its cursor')
        self.assertEqual(custody_offset(self.attempt), len(first_line.encode()))
        first_checkpoint = (self.attempt / 'checkpoint').read_bytes()
        first_custody = (self.attempt / 'custody').read_bytes()
        first_running = first.poll() is None
        if first_running:
            first.kill()
        first_stdout, first_stderr = first.communicate(timeout=10)
        if not first_running:
            self.assertNotEqual(first.returncode, 0, first_stdout + first_stderr)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        self.assertEqual(checkpoint_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(custody_offset(self.attempt), len('monitor-line\n'))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assert_unknown_pending()
        offset = checkpoint_offset(self.attempt)
        # Reopen the same durable monitor checkpoint with its public output log
        # absent. Recovery must keep the retained cursor and the original task
        # pending while it restores observer state from the attempt checkpoint.
        self.log.unlink(missing_ok=True)
        self.assertFalse(self.log.exists())
        expected_output = (first_line + second_line).encode()
        self.release_marker.touch()
        deadline = time.monotonic() + 8
        while time.monotonic() < deadline:
            if (self.attempt / 'stdout').stat().st_size >= len(expected_output):
                break
            time.sleep(0.02)
        self.assertEqual((self.attempt / 'stdout').read_bytes(), expected_output)
        self.wait_native_exit(timeout=20)
        second = self.recover(observer)
        self.assertNotEqual(second.returncode, 0, second.stdout + second.stderr)
        self.assertNotEqual((self.attempt / 'checkpoint').read_bytes(), first_checkpoint)
        self.assertEqual(offset, len(first_line.encode()))
        self.assertEqual(checkpoint_offset(self.attempt), len(expected_output))
        self.assertEqual(custody_offset(self.attempt), len(expected_output))
        self.assertNotEqual((self.attempt / 'custody').read_bytes(), first_custody)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assert_unknown_pending(native_exited=True)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_invalid_monitor_checkpoint_state_is_rejected_without_writes(self):
        first_line = 'monitor-line\n'
        observer, birth, manifest = self.start_attempt(
            stdout_text=first_line, sleep_seconds=12)
        first = subprocess.Popen(
            [str(COORDINATOR), '--recover-observer', str(self.db), 'parent', str(observer)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, first)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if (checkpoint_offset(self.attempt) == len(first_line.encode()) and
                    custody_offset(self.attempt) == len(first_line.encode())):
                break
            if first.poll() is not None:
                break
            time.sleep(0.02)
        self.stop_owned_process(first)
        self.assertEqual(checkpoint_offset(self.attempt), len(first_line.encode()),
                         'first monitor recovery did not persist a valid cursor')
        self.wait_native_exit(timeout=20)

        # The host record is valid at the nonzero cursor and its checksum is
        # rebuilt for the new state, so only the observer validity check can
        # refuse it. The state is valid JSON without the observer fields.
        valid = (self.attempt / 'checkpoint').read_bytes()
        header = valid[:104]
        rejected = checkpoint_record(header, b'{}')
        (self.attempt / 'checkpoint').write_bytes(rejected)
        custody = (self.attempt / 'custody').read_bytes()
        self.assertEqual(custody_offset(self.attempt), len(first_line.encode()))

        recovered = self.recover(observer, timeout=60)
        self.assertNotEqual(recovered.returncode, 0, recovered.stdout + recovered.stderr)
        # The first recovery writes a replay diagnostic before any checkpoint
        # exists. The host refusal of a record is a separate diagnostic.
        diagnostic = self.attempt / 'checkpoint-error'
        self.assertFalse(diagnostic.exists() and b'unusable' in diagnostic.read_bytes(),
                         'the host refused the record before the observer validity check')
        self.assertEqual((self.attempt / 'checkpoint').read_bytes(), rejected,
                         'an invalid monitor state was written over the checkpoint')
        self.assertEqual(custody_offset(self.attempt), len(first_line.encode()))
        self.assertEqual((self.attempt / 'custody').read_bytes(), custody)
        self.assertEqual((self.attempt / 'stdout').read_bytes(), first_line.encode())
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual(self.row("SELECT COUNT(*) FROM messages WHERE kind='report' AND sender='parent'"), (0,))

    def test_concurrent_observers_advance_the_cursor_once(self):
        observer, birth, manifest = self.start_attempt(sleep_seconds=30)
        owner = subprocess.Popen([str(FIXTURE), '--instance-owner', str(self.db)],
                                 text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, owner)
        owner_deadline = time.monotonic() + 10
        while time.monotonic() < owner_deadline and owner_pid(self.db) is None:
            if owner.poll() is not None:
                out, err = owner.communicate(timeout=10)
                self.fail('fixture owner exited before recovery race: %r %r' % (out, err))
            time.sleep(0.02)
        self.assertIsNotNone(owner_pid(self.db), 'shared fixture owner did not become ready')
        self.assertIsNone(owner.poll(), 'shared fixture owner must remain available')
        argv = [str(COORDINATOR), '--recover-observer', str(self.db), 'parent', str(observer)]
        first = subprocess.Popen(argv, text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, first)
        deadline = time.monotonic() + 20
        expected_offset = len('monitor-line\n'.encode())
        while time.monotonic() < deadline:
            if (checkpoint_offset(self.attempt) == expected_offset and
                    custody_offset(self.attempt) == expected_offset):
                break
            if first.poll() is not None:
                out, err = first.communicate(timeout=10)
                self.fail('first observer exited before durable cursor: %r %r' % (out, err))
            time.sleep(0.02)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset,
                         'first observer did not durably advance the cursor')
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertIsNone(first.poll(), 'first monitor must retain custody while the native is live')

        second = subprocess.Popen(argv, text=True, stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, env=self.environment)
        self.addCleanup(self.stop_owned_process, second)
        try:
            second_out, second_err = second.communicate(timeout=20)
        except subprocess.TimeoutExpired:
            self.stop_owned_process(second)
            self.fail('competing observer did not return a bounded refusal')
        self.assertNotEqual(second.returncode, 0, second_out + second_err)
        self.assertIn('Another observer holds the retained attempt', second_out + second_err)
        self.assertIsNone(first.poll(), 'competing observer must leave the current monitor attached')
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual(self.uuid_marker.read_text(), NATIVE_UUID)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assert_unknown_pending()
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

        self.wait_native_exit(timeout=35)
        self.stop_owned_process(first)
        terminal = self.recover(observer)
        self.assertNotEqual(terminal.returncode, 0, terminal.stdout + terminal.stderr)
        self.assert_unknown_pending(native_exited=True)
        self.assertEqual(checkpoint_offset(self.attempt), expected_offset)
        self.assertEqual(custody_offset(self.attempt), expected_offset)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_refused_resume_text_stays_an_incomplete_observation(self):
        observer, birth, manifest = self.start_attempt('Error: Session fixture not found\n')
        result = self.recover(observer)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assertEqual(self.row('SELECT native FROM sessions WHERE id=?', 'parent'), (NATIVE_UUID,))
        self.assertEqual(self.row("SELECT count(*) FROM messages WHERE id LIKE 'attempt1:recovery%'"), (0,))
        self.wait_native_exit()
        self.assert_unknown_pending(native_exited=True)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())

    def test_fframes_absent_native_partial_output_preserves_unknown_custody(self):
        uuid = '01a14c0e-db9f-7000-9e60-d47f6aed87d2'
        partial = '{"type":"tool_call","delta":"partial'
        observer, birth, manifest = self.start_attempt(
            native_uuid=uuid, attempt_id='attempt-1714',
            stdout_text=partial, hold=True)
        self.hold_marker.touch()
        self.wait_native_exit(timeout=10)
        result = self.recover(observer)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual((self.attempt / 'stdout').read_text(), partial)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual((self.attempt / 'native.birth').read_bytes(), birth)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)
        self.assertFalse((self.attempt / 'status').exists())
        self.assertEqual(checkpoint_offset(self.attempt), len(partial.encode()))
        self.assertEqual(custody_offset(self.attempt), len(partial.encode()))
        self.assertEqual(self.row('SELECT native FROM sessions WHERE id=?', 'parent'), (uuid,))
        self.assertEqual(self.row('SELECT receipt FROM messages WHERE id=?', 'task'), (None,))
        self.assert_unknown_pending(native_exited=True)
        self.assertFalse((self.attempt / 'acknowledged').exists())
        self.assertFalse((self.attempt / 'released').exists())
        duplicate = self.fixture(
            'start', self.db, 'attempt-1714', str(self.attempt), str(self.workspace),
            str(self.log), uuid, 'codex', 'controlled-model', 'low', sys.executable,
            str(self.native), uuid, str(self.uuid_marker), ok=False)
        self.assertNotEqual(duplicate.returncode, 0, duplicate.stdout + duplicate.stderr)
        self.assertEqual(int((self.attempt / 'native.pid').read_text()), self.native_process)
        self.assertEqual((self.attempt / 'manifest').read_bytes(), manifest)



if __name__ == '__main__':
    unittest.main(verbosity=2)
