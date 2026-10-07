"""True owner-death regression controls for the #676 shared custody owner.

This fixture drives the owner entry blackbox (the `instance-test` binary
built from `bend2/test/instance.bend`) and kills real processes. No test
here simulates a restart by mutating an epoch or generation counter: an
owner restart means SIGKILL of the `--instance-owner` process followed by
re-election, and the assertions read the surviving native child, its birth
record, the spool file, and the checkpoint file.

Current status is WIP red controls. T1 and T2 assert the required
behavior; the identity-restoration assertions fail on the present
implementation with defect-tagged messages while the survival assertions
pass. T3, T4, and T5 pass and pin safe refusal, exact payload bytes, and
full-stream delivery after a torn checkpoint. Nothing in this file is
selectable as a landing gate until the defects it names are fixed; it
fails on the baseline tree because the owner entry does not exist there.

Defects referenced (see docs/bend2/shared-instance-676-review.md):
D1 orphan re-election cannot restore the old attempt identity.
D2 torn/oversize checkpoint records are not all classified replay.
D3 duplicate admission errors instead of reusing the live handle.
"""
import json
import os
import pathlib
import signal
import subprocess
import sys
import tempfile
import threading
import time
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
EXE = ROOT / '.scratch/bend2/instance-test'

NATIVE = r'''import json,os,sys,threading,time
print(json.dumps({"role": "native", "pid": os.getpid()}), flush=True)
def drain():
    # Survive stdin EOF: owner death closes the pipe, the child keeps running.
    try:
        for line in sys.stdin:
            print("echo:" + line.rstrip("\n"), flush=True)
    except Exception:
        pass
threading.Thread(target=drain, daemon=True).start()
count = 0
while True:
    print(f"tick:{count}", flush=True)
    count += 1
    time.sleep(1)
'''


class SharedOwner(unittest.TestCase):
    def setUp(self):
        self.assertTrue(EXE.is_file(),
                        f'owner entry missing; build it from a tree containing the owner: '
                        f'sh bend2/scripts/build-native.sh bend2/test/instance.bend {EXE}')
        self.temp = tempfile.TemporaryDirectory(prefix='b2 shared owner ')
        self.addCleanup(self.temp.cleanup)
        self.home = pathlib.Path(self.temp.name).resolve()
        self.runtime = self.home / 'runtime'
        self.runtime.mkdir()
        self.environment = dict(os.environ, XDG_RUNTIME_DIR=str(self.runtime))
        self.db = self.home / 'owner.db'
        self.db.touch()
        self.native = self.home / 'native.py'
        self.native.write_text(NATIVE)
        self.children = []
        self.native_pids = []
        self.addCleanup(self.cleanup)

    # -- harness ----------------------------------------------------------

    def spawn(self, *args):
        child = subprocess.Popen([str(EXE), *map(str, args)], stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=self.environment)
        self.children.append(child)
        child.lines = []
        child.lock = threading.Lock()

        def read():
            for line in child.stdout:
                with child.lock:
                    child.lines.append(line.rstrip('\n'))

        def read_errors():
            for line in child.stderr:
                with child.lock:
                    child.lines.append('ERR:' + line.rstrip('\n'))

        threading.Thread(target=read, daemon=True).start()
        threading.Thread(target=read_errors, daemon=True).start()
        return child

    def command(self, *args):
        return subprocess.run([str(EXE), *map(str, args)], capture_output=True,
                              text=True, timeout=30, env=self.environment)

    def wait_line(self, child, expected, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            with child.lock:
                if expected in child.lines:
                    return
            time.sleep(.05)
        with child.lock:
            self.fail(f'{expected!r} never printed; got: {child.lines!r}')

    def snapshot(self, child):
        with child.lock:
            return list(child.lines)

    def wait_tick_above(self, child, minimum, timeout=60):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            for line in self.snapshot(child):
                if line.startswith('tick:'):
                    try:
                        if int(line.split(':')[1]) > minimum:
                            return int(line.split(':')[1])
                    except ValueError:
                        pass
            time.sleep(.1)
        tail = self.snapshot(child)[-8:]
        self.fail(f'no tick above {minimum} observed; exit={child.poll()} tail={tail!r}')

    def owner_pids(self):
        result = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, timeout=10)
        found = []
        for line in result.stdout.splitlines():
            fields = line.split(None, 1)
            if len(fields) == 2 and '--instance-owner' in fields[1] and str(self.home) in fields[1]:
                found.append(int(fields[0]))
        return found

    def wait_gone(self, pid, timeout=10):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(.05)
        self.fail(f'process {pid} still alive')

    def alive(self, pid):
        try:
            os.kill(pid, 0)
            return True
        except ProcessLookupError:
            return False

    def hold(self, label, session, payload='hello\n'):
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        child = self.spawn('hold', self.db, session, directory, self.home,
                           payload, sys.executable, self.native)
        self.wait_line(child, 'admitted')
        return directory, child

    def partial(self, label, session, payload='hello\n'):
        directory = pathlib.Path(f'{self.db}.attempt-{label}')
        child = self.spawn('partial', self.db, session, directory, self.home,
                           payload, sys.executable, self.native)
        self.wait_line(child, 'admitted')
        self.wait_line(child, 'commit-ok')
        return directory, child

    def spool_text(self, directory):
        return (directory / 'stdout').read_text(errors='replace')

    def role_pid(self, directory):
        for line in self.spool_text(directory).splitlines():
            if line.startswith('{'):
                return json.loads(line)['pid']
        self.fail('no native role line in spool for ' + str(directory))

    def max_tick(self, directory):
        ticks = [int(line.split(':')[1]) for line in self.spool_text(directory).splitlines()
                 if line.startswith('tick:') and line.split(':')[1].isdigit()]
        self.assertTrue(ticks, 'no ticks in spool for ' + str(directory))
        return max(ticks)

    def wait_spool(self, directory, expected, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if expected in self.spool_text(directory):
                return
            time.sleep(.1)
        self.fail(f'{expected!r} never reached spool of {directory}')

    def role_count(self, directory):
        return sum(1 for line in self.spool_text(directory).splitlines()
                   if '"role": "native"' in line)

    def kill_owner(self):
        owners = self.owner_pids()
        self.assertTrue(owners, 'no owner process to kill')
        for pid in owners:
            os.kill(pid, signal.SIGKILL)
        for pid in owners:
            self.wait_gone(pid)
        return owners

    def sweep_home_processes(self):
        # Recovery observers are spawned by the keeper, not by this driver;
        # they must not outlive the test.
        me = os.getpid()
        result = subprocess.run(['ps', '-axo', 'pid=,command='], capture_output=True,
                                text=True, timeout=10)
        for line in result.stdout.splitlines():
            fields = line.split(None, 1)
            if len(fields) != 2 or str(self.home) not in fields[1]:
                continue
            try:
                pid = int(fields[0])
            except ValueError:
                continue
            if pid == me:
                continue
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass

    def cleanup(self):
        for child in self.children:
            try:
                if child.poll() is None:
                    child.kill()
            except (OSError, ValueError):
                pass
        for pid in self.native_pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        self.sweep_home_processes()
        self.command('shutdown', self.db)
        for pid in self.owner_pids():
            try:
                os.kill(pid, signal.SIGKILL)
            except OSError:
                pass
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and self.owner_pids():
            time.sleep(.05)
        for child in self.children:
            try:
                if child.stdin and not child.stdin.closed:
                    child.stdin.close()
            except (OSError, ValueError):
                pass
            try:
                child.wait(timeout=10)
            except subprocess.TimeoutExpired:
                pass

    def evidence(self, label, value):
        print(f'shared-owner {label} {value}', file=sys.stderr, flush=True)

    # -- tests ------------------------------------------------------------

    def test_owner_death_keeps_native_child_and_spool(self):
        directory, child = self.hold('death', 's-death')
        self.wait_spool(directory, 'tick:2')
        native = self.role_pid(directory)
        self.native_pids.append(native)
        birth_before = (directory / 'native.birth').read_bytes()
        tick_before = self.max_tick(directory)
        owners = self.kill_owner()
        self.evidence('killed-owner', owners)
        self.assertTrue(self.alive(native), 'the native child died with its owner')
        self.wait_spool(directory, 'tick:5')
        self.assertEqual(self.role_count(directory), 1,
                         'a second native child started after owner death')
        self.assertEqual((directory / 'native.birth').read_bytes(), birth_before,
                         'D1 the native birth record changed across owner death')
        self.assertEqual(self.role_pid(directory), native,
                         'D1 the surviving native identity is not the original birth')
        # Fail closed: with no owner serving the attempt, new input is refused,
        # never silently dropped.
        payload = self.home / 'late.payload'
        payload.write_bytes(b'late\n')
        refused = self.command('control-write', directory, payload)
        self.assertNotEqual(refused.returncode, 0,
                            'control-write into an unserved attempt succeeded silently')
        self.evidence('control-write-after-death-refused', refused.returncode)
        # Re-election: a new owner serves the database and an observer
        # reattaches to the surviving child.
        reattached = self.spawn('attach-owned', self.db, directory)
        self.wait_tick_above(reattached, tick_before + 2)
        reelected = self.owner_pids()
        self.assertEqual(len(reelected), 1, f'expected one re-elected owner, got {reelected}')
        self.assertNotIn(reelected[0], owners, 'the owner was not re-elected')
        self.evidence('reelected-owner', reelected[0])
        self.assertEqual(self.role_count(directory), 1,
                         're-election started a second native child')
        self.assertTrue(self.alive(native), 'the original native child is gone')
        reattached.kill()

    def test_readmitted_orphan_starts_no_second_native(self):
        directory, child = self.hold('orphan', 's-orphan')
        self.wait_spool(directory, 'tick:2')
        native = self.role_pid(directory)
        self.native_pids.append(native)
        child.kill()
        child.wait(timeout=10)
        self.kill_owner()
        second = self.spawn('hold', self.db, 's-orphan-2', directory, self.home,
                            'again\n', sys.executable, self.native)
        second.communicate(timeout=60)
        self.assertNotEqual(second.returncode, 0,
                            're-admission of an orphaned attempt with a live native must not start clean')
        self.assertEqual(self.role_count(directory), 1,
                         're-admission started a second native child')
        self.assertTrue(self.alive(native), 'the original native child is gone')
        self.evidence('readmit-exit', second.returncode)

    def test_conflicting_manifest_is_refused_without_harming_live_attempt(self):
        directory, child = self.hold('live', 's-live')
        self.wait_spool(directory, 'tick:1')
        native = self.role_pid(directory)
        self.native_pids.append(native)
        forged = pathlib.Path(f'{self.db}.attempt-forged')
        forged.mkdir()
        (forged / 'manifest').write_bytes(b'not a manifest')
        refused = self.spawn('hold', self.db, 's-forged', forged, self.home,
                             'x\n', sys.executable, self.native)
        refused.communicate(timeout=60)
        self.assertNotEqual(refused.returncode, 0, 'a garbage manifest was admitted')
        self.wait_spool(directory, 'tick:3')
        self.assertEqual(self.role_count(directory), 1, 'the live attempt was disturbed')
        self.assertTrue(self.alive(native), 'the live native child is gone')
        self.assertEqual(self.role_pid(directory), native, 'the live native identity changed')

    def test_payload_bytes_reach_native_unmutated(self):
        tricky = 'quotes "double" \'single\' \\ backslash %s λ🙂 trailing-space \nsecond line\n'
        directory, child = self.hold('bytes', 's-bytes', payload=tricky)
        for line in tricky.splitlines():
            self.wait_spool(directory, 'echo:' + line)
        payload = self.home / 'control.payload'
        payload.write_bytes('file "input" λ🙂\n'.encode('utf-8'))
        result = self.command('control-write', directory, payload)
        self.assertIn('control-write-complete', result.stdout, result.stderr)
        self.wait_spool(directory, 'echo:file "input" λ🙂')
        child.stdin.close()
        child.wait(timeout=60)
        self.evidence('bytes-exact', True)

    def test_torn_checkpoint_still_delivers_the_full_stream(self):
        directory, child = self.partial('torn', 's-torn')
        self.wait_spool(directory, 'tick:2')
        native = self.role_pid(directory)
        self.native_pids.append(native)
        checkpoint = directory / 'checkpoint'
        self.assertTrue(checkpoint.is_file(), 'partial mode did not commit a checkpoint')
        child.kill()
        child.wait(timeout=10)
        checkpoint.write_bytes(b'\x00torn-checkpoint')
        reattached = self.spawn('attach', self.db, directory)
        self.wait_tick_above(reattached, 4)
        self.assertEqual(self.role_count(directory), 1,
                         'reattachment after a torn checkpoint started a second native child')
        self.assertTrue(self.alive(native), 'the native child is gone')
        restore = [line for line in self.snapshot(reattached)
                   if line.startswith('restored:') or line.startswith('restore-failed:')]
        self.evidence('torn-restore-outcome', restore)
        reattached.kill()


if __name__ == '__main__':
    unittest.main()
