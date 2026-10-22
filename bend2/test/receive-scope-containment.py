"""A bounded receive keeps its native and later descendants in the launcher cgroup."""
import json
import os
import pathlib
import subprocess
import sys
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import receive


def receiver_executable():
    return pathlib.Path(os.environ.get('BATON_RECEIVE_CANDIDATE') or str(receive.EXE)).resolve()


def process_cgroup(pid):
    for line in pathlib.Path(f'/proc/{pid}/cgroup').read_text().splitlines():
        if line.startswith('0::'):
            return line[3:]
    raise AssertionError(f'process {pid} has no cgroup v2 membership')


def process_stat(pid):
    return pathlib.Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()


def process_ppid(pid):
    return int(process_stat(pid)[1])


def process_alive(pid):
    try:
        return not process_stat(pid)[0].startswith('Z')
    except OSError:
        return False


def process_cmdline(pid):
    return pathlib.Path(f'/proc/{pid}/cmdline').read_bytes().replace(b'\0', b' ').decode(errors='replace')


def current_scope():
    path = process_cgroup(os.getpid())
    if not path.startswith('/'):
        return None
    root = pathlib.Path('/sys/fs/cgroup') / path.lstrip('/')
    try:
        maximum = (root / 'memory.max').read_text().strip()
        swap = (root / 'memory.swap.max').read_text().strip()
    except OSError:
        return None
    if maximum in ('', 'max'):
        return None
    return {'path': path, 'root': root, 'memory_max': maximum, 'swap_max': swap}


class ScopeContainmentTests(receive.Receive):
    def spawn_receiver(self, *args):
        receiver = receiver_executable()
        child = subprocess.Popen([str(receiver), str(self.db), *map(str, args)],
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        self.children.append(child)
        return child

    def assert_scope_members(self, pids, scope):
        for pid in pids:
            self.assertEqual(process_cgroup(pid), scope['path'],
                             f'process {pid} left the admitted cgroup')
            self.assertEqual((scope['root'] / 'memory.max').read_text().strip(),
                             scope['memory_max'], 'memory.max changed during the receive')
            self.assertEqual((scope['root'] / 'memory.swap.max').read_text().strip(),
                             scope['swap_max'], 'memory.swap.max changed during the receive')

    def test_bounded_receive_keeps_native_and_child_in_launcher_scope(self):
        scope = current_scope()
        if scope is None:
            self.skipTest('run this check inside a cgroup with a finite memory.max')
        receiver = receiver_executable()
        if not receiver.exists():
            self.skipTest(f'receiver not built at {receiver}')
        self.player(harness='omp')
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        self.prepare_input('scope-task', 'parent',
                           'Keep the native and its child in the admitted cgroup.', kind='task')
        observer = self.spawn_receiver(*self.receive_args('parent'))
        control, started = self.accept_child(observer, 'parent')
        native = started['pid']
        self.action(control, spawn_child=True)
        child = json.loads(control.readline())['child_pid']
        keeper = process_ppid(native)
        self.assertIn('--host-process-keeper', process_cmdline(keeper),
                      'the native was not started by a launcher-local keeper')
        self.assertNotIn('--instance-owner', process_cmdline(keeper),
                         'the shared database owner started the native')
        self.assert_scope_members([observer.pid, keeper, native, child], scope)
        owners = [process for process in self.owned_processes()
                  if ' --instance-owner ' in process['command']]
        owner_scopes = {process['pid']: process_cgroup(process['pid']) for process in owners}
        self.assertNotIn(keeper, owner_scopes)
        observer.kill()
        observer.wait(timeout=10)
        self.assertFalse(process_alive(observer.pid), 'the launcher did not exit')
        deadline = time.monotonic() + 5
        while time.monotonic() < deadline and not (process_alive(native) and process_alive(child)):
            time.sleep(.01)
        self.assertTrue(process_alive(native), 'the native did not remain after the launcher exited')
        self.assertTrue(process_alive(child), 'the spawned child did not remain after the launcher exited')
        self.assertEqual(process_ppid(native), keeper, 'the retained keeper changed')
        self.assert_scope_members([native, child], scope)
        for pid, before in owner_scopes.items():
            self.assertEqual(process_cgroup(pid), before,
                             'the shared database owner changed cgroups')


def _suite():
    suite = unittest.TestSuite()
    suite.addTest(ScopeContainmentTests('test_bounded_receive_keeps_native_and_child_in_launcher_scope'))
    return suite


if __name__ == '__main__':
    result = unittest.TextTestRunner(verbosity=2).run(_suite())
    raise SystemExit(not result.wasSuccessful())
