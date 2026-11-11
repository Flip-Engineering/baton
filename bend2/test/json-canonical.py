"""Render capture arrays with nested values through the canonical encoder."""
import json
import os
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class JsonCanonical(unittest.TestCase):
    def test_capture_array_preserves_every_render_mode(self):
        with tempfile.TemporaryDirectory(prefix='json-canonical-', dir=ROOT / '.scratch/bend2') as name:
            binary = pathlib.Path(name) / 'json-canonical'
            build = subprocess.run(
                ['sh', 'bend2/scripts/build-native.sh',
                 'bend2/test/json-canonical.bend', str(binary)],
                cwd=ROOT, env=os.environ.copy(), capture_output=True, text=True,
            )
            self.assertEqual(build.returncode, 0, build.stdout + build.stderr)
            observed = subprocess.run([str(binary)], cwd=ROOT, capture_output=True, text=True)
            self.assertEqual(observed.returncode, 0, observed.stderr)
            records = [{'role': 'source', 'payload': 'a"b\\c\n\t\x01 café λ 🙂',
                        'marker': str(i), 'details': ['x', None]} for i in range(64)]
            whole = json.dumps(records, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
            members = whole[1:-1]
            self.assertEqual(observed.stdout.splitlines(),
                             [whole, whole, members, ',' + members, members, ',' + members])
            self.assertEqual(observed.stderr, '')


if __name__ == '__main__':
    unittest.main()
