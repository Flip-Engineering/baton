"""The example notify command appends each seat event as one JSON line.

docs/bend2/examples/notify-append.py reads one seat event on stdin and appends
it to an events file under an exclusive lock. Concurrent followers must leave
one complete line per event, a new events file is readable by other users, and
input that is not one JSON object leaves the file unchanged with a nonzero exit.
"""
import json
import os
import pathlib
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / 'docs/bend2/examples/notify-append.py'


class NotifyAppend(unittest.TestCase):
    def setUp(self):
        (ROOT / '.scratch/bend2').mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.addCleanup(self.temp.cleanup)
        self.events = pathlib.Path(self.temp.name) / 'events.jsonl'

    def start(self, umask=None):
        return subprocess.Popen([sys.executable, '-I', str(SCRIPT), str(self.events)],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                preexec_fn=(lambda: os.umask(umask)) if umask is not None else None)

    def test_concurrent_events_each_become_one_complete_line(self):
        # Each line is larger than a pipe buffer and arrives from its own process.
        events = [{'type': 'baton-seat-event', 'event': 'message', 'seq': index,
                   'body': ('line %d\n' % index) * 20000 + 'λ🙂'} for index in range(24)]
        processes = [self.start() for event in events]
        for process, event in zip(processes, events):
            process.stdin.write(json.dumps(event, indent=2).encode('utf-8'))
            process.stdin.close()
        for process in processes:
            self.assertEqual(process.wait(), 0, process.stderr.read())
            process.stdout.close()
            process.stderr.close()
        lines = self.events.read_bytes().decode('utf-8').split('\n')
        self.assertEqual(lines[-1], '')
        written = [json.loads(line) for line in lines[:-1]]
        self.assertEqual(sorted(written, key=lambda event: event['seq']), events)

    def test_a_new_events_file_is_readable_by_other_users(self):
        process = self.start(umask=0o077)
        process.communicate(b'{"event":"blocked","seat":"s"}\n')
        self.assertEqual(process.returncode, 0)
        self.assertEqual(stat.S_IMODE(self.events.stat().st_mode), 0o644)
        self.assertEqual(self.events.read_text(), '{"event":"blocked","seat":"s"}\n')

    def test_input_that_is_not_one_json_object_is_refused(self):
        self.events.write_text('{"event":"kept"}\n')
        for text in (b'', b'{"event":', b'[1]', b'{"a":1}\n{"b":2}\n'):
            process = self.start()
            _, error = process.communicate(text)
            self.assertNotEqual(process.returncode, 0, text)
            self.assertIn(b'notify-append:', error)
        self.assertEqual(self.events.read_text(), '{"event":"kept"}\n')


if __name__ == '__main__':
    unittest.main()
