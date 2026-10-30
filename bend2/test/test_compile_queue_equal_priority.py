"""Equal-priority compile queue requests start in ticket order among the eligible (#1407).

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Each test uses a private state
root, a fake compiler that records when it starts, and a state/meminfo override so that
memory-aware admission is on and memory is plentiful. Requests of different options are
different history groups; none of them has a recorded peak unless a test measures it first.

* The oldest of several equal-priority waiters starts first when the running claim ends,
  although a newer waiter polls more often than an older one that has backed off.
* An older waiter that is not eligible does not block a newer waiter that is.
* A request of higher priority still starts before older waiters of lower priority.
* A dead older ticket and a live ticket without a token field do not block a request.
"""
import fcntl
import os
import pathlib
import subprocess
import sys
import tempfile
import time
import unittest

COMPILER = '''#!{python}
import pathlib, sys, time

import os

args = sys.argv[1:]
source = pathlib.Path(os.environ["QUEUE_TEST_SETTINGS"]).read_text()
output = args[args.index("-o") + 1]
settings = dict(line.split("=", 1) for line in source.splitlines() if "=" in line)
memory = bytes(b"x") * (int(settings.get("mb", "64")) * 1024 * 1024)
with open(settings["log"], "a") as log:
    log.write("allocated %s %d\\n" % (settings["name"], len(memory)))
hold = pathlib.Path(settings["hold"])
deadline = time.monotonic() + 120
while not hold.exists() and time.monotonic() < deadline:
    time.sleep(0.05)
pathlib.Path(output).write_text("complete " + settings["name"] + "\\n")
with open(settings["log"], "a") as log:
    log.write("end %s\\n" % settings["name"])
'''


def fields(path):
    # A record can be replaced or removed between listing and reading it.
    try:
        text = pathlib.Path(path).read_text()
    except FileNotFoundError:
        return {}
    return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)


class EqualPriorityTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-equal-priority-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.state.joinpath("meminfo").write_text("total_kb=230946084\navailable_kb=155203664\n")
        self.log = self.root / "log"
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(COMPILER.format(python=sys.executable))
        self.compiler.chmod(0o755)
        self.holds = {}
        self.children = []
        self.addCleanup(self.release_all)

    def release_all(self):
        for hold in self.holds.values():
            hold.touch()
        for child in self.children:
            try:
                child.wait(timeout=60)
            except subprocess.TimeoutExpired:
                child.kill()

    def until(self, what, test, seconds=60):
        # This deadline detects a broken fixture; it does not bound a compiler.
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return
            time.sleep(0.05)
        self.fail(what)

    def started(self):
        lines = self.log.read_text().splitlines() if self.log.exists() else []
        return [line.split()[1] for line in lines if line.startswith("allocated ")]

    def request(self, name, group=None, priority=0, mb=64):
        """Start a request; requests of one group share a history group. Returns the process.

        Each request has its own C input, so concurrent requests have different keys, and its
        settings reach the fake compiler through the environment, so every command line of a
        group is the same."""
        hold = self.root / ("hold-" + name)
        self.holds[name] = hold
        source = self.root / ("main-" + name + ".c")
        source.write_text("int %s;\n" % name)
        settings = self.root / ("settings-" + name)
        settings.write_text("mb=%d\nname=%s\nlog=%s\nhold=%s\n" % (mb, name, self.log, hold))
        output = self.root / ("output-" + name)
        argv = [self.candidate, "--", "run", "--token", name, "--kind", "cc",
                "--priority", str(priority), "--state-root", str(self.state), "--cwd", str(self.root),
                "--root", str(self.root), "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-equal-priority-v1",
                "--artifact", "output=" + str(output), "--input", str(source),
                "--option", "group=" + (group or name),
                "--", str(self.compiler), "-o", str(output)]
        child = subprocess.Popen(argv, env=dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state),
                                                QUEUE_TEST_SETTINGS=str(settings)),
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def waiting(self):
        """The requests (owner tokens) whose supervisors hold an admission ticket."""
        names = set()
        waiting = self.state / "admission" / "waiting"
        for ticket in (waiting.iterdir() if waiting.is_dir() else []):
            key = fields(ticket).get("key")
            owners = self.state / "keys" / key / "owners" if key else None
            if owners is not None and owners.is_dir():
                names.update(p.name for p in owners.iterdir())
        return names

    def claim(self, name):
        running = self.state / "admission" / "running"
        claims = [fields(p) for p in running.iterdir()] if running.is_dir() else []
        mine = [c for c in claims if c.get("key") and
                (self.state / "keys" / c["key"] / "owners" / name).exists()]
        return mine[0] if mine else None

    def finish(self, *names):
        for name in names:
            self.holds[name].touch()
        for child in self.children:
            out, err = child.communicate(timeout=60)
            self.assertEqual(child.returncode, 0, out + err)

    def drain_in_start_order(self, names):
        """Release each request as it starts; returns the start order."""
        order = []
        while len(order) < len(names):
            count = len(order)
            self.until("the next of %s started" % names,
                       lambda: len([name for name in self.started() if name in names]) > count)
            order = [name for name in self.started() if name in names]
            # The sampler needs a moment to observe the peak before the claim may end.
            time.sleep(1.5)
            self.holds[order[-1]].touch()
        return order

    def wait_for_sampler(self, name):
        # The retained watcher publishes its observation before releasing the heavy descriptor.
        def observation_published():
            with (self.state / "heavy.lock").open("rb") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    return False
                fcntl.flock(lock, fcntl.LOCK_UN)
                return True
        self.until("%s sampler released its descriptor" % name, observation_published)

    def test_the_oldest_equal_priority_waiter_starts_first(self):
        for round_number in range(3):
            with self.subTest(round=round_number):
                self.log.unlink(missing_ok=True)
                first = len(self.children)
                names = ["%s%d" % (letter, round_number) for letter in "abcd"]
                blocker = "blocker%d" % round_number
                self.request(blocker)
                self.until("blocker started", lambda: blocker in self.started())
                self.request(names[0])
                self.until("oldest waiting", lambda: names[0] in self.waiting())
                # The oldest waiter backs off to polling once a second.
                time.sleep(4)
                for name in names[1:]:
                    self.request(name)
                self.until("all waiting", lambda: all(name in self.waiting() for name in names))
                time.sleep(1.5)
                self.holds[blocker].touch()
                order = self.drain_in_start_order(names)
                for child in self.children[first:]:
                    out, err = child.communicate(timeout=60)
                    self.assertEqual(child.returncode, 0, out + err)
                self.wait_for_sampler(blocker)
                self.assertEqual(order, names)

    def test_an_older_waiter_that_is_not_eligible_does_not_block_an_eligible_one(self):
        # Measure group m. An unmeasured request then runs; an unmeasured older waiter cannot
        # start beside it, but a newer edited request of the measured group can.
        self.request("measure", group="m")
        self.until("measure started", lambda: "measure" in self.started())
        time.sleep(1.5)
        self.holds["measure"].touch()
        self.until("the measurement is recorded",
                   lambda: (self.state / "history").is_dir() and any((self.state / "history").iterdir()))
        self.wait_for_sampler("measure")
        self.request("running", group="r")
        self.until("running has a claim", lambda: self.claim("running") is not None)
        time.sleep(2)
        self.request("older", group="o")
        self.until("older waiting", lambda: "older" in self.waiting())
        time.sleep(1)
        self.request("newer", group="m")
        self.until("the newer measured request started beside the running claim",
                   lambda: "newer" in self.started())
        self.assertNotIn("older", self.started())
        self.finish(*self.holds)

    def test_a_higher_priority_request_still_starts_before_older_waiters(self):
        self.request("blocker")
        self.until("blocker started", lambda: "blocker" in self.started())
        self.request("older")
        self.until("older waiting", lambda: "older" in self.waiting())
        time.sleep(1)
        self.request("urgent", priority=9)
        self.until("both waiting", lambda: {"older", "urgent"} <= set(self.waiting()))
        self.holds["blocker"].touch()
        self.assertEqual(self.drain_in_start_order(["older", "urgent"]), ["urgent", "older"])
        self.finish(*self.holds)

    def ticket(self, name, pid, starttime, token):
        directory = self.state / "waiters" / "cc"
        directory.mkdir(mode=0o2770, parents=True, exist_ok=True)
        directory.chmod(0o2770)
        text = "priority=0\npid=%d\nstarttime=%s\nkey=%s\nhistory_group=%s\nkind=cc\ngroup=%s\n" % (
            pid, starttime, name, name, name)
        if token is not None:
            text += "token=%s\n" % token
        path = directory / name
        path.write_text(text)
        return path

    def test_a_dead_older_ticket_does_not_block(self):
        stale = self.ticket("0000000000000000001-dead", 999999, "1", "0000000000000000001-999999")
        self.request("alive")
        self.until("alive started", lambda: "alive" in self.started())
        self.assertFalse(stale.exists(), "the scan reaps a ticket whose process is gone")
        self.finish(*self.holds)

    def test_a_live_ticket_without_a_token_does_not_block(self):
        with open("/proc/self/stat") as stat:
            starttime = stat.read().rsplit(")", 1)[1].split()[19]
        self.ticket("tokenless", os.getpid(), starttime, None)
        self.request("alive")
        self.until("alive started beside a live ticket without a token", lambda: "alive" in self.started())
        self.finish(*self.holds)


if __name__ == "__main__":
    unittest.main()
