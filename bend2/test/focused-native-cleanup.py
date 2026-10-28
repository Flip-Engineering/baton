"""Check focused-runner cancellation, queue custody and exit behavior."""
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
DRIVER = ROOT / '.github/scripts/run-focused-native.py'
SUPERVISOR = ROOT / '.github/scripts/focused_command_supervisor.py'
QUEUE_ADAPTER = ROOT / '.github/scripts/queue-native-checks.py'

def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

DRIVER_MODULE = load_module('focused_native_driver', DRIVER)
SUPERVISOR_MODULE = load_module('focused_command_supervisor', SUPERVISOR)
QUEUE_MODULE = load_module('queue_native_checks', QUEUE_ADAPTER)

PARENT = r'''
import signal
import subprocess
import sys
import time

child_code = "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN if sys.argv[1] == 'ignore' else signal.SIG_DFL); pathlib.Path(sys.argv[2]).write_text('ready'); time.sleep(60)"
child = subprocess.Popen([sys.executable, '-c', child_code, sys.argv[2], sys.argv[3]])
with open(sys.argv[1], 'w') as stream:
    stream.write(str(child.pid))
signal.signal(signal.SIGTERM, signal.SIG_IGN if sys.argv[4] == 'ignore' else signal.SIG_DFL)
child.wait()
'''


class FocusedCommandCleanupTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='focused-process-supervisor-')
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.evidence = self.directory / 'evidence'
        self.evidence.mkdir()
        self.pidfile = self.directory / 'child.pid'
        self.readyfile = self.directory / 'child.ready'
        self.wrappers = []
        self.addCleanup(self.cleanup_wrappers)

    def cleanup_wrappers(self):
        for process in self.wrappers:
            if process.poll() is None:
                process.send_signal(signal.SIGTERM)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=5)

    def process_identity(self, pid):
        return SUPERVISOR_MODULE.process_identity(pid)

    def wait_for_file(self, path, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if path.exists():
                return
            time.sleep(0.01)
        self.fail(f'{path.name} was not created')

    def wait_pid_gone(self, pid, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if SUPERVISOR_MODULE.process_identity(pid) is None:
                return
            time.sleep(0.01)
        self.fail(f'owned fixture process {pid} remained or was not reaped')

    def start_run_command(self, argv, extra_env=None):
        wrapper_script = self.directory / ('launcher-' + str(len(self.wrappers)) + '.py')
        wrapper_script.write_text('''
import importlib.util
import json
import os
from pathlib import Path
import signal
import sys

driver_path = os.environ['DRIVER_PATH']
spec = importlib.util.spec_from_file_location('focused_native_driver', driver_path)
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
signal.signal(signal.SIGTERM, driver.handle_sigterm)
records = []
driver.run_command('fixture', json.loads(os.environ['FIXTURE_ARGV']),
                   os.environ['FIXTURE_CWD'], dict(os.environ),
                   Path(os.environ['FIXTURE_EVIDENCE']), records)
''')
        env = dict(os.environ)
        env.update({'DRIVER_PATH': str(DRIVER), 'FIXTURE_ARGV': json.dumps(argv),
                    'FIXTURE_CWD': str(self.directory),
                    'FIXTURE_EVIDENCE': str(self.evidence)})
        if extra_env:
            env.update(extra_env)
        wrapper = subprocess.Popen([sys.executable, str(wrapper_script)], env=env,
                                   start_new_session=True)
        self.wrappers.append(wrapper)
        return wrapper

    def read_command_record(self):
        return json.loads((self.evidence / 'commands.json').read_text())[0]

    def test_run_command_preserves_success_and_failure_exit_codes(self):
        records = []
        success = DRIVER_MODULE.run_command(
            'success', [sys.executable, '-c', "print('ok')"], self.directory,
            dict(os.environ), self.evidence, records)
        self.assertEqual(success['exit_code'], 0)
        self.assertEqual((self.evidence / 'success.stdout').read_text(), 'ok\n')
        self.assertEqual(success['process_supervisor']['cleanup']['reason'], 'command-exited-clean')

        with self.assertRaises(subprocess.CalledProcessError) as error:
            DRIVER_MODULE.run_command(
                'failure', [sys.executable, '-c', 'raise SystemExit(7)'], self.directory,
                dict(os.environ), self.evidence, records)
        self.assertEqual(error.exception.returncode, 7)
        self.assertEqual(records[-1]['exit_code'], 7)
        self.assertEqual(records[-1]['process_supervisor']['exit_code'], 7)

    def test_queue_adapter_records_exact_cancelled_token(self):
        handoff_dir = self.directory / 'adapter-handoffs'
        request_dir = self.directory / 'adapter-request'
        request_dir.mkdir()
        state = self.directory / 'adapter-state'
        state.mkdir()
        config = {'client': '/bin/true', 'state': str(state), 'run': str(self.directory)}

        class InterruptedClient:
            def __init__(self):
                self.wait_calls = 0
                self.returncode = None

            def poll(self):
                return None

            def terminate(self):
                self.terminated = True

            def wait(self):
                self.wait_calls += 1
                if self.wait_calls == 1:
                    raise InterruptedError(signal.SIGTERM)
                self.returncode = 143
                return self.returncode

        process = InterruptedClient()

        def cancel_client(argv, stdout=None, stderr=None):
            stdout.write(b'canceled=withdrawn\nowners=1\n')
            return subprocess.CompletedProcess(argv, 0)

        old_handoff_env = os.environ.get('BATON2_FOCUSED_QUEUE_HANDOFF_DIR')
        os.environ['BATON2_FOCUSED_QUEUE_HANDOFF_DIR'] = str(handoff_dir)
        try:
            with mock.patch.object(QUEUE_MODULE, 'run_queue_key', return_value=(0, 'b' * 64)), \
                 mock.patch.object(QUEUE_MODULE.subprocess, 'Popen', return_value=process), \
                 mock.patch.object(QUEUE_MODULE.subprocess, 'run', side_effect=cancel_client):
                result = QUEUE_MODULE.submit(
                    config, request_dir, [], ['sh', 'bend2/scripts/build-native.sh'])
        finally:
            if old_handoff_env is None:
                os.environ.pop('BATON2_FOCUSED_QUEUE_HANDOFF_DIR', None)
            else:
                os.environ['BATON2_FOCUSED_QUEUE_HANDOFF_DIR'] = old_handoff_env
        self.assertEqual(result, 143)
        rows = list(handoff_dir.glob('*.json'))
        self.assertEqual(len(rows), 1)
        handoff = json.loads(rows[0].read_text())
        self.assertEqual(handoff['schema'], 'baton2-focused-queue-owner-v1')
        self.assertEqual(handoff['key'], 'b' * 64)
        self.assertEqual(handoff['status'], 'cancelled')
        self.assertEqual(handoff['cancel_result'], ['canceled=withdrawn', 'owners=1'])
        request = json.loads(Path(handoff['request_path']).read_text())
        self.assertEqual(request['token'], handoff['token'])
        self.assertEqual(request['key'], handoff['key'])

    def test_run_command_cleans_same_process_group(self):
        parent_script = self.directory / 'parent.py'
        parent_script.write_text(PARENT)
        wrapper = self.start_run_command(
            [sys.executable, str(parent_script), str(self.pidfile), 'term',
             str(self.readyfile), 'term'])
        self.wait_for_file(self.readyfile)
        child_pid = int(self.pidfile.read_text())
        wrapper.send_signal(signal.SIGTERM)
        self.assertEqual(wrapper.wait(timeout=15), 143)
        self.wait_pid_gone(child_pid)
        command = self.read_command_record()
        cleanup = command['process_supervisor']['cleanup']
        self.assertTrue(command['cancelled'])
        self.assertFalse(cleanup['group_exists'])
        self.assertFalse(cleanup['kill_sent_to_group'])
        self.assertEqual(cleanup['live_adopted_children'], [])

    def test_run_command_escalates_same_process_group(self):
        parent_script = self.directory / 'parent.py'
        parent_script.write_text(PARENT)
        wrapper = self.start_run_command(
            [sys.executable, str(parent_script), str(self.pidfile), 'ignore',
             str(self.readyfile), 'ignore'])
        self.wait_for_file(self.readyfile)
        child_pid = int(self.pidfile.read_text())
        wrapper.send_signal(signal.SIGTERM)
        self.assertEqual(wrapper.wait(timeout=15), 143)
        self.wait_pid_gone(child_pid)
        cleanup = self.read_command_record()['process_supervisor']['cleanup']
        self.assertTrue(cleanup['kill_sent_to_group'])
        self.assertFalse(cleanup['group_exists'])

    def test_cancellation_reaps_setsid_descendant(self):
        pid_file = self.directory / 'escaped.pid'
        ready = self.directory / 'escaped.ready'
        marker = 'focused-escaped-' + str(os.getpid())
        parent_script = self.directory / 'parent-setsid.py'
        parent_script.write_text('''
import pathlib
import signal
import subprocess
import sys
import time

pid_file = pathlib.Path(sys.argv[1])
ready = pathlib.Path(sys.argv[2])
marker = sys.argv[3]
child = "import pathlib,signal,sys,time; signal.signal(signal.SIGTERM, signal.SIG_IGN); pathlib.Path(sys.argv[1]).write_text(sys.argv[2]); time.sleep(60)"
process = subprocess.Popen([sys.executable, '-c', child, str(ready), marker],
                           start_new_session=True)
pid_file.write_text(str(process.pid))
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(60)
''')
        wrapper = self.start_run_command(
            [sys.executable, str(parent_script), str(pid_file), str(ready), marker])
        self.wait_for_file(ready)
        child_pid = int(pid_file.read_text())
        wrapper.send_signal(signal.SIGTERM)
        self.assertEqual(wrapper.wait(timeout=15), 143)
        self.wait_pid_gone(child_pid)
        cleanup = self.read_command_record()['process_supervisor']['cleanup']
        self.assertEqual(cleanup['reason'], 'cancellation')
        self.assertTrue(any(item['pid'] == child_pid and item['kill_sent']
                            for item in cleanup['descendants']), cleanup['descendants'])
        self.assertEqual(cleanup['live_adopted_children'], [])

    def test_shared_queue_token_cancellation_preserves_other_requester(self):
        if not Path('/usr/bin/yes').is_file():
            self.skipTest('/usr/bin/yes fixture is unavailable')
        state = self.directory / 'queue-state'
        key = 'a' * 64
        focused_token = 'focused-token-' + str(os.getpid())
        other_token = 'other-token-' + str(os.getpid())
        keydir = state / 'keys' / key
        attempt = keydir / 'runs' / 'fixture-attempt'
        attempt.mkdir(parents=True)
        (keydir / 'owners').mkdir()
        handoff_dir = self.evidence / 'fixture-queue-handoffs'
        handoff_dir.mkdir()

        other_owner = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                       start_new_session=True)
        self.addCleanup(lambda: self.cleanup_process(other_owner))
        other_identity = self.process_identity(other_owner.pid)
        self.assertIsNotNone(other_identity)
        (keydir / 'owners' / other_token).write_text(
            f'pid={other_owner.pid}\nstarttime={other_identity["starttime"]}\nstarted_ns=1\n')

        client = str(Path('/usr/bin/yes').resolve())
        request = {'key': key, 'token': focused_token,
                   'argv': [client, '--', 'run', '--token', focused_token,
                            '--state-root', str(state)]}
        request_path = self.directory / 'request.json'
        request_path.write_text(json.dumps(request))
        old_handoff_env = os.environ.get('BATON2_FOCUSED_QUEUE_HANDOFF_DIR')
        os.environ['BATON2_FOCUSED_QUEUE_HANDOFF_DIR'] = str(handoff_dir)
        try:
            QUEUE_MODULE.write_focused_queue_handoff(
                {'state': str(state), 'client': client}, request,
                self.directory, 'cancelled', cancel_returncode=0,
                cancel_result=['canceled=withdrawn', 'owners=1'])
        finally:
            if old_handoff_env is None:
                os.environ.pop('BATON2_FOCUSED_QUEUE_HANDOFF_DIR', None)
            else:
                os.environ['BATON2_FOCUSED_QUEUE_HANDOFF_DIR'] = old_handoff_env

        # The focused token was withdrawn by the queue's cancel command. The
        # other live owner remains registered for this exact key.
        (attempt / 'meta').write_text(
            f'kind=cc\nstate_root={state}\nkeydir={keydir}\nattempt={attempt}\nkey={key}\n')
        parent_script = self.directory / 'queue-parent.py'
        pid_file = self.directory / 'queue-supervisor.pid'
        parent_script.write_text('''
import pathlib
import signal
import subprocess
import sys
import time

client, attempt, pid_file = sys.argv[1:]
process = subprocess.Popen([client, '--', '__supervise', attempt],
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           start_new_session=True)
pathlib.Path(pid_file).write_text(str(process.pid))
signal.signal(signal.SIGTERM, signal.SIG_IGN)
time.sleep(60)
''')
        wrapper = self.start_run_command(
            [sys.executable, str(parent_script), '/usr/bin/yes', str(attempt), str(pid_file)])
        self.wait_for_file(pid_file)
        queue_pid = int(pid_file.read_text())
        queue_identity = self.process_identity(queue_pid)
        self.assertIsNotNone(queue_identity)
        (keydir / 'active').write_text(
            f'pid={queue_pid}\nstarttime={queue_identity["starttime"]}\nkind=cc\nsetsid=1\n')
        wrapper.send_signal(signal.SIGTERM)
        self.assertEqual(wrapper.wait(timeout=15), 143)
        self.assertIsNotNone(self.process_identity(queue_pid),
                             'focused cleanup killed the queue-owned shared supervisor')
        self.assertIsNone(other_owner.poll(), 'the other queue requester was terminated')
        cleanup = self.read_command_record()['process_supervisor']['cleanup']
        self.assertEqual(len(cleanup['queue_custody_handoffs']), 1, cleanup)
        handoff = cleanup['queue_custody_handoffs'][0]
        self.assertEqual(handoff['key'], key)
        self.assertEqual(handoff['token'], focused_token)
        self.assertEqual(handoff['other_live_owners'], [other_token])
        self.assertEqual(handoff['owner_count'], 1)
        self.cleanup_process_by_identity(queue_pid, queue_identity['starttime'], '/usr/bin/yes')

    def cleanup_process_by_identity(self, pid, starttime, executable):
        identity = self.process_identity(pid)
        if identity is None:
            return
        self.assertEqual(identity['starttime'], starttime)
        self.assertEqual(str(Path(f'/proc/{pid}/exe').resolve()), str(Path(executable).resolve()))
        pidfd, checked = SUPERVISOR_MODULE.open_verified_pidfd(
            pid, expected_starttime=starttime)
        try:
            signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        finally:
            os.close(pidfd)
        self.wait_pid_gone(pid)

    def cleanup_process(self, process):
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


if __name__ == '__main__':
    unittest.main()
