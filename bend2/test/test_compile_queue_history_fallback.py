"""Admission from retained workload, compiler-kind and host observations (#1492)."""
import pathlib
import unittest

from test_compile_queue_history_group import HistoryGroupTests, fields


class HistoryFallbackTests(HistoryGroupTests):
    def complete(self, child, name):
        self.holds[name].touch()
        out, err = child.communicate(timeout=60)
        self.assertEqual(child.returncode, 0, out + err)

    def test_two_new_families_run_together_using_a_recorded_kind_peak(self):
        self.measured("observed", "one")
        original = fields(self.root / "receipt-observed")["key"]
        first = self.request("family-a", "two", options=["mode=a"])
        self.until("first new family allocated", lambda: self.allocated("family-a"))
        second = self.request("family-b", "three", options=["mode=b"])
        self.until("second new family allocated", lambda: self.allocated("family-b"))
        for name in ("family-a", "family-b"):
            claim = self.claim(name)
            self.assertIsNotNone(claim)
            self.assertEqual(claim["history"], "0")
            self.assertEqual(claim["peak_source"], "kind")
            self.assertEqual(claim["peak_key"], original)
            self.assertGreater(int(claim["expected_kb"]), 0)
        self.assertIsNone(first.poll())
        self.assertIsNone(second.poll())
        self.complete(first, "family-a")
        self.complete(second, "family-b")

    def test_a_kind_without_observations_uses_the_host_peak(self):
        self.measured("observed", "one")
        original = fields(self.root / "receipt-observed")["key"]
        checking = self.request("checking", "two", kind="check")
        self.until("check allocated", lambda: self.allocated("checking"))
        claim = self.claim("checking")
        self.assertEqual(claim["history"], "0")
        self.assertEqual(claim["peak_source"], "host")
        self.assertEqual(claim["peak_key"], original)
        self.assertEqual(fields(pathlib.Path(claim["peak_attempt"]) / "result")["status"], "completed")
        self.complete(checking, "checking")

    def test_a_new_family_uses_the_largest_recorded_peak_of_its_kind(self):
        self.measured("small", "one", options=["mode=small"])
        self.measured("large", "two", options=["mode=large"], mb=192)
        original = fields(self.root / "receipt-large")["key"]
        expected = int(fields(self.state / "keys" / original / "peak")["peak_kb"])
        unknown = self.request("unknown", "three", options=["mode=unknown"])
        self.until("new family allocated", lambda: self.allocated("unknown"))
        claim = self.claim("unknown")
        self.assertEqual(claim["peak_source"], "kind")
        self.assertEqual(claim["peak_key"], original)
        self.assertEqual(int(claim["expected_kb"]), expected)
        self.complete(unknown, "unknown")

    def test_a_running_legacy_zero_peak_claim_uses_the_recorded_bound(self):
        self.measured("observed", "one", mb=256)
        original = fields(self.root / "receipt-observed")["key"]
        peak = int(fields(self.state / "keys" / original / "peak")["peak_kb"])
        running = self.request("legacy", "two", options=["mode=legacy"], mb=16)
        self.until("legacy command allocated", lambda: self.allocated("legacy"))
        claim = self.claim("legacy")
        path, = (p for p in (self.state / "admission/running").iterdir()
                 if fields(p)["key"] == claim["key"])
        old = "".join(name + "=" + value + "\n" for name, value in claim.items()
                      if name not in ("expected_kb", "history", "kind", "history_group")
                      and not name.startswith("peak_")) + "expected_kb=0\nhistory=0\n"
        path.write_text(old)
        (self.state / "meminfo").write_text("total_kb=%d\navailable_kb=%d\n" % (peak * 8, peak * 3 // 2))
        checking = self.request("checking", "three", kind="check")
        self.until("check waiting for reserved memory", lambda: self.waiting_count() == 1)
        self.assertFalse(self.allocated("checking"))
        (self.state / "meminfo").write_text("total_kb=%d\navailable_kb=%d\n" % (peak * 8, peak * 8))
        self.until("check allocated beside the legacy command", lambda: self.allocated("checking"))
        self.assertEqual(path.read_text(), old)
        self.assertEqual(self.claim("checking")["peak_source"], "host")
        self.assertIsNone(running.poll())
        self.complete(checking, "checking")
        self.complete(running, "legacy")

    def test_a_new_deploy_group_uses_its_compatible_family_beside_a_live_check(self):
        self.measured("deploy-one", "one", **self.deploy_data("first", "abcdef01"))
        original = fields(self.root / "receipt-deploy-one")["key"]
        original_attempt, = (self.state / "keys" / original / "runs").iterdir()
        old_profile = fields(original_attempt / "history-group")
        # This retained profile has the fields emitted by the previous runner.
        (original_attempt / "history-group").write_text("group=" + old_profile["group"] + "\n")
        self.measured("another-family", "two", options=["mode=other"], mb=192)
        checking = self.request("checking", "one", kind="check")
        self.until("unmeasured check allocated", lambda: self.allocated("checking"))
        deployment = self.deploy_data("second", "abcdef02")
        deployment["per_run"] = [("revision" if role == "commit" else "output", value)
                                 for role, value in deployment["per_run"]]
        next_deploy = self.request("deploy-two", "three", **deployment)
        self.until("deploy allocated beside the live check", lambda: self.allocated("deploy-two"))
        claim = self.claim("deploy-two")
        self.assertEqual(claim["peak_source"], "family")
        self.assertEqual(claim["peak_key"], original)
        self.assertEqual(claim["peak_attempt"], str(original_attempt))
        following_attempt, = (self.state / "keys" / claim["key"] / "runs").iterdir()
        self.assertNotEqual(fields(following_attempt / "history-group")["group"], old_profile["group"])
        self.assertIsNone(checking.poll())
        self.complete(next_deploy, "deploy-two")
        self.complete(checking, "checking")

    def test_changed_retained_controls_use_the_kind_fallback(self):
        self.measured("observed", "one", aux=[self.helper])
        original = fields(self.root / "receipt-observed")["key"]
        original_attempt, = (self.state / "keys" / original / "runs").iterdir()
        old_profile = fields(original_attempt / "history-group")
        (original_attempt / "history-group").write_text("group=" + old_profile["group"] + "\n")
        self.helper.write_text("# changed driver\n")
        self.source = self.root / "edited.c"
        changed = self.request("changed", "two", aux=[self.helper])
        self.until("changed control workload allocated", lambda: self.allocated("changed"))
        claim = self.claim("changed")
        self.assertEqual(claim["peak_source"], "kind")
        self.assertEqual(claim["peak_key"], original)
        self.complete(changed, "changed")

    def test_a_fallback_waits_until_the_recorded_peak_fits(self):
        self.measured("observed", "one")
        (_, peak), = self.group_records().items()
        (self.state / "meminfo").write_text("total_kb=%d\navailable_kb=%d\n" % (peak * 8, peak - 1))
        waiting = self.request("different", "two", options=["mode=different"])
        self.until("fallback has a waiting ticket", lambda: self.waiting_count() == 1)
        self.assertFalse(self.allocated("different"))
        self.assertIsNone(self.claim("different"))
        (self.state / "meminfo").write_text("total_kb=%d\navailable_kb=%d\n" % (peak * 8, peak * 8))
        self.until("fallback allocated after capacity became available", lambda: self.allocated("different"))
        claim = self.claim("different")
        self.assertEqual(claim["peak_source"], "kind")
        self.assertGreaterEqual(int(claim["expected_kb"]), peak)
        self.complete(waiting, "different")


def load_tests(loader, tests, pattern):
    return unittest.TestSuite(HistoryFallbackTests(name) for name in sorted(
        name for name in HistoryFallbackTests.__dict__ if name.startswith("test_")))


if __name__ == "__main__":
    unittest.main()
