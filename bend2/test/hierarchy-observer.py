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

    def coordinator(self, muse_harness):
        routes = {'omp': {'model': 'deepseek/deepseek-flash', 'effort': 'low'},
                  'muse': {'model': 'muse-spark-1.3-contributor', 'effort': 'low'}}
        DRIVER.save(self.out / 'run.json', {'routes': routes})
        DRIVER.save(self.out / 'sessions.json',
                    {'deepseek': {'harness': 'omp'}, 'muse': {'harness': muse_harness}})
        (self.out / 'lead').mkdir()
        cli = self.out / 'baton2'
        cli.write_text('#!' + sys.executable + '\n' + '''import json,sys
from pathlib import Path
out=Path(__file__).parent
with (out/'cli.calls.jsonl').open('a') as log:
    log.write(json.dumps(sys.argv[1:])+'\\n')
if sys.argv[2]=='session':
    print(json.dumps(json.loads((out/'sessions.json').read_text())[sys.argv[3]]))
elif sys.argv[2]=='turn':
    (out/(sys.argv[3]+'.turn.argv.json')).write_text(json.dumps(sys.argv))
else:
    sys.exit(2)
''')
        cli.chmod(0o700)
        return routes

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

    def test_an_unregistered_command_mentioning_output_path_is_not_owned(self):
        row, _ = self.interrupted()
        other = self.child()
        inspection = DRIVER.inspect_processes(self.out, [row], {})
        self.assertEqual(inspection['processes'], [])
        self.assertIsNone(other.poll())
        self.assertTrue(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))

    def test_recorded_seed_and_worker_launchers_block_whole_run_closure(self):
        row, _ = self.interrupted()
        seed, worker = self.child(owned=False), self.child(owned=False)
        table = DRIVER.process_snapshot()
        DRIVER.save(self.out / 'seed-process.json',
                    {'pid': seed.pid, 'started_local': table[seed.pid]['started_local']})
        DRIVER.save(self.out / 'worker-launches.json',
                    [{'seat': 'muse', 'pid': worker.pid, 'started_local': table[worker.pid]['started_local']}])
        known = {}
        inspection = DRIVER.inspect_processes(self.out, [row], known)
        self.assertEqual({process['pid'] for process in inspection['processes']}, {seed.pid, worker.pid})
        self.assertFalse(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))
        for child in (seed, worker):
            child.stdin.close()
            child.wait()
        inspection = DRIVER.inspect_processes(self.out, [row], known)
        self.assertTrue(DRIVER.close_failed_run(self.out, FAILED, [row], inspection))

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

    def test_recorded_muse_harness_mismatch_refuses_before_either_worker_launch(self):
        self.coordinator('omp')
        with self.assertRaisesRegex(RuntimeError, "muse has recorded harness 'omp'; expected 'muse'"):
            DRIVER.start_workers(self.out)
        calls = [json.loads(line) for line in (self.out / 'cli.calls.jsonl').read_text().splitlines()]
        self.assertTrue(calls)
        self.assertTrue(all(call[1] == 'session' for call in calls))
        self.assertEqual(json.loads((self.out / 'sessions.json').read_text())['muse']['harness'], 'omp')
        self.assertFalse((self.out / 'worker-launches.json').exists())
        self.assertFalse(list(self.out.glob('*.turn.argv.json')))
        self.assertFalse(list(self.out.glob('*.command.log')))

    def test_matching_recorded_harnesses_preserve_native_launch_arguments(self):
        routes = self.coordinator('muse')
        original = subprocess.Popen
        launched = []

        def launch(argv, *args, **kwargs):
            child = original(argv, *args, **kwargs)
            if len(argv) > 2 and argv[2] == 'turn':
                launched.append(child)
                self.children.append(child)
            return child

        with mock.patch.object(DRIVER.subprocess, 'Popen', side_effect=launch):
            with contextlib.redirect_stdout(io.StringIO()):
                DRIVER.start_workers(self.out)
        for child in launched:
            self.assertEqual(child.wait(), 0)
        saved = {row['seat']: row for row in json.loads((self.out / 'worker-launches.json').read_text())}
        self.assertEqual(set(saved), {'deepseek', 'muse'})
        for seat, route in [('deepseek', routes['omp']), ('muse', routes['muse'])]:
            expected = [str(self.out / 'baton2'), str(self.out / 'state.db'), 'turn', seat,
                        seat + '-turn', str(self.out / (seat + '-native')), route['model'], route['effort'],
                        str(self.out / seat), str(self.out / (seat + '.md')), str(self.out / (seat + '.jsonl')), '']
            received = json.loads((self.out / (seat + '.turn.argv.json')).read_text())
            self.assertEqual(received, expected)
            self.assertEqual(saved[seat]['argv'], received)


if __name__ == '__main__':
    unittest.main()
