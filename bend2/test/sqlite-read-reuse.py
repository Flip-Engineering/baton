"""Focused checks for the per-thread SQLite read cache (issue #943).

The fixture compiles the verbatim BatonSql row callback, busy handler and the
marked read-cache section of bend2/src/host/sqlite.c. It exercises two helper
threads, path switching, file replacement, committed-write visibility,
autocommit rollback, busy handling, UTF-8 refusal, fork rejection and
thread-exit cleanup.
"""
import os
import pathlib
import shutil
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SQLITE_C = ROOT / 'bend2/src/host/sqlite.c'
DRIVER = ROOT / 'bend2/test/sqlite-read-reuse.c'
SCRATCH = ROOT / '.scratch/bend2'
FIXTURE = SCRATCH / 'sqlite-read-reuse'

PRELUDE = '''#include <sqlite3.h>
#include <stdint.h>
#include <sys/stat.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <stdatomic.h>
#include <time.h>
#include <sched.h>
typedef struct { void *data; } IoWork;
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


def struct_block(lines):
    start = next(i for i, line in enumerate(lines)
                 if line.startswith('typedef struct {')
                 and 'char *path, *sql, *output, *error;' in lines[i + 1])
    end = next(i for i in range(start, len(lines))
               if lines[i].startswith('} BatonSql;'))
    return ''.join(lines[start:end + 1])


def build_fixture():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines = SQLITE_C.read_text().splitlines(keepends=True)
    begin = next(i for i, line in enumerate(lines)
                 if '/* BATON SQL READ CACHE BEGIN */' in line)
    end = next(i for i, line in enumerate(lines)
               if '/* BATON SQL READ CACHE END */' in line)
    combined = SCRATCH / 'sqlite-read-reuse-combined.c'
    combined.write_text(
        PRELUDE
        + struct_block(lines)
        + function_block(lines, 'static int baton_sql_row')
        + function_block(lines, 'static int baton_sql_busy')
        + ''.join(lines[begin + 1:end])
        + DRIVER.read_text())
    compiler = os.environ.get('CC', 'cc')
    command = [compiler, '-Wall', '-Wextra', '-O2', '-pthread',
               '-DBATON_SQL_READ_TEST', str(combined), '-lsqlite3', '-o', str(FIXTURE)]
    queue_driver = os.environ.get('BATON2_NATIVE_QUEUE_DRIVER')
    if queue_driver:
        command = [os.environ.get('PYTHON3', 'python3'), queue_driver,
                   'compiler', 'cc', *command[1:]]
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


class SqliteReadReuse(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not shutil.which(os.environ.get('CC', 'cc')):
            raise unittest.SkipTest('C compiler is not available')
        build_fixture()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=SCRATCH)
        self.addCleanup(self.temp.cleanup)

    def run_mode(self, mode):
        return subprocess.run([str(FIXTURE), mode, self.temp.name],
                              capture_output=True, text=True)

    def test_lifecycle(self):
        result = self.run_mode('lifecycle')
        self.assertEqual(result.returncode, 0,
                         result.stdout + result.stderr)
        for label in ('two_threads', 'path-first', 'path-second', 'path-again',
                      'write-before', 'write-after', 'autocommit-transaction',
                      'autocommit-after', 'read-only', 'read-only-after',
                      'replacement-before', 'replacement-after',
                      'multi-statement', 'busy-read', 'fork-forget-inherited',
                      'fork-tls-destructor', 'fork-parent-after',
                      'encoding-refusal', 'encoding-utf8',
                      'lifecycle'):
            self.assertIn('ok ' + label, result.stdout)



if __name__ == '__main__':
    unittest.main()
