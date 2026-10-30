"""Service placement for queue clients: a fake systemd-run stands in for the user manager.

The fake records its arguments and then execs the rest of its command line, as
`systemd-run --user --scope` does, so these tests check what the helper asks
the manager for and that the placed command is the same process.
"""
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / '.github/scripts/service-run.py'
ADAPTER = ROOT / '.github/scripts/queue-native-checks.py'

FAKE_SCOPE = r'''#!/bin/sh
echo "$@" >> "$FAKE_SYSTEMD_LOG"
echo "XDG=${XDG_RUNTIME_DIR-unset} DBUS=${DBUS_SESSION_BUS_ADDRESS-unset}" >> "$FAKE_SYSTEMD_LOG.env"
if [ -n "$FAKE_SYSTEMD_FAIL" ]; then
  echo "Failed to connect to bus: No such file or directory" >&2
  exit 1
fi
while [ "$1" != "--" ]; do shift; done
shift
exec "$@"
'''


def load(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ServiceRunTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='service-run-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.fake = self.root / 'systemd-run'
        self.fake.write_text(FAKE_SCOPE)
        self.fake.chmod(0o755)
        self.log = self.root / 'systemd.log'
        self.environment = dict(os.environ)
        self.environment.pop('BATON_SERVICE_PLACEMENT', None)
        self.environment.update(BATON_SYSTEMD_RUN=str(self.fake), FAKE_SYSTEMD_LOG=str(self.log))
        self.record = self.root / 'record'

    def run_helper(self, *command, environment=None):
        pidfile = self.root / 'command.pid'
        process = subprocess.Popen(
            [sys.executable, str(HELPER), '--role', 'queue-client', '--record', str(self.record),
             '--', 'sh', '-c', 'echo $$ > "$1"', 'sh', str(pidfile), *command],
            env=environment or self.environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = process.communicate(timeout=30)
        return process, stdout, stderr, pidfile

    def test_command_runs_in_place_inside_a_scope(self):
        process, stdout, stderr, pidfile = self.run_helper()
        self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(int(pidfile.read_text()), process.pid)
        launch = json.loads((self.record / 'service-launch.json').read_text())
        inside = json.loads((self.record / 'service-inside.json').read_text())
        self.assertEqual(launch['placement'], 'scope')
        self.assertEqual(launch['requested'], 'auto')
        self.assertEqual(launch['manager'], 'systemd-user')
        self.assertTrue(launch['unit'].startswith('baton-queue-client-'))
        self.assertTrue(launch['unit'].endswith('.scope'))
        self.assertEqual(launch['launcher']['pid'], process.pid)
        self.assertEqual(inside['process']['pid'], process.pid)
        self.assertEqual(inside['process']['starttime'], launch['launcher']['starttime'])

    def test_scope_request_sets_no_limit_property(self):
        self.run_helper()
        requests = [line for line in self.log.read_text().splitlines() if 'baton-queue-client' in line]
        self.assertEqual(len(requests), 1)
        self.assertIn('--user --scope', requests[0])
        for word in ('--property', '--slice', 'Max', 'Limit', 'Timeout'):
            self.assertNotIn(word, requests[0])

    def test_unavailable_manager_runs_unplaced_and_records_the_reason(self):
        environment = dict(self.environment, FAKE_SYSTEMD_FAIL='1')
        process, stdout, stderr, pidfile = self.run_helper(environment=environment)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertEqual(int(pidfile.read_text()), process.pid)
        launch = json.loads((self.record / 'service-launch.json').read_text())
        self.assertEqual(launch['placement'], 'none')
        self.assertIn('Failed to connect to bus', launch['reason'])
        self.assertFalse((self.record / 'service-inside.json').exists())

    def test_require_refuses_when_placement_is_not_possible(self):
        environment = dict(self.environment, FAKE_SYSTEMD_FAIL='1', BATON_SERVICE_PLACEMENT='require')
        process, stdout, stderr, pidfile = self.run_helper(environment=environment)
        self.assertEqual(process.returncode, 75, stderr)
        self.assertFalse(pidfile.exists())
        launch = json.loads((self.record / 'service-launch.json').read_text())
        self.assertEqual(launch['requested'], 'require')
        self.assertEqual(launch['placement'], 'none')

    def test_off_does_not_ask_the_manager(self):
        environment = dict(self.environment, BATON_SERVICE_PLACEMENT='off')
        process, stdout, stderr, pidfile = self.run_helper(environment=environment)
        self.assertEqual(process.returncode, 0, stderr)
        self.assertFalse(self.log.exists())
        launch = json.loads((self.record / 'service-launch.json').read_text())
        self.assertEqual((launch['requested'], launch['placement']), ('off', 'none'))

    def test_unknown_setting_is_refused(self):
        environment = dict(self.environment, BATON_SERVICE_PLACEMENT='sometimes')
        process, stdout, stderr, pidfile = self.run_helper(environment=environment)
        self.assertNotEqual(process.returncode, 0)
        self.assertFalse(pidfile.exists())

    def test_missing_command_reports_exit_127(self):
        process = subprocess.run(
            [sys.executable, str(HELPER), '--role', 'queue-client', '--', '/nonexistent/client'],
            env=dict(self.environment, BATON_SERVICE_PLACEMENT='off'),
            capture_output=True, timeout=30)
        self.assertEqual(process.returncode, 127, process.stderr)


class RuntimeEnvironmentTests(unittest.TestCase):
    """XDG_RUNTIME_DIR for systemd-run --user, derived for services that lack it."""

    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='service-runtime-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.helper = load(HELPER, 'service_run_runtime')
        self.uid = os.getuid()
        self.sockets = []

    def runtime(self, uid, bus='socket'):
        directory = self.root / str(uid)
        directory.mkdir()
        if bus == 'socket':
            listener = socket.socket(socket.AF_UNIX)
            listener.bind(str(directory / 'bus'))
            self.sockets.append(listener)
            self.addCleanup(listener.close)
        elif bus == 'file':
            (directory / 'bus').write_text('')
        return directory

    def test_derived_when_directory_and_bus_belong_to_the_user(self):
        directory = self.runtime(self.uid)
        self.assertEqual(self.helper.runtime_environment({}, self.uid, self.root),
                         {'XDG_RUNTIME_DIR': str(directory)})

    def test_caller_value_is_kept(self):
        self.runtime(self.uid)
        self.assertEqual(self.helper.runtime_environment(
            {'XDG_RUNTIME_DIR': '/run/user/1'}, self.uid, self.root), {})

    def test_not_derived_when_absent_or_without_a_bus_socket(self):
        self.assertEqual(self.helper.runtime_environment({}, self.uid, self.root), {})
        self.runtime(self.uid, bus='none')
        self.assertEqual(self.helper.runtime_environment({}, self.uid, self.root), {})

    def test_not_derived_when_the_bus_is_not_a_socket(self):
        self.runtime(self.uid, bus='file')
        self.assertEqual(self.helper.runtime_environment({}, self.uid, self.root), {})

    def test_not_derived_when_owned_by_another_user(self):
        other = self.uid + 1
        self.runtime(other)
        self.assertEqual(self.helper.runtime_environment({}, other, self.root), {})

    def test_plan_supplies_xdg_and_never_a_dbus_address(self):
        directory = self.runtime(self.uid)
        fake = Path(self.root) / 'systemd-run'
        fake.write_text(FAKE_SCOPE)
        fake.chmod(0o755)
        log = self.root / 'systemd.log'
        keys = ('XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS', 'BATON_SERVICE_PLACEMENT')
        previous = {key: os.environ.pop(key, None) for key in keys}
        self.addCleanup(lambda: [os.environ.__setitem__(k, v) for k, v in previous.items() if v is not None])
        os.environ.update(BATON_SYSTEMD_RUN=str(fake), FAKE_SYSTEMD_LOG=str(log))
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ('BATON_SYSTEMD_RUN', 'FAKE_SYSTEMD_LOG')])
        argv, launch, environment = self.helper.plan('queue-client', None, ['/bin/true'], self.root)
        self.assertEqual(launch['placement'], 'scope')
        self.assertEqual(launch['environment_supplied'], ['XDG_RUNTIME_DIR'])
        self.assertEqual(environment['XDG_RUNTIME_DIR'], str(directory))
        self.assertNotIn('DBUS_SESSION_BUS_ADDRESS', environment)
        self.assertIn('XDG_RUNTIME_DIR', argv[argv.index(self.helper.INSIDE) + 2])
        probe_env = (Path(str(log) + '.env')).read_text().splitlines()
        self.assertEqual(probe_env, ['XDG=%s DBUS=unset' % directory])

    def test_unplaced_launch_keeps_the_caller_environment(self):
        self.runtime(self.uid)
        fake = Path(self.root) / 'systemd-run'
        fake.write_text(FAKE_SCOPE)
        fake.chmod(0o755)
        os.environ.update(BATON_SYSTEMD_RUN=str(fake), FAKE_SYSTEMD_LOG=str(self.root / 'log'),
                          FAKE_SYSTEMD_FAIL='1')
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in
                                 ('BATON_SYSTEMD_RUN', 'FAKE_SYSTEMD_LOG', 'FAKE_SYSTEMD_FAIL')])
        os.environ.pop('BATON_SERVICE_PLACEMENT', None)
        argv, launch, environment = self.helper.plan('queue-client', None, ['/bin/true'], self.root)
        self.assertEqual((argv, environment), (['/bin/true'], None))
        self.assertEqual(launch['placement'], 'none')

    def test_an_empty_caller_value_is_replaced_for_systemd_run_and_restored_for_the_command(self):
        directory = self.runtime(self.uid)
        fake = Path(self.root) / 'systemd-run'
        fake.write_text(FAKE_SCOPE)
        fake.chmod(0o755)
        log = self.root / 'systemd.log'
        saved = {key: os.environ.get(key) for key in ('XDG_RUNTIME_DIR', 'BATON_SERVICE_PLACEMENT')}
        self.addCleanup(lambda: [os.environ.pop(k, None) if v is None else os.environ.__setitem__(k, v)
                                 for k, v in saved.items()])
        os.environ.pop('BATON_SERVICE_PLACEMENT', None)
        os.environ.update(XDG_RUNTIME_DIR='', BATON_SYSTEMD_RUN=str(fake), FAKE_SYSTEMD_LOG=str(log))
        self.addCleanup(lambda: [os.environ.pop(k, None) for k in ('BATON_SYSTEMD_RUN', 'FAKE_SYSTEMD_LOG')])
        argv, launch, environment = self.helper.plan('queue-client', None, ['/bin/true'], self.root)
        self.assertEqual(environment['XDG_RUNTIME_DIR'], str(directory))
        self.assertEqual(Path(str(log) + '.env').read_text().splitlines(), ['XDG=%s DBUS=unset' % directory])
        self.assertEqual(argv[argv.index(self.helper.INSIDE) + 2], 'XDG_RUNTIME_DIR=')
        result = subprocess.run(
            [sys.executable, str(HELPER), '--inside', '', 'XDG_RUNTIME_DIR=', '--',
             'sh', '-c', 'printf %s "${XDG_RUNTIME_DIR-unset}"'],
            env=dict(os.environ, XDG_RUNTIME_DIR=str(directory)), capture_output=True, timeout=30)
        self.assertEqual(result.stdout, b'')

    def test_supplied_variable_is_removed_before_the_command_runs(self):
        result = subprocess.run(
            [sys.executable, str(HELPER), '--inside', '', 'XDG_RUNTIME_DIR', '--',
             'sh', '-c', 'printf %s "${XDG_RUNTIME_DIR-unset}"'],
            env=dict(os.environ, XDG_RUNTIME_DIR='/run/user/1'), capture_output=True, timeout=30)
        self.assertEqual(result.stdout, b'unset')


class AdapterServiceTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='adapter-service-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        fake = self.root / 'systemd-run'
        fake.write_text(FAKE_SCOPE)
        fake.chmod(0o755)
        self.client = self.root / 'client'
        self.client.write_text('#!/bin/sh\ncase "$1 $2" in\n  "-- key") printf "deadbeef\\n" ;;\n  *) exit 0 ;;\nesac\n')
        self.client.chmod(0o755)
        self.previous = os.environ.copy()
        os.environ.pop('BATON_SERVICE_PLACEMENT', None)
        os.environ.update(BATON_SYSTEMD_RUN=str(fake), FAKE_SYSTEMD_LOG=str(self.root / 'systemd.log'))
        self.addCleanup(self.restore)

    def restore(self):
        os.environ.clear()
        os.environ.update(self.previous)

    def submit(self):
        adapter = load(ADAPTER, 'queue_native_checks_service')
        directory = self.root / 'request'
        directory.mkdir()
        config = {'client': str(self.client), 'state': str(self.root / 'state'), 'run': str(self.root / 'run')}
        (self.root / 'run').mkdir()
        code = adapter.submit(config, directory, [], ['/bin/true'])
        return code, directory

    def test_publisher_runs_in_a_scope_with_the_recorded_pid(self):
        code, directory = self.submit()
        self.assertEqual(code, 0)
        request = json.loads((directory / 'request.json').read_text())
        record = Path(request['service_record'])
        launch = json.loads((record / 'service-launch.json').read_text())
        inside = json.loads((record / 'service-inside.json').read_text())
        self.assertEqual(launch['placement'], 'scope')
        self.assertEqual(inside['process']['pid'], request['publisher_pid'])
        self.assertEqual(inside['process']['starttime'], request['publisher_starttime'])
        self.assertEqual(request['argv'][0], str(self.client))

    def test_unavailable_manager_does_not_change_the_request(self):
        os.environ['FAKE_SYSTEMD_FAIL'] = '1'
        code, directory = self.submit()
        self.assertEqual(code, 0)
        request = json.loads((directory / 'request.json').read_text())
        launch = json.loads((Path(request['service_record']) / 'service-launch.json').read_text())
        self.assertEqual(launch['placement'], 'none')
        self.assertEqual(request['exit_code'], 0)

    def test_caller_signal_keeps_cancellation_and_records_the_caller(self):
        self.client.write_text(
            '#!/bin/sh\ncase "$1 $2" in\n  "-- key") printf "deadbeef\\n" ;;\n'
            '  "-- run") exec sleep 30 ;;\n  *) printf "canceled=withdrawn\\nowners=0\\n" ;;\nesac\n')
        driver = self.root / 'driver.py'
        driver.write_text(
            'import importlib.util, sys\nfrom pathlib import Path\n'
            'spec = importlib.util.spec_from_file_location("adapter", sys.argv[1])\n'
            'adapter = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(adapter)\n'
            'root = Path(sys.argv[2])\n(root / "run").mkdir()\n(root / "request").mkdir()\n'
            'config = {"client": sys.argv[3], "state": str(root / "state"), "run": str(root / "run")}\n'
            'raise SystemExit(adapter.submit(config, root / "request", [], ["/bin/true"]))\n')
        process = subprocess.Popen([sys.executable, str(driver), str(ADAPTER), str(self.root), str(self.client)])
        request_path = self.root / 'request/request.json'
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if request_path.is_file() and 'publisher_starttime' in request_path.read_text():
                break
            time.sleep(0.02)
        process.send_signal(signal.SIGTERM)
        self.assertEqual(process.wait(timeout=30), 128 + signal.SIGTERM)
        request = json.loads(request_path.read_text())
        self.assertEqual(request['interrupt']['signal'], signal.SIGTERM)
        self.assertEqual(request['interrupt']['caller']['pid'], process.pid)
        self.assertIn('cgroup', request['interrupt']['caller'])
        self.assertIsNotNone(request.get('cancel_returncode'))


if __name__ == '__main__':
    unittest.main()
