"""Compile queue status reads persisted result metadata.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The run
records a completed directory artifact holding many files. Status
must report the completed key from the persisted result record
after the artifact tree is gone, and must keep reporting an
unverified result as unusable. Reuse still content-qualifies the
artifacts; only state inspection stopped hashing completed trees.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest


class QueueStatusTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-status-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "previous=\n"
            "for arg in \"$@\"; do\n"
            "  if [ \"$previous\" = -o ]; then\n"
            "    i=0\n"
            "    while [ $i -lt 60 ]; do\n"
            "      mkdir -p \"$arg/tree$i\"\n"
            "      printf 'payload\\n' > \"$arg/tree$i/leaf.txt\"\n"
            "      i=$((i + 1))\n"
            "    done\n"
            "    exit 0\n"
            "  fi\n"
            "  previous=$arg\n"
            "done\n"
            "exit 4\n")
        self.compiler.chmod(0o755)
        (self.root / "main.c").write_text("int main(void){return 0;}\n")
        self.output = self.root / "result"

    def run_queue(self):
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"),
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-status-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.root / "main.c"),
                "--", str(self.compiler), "-o", str(self.output)]
        return subprocess.run(argv, env=self.environment, capture_output=True, text=True)

    def keydir(self):
        receipt = dict(line.split("=", 1) for line in
                       (self.root / "receipt").read_text().splitlines() if "=" in line)
        self.assertEqual(receipt["status"], "completed")
        return receipt["key"], self.state / "keys" / receipt["key"]

    def status(self):
        argv = [self.candidate, "--", "status", "--state-root", str(self.state)]
        return subprocess.run(argv, env=self.environment, capture_output=True, text=True)

    def test_status_reports_completed_from_the_result_record(self):
        result = self.run_queue()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        key, keydir = self.keydir()
        artifacts = keydir / "completed" / "artifacts"
        self.assertTrue(any(artifacts.rglob("leaf.txt")))
        shutil.rmtree(artifacts)
        status = self.status()
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        self.assertIn("completed key=" + key + "\n", status.stdout)

    def test_status_keeps_an_unverified_result_unusable(self):
        result = self.run_queue()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        key, keydir = self.keydir()
        record = keydir / "completed" / "result"
        record.write_text(record.read_text().replace("verified=1", "verified=0"))
        status = self.status()
        self.assertEqual(status.returncode, 0, status.stdout + status.stderr)
        self.assertNotIn("completed key=" + key + "\n", status.stdout)
        self.assertIn("completed-unusable key=" + key + "\n", status.stdout)


if __name__ == "__main__":
    unittest.main()
