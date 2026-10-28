"""DSH live canary: a real tool call, a tool result and a session resume.

The default mode starts a local Messages-compatible stub so the run needs no
model credential. It launches DSH with the production roster: the tool patch
mounts the Baton input plugin and the baton-worker bridge, as a retained launch
does. It prints the exact child argv, the composed tool names, the model and the
reasoning effort from the outgoing request, and both --json streams.

Set DSH_CANARY_REAL=1 to use DEEPSEEK_BASE_URL (or the provider default) with
DEEPSEEK_API_KEY from the launch environment. The real mode prints the stream
and does not inspect the request.
"""
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


ROOT = pathlib.Path(__file__).resolve().parents[2]
BRIDGE = ROOT / 'bend2/scripts/dsh-worker.mjs'
HOOKS = ROOT / 'bend2/scripts/dsh-baton-hooks.mjs'
BRIDGE_TOOLS = ['mcp__baton-worker__' + name
                for name in ('ask', 'commit', 'completion_request', 'inbox', 'read', 'report')]
DSH_TOOLS = ['bash', 'list_mcp_resource_templates', 'list_mcp_resources', 'read_image',
             'read_mcp_resource', 'working_directory']
FIXTURE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-player-test'))
DSH = os.environ.get('DSH_CLI') or shutil.which('dsh')


def sse(text, stop='end_turn', tool=None):
    if tool:
        start = {"type": "content_block_start", "index": 0,
                 "content_block": {"type": "tool_use", "id": "toolu_1",
                                   "name": tool[0], "input": {}}}
        delta = {"type": "content_block_delta", "index": 0,
                 "delta": {"type": "input_json_delta",
                           "partial_json": json.dumps(tool[1])}}
    else:
        start = {"type": "content_block_start", "index": 0,
                 "content_block": {"type": "text", "text": ""}}
        delta = {"type": "content_block_delta", "index": 0,
                 "delta": {"type": "text_delta", "text": text}}
    events = [
        ("message_start", {"type": "message_start", "message": {
            "id": "msg_canary", "type": "message", "role": "assistant",
            "model": "deepseek-flash", "content": [], "stop_reason": None,
            "stop_sequence": None,
            "usage": {"input_tokens": 11, "output_tokens": 0}}}),
        ("content_block_start", start),
        ("content_block_delta", delta),
        ("content_block_stop", {"type": "content_block_stop", "index": 0}),
        ("message_delta", {"type": "message_delta", "delta": {
            "stop_reason": stop, "stop_sequence": None},
            "usage": {"output_tokens": 7, "input_tokens": 11}}),
        ("message_stop", {"type": "message_stop"}),
    ]
    return ''.join(f'event: {name}\ndata: {json.dumps(value)}\n\n'
                   for name, value in events).encode()


class Stub(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    requests = []

    def do_POST(self):
        length = int(self.headers.get('content-length', '0'))
        body = self.rfile.read(length)
        try:
            parsed = json.loads(body)
        except json.JSONDecodeError:
            parsed = {}
        self.requests.append((self.path, parsed))
        tools = [tool.get('name') for tool in parsed.get('tools', [])]
        messages = parsed.get('messages', [])
        has_result = any(
            isinstance(message.get('content'), list)
            and any(isinstance(block, dict) and block.get('type') == 'tool_result'
                    for block in message['content'])
            for message in messages)
        if not tools:
            payload = sse('canary-title')
        elif not has_result:
            payload = sse('', stop='tool_use',
                          tool=('bash', {'command': 'printf dsh-live-tool-ok'}))
        else:
            payload = sse('resume-ok')
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('cache-control', 'no-cache')
        self.send_header('connection', 'close')
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def log_message(self, *args):
        pass


def fixture(*args):
    result = subprocess.run([str(FIXTURE), *map(str, args)], text=True,
                            capture_output=True)
    if result.returncode != 0:
        raise SystemExit(f'fixture failed: {result.stderr}')
    return result.stdout


def child_argv(home, cli, tools, model, effort, session=''):
    command = ['argv-fresh', home, cli, 'deepseek/deepseek-flash', effort,
               tools, model]
    if session:
        command = ['argv-resume', home, cli, 'deepseek/deepseek-flash', effort,
                   tools, model, session]
    return [line.split('\t', 1)[1] for line in fixture(*command).splitlines()
            if line.startswith('arg\t')]


def stream_events(output):
    return [json.loads(line) for line in output.splitlines()
            if line.strip().startswith('{')]


def print_stream(label, output):
    print(label + ':')
    for line in output.splitlines():
        print('  ' + line)


def main():
    if not FIXTURE.is_file():
        raise SystemExit(f'DSH fixture not built at {FIXTURE}')
    if not DSH:
        print('dsh-canary: skipped; set DSH_CLI to the official dsh executable')
        return 0

    with tempfile.TemporaryDirectory(prefix='dsh-canary-') as temporary:
        root = pathlib.Path(temporary)
        home = root / 'home'
        attempt = root / 'attempt'
        attempt.mkdir()
        fixture('prepare', attempt, 'deepseek/deepseek-flash', 'max', str(HOOKS))
        tools = str(attempt / 'dsh-tools.patch.yml')
        model = str(attempt / 'dsh-model.patch.yml')
        argv = child_argv(str(home), DSH, tools, model, 'max')
        print('child-argv:')
        for argument in argv:
            print('  ' + argument)

        env = dict(os.environ)
        env['DSH_HOME'] = str(home)
        database = root / 'state.db'
        database.touch()
        env.update(BATON_DATABASE=str(database), BATON_SESSION='dsh-canary',
                   BATON_ATTEMPT_DIRECTORY=str(attempt), BATON_COORDINATOR=sys.executable,
                   BATON_DSH_WORKER_BRIDGE=str(BRIDGE))
        composition = subprocess.run(
            [DSH, '--profile', 'headless', '--patch', tools, '--patch', model, '--dump-config'],
            text=True, capture_output=True, env=env)
        if composition.returncode != 0:
            print(composition.stderr, file=sys.stderr)
            raise SystemExit('canary: DSH config composition failed')
        model_row = re.search(
            r'(?ms)^- id: agent-default-model\n(?P<body>.*?)(?=^- id: |\Z)',
            composition.stdout)
        if model_row is None:
            raise SystemExit('canary: composed config did not contain one agent-default-model row')
        provider_row = re.search(r'(?m)^    provider: (\S+)\s*$', model_row.group('body'))
        provider = provider_row.group(1) if provider_row else None
        if provider != 'deepseek-official':
            raise SystemExit('canary: provider did not compose as deepseek-official')
        real = os.environ.get('DSH_CANARY_REAL') == '1'
        if real:
            if not env.get('DEEPSEEK_API_KEY'):
                raise SystemExit('DSH_CANARY_REAL=1 requires DEEPSEEK_API_KEY in the launch environment')
            server = None
        else:
            server = ThreadingHTTPServer(('127.0.0.1', 0), Stub)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            env['DEEPSEEK_API_KEY'] = 'canary-placeholder'
            env['DEEPSEEK_BASE_URL'] = f'http://127.0.0.1:{server.server_port}'

        first = subprocess.run(argv, input='Use the bash tool to run: printf dsh-live-tool-ok\nThen reply with the command output.\n',
                               text=True, capture_output=True, env=env)
        print_stream('event-stream-1', first.stdout)
        if first.returncode != 0:
            print(first.stderr, file=sys.stderr)
            raise SystemExit('canary: first dsh run exited nonzero')
        events = stream_events(first.stdout)
        kinds = [event.get('type') for event in events]
        for expected in ('session', 'tool_call', 'tool_result', 'status', 'final'):
            if expected not in kinds:
                raise SystemExit(f'canary: first stream lacks {expected}')
        session = next(event.get('sessionId') for event in events
                       if event.get('type') == 'session')
        result = next(event.get('result') for event in events
                      if event.get('type') == 'tool_result')
        if 'dsh-live-tool-ok' not in result:
            raise SystemExit('canary: tool result did not contain the command output')
        usage = [event.get('usage') for event in events
                 if event.get('type') == 'status' and event.get('phase') == 'step_end']
        if not usage:
            raise SystemExit('canary: status/step_end carried no usage')

        resume = subprocess.run(
            child_argv(str(home), DSH, tools, model, 'max', session),
            input='Reply with the word resumed.\n', text=True, capture_output=True, env=env)
        print_stream('event-stream-2', resume.stdout)
        if resume.returncode != 0:
            print(resume.stderr, file=sys.stderr)
            raise SystemExit('canary: resumed dsh run exited nonzero')
        resumed = stream_events(resume.stdout)
        if not any(event.get('type') == 'session' and event.get('sessionId') == session
                   for event in resumed):
            raise SystemExit('canary: resume did not adopt the recorded session')
        if not any(event.get('type') == 'status' and event.get('phase') == 'turn_start'
                   and event.get('turn') == 2 for event in resumed):
            raise SystemExit('canary: resume did not start turn 2')

        if server is not None:
            server.shutdown()
            server.server_close()
            mains = [request for _, request in Stub.requests if request.get('tools')]
            if not mains:
                raise SystemExit('canary: the stub received no model request with tools')
            request = mains[0]
            tool_names = sorted(tool['name'] for tool in request.get('tools', []))
            effort = (request.get('output_config') or {}).get('effort')
            print('composed-tools: ' + json.dumps(tool_names))
            print('composed-provider: ' + json.dumps(provider))
            print('composed-effort: ' + json.dumps(effort))
            print('composed-model: ' + json.dumps(request.get('model')))
            if tool_names != sorted(DSH_TOOLS + BRIDGE_TOOLS):
                raise SystemExit('canary: unexpected composed tool list')
            if effort != 'max':
                raise SystemExit('canary: reasoning effort did not reach the request')
            if request.get('model') != 'deepseek-flash':
                raise SystemExit('canary: the request did not carry the deepseek-flash model')
            if provider != 'deepseek-official':
                raise SystemExit('canary: the composed config did not carry the deepseek-official provider')
    return 0


if __name__ == '__main__':
    sys.exit(main())
