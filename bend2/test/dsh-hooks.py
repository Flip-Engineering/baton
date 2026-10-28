"""DSH input and completion hooks (bend2/scripts/dsh-baton-hooks.mjs).

The unit tests drive the plugin with a fake DSH context and a fake retained
entry. The live test starts the official `dsh` against a local Messages-compatible
stub, mounts the plugin through the production tool patch and checks the model
requests the stub receives. It needs DSH_CLI and the DSH fixture
(BATON2_EXE, default .scratch/bend2/dsh-player-test) and is skipped without them.
"""
import json
import os
import pathlib
import shutil
import subprocess
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[2]
PLUGIN = ROOT / 'bend2/scripts/dsh-baton-hooks.mjs'
NODE = os.environ.get('NODE', 'node')
DSH = os.environ.get('DSH_CLI') or shutil.which('dsh')
FIXTURE = pathlib.Path(os.environ.get('BATON2_EXE', ROOT / '.scratch/bend2/dsh-player-test'))

# The fake retained entry answers by hook event from files in its directory and
# records every event it receives.
ENTRY = '''#!/bin/sh
here=$(dirname "$0")
input=$(cat)
event=$(printf '%s' "$input" | sed -n 's/.*"hook_event_name":"\\([A-Za-z]*\\)".*/\\1/p')
printf '%s %s\\n' "$event" "$*" >> "$here/events"
[ -e "$here/exit-$event" ] && { printf 'retained entry failure\n' >&2; exit 7; }
if [ -e "$here/once-$event" ] && [ ! -e "$here/done-$event" ]; then
  touch "$here/done-$event"
  cat "$here/once-$event"
elif [ -e "$here/answer-$event" ]; then
  cat "$here/answer-$event"
fi
'''

CONTEXT = {'hookSpecificOutput': {'hookEventName': 'PostToolUse',
                                  'additionalContext': 'Baton input for this turn.\nMessage (guidance) from lead [id: g1]:\nuse the new plan'}}
BLOCK = {'decision': 'block', 'reason': 'Assignment a1 is still open and you have sent no completion request.'}

DRIVER = '''
import { %(names)s } from %(plugin)s;
%(body)s
'''


class Entry:
    def __init__(self, root):
        self.root = pathlib.Path(root)
        self.path = self.root / 'entry'
        self.path.write_text(ENTRY)
        self.path.chmod(0o700)

    def answer(self, event, value, once=False):
        (self.root / (('once-' if once else 'answer-') + event)).write_text(json.dumps(value))

    def fail(self, event):
        (self.root / ('exit-' + event)).write_text('')

    def invalid(self, event):
        (self.root / ('answer-' + event)).write_text('not-json')

    def events(self):
        path = self.root / 'events'
        return [line.split()[0] for line in path.read_text().splitlines()] if path.exists() else []

    def arguments(self):
        path = self.root / 'events'
        return [line.split(None, 1)[1] for line in path.read_text().splitlines()]


def node(names, body, env=None):
    code = DRIVER % {'names': names, 'plugin': json.dumps(PLUGIN.as_uri()), 'body': body}
    environment = {key: os.environ[key] for key in ('PATH', 'LANG', 'HOME') if key in os.environ}
    environment.update(env or {})
    result = subprocess.run([NODE, '--input-type=module', '-e', code], env=environment,
                            text=True, capture_output=True)
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return result.stdout


class HookPlugin(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.entry = Entry(self.temp.name)
        self.env = {'BATON_STOP_HOOK': str(self.entry.path), 'BATON_DATABASE': '/db',
                    'BATON_SESSION': 'dsh-seat'}

    def drive(self, body, names='apply'):
        return node(names, body, self.env)

    def test_plugin_registers_both_boundaries_and_delivers_through_the_entry(self):
        self.entry.answer('PostToolUse', CONTEXT)
        out = json.loads(self.drive('''
          const handlers = {};
          apply({ on: (name, handler) => { handlers[name] = handler; } });
          const decision = await handlers['agent/pre-step']({ messages: [{ id: 'first' }] },
            async () => ({ kind: 'enter', messages: [{ id: 'first' }] }));
          console.log(JSON.stringify({ names: Object.keys(handlers).sort(), decision }));
        '''))
        self.assertEqual(out['names'], ['agent/pre-step', 'agent/turn-stopping'])
        self.assertEqual(out['decision']['kind'], 'enter')
        self.assertEqual(out['decision']['messages'][0], {'id': 'first'})
        added = out['decision']['messages'][1]
        self.assertEqual(added['role'], 'user')
        self.assertIn('use the new plan', added['content'][0]['text'])
        self.assertEqual(self.entry.events(), ['PostToolUse'])
        self.assertEqual(self.entry.arguments(), ['--stop-hook'])

    def test_step_without_owed_input_keeps_its_messages(self):
        out = json.loads(self.drive('''
          const handlers = {};
          apply({ on: (name, handler) => { handlers[name] = handler; } });
          const decision = await handlers['agent/pre-step']({ messages: [] },
            async () => ({ kind: 'enter', messages: [{ id: 'only' }] }));
          console.log(JSON.stringify(decision));
        '''))
        self.assertEqual(out, {'kind': 'enter', 'messages': [{'id': 'only'}]})

    def test_rejected_step_is_not_changed_and_reads_nothing(self):
        self.entry.answer('PostToolUse', CONTEXT)
        out = json.loads(self.drive('''
          const handlers = {};
          apply({ on: (name, handler) => { handlers[name] = handler; } });
          console.log(JSON.stringify(await handlers['agent/pre-step']({ messages: [] },
            async () => ({ kind: 'reject' }))));
        '''))
        self.assertEqual(out, {'kind': 'reject'})
        self.assertEqual(self.entry.events(), [])

    def stopping(self):
        return json.loads(self.drive('''
          const handlers = {};
          apply({ on: (name, handler) => { handlers[name] = handler; } });
          const steered = [];
          await handlers['agent/turn-stopping']({ agent: { steer: message => steered.push(message) } });
          console.log(JSON.stringify(steered));
        '''))

    def test_turn_end_with_owed_input_steers_the_delivered_bodies(self):
        self.entry.answer('PostToolUse', CONTEXT)
        steered = self.stopping()
        self.assertEqual(len(steered), 1)
        self.assertIn('use the new plan', steered[0]['content'][0]['text'])
        self.assertEqual(self.entry.events(), ['PostToolUse'])

    def test_turn_end_with_an_open_assignment_steers_the_gate_reason(self):
        self.entry.answer('Stop', BLOCK)
        steered = self.stopping()
        self.assertEqual(len(steered), 1)
        text = steered[0]['content'][0]['text']
        self.assertIn('no completion request', text)
        self.assertIn('completion_request', text)
        self.assertEqual(self.entry.events(), ['PostToolUse', 'Stop'])

    def test_turn_end_with_nothing_owed_lets_the_turn_close(self):
        self.assertEqual(self.stopping(), [])
        self.assertEqual(self.entry.events(), ['PostToolUse', 'Stop'])

    def test_failed_entry_blocks_turn_closure_with_the_process_cause(self):
        self.entry.fail('PostToolUse')
        self.entry.fail('Stop')
        self.entry.answer('Stop', BLOCK)
        out = self.drive('''
          const handlers = {};
          apply({ on: (name, handler) => { handlers[name] = handler; } });
          try {
            await handlers['agent/turn-stopping']({ agent: { steer() {} } });
            console.log(JSON.stringify({ returned: true }));
          } catch (error) { console.log(JSON.stringify({ returned: false, message: error.message })); }
        ''')
        result = json.loads(out)
        self.assertFalse(result['returned'])
        self.assertIn('exited with code 7', result['message'])
        self.assertIn('retained entry failure', result['message'])

    def test_missing_entry_cannot_pass_the_completion_gate(self):
        env = dict(self.env, BATON_STOP_HOOK=str(pathlib.Path(self.temp.name) / 'missing-entry'))
        out = node('runHook', '''
          try { await runHook('Stop'); console.log(JSON.stringify({ returned: true })); }
          catch (error) { console.log(JSON.stringify({ returned: false, message: error.message })); }
        ''', env=env)
        result = json.loads(out)
        self.assertFalse(result['returned'])
        self.assertIn('could not run', result['message'])
        self.assertIn('missing-entry', result['message'])

    def test_invalid_entry_output_cannot_pass_the_completion_gate(self):
        self.entry.invalid('Stop')
        out = self.drive('''
          try { await gateReason(); console.log(JSON.stringify({ returned: true })); }
          catch (error) { console.log(JSON.stringify({ returned: false, message: error.message })); }
        ''', names='gateReason')
        result = json.loads(out)
        self.assertFalse(result['returned'])
        self.assertIn('returned invalid JSON', result['message'])
        self.assertIn('not-json', result['message'])

    def test_plugin_is_inert_without_the_launch_environment(self):
        self.env = {}
        out = self.drive('''
          let registered = 0;
          apply({ on: () => { registered += 1; } });
          console.log(registered);
        ''')
        self.assertEqual(out.strip(), '0')

    def test_git_configuration_pairs_reach_git_through_parameters(self):
        repo = pathlib.Path(self.temp.name) / 'repo'
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        self.env.update(GIT_CONFIG_COUNT='3', GIT_CONFIG_KEY_0='core.quotePath', GIT_CONFIG_VALUE_0='false',
                        GIT_CONFIG_KEY_1='credential.helper', GIT_CONFIG_VALUE_1="!node 'helper path' --flag",
                        GIT_CONFIG_KEY_2='http.extraHeader', GIT_CONFIG_VALUE_2='',
                        GIT_CONFIG_PARAMETERS="'user.name'='Existing Name'")
        out = json.loads(self.drive('''
          const environment = { ...process.env };
          foldGitConfiguration(environment);
          console.log(JSON.stringify(environment));
        ''', names='foldGitConfiguration'))
        for name in out:
            self.assertFalse(name.startswith('GIT_CONFIG_KEY_') or name.startswith('GIT_CONFIG_VALUE_'), name)
        self.assertNotIn('GIT_CONFIG_COUNT', out)
        child = {key: value for key, value in out.items() if key.startswith(('PATH', 'HOME', 'GIT_CONFIG'))}

        def configured(key):
            return subprocess.run(['git', '-C', str(repo), 'config', '--get', key], env=child,
                                  text=True, capture_output=True).stdout.rstrip('\n')
        self.assertEqual(configured('core.quotePath'), 'false')
        self.assertEqual(configured('credential.helper'), "!node 'helper path' --flag")
        self.assertEqual(configured('user.name'), 'Existing Name')


class StubModel(BaseHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'
    requests = []
    after_tool_step = None

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('content-length', '0'))))
        self.requests.append(body)
        main = [request for request in self.requests if request.get('tools')]
        if not body.get('tools'):
            payload = sse_text('title')
        elif len(main) == 1:
            payload = sse_text('', tool=('bash', {'command': 'printf tool-ok'}))
            if self.after_tool_step:
                self.after_tool_step()
        else:
            payload = sse_text('step-%d' % len(main))
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.send_header('connection', 'close')
        self.end_headers()
        self.wfile.write(payload)
        self.wfile.flush()

    def log_message(self, *args):
        pass


def sse_text(text, tool=None):
    if tool:
        start = {'type': 'content_block_start', 'index': 0,
                 'content_block': {'type': 'tool_use', 'id': 'toolu_1', 'name': tool[0], 'input': {}}}
        delta = {'type': 'content_block_delta', 'index': 0,
                 'delta': {'type': 'input_json_delta', 'partial_json': json.dumps(tool[1])}}
        stop = 'tool_use'
    else:
        start = {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}
        delta = {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': text}}
        stop = 'end_turn'
    events = [
        ('message_start', {'type': 'message_start', 'message': {
            'id': 'msg_hooks', 'type': 'message', 'role': 'assistant', 'model': 'deepseek-flash',
            'content': [], 'stop_reason': None, 'stop_sequence': None,
            'usage': {'input_tokens': 11, 'output_tokens': 0}}}),
        ('content_block_start', start), ('content_block_delta', delta),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': stop, 'stop_sequence': None},
                           'usage': {'output_tokens': 7, 'input_tokens': 11}}),
        ('message_stop', {'type': 'message_stop'}),
    ]
    return ''.join(f'event: {name}\ndata: {json.dumps(value)}\n\n' for name, value in events).encode()


@unittest.skipUnless(DSH and FIXTURE.is_file(), 'set DSH_CLI and build the DSH player fixture')
class LiveDsh(unittest.TestCase):
    def test_owed_input_reaches_the_next_step_and_the_gate_holds_the_turn_open(self):
        StubModel.requests = []
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            (root / 'entry-dir').mkdir()
            entry = Entry(root / 'entry-dir')
            attempt = root / 'attempt'
            attempt.mkdir()
            subprocess.run([str(FIXTURE), 'prepare', str(attempt), 'deepseek/deepseek-flash', 'max',
                            str(PLUGIN)], check=True, capture_output=True)
            self.assertIn(f"name: '{PLUGIN}'", (attempt / 'dsh-tools.patch.yml').read_text())

            # Input becomes owed while the tool call runs: the entry starts answering
            # once the stub has served the tool-call step.
            def owe_input():
                entry.answer('PostToolUse', CONTEXT, once=True)
                entry.answer('Stop', BLOCK, once=True)
            StubModel.after_tool_step = owe_input
            self.addCleanup(setattr, StubModel, 'after_tool_step', None)
            server = ThreadingHTTPServer(('127.0.0.1', 0), StubModel)
            threading.Thread(target=server.serve_forever, daemon=True).start()
            self.addCleanup(server.server_close)
            self.addCleanup(server.shutdown)
            environment = dict(os.environ, DSH_HOME=str(root / 'home'), DEEPSEEK_API_KEY='placeholder',
                               DEEPSEEK_BASE_URL=f'http://127.0.0.1:{server.server_port}',
                               BATON_STOP_HOOK=str(entry.path), BATON_DATABASE='/db', BATON_SESSION='dsh-seat')
            work = root / 'work'
            work.mkdir()
            run = subprocess.run(
                [DSH, '--profile', 'headless', '--patch', str(attempt / 'dsh-tools.patch.yml'),
                 '--patch', str(attempt / 'dsh-model.patch.yml'), '--json'],
                input='Run the tool, then answer.\n', text=True, capture_output=True, env=environment,
                cwd=work)
            self.assertEqual(run.returncode, 0, run.stderr)
            main = [request for request in StubModel.requests if request.get('tools')]
            texts = [json.dumps(request['messages']) for request in main]
            self.assertNotIn('use the new plan', texts[0])
            # The step after the tool result carries the delivered body.
            self.assertIn('use the new plan', texts[1])
            # The answer was about to close the turn: the gate steered once more.
            self.assertTrue(any('no completion request' in text for text in texts[2:]), texts[2:])
            self.assertEqual(entry.events().count('Stop'), 2)
            frames = [json.loads(line) for line in run.stdout.splitlines() if line.startswith('{')]
            self.assertEqual(frames[-1]['type'], 'final')


if __name__ == '__main__':
    unittest.main()
