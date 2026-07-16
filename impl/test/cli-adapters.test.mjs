// cli-adapters.test.mjs — structural tests for the real subprocess adapters. NO live CLI is
// invoked (spawn is guarded behind live:true), so these cost zero quota. Parsers are checked
// against REAL captured output lines from `codex exec --json` and `claude -p --output-format
// stream-json` (captured 2026-07-10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
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
  assert.deepEqual(out[2].events.map((event) => event.kind), ['resource.provider_call', 'content.message']);
  assert.deepEqual(out[2].events[0].payload, { callId: 'item_0', phase: 'completed' });
});

test('one-shot usage is emitted before terminal with a matching explicit counter and truthful availability seal', () => {
  const codex = parseCodexEvent({ type: 'turn.completed', usage: { input_tokens: 7, output_tokens: 3 } }, 'w1', 'codex', 4);
  assert.equal(codex.beforeTerminal[0].kind, 'resource.tokens');
  assert.deepEqual(codex.beforeTerminal[0].payload, {
    source: 'result', accounting: 'delta', tokens: 10,
    counterId: 'cli:w1:4', tokenMetric: 'codex_turn_input_plus_output_tokens',
  });
  assert.deepEqual(codex.event.payload.usageSeal, {
    tokens: 'reported', usd: 'unavailable', counterId: 'cli:w1:4',
    tokenMetric: 'codex_turn_input_plus_output_tokens',
  });

  const missing = parseCodexEvent({ type: 'turn.completed', usage: { output_tokens: 3 } }, 'w1', 'codex', 5);
  assert.deepEqual(missing.beforeTerminal, []);
  assert.deepEqual(missing.event.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
});

test('one-shot usage never rounds inexact USD or emits an unsafe token sum', () => {
  const mixed = parseClaudeEvent({
    type: 'result', subtype: 'success', is_error: false, result: 'mixed',
    usage: { input_tokens: 10, output_tokens: 11 }, total_cost_usd: 0.1000000001,
  }, 'w1', 'claude', 6);
  assert.equal(mixed.beforeTerminal.length, 1);
  assert.deepEqual(mixed.beforeTerminal[0].payload, {
    source: 'result', accounting: 'delta', tokens: 21,
    counterId: 'cli:w1:6', tokenMetric: 'anthropic_input_plus_output_tokens_excluding_cache',
  });
  assert.deepEqual(mixed.event.payload.usageSeal, {
    tokens: 'reported', usd: 'unavailable', counterId: 'cli:w1:6',
    tokenMetric: 'anthropic_input_plus_output_tokens_excluding_cache',
  });
  assert.deepEqual(mixed.event.payload.result.budgetUsed, { tokens: 21, usd: 0 });

  const overflow = parseCodexEvent({
    type: 'turn.completed', usage: { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
  }, 'w2', 'codex', 7);
  assert.deepEqual(overflow.beforeTerminal, []);
  assert.deepEqual(overflow.event.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
  assert.deepEqual(overflow.event.payload.result.budgetUsed, { tokens: 0, usd: 0 });
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

test('parseClaudeEvent preserves text plus every tool_use with stable logical call ids and phases', () => {
  const parsed = parseClaudeEvent({
    type: 'assistant',
    message: {
      id: 'msg-native',
      content: [
        { type: 'text', text: 'working' },
        { type: 'tool_use', id: 'tool-a', name: 'Read', input: { path: 'a' } },
        { type: 'tool_use', id: 'tool-b', name: 'Edit', input: { path: 'b' } },
      ],
    },
  }, 'w1', 'claude', 2);
  assert.deepEqual(parsed.events.map((event) => event.kind), [
    'resource.provider_call', 'content.message', 'content.tool_call', 'content.tool_call',
  ]);
  assert.deepEqual(parsed.events[0].payload, { callId: 'msg-native', phase: 'completed' });
  assert.deepEqual(parsed.events.slice(2).map((event) => [event.payload.callId, event.payload.phase]), [
    ['tool-a', 'requested'], ['tool-b', 'requested'],
  ]);
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
  assert.deepEqual(new CodexCli().card().governance.usage, {
    tokens: 'native', usd: 'unavailable', tokenMetric: 'codex_turn_input_plus_output_tokens', terminalSeal: 'native',
  });
  assert.deepEqual(new ClaudeCli().card().governance.providerCalls, { observation: 'native', enforcement: 'unavailable' });
  assert.deepEqual(new PiCli().card().governance.usage, { tokens: 'unavailable', usd: 'unavailable', tokenMetric: null, terminalSeal: 'native' });
  assert.deepEqual(new CodexCli({ model: 'gpt-5.6-sol' }).card().modelSelection.configuredDefault, 'gpt-5.6-sol');
  assert.deepEqual(new ClaudeCli({ model: 'opus' }).card().modelSelection.reasoningEffort, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(new ZCodeCli({ model: 'glm-5.2' }).card().modelSelection.family, 'glm');
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

test('one-shot argv binds each coordinator-selected model and effort instead of constructor defaults', () => {
  const codex = new CodexCli({ model: 'constructor-model' })._cfg.args({}, { model: 'gpt-5.6-sol', reasoningEffort: 'low' });
  assert.deepEqual(codex.slice(codex.indexOf('-m')), ['-m', 'gpt-5.6-sol', '-c', 'model_reasoning_effort="low"']);
  const claude = new ClaudeCli({ model: 'constructor-model' })._cfg.args({}, { model: 'claude-opus-4-6', reasoningEffort: 'low' });
  assert.deepEqual(claude.slice(claude.indexOf('--model')), ['--model', 'claude-opus-4-6', '--effort', 'low']);
  const glm = new ZCodeCli({ model: 'constructor-model' })._cfg.args({}, { model: 'glm-5.2', reasoningEffort: 'low' });
  assert.deepEqual(glm.slice(glm.indexOf('--model')), ['--model', 'glm-5.2', '--effort', 'low']);
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
  assert.deepEqual(seen, ['lifecycle.turn_started', 'resource.provider_call', 'content.message', 'lifecycle.turn_completed']);
});

test('_onData orders authoritative usage before terminal and oversized frames fail closed without echoing provider bytes', () => {
  const ordered = new CodexCli();
  const events = [];
  ordered.onEvent((event) => events.push(event));
  ordered._onData({ worker: 'w1', terminal: false, turnEpoch: 3, buf: '', logicalSequence: 0 }, `${JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 1 } })}\n`);
  assert.deepEqual(events.map((event) => event.kind), ['resource.tokens', 'lifecycle.turn_completed']);
  assert.equal(events[0].payload.counterId, events[1].payload.usageSeal.counterId);

  const bounded = new CodexCli({ maxWireFrameBytes: 32 });
  const failures = [];
  bounded.onEvent((event) => failures.push(event));
  const session = { worker: 'w2', terminal: false, turnEpoch: 1, buf: '', logicalSequence: 0 };
  bounded._onData(session, `{"secret":"${'x'.repeat(64)}"}\n`);
  assert.equal(session.buf, '');
  assert.equal(session.turnSettled, true);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].payload, {
    error: 'provider wire frame exceeded configured byte ceiling', code: 'wire_frame_oversize', phase: 'wire',
    usageSeal: { tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null },
  });
  assert.doesNotMatch(JSON.stringify(failures), /xxxxxxxx/);
});

test('oversized one-shot wire frame kills and exactly reaps the owned process group before kill.confirmed', async (t) => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    detached: true,
    stdio: 'ignore',
  });
  t.after(() => {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exactly reaped */ }
  });
  await once(child, 'spawn');

  const adapter = new CodexCli({ maxWireFrameBytes: 32 });
  const events = [];
  let resolveConfirmed;
  const confirmed = new Promise((resolve) => { resolveConfirmed = resolve; });
  adapter.onEvent((event) => {
    events.push(event);
    if (event.kind === 'kill.confirmed') resolveConfirmed(event);
  });
  const session = {
    worker: 'wire-close-worker', child, terminal: false, turnSettled: false,
    processClosePending: false, processClosedEmitted: false, processGeneration: 1,
    processReapTimeoutMs: 2000, turnEpoch: 1, buf: '', logicalSequence: 0,
    spawnError: null, timeoutFailure: null,
  };
  adapter._sessions.set(session.worker, session);
  child.once('close', (code, signal) => adapter._onClose(session, code, signal));

  adapter._onData(session, `{"secret":"${'z'.repeat(64)}"}\n`);
  let timeout;
  const killEvent = await Promise.race([
    confirmed,
    new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('kill confirmation timed out after oversized-frame close')), 3000); }),
  ]).finally(() => clearTimeout(timeout));

  assert.equal(session.terminal, true);
  assert.equal(session.processClosedEmitted, true);
  assert.deepEqual(events.map((event) => event.kind), [
    'lifecycle.crashed', 'lifecycle.process_closed', 'kill.confirmed',
  ]);
  assert.equal(events.filter((event) => event.kind === 'kill.confirmed').length, 1);
  assert.equal(events.filter((event) => event.kind === 'lifecycle.process_reap_unconfirmed').length, 0);
  assert.equal(killEvent.actor, 'worker');
  assert.equal(killEvent.payload.terminalCause, 'wire_frame_oversize');
  assert.deepEqual(killEvent.payload.usageSeal, {
    tokens: 'unavailable', usd: 'unavailable', counterId: null, tokenMetric: null,
  });
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
