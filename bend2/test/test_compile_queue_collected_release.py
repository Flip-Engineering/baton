"""A supervisor that stops after its command was collected does not hold the heavy lane.

Set BATON2_COMPILE_QUEUE_BIN to the native queue under test. The native wait owner
collects the command and writes the attempt's exit_status marker (pid, start time,
exit status) itself. The test stops the supervisor with SIGSTOP as soon as that
marker exists and before the supervisor publishes a result: the command writes a
large artifact, so the supervisor spends time on it after the collection. The
watcher of the attempt sees the marker and a dead command and releases the lane, so
a second cgen request, which needs the same lane, starts and completes while the
first supervisor stays stopped.

The second test is the control: while the command still runs, a stopped supervisor
does hold the lane, so the second request does not start.
"""
import os
import pathlib
import signal
import subprocess
import tempfile
import time
import unittest

ARTIFACT_BYTES = 256 * 1024 * 1024


class QueueCollectedReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-collected-release-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.work = self.root / "work"
        self.work.mkdir()
        self.entry = self.work / "entry.bend"
        self.entry.write_text("def main() -> Unit:\n  Unit{}\n")
        self.log = self.root / "log"
        self.stopped = []
        self.children = []
        self.addCleanup(self.finish)

    def finish(self):
        for pid in self.stopped:
            try:
                os.kill(pid, signal.SIGCONT)
            except ProcessLookupError:
                pass
        for child in self.children:
            try:
                child.wait(timeout=120)
            except subprocess.TimeoutExpired:
                child.kill()

    def submit(self, token, body):
        compiler = self.work / ("compiler-" + token)
        compiler.write_text("#!/bin/sh\nprintf 'start %s\\n' " + token + " >> " + str(self.log) + "\n" + body)
        compiler.chmod(0o755)
        artifact = self.work / ("gen-" + token + ".c")
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.work / ("receipt-" + token)), "--kind", "cgen", "--priority", "0",
                "--state-root", str(self.state), "--cwd", str(self.work), "--root", str(self.work),
                "--source-root", str(self.work), "--entry", str(self.entry),
                "--compiler", "/usr/bin/clang-19", "--linker", "/usr/bin/ld",
                "--option", "tag=" + token, "--artifact", "gen.c=" + str(artifact),
                "--", "/bin/sh", str(compiler), str(artifact)]
        env = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        child = subprocess.Popen(argv, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child, artifact

    def newest_keydir(self):
        keys = sorted((self.state / "keys").iterdir(), key=lambda p: p.stat().st_mtime)
        return keys[-1] if keys else None

    def supervisor_of(self, keydir):
        try:
            for line in (keydir / "active").read_text().splitlines():
                if line.startswith("pid="):
                    return int(line.split("=", 1)[1])
        except OSError:
            pass
        return None

    def until(self, what, test, seconds=60):
        # This deadline detects a broken fixture; it does not bound a compiler.
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if test():
                return
            time.sleep(0.02)
        self.fail(what)

    def started(self, token):
        return self.log.exists() and ("start " + token) in self.log.read_text().splitlines()

    def process_state(self, pid):
        return pathlib.Path("/proc/%d/stat" % pid).read_text().rsplit(")", 1)[1].split()[0]

    def test_a_supervisor_stopped_after_collection_does_not_hold_the_heavy_lane(self):
        big = "yes 0123456789abcdefghijklmnopqrstuvwxyz | head -c %d > \"$1\"\n" % ARTIFACT_BYTES
        for attempt in range(8):
            token = "first%d" % attempt
            first, artifact = self.submit(token, big)
            self.until("the command started", lambda: self.started(token))
            keydir = self.newest_keydir()
            marker = None
            supervisor = None
            end = time.monotonic() + 60
            while time.monotonic() < end:
                supervisor = supervisor or self.supervisor_of(keydir)
                markers = list(keydir.glob("runs/*/exit_status"))
                if markers and supervisor:
                    marker = markers[0]
                    os.kill(supervisor, signal.SIGSTOP)
                    self.stopped.append(supervisor)
                    break
                time.sleep(0.001)
            self.assertIsNotNone(marker, "the command was never collected")
            if not (marker.parent / "result").exists() and self.process_state(supervisor) == "T":
                break
            os.kill(supervisor, signal.SIGCONT)  # the supervisor had published already: try again
            first.wait(timeout=120)
        else:
            self.fail("the supervisor always published before it could be stopped")
        marker_text = marker.read_text()
        self.assertIn("pid=", marker_text)
        self.assertIn("starttime=", marker_text)
        self.assertIn("exit=0", marker_text)
        second, second_artifact = self.submit("second", "printf 'int second(void){return 0;}\\n' > \"$1\"\n")
        self.until("the second request started beside the stopped supervisor", lambda: self.started("second"))
        out, err = second.communicate(timeout=120)
        self.assertEqual(second.returncode, 0, out + err)
        self.assertEqual(second_artifact.read_text(), "int second(void){return 0;}\n")
        self.assertEqual(self.process_state(supervisor), "T", "the first supervisor was not stopped")
        self.assertFalse((marker.parent / "result").exists(), "the first supervisor published while stopped")
        os.kill(supervisor, signal.SIGCONT)
        out, err = first.communicate(timeout=120)
        self.assertEqual(first.returncode, 0, out + err)

    def test_a_stopped_supervisor_holds_the_lane_while_its_command_runs(self):
        first, _ = self.submit("running", "sleep 6\nprintf 'int running(void){return 0;}\\n' > \"$1\"\n")
        self.until("the command started", lambda: self.started("running"))
        keydir = self.newest_keydir()
        self.until("the supervisor recorded itself", lambda: self.supervisor_of(keydir) is not None)
        supervisor = self.supervisor_of(keydir)
        os.kill(supervisor, signal.SIGSTOP)
        self.stopped.append(supervisor)
        second, _ = self.submit("blocked", "printf 'int blocked(void){return 0;}\\n' > \"$1\"\n")
        time.sleep(3)
        self.assertFalse(self.started("blocked"), "the second request took the lane while the command ran")
        os.kill(supervisor, signal.SIGCONT)
        for child in (first, second):
            out, err = child.communicate(timeout=120)
            self.assertEqual(child.returncode, 0, out + err)


if __name__ == "__main__":
    unittest.main()
