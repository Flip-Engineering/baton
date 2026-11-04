"""A successful command with a missing declared artifact publishes its failure."""
import os
import pathlib
import subprocess
import tempfile
import unittest


class QueueMissingArtifactTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = os.environ.get("BATON2_COMPILE_QUEUE_BIN")
        if not cls.candidate:
            raise unittest.SkipTest("BATON2_COMPILE_QUEUE_BIN is required")

    def test_success_without_declared_artifact_publishes_stage_and_detail(self):
        with tempfile.TemporaryDirectory(prefix="queue-missing-artifact-") as temporary:
            root = pathlib.Path(temporary)
            state = root / "state"
            state.mkdir(mode=0o2770)
            state.chmod(0o2770)
            source = root / "input.c"
            source.write_text("int main(void) { return 0; }\n")
            compiler = root / "fake-cc"
            compiler.write_text("#!/bin/sh\nexit 0\n")
            compiler.chmod(0o755)
            output = root / "missing-output"
            receipt = root / "queue-receipt"
            environment = dict(os.environ, BATON_COMPILE_QUEUE_ROOT=str(state))
            command = [
                self.candidate, "--", "run", "--token", "missing-artifact-test",
                "--receipt", str(receipt), "--kind", "cc",
                "--state-root", str(state), "--cwd", str(root), "--root", str(root),
                "--source-root", str(root), "--compiler", str(compiler),
                "--linker", "/usr/bin/ld", "--version", "fake-missing-artifact-v1",
                "--artifact", "output=" + str(output), "--input", str(source),
                "--", str(compiler),
            ]

            result = subprocess.run(command, env=environment, capture_output=True,
                                    text=True, timeout=120)

            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
            self.assertFalse(output.exists())
            records = list(state.glob("keys/*/runs/*/result"))
            self.assertEqual(len(records), 1, records)
            record = dict(line.split("=", 1) for line in
                          records[0].read_text().splitlines() if "=" in line)
            self.assertEqual(record["status"], "failed", record)
            self.assertEqual(record["exit"], "1", record)
            self.assertEqual(record["verified"], "0", record)
            self.assertEqual(record["stage"], "artifact-verification", record)
            self.assertEqual(record["detail"],
                             "declared artifact output was not written", record)
            self.assertIn("compile-queue: stage=artifact-verification", result.stderr)
            self.assertIn("compile-queue: declared artifact output was not written",
                          result.stderr)
            saved_receipt = dict(line.split("=", 1) for line in
                                 receipt.read_text().splitlines() if "=" in line)
            self.assertEqual(saved_receipt["status"], "failed", saved_receipt)
            self.assertEqual(saved_receipt["stage"], "artifact-verification", saved_receipt)
            self.assertEqual(saved_receipt["detail"],
                             "declared artifact output was not written", saved_receipt)


if __name__ == "__main__":
    unittest.main()
