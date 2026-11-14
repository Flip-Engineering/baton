"""A measured cc request runs beside a shared heavy-lock holder.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Every test runs on
a disposable state root. A first run of a cc group records the group's measured
peak. A later request of the same group with new C source content is measured:
admission compares its recorded need with the available memory, takes heavy.lock
shared and completes while an external process holds heavy.lock shared for the
whole request, the way a running Bend generation holds it. An exclusive holder
of heavy.lock fences every request; that behavior is covered by
compile-queue-heavy-interop.py.
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
        self.control = self.root / "control"
        self.control.mkdir()
        self.compiler = self.root / "fake-compiler"
        self.compiler.write_text(
            "#!/bin/sh\n"
            "control=$1\nlabel=$2\noutput=$3\n"
            "printf started > \"$control/$label.started\"\n"
            "while [ ! -e \"$control/release\" ]; do sleep 0.02; done\n"
            "printf 'artifact-%s\\n' \"$label\" > \"$output\"\n")
        self.compiler.chmod(0o755)
        self.output = self.root / "result"

    def argv(self, source, receipt):
        return [self.candidate, "--", "run", "--token", os.urandom(16).hex(),
                "--receipt", str(receipt),
                "--kind", "cc", "--state-root", str(self.state),
                "--source-root", str(self.root), "--compiler", str(self.compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-cc-v1",
                "--artifact", "output=" + str(self.output),
                "--input", str(source),
                "--", str(self.compiler), str(self.control), "job", str(self.output)]

    def recorded_samples(self):
        usage = self.state / "admission" / "usage"
        samples = {}
        if usage.is_dir():
            for path in usage.iterdir():
                for line in path.read_text(errors="replace").splitlines():
                    if line.startswith("kb="):
                        samples[path.name] = int(line[3:] or 0)
        return samples

    def sampled(self, before):
        return any(value > 0 for name, value in self.recorded_samples().items()
                   if name not in before)

    # Runs the command of one request and releases it after the command
    # itself has started. Returns once the request completed.
    def run_released(self, source, receipt):
        samples_before = self.recorded_samples()
        child = subprocess.Popen(self.argv(source, receipt), env=self.environment,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if (self.control / "job.started").exists():
                break
            if child.poll() is not None:
                break
            time.sleep(0.02)
        self.assertTrue((self.control / "job.started").exists(),
                        "the cc command did not run")
        # Hold the command until the queue writes this run's recorded sample
        # under admission/usage, so the run records a nonzero measured peak
        # at a point load cannot decide.
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if self.sampled(samples_before):
                break
            if child.poll() is not None:
                break
            time.sleep(0.02)
        self.assertTrue(self.sampled(samples_before),
                        "the queue recorded no nonzero sample of the cc run")
        (self.control / "release").touch()
        stdout, stderr = child.communicate(timeout=30)
        self.assertEqual(child.returncode, 0, stdout + stderr)
        (self.control / "release").unlink()
        (self.control / "job.started").unlink()

    # One complete run of the group: the queue records its measured peak.
    def measure_group(self):
        source = self.root / "measure.c"
        source.write_text("int measure(void) { return 0; }\n")
        self.run_released(source, self.root / "receipt-measure")

    def hold_shared(self):
        holder = subprocess.Popen(
            ["python3", "-c",
             "import fcntl, pathlib, sys, time\n"
             "f = open(pathlib.Path(sys.argv[1]) / 'heavy.lock', 'a+')\n"
             "fcntl.flock(f, fcntl.LOCK_SH)\n"
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

    def test_measured_cc_completes_beside_shared_heavy_holder(self):
        self.measure_group()
        holder = self.hold_shared()
        source = self.root / "main.c"
        source.write_text("int main(void){return 0;}\n")
        receipt = self.root / "receipt-measured"
        self.run_released(source, receipt)
        fields = dict(line.split("=", 1) for line in receipt.read_text().splitlines()
                      if "=" in line)
        self.assertEqual(fields["status"], "completed")
        self.assertTrue(any(self.state.glob("keys/*")))
        self.assertTrue(holder.poll() is None,
                        "the shared heavy-lock holder must still hold when cc finished")

    def test_measured_cc_artifact_matches(self):
        self.measure_group()
        holder = self.hold_shared()
        source = self.root / "main.c"
        source.write_text("int main(void){return 1;}\n")
        self.run_released(source, self.root / "receipt-measured")
        self.assertEqual(self.output.read_bytes(), b"artifact-job\n")
        self.assertTrue(holder.poll() is None)


if __name__ == "__main__":
    unittest.main()
