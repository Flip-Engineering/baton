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
