"""Prepared keeper host behavior through the actual compiled ProcessChild fixture.

No coordinator admission or owner delivery is inferred from these host tests.
"""
import importlib.util
import json
import os
from pathlib import Path
import select
import socket
import subprocess
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('retry_helpers', HERE / 'retained-recovery-retry.py')
helpers = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helpers)
EXE = helpers.EXE


class Prepared(unittest.TestCase):
    def setUp(self):
        self.f = helpers.Retry()
        self.f.setUp()
        self.addCleanup(self.f.doCleanups)
        self.identity = "request λ ' exact"

    def line(self, child):
        ready, _, _ = select.select([child.stdout], [], [], 10)
        self.assertTrue(ready, 'fixture reply did not arrive')
        result = child.stdout.readline()
        if not result:
            self.fail(child.stderr.read().decode())
        return result.decode().strip()

    def start(self, mode='start', native=None):
        native = native or self.f.write_program('native', 'native', EXE)
        recovery = self.f.write_program('recovery', 'recovery', EXE)
        # Recovery consumes the original identity from immutable fixture input.
        body = recovery.read_text().replace("'recover-retained',sys.argv[1]", "'recover-prepared',sys.argv[1]," + repr(self.identity))
        recovery.write_text(body)
        child = subprocess.Popen([str(EXE), 'prepare', str(self.f.db), str(self.f.attempt),
                                  str(self.f.home), str(recovery), self.identity, mode, str(native)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
        self.f.children.append(child)
        state = json.loads(self.line(child))
        self.assertEqual(state['processState'], 'prepared')
        self.assertEqual(state['nativePid'], 0)
        self.assertEqual(state['waitStatus'], -1)
        self.assertTrue(state['preparedMode'])
        self.assertTrue(state['observerAttached'])
        self.assertGreater(state['keeper']['pid'], 0)
        self.assertEqual((self.f.attempt / 'bootstrap').read_text(), self.identity)
        self.f.server.settimeout(.2)
        with self.assertRaises(socket.timeout):
            self.f.server.accept()
        self.f.server.settimeout(10)
        lock = subprocess.run([str(EXE), 'lock-try', str(self.f.db)], capture_output=True, text=True, timeout=10)
        self.assertEqual(lock.stdout, 'busy\n')
        return child, state

    def test_start_grant_is_identity_bound_and_idempotent(self):
        child, prepared = self.start()
        child.stdin.close()
        self.assertEqual(self.line(child), 'grant-refused')
        first = json.loads(self.line(child))
        second = json.loads(self.line(child))
        self.assertEqual(first, second)
        self.assertEqual(first['processState'], 'running')
        self.assertEqual(first['keeper'], prepared['keeper'])
        event, endpoint = self.f.connect('native')
        self.assertEqual(event['pid'], first['nativePid'])
        self.f.assert_no_second_recovery()  # no additional endpoint or observer
        endpoint.write(b'finish\n')
        child.wait(timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr.read().decode())
        self.assertEqual((self.f.attempt / 'status').read_text(), '0\n')
        self.assertTrue((self.f.attempt / 'acknowledged').exists())

    def test_cancellation_releases_without_endpoint_effect(self):
        child, _ = self.start(mode='cancel')
        child.stdin.close()
        state = json.loads(self.line(child))
        self.assertEqual(state['processState'], 'cancelled')
        self.assertEqual(state['nativePid'], 0)
        self.assertEqual(state['waitStatus'], -1)
        self.assertEqual(self.line(child), 'prepared-cancelled')
        child.wait(timeout=10)
        self.assertEqual(child.returncode, 0)
        self.assertFalse((self.f.attempt / 'start-attempt').exists())
        self.f.server.settimeout(.2)
        with self.assertRaises(socket.timeout):
            self.f.server.accept()
        lock = subprocess.run([str(EXE), 'lock-try', str(self.f.db)], capture_output=True, text=True, timeout=10)
        self.assertEqual(lock.stdout, 'acquired\n')

    def test_known_no_spawn_is_retained_and_second_grant_does_not_retry(self):
        child, _ = self.start(mode='unstarted', native=self.f.home / 'missing')
        child.stdin.close()
        self.assertEqual(self.line(child), 'grant-refused')
        first = json.loads(self.line(child))
        second = json.loads(self.line(child))
        self.assertEqual(first, second)
        self.assertEqual(first['processState'], 'unstarted')
        self.assertEqual(first['nativePid'], 0)
        self.assertGreater(first['startError'], 0)
        child.wait(timeout=10)
        self.assertEqual(child.returncode, 0, child.stderr.read().decode())
        self.assertTrue((self.f.attempt / 'acknowledged').exists())

    def test_observer_loss_before_grant_recovers_same_prepared_keeper(self):
        child, state = self.start()
        child.kill()
        child.wait(timeout=5)
        event, recovery = self.f.connect('recovery')
        self.assertEqual(event['ppid'], state['keeper']['pid'])
        self.f.server.settimeout(.2)
        with self.assertRaises(socket.timeout):
            self.f.server.accept()
        self.f.server.settimeout(10)
        recovery.write(b'attach\n')
        event, endpoint = self.f.connect('native')
        self.assertEqual(event['ppid'], state['keeper']['pid'])
        endpoint.write(b'finish\n')
        self.f.wait_file('acknowledged')
        self.assertEqual((self.f.attempt / 'status').read_text(), '0\n')


if __name__ == '__main__':
    unittest.main()
