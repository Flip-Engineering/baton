"""Focused regression cases for retained stdout span integration.

Build with bend2/scripts/build-native.sh bend2/test/span-regression.bend
.scratch/bend2/span-regression, then run this file with SPAN_REGRESSION_EXE
set to that executable.
"""
import os
import pathlib
import subprocess
import tempfile
import unittest

EXE = pathlib.Path(os.environ.get("SPAN_REGRESSION_EXE", ".scratch/bend2/span-regression"))

class SpanRegression(unittest.TestCase):
    def run_case(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], text=True, capture_output=True, timeout=15)

    def test_sqlite_binds_unaligned_nonzero_spool_offset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            spool = root / "stdout"
            spool.write_bytes(b"x\n{\"ok\":true}\n")
            p = self.run_case("query", root / "state.db", spool, "2", "11")
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertEqual(p.stdout, "span-value:1\ttrue\n")

    def test_sqlite_refuses_embedded_nul_before_json_classification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            spool = root / "stdout"
            payload = b"{\"ok\":true}\x00tail"
            spool.write_bytes(payload)
            p = self.run_case("query", root / "state.db", spool, "0", str(len(payload)))
            self.assertEqual(p.returncode, 0, p.stderr)
            self.assertTrue(p.stdout.startswith("span-error:"), p.stdout)

    def test_provider_frame_cannot_select_an_arbitrary_spool(self):
        forged = "\x1e/tmp/provider-selected-file\x1e0:5"
        p = self.run_case("token", "/run/current-attempt/stdout", forged)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, "token-refused\n")

if __name__ == "__main__":
    unittest.main()
