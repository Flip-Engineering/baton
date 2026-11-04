"""Compile queue missing-result custody carries the waited supervisor status.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The fake
compiler kills its supervisor before the supervisor can publish a
terminal result. The parent must retain the actual waited status in
the terminal error: a signaled supervisor records 128+signal and the
signal number, and the generic exit 1 must not replace it. No real
compiler runs; the fake compiler is a shell script.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


class QueueMissingResultTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-missing-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))
        (self.root / "main.c").write_text("int main(void){return 0;}\n")
        self.output = self.root / "result"

    def run_queue(self, signal_number):
        compiler = self.root / ("fake-compiler-" + str(signal_number))
        compiler.write_text(
            "#!/bin/sh\n"
            "kill -" + str(signal_number) + " $PPID\n"
            "exit 0\n")
        compiler.chmod(0o755)
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / ("receipt-" + str(signal_number))),
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-missing-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.root / "main.c"),
                "--", str(compiler), "-o", str(self.output)]
        return subprocess.run(argv, env=self.environment, capture_output=True, text=True)

    def retained_result(self):
        results = sorted(self.state.glob("keys/*/runs/*/result"))
        self.assertEqual(len(results), 1, results)
        return results[0].read_text()

    def test_signaled_supervisor_records_actual_wait_status(self):
        result = self.run_queue(9)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self.retained_result()
        self.assertIn("signal 9", record)
        self.assertIn("exit=137\n", record)
        self.assertIn("supervisor terminated by signal 9", record)
        self.assertNotIn("exit=1\n", record)

    def test_distinct_signal_records_its_own_status(self):
        result = self.run_queue(6)
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self.retained_result()
        self.assertIn("signal 6", record)
        self.assertIn("exit=134\n", record)
        self.assertIn("supervisor terminated by signal 6", record)

    def test_canceled_request_retains_130(self):
        import fcntl
        import time
        token = "cancel-token"
        lock = (self.state / "cc.lock").open("w")
        self.addCleanup(lock.close)
        fcntl.flock(lock, fcntl.LOCK_EX)
        compiler = self.root / "fake-holder"
        compiler.write_text("#!/bin/sh\nexit 0\n")
        compiler.chmod(0o755)
        argv = [self.candidate, "--", "run", "--token", token,
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-cancel-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.root / "main.c"),
                "--", str(compiler), "-o", str(self.output)]
        process = subprocess.Popen(argv, env=self.environment,
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 60
        keydir = None
        while time.monotonic() < deadline:
            keys = list((self.state / "keys").glob("*")) if (self.state / "keys").is_dir() else []
            if keys and (keys[0] / "active").exists():
                keydir = keys[0]
                break
            time.sleep(0.05)
        self.assertIsNotNone(keydir, "queue request did not start a supervisor")
        canceled = subprocess.run(
            [self.candidate, "--", "cancel", "--state-root", str(self.state),
             "--key", keydir.name, "--token", token],
            env=self.environment, capture_output=True, text=True)
        self.assertIn("canceled=requested", canceled.stdout)
        fcntl.flock(lock, fcntl.LOCK_UN)
        stdout, stderr = process.communicate(timeout=60)
        self.assertNotEqual(process.returncode, 0, stdout + stderr)
        record = self.retained_result()
        self.assertIn("status=canceled", record)
        self.assertIn("exit=130", record)
        # A cancellation that arrives before the supervisor publishes records "all
        # requesters canceled"; one that arrives while the command starts or runs
        # records "execution canceled". Both are the canceled outcome with exit 130.
        self.assertTrue("all requesters canceled" in record or "execution canceled" in record, record)


if __name__ == "__main__":
    unittest.main()
