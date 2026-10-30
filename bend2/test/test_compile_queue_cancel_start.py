"""A cancellation that races the start of a cc command keeps the canceled outcome (#1373).

BATON2_COMPILE_QUEUE_BIN names the queue executable under test. The cancel command
signals the process group of the supervisor when the last owner leaves. A signal that
reaches the supervisor while it starts the command also reaches the held child that
has not executed yet. The start then fails, and the supervisor used to record
`failed`, exit 1, "command could not start" although the requester canceled.

* The race test cancels each request as soon as its supervisor registered. The command
  sleeps, so the only valid outcome is canceled with exit 130 and the detail of a
  cancellation. Rounds run on separate disposable state roots, several at a time,
  because the window is narrow; each cancellation follows the registration of the
  supervisor by a random delay.
* A command that cannot be executed and is not canceled still records `failed`, exit 1
  and "command could not start".
"""
import concurrent.futures
import os
import pathlib
import random
import subprocess
import tempfile
import time
import unittest

WORKERS = 12
ROUNDS_PER_WORKER = 8
MAXIMUM_DELAY = 0.6


class CancelStartTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def environment(self, state):
        return dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))

    def argv(self, root, state, token, command):
        return [self.candidate, "--", "run", "--token", token,
                "--receipt", str(root / ("receipt-" + token)), "--kind", "cc",
                "--state-root", str(state), "--cwd", str(root), "--root", str(root),
                "--source-root", str(root), "--compiler", str(root / "compiler"),
                "--linker", "/usr/bin/ld", "--version", "fake-cancel-start-v1",
                "--artifact", "output=" + str(root / "result"),
                "--input", str(root / "main.c"), "--", *command]

    def prepare(self):
        temporary = tempfile.TemporaryDirectory(prefix="queue-cancel-start-")
        self.addCleanup(temporary.cleanup)
        root = pathlib.Path(temporary.name)
        state = root / "state"
        state.mkdir(mode=0o2770)
        state.chmod(0o2770)
        (root / "main.c").write_text("int main(void){return 0;}\n")
        compiler = root / "compiler"
        compiler.write_text("#!/bin/sh\nsleep 30\n")
        compiler.chmod(0o755)
        return root, state

    def result_record(self, state):
        results = sorted(state.glob("keys/*/runs/*/result"))
        return results[0].read_text() if len(results) == 1 else "results: %r" % (results,)

    def canceled_round(self, index):
        root, state = self.prepare()
        process = subprocess.Popen(
            self.argv(root, state, "cancel-token", [str(root / "compiler"), "-o", str(root / "result")]),
            env=self.environment(state), stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 60
        keydir = None
        while time.monotonic() < deadline:
            keys = list((state / "keys").glob("*")) if (state / "keys").is_dir() else []
            if keys and (keys[0] / "active").exists():
                keydir = keys[0]
                break
            time.sleep(0.002)
        if keydir is None:
            process.kill()
            return index, "the supervisor never registered"
        # The start of the command follows the registration of the supervisor by an
        # interval that varies with the load; the delay spreads the cancellations over it.
        time.sleep(random.uniform(0, MAXIMUM_DELAY))
        canceled = subprocess.run(
            [self.candidate, "--", "cancel", "--state-root", str(state), "--key", keydir.name, "--token", "cancel-token"],
            env=self.environment(state), capture_output=True, text=True)
        stdout, stderr = process.communicate(timeout=120)
        record = self.result_record(state)
        if "canceled=requested" not in canceled.stdout:
            return index, "cancel was not delivered: " + canceled.stdout + canceled.stderr
        if process.returncode == 0 or "status=canceled" not in record or "exit=130" not in record:
            return index, "outcome was not a cancellation (client exit %s):\n%s\n%s" % (process.returncode, record, stderr)
        return index, None

    def test_a_cancellation_during_the_start_of_the_command_is_recorded_as_canceled(self):
        rounds = WORKERS * ROUNDS_PER_WORKER
        with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
            outcomes = list(pool.map(self.canceled_round, range(rounds)))
        failures = [(index, why) for index, why in outcomes if why]
        self.assertEqual(failures, [], "%d of %d rounds lost the cancellation: %r" % (len(failures), rounds, failures[:2]))

    def test_a_command_that_cannot_start_and_was_not_canceled_keeps_its_own_failure(self):
        root, state = self.prepare()
        done = subprocess.run(self.argv(root, state, "spawn-failure", [str(root / "does-not-exist"), "-o", str(root / "result")]),
                              env=self.environment(state), capture_output=True, text=True, timeout=120)
        self.assertNotEqual(done.returncode, 0, done.stdout + done.stderr)
        record = self.result_record(state)
        self.assertIn("status=failed", record)
        self.assertIn("exit=1", record)
        self.assertIn("command could not start", record)
        self.assertNotIn("status=canceled", record)


if __name__ == "__main__":
    unittest.main()
