"""C compilation proceeds while a Bend generation holds the heavy lock.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. The state
root's heavy lock is held by an external holder for the whole test, so
the policy under which every supervised job acquires the heavy lock
would keep the cc request blocked until the holder leaves. The
kind-aware policy gives cc jobs their own state/cc.lock and waiter
queue, so already-generated C compiles while Bend generation runs.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueueCcParallelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-cc-parallel-")
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
            "    printf 'compiled artifact\\n' > \"$arg\"\n"
            "    exit 0\n"
            "  fi\n"
            "  previous=$arg\n"
            "done\n"
            "exit 4\n")
        self.compiler.chmod(0o755)
        (self.root / "main.c").write_text("int main(void){return 0;}\n")
        self.output = self.root / "result"

    def hold_heavy(self):
        holder = subprocess.Popen(
            ["python3", "-c",
             "import fcntl, pathlib, sys, time\n"
             "f = open(pathlib.Path(pathlib.Path(sys.argv[1]) / 'heavy.lock'), 'a+')\n"
             "fcntl.flock(f, fcntl.LOCK_EX)\n"
             "print('held', flush=True)\n"
             "time.sleep(45)\n",
             str(self.state)],
            stdout=subprocess.PIPE, text=True)
        def stop_holder():
            if holder.poll() is None:
                holder.kill()
            holder.wait()

        self.addCleanup(stop_holder)
        self.addCleanup(holder.stdout.close)
        line = holder.stdout.readline()
        self.assertEqual(line.strip(), "held")
        return holder

    def run_cc(self, timeout):
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"),
                "--kind", "cc", "--state-root", str(self.state),
                "--cwd", str(self.root), "--root", str(self.root),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-cc-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(self.root / "main.c"),
                "--", str(self.compiler), "-o", str(self.output)]
        return subprocess.run(argv, env=self.environment, capture_output=True,
                              text=True, timeout=timeout)

    def test_cc_completes_while_heavy_lock_is_held(self):
        holder = self.hold_heavy()
        self.assertTrue(holder.poll() is None)
        result = self.run_cc(timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = dict(line.split("=", 1) for line in
                       (self.root / "receipt").read_text().splitlines() if "=" in line)
        self.assertEqual(receipt["status"], "completed")
        self.assertTrue((self.state / "cc.lock").exists(),
                        "the cc policy must use its own state/cc.lock")
        self.assertTrue((self.state / "keys" / receipt["key"]).is_dir())
        self.assertTrue(holder.poll() is None,
                        "the heavy-lock holder must still hold when cc finished")

    def test_completed_artifact_matches(self):
        holder = self.hold_heavy()
        result = self.run_cc(timeout=20)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(self.output.read_bytes(), b"compiled artifact\n")
        self.assertTrue(holder.poll() is None)


if __name__ == "__main__":
    unittest.main()
