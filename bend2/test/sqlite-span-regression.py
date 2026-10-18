"""SQLite span binding regressions. Build the named Bend entrypoint first."""
import os
import pathlib
import subprocess
import tempfile
import unittest

EXE = pathlib.Path(os.environ.get("SQLITE_SPAN_EXE", ".scratch/bend2/sqlite-span-regression"))

class SqliteSpan(unittest.TestCase):
    def query(self, db, spool, offset, length):
        return subprocess.run([str(EXE), str(db), str(spool), str(offset), str(length)],
                              text=True, capture_output=True, timeout=15)

    def test_unaligned_nonzero_offset_binds_the_requested_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            spool = root / "stdout"
            spool.write_bytes(b"x\n{\"ok\":true}\n")
            result = self.query(root / "state.db", spool, 2, 11)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, "span-value:1\t1\n\n")

    def test_embedded_nul_is_refused_before_json_classification(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = pathlib.Path(tmp)
            spool = root / "stdout"
            payload = b"{\"ok\":true}\x00tail"
            spool.write_bytes(payload)
            result = self.query(root / "state.db", spool, 0, len(payload))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(result.stdout.startswith("span-error:"), result.stdout)

if __name__ == "__main__":
    unittest.main()
