import hashlib
import json
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "videos" / "gpu"))
import fframes_canary


class Admission(unittest.TestCase):
    def environment(self, directory, uuid="GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60"):
        request_path = pathlib.Path(directory) / "request.json"
        request = {"protocol_id": "canary-test", "commit": "a" * 40}
        request_path.write_text(json.dumps(request))
        record = {
            "schema": "acp.gpu-campaign-admission/v1",
            "job": "canary-test",
            "pipeline_commit": "a" * 40,
            "request_sha256": hashlib.sha256(request_path.read_bytes()).hexdigest(),
            "prepared_sha256": "b" * 64,
            "admission_sha256": "c" * 64,
            "allocation_sha256": "d" * 64,
            "boot_id": "boot",
            "owner_start": "1",
            "memory_bytes": 8 * 2**30,
            "container_memory_gib": 8.0,
            "container_cpu_cores": 2.0,
            "gpu_uuids": [uuid],
        }
        return {
            "CAMPAIGN_ADMITTED_GPU_UUIDS": uuid,
            "OC_ADMISSION_RECEIPT": json.dumps(record),
            "GPU_JOB_ID": "canary-test",
            "ACP_JOB_REQUEST_FILE": str(request_path),
        }

    def test_matching_admission_and_request(self):
        with tempfile.TemporaryDirectory() as directory:
            uuid, record = fframes_canary.admitted_context(self.environment(directory))
            self.assertEqual(uuid, record["gpu_uuids"][0])

    def test_missing_or_mismatched_gpu_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.environment(directory)
            env["CAMPAIGN_ADMITTED_GPU_UUIDS"] = ""
            with self.assertRaisesRegex(ValueError, "one canonical admitted"):
                fframes_canary.admitted_context(env)
            env = self.environment(directory)
            env["CAMPAIGN_ADMITTED_GPU_UUIDS"] = "GPU-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
            with self.assertRaisesRegex(ValueError, "does not bind"):
                fframes_canary.admitted_context(env)

    def test_missing_or_unbounded_resource_receipt_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.environment(directory)
            record = json.loads(env["OC_ADMISSION_RECEIPT"])
            record["container_memory_gib"] = 0
            env["OC_ADMISSION_RECEIPT"] = json.dumps(record)
            with self.assertRaisesRegex(ValueError, "positive finite container_memory_gib"):
                fframes_canary.admitted_context(env)

    def test_changed_request_refuses(self):
        with tempfile.TemporaryDirectory() as directory:
            env = self.environment(directory)
            pathlib.Path(env["ACP_JOB_REQUEST_FILE"]).write_text("{}")
            with self.assertRaisesRegex(ValueError, "request manifest"):
                fframes_canary.admitted_context(env)


if __name__ == "__main__":
    unittest.main()
