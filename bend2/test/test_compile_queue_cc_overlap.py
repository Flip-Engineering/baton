"""Independent cc request keys overlap and publish their own artifacts."""
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

    def test_independent_cc_commands_overlap_and_publish(self):
        with tempfile.TemporaryDirectory(prefix="queue-cc-overlap-") as temporary:
            root = pathlib.Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o2770)
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
            children = []
            for label in ("first", "second"):
                output = root / (label + ".out")
                receipt = root / (label + ".receipt")
                source = root / (label + ".c")
                source.write_text("int " + label + "(void) { return 0; }\n")
                argv = [self.candidate, "--", "run", "--token", os.urandom(16).hex(),
                        "--receipt", str(receipt), "--kind", "cc", "--state-root", str(state),
                        "--cwd", str(root), "--root", str(root), "--source-root", str(root),
                        "--compiler", str(compiler), "--linker", "/usr/bin/ld",
                        "--version", "fake-overlap-v1", "--artifact", "output=" + str(output),
                        "--input", str(source), "--", str(compiler), str(control), label, str(output)]
                children.append(subprocess.Popen(argv, env=environment,
                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True))

            try:
                deadline = time.monotonic() + 20
                while time.monotonic() < deadline:
                    if all((control / (label + ".started")).exists()
                           for label in ("first", "second")):
                        break
                    if any(child.poll() is not None for child in children):
                        break
                    time.sleep(0.02)
                self.assertTrue((control / "first.started").exists(), "first cc command did not start")
                self.assertTrue((control / "second.started").exists(),
                                "second independent cc command did not overlap the first")
                (control / "release").touch()
                results = [child.communicate(timeout=30) + (child.returncode,) for child in children]
                self.assertEqual([result[2] for result in results], [0, 0], results)
                self.assertEqual((root / "first.out").read_text(), "artifact-first\n")
                self.assertEqual((root / "second.out").read_text(), "artifact-second\n")
                for label in ("first", "second"):
                    receipt = dict(line.split("=", 1) for line in
                        (root / (label + ".receipt")).read_text().splitlines() if "=" in line)
                    self.assertEqual(receipt["status"], "completed")
            finally:
                (control / "release").touch()
                for child in children:
                    if child.poll() is None:
                        child.wait(timeout=30)


if __name__ == "__main__":
    unittest.main()
