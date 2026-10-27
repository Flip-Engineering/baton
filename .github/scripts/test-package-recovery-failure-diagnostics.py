#!/usr/bin/env python3
import importlib.util
import hashlib
import json
from pathlib import Path
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("package-recovery-failure-diagnostics.py")
SPEC = importlib.util.spec_from_file_location("recovery_diagnostics", SCRIPT)
recovery_diagnostics = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(recovery_diagnostics)


class RecoveryFailureDiagnosticsTest(unittest.TestCase):
    def test_persists_queue_evidence_and_redacts_owner_token(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run_root = root / "runner-temp"
            queue_dir = run_root / "queue-run/invocation.test/evidence/compile-queue/abc123"
            queue_dir.mkdir(parents=True)
            (run_root / "build.stderr").parent.mkdir(parents=True, exist_ok=True)
            (run_root / "build.stderr").write_text("queue returned status 2\n")
            (run_root / "build.stdout").write_text("build entered recovery mode\n")
            (run_root / "recovery-c-selection.json").write_text(
                json.dumps({"selected_c_sha256": "a" * 64})
            )
            (run_root / "source-closure.json").write_text(json.dumps({"files": [1] * 79}))
            (run_root / "source-commit.txt").write_text("e" * 40 + "\n")
            (run_root / "baton-recovery.c").write_text("large generated C is not retained")
            token = "9f" * 16
            request = {
                "key": "queue-key-123",
                "token": token,
                "argv": ["compile-queue-runner", "--token", token, "--kind", "cc"],
            }
            (queue_dir / "request.json").write_text(json.dumps(request))
            (queue_dir / "receipt").write_text(
                "status=failed\nkey=queue-key-123\nowner=" + token + "\nexit=2\n"
            )
            (queue_dir / "queue-result").write_text(
                "status=failed\nkey=queue-key-123\nowner=" + token + "\n"
            )
            (queue_dir / "stderr").write_text("compiler exited 2\n")
            (queue_dir / "compiler-diagnostics.json").write_text(
                json.dumps({"queue_key": "queue-key-123", "status": "observed"})
            )
            proof = root / "recovery-c-reuse.json"
            proof_bytes = json.dumps({"schema": "proof"}).encode()
            proof.write_bytes(proof_bytes)
            destination_root = root / "persistent/Baton/recovery-diagnostics"

            destination = recovery_diagnostics.package(
                run_root,
                destination_root,
                proof,
                "40592998036",
                "1",
                "e" * 40,
                "7c" * 32,
            )

            saved_request = json.loads(
                (destination / "queue-run/invocation.test/evidence/compile-queue/abc123/request.json").read_text()
            )
            self.assertEqual(saved_request["key"], "queue-key-123")
            self.assertEqual(saved_request["argv"][2], "[redacted-queue-owner-token]")
            self.assertEqual(saved_request["token"], "[redacted-queue-owner-token]")
            for saved in destination.rglob("*"):
                if saved.is_file():
                    self.assertNotIn(token.encode(), saved.read_bytes())
            manifest = json.loads((destination / "diagnostics-manifest.json").read_text())
            self.assertEqual(manifest["source_commit_expected"], "e" * 40)
            self.assertEqual(manifest["source_commit_observed"], "e" * 40)
            self.assertEqual(manifest["proof_sha256_expected"], "7c" * 32)
            self.assertEqual(
                manifest["proof_sha256_observed"], hashlib.sha256(proof_bytes).hexdigest()
            )
            self.assertEqual(manifest["selected_c_sha256"], "a" * 64)
            self.assertEqual(manifest["source_closure_file_count"], 79)
            self.assertEqual(manifest["queue_owner_tokens_redacted"], 1)
            self.assertFalse(any(path.suffix == ".c" for path in destination.rglob("*")))
            self.assertFalse(any(path.name == "toolchains" for path in destination.rglob("*")))


if __name__ == "__main__":
    unittest.main()
