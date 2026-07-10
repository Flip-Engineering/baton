#!/usr/bin/env node
// fake-claude.mjs — a scriptable fake `claude` binary for zero-quota tests of ClaudeSessionCli.
//
// Speaks the REAL captured Claude Code stream-json wire shapes on stdout (system/init, assistant,
// result — see docs/reference/claude-agent-sdk.md and the verbatim CLAUDE_LINES fixture in
// test/cli-adapters.test.mjs) and reads the real INPUT shapes on stdin (line-delimited JSON: `user`
// message frames and `control_request`/`control_response` control-plane frames).
//
// The exact `interrupt` control-frame shape below is taken verbatim from the Agent SDK's own source
// (@anthropic-ai/claude-agent-sdk 0.3.205 sdk.mjs, local install): `Query.request()` builds
// `{request_id, type:"control_request", request}` and `Query.interrupt()` sends `{subtype:"interrupt"}`.
// See spec/phase8/claude-session-adapter.md §0 for full citations.
//
// Scripting surface (deterministic — driven by content MARKERS in the incoming user text, never by
// sleeps/timing, so tests never race):
//   "REQUEST_APPROVAL:<toolName>"  -> emits a can_use_tool control_request; blocks the turn until a
//                                     control_response answers it, then completes reflecting the
//                                     decision (approval is never a crash — see spec CS12).
//   "REQUEST_QUESTION"             -> emits an elicitation control_request; blocks until answered,
//                                     then completes reflecting the answer.
//   "HOLD_UNTIL_INTERRUPT"         -> emits one assistant text event, then blocks forever (no result)
//                                     until an interrupt control_request arrives.
//   "TRIGGER_CRASH"                -> writes to stderr and exits 1 immediately (simulates a genuine
//                                     vendor process failure, distinct from a mere tool denial).
//   anything else                  -> emits an assistant text event ("Echo: <text>") then a success
//                                     result.
//
// argv: --resume <id> / --session-id <id> pin the echoed session_id (real --resume semantics: the
// resumed session keeps its id). All other flags (--input-format, --output-format, --verbose,
// --print, --permission-prompt-tool, --model, ...) are accepted and ignored — this fixture only reacts
// to the flags it needs to fake session identity.
//
// env FAKE_CLAUDE_SESSION_ID: fallback for --resume/--session-id.
// env FAKE_CLAUDE_IGNORE_SIGTERM=1: install a no-op SIGTERM handler once, simulating an unresponsive
//   vendor process so a caller's kill() must escalate to SIGKILL to actually end it.
//
// Exits 0 when stdin closes (EOF) with nothing further to do — mirrors sdk.mjs's own contract:
// "stream-json input requires a readable stdin for the lifetime of the session."

import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

// Discovery guard (phase8 cross-cluster reconciliation R1): Node's test runner discovers
// EVERY .mjs file under test/ (node 25), including this fixture, and would execute it as a
// test file — where it blocks forever reading stdin and hangs the bare `node --test` run.
// The real ClaudeSessionCli ALWAYS passes `--input-format stream-json` (CS1), so its absence
// means we were not spawned by the adapter under test: exit inert, emitting nothing.
// (`--serve` is an explicit manual-run escape hatch.) Side effect: this also enforces CS1's
// argv contract over the real spawn path — an adapter that forgets the flag gets a dead child.
if (!process.argv.includes('--input-format') && !process.argv.includes('--serve')) {
  process.exit(0);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--resume' || a === '-r') out.resume = argv[i + 1];
    else if (a === '--session-id') out.sessionId = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const sessionId = args.resume || args.sessionId || process.env.FAKE_CLAUDE_SESSION_ID || randomUUID();

if (process.env.FAKE_CLAUDE_IGNORE_SIGTERM === '1') {
  process.on('SIGTERM', () => { /* deliberately unresponsive, for kill() escalation tests */ });
}

function send(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

let reqSeq = 0;
function nextRequestId() { return `freq_${(reqSeq += 1)}`; }

/** @type {Map<string, (response: object) => void>} request_id -> resolver for a pending control_request WE sent */
const pending = new Map();
/** @type {{kind:'approval'|'question'|'hold', requestId?: string} | null} */
let currentTurn = null;
const queue = [];

function emitAssistantText(text) {
  send({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}

function emitResult({ text = '', isError = false, stopReason = null } = {}) {
  send({
    type: 'result',
    subtype: isError ? 'error_during_execution' : 'success',
    is_error: isError,
    result: text,
    usage: { input_tokens: 10, output_tokens: Math.max(1, text.length) },
    total_cost_usd: 0.0001,
    stop_reason: stopReason,
  });
}

function drainQueue() {
  if (!currentTurn && queue.length > 0) startTurn(queue.shift());
}

function startTurn(text) {
  const approvalMatch = text.match(/REQUEST_APPROVAL:(\S+)/);
  if (approvalMatch) {
    const toolName = approvalMatch[1];
    const requestId = nextRequestId();
    currentTurn = { kind: 'approval', requestId };
    pending.set(requestId, (resp) => {
      currentTurn = null;
      if (resp && resp.behavior === 'allow') {
        emitAssistantText(`ran ${toolName} with ${JSON.stringify(resp.updatedInput ?? {})}`);
        emitResult({ text: `approved:${toolName}` });
      } else {
        emitAssistantText(`permission denied for ${toolName}`);
        emitResult({ text: `denied:${toolName}:${(resp && resp.message) || 'no reason given'}` });
      }
      drainQueue();
    });
    send({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'can_use_tool', tool_name: toolName, input: { command: 'echo hi' }, tool_use_id: `toolu_${requestId}` },
    });
    return;
  }

  if (text.includes('REQUEST_QUESTION')) {
    const requestId = nextRequestId();
    currentTurn = { kind: 'question', requestId };
    pending.set(requestId, (resp) => {
      currentTurn = null;
      const value = resp?.content?.value ?? '(no answer)';
      emitAssistantText(`heard: ${value}`);
      emitResult({ text: value });
      drainQueue();
    });
    send({
      type: 'control_request',
      request_id: requestId,
      request: { subtype: 'elicitation', mcp_server_name: 'baton-fake', message: text, elicitation_id: requestId },
    });
    return;
  }

  if (text.includes('HOLD_UNTIL_INTERRUPT')) {
    currentTurn = { kind: 'hold' };
    emitAssistantText('holding...');
    return; // deliberately no result — only an interrupt ends this turn
  }

  if (text.includes('TRIGGER_CRASH')) {
    process.stderr.write('fake-claude: simulated crash\n');
    process.exit(1);
  }

  emitAssistantText(`Echo: ${text}`);
  emitResult({ text });
  currentTurn = null;
  drainQueue();
}

function handleInterrupt(requestId) {
  send({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response: { still_queued: [] } } });
  if (currentTurn) {
    if (currentTurn.requestId) pending.delete(currentTurn.requestId);
    currentTurn = null;
    emitResult({ text: 'interrupted', stopReason: 'interrupted' });
  }
  drainQueue();
}

send({
  type: 'system',
  subtype: 'init',
  session_id: sessionId,
  cwd: process.cwd(),
  tools: [],
  model: 'claude-sonnet-5-fake',
  permissionMode: 'acceptEdits',
  apiKeySource: 'user',
  claude_code_version: '2.1.206-fake',
  capabilities: ['interrupt_receipt_v1'],
});

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line.trim()) return;
  let obj;
  try { obj = JSON.parse(line); } catch { return; }

  if (obj.type === 'user') {
    const text = (obj.message?.content ?? []).map((c) => c.text ?? '').join('');
    if (currentTurn) queue.push(text);
    else startTurn(text);
    return;
  }

  if (obj.type === 'control_request') {
    if (obj.request?.subtype === 'interrupt') { handleInterrupt(obj.request_id); return; }
    send({ type: 'control_response', response: { subtype: 'error', request_id: obj.request_id, error: `fake-claude: unsupported control_request subtype ${obj.request?.subtype}` } });
    return;
  }

  if (obj.type === 'control_response') {
    const requestId = obj.response?.request_id;
    const resolve = pending.get(requestId);
    if (resolve) { pending.delete(requestId); resolve(obj.response?.response); }
  }
});

rl.on('close', () => {
  process.exit(0);
});
