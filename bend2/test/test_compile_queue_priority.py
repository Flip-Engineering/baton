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
import signal
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
            "out=\n"
            "previous=\n"
            "for argument in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then out=$argument; fi\n"
            "  previous=$argument\n"
            "done\n"
            "sleep 0.4\n"
            "printf '%s\\n' \"$QUEUE_TEST_ID\" >> '" + str(self.log) + "'\n"
            "if [ -n \"$out\" ]; then : > \"$out\"; fi\n"
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

    def published_tickets(self):
        tickets = self.state / "waiters" / "cc"
        if not tickets.is_dir():
            return []
        return sorted(path for path in tickets.iterdir() if ".tmp." not in path.name)

    def wait_ticket(self, deadline=30.0):
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            published = self.published_tickets()
            if published:
                return published
            time.sleep(0.02)
        self.fail("queue request did not publish a scheduling ticket")

    def hold_cc(self):
        lock = (self.state / "cc.lock").open("w")
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
        lock = self.hold_cc()
        default = self.request("default")
        self.wait_ticket()
        flip = self.request("flip", priority=9)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and len(self.published_tickets()) < 2:
            time.sleep(0.02)
        fcntl.flock(lock, fcntl.LOCK_UN)
        self.finish(default, flip)
        self.assertEqual(self.read_order(), ["flip", "default"])
        self.assertEqual(self.published_tickets(), [])

    def test_equal_priority_keeps_arrival_order(self):
        lock = self.hold_cc()
        first = self.request("first", priority=9)
        self.wait_ticket()
        second = self.request("second", priority=9)
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline and len(self.published_tickets()) < 2:
            time.sleep(0.02)
        fcntl.flock(lock, fcntl.LOCK_UN)
        self.finish(first, second)
        self.assertEqual(self.read_order(), ["first", "second"])

    def test_stale_ticket_is_ignored(self):
        waiters = self.state / "waiters" / "cc"
        waiters.mkdir(mode=0o2770, parents=True)
        waiters.chmod(0o2770)
        (waiters / "00000000000000000001-dead").write_text(
            "priority=9\npid=999999\nstarttime=1\nkey=dead\ntoken=dead\n")
        request = self.request("alive")
        self.finish(request)
        self.assertEqual(self.read_order(), ["alive"])
        # A ticket that parses but is proven stale is reaped by the scan.
        self.assertEqual(list(waiters.iterdir()), [])
        # An unparseable or incomplete record is preserved.
        (waiters / "00000000000000000002-unknown").write_text("garbage\n")
        again = self.request("alive2")
        self.finish(again)
        self.assertEqual([path.name for path in waiters.iterdir()],
                         ["00000000000000000002-unknown"])

    def test_killed_supervisor_ticket_is_reaped(self):
        lock = self.hold_cc()
        blocked = self.request("blocked")
        active = None
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            keys = list((self.state / "keys").glob("*")) if (self.state / "keys").is_dir() else []
            if keys and (keys[0] / "active").exists():
                active = keys[0] / "active"
                break
            time.sleep(0.02)
        self.assertIsNotNone(active, "blocked request did not record its supervisor")
        fields = dict(line.split("=", 1) for line in active.read_text().splitlines() if "=" in line)
        os.kill(int(fields["pid"]), signal.SIGKILL)
        blocked.communicate(timeout=60)
        fcntl.flock(lock, fcntl.LOCK_UN)
        waiters = self.state / "waiters" / "cc"
        self.assertTrue(self.published_tickets(), "expected the killed supervisor ticket to remain")
        revived = self.request("revived")
        self.finish(revived)
        self.assertEqual(self.published_tickets(), [])


if __name__ == "__main__":
    unittest.main()
