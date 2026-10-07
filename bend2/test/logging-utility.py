"""Retained-utility checks on a real OMP provider spool excerpt.

The spool fixture holds 350 verbatim frames from a closed native OMP turn:
344 message_update deltas for two assistant identities, both message_end
frames, one tool_execution stream with its end, and the turn_end frame.
Local paths were normalized to /fixture-home; frame structure is unchanged.

The open-stream fixture holds the first 60 message_update frames of one
assistant identity with no closing frame, which models an interrupted turn.
"""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/baton2'
SPOOL = ROOT / 'bend2/test/fixtures/logging-utility-spool.jsonl'
OPEN_STREAM = ROOT / 'bend2/test/fixtures/logging-utility-open-stream.jsonl'


class LoggingUtility(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd = pathlib.Path(self.temp.name)
        self.db = self.cwd / 'state.db'
        self.task = self.cwd / 'task.txt'
        self.task.write_text('Logging utility task.')
        self.log = self.cwd / 'turn.jsonl'
        self.events = self.cwd / 'events.jsonl'
        self.player = self.cwd / 'fixture-harness'
        self.repo = self.cwd / 'repository'
        self.repo.mkdir()
        self.checkouts = self.cwd / 'checkouts'
        self.checkouts.mkdir()
        for argv in (['init', '-q', '-b', 'main'], ['config', 'user.email', 'fixture@example.invalid'],
                     ['config', 'user.name', 'Log fixture']):
            subprocess.run(['git', '-C', str(self.repo), *argv], check=True, capture_output=True)
        (self.repo / 'seed.txt').write_text('seed\n')
        subprocess.run(['git', '-C', str(self.repo), 'add', 'seed.txt'], check=True, capture_output=True)
        subprocess.run(['git', '-C', str(self.repo), 'commit', '-q', '-m', 'seed'], check=True, capture_output=True)
        self.base = subprocess.run(['git', '-C', str(self.repo), 'rev-parse', 'HEAD'],
                                   check=True, capture_output=True, text=True).stdout.strip()
        self.call('attach', 'root', 'native-fixture', 'root-session', 'root-endpoint')
        self.call('role', 'root', 'principal-conductor')
        self.call('recruit', 'omp-worker', 'root', 'omp', 'model', 'low', str(self.repo),
                  'omp-worker-branch', str(self.checkouts / 'omp-worker'), self.base)

    def tearDown(self): self.temp.cleanup()

    def call(self, *args):
        p = subprocess.run([str(EXE), str(self.db), *args], text=True, capture_output=True, timeout=60)
        self.assertEqual(p.returncode, 0, p.stderr)
        return p.stdout

    def stream(self, text, turn='turn-1'):
        """Run one turn over the given native stream text."""
        self.events.write_text(text)
        self.player.write_text('#!' + sys.executable + '\n' + '''import pathlib,sys
sys.stdin.readline()
sys.stdin.readline()
sys.stdin.readline()
print(pathlib.Path('events.jsonl').read_text(),end='',flush=True)
assert sys.stdin.read()==''
sys.exit(0)
''')
        self.player.chmod(0o700)
        return self.call('turn', 'omp-worker', turn, str(self.player), 'model', 'low',
                         str(self.cwd), str(self.task), str(self.log), '')

    def retained(self):
        return self.log.read_text().splitlines()

    def test_real_spool_drops_updates_and_keeps_ends(self):
        spool = SPOOL.read_text()
        self.stream(spool)
        kept = self.retained()
        frames = [json.loads(line) for line in spool.splitlines()]
        ends = [line for line, frame in zip(spool.splitlines(), frames)
                if frame.get('type') in ('message_end', 'tool_execution_start',
                                         'tool_execution_end', 'turn_end')]
        self.assertTrue(len(ends) > 0, 'fixture holds no end frames')
        for line in ends:
            self.assertIn(line, kept)
        updates = [line for line in kept if json.loads(line).get('type') == 'message_update']
        self.assertEqual(updates, [])

    def test_real_spool_newest_tool_update_survives_its_end(self):
        spool = SPOOL.read_text()
        self.stream(spool)
        kept = self.retained()
        last = None
        for line in spool.splitlines():
            frame = json.loads(line)
            if frame.get('type') == 'tool_execution_update':
                last = line
        self.assertIsNotNone(last, 'fixture holds no tool update')
        self.assertIn(last, kept)

    def test_real_spool_retention_ratio(self):
        spool = SPOOL.read_text()
        self.stream(spool)
        self.assertLess(self.log.stat().st_size * 2, len(spool.encode('utf-8')))

    def test_open_stream_flushes_newest_update_at_turn_end(self):
        text = OPEN_STREAM.read_text()
        self.stream(text)
        kept = self.retained()
        updates = [line for line in kept if json.loads(line).get('type') == 'message_update']
        newest = text.splitlines()[-1]
        self.assertEqual(updates, [newest])


if __name__ == '__main__':
    unittest.main()
