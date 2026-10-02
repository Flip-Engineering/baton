"""Check hierarchy failure observation with controlled child processes."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'hierarchy_observer', ROOT / 'bend2/scripts/accept-kimi-hierarchy.py')
DRIVER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DRIVER)
WAIT = ('import json,os,sys; print(json.dumps({"ready":os.getpid()}),flush=True); '
        'sys.stdin.read()')
FAILED = {'id': 'hierarchy-failed'}


class HierarchyObserver(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='hierarchy-observer-')
        self.out = Path(self.temporary.name)
        self.children = []

    def tearDown(self):
        for child in self.children:
            if child.stdin and not child.stdin.closed:
                child.stdin.close()
            child.wait()
            if child.stdout:
                child.stdout.close()
        self.temporary.cleanup()

    def child(self, owned=True):
        argv = [sys.executable, '-c', WAIT]
        if owned:
            argv.append(str(self.out))
        child = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.children.append(child)
        self.assertEqual(json.loads(child.stdout.readline())['ready'], child.pid)
        return child

    def row(self, wrapper, child):
        table = DRIVER.process_snapshot()
        row = {'seat': 'deepseek', 'pid': wrapper.pid, 'child_pid': child.pid,
               'started_unix': time.time(),
               'started_local': table[wrapper.pid]['started_local'],
               'child_started_local': table[child.pid]['started_local'],
               'events': str(self.out / 'deepseek.events.jsonl')}
        (self.out / 'deepseek.events.jsonl').write_text('')
        DRIVER.save(self.out / 'native-deepseek.process.json', row)
        return row

    def interrupted(self, surviving=False):
        wrapper, child = self.child(), self.child()
        row = self.row(wrapper, child)
        wrapper.terminate()
        wrapper.wait()
        if not surviving:
            child.stdin.close()
            child.wait()
        return row, child

    def test_interrupted_wrapper_closes_failure_and_preserves_unknown_raw_record(self):
        row, _ = self.interrupted()
        path = self.out / 'native-deepseek.process.json'
        before = path.read_bytes()
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertTrue(inspection['checked'])
        self.assertEqual(inspection['processes'], [])
        self.assertTrue(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))
        closure = json.loads((self.out / 'failure-closure.json').read_text())
        self.assertEqual(closure['status'], 'failed')
        self.assertEqual(closure['unknown_native_exits'][0]['pid'], row['pid'])
        self.assertIsNone(closure['unknown_native_exits'][0]['child_exit_code'])
        self.assertEqual(closure['process_record_sha256'][path.name], DRIVER.digest(path))
        self.assertEqual(path.read_bytes(), before)

    def test_surviving_child_blocks_closure_until_its_actual_exit(self):
        row, child = self.interrupted(surviving=True)
        known = {}
        inspection = DRIVER.inspect_processes(self.out, [row], known)
        observed = next(process for process in inspection['processes'] if process['pid'] == child.pid)
        self.assertEqual(observed['started_local'], row['child_started_local'])
        self.assertTrue(observed['active'])
        self.assertFalse(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))
        self.assertFalse((self.out / 'failure-closure.json').exists())
        child.stdin.close()
        child.wait()
        inspection = DRIVER.inspect_processes(self.out, [row], known)
        self.assertTrue(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))

    def test_failed_process_inspection_cannot_establish_absence(self):
        row, _ = self.interrupted()
        failed = subprocess.run([sys.executable, '-c',
            'import sys; sys.stderr.write("fixture inspection failed"); sys.exit(7)'],
            capture_output=True, text=True)
        with mock.patch.object(DRIVER.subprocess, 'run', return_value=failed):
            inspection = DRIVER.inspect_processes(self.out, [row], {})
            self.assertFalse(inspection['checked'])
            self.assertIn('fixture inspection failed', inspection['error'])
            self.assertFalse(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))
            with self.assertRaisesRegex(RuntimeError, 'inspection failed'):
                DRIVER.observe_tool(self.out)
        self.assertFalse((self.out / 'failure-closure.json').exists())

    def test_changed_start_identity_does_not_claim_an_unrelated_live_process(self):
        child = self.child(owned=False)
        row = {'seat': 'deepseek', 'pid': child.pid, 'started_local': 'prior process identity',
               'started_unix': time.time()}
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertTrue(inspection['checked'])
        self.assertEqual(inspection['processes'], [])
        self.assertEqual(inspection['uncertain'], [])
        self.assertIsNone(child.poll())
        self.assertTrue(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))

    def test_unavailable_start_identity_does_not_establish_absence(self):
        child = self.child(owned=False)
        row = {'seat': 'deepseek', 'pid': child.pid, 'started_unix': time.time()}
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertTrue(inspection['checked'])
        self.assertEqual(inspection['processes'], [])
        self.assertEqual(inspection['uncertain'][0]['pid'], child.pid)
        self.assertFalse(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))

    def test_stale_tool_event_cannot_claim_an_active_child(self):
        row, _ = self.interrupted()
        Path(row['events']).write_text(json.dumps({'type': 'tool_execution_start'}) + '\n')
        before = (self.out / 'native-deepseek.process.json').read_bytes()
        with self.assertRaisesRegex(RuntimeError, 'no observed active native child'):
            DRIVER.observe_tool(self.out)
        self.assertFalse((self.out / 'guidance-observation.json').exists())
        self.assertEqual((self.out / 'native-deepseek.process.json').read_bytes(), before)

    def test_absent_child_without_event_reports_unknown_completion(self):
        self.interrupted()
        with self.assertRaisesRegex(RuntimeError, 'completion receipts are unknown'):
            DRIVER.observe_tool(self.out)

    def test_another_live_seat_cannot_keep_absent_deepseek_waiting(self):
        self.interrupted()
        other = self.child()
        self.assertIsNone(other.poll())
        with self.assertRaisesRegex(RuntimeError, 'completion receipts are unknown'):
            DRIVER.observe_tool(self.out)

    def test_active_child_tool_event_retains_actual_process_identity(self):
        wrapper, child = self.child(), self.child()
        row = self.row(wrapper, child)
        Path(row['events']).write_text(json.dumps({'type': 'tool_execution_start'}) + '\n')
        with contextlib.redirect_stdout(io.StringIO()):
            DRIVER.observe_tool(self.out)
        proof = json.loads((self.out / 'guidance-observation.json').read_text())
        observed = next(process for process in proof['inspection']['processes'] if process['pid'] == child.pid)
        self.assertEqual(observed['started_local'], row['child_started_local'])
        self.assertTrue(observed['active'])

    def test_unknown_receipts_cannot_accept_a_success_terminal(self):
        row, _ = self.interrupted()
        row.update(exit_code=0, ended_unix=time.time())
        DRIVER.save(self.out / 'native-deepseek.process.json', row)
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertFalse(DRIVER.close_failed_run(self.out, {'id': 'hierarchy-complete'}, [row], inspection))
        with self.assertRaises(AssertionError):
            DRIVER.verify(self.out, {'sessions': [], 'messages': []}, {}, None)
        self.assertFalse((self.out / 'failure-closure.json').exists())

    def test_native_wrapper_retains_start_identities_and_successful_receipts(self):
        DRIVER.save(self.out / 'run.json', {'routes': {'omp': {'executable': sys.executable}}})
        code = 'import json,sys; print(json.dumps({"type":"tool_execution_start"}),flush=True); sys.stdin.read()'
        wrapper = subprocess.Popen([sys.executable, str(DRIVER.__file__), 'native', 'deepseek',
            str(self.out), '-c', code, str(self.out)], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
        self.children.append(wrapper)
        self.assertEqual(json.loads(wrapper.stdout.readline())['type'], 'tool_execution_start')
        row = DRIVER.records(self.out)[0]
        self.assertTrue(row['started_local'])
        self.assertTrue(row['child_started_local'])
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertTrue(any(process['pid'] == row['child_pid'] for process in inspection['processes']))
        wrapper.stdin.close()
        self.assertEqual(wrapper.wait(), 0)
        self.assertTrue(DRIVER.successful_receipts(DRIVER.records(self.out)))


if __name__ == '__main__':
    unittest.main()
