// cli-adapters.test.mjs — structural tests for the real subprocess adapters. NO live CLI is
// invoked (spawn is guarded behind live:true), so these cost zero quota. Parsers are checked
// against REAL captured output lines from `codex exec --json` and `claude -p --output-format
// stream-json` (captured 2026-07-10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CodexCli, ClaudeCli, ZCodeCli, PiCli, CLI_ADAPTERS,
  parseCodexEvent, parseClaudeEvent, renderPrompt,
} from '../src/cli-adapters.mjs';
import { assertIsAdapter } from '../src/adapter.mjs';

// Real captured lines (verbatim shapes).
const CODEX_LINES = [
  { type: 'thread.started', thread_id: '019f4b9a' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'HELLO' } },
  { type: 'turn.completed', usage: { input_tokens: 18089, output_tokens: 6 } },
];
const CLAUDE_LINES = [
  { type: 'system', subtype: 'init', session_id: 's1', cwd: '/tmp' },
  { type: 'assistant', message: { content: [{ type: 'thinking', thinking: '' }] } },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'HELLO' }], usage: { output_tokens: 3 } } },
  { type: 'result', subtype: 'success', is_error: false, result: 'HELLO', total_cost_usd: 0.01, usage: { output_tokens: 3 } },
];

// ---------- codex parser ----------

test('parseCodexEvent maps the real event stream: turn.started->turn_started, agent_message->message, turn.completed->terminal', () => {
  const out = CODEX_LINES.map((o) => parseCodexEvent(o, 'w1', 'codex@0.144.0', 1));
  assert.equal(out[0].event, undefined, 'thread.started is not surfaced');
  assert.equal(out[1].event.kind, 'lifecycle.turn_started');
  assert.equal(out[2].event.kind, 'content.message');
  assert.equal(out[2].message, 'HELLO');
  assert.equal(out[3].terminal, true);
  assert.equal(out[3].event.kind, 'lifecycle.turn_completed');
  assert.equal(out[3].event.payload.result.status, 'completed');
  assert.equal(out[3].event.worker, 'w1');
});

test('parseCodexEvent surfaces command_execution and file_change items, and treats turn.failed/error as a crash', () => {
  const cmd = parseCodexEvent({ type: 'item.completed', item: { type: 'command_execution', command: 'ls', exit_code: 0 } }, 'w1', 'codex', 1);
  assert.equal(cmd.event.kind, 'content.tool_call');
  const edit = parseCodexEvent({ type: 'item.completed', item: { type: 'file_change', changes: [] } }, 'w1', 'codex', 1);
  assert.equal(edit.event.kind, 'content.file_edit');
  const failed = parseCodexEvent({ type: 'turn.failed', error: { message: 'boom' } }, 'w1', 'codex', 1);
  assert.equal(failed.crashed, true);
  assert.equal(failed.event.kind, 'lifecycle.crashed');
});

// ---------- claude parser ----------

test('parseClaudeEvent maps the real stream: system.init->turn_started, assistant text->message, result success->terminal', () => {
  const out = CLAUDE_LINES.map((o) => parseClaudeEvent(o, 'w1', 'claude@2.1', 1));
  assert.equal(out[0].event.kind, 'lifecycle.turn_started');
  assert.equal(out[1].event, undefined, 'a thinking-only assistant message is not surfaced');
  assert.equal(out[2].event.kind, 'content.message');
  assert.equal(out[2].message, 'HELLO');
  assert.equal(out[3].terminal, true);
  assert.equal(out[3].event.kind, 'lifecycle.turn_completed');
  assert.equal(out[3].event.payload.result.summary, 'HELLO');
});

test('parseClaudeEvent: an is_error result is a crash; a tool_use assistant message is a tool_call', () => {
  const err = parseClaudeEvent({ type: 'result', is_error: true, result: 'failed', subtype: 'error' }, 'w1', 'claude', 1);
  assert.equal(err.crashed, true);
  const tool = parseClaudeEvent({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Edit', input: { path: 'a' } }] } }, 'w1', 'claude', 1);
  assert.equal(tool.event.kind, 'content.tool_call');
  assert.equal(tool.event.payload.name, 'Edit');
});

// ---------- cards + conformance ----------

test('all CLI adapters conform to the session Adapter interface', () => {
  assert.doesNotThrow(() => assertIsAdapter(new CodexCli()));
  assert.doesNotThrow(() => assertIsAdapter(new ClaudeCli()));
  assert.doesNotThrow(() => assertIsAdapter(new ZCodeCli()));
  assert.doesNotThrow(() => assertIsAdapter(new PiCli()));
});

test('cards report the right harness identity and concurrency; GLM/Z-Code is pinned to ceiling 1', () => {
  assert.equal(new CodexCli().card().harness, 'codex');
  assert.equal(new ClaudeCli().card().harness, 'claude-code');
  const z = new ZCodeCli().card();
  assert.equal(z.harness, 'glm-via-claude');
  assert.equal(z.concurrencyCeiling, 1, 'Z.ai Pro ≈ 1 in-flight is a hard limit');
  assert.equal(new CodexCli().card().verbs.interrupt, 'emulated');
});

test('Z-Code injects the Z.ai Anthropic-compatible endpoint into the child env', () => {
  const z = new ZCodeCli({ authToken: 'test-key', model: 'glm-5.2' });
  assert.equal(z._cfg.env.ANTHROPIC_BASE_URL, 'https://api.z.ai/api/anthropic');
  assert.equal(z._cfg.env.ANTHROPIC_AUTH_TOKEN, 'test-key');
  assert.equal(z._cfg.env.ANTHROPIC_DEFAULT_OPUS_MODEL, 'glm-5.2');
});

test('argv: codex uses exec --json workspace-write; claude uses -p stream-json acceptEdits', () => {
  const cargs = new CodexCli()._cfg.args({});
  assert.ok(cargs.includes('exec') && cargs.includes('--json') && cargs.includes('workspace-write'));
  const clargs = new ClaudeCli()._cfg.args({});
  assert.ok(clargs.includes('-p') && clargs.includes('stream-json') && clargs.includes('acceptEdits'));
});

// ---------- the live guard + Pi placeholder ----------

test('spawn() with live:false refuses to launch a real CLI (never spends quota by accident)', async () => {
  const ack = await new CodexCli().spawn('w1', { goal: 'x', verification: { command: 'true', expectExit: 0 } }, { live: false, worktree: '/tmp' });
  assert.equal(ack.ok, false);
  assert.match(ack.reason, /live:false/);
});

test('PiCli is an inert placeholder until configured with a real command', async () => {
  const bare = new PiCli();
  assert.equal(bare.card().verbs.spawn, 'unsupported');
  const ack = await bare.spawn('w1', {}, { live: true, worktree: '/tmp' });
  assert.equal(ack.ok, false, 'unconfigured Pi refuses to spawn');
  const configured = new PiCli({ cmd: 'pi', args: () => ['run'] });
  assert.equal(configured.card().verbs.spawn, 'native');
});

// ---------- prompt rendering ----------

test('renderPrompt puts the pinned verification command in the brief so the worker aims at the real check', () => {
  const p = renderPrompt({ goal: 'add rate limiting', constraints: ['no deps'], pathScope: ['src/**'], definitionOfDone: 'tests pass', verification: { command: 'npm test', expectExit: 0 } });
  assert.match(p, /add rate limiting/);
  assert.match(p, /npm test/);
  assert.match(p, /src\/\*\*/);
});

test('_onData emits each terminal event exactly once and ignores trailing output after terminal', () => {
  // Drives the real stdout parse/emit path with a synthetic stream — NO child process, zero quota.
  const a = new CodexCli();
  const seen = [];
  a.onEvent((e) => seen.push(e.kind));
  const session = { worker: 'w1', terminal: false, turnEpoch: 1, buf: '' };
  // A stream that turn.completes, then keeps emitting (a real CLI can print usage/error lines after).
  const stream = [
    { type: 'turn.started' },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } },
    { type: 'turn.completed', usage: { output_tokens: 1 } },
    { type: 'error', message: 'you hit your usage limit' }, // trailing, must be ignored
    { type: 'turn.failed', error: { message: 'also trailing' } },
  ].map((o) => JSON.stringify(o)).join('\n') + '\n';
  a._onData(session, stream);
  assert.equal(session.turnSettled, true);
  assert.equal(session.terminal, false);
  assert.equal(seen.filter((k) => k === 'lifecycle.turn_completed').length, 1, 'exactly one terminal');
  assert.equal(seen.filter((k) => k === 'lifecycle.crashed').length, 0, 'no crash after a clean terminal');
  assert.deepEqual(seen, ['lifecycle.turn_started', 'content.message', 'lifecycle.turn_completed']);
});

test('_onData handles a split terminal line arriving across two chunks without duplicating it', () => {
  const a = new CodexCli();
  const seen = [];
  a.onEvent((e) => seen.push(e.kind));
  const session = { worker: 'w1', terminal: false, turnEpoch: 1, buf: '' };
  const full = JSON.stringify({ type: 'turn.completed', usage: {} }) + '\n';
  a._onData(session, full.slice(0, 10));   // partial — no newline yet
  assert.equal(seen.length, 0, 'nothing emitted until the line completes');
  a._onData(session, full.slice(10));      // completes the line
  assert.deepEqual(seen, ['lifecycle.turn_completed']);
});

test('CLI_ADAPTERS registry maps the harness names the user asked for', () => {
  assert.equal(CLI_ADAPTERS.codex, CodexCli);
  assert.equal(CLI_ADAPTERS.claude, ClaudeCli);
  assert.equal(CLI_ADAPTERS.zcode, ZCodeCli);
  assert.equal(CLI_ADAPTERS.glm, ZCodeCli);
  assert.equal(CLI_ADAPTERS.pi, PiCli);
});
