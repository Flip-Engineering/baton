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
            cwd=ROOT)
        if result.returncode:
            raise AssertionError('Guidance fixture build exited ' + str(result.returncode))

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
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            observed = [line for line in result.stdout.splitlines() if line.endswith(':ok')]
            self.assertIn('unfixed cursor duplicates:ok', observed)
            self.assertIn('next unforwarded input:ok', observed)
            self.assertIn('pending queue preserved:ok', observed)
            print(json.dumps({'test': self.id(), 'probeExit': result.returncode,
                              'checks': observed, 'stderr': result.stderr}))

    def forwarded(self, harness, scenario):
        with tempfile.TemporaryDirectory(prefix='read-guidance-', dir=ROOT / '.scratch/bend2') as name:
            directory = pathlib.Path(name)
            attempt = directory / 'attempt'
            attempt.mkdir()
            result = subprocess.run(
                [str(PROBE), 'forward', str(directory / 'state.db'), str(attempt), harness, scenario],
                capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            lines = result.stdout.splitlines()
            self.assertEqual(lines[-1], 'exit 0', result.stdout + result.stderr)
            return [json.loads(line) for line in lines[:-1]]

    def test_read_omp_task_is_not_sent_on_repeated_observer_wakes(self):
        self.assertEqual(self.forwarded('omp', 'read'), [])

    def test_read_claude_task_is_not_sent_on_repeated_observer_wakes(self):
        self.assertEqual(self.forwarded('claude-code', 'read'), [])

    def test_new_omp_input_is_complete_and_stops_after_its_read(self):
        content = 'Message (guidance) from root [id: new]:\nnew complete input\nsecond line'
        self.assertEqual(self.forwarded('omp', 'new'), [
            {'type': 'steer', 'id': 'new', 'message': content}])

    def test_new_claude_input_is_complete_and_stops_after_its_read(self):
        content = 'Message (guidance) from root [id: new]:\nnew complete input\nsecond line'
        self.assertEqual(self.forwarded('claude-code', 'new'), [
            {'type': 'user', 'message': {'role': 'user', 'content': content}}])


if __name__ == '__main__':
    unittest.main()
