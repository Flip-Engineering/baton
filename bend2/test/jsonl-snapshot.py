"""Actual JSONL snapshot I/O using the queue-built C fixture."""
import errno
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


class JsonlSnapshot(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="baton-jsonl-")
        self.addCleanup(self.directory.cleanup)
        self.path = pathlib.Path(self.directory.name) / "frames.jsonl"
        self.binary = os.environ["BATON2_JSONL_SNAPSHOT_FIXTURE"]
        self.predicate = "SELECT CASE WHEN json_extract(?1,'$.keep')=1 THEN 1 ELSE 0 END"

    def read(self, data, predicate=None, action=None):
        self.path.write_bytes(data)
        arguments = [self.binary, str(self.path), predicate or self.predicate]
        if action:
            arguments.append(action)
        return subprocess.run(arguments, capture_output=True)

    def test_first_match_retains_original_suffix_and_checks_later_frames(self):
        prefix = b'{"keep":0,"value":"old"}\n' * 10000
        suffix = '\n{"keep":1,"value":"λ🙂"}\r\n{"keep":0}\n{"keep":1}'.encode()
        result = self.read(prefix + suffix)
        self.assertEqual((result.returncode, result.stdout, result.stderr),
                         (0, suffix[1:], b""))

    def test_absent_match_empty_file_and_empty_lines_return_empty(self):
        for data in (b"", b"\n\n", b'{"keep":0}\n'):
            with self.subTest(data=data):
                result = self.read(data)
                self.assertEqual((result.returncode, result.stdout, result.stderr), (0, b"", b""))

    def test_invalid_snapshot_before_or_after_match_fails_closed(self):
        invalid = (b'{"unfinished":', b'{"bad":true,}', b'\xff', b'\xc0\x80',
                   b'\xed\xa0\x80', b'\xf4\x90\x80\x80', b'\0', b'\xef\xbb\xbf{}', b' ')
        for value in invalid:
            for data in (value + b'\n{"keep":1}\n', b'{"keep":1}\n' + value):
                with self.subTest(data=data):
                    result = self.read(data)
                    self.assertEqual(result.returncode, 1)
                    self.assertEqual(result.stdout, b"")

    def test_completed_final_frame_needs_no_newline(self):
        result = self.read(b'{"keep":0}\n{"keep":1}')
        self.assertEqual((result.returncode, result.stdout), (0, b'{"keep":1}'))

    def test_changed_snapshot_or_path_returns_retryable_io_failure(self):
        for action in ("append", "rewrite", "replace"):
            with self.subTest(action=action):
                result = self.read(b'{"keep":1}\n{"keep":0}\n',
                                   "SELECT fixture_change(?1)", action)
                self.assertEqual((result.returncode, result.stdout, result.stderr),
                                 (1, b"", f"{errno.EAGAIN}\n".encode()))

    def test_replacement_and_compaction_between_calls_use_new_snapshot(self):
        self.assertEqual(self.read(b'{"keep":0}\n{"keep":1,"old":true}\n').stdout,
                         b'{"keep":1,"old":true}\n')
        replacement = self.path.with_suffix(".next")
        replacement.write_bytes(b'{"compact":true}\n{"keep":1,"new":true}\n')
        replacement.replace(self.path)
        result = subprocess.run([self.binary, str(self.path), self.predicate], capture_output=True)
        self.assertEqual((result.returncode, result.stdout), (0, b'{"keep":1,"new":true}\n'))

    def test_predicate_requires_single_readonly_boolean_scalar(self):
        for query in ("SELECT 1; SELECT ?1", "CREATE TABLE changed(value)",
                      "SELECT ?1,1", "SELECT 1", "SELECT 2 WHERE ?1 IS NOT NULL",
                      "SELECT NULL WHERE ?1 IS NOT NULL", "SELECT '1' WHERE ?1 IS NOT NULL",
                      "SELECT 4294967296 WHERE ?1 IS NOT NULL", "SELECT 4294967297 WHERE ?1 IS NOT NULL",
                      "SELECT -4294967296 WHERE ?1 IS NOT NULL", "SELECT 9223372036854775807 WHERE ?1 IS NOT NULL",
                      "SELECT 1 WHERE ?1 IS NULL", "SELECT 1 FROM json_each(?1)"):
            with self.subTest(query=query):
                result = self.read(b'{"keep":1,"second":2}\n', query)
                self.assertEqual((result.returncode, result.stdout), (1, b""))


if __name__ == "__main__":
    unittest.main()
