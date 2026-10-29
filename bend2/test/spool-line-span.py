"""Retained-spool span reads keep the bytes after a returned line.

The fixture compiles against the generated process source and drives the awake
span probe and the blocking span reader on disposable spools. It measures the
bytes read for 4096 lines of 128 bytes with the kept bytes used and with them
discarded before every read, and checks empty and unterminated lines, a split
line with a NUL byte, invalidation after a text read and a replay rewind, and a
child error recorded after a read.
"""
import json
import os
import pathlib
import re
import subprocess
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROCESS_C = ROOT / '.scratch/bend2/process-test.c'
SOURCE = ROOT / 'bend2/test/spool-line-span.c'
FIXTURE = ROOT / '.scratch/bend2/spool-line-span'


def measured(output, name):
    return int(re.search(r'^' + name + r'=(\d+)$', output, re.M).group(1))


@unittest.skipUnless(sys.platform.startswith('linux'), 'rchar is read from /proc/self/io')
class SpoolLineSpan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        if not PROCESS_C.exists():
            result = subprocess.run([
                'sh', 'bend2/scripts/build-native.sh', 'bend2/test/process.bend',
                '.scratch/bend2/process-test',
            ], cwd=ROOT, capture_output=True, text=True)
            if result.returncode:
                raise AssertionError(result.stdout + result.stderr)
        result = subprocess.run([
            os.environ.get('CC', 'clang'), '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + json.dumps(str(PROCESS_C)),
            str(SOURCE), '-lsqlite3', '-lm', '-o', str(FIXTURE),
        ], capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def test_short_line_spans_read_each_spool_byte_once(self):
        result = subprocess.run([str(FIXTURE)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('spool-line-span PASS', result.stdout)
        size = measured(result.stdout, 'SHORT_BYTES')
        self.assertEqual(measured(result.stdout, 'SHORT_LINES'), 4096)
        self.assertEqual(size, 4096 * 128)
        for reader in ('PROBE', 'BLOCKING'):
            cached = measured(result.stdout, reader + '_CACHED_RCHAR')
            uncached = measured(result.stdout, reader + '_UNCACHED_RCHAR')
            self.assertGreaterEqual(cached, size, reader)
            self.assertLess(cached, size * 2, reader)
            self.assertGreater(uncached, size * 32, reader)
        print('evidence', result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
