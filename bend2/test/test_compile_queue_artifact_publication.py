"""A cc command that exits 0 without writing its declared artifact produces
a failed artifact-verification result.

Set BATON2_COMPILE_QUEUE_BIN to the native queue under test. The fake
compiler exits 0 and never writes the declared artifact. The supervisor
publishes status=failed exit=1 with the detail "declared artifact
compile was not written" and the stage "artifact-verification". The
parent retains that result with the missing artifact name and its
diagnostic. Artifact content verification at reuse and adoption is
separate and unchanged.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest


class QueueArtifactPublicationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="queue-artifact-pub-")
        self.addCleanup(self.temporary.cleanup)
        self.root = pathlib.Path(self.temporary.name)
        self.state = self.root / "state"
        self.state.mkdir(mode=0o2770)
        self.state.chmod(0o2770)
        self.main = self.root / "main.c"
        self.main.write_text("int main(void){return 0;}\n")
        self.output = self.root / "result"
        self.compiler = self.root / "fake-compiler"
        # Exits 0 and deliberately never writes the declared artifact.
        self.compiler.write_text("#!/bin/sh\nexit 0\n")
        self.compiler.chmod(0o755)
        self.environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(self.state))

    def request(self):
        token = os.urandom(16).hex()
        argv = [self.candidate, "--", "run", "--token", token,
                "--receipt", str(self.root / "receipt"), "--kind", "cc",
                "--state-root", str(self.state), "--cwd", str(self.root),
                "--root", str(self.root), "--source-root", str(self.root),
                "--compiler", str(self.compiler), "--linker", "/usr/bin/ld",
                "--version", "fake-artifact-v1",
                "--artifact", "compile=" + str(self.root / "compile-result"),
                "--input", str(self.main),
                "--", str(self.compiler), "-o", str(self.output)]
        return subprocess.run(argv, env=self.environment, capture_output=True, text=True)

    def retained_result(self):
        results = sorted(self.state.glob("keys/*/runs/*/result"))
        self.assertEqual(len(results), 1, results)
        return results[0].read_text()

    def test_missing_declared_artifact_publishes_failed_result(self):
        result = self.request()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        record = self.retained_result()
        self.assertIn("status=failed", record)
        self.assertIn("exit=1", record)
        self.assertIn("declared artifact compile was not written", record)
        self.assertIn("artifact-verification", record)
        self.assertNotIn("supervisor exited before publishing", record)


if __name__ == "__main__":
    unittest.main()
