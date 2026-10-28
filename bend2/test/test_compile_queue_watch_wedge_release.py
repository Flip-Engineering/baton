"""A wedged supervisor must not hold the heavy lane after its command has
been collected.

Set BATON2_COMPILE_QUEUE_BIN to the native queue under test. The first
cgen request runs a sleeping fake compiler; its supervisor is stopped
before the command exits, so the supervisor can never publish. The test
then writes the attempt exit_status marker exactly as the native wait
owner does - attempt identity plus normalized exit status - and the
attempt watcher must release the heavy lane on that validated evidence.
A second cgen request must then acquire the heavy lane and complete
while the first supervisor remains stopped. The test continues the
stopped supervisor during cleanup.
"""
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import unittest


class QueueWatchWedgeReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-watch-wedge-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.work = self.root / "work"
        self.work.mkdir()
        self.entry = self.work / "entry.bend"
        self.entry.write_text("entry placeholder for the wedge fixture\n")

    def submit(self, token, compiler_body, artifact_body):
        compiler = self.work / ("compiler-" + token)
        compiler.write_text(compiler_body)
        compiler.chmod(0o755)
        artifact = self.work / ("gen-" + token + ".c")
        receipt = self.work / ("receipt-" + token)
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(receipt), "--kind", "cgen",
                "--priority", "0",
                "--state-root", str(self.state), "--cwd", str(self.work),
                "--root", str(self.work), "--source-root", str(self.work),
                "--entry", str(self.entry),
                "--compiler", "/usr/bin/clang-19", "--linker", "/usr/bin/ld",
                "--version", "watch-wedge-" + token,
                "--artifact", "gen.c=" + str(artifact),
                "--", "/bin/sh", str(compiler), str(artifact)]
        return subprocess.Popen(argv, stdout=subprocess.DEVNULL,
                                stderr=subprocess.DEVNULL), receipt, artifact

    def newest_attempt(self):
        keys = sorted((self.state / "keys").iterdir(),
                      key=lambda p: p.stat().st_mtime)
        self.assertTrue(keys, "no key directory created")
        runs = sorted((keys[-1] / "runs").iterdir(),
                      key=lambda p: p.stat().st_mtime)
        self.assertTrue(runs, "no attempt directory created")
        return runs[-1]

    def test_wedged_supervisor_releases_heavy_lane(self):
        sleeper = ("sleep 6\n"
                   "printf 'int wedge(void){return 0;}\\n' > \"$1\"\n")
        first, _, first_artifact = self.submit("wedge", sleeper)
        self.addCleanup(first.wait, timeout=120)

        deadline = time.time() + 20
        supervisor = None
        attempt = None
        while time.time() < deadline and supervisor is None:
            try:
                attempt = self.newest_attempt()
                active = attempt / "active"
                if active.exists():
                    for line in active.read_text().splitlines():
                        if line.startswith("pid="):
                            supervisor = int(line.split("=")[1])
            except (AssertionError, OSError):
                pass
            time.sleep(0.2)
        self.assertIsNotNone(supervisor, "supervisor never recorded an active marker")

        # Simulate the wedge: the supervisor stays alive but can never publish.
        os.kill(supervisor, signal.SIGSTOP)
        self.addCleanup(os.kill, supervisor, signal.SIGCONT)

        # Capture the command child while it runs, then wait for it to exit.
        def children_of(pid):
            found = []
            for entry in pathlib.Path("/proc").glob("[0-9]*"):
                try:
                    fields = (entry / "stat").read_text(errors="ignore").split()
                    if int(fields[3]) == pid:
                        found.append(int(fields[0]))
                except (OSError, ValueError, IndexError):
                    pass
            return found

        deadline = time.time() + 5
        child = None
        while time.time() < deadline and child is None:
            live = children_of(supervisor)
            if live:
                child = live[0]
            time.sleep(0.2)
        self.assertIsNotNone(child, "command child never started")
        deadline = time.time() + 20
        while time.time() < deadline and children_of(supervisor):
            time.sleep(0.2)

        # The stopped supervisor cannot collect the exited child, so the test
        # writes the exit_status marker exactly as the native wait owner does:
        # attempt identity (the collected child pid) plus normalized status.
        marker = attempt / "exit_status"
        marker.write_text(f"child={child}\nexit=0\nsignal=0\n")

        # The watcher must validate the marker and release the heavy lane;
        # a second cgen request then acquires and completes while the first
        # supervisor remains stopped.
        time.sleep(2)
        fast = ("printf 'int fast(void){return 0;}\\n' > \"$1\"\n")
        second, second_receipt, _ = self.submit("second", fast)
        second.wait(timeout=90)
        record = second_receipt.read_text()
        self.assertIn("status=completed", record)

        # The release is heavy-lane custody only: the stopped supervisor is
        # never signalled and stays stopped until the cleanup continues it.
        stat = pathlib.Path(f"/proc/{supervisor}/stat")
        self.assertTrue(stat.exists(), "stopped supervisor disappeared")
        self.assertEqual(stat.read_text().split()[2], "T")


if __name__ == "__main__":
    unittest.main()
