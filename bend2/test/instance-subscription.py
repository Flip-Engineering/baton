"""Subscription cleanup releases active and queued native notice readers."""
import json
import os
import pathlib
import shlex
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]


class InstanceSubscription(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='baton-subscription-')
        cls.binary = pathlib.Path(cls.temp.name) / 'subscription'
        command = [*shlex.split(os.environ.get('CC', 'clang')), '-std=c11',
                   '-D_GNU_SOURCE', '-O1', '-pthread',
                   '-DBATON2_PROCESS_SOURCE=' + json.dumps(str(ROOT / '.scratch/bend2/process-test.c')),
                   str(ROOT / 'bend2/test/instance-subscription.c'),
                   '-lsqlite3', '-lm', '-o', str(cls.binary)]
        built = subprocess.run(command, capture_output=True)
        if built.returncode:
            raise RuntimeError(f'{command!r}\n{built.stdout.decode()}\n{built.stderr.decode()}')

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def check_notice(self, mode, expected):
        result = subprocess.run([str(self.binary), mode], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        self.assertEqual(result.stdout, expected)
        self.assertEqual(result.stderr, b'')

    def test_unsubscribe_releases_a_read_waiting_for_the_remaining_frame(self):
        self.check_notice('blocked', b'blocked-notice-returned\n')

    def test_queued_notice_survives_unsubscribe_and_preserves_a_new_subscription(self):
        self.check_notice('queued', b'queued-notice-returned-replacement-intact\n')

    def test_complete_notice_preserves_cursor_and_generation(self):
        self.check_notice('notice', b'{"kind":"commit","cursor":41,"generation":23}\n')


if __name__ == '__main__':
    unittest.main()
