"""C compilation and C generation queue on separate lanes.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Each test uses a
temporary state root, so the installed queue state is untouched.

- A cc request completes while an external holder owns state/heavy.lock, and the
  queue records state/cc.lock. C compilation of already-generated source does
  not wait for C generation (issue #1176).
- A waiting cc request publishes its ticket under state/waiters/cc and removes
  it when it acquires state/cc.lock, so publication, priority selection,
  acquisition and cleanup read one directory.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest

BODY = b"cc-lane-artifact\n"


class QueueCcLaneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-cc-lane-")
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
            "if [ -n \"$out\" ]; then printf 'cc-lane-artifact\\n' > \"$out\"; fi\n"
            "exit 0\n")
        self.compiler.chmod(0o755)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def hold(self, name):
        lock = (self.state / name).open("w")
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX)
        return lock

    def request(self):
        token = "cc-lane-" + os.urandom(8).hex()
        return [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"),
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-cc-lane-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.main),
                "--", str(self.compiler), "-o", str(self.output)]

    def wait_for(self, predicate, message, deadline=60.0):
        end = time.monotonic() + deadline
        while time.monotonic() < end:
            found = predicate()
            if found:
                return found
            time.sleep(0.02)
        self.fail(message)

    def receipt(self):
        rows = (self.root / "receipt").read_text().splitlines()
        return dict(row.split("=", 1) for row in rows if "=" in row)

    def test_cc_completes_while_the_heavy_lane_is_held(self):
        heavy = self.hold("heavy.lock")
        result = subprocess.run(self.request(), env=self.environment,
                                capture_output=True, text=True, timeout=120)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = self.receipt()
        self.assertEqual(receipt["status"], "completed", receipt)
        self.assertTrue((self.state / "cc.lock").exists(),
                        "the cc lane records its own state/cc.lock")
        artifact = (self.state / "keys" / receipt["key"] /
                    "completed" / "artifacts" / "output")
        self.assertEqual(artifact.read_bytes(), BODY,
                         "the queue retains the published artifact")
        self.assertEqual(self.output.read_bytes(), BODY,
                         "the queue installs the artifact at its declared path")
        self.assertFalse(heavy.closed, "the heavy-lane holder stayed held")

    def test_cc_ticket_waits_and_clears_in_the_cc_directory(self):
        lane = self.hold("cc.lock")
        process = subprocess.Popen(self.request(), env=self.environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                   text=True)
        try:
            def ticket():
                directory = self.state / "waiters" / "cc"
                return sorted(directory.iterdir()) if directory.is_dir() else []
            published = self.wait_for(ticket,
                                      "the cc request did not publish a cc-lane ticket")
            self.assertEqual(len(published), 1, published)
            heavy_entries = sorted(entry.name for entry in (self.state / "waiters").iterdir())
            self.assertEqual(heavy_entries, ["cc"],
                             "the cc ticket must not appear in the heavy directory")
            lane.close()
            stdout, stderr = process.communicate(timeout=120)
            self.assertEqual(process.returncode, 0, stdout + stderr)
            self.assertEqual(sorted((self.state / "waiters" / "cc").iterdir()), [],
                             "acquiring the cc lane removes its ticket")
            receipt = self.receipt()
            self.assertEqual(receipt["status"], "completed", receipt)
            self.assertTrue((self.state / "keys" / receipt["key"] /
                             "completed" / "artifacts" / "output").is_file())
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
            lane.close()


if __name__ == "__main__":
    unittest.main()
