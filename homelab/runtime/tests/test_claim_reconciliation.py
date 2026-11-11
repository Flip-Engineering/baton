import datetime
import hashlib
import json
from pathlib import Path
import tempfile
import unittest

import claim_reconciliation

PROTOCOL = "1016-162807-anat8_head_it25_face9_at_sk5_hd8"
GPU0 = "GPU-1a60290b-b538-1ac7-9a81-3978d3b12c60"
GPU1 = "GPU-b7aaa373-d194-a71f-539d-e0a10dbfc4ce"


class ClaimReconciliation(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def job(self, lane, state, submitted, uuid, allocation=False, render_started=None, prepared_time=None):
        base = self.root / "jobs" if lane == "gpu0" else self.root / "lanes" / lane / "jobs"
        job = base / ("protocol-" + PROTOCOL)
        job.mkdir(parents=True)
        (job / "request.json").write_text(json.dumps({
            "kind": "gpu", "commit": "a" * 40, "protocol_id": PROTOCOL, "submitted": submitted}))
        prepared_time = prepared_time or submitted
        status = {"state": state, "phase": "rendering" if state == "running" else "ready",
                  "started": submitted, "prepared": prepared_time}
        if render_started:
            status["render_started"] = render_started
        (job / "status.json").write_text(json.dumps(status))
        (job / "prepared.json").write_text(json.dumps({
            "host_memory_gib": 48.0, "ranges": [{"gpu": {"uuid": uuid}}]}))
        if allocation:
            (job / "allocation.json").write_text(json.dumps({"gpus": [{"uuid": uuid}]}))
        return job

    def observed(self):
        self.job("gpu0", "running", "2026-10-17T11:14:52.873319+00:00", GPU0,
                 allocation=True, render_started="2026-10-18T04:41:31.404037+00:00")
        self.job("gpu1", "prepared", "2026-10-17T23:05:05.111531+00:00", GPU1)
        return {
            "id": PROTOCOL,
            "claim": {"by": "homelab-v100-farm", "at": "2026-10-17T23:05:03Z",
                      "until": "2026-10-18T08:41:29Z"},
            "history": [
                {"at": "2026-10-17T11:14:48Z", "event": "claimed by homelab-v100-farm"},
                {"at": "2026-10-17T19:00:55Z", "event": "claimed by homelab-v100-farm"},
                {"at": "2026-10-17T23:05:03Z", "event": "claimed by homelab-v100-farm"},
            ],
        }

    def test_observed_duplicate_selects_allocated_copy_and_holds_prepared(self):
        queue = self.observed()
        result = claim_reconciliation.reconcile(self.root, PROTOCOL, queue_claim=queue)
        self.assertEqual(result["action"], "retain_active_hold_prepared")
        self.assertEqual(result["active"]["lane"], "gpu0")
        self.assertEqual(result["copies"][0]["request_submitted"],
                         "2026-10-17T11:14:52.873319+00:00")
        self.assertEqual([item["lane"] for item in result["stale_prepared"]], ["gpu1"])
        self.assertEqual(result["queue_claim"]["claim"]["at"], "2026-10-17T23:05:03Z")
        self.assertFalse(result["mutation"])
        self.assertTrue(result["read_only"])
        self.assertIn("prepared duplicate", result["cause_hint"])

    def test_prepared_only_copies_are_ambiguous(self):
        self.job("gpu0", "prepared", "2026-10-17T11:14:52+00:00", GPU0)
        self.job("gpu1", "prepared", "2026-10-17T23:05:05+00:00", GPU1)
        result = claim_reconciliation.reconcile(self.root, PROTOCOL)
        self.assertEqual(result["action"], "ambiguous_prepared")
        self.assertIsNone(result["active"])
        self.assertEqual(result["prepared_count"], 2)

    def test_two_allocated_active_copies_are_a_conflict(self):
        self.job("gpu0", "running", "2026-10-17T11:14:52+00:00", GPU0, allocation=True)
        self.job("gpu1", "running", "2026-10-17T23:05:05+00:00", GPU1, allocation=True)
        result = claim_reconciliation.reconcile(self.root, PROTOCOL)
        self.assertEqual(result["action"], "conflict_multiple_active")
        self.assertEqual(result["active_count"], 2)

    def test_reconcile_does_not_write_job_files(self):
        self.observed()
        before = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                  for path in self.root.rglob("*") if path.is_file()}
        claim_reconciliation.reconcile(self.root, PROTOCOL)
        after = {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                 for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_lane_names_follow_the_production_layout(self):
        root_job = self.job("gpu0", "prepared", "2026-10-17T11:14:52+00:00", GPU0)
        lane_job = self.job("gpu1", "prepared", "2026-10-17T23:05:05+00:00", GPU1)
        records = claim_reconciliation.copies(self.root, PROTOCOL)
        by_dir = {record["job_dir"]: record["lane"] for record in records}
        self.assertEqual(by_dir[str(root_job)], "gpu0")
        self.assertEqual(by_dir[str(lane_job)], "gpu1")

    def snapshot(self):
        return {str(path): hashlib.sha256(path.read_bytes()).hexdigest()
                for path in self.root.rglob("*") if path.is_file()}

    def test_retirement_dry_run_does_not_write(self):
        self.observed()
        before = self.snapshot()
        result = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=False)
        self.assertEqual(len(result["would_retire"]), 1)
        self.assertEqual(result["retired"], [])
        self.assertEqual(self.snapshot(), before)

    def test_retirement_marks_only_stale_prepared_copy(self):
        self.observed()
        root_job = self.root / "jobs" / ("protocol-" + PROTOCOL)
        root_before = {name: hashlib.sha256((root_job / name).read_bytes()).hexdigest()
                       for name in ("status.json", "request.json", "prepared.json", "allocation.json")}
        result = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=True)
        self.assertEqual(len(result["retired"]), 1)
        stale = self.root / "lanes/gpu1/jobs" / ("protocol-" + PROTOCOL)
        status = json.loads((stale / "status.json").read_text())
        self.assertEqual((status["state"], status["phase"]), ("superseded", "retired"))
        self.assertTrue((stale / "retirement.json").is_file())
        receipt = json.loads((stale / "retirement.json").read_text())
        self.assertEqual(receipt["active_lane"], "gpu0")
        self.assertEqual(receipt["stale_lane"], "gpu1")
        self.assertEqual(receipt["active_uuid"], GPU0)
        self.assertEqual({name: hashlib.sha256((root_job / name).read_bytes()).hexdigest()
                          for name in root_before}, root_before)
        self.assertEqual(json.loads((stale / "request.json").read_text())["protocol_id"], PROTOCOL)
        self.assertEqual(json.loads((stale / "prepared.json").read_text())["host_memory_gib"], 48.0)
        second = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=True)
        self.assertEqual(second["retired"], [])

    def test_retirement_refuses_without_an_allocated_active_copy(self):
        self.job("gpu0", "prepared", "2026-10-17T11:14:52+00:00", GPU0)
        self.job("gpu1", "prepared", "2026-10-17T23:05:05+00:00", GPU1)
        result = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=True)
        status = json.loads((self.root / "jobs" / ("protocol-" + PROTOCOL) / "status.json").read_text())
        self.assertEqual(status["state"], "prepared")

    def test_retirement_skips_recent_or_admitted_prepared_copies(self):
        self.observed()
        recent = datetime.datetime.now(datetime.timezone.utc).isoformat()
        stale = self.root / "lanes/gpu1/jobs" / ("protocol-" + PROTOCOL)
        status = json.loads((stale / "status.json").read_text())
        status["prepared"] = recent
        (stale / "status.json").write_text(json.dumps(status))
        result = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=True)
        self.assertEqual(result["retired"], [])
        self.assertEqual(json.loads((stale / "status.json").read_text())["state"], "prepared")
        status["prepared"] = "2026-10-17T23:05:41.063797+00:00"
        (stale / "status.json").write_text(json.dumps(status))
        (stale / "admission.json").write_text(json.dumps({"memory_bytes": 1}))
        result = claim_reconciliation.retire_prepared_duplicates(
            self.root, [PROTOCOL], apply=True)
        self.assertEqual(result["retired"], [])
        self.assertEqual(json.loads((stale / "status.json").read_text())["state"], "prepared")

    def test_candidate_ids_find_lane_only_prepared_copy_with_active_root_copy(self):
        active = self.job("gpu0", "running", "2026-10-17T11:14:52+00:00", GPU0, allocation=True)
        prepared = self.root / "lanes" / "gpu1" / "jobs" / ("protocol-" + PROTOCOL)
        prepared.mkdir(parents=True)
        (prepared / "request.json").write_text(json.dumps({"protocol_id": PROTOCOL}))
        (prepared / "status.json").write_text(json.dumps({"state": "prepared"}))
        self.assertTrue((active / "status.json").is_file())
        self.assertEqual(claim_reconciliation.candidate_protocol_ids(self.root), [PROTOCOL])

    def test_age_seconds_rejects_naive_and_malformed_timestamps(self):
        now = datetime.datetime(2026, 10, 18, tzinfo=datetime.timezone.utc)
        self.assertIsNone(claim_reconciliation._age_seconds("2026-10-17T23:05:05", now))
        self.assertIsNone(claim_reconciliation._age_seconds("not-a-timestamp", now))
        self.assertIsNone(claim_reconciliation._age_seconds(123, now))
        self.assertEqual(claim_reconciliation._age_seconds("2026-10-17T00:00:00Z", now), 86400.0)


if __name__ == "__main__":
    unittest.main()
