"""Wake fixtures fail with evidence when they stall, wait while they are live, and
stop their idle database owners through the supported command (#1396).

These tests use disposable directories and stand-in processes. No coordinator
build is needed.
"""
import importlib.util
import json
import os
import pathlib
import signal
import sqlite3
import subprocess
import sys
import tempfile
import textwrap
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
WAKE_WAIT = ROOT / 'bend2/test/wake_wait.py'
DRIVER = ROOT / '.github/scripts/record-native-checks.py'
spec = importlib.util.spec_from_file_location('wake_wait', WAKE_WAIT)
wake_wait = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wake_wait)

DATABASE = '/disposable/state.db'
OWNER = {'pid': 1, 'command': f'/x/baton2 --instance-owner {DATABASE}'}
LIVE = {'pid': 2, 'command': f'/x/baton2 {DATABASE} receive root'}


class Sequence:
    """Successive samples of a process table; the last sample repeats."""

    def __init__(self, *samples):
        self.samples = list(samples)
        self.count = 0

    def __call__(self):
        sample = self.samples[min(self.count, len(self.samples) - 1)]
        self.count += 1
        return sample


class Wait(unittest.TestCase):
    def test_a_stalled_fixture_fails_with_its_evidence(self):
        with tempfile.TemporaryDirectory() as name:
            directory = pathlib.Path(name)
            database = directory / 'state.db'
            with sqlite3.connect(database) as connection:
                connection.execute('CREATE TABLE messages(id, sender, recipient, kind, seq)')
                connection.execute("INSERT INTO messages VALUES('m1','child','root','report',1)")
                connection.execute('CREATE TABLE wake_claims(session, state, owner, generation)')
                connection.execute("INSERT INTO wake_claims VALUES('root','claimed','m1',1)")
            attempt = directory / 'state.db.attempt-aa'
            attempt.mkdir()
            (attempt / 'status').write_text('0\n')
            (attempt / 'observer-error').write_text('pid 7 exited before attach: wait status 1280\n')
            (directory / 'calls').mkdir()
            (directory / 'calls/root.jsonl').write_text('{}\n')

            def rows(sql):
                with sqlite3.connect(database) as connection:
                    connection.row_factory = sqlite3.Row
                    return [dict(row) for row in connection.execute(sql)]

            owner = {'pid': 1, 'command': f'/x/baton2 --instance-owner {database}'}
            with self.assertRaises(AssertionError) as raised:
                wake_wait.wait_for(
                    lambda: False, 'the root did not start a second turn.', lambda: [owner], database,
                    lambda: wake_wait.evidence(directory, database, [owner], rows), interval=0)
        text = str(raised.exception)
        for expected in ('the root did not start a second turn.', 'no process left',
                         '"claimed"', '"m1"', 'observer-error', 'wait status 1280', 'root": 1',
                         'attempt'):
            self.assertIn(expected, text)

    def test_a_live_fixture_is_waited_for(self):
        processes = Sequence([LIVE], [LIVE], [LIVE], [OWNER])
        observed = Sequence(False, False, False, True)
        result = wake_wait.wait_for(lambda: observed(), 'slow recovery', processes, DATABASE,
                                    lambda: 'unused', interval=0)
        self.assertTrue(result)
        self.assertEqual(processes.count, 4)

    def test_one_stalled_sample_is_not_a_failure(self):
        processes = Sequence([OWNER], [LIVE], [OWNER], [LIVE], [OWNER])
        observed = Sequence(False, False, False, False, True)
        self.assertTrue(wake_wait.wait_for(lambda: observed(), 'event', processes, DATABASE,
                                           lambda: 'unused', interval=0))

    def test_an_event_that_arrives_as_the_fixture_stalls_succeeds(self):
        observed = Sequence(False, True)
        self.assertTrue(wake_wait.wait_for(lambda: observed(), 'event', lambda: [OWNER], DATABASE,
                                           lambda: 'unused', interval=0))

    def test_no_process_at_all_is_stalled(self):
        with self.assertRaises(AssertionError):
            wake_wait.wait_for(lambda: False, 'event', lambda: [], DATABASE, lambda: 'evidence',
                               interval=0)


class Owners(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='wake-owners-')
        self.addCleanup(temporary.cleanup)
        self.directory = pathlib.Path(temporary.name)
        self.database = self.directory / 'state.db'
        self.marker = self.directory / 'shutdown.marker'
        self.pidfile = self.directory / 'owner.pid'
        self.executable = self.directory / 'baton2'
        self.executable.write_text(textwrap.dedent(f'''\
            #!/bin/sh
            [ "$1" = "--instance-shutdown" ] || exit 64
            echo "$2" >> {self.marker}
            kill -TERM "$(cat {self.pidfile})"
            '''))
        self.executable.chmod(0o755)
        self.owner = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(120)',
                                       '--instance-owner', str(self.database)])
        self.addCleanup(lambda: (self.owner.kill(), self.owner.wait()))
        self.pidfile.write_text(str(self.owner.pid))

    def processes(self):
        if self.owner.poll() is not None:
            return []
        return [{'pid': self.owner.pid,
                 'command': f'python -c sleep --instance-owner {self.database}'}]

    def test_an_idle_owner_is_stopped_through_the_supported_command(self):
        result = wake_wait.stop_owners(self.executable, self.database, self.processes)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(self.marker.read_text().strip(), str(self.database))
        self.assertEqual(self.owner.wait(timeout=30), -signal.SIGTERM)

    def test_a_live_process_keeps_the_owner_for_the_general_cleanup(self):
        live = {'pid': 2, 'command': f'native fixture {self.database}'}
        result = wake_wait.stop_owners(self.executable, self.database,
                                       lambda: [*self.processes(), live])
        self.assertIsNone(result)
        self.assertFalse(self.marker.exists())
        self.assertIsNone(self.owner.poll())

    def test_nothing_to_stop_runs_no_command(self):
        self.owner.kill()
        self.owner.wait()
        self.assertIsNone(wake_wait.stop_owners(self.executable, self.database, self.processes))
        self.assertFalse(self.marker.exists())


class Termination(unittest.TestCase):
    def test_sigterm_runs_the_cleanup_and_stops_the_run(self):
        with tempfile.TemporaryDirectory() as name:
            marker = pathlib.Path(name) / 'cleaned'
            script = textwrap.dedent(f'''\
                import importlib.util, os, signal
                spec = importlib.util.spec_from_file_location('w', {str(WAKE_WAIT)!r})
                w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)
                w.on_termination(lambda: open({str(marker)!r}, 'w').write('cleaned'))
                os.kill(os.getpid(), signal.SIGTERM)
                ''')
            result = subprocess.run([sys.executable, '-I', '-c', script], capture_output=True, text=True,
                                    timeout=60)
        self.assertEqual(marker.name, 'cleaned')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('KeyboardInterrupt', result.stderr)


class RootWakeFixture(unittest.TestCase):
    """The wait and the cleanup through RootWake itself, with a stand-in coordinator
    executable that only implements --instance-owner and --instance-shutdown."""

    def setUp(self):
        spec = importlib.util.spec_from_file_location('root_wake_fixture',
                                                      ROOT / 'bend2/test/root-wake.py')
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        temporary = tempfile.TemporaryDirectory(prefix='root-wake-exe-', dir=ROOT / '.scratch/bend2')
        self.addCleanup(temporary.cleanup)
        self.bin = pathlib.Path(temporary.name)
        self.marker = self.bin / 'shutdown.marker'
        self.pidfile = self.bin / 'owner.pid'
        self.executable = self.bin / 'baton2'
        self.executable.write_text(textwrap.dedent(f'''\
            #!/bin/sh
            case "$1" in
              --instance-owner) trap 'exit 0' TERM; while :; do sleep 0.1; done ;;
              --instance-shutdown) echo "$2" >> {self.marker}; kill -TERM "$(cat {self.pidfile})" ;;
            esac
            '''))
        self.executable.chmod(0o755)
        self.module.EXE = self.executable
        self.module.receive.EXE = self.executable
        self.case = self.module.RootWake('test_a_claude_player_wakes_through_the_same_receive_endpoint')
        self.case.setUp()
        self.addCleanup(self.case.tearDown)
        self.owner = None

    def start_owner(self):
        self.owner = subprocess.Popen([str(self.executable), '--instance-owner', str(self.case.db)])
        self.addCleanup(lambda: (self.owner.kill(), self.owner.wait()))
        self.pidfile.write_text(str(self.owner.pid))
        deadline = 0
        while not self.case.owned_processes():
            deadline += 1
            self.assertLess(deadline, 2000, 'the stand-in owner never appeared in the fixture table')
            subprocess.run(['sleep', '0.005'])

    def test_a_fixture_with_no_process_fails_with_evidence_through_eventually(self):
        with self.assertRaises(AssertionError) as raised:
            self.case.eventually(lambda: False, 'the root did not start a second turn.')
        text = str(raised.exception)
        self.assertIn('the root did not start a second turn.', text)
        self.assertIn('no process left', text)
        self.assertIn('processes: []', text)

    def test_an_idle_owner_alone_is_a_stall(self):
        self.start_owner()
        self.assertEqual(len(self.case.owned_processes()), 1)
        with self.assertRaises(AssertionError) as raised:
            self.case.eventually(lambda: False, 'the second turn never started.')
        self.assertIn('--instance-owner', str(raised.exception))

    def test_cleanup_stops_the_owner_through_the_supported_command(self):
        self.start_owner()
        self.case.cleanup_fixture()
        self.assertEqual(self.marker.read_text().strip(), str(self.case.db))
        self.assertEqual(self.owner.wait(timeout=30), 0)
        self.assertEqual(self.case.owned_processes(), [])

    def test_a_live_non_owner_process_is_waited_for(self):
        self.start_owner()
        live = subprocess.Popen(['sh', '-c', 'sleep 0.3', 'native fixture', str(self.case.directory)])
        self.addCleanup(lambda: (live.kill(), live.wait()))
        calls = []

        def observation():
            calls.append(1)
            return len(calls) >= 4

        stand_in = lambda: [{'pid': live.pid, 'command': f'native fixture {self.case.directory}'}] \
            if len(calls) < 3 else self.case.owned_processes()
        self.assertTrue(self.module.wake_wait.wait_for(observation, 'slow recovery', stand_in,
                                                      self.case.db, self.case.diagnostics, interval=0))


class Driver(unittest.TestCase):
    def test_the_selected_test_driver_returns_and_saves_a_stalled_wake_failure(self):
        with tempfile.TemporaryDirectory(prefix='wake-driver-') as name:
            tree = pathlib.Path(name)
            (tree / 'bend2/test').mkdir(parents=True)
            (tree / 'bend2/test/root-wake.py').write_text(textwrap.dedent(f'''\
                import importlib.util, unittest
                spec = importlib.util.spec_from_file_location('w', {str(WAKE_WAIT)!r})
                w = importlib.util.module_from_spec(spec); spec.loader.exec_module(w)


                class Stalled(unittest.TestCase):
                    def test_missing_second_turn(self):
                        owner = dict(pid=1, command='x --instance-owner /d/state.db')
                        w.wait_for(lambda: False, 'the root did not start a second turn.',
                                   lambda: [owner], '/d/state.db', lambda: 'evidence text', interval=0)


                if __name__ == '__main__':
                    unittest.main()
                '''))
            results = tree / 'results'
            completed = subprocess.run(
                [sys.executable, str(DRIVER), 'observe', str(results), '--', 'bend2/test/root-wake.py'],
                cwd=tree, capture_output=True, text=True, timeout=120)
            document = json.loads((results / 'root-wake.py.json').read_text())
        self.assertEqual(completed.returncode, 1, completed.stderr)
        self.assertEqual(document['exit_code'], 1)
        self.assertTrue(document['judged'])
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Stalled.test_missing_second_turn',
                                                           'assertion']])
        self.assertIn('evidence text', completed.stderr)


if __name__ == '__main__':
    unittest.main()
