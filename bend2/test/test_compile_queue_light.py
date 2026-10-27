"""Compile queue light-lane admission and peak recording.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Each case uses a
private state root under the caller's temporary directory and a fake compiler
shell script, so no real compiler runs.

The $state/meminfo file is the documented pressure test seam. A light case
holds the shared heavy lock, which proves the request did not wait for that
lock. A fresh state root with no peaks and no meminfo hook keeps the heavy
path, matching the marker regression fixture.
"""
import fcntl
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


FAKE_COMPILER = """#!/bin/sh
out=
previous=
for argument in "$@"; do
  if [ "$previous" = -o ]; then out=$argument; fi
  previous=$argument
done
if [ -n "${LIGHT_TEST_STARTED:-}" ]; then : > "$LIGHT_TEST_STARTED"; fi
sleep "${LIGHT_TEST_SLEEP:-0.4}"
if [ -n "$out" ]; then printf 'int main(void){return 0;}\\n' > "$out"; fi
exit 0
"""


class QueueLightLaneTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-light-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.source = self.root / "source"
        self.source.mkdir()
        (self.source / "main.bend").write_text(
            "import Base\n\ndef main() -> IO(Unit):\n  IO.pure(Unit, Unit{})\n")
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(FAKE_COMPILER)
        self.compiler.chmod(0o755)
        self.environment = dict(os.environ,
                                BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def request_args(self, tag, output):
        return [
            "--kind", "cgen",
            "--state-root", str(self.state),
            "--cwd", str(self.root),
            "--root", str(self.root),
            "--source-root", str(self.source),
            "--entry", "main.bend",
            "--compiler", str(self.compiler),
            "--artifact", "output.c=" + str(output),
            "--option", "test=" + tag,
            "--token", "token-" + tag,
            "--", str(self.compiler), "-o", str(output),
        ]

    def key(self, tag="light"):
        output = self.root / ("out-" + tag + ".c")
        argv = [self.candidate, "--", "key"] + self.request_args(tag, output)
        result = subprocess.run(argv, env=self.environment,
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        key = result.stdout.strip()
        self.assertEqual(len(key), 64, key)
        return key

    def request(self, tag, started=None, sleep="0.4"):
        output = self.root / ("out-" + tag + ".c")
        argv = [self.candidate, "--", "run"] + self.request_args(tag, output)
        environment = dict(self.environment, LIGHT_TEST_SLEEP=sleep,
                           LIGHT_TEST_STARTED=str(started) if started else "")
        return subprocess.Popen(argv, env=environment, text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)

    def set_memory(self, available_kb, total_kb=1000000000):
        temporary = self.state / "meminfo.tmp"
        temporary.write_text(
            "MemTotal:       %d kB\nMemAvailable:   %d kB\n"
            % (total_kb, available_kb))
        temporary.replace(self.state / "meminfo")

    def write_peak(self, key, peak_kb=1024, measured_ns=1):
        peaks = self.state / "peaks"
        peaks.mkdir(mode=0o2770, exist_ok=True)
        peaks.chmod(0o2770)
        (peaks / key).write_text(
            "peak_kb=%d\nmeasured_ns=%d\n" % (peak_kb, measured_ns))

    def enable_lane_for_estimates(self, target_key):
        # The prior request shares the kind, entry, compiler and command with
        # the target and differs only in the scheduling option, so its key is
        # different while any entry/group history still matches. The target
        # key itself remains unpeaked.
        prior = self.key("prior-estimate")
        self.assertNotEqual(prior, target_key)
        self.write_peak(prior, peak_kb=1024, measured_ns=1)

    def hold_heavy(self):
        lock = (self.state / "heavy.lock").open("w")
        fcntl.flock(lock, fcntl.LOCK_EX)
        return lock

    @staticmethod
    def release(lock):
        fcntl.flock(lock, fcntl.LOCK_UN)
        lock.close()

    def wait_for(self, predicate, description, timeout=20.0):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if predicate():
                return
            time.sleep(0.02)
        self.fail(description)

    def light_records(self):
        directory = self.state / "light"
        if not directory.is_dir():
            return []
        return [path for path in directory.iterdir()
                if path.is_file() and ".tmp." not in path.name]

    def light_fields(self):
        records = self.light_records()
        if not records:
            return {}
        return dict(line.split("=", 1)
                    for line in records[0].read_text().splitlines() if "=" in line)

    def active_fields(self, key):
        path = self.state / "keys" / key / "active"
        try:
            text = path.read_text()
        except OSError:
            return {}
        return dict(line.split("=", 1) for line in text.splitlines() if "=" in line)

    def finish(self, process, timeout=60):
        stdout, stderr = process.communicate(timeout=timeout)
        self.assertEqual(process.returncode, 0, stdout + stderr)
        return stdout + stderr

    def stop(self, process):
        if process.poll() is None:
            process.kill()
            process.communicate()

    def test_recorded_peak_runs_while_the_heavy_lock_is_held(self):
        key = self.key()
        self.write_peak(key, peak_kb=2048, measured_ns=1)
        self.set_memory(1000000000)
        started = self.root / "started-recorded"
        lock = self.hold_heavy()
        released = False
        process = self.request("recorded", started=started, sleep="1.2")
        try:
            self.wait_for(started.exists,
                          "light command did not start with a recorded peak")
            self.wait_for(lambda: self.active_fields(key).get("class") == "light",
                          "light request did not record class=light")
            self.wait_for(lambda: bool(self.light_records()),
                          "light request did not publish its light record")
            fields = self.light_fields()
            self.assertEqual(fields.get("key"), key)
            self.assertIn("need_kb", fields)
            self.wait_for(lambda: not any((self.state / "waiters").glob("*")),
                          "light request left a waiter ticket")
            self.finish(process)
        finally:
            self.stop(process)
            if not released:
                self.release(lock)
                released = True
        self.assertTrue((self.root / "out-recorded.c").exists())
        self.assertEqual(self.light_records(), [])

    def test_first_seen_key_uses_the_small_closure_estimate(self):
        key = self.key()
        self.assertFalse((self.state / "peaks" / key).exists())
        self.enable_lane_for_estimates(key)
        self.set_memory(1000000000)
        started = self.root / "started-estimate"
        lock = self.hold_heavy()
        process = self.request("estimate", started=started, sleep="1.2")
        try:
            self.wait_for(started.exists, "estimated light command did not start")
            self.wait_for(lambda: self.active_fields(key).get("class") == "light",
                          "estimated request did not record class=light")
            self.finish(process)
        finally:
            self.stop(process)
            self.release(lock)
        self.assertTrue((self.root / "out-estimate.c").exists())

    def test_insufficient_memory_waits_then_proceeds(self):
        key = self.key()
        self.write_peak(key, peak_kb=1024, measured_ns=1)
        self.set_memory(1)
        started = self.root / "started-wait"
        process = self.request("wait", started=started, sleep="0.5")
        try:
            self.wait_for(lambda: bool(self.light_records()),
                          "waiting request did not publish a light record")
            time.sleep(0.4)
            self.assertFalse(started.exists(),
                             "compiler started while MemAvailable was insufficient")
            self.assertIsNone(process.poll(),
                              "queue request exited instead of waiting for capacity")
            self.set_memory(1000000000)
            self.finish(process)
        finally:
            self.stop(process)
        self.assertTrue(started.exists())
        self.assertTrue((self.root / "out-wait.c").exists())

    def test_light_run_records_the_peak(self):
        key = self.key()
        self.write_peak(key, peak_kb=1, measured_ns=1)
        self.set_memory(1000000000)
        lock = self.hold_heavy()
        process = self.request("peak", sleep="1.2")
        try:
            self.finish(process)
        finally:
            self.stop(process)
            self.release(lock)
        peak = self.state / "peaks" / key

        def fields():
            try:
                return dict(line.split("=", 1)
                            for line in peak.read_text().splitlines() if "=" in line)
            except OSError:
                return {}

        self.wait_for(lambda: fields().get("measured_ns") not in (None, "1")
                      and int(fields().get("peak_kb", "0")) > 0,
                      "the light run did not record its peak")
        recorded = fields()
        self.assertGreater(int(recorded["peak_kb"]), 0)
        self.assertNotEqual(recorded["measured_ns"], "1")

    def test_fresh_state_keeps_the_heavy_path(self):
        key = self.key()
        started = self.root / "started-heavy"
        lock = self.hold_heavy()
        released = False
        process = self.request("heavy", started=started, sleep="0.4")
        try:
            time.sleep(0.8)
            self.assertFalse(started.exists(),
                             "a fresh state root bypassed the held heavy lock")
            self.assertIsNone(process.poll(),
                              "heavy request exited instead of waiting for the lock")
            self.assertEqual(self.light_records(), [],
                             "a fresh state root published a light record")
            self.release(lock)
            released = True
            self.finish(process)
        finally:
            self.stop(process)
            if not released:
                self.release(lock)
                released = True
        self.assertTrue(started.exists())
        self.assertTrue((self.root / "out-heavy.c").exists())


if __name__ == "__main__":
    unittest.main()
