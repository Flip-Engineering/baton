"""Terminal session stops preserve owned native output and retained input."""
import importlib.util
import json
import os
import pathlib
import signal
import sqlite3
import sys
import unittest

spec = importlib.util.spec_from_file_location('receive_fixture', pathlib.Path(__file__).with_name('receive.py'))
receive = importlib.util.module_from_spec(spec)
spec.loader.exec_module(receive)

# The fixture acknowledges TERM only when a test explicitly requests resistance.
# Its socket commands establish process state before each stop or force request.
FIXTURE = receive.FIXTURE.replace('import json,os,pathlib,re,socket,subprocess,sys',
                                 'import json,os,pathlib,re,signal,socket,subprocess,sys')
FIXTURE = FIXTURE.replace('args=sys.argv[1:]', '''args=sys.argv[1:]
if args[:1]==['tool_fixture']:
    connection=socket.create_connection(('127.0.0.1',config['port']))
    stream=connection.makefile('rwb',buffering=0)
    stream.write((json.dumps({'role':'tool','pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp()})+'\\n').encode())
    stream.readline()
    sys.exit(0)''', 1)
FIXTURE = FIXTURE.replace("'pid':os.getpid(),'ppid':os.getppid(),'session':model",
                          "'pid':os.getpid(),'ppid':os.getppid(),'pgid':os.getpgrp(),'session':model", 1)
FIXTURE = FIXTURE.replace("    if action.get('progress'):", """    if action.get('resist_term'):
        signal.signal(signal.SIGTERM, lambda signum, frame: reply({'signal': signum}))
        reply({'resists_term': True})
        continue
    if action.get('ack_only'):
        for ident in re.findall(r'^Message \\([^\\n]*\\) from [^\\n]* \\[id: (.*?)\\]:$',prompt,re.M):
            subprocess.run([config['exe'],config['db'],'ack',ident,model,'accepted-before-stop'],check=True,stdout=subprocess.DEVNULL)
        reply({'accepted': True})
        continue
    if action.get('start_tool'):
        tool=subprocess.Popen([sys.executable,__file__,'tool_fixture'],stdin=subprocess.DEVNULL)
        reply({'tool_spawned':tool.pid})
        continue
    if action.get('progress'):""", 1)

# The stop helper runs one turn for each supported retained harness. The shared
# fixture speaks Codex and OMP; these insertions add the Muse task-file envelope
# and the Claude user-frame envelope without touching the shared fixture.
FIXTURE = FIXTURE.replace(r"""omp='--mode' in args""", r"""omp='--mode' in args
muse='--prompt-file' in args
claude='--input-format' in args""", 1)
FIXTURE = FIXTURE.replace(r"""else:
    prompt=sys.stdin.read()
    native=resume or native
    print(json.dumps({'type':'thread.started','thread_id':native}),flush=True)""", r"""elif muse:
    prompt=pathlib.Path(args[args.index('--prompt-file')+1]).read_text()
    print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'turn.input.user','payload':{'kind':'turn_input_user','command_id':'fixture-primary'}}),flush=True)
elif claude:
    prompt=json.loads(sys.stdin.readline())['message']['content']
    print(json.dumps({'type':'system','subtype':'init','session_id':native}),flush=True)
else:
    prompt=sys.stdin.read()
    native=resume or native
    print(json.dumps({'type':'thread.started','thread_id':native}),flush=True)""", 1)
FIXTURE = FIXTURE.replace(r"""        remaining_input=sys.stdin.read()
    elif failure:""", r"""        remaining_input=sys.stdin.read()
    elif muse:
        print(json.dumps({'stream':{'kind':'session','id':native},'payload_type':'run.terminal.completed','payload':{'kind':'run_terminal','terminal':'completed','command_id':'fixture-primary','text':body}}),flush=True)
    elif claude:
        print(json.dumps({'type':'result','session_id':native,'result':body,'is_error':failure}),flush=True)
    elif failure:""", 1)


class Stop(unittest.TestCase):
    setUp = receive.Receive.setUp
    close_children = receive.Receive.close_children
    owned_processes = receive.Receive.owned_processes
    eventually = receive.Receive.eventually
    coord = receive.Receive.coord
    spawn = receive.Receive.spawn
    player = receive.Receive.player
    receive_args = receive.Receive.receive_args
    endpoint = receive.Receive.endpoint
    connect = receive.Receive.connect
    message = receive.Receive.message
    accept_any = receive.Receive.accept_any
    accept = receive.Receive.accept
    action = receive.Receive.action
    finish = receive.Receive.finish
    native_requests = receive.Receive.native_requests
    native_question = receive.Receive.native_question

    def configure(self, parent_endpoint=True):
        self.fixture.write_text('#!' + sys.executable + '\n' + FIXTURE)
        config_path = self.directory / 'fixture.json'
        config = json.loads(config_path.read_text())
        config['record_launches'] = True
        config_path.write_text(json.dumps(config))
        if parent_endpoint:
            self.coord('attach', 'root', 'codex', 'native-root',
                       json.dumps([str(self.fixture), 'parent_endpoint']))

    def rows(self, sql, parameters=()):
        with sqlite3.connect(self.db) as database:
            database.row_factory = sqlite3.Row
            return [dict(row) for row in database.execute(sql, parameters)]

    def begin(self, harness='omp', resist=False):
        self.configure()
        self.player(harness=harness)
        self.coord('message', 'initial', 'root', 'parent', 'task', 'Make useful progress.')
        observer = self.spawn(*self.receive_args('parent'))
        stream, started = self.accept('parent')
        self.action(stream, ack_only=True)
        self.assertEqual(json.loads(stream.readline()), {'accepted': True})
        self.action(stream, progress='output before terminal stop')
        self.assertEqual(json.loads(stream.readline()), {'progress_written': 'output before terminal stop'})
        self.eventually(lambda: self.coord('player', 'parent')['native'] == started['native'],
                        'native identity was not recorded')
        if resist:
            self.action(stream, resist_term=True)
            self.assertEqual(json.loads(stream.readline()), {'resists_term': True})
        return observer, stream, started

    def stop(self, **options):
        return self.coord('stop', 'parent', 'operator-stop', 'The parent ended this task.', **options)

    def completed(self):
        def answer():
            state = self.coord('player', 'parent').get('stop', {})
            return state if state.get('status') == 'stopped' and state.get('nativeStatus') else None
        return self.eventually(answer, 'stopped native process was not reaped')

    def test_idle_stop_preserves_input_refuses_new_execution_and_retries(self):
        self.configure()
        self.player(harness='omp')
        self.coord('message', 'queued', 'root', 'parent', 'task', 'Queued work remains visible.')
        before = self.rows('SELECT * FROM messages')
        stopped = self.stop()
        self.assertEqual(stopped['status'], 'stopped')
        self.assertIsNone(stopped['attempt'])
        self.assertIsNone(stopped['nativeStatus'])
        self.assertIsNone(stopped['requestedSignal'])
        self.assertNotIn('requestedSignal', self.coord('player', 'parent')['stop'])
        self.assertEqual(stopped['stoppedInputs'], 1)
        self.assertEqual(self.rows('SELECT * FROM messages'), before)
        self.assertEqual(self.stop(), stopped)
        self.assertEqual(self.coord('force-stop', 'parent', 'operator-stop'), stopped)
        conflict = self.coord('stop', 'parent', 'different-stop', 'Different.', ok=False)
        self.assertNotEqual(conflict.returncode, 0)
        for kind in ('task', 'guidance', 'recovery'):
            refused = self.coord('message', 'new-' + kind, 'root', 'parent', kind, 'Must not run.', ok=False)
            self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.rows('SELECT * FROM messages'), before)
        self.assertEqual(self.coord('inbox', 'parent')[0]['executionDisposition'], 'stopped')
        self.assertEqual(next(s for s in self.coord('status') if s['id'] == 'parent')['pending'], 0)
        self.assertEqual(next(row for row in self.coord('players')
                              if row['id'] == 'parent')['pendingCount'], 0)
        refused = self.coord(*self.receive_args('parent'), ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertEqual(self.rows('SELECT * FROM executions'), [])

    def retained_stop_preserves_work_native_identity_receipts_and_output(self, harness):
        observer, stream, started = self.begin(harness=harness)
        self.action(stream, start_tool=True)
        tool_pid = json.loads(stream.readline())['tool_spawned']
        tool_stream, tool = self.accept_any()
        self.assertEqual(tool, {'role': 'tool', 'pid': tool_pid, 'ppid': started['pid'], 'pgid': started['pgid']})
        work = self.checkouts / 'parent' / 'seed.txt'
        self.action(stream, append_file=[str(work), 'Progress before stop.\n'])
        self.assertEqual(json.loads(stream.readline()), {'appended': str(work)})
        self.connect('parent')
        self.message('queued', 'parent', 'This queued correction must not execute.')
        original = self.rows("SELECT id,body,receipt FROM messages WHERE recipient='parent' ORDER BY seq")
        requested = self.stop()
        self.assertEqual(requested['requestedSignal'], 15)
        self.finish(observer, ok=False)
        self.assertEqual(tool_stream.readline(), b'', 'native tool connection remained open after stop')
        completed = self.completed()
        self.assertEqual(completed['nativeStatus'], 'signal 15')
        self.assertEqual(self.rows("SELECT id,body,receipt FROM messages WHERE recipient='parent' ORDER BY seq"), original)
        self.assertIn('Progress before stop.', work.read_text())
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertIn('output before terminal stop', (self.directory / 'parent.jsonl').read_text())
        report = self.rows('SELECT * FROM messages WHERE id=?', [completed['reportId']])[0]
        self.assertEqual(report['receipt'], 'parent-received')
        self.assertEqual(json.loads(report['body'])['nativeStatus'], 'signal 15')
        self.assertEqual(json.loads(report['body'])['workspace'], str(self.checkouts / 'parent'))
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 1)
        self.assertEqual(self.stop()['nativeStatus'], 'signal 15')
        self.eventually(lambda: not self.owned_processes(), 'stopped processes remained')

    def test_retained_omp_stop_preserves_work_and_exits_native_and_tool(self):
        self.retained_stop_preserves_work_native_identity_receipts_and_output('omp')

    def test_retained_codex_stop_preserves_work_and_exits_native_and_tool(self):
        self.retained_stop_preserves_work_native_identity_receipts_and_output('codex')

    def test_retained_muse_stop_preserves_work_and_exits_native_and_tool(self):
        self.retained_stop_preserves_work_native_identity_receipts_and_output('muse')

    def test_retained_claude_code_stop_preserves_work_and_exits_native_and_tool(self):
        self.retained_stop_preserves_work_native_identity_receipts_and_output('claude-code')

    def test_explicit_force_reaches_same_term_resistant_attempt_after_observer_loss(self):
        observer, stream, started = self.begin(resist=True)
        requested = self.stop()
        self.assertEqual(requested['status'], 'requested')
        self.assertEqual(requested['submittedSignal'], 15)
        self.assertEqual(json.loads(stream.readline()), {'signal': 15})
        observer.kill()
        self.finish(observer, ok=False)
        self.action(stream, progress='output after stop and observer loss')
        self.assertEqual(json.loads(stream.readline()), {'progress_written': 'output after stop and observer loss'})
        self.eventually(lambda: 'output after stop and observer loss' in (self.directory / 'parent.jsonl').read_text(),
                        'recovery did not retain post-loss output')
        before_force = self.rows('SELECT * FROM session_stops')
        wrong = self.coord('force-stop', 'parent', 'different-stop', ok=False)
        self.assertNotEqual(wrong.returncode, 0)
        self.assertEqual(self.rows('SELECT * FROM session_stops'), before_force)
        self.assertTrue(any(p['pid'] == started['pid'] for p in self.owned_processes()))
        forced = self.coord('force-stop', 'parent', 'operator-stop')
        self.assertEqual(forced['requestedSignal'], 9)
        self.assertEqual(forced['attempt'], requested['attempt'])
        completed = self.completed()
        self.assertEqual(completed['nativeStatus'], 'signal 9')
        self.eventually(lambda: not self.owned_processes(), 'stopped recovery processes remained')
        self.assertEqual(len((self.directory / 'native-launches.jsonl').read_text().splitlines()), 1)
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertEqual(self.coord('force-stop', 'parent', 'operator-stop')['nativeStatus'], 'signal 9')
        self.assertEqual(self.rows('SELECT * FROM messages WHERE id=?', [completed['reportId']])[0]['receipt'], 'parent-received')

    def test_active_direct_turn_refuses_stop_without_mutating_input(self):
        self.configure()
        self.player(harness='codex')
        task = self.directory / 'task'
        task.write_text('Finish this direct turn.')
        direct = self.spawn('turn', 'parent', 'direct-turn', str(self.fixture), 'parent', 'low',
                            str(self.directory), str(task), str(self.directory / 'direct.jsonl'), '')
        stream, _ = self.accept('parent')
        refused = self.stop(ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('direct turn is unsupported', refused.stderr)
        self.assertEqual(self.rows('SELECT * FROM session_stops'), [])
        self.action(stream, body='Direct turn finished normally.')
        self.finish(direct)

    def test_child_report_retry_notifies_stopped_parents_parent_once(self):
        self.configure()
        self.player(harness='omp')
        self.coord('recruit', 'child', 'parent', 'omp', 'child', 'low', str(self.repo),
                   'child-branch', str(self.checkouts / 'child'), self.base)
        self.coord('report', 'child-report', 'child', 'Committed work is ready for review.')
        before = self.rows("SELECT * FROM messages WHERE id='child-report'")[0]
        stopped = self.stop()
        self.assertEqual(stopped['pendingReports'], 1)
        self.assertEqual(self.rows("SELECT * FROM messages WHERE id='child-report'")[0], before)
        self.assertFalse((self.directory / 'parent-deliveries.jsonl').exists())
        for _ in range(2):
            self.coord('report', 'child-report', 'child', before['body'])
        self.assertEqual(self.rows("SELECT * FROM messages WHERE id='child-report'")[0], before)
        notices = self.rows("SELECT * FROM messages WHERE sender='parent' AND recipient='root'")
        self.assertEqual(len(notices), 1)
        self.assertEqual(notices[0]['receipt'], 'parent-received')
        body = json.loads(notices[0]['body'])
        self.assertEqual(body['originalMessage'], 'child-report')
        self.assertEqual(body['originalBody'], before['body'])
        self.assertEqual(body['recipient'], 'parent')
        self.assertEqual(len((self.directory / 'parent-deliveries.jsonl').read_text().splitlines()), 1)

    def test_stopped_root_retains_question_with_explicit_delivery_condition(self):
        self.configure(parent_endpoint=False)
        self.player(harness='omp')
        self.coord('stop', 'root', 'stop-root', 'End root session.')
        result = self.coord('ask', 'question', 'parent', 'Who reviews the retained work?', ok=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Higher-parent delivery is unavailable', result.stderr)
        message = self.rows("SELECT * FROM messages WHERE id='question'")[0]
        self.assertEqual(message['body'], 'Who reviews the retained work?')
        self.assertIsNone(message['receipt'])
        self.assertEqual(self.coord('inbox', 'root')[0]['executionDisposition'], 'retained-for-stopped-session')

    def test_stop_refuses_pending_native_answer_while_original_native_is_alive(self):
        observer, stream, started = self.begin(resist=True)
        event = {'type': 'extension_ui_request', 'id': 'question-before-stop',
                 'method': 'input', 'title': 'An answer is pending when the session stops'}
        request = self.native_question(stream, event)
        self.eventually(lambda: self.coord('delivery', request['id'])['receipt'],
                        'parent did not receive the native question')
        self.assertIsNone(self.native_requests()[0]['closed'])
        stopped = self.stop()
        self.assertEqual(stopped['status'], 'requested')
        self.assertEqual(json.loads(stream.readline()), {'signal': 15})
        refused = self.coord('native-reply', 'root', request['id'], '{"value":"continue anyway"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        row = self.native_requests()[0]
        self.assertEqual(json.loads(row['event']), event)
        self.assertIsNone(row['reply'])
        self.assertEqual(row['written'], 0)
        self.assertTrue(any(p['pid'] == started['pid'] and p['ppid'] == started['ppid']
                            for p in self.owned_processes()))
        body = 'Native work ended after the stop request.'
        self.action(stream, body=body, hold_exit=True, report_input=True)
        self.assertEqual(json.loads(stream.readline()), {'terminal_written': True, 'input_after_prompt': ''})
        self.assertEqual(self.coord('player', 'parent')['stop']['status'], 'requested')
        self.action(stream, exit_fixture=True)
        self.finish(observer)
        self.assertEqual(self.completed()['nativeStatus'], 'exit 0')
        self.eventually(lambda: not self.owned_processes(), 'stopped native question processes remained')
        self.assertEqual(self.coord('player', 'parent')['native'], started['native'])
        self.assertEqual(self.coord('delivery', request['id'])['receipt'], 'parent-received')
        self.assertEqual([turn['reportBody'] for turn in self.coord('turns', 'parent')], [body])

    def test_native_reply_initializes_stop_schema_in_existing_request_database(self):
        initial = self.coord('native-reply', 'root', 'unknown-request', '{"value":"answer"}', ok=False)
        self.assertNotEqual(initial.returncode, 0)
        self.assertTrue(self.rows("SELECT name FROM sqlite_master WHERE name='native_requests'"))
        self.assertEqual(self.owned_processes(), [])
        with sqlite3.connect(self.db) as database:
            database.executescript('DROP TABLE executions; DROP TABLE session_stops;')
        refused = self.coord('native-reply', 'root', 'unknown-request', '{"value":"answer"}', ok=False)
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('Native reply refused', refused.stderr)
        self.assertNotIn('no such table', refused.stderr)
        self.assertEqual({row['name'] for row in self.rows(
            "SELECT name FROM sqlite_master WHERE name IN ('executions','session_stops')")},
            {'executions', 'session_stops'})
        self.assertEqual(self.owned_processes(), [])


if __name__ == '__main__':
    unittest.main()
