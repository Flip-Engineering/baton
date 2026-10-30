"""A later requester of a waiting execution raises its scheduling priority (#1371).

BATON2_COMPILE_QUEUE_BIN names the queue executable under test. Every test runs on a
disposable state root. An exclusive flock on heavy.lock, taken by the test the way the
exclusive-lock queue takes it, keeps admission closed: each supervisor stays a ticket
until the test releases the lock.

* A priority 100 requester that joins a priority 0 execution of the same key is told
  the effective priority, both tickets of the one supervisor carry priority 100, and
  the execution still runs once.
* The cancellation of that owner, and the end of its process, lower the tickets again
  to the priority of the owner that remains.
* A joined priority orders the execution before an independent request of a priority
  between the two; without the join the independent request goes first.
"""
import fcntl
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import unittest


class PriorityJoinTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-priority-join-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.log = self.root / "log"
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "tag=job; out=''; prev=''\n"
            "for arg in \"$@\"; do\n"
            "  [ \"$prev\" = --tag ] && tag=$arg\n"
            "  [ \"$prev\" = -o ] && out=$arg\n"
            "  prev=$arg\n"
            "done\n"
            "printf 'start %s\\n' \"$tag\" >> " + str(self.log) + "\n"
            "[ -n \"$out\" ] && printf 'artifact-%s' \"$tag\" > \"$out\"\n"
            "exit 0\n")
        self.compiler.chmod(0o755)
        (self.root / "entry.bend").write_text("def main() -> Unit:\n  Unit{}\n")
        self.children = []
        self.holder = None
        self.addCleanup(self.finish)

    def finish(self):
        self.release()
        for child, _ in self.children:
            if child.poll() is None:
                try:
                    child.wait(timeout=60)
                except subprocess.TimeoutExpired:
                    child.kill()

    def hold(self):
        self.holder = open(self.state / "heavy.lock", "a+")
        fcntl.flock(self.holder, fcntl.LOCK_EX)

    def release(self):
        if self.holder is not None:
            fcntl.flock(self.holder, fcntl.LOCK_UN)
            self.holder.close()
            self.holder = None

    def environment(self):
        return dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def request(self, token, tag, priority):
        """Start a cgen request; the tag names the key, the priority is the requested one."""
        out = self.root / (tag + ".c")
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / ("receipt-" + token)), "--kind", "cgen",
                "--priority", str(priority), "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root), "--source-root", str(self.root),
                "--entry", "entry.bend", "--compiler", str(self.compiler),
                "--artifact", "c.c=" + str(out), "--option", "tag=" + tag,
                "--", str(self.compiler), "--tag", tag, "-o", str(out)]
        errors = self.root / ("stderr-" + token)
        child = subprocess.Popen(argv, env=self.environment(), stdout=subprocess.DEVNULL,
                                 stderr=open(errors, "w"))
        self.children.append((child, errors))
        return child

    def stderr_of(self, token):
        path = self.root / ("stderr-" + token)
        return path.read_text() if path.exists() else ""

    def until(self, what, test, seconds=60):
        # This deadline detects a broken fixture; it does not bound a compiler.
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return
            time.sleep(0.05)
        self.fail(what)

    def tickets(self, tag):
        """The priorities of the tickets that name the key of this tag, by ticket directory."""
        found = {}
        for directory in (self.state / "waiters", self.state / "waiters" / "cc", self.state / "admission" / "waiting"):
            if not directory.is_dir():
                continue
            for path in directory.iterdir():
                if not path.is_file():
                    continue
                try:
                    fields = dict(line.split("=", 1) for line in path.read_text().splitlines() if "=" in line)
                except OSError:
                    continue
                if fields.get("key") == self.key(tag):
                    found.setdefault(directory.name, []).append(int(fields.get("priority", "-1")))
        return found

    def key(self, tag):
        for keydir in (self.state / "keys").glob("*"):
            for attempt in keydir.glob("runs/*/meta"):
                if ("tag=" + tag) in (attempt.parent / "identity-config").read_text():
                    return keydir.name
        return None

    def priorities(self, tag):
        found = self.tickets(tag)
        return sorted(p for values in found.values() for p in values), sorted(found)

    def starts(self):
        return [line.split()[1] for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def both_tickets_at(self, tag, priority):
        found = self.tickets(tag)
        return (set(found) == {"waiting", "waiters"} and all(len(v) == 1 for v in found.values())
                and all(v == [priority] for v in found.values()))

    def test_a_priority_100_joiner_raises_the_waiting_execution_and_is_told(self):
        self.hold()
        low = self.request("low", "joined", 0)
        self.until("the supervisor published its tickets at priority 0", lambda: self.both_tickets_at("joined", 0))
        high = self.request("high", "joined", 100)
        self.until("the joiner reported its effective priority",
                   lambda: "priority=100 effective=100" in self.stderr_of("high"))
        self.assertIn("priority=0 effective=0", self.stderr_of("low"))
        self.until("both tickets of the supervisor carry priority 100", lambda: self.both_tickets_at("joined", 100))
        keydir = self.state / "keys" / self.key("joined")
        self.assertEqual(len(list(keydir.glob("runs/*/meta"))), 1, "the join started a second execution")
        self.assertEqual(sorted(p.name for p in (keydir / "owners").iterdir()), ["high", "low"])
        self.assertEqual(self.starts(), [])
        self.release()
        for child in (low, high):
            self.assertEqual(child.wait(timeout=120), 0, self.stderr_of("low") + self.stderr_of("high"))
        self.assertEqual(self.starts(), ["joined"], "the key ran more than once")

    def test_the_cancellation_of_the_higher_priority_owner_lowers_the_tickets(self):
        self.hold()
        low = self.request("low", "canceled", 0)
        self.until("tickets at priority 0", lambda: self.both_tickets_at("canceled", 0))
        high = self.request("high", "canceled", 100)
        self.until("tickets at priority 100", lambda: self.both_tickets_at("canceled", 100))
        done = subprocess.run([self.candidate, "--", "cancel", "--state-root", str(self.state),
                               "--key", self.key("canceled"), "--token", "high"],
                              env=self.environment(), capture_output=True, text=True)
        self.assertIn("canceled=", done.stdout, done.stdout + done.stderr)
        self.until("the tickets returned to priority 0", lambda: self.both_tickets_at("canceled", 0))
        self.release()
        self.assertEqual(low.wait(timeout=120), 0, self.stderr_of("low"))
        high.wait(timeout=120)
        self.assertEqual(self.starts(), ["canceled"])

    def test_the_loss_of_the_higher_priority_owner_lowers_the_tickets(self):
        self.hold()
        low = self.request("low", "lost", 0)
        self.until("tickets at priority 0", lambda: self.both_tickets_at("lost", 0))
        high = self.request("high", "lost", 100)
        self.until("tickets at priority 100", lambda: self.both_tickets_at("lost", 100))
        high.send_signal(signal.SIGKILL)
        high.wait(timeout=60)
        self.until("the tickets returned to priority 0", lambda: self.both_tickets_at("lost", 0))
        self.release()
        self.assertEqual(low.wait(timeout=120), 0, self.stderr_of("low"))
        self.assertEqual(self.starts(), ["lost"])

    def test_independent_requests_run_in_priority_order(self):
        self.hold()
        first = self.request("first", "zero", 0)
        self.until("the first ticket exists", lambda: self.both_tickets_at("zero", 0))
        second = self.request("second", "fifty", 50)
        self.until("the second ticket exists", lambda: self.both_tickets_at("fifty", 50))
        self.release()
        for child in (first, second):
            self.assertEqual(child.wait(timeout=120), 0)
        self.assertEqual(self.starts(), ["fifty", "zero"])

    def test_a_joined_priority_orders_the_execution_before_an_independent_request(self):
        self.hold()
        first = self.request("first", "zero", 0)
        self.until("the first ticket exists", lambda: self.both_tickets_at("zero", 0))
        second = self.request("second", "fifty", 50)
        self.until("the second ticket exists", lambda: self.both_tickets_at("fifty", 50))
        joiner = self.request("joiner", "zero", 100)
        self.until("the joined execution carries priority 100", lambda: self.both_tickets_at("zero", 100))
        self.assertTrue(self.both_tickets_at("fifty", 50))
        self.release()
        for child in (first, second, joiner):
            self.assertEqual(child.wait(timeout=120), 0)
        self.assertEqual(self.starts(), ["zero", "fifty"])

    def test_the_largest_priority_is_a_priority(self):
        largest = 4294967295
        self.hold()
        low = self.request("low", "largest", 0)
        self.until("tickets at priority 0", lambda: self.both_tickets_at("largest", 0))
        high = self.request("high", "largest", largest)
        self.until("the joiner reported the largest effective priority",
                   lambda: "priority=%d effective=%d" % (largest, largest) in self.stderr_of("high"))
        self.until("both tickets carry the largest priority", lambda: self.both_tickets_at("largest", largest))
        done = subprocess.run([self.candidate, "--", "cancel", "--state-root", str(self.state),
                               "--key", self.key("largest"), "--token", "high"],
                              env=self.environment(), capture_output=True, text=True)
        self.assertIn("canceled=", done.stdout, done.stdout + done.stderr)
        self.until("the tickets returned to priority 0", lambda: self.both_tickets_at("largest", 0))
        self.release()
        self.assertEqual(low.wait(timeout=120), 0, self.stderr_of("low"))
        high.wait(timeout=120)
        self.assertEqual(self.starts(), ["largest"])

    def test_priorities_next_to_the_largest_order_the_executions(self):
        near = 4294967294
        self.hold()
        first = self.request("first", "zero", 0)
        self.until("the first ticket exists", lambda: self.both_tickets_at("zero", 0))
        second = self.request("second", "near", near)
        self.until("the second ticket exists", lambda: self.both_tickets_at("near", near))
        joiner = self.request("joiner", "zero", near + 1)
        self.until("the joined execution carries the largest priority", lambda: self.both_tickets_at("zero", near + 1))
        self.assertTrue(self.both_tickets_at("near", near))
        self.release()
        for child in (first, second, joiner):
            self.assertEqual(child.wait(timeout=120), 0)
        self.assertEqual(self.starts(), ["zero", "near"])


if __name__ == "__main__":
    unittest.main()
