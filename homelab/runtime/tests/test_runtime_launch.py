import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import runtime_launch


class RuntimeLaunchReceiptTests(unittest.TestCase):
    def test_same_reused_pid_gets_distinct_receipts(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            loaded = {
                "selection": {"generation": 2},
                "selection_path": root / "runtime-selection.json",
                "release": {
                    "revision": "a" * 40,
                    "release": root / "releases" / ("a" * 40),
                    "seal_sha256": "b" * 64,
                    "provenance_sha256": "c" * 64,
                },
            }
            with patch.object(runtime_launch.os, "getpid", return_value=4123):
                first, _ = runtime_launch.launch_receipt(loaded, "selected_lane_launch.py", [], root / "receipts")
                second, _ = runtime_launch.launch_receipt(loaded, "selected_lane_launch.py", [], root / "receipts")
            self.assertNotEqual(first, second)
            self.assertTrue(first.is_file())
            self.assertTrue(second.is_file())


if __name__ == "__main__":
    unittest.main()
