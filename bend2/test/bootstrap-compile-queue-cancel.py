#!/usr/bin/env python3
"""Check bootstrap cancellation keeps the shared lock until its child exits."""
import fcntl
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = Path(__file__).resolve().parents[2]


def starttime(pid):
    fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
    return fields[19]


def wait_for(description, predicate, process, evidence, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if predicate():
            return
        if process.poll() is not None:
            raise AssertionError((description + ': bootstrap exited early', process.returncode, evidence))
        time.sleep(0.02)
    raise AssertionError((description + ': fixture did not reach its marker', evidence))


class BootstrapCancellation(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith('linux'), 'the bootstrap uses Linux process custody')
    def test_interrupt_waits_for_the_exact_background_child(self):
        evidence = Path(tempfile.mkdtemp(prefix='bootstrap-compile-queue-cancel-'))
        source = evidence / 'source'
        scripts = source / 'bend2/scripts'
        entry = source / 'bend2/src/host/compile-queue.bend'
        state = evidence / 'queue'
        fake_toolchain = evidence / 'toolchain'
        fake_compiler = fake_toolchain / 'bin/bend'
        record_root = state / 'bootstrap-runs'
        output = evidence / 'compile-queue'
        for directory in (scripts, entry.parent, state, fake_compiler.parent,
                          fake_toolchain / 'bend2'):
            directory.mkdir(parents=True, exist_ok=True)
        state.chmod(0o2770)
        entry.write_text('fixture compiler input\n')
        for name in ('bootstrap-compile-queue.sh', 'bend-lineage-guard.sh'):
            shutil.copyfile(ROOT / 'bend2/scripts' / name, scripts / name)
        (source / 'bend2/toolchain').mkdir()
        (source / 'bend2/toolchain/runtime-pin.txt').write_text(
            'lineage_commit=bootstrap-cancel-fixture\n'
            'release_name=bootstrap-cancel-fixture\n'
            'cache_ts_sha256=\n'
            'require_cgen_cache=0\n'
        )
        (fake_toolchain / 'fork-manifest.json').write_text(
            '{\n  "source_commit": "bootstrap-cancel-fixture"\n}\n'
        )
        fake_compiler.write_text('''#!/usr/bin/env python3
import os
from pathlib import Path
import signal
import sys
import time

if sys.argv[1:] == ['version']:
    print('bend 2.0.25')
    raise SystemExit(0)

root = Path(os.environ['BOOTSTRAP_CANCEL_FIXTURE'])
signal.signal(signal.SIGINT, signal.SIG_IGN)
def on_term(signum, frame):
    (root / 'term-requested').write_text(str(os.getpid()))
signal.signal(signal.SIGTERM, on_term)
lock = os.stat('/proc/self/fd/8')
(root / 'child-ready').write_text(
    f'{os.getpid()}\\n{Path(f"/proc/{os.getpid()}/stat").read_text().rsplit(")", 1)[1].split()[19]}\\n'
    f'{lock.st_dev}:{lock.st_ino}\\n{os.readlink("/proc/self/fd/8")}\\n'
)
while not (root / 'release-child').exists():
    time.sleep(0.02)
(root / 'child-exited').write_text(str(os.getpid()))
raise SystemExit(143)
''')
        fake_compiler.chmod(0o755)
        cc = shutil.which('true')
        self.assertIsNotNone(cc, evidence)
        env = dict(os.environ)
        env.update({
            'BEND': str(fake_compiler),
            'CC': cc,
            'BATON_COMPILE_QUEUE_ROOT': str(state),
            'BOOTSTRAP_CANCEL_FIXTURE': str(evidence),
            'TMPDIR': str(evidence),
        })
        stdout_log = (evidence / 'bootstrap.stdout').open('wb')
        stderr_log = (evidence / 'bootstrap.stderr').open('wb')
        process = subprocess.Popen(
            ['sh', str(scripts / 'bootstrap-compile-queue.sh'), str(output)],
            cwd=source, env=env, stdout=stdout_log, stderr=stderr_log,
            start_new_session=True,
        )
        stdout_log.close()
        stderr_log.close()
        child_pid = None
        child_starttime = None
        release = evidence / 'release-child'
        try:
            wait_for('fake compiler started', lambda: (evidence / 'child-ready').exists(),
                     process, evidence)
            ready = (evidence / 'child-ready').read_text().splitlines()
            child_pid, child_starttime, lock_identity, lock_path = ready
            self.assertEqual(child_pid, str(int(child_pid)))
            telemetry_files = list(record_root.glob('*/telemetry'))
            self.assertEqual(len(telemetry_files), 1, evidence)
            telemetry = telemetry_files[0]
            rows = dict(line.split('=', 1) for line in telemetry.read_text().splitlines()
                        if '=' in line)
            self.assertEqual(rows['child_pid'], child_pid)
            self.assertEqual(rows['child_starttime'], child_starttime)
            self.assertEqual(rows['lock_identity'], lock_identity)
            lock = state / 'heavy.lock'
            self.assertEqual(lock_path, str(lock))
            self.assertEqual(lock_identity, f'{lock.stat().st_dev}:{lock.stat().st_ino}')
            self.assertEqual(starttime(int(child_pid)), child_starttime)
            self.assert_lock_busy(lock, evidence)

            os.kill(process.pid, signal.SIGINT)
            wait_for('child cancellation requested',
                     lambda: 'child_cancel_signal=TERM\n' in telemetry.read_text(),
                     process, evidence)
            wait_for('fake compiler received TERM',
                     lambda: (evidence / 'term-requested').exists(), process, evidence)
            self.assertIsNone(process.poll(), evidence)
            self.assertEqual(starttime(int(child_pid)), child_starttime)
            self.assertFalse(release.exists())
            self.assert_lock_busy(lock, evidence)

            release.touch()
            wait_for('fake compiler exited',
                     lambda: (evidence / 'child-exited').exists(), process, evidence)
            process.wait(timeout=15)
            stdout = (evidence / 'bootstrap.stdout').read_text()
            stderr = (evidence / 'bootstrap.stderr').read_text()
            self.assertEqual(process.returncode, 130, (stdout, stderr, evidence))
            final_rows = dict(line.split('=', 1) for line in telemetry.read_text().splitlines()
                              if '=' in line)
            self.assertEqual(final_rows['cancel_signal'], 'INT')
            self.assertEqual(final_rows['child_cancel_signal'], 'TERM')
            self.assertEqual(final_rows['child_cancel_pid'], child_pid)
            self.assertEqual(final_rows['child_cancel_starttime'], child_starttime)
            self.assertEqual(final_rows['child_exit_status'], '143')
            self.assertEqual(final_rows['child_reaped'], '1')
            self.assertEqual(final_rows['terminal_status'], '130')
            self.assertEqual(final_rows['lock_identity'], lock_identity)
            scratch = Path(final_rows['retained_scratch'])
            self.assertTrue(scratch.is_dir(), (scratch, evidence))
            self.assertNotIn('retained_child_pid', final_rows)
            self.assert_lock_free(lock, evidence)
        finally:
            release.touch()
            if process.poll() is None:
                process.send_signal(signal.SIGINT)
                try:
                    process.wait(timeout=15)
                except subprocess.TimeoutExpired:
                    pass
            if child_pid and child_starttime:
                proc_stat = Path(f'/proc/{child_pid}/stat')
                if proc_stat.exists() and starttime(int(child_pid)) == child_starttime:
                    try:
                        os.kill(int(child_pid), signal.SIGTERM)
                    except ProcessLookupError:
                        pass
        print(f'evidence={evidence}')

    def assert_lock_busy(self, lock, evidence):
        fd = os.open(lock, os.O_RDWR)
        try:
            with self.assertRaises(BlockingIOError, msg=str(evidence)):
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        finally:
            os.close(fd)

    def assert_lock_free(self, lock, evidence):
        fd = os.open(lock, os.O_RDWR)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                self.fail(("bootstrap released before child exit was fully reaped", error, evidence))
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)


if __name__ == '__main__':
    unittest.main(verbosity=2)
