"""Focused retained-spool line-span measurement (issue #943).

Compiles the verbatim br_spool_try_line_span function from
bend2/src/host/process-spawn.c with the fields it reads. The driver reads a
disposable spool of short lines, checks every returned range, exercises a
partial line that arrives later and an EOF tail, and reports process rchar for
the complete-line pass. It does not drive replay.
"""
import os
import pathlib
import re
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROCESS_C = ROOT / 'bend2/src/host/process-spawn.c'
DRIVER = ROOT / 'bend2/test/spool-line-span.c'
SCRATCH = ROOT / '.scratch/bend2'
FIXTURE = SCRATCH / 'spool-line-span'

PRELUDE = '''#include <stdint.h>
#include <sys/types.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <limits.h>
#include <pthread.h>
typedef struct BatonRetained {
  int spool, error, exited;
  off_t offset;
  pthread_mutex_t state;
  char spool_tail[8192];
  size_t spool_tail_length;
  uint64_t spool_partial;
  off_t spool_state_offset;
} BatonRetained;
typedef struct BatonProcessCall {
  int error, eof;
  uint64_t frame_start, frame_length;
} BatonProcessCall;
'''


def function_block(lines, signature):
    start = next(i for i, line in enumerate(lines)
                 if line.startswith(signature))
    depth = 0
    for index in range(start, len(lines)):
        depth += lines[index].count('{') - lines[index].count('}')
        if depth == 0 and index > start:
            return ''.join(lines[start:index + 1])
    raise AssertionError(f'unclosed function: {signature}')


def build_fixture():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines = PROCESS_C.read_text().splitlines(keepends=True)
    combined = SCRATCH / 'spool-line-span-combined.c'
    combined.write_text(
        PRELUDE
        + function_block(lines, 'static int br_spool_try_line_span')
        + DRIVER.read_text())
    result = subprocess.run(
        [os.environ.get('CC', 'cc'), '-Wall', '-Wextra', '-O2', '-pthread',
         str(combined), '-o', str(FIXTURE)],
        capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


class SpoolLineSpan(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_fixture()

    def test_spool_line_span_reads_tail_once(self):
        result = subprocess.run([str(FIXTURE)], capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('SPOOL_LINE_TESTS_OK', result.stdout)
        lines = int(re.search(r'^COMPLETE_LINES=(\d+)$', result.stdout, re.M).group(1))
        size = int(re.search(r'^COMPLETE_BYTES=(\d+)$', result.stdout, re.M).group(1))
        rchar = int(re.search(r'^COMPLETE_RCHAR=(\d+)$', result.stdout, re.M).group(1))
        self.assertEqual(lines, 4096)
        self.assertEqual(size, 4096 * 128)
        self.assertLess(rchar, size * 2)
        print('evidence', result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
