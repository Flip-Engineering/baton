import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import runtime_selection

DEPLOY = Path(__file__).resolve().parents[2] / "deploy_runtime.py"
LAUNCH = Path(__file__).resolve().parents[1] / "runtime_launch.py"
PRIOR = "2637fcc3663e9f1468a140a56da37ae965313cfd"


def load_deploy():
    spec = importlib.util.spec_from_file_location("deploy_runtime_test", DEPLOY)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class RuntimeSelection(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source"
        self.source.mkdir()
        self.provenance = self.root / "SOURCE_PROVENANCE.json"
        self.releases = self.root / "releases"

    def write_source(self, payload="runtime"):
        files = {"gpu_jobs.py": payload, "scheduler.py": "scheduler"}
        records = []
        for name, text in files.items():
            (self.source / name).write_text(text)
            records.append({"path": name, "tracked_sha256": sha256(self.source / name),
                            "source_path": None, "source_sha256": None, "status": "added"})
        self.provenance.write_text(json.dumps({
            "schema": "acp.homelab-runtime-provenance/v1",
            "pipeline_base": "a" * 40,
            "records": records,
        }))

    def stage(self, revision, payload="runtime"):
        self.write_source(payload)
        return load_deploy().stage(self.source, self.releases, revision, self.provenance)

    def test_stage_writes_verifiable_immutable_seal(self):
        revision = "a" * 40
        release = self.stage(revision)
        self.assertTrue((release / "RELEASE.json").is_file())
        verified = runtime_selection.verify_release(revision, self.releases)
        self.assertEqual(verified["revision"], revision)
        self.assertEqual(verified["files"]["gpu_jobs.py"], sha256(release / "runtime/gpu_jobs.py"))
        (release / "runtime/gpu_jobs.py").write_text("tampered")
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            runtime_selection.verify_release(revision, self.releases)

    def test_activation_writes_receipt_and_prefers_no_overwrite(self):
        revision = "b" * 40
        release = self.stage(revision)
        before = sha256(release / "runtime/gpu_jobs.py")
        result = runtime_selection.activate(revision, selection=self.root / "selection.json",
                                            releases=self.releases, receipts=self.root / "receipts")
        receipt = json.loads(Path(result["receipt"]).read_text())
        selection = json.loads(Path(result["selection"]).read_text())
        self.assertEqual(receipt["schema"], "acp.homelab-runtime-activation/v1")
        self.assertEqual(receipt["generation"], 1)
        self.assertEqual(receipt["revision"], revision)
        self.assertEqual(receipt["selection_sha256"], sha256(result["selection"]))
        self.assertFalse(receipt["service_restarted"])
        self.assertFalse(receipt["active_processes_modified"])
        self.assertEqual(selection["provenance_sha256"], receipt["provenance_sha256"])
        self.assertEqual(sha256(release / "runtime/gpu_jobs.py"), before)
        with self.assertRaisesRegex(ValueError, "already selected"):
            runtime_selection.activate(revision, selection=self.root / "selection.json",
                                       releases=self.releases, receipts=self.root / "receipts")

    def test_successive_activation_versions_history_without_touching_release(self):
        first = self.stage("c" * 40)
        runtime_selection.activate("c" * 40, selection=self.root / "selection.json",
                                   releases=self.releases, receipts=self.root / "receipts")
        first_hashes = {path.name: sha256(path) for path in (first / "runtime").iterdir()}
        second = self.stage("d" * 40)
        result = runtime_selection.activate("d" * 40, selection=self.root / "selection.json",
                                            releases=self.releases, receipts=self.root / "receipts")
        selection = json.loads(Path(result["selection"]).read_text())
        self.assertEqual(selection["generation"], 2)
        self.assertEqual(selection["selected_revision"], "d" * 40)
        self.assertEqual([entry["revision"] for entry in selection["history"]], ["c" * 40, "d" * 40])
        self.assertEqual({path.name: sha256(path) for path in (first / "runtime").iterdir()}, first_hashes)
        self.assertTrue(second.is_dir())

    def test_selection_rejects_wrong_provenance_and_keeps_prior_pin(self):
        revision = "e" * 40
        self.stage(revision)
        verify = runtime_selection.verify_release(revision, self.releases)
        selection = {
            "schema": runtime_selection.SELECTION_SCHEMA,
            "generation": 3,
            "selected_revision": "f" * 40,
            "previous_pins": [{
                "revision": PRIOR,
                "status": "staged_prior_pin",
                "activated": False,
                "provenance_sha256": None,
                "note": "staged earlier; preserved unchanged",
            }],
            "history": [],
        }
        path = self.root / "selection.json"
        path.write_text(json.dumps(selection))
        result = runtime_selection.activate(revision, selection=path, releases=self.releases,
                                            receipts=self.root / "receipts")
        updated = json.loads(Path(result["selection"]).read_text())
        self.assertEqual(updated["generation"], 4)
        self.assertEqual(updated["previous_pins"], selection["previous_pins"])
        self.assertNotEqual(updated["selected_revision"], PRIOR)
        broken = dict(updated, provenance_sha256="0" * 64)
        path.write_text(json.dumps(broken))
        with self.assertRaisesRegex(ValueError, "provenance does not match"):
            runtime_selection.load_selected(path, self.releases)

    def test_launcher_executes_only_validated_selected_release(self):
        revision = "1" * 40
        self.stage(revision)
        runtime_selection.activate(revision, selection=self.root / "selection.json",
                                   releases=self.releases, receipts=self.root / "receipts")
        result = subprocess.run([sys.executable, str(LAUNCH),
                                 "--selection", str(self.root / "selection.json"),
                                 "--releases", str(self.releases),
                                 "--receipts", str(self.root / "launch-receipts"),
                                 "--dry-run", "--", "gpu_jobs.py", "arg"],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual(Path(payload["entrypoint"]), self.releases / revision / "runtime/gpu_jobs.py")
        self.assertTrue(Path(payload["receipt"]).is_file())
        self.assertFalse(payload["launch"]["service_restarted"])


if __name__ == "__main__":
    unittest.main()
