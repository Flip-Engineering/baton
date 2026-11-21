"""Measured independent cc request keys overlap and publish their own artifacts.

Set BATON2_COMPILE_QUEUE_BIN to the candidate native queue. Every test runs on
a disposable state root. Each command family first completes one run alone, so
the queue records its measured peak under the family's history group. Two later
requests of those families with new C source content are admitted together:
each compares its recorded need with the available memory and takes heavy.lock
shared, so both commands run at the same time and publish their own artifacts.
"""
import os
import pathlib
import subprocess
import tempfile
import time
import unittest


class QueueCcOverlapTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def test_measured_cc_commands_overlap_and_publish(self):
        with tempfile.TemporaryDirectory(prefix="queue-cc-overlap-") as temporary:
            root = pathlib.Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o2770)
            state.chmod(0o2770)
            control = root / "control"
            control.mkdir()
            compiler = root / "fake-compiler"
            compiler.write_text(
                "#!/bin/sh\n"
                "control=$1\nlabel=$2\noutput=$3\n"
                "printf started > \"$control/$label.started\"\n"
                "while [ ! -e \"$control/release\" ]; do sleep 0.02; done\n"
                "printf 'artifact-%s\\n' \"$label\" > \"$output\"\n")
            compiler.chmod(0o755)
            environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))

            def argv(label, source, receipt):
                return [self.candidate, "--", "run", "--token", os.urandom(16).hex(),
                        "--receipt", str(receipt), "--kind", "cc",
                        "--state-root", str(state),
                        "--cwd", str(root), "--root", str(root),
                        "--source-root", str(root), "--compiler", str(compiler),
                        "--linker", "/usr/bin/ld", "--version", "fake-overlap-v1",
                        "--artifact", "output=" + str(root / (label + ".out")),
                        "--input", str(source),
                        "--", str(compiler), str(control), label,
                        str(root / (label + ".out"))]

            def recorded_samples():
                usage = state / "admission" / "usage"
                samples = {}
                if usage.is_dir():
                    for path in usage.iterdir():
                        for line in path.read_text(errors="replace").splitlines():
                            if line.startswith("kb="):
                                samples[path.name] = int(line[3:] or 0)
                return samples

            def sampled(before):
                return any(value > 0 for name, value in recorded_samples().items()
                           if name not in before)

            # Record one successful observation for each command family.
            for label in ("first", "second"):
                source = root / (label + "-measure.c")
                source.write_text("int %s_measure(void) { return 0; }\n" % label)
                samples_before = recorded_samples()
                child = subprocess.Popen(
                    argv(label, source, root / (label + "-measure.receipt")),
                    env=environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                    text=True)
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if (control / (label + ".started")).exists():
                        break
                    if child.poll() is not None:
                        break
                    time.sleep(0.02)
                self.assertTrue((control / (label + ".started")).exists(),
                                "measure run of %s did not start" % label)
                # Hold the command until the queue records a nonzero RSS sample.
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if sampled(samples_before):
                        break
                    if child.poll() is not None:
                        break
                    time.sleep(0.02)
                self.assertTrue(sampled(samples_before),
                                "the queue recorded no nonzero sample of the measure run of %s" % label)
                (control / "release").touch()
                stdout, stderr = child.communicate(timeout=30)
                self.assertEqual(child.returncode, 0, stdout + stderr)
                (control / "release").unlink()
                (control / (label + ".started")).unlink()
                (root / (label + ".out")).unlink()

            children = []
            try:
                for label in ("first", "second"):
                    source = root / (label + ".c")
                    source.write_text("int %s(void) { return 0; }\n" % label)
                    children.append(subprocess.Popen(
                        argv(label, source, root / (label + ".receipt")),
                        env=environment, stdout=subprocess.PIPE,
                        stderr=subprocess.PIPE, text=True))

                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if all((control / (label + ".started")).exists()
                           for label in ("first", "second")):
                        break
                    if any(child.poll() is not None for child in children):
                        break
                    time.sleep(0.02)
                self.assertTrue((control / "first.started").exists(),
                                "first measured cc command did not start")
                self.assertTrue((control / "second.started").exists(),
                                "second measured cc command did not overlap the first")
                (control / "release").touch()
                results = [child.communicate(timeout=30) + (child.returncode,)
                           for child in children]
                self.assertEqual([result[2] for result in results], [0, 0], results)
                self.assertEqual((root / "first.out").read_text(), "artifact-first\n")
                self.assertEqual((root / "second.out").read_text(), "artifact-second\n")
                for label in ("first", "second"):
                    receipt = dict(line.split("=", 1) for line in
                                   (root / (label + ".receipt")).read_text().splitlines()
                                   if "=" in line)
                    self.assertEqual(receipt["status"], "completed")
            finally:
                (control / "release").touch()


if __name__ == "__main__":
    unittest.main()
