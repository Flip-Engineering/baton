"""Focused span-query cache measurement (issue #943).

Compiles the verbatim BatonSqlSpan struct, span call and read-cache section
from bend2/src/host/sqlite.c. The driver runs the same span query twice on one
database, then once on a second database, and reports process rchar and the
cache live count. The fixture uses disposable databases and does not drive
replay.
"""
import os
import pathlib
import re
import sqlite3
import subprocess
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
SQLITE_C = ROOT / 'bend2/src/host/sqlite.c'
DRIVER = ROOT / 'bend2/test/sqlite-span-cache.c'
SCRATCH = ROOT / '.scratch/bend2'
FIXTURE = SCRATCH / 'sqlite-span-cache'

PRELUDE = '''#include <sqlite3.h>
#include <stdint.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <errno.h>
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <pthread.h>
#include <stdatomic.h>
#include <sys/wait.h>
#include <time.h>
#include <sched.h>
#include <limits.h>
typedef struct { void *data; } IoWork;
'''

PROTOTYPES = '''static sqlite3 *baton_sql_read_acquire(const char *path, char **error, int *status, int *cached);
static void baton_sql_read_finish(sqlite3 *db, int cached, int failed);
static int baton_sql_busy(void *context, int tries);
'''

JSON_STUB = '''static void baton_sql_json_pretty(sqlite3_context *context, int argc, sqlite3_value **argv) {
  if (argc > 0) sqlite3_result_value(context, argv[0]);
}
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


def struct_block(lines, needle, closing):
    start = next(i for i, line in enumerate(lines)
                 if line.startswith('typedef struct {')
                 and needle in lines[i + 1])
    end = next(i for i in range(start, len(lines))
               if lines[i].startswith(closing))
    return ''.join(lines[start:end + 1])


def build_fixture():
    SCRATCH.mkdir(parents=True, exist_ok=True)
    lines = SQLITE_C.read_text().splitlines(keepends=True)
    begin = next(i for i, line in enumerate(lines)
                 if '/* BATON SQL READ CACHE BEGIN */' in line)
    end = next(i for i, line in enumerate(lines)
               if '/* BATON SQL READ CACHE END */' in line)
    combined = SCRATCH / 'sqlite-span-cache-combined.c'
    combined.write_text(
        PRELUDE
        + struct_block(lines, 'char *path, *spool, *sql, *text, *text2, *output, *error;',
                       '} BatonSqlSpan;')
        + PROTOTYPES
        + JSON_STUB
        + function_block(lines, 'static int baton_sql_span_row')
        + function_block(lines, 'static void baton_sql_span_call')
        + function_block(lines, 'static void baton_sql_span_release')
        + struct_block(lines, 'char *path, *sql, *output, *error;', '} BatonSql;')
        + function_block(lines, 'static int baton_sql_row')
        + function_block(lines, 'static int baton_sql_busy')
        + ''.join(lines[begin + 1:end])
        + DRIVER.read_text())
    result = subprocess.run(
        [os.environ.get('CC', 'cc'), '-Wall', '-Wextra', '-O2', '-pthread',
         '-DBATON_SQL_READ_TEST', str(combined), '-lsqlite3', '-o', str(FIXTURE)],
        capture_output=True, text=True)
    if result.returncode:
        raise AssertionError(result.stdout + result.stderr)


class SpanCache(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        build_fixture()
        cls.work = SCRATCH / 'sqlite-span-cache-work'
        cls.work.mkdir(parents=True, exist_ok=True)
        cls.db1 = cls.work / 'one.db'
        cls.db2 = cls.work / 'two.db'
        for path, rows in ((cls.db1, 1), (cls.db2, 2)):
            if path.exists():
                path.unlink()
            connection = sqlite3.connect(path)
            connection.execute('CREATE TABLE t(x INTEGER);')
            connection.executemany('INSERT INTO t(x) VALUES(?);',
                                   [(value,) for value in range(rows)])
            connection.commit()
            connection.close()
        cls.spool = cls.work / 'frame'
        cls.spool.write_bytes(b'payload')

    def test_span_query_reuses_read_connection(self):
        result = subprocess.run(
            [str(FIXTURE), str(self.db1), str(self.db2), str(self.spool)],
            capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        match = re.search(r'FIRST_OUTPUT=(.*?)FIRST_OUTPUT_END', result.stdout, re.S)
        self.assertIsNotNone(match, result.stdout)
        self.assertEqual(match.group(1), '7\t1\n')
        match = re.search(r'SECOND_OUTPUT=(.*?)SECOND_OUTPUT_END', result.stdout, re.S)
        self.assertIsNotNone(match, result.stdout)
        self.assertEqual(match.group(1), '7\t1\n')
        match = re.search(r'THIRD_OUTPUT=(.*?)THIRD_OUTPUT_END', result.stdout, re.S)
        self.assertIsNotNone(match, result.stdout)
        self.assertEqual(match.group(1), '7\t2\n')
        cache_live = int(re.search(r'^CACHE_LIVE=(\d+)$', result.stdout, re.M).group(1))
        cache_after = int(re.search(r'^CACHE_LIVE_AFTER=(\d+)$', result.stdout, re.M).group(1))
        first = int(re.search(r'^FIRST_RCHAR=(\d+)$', result.stdout, re.M).group(1))
        second = int(re.search(r'^SECOND_RCHAR=(\d+)$', result.stdout, re.M).group(1))
        self.assertEqual(cache_live, 1)
        self.assertEqual(cache_after, 1)
        self.assertLessEqual(second, first)
        self.assertLess(second, 8192)
        print('evidence', result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
