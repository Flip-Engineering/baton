import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SCRIPT = Path(__file__).with_name("deploy_runtime.py")
SPEC = importlib.util.spec_from_file_location("deploy_runtime", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DeployRuntime(unittest.TestCase):
    def test_stage_verifies_source_and_keeps_revision_immutable(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source"
            source.mkdir()
            payload = source / "gpu_jobs.py"
            payload.write_text("source")
            digest = hashlib.sha256(payload.read_bytes()).hexdigest()
            provenance = root / "provenance.json"
            provenance.write_text(json.dumps({
                "pipeline_base": "a" * 40,
                "records": [{"path": "gpu_jobs.py", "tracked_sha256": digest}],
            }))
            release = MODULE.stage(source, root / "releases", "a" * 40, provenance)
            self.assertEqual((release / "runtime/gpu_jobs.py").read_text(), "source")
            with self.assertRaises(FileExistsError):
                MODULE.stage(source, root / "releases", "a" * 40, provenance)

    def test_stage_rejects_changed_runtime_source(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            source = root / "source"
            source.mkdir()
            (source / "gpu_jobs.py").write_text("changed")
            provenance = root / "provenance.json"
            provenance.write_text(json.dumps({
                "pipeline_base": "b" * 40,
                "records": [{"path": "gpu_jobs.py", "tracked_sha256": "0" * 64}],
            }))
            with self.assertRaisesRegex(ValueError, "source hash mismatch"):
                MODULE.stage(source, root / "releases", "b" * 40, provenance)


    def test_repository_runtime_matches_provenance_before_deploy(self):
        root = Path(__file__).parent
        source = root / "runtime"
        provenance = root / "SOURCE_PROVENANCE.json"
        with tempfile.TemporaryDirectory() as td:
            release = MODULE.stage(source, Path(td) / "releases", "e" * 40, provenance)
            self.assertTrue((release / "RELEASE.json").is_file())

if __name__ == "__main__":
    unittest.main()
