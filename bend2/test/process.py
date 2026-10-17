"""Exercise native process effects against operating-system processes."""
import json
import pathlib
import subprocess
import sys
import tempfile
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/process-test'

class Process(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.scratch/bend2')
        self.cwd = pathlib.Path(self.temp.name)
        self.log = self.cwd / 'stderr.log'

    def tearDown(self):
        self.temp.cleanup()

    def run_child(self, *args, mode='run', cwd=None):
        return subprocess.run([str(EXE), mode, str(cwd or self.cwd), str(self.log), *args],
                              text=True, capture_output=True)

    def test_argv_is_exact_including_empty_elements(self):
        args = ['a space', '', 'a\x1fseparator', 'line\nbreak', 'quote"', '🙂']
        p = self.run_child(sys.executable, '-c', 'import json,sys; print(json.dumps(sys.argv[1:]))', *args)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(json.loads(p.stdout.splitlines()[0]), args)
        self.assertTrue(p.stdout.endswith('exit 0\n'))

    def test_stderr_cannot_fill_an_unread_pipe(self):
        p = self.run_child(sys.executable, '-c', 'import sys; sys.stderr.write("error"*100000); print("complete")')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, 'complete\nexit 0\n')
        self.assertEqual(self.log.read_text(), 'error' * 100000)

    def test_invalid_cwd_does_not_run_in_the_callers_directory(self):
        marker = self.cwd / 'should-not-exist'
        p = self.run_child(sys.executable, '-c', 'import pathlib,sys;pathlib.Path(sys.argv[1]).touch()',
                           str(marker), cwd=self.cwd / 'missing')
        self.assertNotEqual(p.returncode, 0)
        self.assertFalse(marker.exists())
        self.assertIn('No such file', p.stderr)

    def test_spawn_and_write_errors_are_failures(self):
        p = self.run_child(str(self.cwd / 'missing-program'))
        self.assertNotEqual(p.returncode, 0)
        p = self.run_child('/usr/bin/true', mode='closed')
        self.assertNotEqual(p.returncode, 0)
        self.assertIn('Bad file descriptor', p.stderr)

    def test_wait_retains_signal_and_exit_distinction(self):
        p = self.run_child(sys.executable, '-c', 'raise SystemExit(143)')
        self.assertEqual(p.stdout, 'exit 143\n')
        p = self.run_child(sys.executable, '-c', 'import os,signal;os.kill(os.getpid(),signal.SIGTERM)')
        self.assertEqual(p.stdout, 'signal 15\n')

    def test_large_and_empty_stdout_lines_survive(self):
        p = self.run_child(sys.executable, '-c', 'print(); print("x"*300000)')
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertEqual(p.stdout, '\n' + 'x'*300000 + '\nexit 0\n')

    def test_retained_line_span_reads_eight_mib_without_bend_string(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("x"*8388608+"\\n")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=90)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('0\t8388608\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

    def test_retained_line_spans_preserve_empty_and_unterminated_lines(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("a\\n\\nlast")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('0\t1\n2\t0\n3\t4\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

    def test_retained_line_span_waits_for_split_line_and_preserves_nul_bytes(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = ('import sys,time; sys.stdout.buffer.write(b"left\\x00mid"); '
                  'sys.stdout.flush(); time.sleep(0.05); '
                  'sys.stdout.buffer.write(b"right\\n"); sys.stdout.flush()')
        p = subprocess.Popen([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                              str(payload), 'span', sys.executable, '-c', script],
                             stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                             stderr=subprocess.PIPE, text=True)
        observed = []
        while not any(line.startswith('native-exit ') for line in observed):
            line = p.stdout.readline()
            self.assertNotEqual(line, '', 'native span reader exited before the checkpoint gate')
            observed.append(line)
        self.assertEqual((attempt / 'stdout').read_bytes(), b'left\x00midright\n')
        p.stdin.write('\n')
        p.stdin.flush()
        p.stdin.close()
        p.stdin = None
        remaining, error = p.communicate(timeout=30)
        output = ''.join(observed) + remaining
        self.assertEqual(p.returncode, 0, error)
        self.assertIn('0\t13\n', output)
        self.assertIn('native-exit 0\nretained-complete\n', output)

    def test_retained_span_recovery_replays_after_last_durable_checkpoint(self):
        db = self.cwd / 'session.db'
        db.touch()
        attempt = self.cwd / 'attempt'
        payload = self.cwd / 'input'
        payload.write_text('')
        script = 'import sys; sys.stdout.write("durable\\nnext\\n")'
        p = subprocess.run([str(EXE), 'retain', str(db), str(attempt), str(self.cwd),
                            str(payload), 'checkpoint-span', sys.executable, '-c', script],
                           text=True, capture_output=True, timeout=30)
        self.assertEqual(p.returncode, 0, p.stderr)
        self.assertIn('durable:0\t7\n', p.stdout)
        self.assertIn('uncommitted:8\t4\n', p.stdout)
        self.assertIn('restored:durable\n', p.stdout)
        self.assertIn('replay:8\t4\n', p.stdout)
        self.assertIn('native-exit 0\nretained-complete\n', p.stdout)

if __name__ == '__main__':
    unittest.main()
