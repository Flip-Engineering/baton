"""Deterministic inotify queue-overflow dispatch regression.

Linux reports a dropped-event queue as one IN_Q_OVERFLOW event with wd -1.
The shared spool watcher must notify every ready observer to reread its spool,
coalesce with an already queued change, defer notices for unready observers,
and leave attempts without a client untouched. The fixture injects that event directly, so the result does not depend
on exhausting the kernel queue.
"""
import json
import os
import pathlib
import subprocess
import sys
import unittest

import compile_queue

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROCESS_C = ROOT / '.scratch/bend2/process-test.c'
SOURCE = ROOT / 'bend2/test/spool-watch-overflow.c'
FIXTURE = ROOT / '.scratch/bend2/spool-watch-overflow'


@unittest.skipUnless(sys.platform.startswith('linux'), 'inotify overflow is Linux-specific')
class SpoolWatchOverflow(unittest.TestCase):
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
        compiler = os.environ.get('CC', 'clang')
        compile_queue.compile_cc([
            compiler, '-O1', '-pthread',
            '-DBATON2_PROCESS_SOURCE=' + json.dumps(str(PROCESS_C)),
            str(SOURCE), '-lsqlite3', '-lm', '-o', str(FIXTURE),
        ], inputs=[SOURCE, PROCESS_C], output=FIXTURE, cwd=ROOT, compiler=compiler)

    def test_overflow_notifies_every_ready_keeper(self):
        result = subprocess.run([str(FIXTURE)], capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('spool-watch-overflow PASS ready=2 coalesced=1 unready-deferred=1 detached=0 final=a,b,u', result.stdout)
        print('evidence', result.stdout.strip())


if __name__ == '__main__':
    unittest.main()
