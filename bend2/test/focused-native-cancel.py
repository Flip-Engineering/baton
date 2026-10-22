"""Verify that cancelling the focused qualification launcher stops the whole child process group."""
import hashlib
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
DRIVER = ROOT / '.github/scripts/run-focused-native.py'

LAUNCHER = '''
import argparse, importlib.util, sys
spec = importlib.util.spec_from_file_location('run_focused_native', sys.argv[1])
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)
sys.executable = sys.argv[2]
driver.launch(argparse.Namespace(
    run=sys.argv[3], candidate=sys.argv[4], source=sys.argv[5], target=sys.argv[5],
    suite='observer-recovery', compiler='/bin/true', full_runtime=sys.argv[6],
    full_runtime_sha256=sys.argv[7]))
'''

# Stands in for the interpreter that runs the driver: it starts a descendant
# that outlives its parent unless the launcher stops the process group.
FAKE_INTERPRETER = '''#!/bin/sh
%s
sleep 600 &
echo "$!" > "$1.child"
echo "$$" > "$1.leader"
wait
'''


def alive(pid):
    try:
        state = pathlib.Path('/proc/%d/stat' % pid).read_text().rsplit(')', 1)[1].split()[0]
    except (FileNotFoundError, ProcessLookupError):
        return False
    return state != 'Z'


class FocusedNativeCancel(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith('linux'), 'process groups and /proc are required')
    def test_sigterm_stops_the_child_and_its_descendants(self):
        self.cancel('')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'process groups and /proc are required')
    def test_a_descendant_that_ignores_sigterm_is_killed(self):
        self.cancel("trap '' TERM")

    def cancel(self, preamble):
        with tempfile.TemporaryDirectory(prefix='focused-cancel-') as name:
            work = pathlib.Path(name)
            workspace = work / 'workspace'
            workspace.mkdir()
            git = ['git', '-C', str(workspace)]
            subprocess.run(git + ['init', '-q'], check=True)
            (workspace / 'file').write_text('x\n')
            subprocess.run(git + ['add', 'file'], check=True)
            subprocess.run(git + ['-c', 'user.name=t', '-c', 'user.email=t@example.com',
                                  'commit', '-q', '-m', 'x'], check=True)
            commit = subprocess.check_output(git + ['rev-parse', 'HEAD'], text=True).strip()
            runtime = work / 'baton-full'
            runtime.write_bytes(b'#!/bin/sh\n')
            runtime.chmod(0o755)
            sha256 = hashlib.sha256(runtime.read_bytes()).hexdigest()
            fake = work / 'fake-interpreter'
            fake.write_text((FAKE_INTERPRETER % preamble).replace('"$1.child"', '"%s/state.child"' % work)
                            .replace('"$1.leader"', '"%s/state.leader"' % work))
            fake.chmod(0o755)
            env = dict(os.environ, GITHUB_WORKSPACE=str(workspace),
                       BATON2_FOCUSED_CURRENT_MAIN=commit)
            for name_ in ('GH_TOKEN', 'GITHUB_TOKEN', 'ACTIONS_RUNTIME_TOKEN'):
                env.pop(name_, None)
            launcher = subprocess.Popen(
                [sys.executable, '-c', LAUNCHER, str(DRIVER), str(fake), str(work / 'run'),
                 str(workspace), commit, str(runtime), sha256],
                env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            try:
                child_file = work / 'state.child'
                deadline = time.monotonic() + 20
                while not child_file.exists() or not child_file.read_text().strip():
                    if launcher.poll() is not None:
                        self.fail('launcher exited early: %r' % (launcher.communicate(),))
                    self.assertLess(time.monotonic(), deadline, 'child did not start')
                    time.sleep(0.05)
                child = int(child_file.read_text())
                leader = int((work / 'state.leader').read_text())
                self.assertTrue(alive(child))
                self.assertTrue(alive(leader))
                launcher.send_signal(signal.SIGTERM)
                out, err = launcher.communicate(timeout=30)
            finally:
                if launcher.poll() is None:
                    launcher.kill()
            self.assertEqual(launcher.returncode, 128 + signal.SIGTERM, out + err)
            deadline = time.monotonic() + 10
            while (alive(child) or alive(leader)) and time.monotonic() < deadline:
                time.sleep(0.05)
            self.assertFalse(alive(leader), 'group leader survived cancellation')
            self.assertFalse(alive(child), 'descendant survived cancellation')
            dispatch = json.loads((work / 'run/evidence/dispatch.json').read_text())
            self.assertEqual(dispatch['source'], commit)


if __name__ == '__main__':
    unittest.main()
