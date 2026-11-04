"""A collected compiler child publishes its exact exit status to the watcher."""
import os
import pathlib
import subprocess
import tempfile
import unittest


class QueueCollectedExitTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def test_waitpid_status_is_durable_and_artifacts_complete(self):
        with tempfile.TemporaryDirectory(prefix="queue-collected-exit-") as temporary:
            root = pathlib.Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o2770)
            source = root / "main.c"
            source.write_text("int main(void){return 0;}\n")
            output = root / "result"
            compiler = root / "fake-compiler"
            compiler.write_text(
                "#!/bin/sh\n"
                "previous=\n"
                "for argument in \"$@\"; do\n"
                "  if [ \"$previous\" = -o ]; then printf 'complete\\n' > \"$argument\"; exit 0; fi\n"
                "  previous=$argument\n"
                "done\nexit 4\n")
            compiler.chmod(0o755)
            token = os.urandom(16).hex()
            argv = [self.candidate, "--", "run", "--token", token,
                    "--receipt", str(root / "receipt"), "--kind", "cc",
                    "--state-root", str(state), "--cwd", str(root), "--root", str(root),
                    "--source-root", str(root), "--compiler", str(compiler),
                    "--linker", "/usr/bin/ld", "--version", "fake-exit-v1",
                    "--artifact", "output=" + str(output), "--input", str(source),
                    "--", str(compiler), "-o", str(output)]
            result = subprocess.run(argv, env=dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state)),
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertEqual(output.read_text(), "complete\n")
            markers = list(state.glob("keys/*/runs/*/exit_status"))
            self.assertEqual(len(markers), 1)
            marker = dict(line.split("=", 1) for line in markers[0].read_text().splitlines())
            self.assertTrue(int(marker["pid"]) > 0)
            self.assertTrue(marker["starttime"])
            self.assertEqual(marker["exit"], "0")
            self.assertEqual(marker["signal"], "0")
            receipt = dict(line.split("=", 1) for line in
                           (root / "receipt").read_text().splitlines() if "=" in line)
            self.assertEqual(receipt["status"], "completed")


if __name__ == "__main__":
    unittest.main()
