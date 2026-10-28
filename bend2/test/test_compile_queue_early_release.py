"""The supervisor hands the acquired cc-lane lock to the compile watcher.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The fake
compiler writes the completion marker and then stays alive briefly. The
watcher must release the cc-lane lock when the marker appears, so an
observer can take the lock while the command is still running. This
fails when the descriptor the supervisor flocked never reaches the
watcher and the lock instead survives until the supervisor exits.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueueEarlyReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-release-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.main = self.root / "main.c"
        self.main.write_text("int main(void){return 0;}\n")
        self.output = self.root / "result"
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "out=\n"
            "previous=\n"
            "for argument in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then out=$argument; fi\n"
            "  previous=$argument\n"
            "done\n"
            "if [ -n \"$BATON_COMPILE_QUEUE_COMPILED\" ]; then : > \"$BATON_COMPILE_QUEUE_COMPILED\"; fi\n"
            "sleep 20\n"
            "if [ -n \"$out\" ]; then : > \"$out\"; fi\n"
            "exit 0\n")
        self.compiler.chmod(0o755)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def request(self):
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"), "--kind", "cc",
                "--state-root", str(self.state), "--cwd", str(self.root),
                "--root", str(self.root), "--source-root", str(self.root),
                "--compiler", str(self.compiler), "--linker", "/usr/bin/ld",
                "--version", "fake-release-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.main), "--", str(self.compiler), "-o", str(self.output)]
        return subprocess.Popen(argv, env=self.environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def marker(self):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            markers = list(self.state.glob("keys/*/runs/*/compiled"))
            if markers:
                return markers[0]
            time.sleep(0.02)
        self.fail("the compiler never wrote its completion marker")

    def test_marker_releases_the_cc_lane_lock(self):
        process = self.request()
        self.marker()
        lock = (self.state / "cc.lock").open("w")
        self.addCleanup(lock.close)
        acquired = False
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
                break
            except BlockingIOError:
                time.sleep(0.05)
        self.assertTrue(acquired,
                        "the watcher did not release the cc-lane lock at the completion marker")
        fcntl.flock(lock, fcntl.LOCK_UN)
        stdout, stderr = process.communicate(timeout=60)
        self.assertEqual(process.returncode, 0, stdout + stderr)


if __name__ == "__main__":
    unittest.main()
