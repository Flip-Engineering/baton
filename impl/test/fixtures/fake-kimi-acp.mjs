import { appendFileSync } from 'node:fs';

if (!process.argv.includes('--serve')) process.exit(0);
const mode = process.env.FAKE_KIMI_MODE ?? 'normal';
let buffer = '';
let promptId = null;
let reversePromptId = null;
const configOptions = () => [
  {
    type: 'select', id: 'model', currentValue: mode === 'model-mismatch' ? 'kimi-code/other' : 'kimi-code/k3',
    options: mode === 'model-absent'
      ? [{ value: 'kimi-code/other', name: 'Other' }]
      : [{ value: 'kimi-code/k3', name: 'K3' }],
  },
  { type: 'select', id: 'thinking', currentValue: 'on', options: [{ value: 'on', name: 'Thinking On' }] },
  { type: 'select', id: 'mode', currentValue: 'default', options: [
    { value: 'default', name: 'Default' }, { value: 'auto', name: 'Auto' }, { value: 'yolo', name: 'YOLO' },
  ] },
];
const write = (frame) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...frame })}\n`);
const record = (frame) => {
  if (process.env.FAKE_KIMI_LOG) appendFileSync(process.env.FAKE_KIMI_LOG, `${JSON.stringify(frame)}\n`);
};
if (process.env.FAKE_KIMI_ENV_LOG) {
  appendFileSync(process.env.FAKE_KIMI_ENV_LOG, JSON.stringify({
    effort: process.env.KIMI_MODEL_THINKING_EFFORT ?? null,
    home: process.env.KIMI_CODE_HOME ? 'private' : null,
  }));
}
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  let newline;
  while ((newline = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, newline);
    buffer = buffer.slice(newline + 1);
    if (!line) continue;
    const frame = JSON.parse(line);
    record(frame);
    if (frame.method === 'hang') continue;
    if (frame.method === 'malformed') { process.stdout.write('{bad json\n'); continue; }
    if (frame.method === 'oversize') { process.stdout.write(`${'x'.repeat(2048)}\n`); continue; }
    if (frame.method === 'close') { process.exit(7); }
    if (frame.method === 'truncated') { process.stdout.write('{"jsonrpc":"2.0"'); process.exit(8); }
    if (frame.method === 'uncorrelated') { write({ id: Number(frame.id) + 100, result: {} }); continue; }
    if (frame.method === 'notify-then-hang') { write({ method: 'session/update', params: { update: {} } }); continue; }
    if (frame.method === 'reverse') {
      write({ id: 'server-1', method: 'fs/read_text_file', params: { path: 'allowed.txt' } });
      continue;
    }
    if (frame.id === 'server-1') { write({ id: 1, result: frame.result }); continue; }
    if (mode === 'out-of-order' && frame.method === 'slow') {
      setTimeout(() => write({ id: frame.id, result: { method: frame.method } }), 30);
      continue;
    }
    if (frame.method === 'initialize') {
      write({
        id: frame.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: mode === 'wrong-agent' ? 'Other Agent' : 'Kimi Code CLI', version: '0.27.0' },
          authMethods: mode === 'no-auth' ? [] : [{ id: 'login', name: 'Log in' }],
          agentCapabilities: { loadSession: true, sessionCapabilities: { list: {}, resume: {} } },
        },
      });
      continue;
    }
    if (frame.method === 'authenticate') {
      if (mode === 'auth-fail') write({ id: frame.id, error: { code: -32000, message: 'auth required' } });
      else write({ id: frame.id, result: {} });
      continue;
    }
    if (['session/new', 'session/load', 'session/resume'].includes(frame.method)) {
      const requested = frame.params?.sessionId;
      write({
        id: frame.id,
        result: {
          sessionId: mode === 'session-mismatch' ? 'substituted' : requested ?? 'kimi-session-1',
          configOptions: configOptions(),
        },
      });
      continue;
    }
    if (frame.method === 'session/set_config_option') {
      const options = configOptions().map((option) => option.id === frame.params.configId
        ? { ...option, currentValue: mode === 'set-mismatch' ? option.currentValue : frame.params.value }
        : option);
      write({ method: 'session/update', params: { update: { sessionUpdate: 'config_option_update', configOptions: options } } });
      write({ id: frame.id, result: { configOptions: options } });
      continue;
    }
    if (frame.method === 'session/prompt') {
      promptId = frame.id;
      if (mode === 'stream-flood') {
        for (let index = 0; index < 100; index += 1) {
          write({ method: 'session/update', params: { update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'thought-' } } } });
        }
        for (let index = 0; index < 50; index += 1) {
          write({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'message-' } } } });
        }
        write({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call', toolCallId: 'flood-tool', status: 'pending' } } });
        for (let index = 0; index < 100; index += 1) {
          write({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'flood-tool', status: 'in_progress' } } });
        }
        write({ method: 'session/update', params: { update: { sessionUpdate: 'tool_call_update', toolCallId: 'flood-tool', status: 'completed' } } });
      }
      write({ method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: mode.startsWith('secret-') ? process.env.FAKE_SECRET : 'ok' } } } });
      if (mode === 'permission') {
        reversePromptId = frame.id;
        write({
          id: 'permission-1',
          method: 'session/request_permission',
          params: {
            sessionId: frame.params.sessionId,
            toolCall: { toolCallId: 'tool-1', title: 'Edit file' },
            options: [{ optionId: 'allow-1', kind: 'allow_once' }, { optionId: 'deny-1', kind: 'reject_once' }],
          },
        });
        continue;
      }
      if (mode === 'prompt-hang' || mode === 'secret-hang') continue;
      write({ id: frame.id, result: { stopReason: mode === 'max-steps' ? 'max_steps' : 'end_turn' } });
      promptId = null;
      continue;
    }
    if (frame.method === 'session/cancel') {
      if (promptId !== null) {
        write({ id: promptId, result: { stopReason: 'cancelled' } });
        promptId = null;
      }
      continue;
    }
    if (frame.id === 'permission-1') {
      write({ id: reversePromptId, result: { stopReason: 'end_turn' } });
      reversePromptId = null;
      promptId = null;
      continue;
    }
    if (frame.id !== undefined) write({ id: frame.id, result: { method: frame.method } });
  }
});
