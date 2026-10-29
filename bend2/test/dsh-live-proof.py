"""DSH live proof: one retained DSH turn through the staged production prefix.

The official `dsh` runs under `turn-text` against a local Messages-compatible
stub, so the run needs no model credential. The turn uses the production
launch, the production hook plugin (dsh-baton-hooks.mjs), the baton-worker
bridge and the installed `--stop-hook` entry against a real database. It
checks, in order:

  1. the first model request lacks input that is not yet owed;
  2. guidance committed during the first tool call reaches the next model
     request as a complete body, and its read is recorded for the worker;
  3. an answer that would close the turn with an open assignment and no
     completion request is steered by the gate, which names the assignment;
  4. the completion_request bridge tool records a completion-request to the
     parent, and the gate then lets the turn close;
  5. the composed tool list is the DSH roster plus the eight bridge tools;
  6. the parent confirms the request and the assignment is ended, while an
     unregistered session is refused.

Environment: BATON2_NATIVE_DELIVERY_PREFIX (staged production prefix with bin/
and libexec/) and DSH_CLI (official dsh executable). The test is skipped
without them. It has no timeout; a hang is a failure to investigate.
"""
import hashlib
import json
import os
import pathlib
import shutil
import sqlite3
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PREFIX = os.environ.get('BATON2_NATIVE_DELIVERY_PREFIX')
DSH = os.environ.get('DSH_CLI') or shutil.which('dsh')
BRIDGE_TOOLS = ['mcp__baton-worker__' + name
                for name in ('ask', 'commit', 'completion_confirmed', 'completion_request',
                             'guide', 'inbox', 'read', 'report')]
DSH_TOOLS = ['bash', 'list_mcp_resource_templates', 'list_mcp_resources', 'read_image',
             'read_mcp_resource', 'working_directory']
TAIL = 'COMPLETE-TAIL'
BODY = 'Guidance committed during the first tool call. λ🙂\n' * 50 + TAIL
SUMMARY = 'The assignment is complete; the guidance was applied.'


def sse(text='', tool=None):
    if tool:
        start = {'type': 'content_block_start', 'index': 0,
                 'content_block': {'type': 'tool_use', 'id': 'toolu_' + tool[0][-8:],
                                   'name': tool[0], 'input': {}}}
        delta = {'type': 'content_block_delta', 'index': 0,
                 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(tool[1])}}
        stop = 'tool_use'
    else:
        start = {'type': 'content_block_start', 'index': 0,
                 'content_block': {'type': 'text', 'text': ''}}
        delta = {'type': 'content_block_delta', 'index': 0,
                 'delta': {'type': 'text_delta', 'text': text}}
        stop = 'end_turn'
    events = [
        ('message_start', {'type': 'message_start', 'message': {
            'id': 'msg_proof', 'type': 'message', 'role': 'assistant',
            'model': 'deepseek-flash', 'content': [], 'stop_reason': None,
            'stop_sequence': None, 'usage': {'input_tokens': 11, 'output_tokens': 0}}}),
        ('content_block_start', start), ('content_block_delta', delta),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('message_delta', {'type': 'message_delta', 'delta': {
            'stop_reason': stop, 'stop_sequence': None},
            'usage': {'output_tokens': 7, 'input_tokens': 11}}),
        ('message_stop', {'type': 'message_stop'}),
    ]
    return ''.join(f'event: {name}\ndata: {json.dumps(value)}\n\n'
                   for name, value in events).encode()


class Model(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    requests = []
    database = None

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))))
        self.requests.append(body)
        main = [request for request in self.requests if request.get('tools')]
        if not body.get('tools'):
            payload = sse('proof-title')
        elif len(main) == 1:
            payload = sse(tool=('bash', {'command': 'printf dsh-proof-tool-ok'}))
            with sqlite3.connect(self.database) as database:
                database.execute("INSERT INTO messages(id,sender,recipient,kind,body) "
                                 "VALUES('during-turn','parent','worker','guidance',?)", (BODY,))
        elif len(main) == 2:
            payload = sse('Finished without asking for completion.')
        elif len(main) == 3:
            payload = sse(tool=('mcp__baton-worker__completion_request', {'text': SUMMARY}))
        else:
            payload = sse('Completion requested.')
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('connection', 'close')
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def log_message(self, *args):
        pass


@unittest.skipUnless(PREFIX and DSH, 'set BATON2_NATIVE_DELIVERY_PREFIX and DSH_CLI')
class DshLiveProof(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='dsh-live-proof-')
        self.addCleanup(temporary.cleanup)
        self.directory = pathlib.Path(temporary.name)
        self.prefix = self.directory / 'prefix'
        retained = pathlib.Path(PREFIX)
        shutil.copytree(retained / 'bin', self.prefix / 'bin')
        shutil.copytree(retained / 'libexec', self.prefix / 'libexec', symlinks=True)
        self.full = self.prefix / 'bin/baton-full'
        self.focused = self.prefix / 'bin/baton'
        self.database = self.directory / 'proof.sqlite'
        self.work = self.directory / 'work'
        self.work.mkdir()
        self.environment = {key: value for key, value in os.environ.items()
                            if not key.startswith('BATON') and key != 'CODEX_THREAD_ID'}
        self.environment.update(HOME=str(self.directory / 'home'),
                                XDG_RUNTIME_DIR=str(self.directory / 'runtime'))
        pathlib.Path(self.environment['XDG_RUNTIME_DIR']).mkdir(mode=0o700)
        self.addCleanup(self.shutdown)
        self.cli('attach', 'parent', 'operator', '', '')
        self.cli('role', 'parent', 'conductor')
        self.cli('attach', 'worker', 'dsh', '', '')
        self.cli('role', 'worker', 'player')
        with sqlite3.connect(self.database) as database:
            database.execute("UPDATE sessions SET parent='parent',model='deepseek-flash',"
                             "effort='max' WHERE id='worker'")
        self.cli('message', 'dsh-task', 'parent', 'worker', 'task-assignment',
                 'Apply any guidance you receive, then request completion.')

    def cli(self, *arguments, success=True, environment=None):
        result = subprocess.run([str(self.full), str(self.database), *map(str, arguments)],
                                env=environment or self.environment, capture_output=True, text=True)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return result

    def action(self, session, *arguments):
        result = self.cli('as', session, *arguments)
        return json.loads(result.stdout)

    def shutdown(self):
        result = subprocess.run([str(self.focused), '--instance-shutdown', str(self.database)],
                                env=self.environment, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_retained_dsh_turn_delivers_input_gates_closure_and_requests_completion(self):
        Model.requests = []
        Model.database = self.database
        server = ThreadingHTTPServer(('127.0.0.1', 0), Model)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        environment = dict(self.environment, DEEPSEEK_API_KEY='proof-placeholder',
                           DEEPSEEK_BASE_URL=f'http://127.0.0.1:{server.server_port}')
        turn = self.cli('turn-text', 'worker', 'proof', DSH, 'deepseek-flash', 'max', self.work,
                        'Complete the assignment and read new input.', self.directory / 'native.jsonl',
                        '', environment=environment)
        main = [request for request in Model.requests if request.get('tools')]
        self.assertEqual(len(main), 4, turn.stdout + turn.stderr)
        texts = [json.dumps(request['messages'], ensure_ascii=False) for request in main]

        # 1 and 2: the body is absent before it is owed and complete at the next step.
        self.assertNotIn(TAIL, texts[0])
        self.assertIn(TAIL, texts[1])
        self.assertEqual(sorted(tool['name'] for tool in main[0]['tools']),
                         sorted(DSH_TOOLS + BRIDGE_TOOLS))
        with sqlite3.connect(self.database) as database:
            reads = database.execute("SELECT recipient FROM message_reads WHERE message='during-turn'").fetchall()
            self.assertEqual(reads, [('worker',)])
            self.assertEqual(database.execute(
                "SELECT body FROM messages WHERE id='during-turn'").fetchone(), (BODY,))
            # 3: the answer without a request was steered; the gate names the assignment.
            self.assertIn('dsh-task', texts[2])
            self.assertIn('completion_request', texts[2])
            # 4: the bridge tool recorded the request to the parent.
            request = database.execute(
                "SELECT id,recipient,body FROM messages WHERE sender='worker' AND kind='completion-request'").fetchall()
            self.assertEqual([(row[1], row[2]) for row in request], [('parent', SUMMARY)])
            self.assertEqual(database.execute(
                "SELECT phase,status FROM executions WHERE session='worker'").fetchall(),
                [('exited', 'exit 0')])
            self.assertEqual(database.execute(
                "SELECT m.id FROM messages m WHERE m.recipient='worker' AND NOT EXISTS("
                "SELECT 1 FROM message_reads r WHERE r.message=m.id AND r.recipient=m.recipient)").fetchall(), [])
        self.assertEqual(hashlib.sha256(BODY.encode()).hexdigest(),
                         hashlib.sha256(json.loads(self.cli('as', 'worker', 'read', 'during-turn').stdout)[0]
                                        ['delivery']['body'].encode()).hexdigest())

        # 6: an unregistered session is refused; the parent confirms and the assignment ends.
        refused = self.action('ghost', 'completion-confirmed', '--to', 'worker')
        self.assertEqual([row['status'] for row in refused], ['refused'])
        self.assertFalse(self.action('parent', 'session', 'worker')['taskCompletion']['confirmed'])
        confirmed = self.action('parent', 'completion-confirmed', '--to', 'worker')
        self.assertEqual(confirmed[0]['status'], 'admitted')
        self.assertTrue(self.action('parent', 'session', 'worker')['taskCompletion']['ended'])


if __name__ == '__main__':
    unittest.main()
