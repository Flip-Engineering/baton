"""Recorder outcomes and fixture failure diagnosis with controlled Python processes."""
import ast
import importlib.util
import inspect
import json
import os
from pathlib import Path
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
RECORDER = Path(os.environ.get('BATON2_RECORDER', ROOT / '.github/scripts/record-native-checks.py'))
CODEX_ROOT = Path(os.environ.get('BATON2_CODEX_ROOT_FIXTURE', ROOT / 'bend2/test/codex-root.py'))
sys.path.insert(0, str(CODEX_ROOT.parent))
spec = importlib.util.spec_from_file_location('codex_root_fixture', CODEX_ROOT)
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Evidence(unittest.TestCase):
    def setUp(self):
        retained = os.environ.get('BATON2_RECORDER_EVIDENCE')
        if retained:
            self.directory = Path(retained) / self._testMethodName
            self.directory.mkdir(parents=True)
        else:
            temporary = tempfile.TemporaryDirectory()
            self.addCleanup(temporary.cleanup)
            self.directory = Path(temporary.name)


class Recorder(Evidence):
    def observe(self, body, release=False, filename='root-wake.py', script=None, pass_fds=()):
        root = self.directory
        test = root / 'bend2/test' / filename
        test.parent.mkdir(parents=True)
        source = ('import os, pathlib, subprocess, sys, time, unittest\n'
                  'class Case(unittest.TestCase):\n    def test_body(self):\n'
                  + ''.join('        ' + line + '\n' for line in body.splitlines())
                  + 'unittest.main()\n')
        test.write_text(source if script is None else script)
        argv = [sys.executable, str(RECORDER), 'observe', str(root / 'out'), '--', str(test)]
        # These obsolete settings exercise the target's rejected silence policy.
        # The fixture releases the live operation explicitly in every execution.
        env = dict(os.environ, BATON2_STALL_SECONDS='.05', BATON2_STALL_SAMPLE_SECONDS='.01')
        with (root / 'stderr').open('wb') as stderr:
            child = subprocess.Popen(argv, cwd=root, env=env, stdout=subprocess.PIPE, stderr=stderr, pass_fds=pass_fds)
            first = b''
            try:
                if release:
                    first = child.stdout.readline()
                    # Allow several of the target's short observation intervals.
                    threading.Event().wait(.4)
            finally:
                if callable(release):
                    release()
                elif release:
                    (root / 'release').write_text('released')
                output, _ = child.communicate()
        output = first + output
        (root / 'stdout').write_bytes(output)
        (root / 'process.json').write_text(json.dumps({'argv': argv, 'pid': child.pid,
            'exit_code': child.returncode, 'completed': True}) + '\n')
        recorded = root / 'out' / (filename + '.json')
        return child.returncode, output, (root / 'stderr').read_bytes(), json.loads(recorded.read_text()) if recorded.exists() else None

    def test_shared_queue_wait_completes_when_its_owner_releases_it(self):
        body = ('print("queued", flush=True)\n'
                'subprocess.run([sys.executable, "-c", '
                + repr('import pathlib,time\nwhile not pathlib.Path("release").exists():time.sleep(.01)\nprint("admitted")')
                + '], check=True)')
        code, output, error, document = self.observe(body, release=True)
        self.assertEqual(code, 0, error)
        self.assertEqual(output, b'queued\nadmitted\n')
        self.assertTrue(document['judged'])
        self.assertEqual(document['runs'][0]['failures'], [])

    def test_sparse_computation_completes_after_explicit_release(self):
        code, output, error, document = self.observe(
            'print("working", flush=True)\n'
            'while not pathlib.Path("release").exists():\n'
            '    sum(range(100))\n    time.sleep(.01)\n'
            'print("complete", flush=True)', release=True)
        self.assertEqual(code, 0, error)
        self.assertEqual(output, b'working\ncomplete\n')
        self.assertTrue(document['judged'])

    def test_socket_wait_completes_on_its_peer_message(self):
        listener = socket.socket()
        listener.bind(('127.0.0.1', 0))
        address = listener.getsockname()
        listener.listen()
        failures = []
        def peer():
            try:
                with listener.accept()[0] as connection:
                    threading.Event().wait(.4)
                    connection.sendall(b'peer result')
            except BaseException as error:
                failures.append(error)
            finally:
                listener.close()
        worker = threading.Thread(target=peer)
        worker.start()
        try:
            code, output, error, document = self.observe(
                'import socket\n'
                'with socket.socket() as peer:\n'
                + f'    peer.connect({address!r})\n'
                '    self.assertEqual(peer.recv(128), b"peer result")', filename='codex-root.py')
        finally:
            worker.join()
        self.assertEqual(failures, [])
        self.assertEqual(code, 0, error)
        self.assertIsNone(document)

    def test_quiet_pipe_wait_completes_on_explicit_input(self):
        reader, writer = os.pipe()
        try:
            code, output, error, document = self.observe(
                f'print("waiting", flush=True)\nself.assertEqual(os.read({reader}, 8), b"released")',
                release=lambda: os.write(writer, b'released'), pass_fds=(reader,))
        finally:
            os.close(reader)
            os.close(writer)
        self.assertEqual(code, 0, error)
        self.assertEqual(output, b'waiting\n')
        self.assertTrue(document['judged'])

    def test_unittest_error_preserves_its_actual_failure_type(self):
        code, output, error, document = self.observe('raise RuntimeError("actual exception λ🙂")')
        self.assertEqual(code, 1)
        self.assertIn('actual exception λ🙂'.encode(), error)
        self.assertTrue(document['judged'])
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_body', 'error']])

    def test_explicit_file_exit_is_retained_as_incomplete(self):
        code, output, error, document = self.observe('',
            script='print("before exit λ🙂",flush=True)\nraise SystemExit(7)\n')
        self.assertEqual(code, 7, error)
        self.assertEqual(output, 'before exit λ🙂\n'.encode())
        self.assertEqual(document['exit_code'], 7)
        self.assertFalse(document['judged'])

    def test_import_failure_retains_its_traceback_and_incomplete_outcome(self):
        code, output, error, document = self.observe('',
            script='raise ImportError("actual import failure λ🙂")\n')
        self.assertEqual(code, 1)
        self.assertIn('actual import failure λ🙂'.encode(), error)
        self.assertEqual(document['runs'], [])
        self.assertFalse(document['judged'])

    def test_passing_file_records_its_actual_outcome(self):
        code, output, error, document = self.observe('print("result λ🙂", flush=True)')
        self.assertEqual(code, 0, error)
        self.assertEqual(output, 'result λ🙂\n'.encode())
        self.assertTrue(document['judged'])
        self.assertEqual(document['runs'], [{'expected_tests': 1, 'tests_run': 1,
            'failures': [], 'skipped': [], 'expected_failures': []}])

    def test_assertion_failure_keeps_its_output_and_failure_type(self):
        code, output, error, document = self.observe(
            'print("before failure λ🙂", flush=True)\nself.fail("actual failure λ🙂")')
        self.assertEqual(code, 1)
        self.assertEqual(output, 'before failure λ🙂\n'.encode())
        self.assertIn('actual failure λ🙂'.encode(), error)
        self.assertTrue(document['judged'])
        self.assertEqual(document['runs'][0]['failures'], [['__main__.Case.test_body', 'assertion']])

    def test_missing_outcome_refuses_comparison(self):
        candidate, target = self.directory / 'candidate', self.directory / 'target'
        candidate.mkdir()
        target.mkdir()
        result = subprocess.run([sys.executable, str(RECORDER), 'compare', str(candidate),
            str(target), str(self.directory / 'comparison.json')], capture_output=True)
        self.assertEqual(result.returncode, 1)
        document = json.loads((self.directory / 'comparison.json').read_text())
        self.assertEqual(document['status'], 'refused')
        self.assertTrue(all(not row['judged'] for row in document['files']))

    def test_compare_accounts_for_inherited_repaired_new_and_incomplete_results(self):
        tree = ast.parse(RECORDER.read_text())
        selected = ast.literal_eval(next(node.value for node in tree.body
            if isinstance(node, ast.Assign) and any(isinstance(n, ast.Name) and n.id == 'SELECTED' for n in node.targets)))
        for scenario, expected in [('inherited', 'accepted'), ('repaired', 'accepted'),
                                   ('new', 'refused'), ('unjudged', 'refused'), ('mismatch', 'refused')]:
            with self.subTest(scenario=scenario):
                root = self.directory / scenario
                before, after = root / 'target', root / 'candidate'
                before.mkdir(parents=True)
                after.mkdir()
                for name in selected:
                    for directory, candidate in [(before, False), (after, True)]:
                        failures = [['Case.test_result', 'assertion']] if (
                            scenario == 'inherited' or scenario == 'new' and candidate or
                            scenario == 'repaired' and not candidate) else []
                        document = {'file': 'bend2/test/' + name, 'test_contract_sha256':
                            'changed' if scenario == 'mismatch' and candidate else 'same contract',
                            'judged': not (scenario == 'unjudged' and candidate),
                            'exit_code': 1 if failures else 0, 'runs': [{'expected_tests': 1,
                            'tests_run': 1, 'failures': failures, 'skipped': [], 'expected_failures': []}]}
                        (directory / (name + '.json')).write_text(json.dumps(document))
                argv = [sys.executable, str(RECORDER), 'compare', str(after), str(before), str(root / 'result.json')]
                result = subprocess.run(argv, capture_output=True)
                (root / 'stdout').write_bytes(result.stdout)
                (root / 'stderr').write_bytes(result.stderr)
                outcome = json.loads((root / 'result.json').read_text())
                self.assertEqual(outcome['status'], expected)
                self.assertEqual(result.returncode, 0 if expected == 'accepted' else 1)
                self.assertEqual({row['file'] for row in outcome['files']}, {'bend2/test/' + name for name in selected})
                if scenario == 'inherited':
                    self.assertTrue(all(row['inherited_failures'] and not row['new_failures'] for row in outcome['files']))
                if scenario == 'repaired':
                    self.assertTrue(all(row['repaired_failures'] and not row['new_failures'] for row in outcome['files']))


class FixtureFailure(Evidence):
    def guidance(self):
        # These fixtures specify the two input forms consumed by the producer diagnostic.
        message = self.delivery
        header = f"Message ({message['kind']}) from {message['sender']} [id: {message['id']}]"
        if message['kind'] in ('task', 'task-assignment'):
            selected = header + ':\n' + message['body']
        else:
            selected = (header + ' retained ' + str(len(message['body'].encode('utf-8')))
                        + ' bytes; read the complete body with baton read ' + message['id'] + '.')
        return 'Receive instructions.\n\n' + selected

    def make_case(self, phase='exited', status='exit 17', related=True, kind='report'):
        case = fixture.CodexRootAdapter('runTest')
        case.db = self.directory / "state's λ.db"
        attempt = self.directory / 'attempt'
        attempt.mkdir()
        self.delivery = {'id': 'selected-report', 'sender': 'child', 'recipient': "delegated's λ",
            'kind': kind, 'body': 'Complete report λ🙂', 'receipt': None,
            'nativeInputStatus': {'read': 'unrecorded'}}
        with sqlite3.connect(case.db) as database:
            database.executescript('CREATE TABLE executions(session PRIMARY KEY,id,directory,phase,status);'
                'CREATE TABLE native_initial_inputs(session,turn,attempt,guidance);'
                'CREATE TABLE messages(seq,id,sender,recipient,kind,body,receipt);')
            database.execute('INSERT INTO messages VALUES(?,?,?,?,?,?,?)',
                (1, self.delivery['id'], self.delivery['sender'], self.delivery['recipient'],
                 self.delivery['kind'], self.delivery['body'], None))
            database.execute('INSERT INTO executions VALUES(?,?,?,?,?)',
                (self.delivery['recipient'], 'fixture-turn', str(attempt), phase, status))
            database.execute('INSERT INTO native_initial_inputs VALUES(?,?,?,?)',
                (self.delivery['recipient'], 'fixture-turn', str(attempt), self.guidance() if related else 'Older unrelated input.'))
        return case, attempt

    def run_delivery(self, *args, **kwargs):
        return subprocess.CompletedProcess(args[0], 0, json.dumps(self.delivery), '')

    def test_retained_report_guidance_uses_the_actual_utf8_notice(self):
        case, attempt = self.make_case()
        with sqlite3.connect(case.db) as database:
            guidance = database.execute('SELECT guidance FROM native_initial_inputs').fetchone()[0]
        self.assertIn('Message (report) from child [id: selected-report] retained '
                      + str(len('Complete report λ🙂'.encode('utf-8')))
                      + ' bytes; read the complete body with baton read selected-report.', guidance)
        self.assertNotIn('Complete report λ🙂', guidance)
        (attempt / 'stdout').write_text('Retained report producer output. λ🙂')
        (attempt / 'native.stderr').write_text('Retained report producer error. λ🙂')
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
            with self.assertRaisesRegex(AssertionError, 'exit 17') as failure:
                case.accepted('selected-report', 'required-result')
        self.assertIn('Retained report producer error. λ🙂', str(failure.exception))

    def test_inlined_task_guidance_keeps_the_actual_producer_failure(self):
        for kind in ('task', 'task-assignment'):
            with self.subTest(kind=kind):
                root = self.directory
                self.directory = root / kind
                self.directory.mkdir()
                try:
                    case, attempt = self.make_case(kind=kind)
                    (attempt / 'stdout').write_text('Inlined task producer output. λ🙂')
                    (attempt / 'native.stderr').write_text('Inlined task producer error. λ🙂')
                    with sqlite3.connect(case.db) as database:
                        guidance = database.execute('SELECT guidance FROM native_initial_inputs').fetchone()[0]
                    self.assertIn(f'Message ({kind}) from child [id: selected-report]:\nComplete report λ🙂', guidance)
                    with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                            mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
                        with self.assertRaisesRegex(AssertionError, 'exit 17') as failure:
                            case.accepted('selected-report', 'required-result')
                    self.assertIn('Inlined task producer error. λ🙂', str(failure.exception))
                finally:
                    self.directory = root

    def test_failed_producer_preserves_complete_real_python_error(self):
        case, attempt = self.make_case()
        argv = [sys.executable, '-c', 'import sys; print("full output " + "λ🙂"*100000); '
            'print("PermissionError: fixture operation denied λ🙂",file=sys.stderr); sys.exit(17)']
        with (attempt / 'stdout').open('wb') as stdout, (attempt / 'native.stderr').open('wb') as stderr:
            child = subprocess.Popen(argv, stdout=stdout, stderr=stderr)
            child.wait()
        (attempt / 'process.json').write_text(json.dumps({'pid': child.pid, 'argv': argv,
            'returncode': child.returncode, 'completed': True}) + '\n')
        self.assertEqual(child.returncode, 17)
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
            with self.assertRaisesRegex(AssertionError, 'exit 17') as failure:
                case.accepted('selected-report', 'required-result')
        self.assertIn((attempt / 'stdout').read_text().rstrip(), str(failure.exception))
        self.assertIn('PermissionError: fixture operation denied λ🙂', str(failure.exception))
        self.assertTrue(case._retain_fixture)
        self.assertIsNone(self.delivery['receipt'])

    def test_exited_zero_without_required_result_reports_missing_result(self):
        case, attempt = self.make_case(status='exit 0')
        (attempt / 'stdout').write_text('Producer ended without a result. λ🙂')
        (attempt / 'native.stderr').write_text('')
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
            with self.assertRaisesRegex(AssertionError, 'exit 0') as failure:
                case.accepted('selected-report', 'required-result')
        self.assertIn('Producer ended without a result. λ🙂', str(failure.exception))

    def test_running_producer_can_complete_its_read_without_a_receipt(self):
        case, attempt = self.make_case(phase='running', status='')
        def release(_):
            if self.delivery['nativeInputStatus']['read'] == 'recorded':
                self.fail('The fixture ignored the completed read.')
            self.delivery['nativeInputStatus']['read'] = 'recorded'
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=release):
            self.assertEqual(case.accepted('selected-report', None), self.delivery)
        self.assertIsNone(self.delivery['receipt'])

    def test_unrelated_exited_attempt_does_not_fail_a_later_wait(self):
        case, attempt = self.make_case(related=False)
        def release(_):
            self.delivery['receipt'] = 'required-result'
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=release):
            self.assertEqual(case.accepted('selected-report', 'required-result'), self.delivery)

    def test_wait_before_first_native_admission_has_no_terminal_producer(self):
        case, attempt = self.make_case()
        with sqlite3.connect(case.db) as database:
            database.execute('DROP TABLE native_initial_inputs')
        def release(_):
            self.delivery['receipt'] = 'required-result'
        with mock.patch.object(fixture.subprocess, 'run', side_effect=self.run_delivery), \
                mock.patch.object(fixture.time, 'sleep', side_effect=release):
            self.assertEqual(case.accepted('selected-report', 'required-result'), self.delivery)

    def test_receipt_committed_before_terminal_observation_is_read_again(self):
        case, attempt = self.make_case()
        (attempt / 'stdout').write_text('')
        (attempt / 'native.stderr').write_text('')
        def read_then_commit(*args, **kwargs):
            result = self.run_delivery(*args, **kwargs)
            self.delivery['receipt'] = 'required-result'
            return result
        with mock.patch.object(fixture.subprocess, 'run', side_effect=read_then_commit):
            self.assertEqual(case.accepted('selected-report', 'required-result'), self.delivery)

    def complete(self, case):
        # Supply the already-read message to the corrected fixture. The target
        # predates that argument; both paths must report the same producer cause.
        arguments = [self.delivery['recipient'], ['Expected complete result.']]
        if 'delivery' in inspect.signature(case.completed).parameters:
            arguments.append(self.delivery)
        return case.completed(*arguments)

    def test_producer_failure_after_complete_read_keeps_its_terminal_cause(self):
        case, attempt = self.make_case()
        self.delivery['nativeInputStatus']['read'] = 'recorded'
        (attempt / 'stdout').write_text('Partial output after complete read. λ🙂')
        (attempt / 'native.stderr').write_text('Actual later fixture failure. λ🙂')
        case.coord = lambda *args: '[]'
        with mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
            with self.assertRaisesRegex(AssertionError, 'exit 17') as failure:
                self.complete(case)
        self.assertIn('Actual later fixture failure. λ🙂', str(failure.exception))
        self.assertIn('Partial output after complete read. λ🙂', str(failure.exception))
        self.assertTrue(case._retain_fixture)

    def test_successful_producer_without_turn_result_is_diagnosed(self):
        case, attempt = self.make_case(status='exit 0')
        (attempt / 'stdout').write_text('No terminal result emitted. λ🙂')
        (attempt / 'native.stderr').write_text('')
        case.coord = lambda *args: '[]'
        with mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited after producer exit')):
            with self.assertRaisesRegex(AssertionError, 'exit 0') as failure:
                self.complete(case)
        self.assertIn('No terminal result emitted. λ🙂', str(failure.exception))

    def test_failed_exit_after_a_report_retains_native_stderr(self):
        case, attempt = self.make_case()
        (attempt / 'stdout').write_text('Expected complete result.')
        (attempt / 'native.stderr').write_text('Actual final exit failure λ🙂')
        def coord(action, *args):
            if action == 'turns':
                return json.dumps([{'reportBody': 'Expected complete result.'}])
            self.assertEqual(action, 'players')
            return json.dumps([{'id': self.delivery['recipient'], 'execution':
                {'mode': 'retained', 'phase': 'exited', 'status': 'exit 17'}}])
        case.coord = coord
        with self.assertRaisesRegex(AssertionError, 'exit 17') as failure:
            self.complete(case)
        self.assertIn('Actual final exit failure λ🙂', str(failure.exception))
        self.assertTrue(case._retain_fixture)

    def test_running_retry_with_older_input_history_remains_pending(self):
        case, attempt = self.make_case()
        new = self.directory / 'retry'
        new.mkdir()
        with sqlite3.connect(case.db) as database:
            database.execute("UPDATE executions SET id=?,directory=?,phase='running',status=''",
                             ('retry-turn', str(new)))
            database.execute('INSERT INTO native_initial_inputs VALUES(?,?,?,?)',
                (self.delivery['recipient'], 'retry-turn', str(new), self.guidance()))
        released = []
        def turns(*args):
            return json.dumps([{'reportBody': 'Expected complete result.'}] if released else [])
        case.coord = turns
        case.exited = lambda session: None
        with mock.patch.object(fixture.time, 'sleep', side_effect=lambda _: released.append(True)):
            self.assertEqual(self.complete(case), [{'reportBody': 'Expected complete result.'}])
        self.assertEqual(released, [True])

    def test_selected_native_reads_complete_input_without_manual_ack(self):
        case, attempt = self.make_case()
        coordinator = self.directory / 'coordinator.py'
        calls = self.directory / 'selected.json'
        commands = self.directory / 'commands.jsonl'
        counter = self.directory / 'identity-read'
        coordinator.write_text('#!' + sys.executable + '\nimport json,pathlib,sys\n'
            + f'pathlib.Path({str(commands)!r}).open("a").write(json.dumps(sys.argv[2:])+"\\n")\n'
            + 'if sys.argv[2]=="session":\n'
            + f' counter=pathlib.Path({str(counter)!r})\n'
            + ' print(json.dumps({"native":"saved-codex" if counter.exists() else ""}))\n'
            + ' counter.write_text("observed")\n'
            + 'elif sys.argv[2]=="inbox": print("Complete report λ🙂")\n'
            + 'else:\n print("Unexpected fixture command",file=sys.stderr)\n sys.exit(42)\n')
        coordinator.chmod(0o700)
        tree = ast.parse(CODEX_ROOT.read_text())
        method = next(node for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
                      and node.name == 'assert_selected_associate_launch')
        write = next(node for node in ast.walk(method) if isinstance(node, ast.Call)
                     and isinstance(node.func, ast.Attribute) and node.func.attr == 'write_text')
        source = eval(compile(ast.Expression(write.args[0]), str(CODEX_ROOT), 'eval'),
                      {'sys': sys, 'str': str, 'EXE': coordinator, 'self': case,
                       'calls': calls, 'associate': self.delivery['recipient']})
        native = self.directory / 'selected.py'
        native.write_text(source)
        argv = [sys.executable, str(native)]
        child = subprocess.Popen(argv, cwd=self.directory, stdin=subprocess.PIPE,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = child.communicate('Complete report λ🙂'.encode())
        (self.directory / 'selected.stdout').write_bytes(stdout)
        (self.directory / 'selected.stderr').write_bytes(stderr)
        (self.directory / 'selected.process.json').write_text(json.dumps(
            {'pid': child.pid, 'argv': argv, 'returncode': child.returncode,
             'completed': True}) + '\n')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual([json.loads(line)['type'] for line in stdout.splitlines()],
                         ['thread.started', 'item.completed', 'turn.completed'])
        actions = [json.loads(line) for line in commands.read_text().splitlines()]
        self.assertIn(['inbox', self.delivery['recipient']], actions)
        self.assertNotIn('ack', [row[0] for row in actions])
        self.assertEqual(json.loads(calls.read_text())['prompt'], 'Complete report λ🙂')

    def test_cleanup_shuts_down_only_the_ended_owners_private_database(self):
        case, attempt = self.make_case()
        events = ['test-ended']
        children = []
        command = [sys.executable, '-c', 'import sys; print("ready",flush=True); '
            'sys.stdin.readline(); print("normal exit",flush=True)']
        for name in ('owned', 'unrelated'):
            child = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=subprocess.PIPE)
            self.assertEqual(child.stdout.readline(), b'ready\n')
            children.append((name, child))
        owned = children[0][1]
        unrelated = children[1][1]
        def finish_children():
            for name, child in children:
                if child.poll() is None:
                    child.stdin.write(b'shutdown\n')
                    child.stdin.flush()
                stdout, stderr = child.communicate()
                (self.directory / (name + '.stdout')).write_bytes(b'ready\n' + stdout)
                (self.directory / (name + '.stderr')).write_bytes(stderr)
                (self.directory / (name + '.process.json')).write_text(json.dumps(
                    {'pid': child.pid, 'argv': command, 'returncode': child.returncode,
                     'completed': True}) + '\n')
        self.addCleanup(finish_children)
        class Temporary:
            name = str(self.directory)
            class Finalizer:
                def detach(self):
                    events.append('retained')
            _finalizer = Finalizer()
            def cleanup(self):
                events.append('removed')
        case.temp = Temporary()
        case._retain_fixture = True
        case.instance_owner_pids = lambda: set() if owned.poll() is not None else {owned.pid}
        case.delivery_pids = lambda: set() if 'shutdown' in events else {5678}
        case.cleanup_failure_observe = lambda error: events.append(str(error))
        def shutdown(argv, **kwargs):
            self.assertEqual(argv, [str(fixture.EXE), '--instance-shutdown', str(case.db)])
            self.assertEqual(events, ['test-ended'])
            self.assertIsNone(owned.poll())
            self.assertIsNone(unrelated.poll())
            owned.stdin.write(b'shutdown\n')
            owned.stdin.flush()
            self.assertEqual(owned.wait(), 0)
            events.append('shutdown')
            return subprocess.CompletedProcess(argv, 0, 'normal fixture shutdown', '')
        with mock.patch.object(fixture.subprocess, 'run', side_effect=shutdown), \
                mock.patch.object(fixture.time, 'sleep', side_effect=AssertionError('waited before private shutdown')):
            case.cleanup_fixture()
        self.assertEqual(events, ['test-ended', 'shutdown', 'retained'])
        self.assertEqual(owned.poll(), 0)
        self.assertIsNone(unrelated.poll())
        self.assertTrue(case.db.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
