"""A rejected observer checkpoint must not replay input already forwarded.

The host rewinds a retained reader to the spool start when the committed
reducer state is unusable or rejected, and the caller replays the observation
frames. Before this repair the replay also reset the input cursor to 0 and
forwarded the same pending steer frame to native stdin again. The probe seeds a
scratch database, records that this attempt already forwarded a report, then
replays from cursor 0 and asserts the forwarded message is never selected
again, the next owed input is selected, and a fresh attempt can select each
pending input kind.
"""
import json
import pathlib
import subprocess
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
PROBE = ROOT / '.scratch/bend2/pending-guidance-replay'


class PendingGuidanceReplay(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        result = subprocess.run(
            ['sh', 'bend2/scripts/build-native.sh',
             'bend2/test/pending-guidance-replay.bend', str(PROBE)],
            cwd=ROOT, capture_output=True, text=True)
        if result.returncode:
            raise AssertionError(result.stdout + result.stderr)

    def test_replay_skips_forwarded_input_and_keeps_the_pending_queue(self):
        with tempfile.TemporaryDirectory(prefix='pending-guidance-', dir=ROOT / '.scratch/bend2') as name:
            directory = pathlib.Path(name)
            attempt = directory / 'attempt'
            fresh = directory / 'fresh'
            attempt.mkdir()
            fresh.mkdir()
            database = directory / 'state.db'
            result = subprocess.run(
                [str(PROBE), str(database), str(attempt), str(fresh)],
                capture_output=True, text=True, timeout=120)
            self.assertEqual(result.returncode, 0, result.stderr)
            observed = [line for line in result.stdout.splitlines() if line.endswith(':ok')]
            self.assertEqual(len(observed), 8, result.stdout)
            self.assertIn('unfixed cursor duplicates:ok', observed)
            self.assertIn('next unforwarded input:ok', observed)
            self.assertIn('pending queue preserved:ok', observed)
            print(json.dumps({'test': self.id(), 'probeExit': result.returncode,
                              'checks': observed, 'stderr': result.stderr}))


if __name__ == '__main__':
    unittest.main()
