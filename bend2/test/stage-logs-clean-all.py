"""Tests for immutable staging of the Bend2 log cleanup helper."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "bend2/scripts/stage-logs-clean-all.py"
SPEC = importlib.util.spec_from_file_location("stage_logs_clean_all", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def write_executable(path, body):
    path.write_text("#!/bin/sh\n" + body + "\n")
    path.chmod(0o755)
    return path


class StageLogsCleanAll(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix="logs-stage-test-"))
        self.addCleanup(lambda: __import__("shutil").rmtree(self.temp, ignore_errors=True))
        self.source = self.temp / "source"
        self.source.mkdir()
        (self.source / "bend2/src/coordinator").mkdir(parents=True)
        (self.source / "bend2/src/coordinator/logs-clean-all-focused.bend").write_text(
            "fixture source\n")
        subprocess.run(["git", "init", "-q", str(self.source)], check=True)
        subprocess.run(["git", "-C", str(self.source), "config", "user.email", "fixture@example.test"], check=True)
        subprocess.run(["git", "-C", str(self.source), "config", "user.name", "Fixture"], check=True)
        subprocess.run(["git", "-C", str(self.source), "add", "."], check=True)
        subprocess.run(["git", "-C", str(self.source), "commit", "-qm", "fixture"], check=True)
        self.commit = subprocess.check_output(
            ["git", "-C", str(self.source), "rev-parse", "HEAD"], text=True).strip()
        self.binary = write_executable(self.temp / "helper", 'printf \'{"results":[]}\\n\'')
        self.bend = write_executable(self.temp / "bend", 'printf "Bend 2.0.25\\n"')
        self.clang = write_executable(self.temp / "clang", 'printf "clang version 19\\n"')

    def test_stages_atomic_source_and_tool_pins_and_rejects_destination_reuse(self):
        destination = self.temp / "releases" / ("logs-" + self.commit)
        receipt = MODULE.stage(self.binary, self.bend, self.clang, self.source,
                                self.commit, destination)
        helper = destination / "libexec/baton2/logs-clean-all"
        manifest_path = destination / "logs-clean-all-manifest.json"
        manifest = json.loads(manifest_path.read_text())
        self.assertEqual(receipt["source"]["commit"], self.commit)
        self.assertEqual(receipt["source"]["tree"],
                         subprocess.check_output(["git", "-C", str(self.source), "rev-parse", "HEAD^{tree}"], text=True).strip())
        self.assertEqual(manifest["command"]["path"], "libexec/baton2/logs-clean-all")
        self.assertEqual(manifest["build"]["helper_sha256"], hashlib.sha256(helper.read_bytes()).hexdigest())
        self.assertTrue(os.access(helper, os.X_OK))
        self.assertEqual(json.loads((destination / "stage-receipt.json").read_text()), receipt)
        checksums = {line.split(None, 1)[1]: line.split()[0]
                     for line in (destination / "SHA256SUMS").read_text().splitlines()}
        self.assertEqual(checksums["logs-clean-all-manifest.json"], MODULE.sha256(manifest_path))
        self.assertEqual(checksums["stage-receipt.json"],
                         MODULE.sha256(destination / "stage-receipt.json"))
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            MODULE.stage(self.binary, self.bend, self.clang, self.source,
                         self.commit, destination)

    def test_refuses_a_commit_that_is_not_the_checked_out_source(self):
        wrong = "0" * 40
        with self.assertRaisesRegex(RuntimeError, "HEAD does not match"):
            MODULE.stage(self.binary, self.bend, self.clang, self.source,
                         wrong, self.temp / "releases/wrong")

    def test_refuses_dirty_source_before_staging(self):
        entry = self.source / "bend2/src/coordinator/logs-clean-all-focused.bend"
        entry.write_text(entry.read_text() + "# changed\n")
        with self.assertRaisesRegex(RuntimeError, "must be clean"):
            MODULE.stage(self.binary, self.bend, self.clang, self.source,
                         self.commit, self.temp / "releases/dirty")


if __name__ == "__main__":
    unittest.main()
