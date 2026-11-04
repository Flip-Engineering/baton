#!/usr/bin/env python3
"""Check refreshed distribution checksums after inherited files change."""
import hashlib
from pathlib import Path
import runpy
import subprocess
import tempfile
import unittest

MODULE = runpy.run_path(str(Path(__file__).with_name('package-compiler.py')))


class ReleaseManifestTests(unittest.TestCase):
    def test_changed_and_added_members_replace_inherited_checksums(self):
        with tempfile.TemporaryDirectory() as directory:
            prefix = Path(directory)
            (prefix / 'bend2').mkdir()
            (prefix / 'bend2/bend.ts').write_text('old compiler')
            (prefix / 'deployment.json').write_text('old metadata')
            MODULE['write_release_checksums'](prefix)
            old_manifest = (prefix / 'release.SHA256SUMS').read_bytes()
            (prefix / 'bend2/bend.ts').write_text('current compiler')
            (prefix / 'deployment.json').write_text('current metadata')
            (prefix / 'new-provenance.json').write_text('retained provenance')
            MODULE['write_release_checksums'](prefix)
            manifest = prefix / 'release.SHA256SUMS'
            self.assertNotEqual(manifest.read_bytes(), old_manifest)
            entries = [line.split('  ', 1)[1] for line in manifest.read_text().splitlines()]
            self.assertEqual(entries, ['bend2/bend.ts', 'deployment.json', 'new-provenance.json'])
            self.assertEqual((prefix / 'release.closure').read_text(),
                             hashlib.sha256(manifest.read_bytes()).hexdigest()
                             + '  release.SHA256SUMS\n')
            for name in ['release.SHA256SUMS', 'release.closure']:
                result = subprocess.run(['sha256sum', '-c', name], cwd=prefix,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            before = manifest.read_bytes(), (prefix / 'release.closure').read_bytes()
            MODULE['write_release_checksums'](prefix)
            self.assertEqual(before, (manifest.read_bytes(), (prefix / 'release.closure').read_bytes()))


if __name__ == '__main__':
    unittest.main()
