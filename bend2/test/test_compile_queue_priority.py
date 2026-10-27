"""Compile queue scheduling tickets honor priority and stay safe.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The fake
compiler only appends its request id to a log and sleeps briefly, so no
real compiler runs. Invariants: a later higher-priority request runs
before an already-waiting default request; equal priorities keep arrival
order; a ticket whose recorded pid and start time no longer identify a
live process is ignored; a completed request leaves no ticket behind.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueuePriorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-priority-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.log = self.root / "order.log"
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "sleep 0.4\n"
            "printf '%s\\n' \"$QUEUE_TEST_ID\" >> '" + str(self.log) + "'\n"
            "exit 0\n")
        self.compiler.chmod(0o755)
        self.main = self.root / "main.c"
        self.main.write_text("int main(void){return 0;}\n")
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def request(self, ident, priority=0):
        out = self.root / ("out-" + ident)
        argv = [self.candidate, "--", "run", "--kind", "cc",
                "--state-root", str(self.state), "--cwd", str(self.root),
                "--root", str(self.root), "--source-root", str(self.root),
                "--compiler", str(self.compiler), "--linker", "/usr/bin/ld",
                "--version", "fake-priority-v1", "--option", "id=" + ident,
                "--priority", str(priority), "--artifact", "output=" + str(out),
                "--input", str(self.main),
                "--", str(self.compiler), "-o", str(out)]
        return subprocess.Popen(argv, env=dict(self.environment, QUEUE_TEST_ID=ident),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

    def wait_ticket(self, deadline=30.0):
        tickets = self.state / "waiters"
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            if tickets.is_dir() and any(tickets.iterdir()):
                return sorted(tickets.iterdir())
            time.sleep(0.02)
        self.fail("queue request did not publish a scheduling ticket")

    def hold_heavy(self):
        lock = (self.state / "heavy.lock").open("w")
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return lock

    def finish(self, *processes):
        for process in processes:
            stdout, stderr = process.communicate(timeout=60)
            self.assertEqual(process.returncode, 0, stdout + stderr)

    def read_order(self):
        return self.log.read_text().split()

    def test_priority_request_precedes_waiting_default(self):
        lock = self.hold_heavy()
        default = self.request("default")
        self.wait_ticket()
        flip = self.request("flip", priority=9)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and len(list((self.state / "waiters").iterdir())) < 2:
            time.sleep(0.02)
        fcntl.flock(lock, fcntl.LOCK_UN)
        self.finish(default, flip)
        self.assertEqual(self.read_order(), ["flip", "default"])
        self.assertEqual(list((self.state / "waiters").iterdir()), [])

    def test_equal_priority_keeps_arrival_order(self):
        lock = self.hold_heavy()
        first = self.request("first", priority=9)
        self.wait_ticket()
        second = self.request("second", priority=9)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and len(list((self.state / "waiters").iterdir())) < 2:
            time.sleep(0.02)
        fcntl.flock(lock, fcntl.LOCK_UN)
        self.finish(first, second)
        self.assertEqual(self.read_order(), ["first", "second"])

    def test_stale_ticket_is_ignored(self):
        waiters = self.state / "waiters"
        waiters.mkdir(mode=0o2770)
        waiters.chmod(0o2770)
        (waiters / "00000000000000000001-dead").write_text(
            "priority=9\npid=999999\nstarttime=1\nkey=dead\ntoken=dead\n")
        request = self.request("alive")
        self.finish(request)
        self.assertEqual(self.read_order(), ["alive"])
        self.assertEqual(list(waiters.iterdir()), [pathlib.Path(
            str(waiters / "00000000000000000001-dead"))])


if __name__ == "__main__":
    unittest.main()
