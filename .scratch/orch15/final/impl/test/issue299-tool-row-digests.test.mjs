// Issue #299: a worker's content.tool_call rows used to carry {tool, toolCallId, phase} and
// nothing else, so when a participant's publish was refused its orchestrator could not see what
// it had sent or been told without opening the worker's home directory. Every adapter now writes
// bounded, redacted digests of the arguments and the result — derived by the ONE redaction set
// and bound the referee's own evidence path uses (verifier-diagnostics.mjs) — or a typed
// unobserved marker, and the member views project the last N rows straight from the ledger.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';

import {
  MAX_VERIFIER_FAILURE_TAIL_BYTES,
  TOOL_EVIDENCE_UNOBSERVED,
  toolCallArgumentDigest,
  toolCallResultDigest,
} from '../src/verifier-diagnostics.mjs';
import { CodexAppServerCli } from '../src/codex-appserver.mjs';
import { GrokAcpCli } from '../src/grok-acp.mjs';
import { KimiAcpCli } from '../src/kimi-acp.mjs';
import { ClaudeSessionCli } from '../src/claude-session.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { SwarmRuntime } from '../src/swarm-runtime.mjs';
import { Coordinator } from '../src/coordinator.mjs';
import { Log } from '../src/log.mjs';
import { FenceTable } from '../src/fence.mjs';
import { coordinationForLog } from '../src/coordination-store.mjs';
import { FRAME_LIMITS } from '../src/limits.mjs';

// Credential-shaped values the redaction set must keep out of every row. Each matches one of the
// SECRET_PATTERNS the referee's failure capsule already applies to captured output.
const TOKEN_SHAPES = [
  ['api key assignment', 'export API_KEY=abcdefghijklmnopqrstuvwxyz012345'],
  ['openai style key', 'use sk-proj-abcdefghijklmnopqrstu directly'],
  ['github token', 'push with ghp_abcdefghijklmnopqrstuvwxyz123456'],
  ['jwt', 'bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123def456ghi789'],
];

function receiver(Adapter) {
  const adapter = Object.create(Adapter.prototype);
  const events = [];
  adapter._emit = (_session, kind, payload) => events.push({ kind, payload, seq: events.length + 1 });
  return { adapter, events };
}

const toolRows = (events) => events.filter((event) => event.kind === 'content.tool_call');

// ── the derivation ───────────────────────────────────────────────────────────────────────────────

test('#299: the argument digest redacts every token shape the referee redacts, and keeps ordinary text', () => {
  for (const [label, value] of TOKEN_SHAPES) {
    const digest = toolCallArgumentDigest({ command: value });
    assert.ok(!/ghp_|sk-proj-|AKIA|eyJhbGciOiJIUzI1NiIs/.test(digest), `${label}: the token must never reach the digest`);
    assert.ok(digest.includes('[credential-shaped content redacted]'), `${label}: redaction is visible, not silent`);
  }
  const plain = toolCallArgumentDigest({ command: 'node --test impl/test' });
  assert.equal(plain, '{"command":"node --test impl/test"}', 'a clean argument passes through unredacted');
});

test('#299: the argument digest is bounded no matter how large the tool input was', () => {
  const huge = { command: `node script.mjs ${'x'.repeat(4 * MAX_VERIFIER_FAILURE_TAIL_BYTES)}` };
  const digest = toolCallArgumentDigest(huge);
  assert.ok(Buffer.byteLength(digest, 'utf8') <= MAX_VERIFIER_FAILURE_TAIL_BYTES,
    'the digest holds the referee capsule bound even for megabyte inputs');
  assert.ok(digest.length > 0);
});

test('#299: the result digest carries exit status, byte counts and the FIRST lines, redacted and bounded', () => {
  const lines = ['first line', 'second line', `leaking ghp_abcdefghijklmnopqrstuvwxyz123456 mid-stream`, 'last line'];
  const output = lines.join('\n');
  const digest = toolCallResultDigest({ exitCode: 3, output });
  assert.ok(digest.startsWith('exit=3 bytes='), 'the header names the exit status and the byte count');
  assert.ok(digest.includes('bytes=' + Buffer.byteLength(output, 'utf8')), 'the byte count is the real one');
  assert.ok(digest.includes('first line') && digest.includes('second line'), 'the first lines are kept');
  assert.ok(!/ghp_/.test(digest), 'a token in the output never reaches the digest');
  assert.ok(digest.includes('[credential-shaped content redacted]'));

  const bigOutput = Array.from({ length: 20000 }, (_v, i) => `line-${i} ${'y'.repeat(64)}`).join('\n');
  const bounded = toolCallResultDigest({ ok: false, output: bigOutput });
  assert.ok(Buffer.byteLength(bounded, 'utf8') <= MAX_VERIFIER_FAILURE_TAIL_BYTES,
    'the digest holds the referee capsule bound for any output size');

  const empty = toolCallResultDigest({ ok: true, exitCode: 0, output: '' });
  assert.equal(empty, 'exit=0 bytes=0', 'an empty result is still an observed result');
});

test('#299: the typed unobserved markers are recorded absence, not silence', () => {
  assert.equal(typeof TOOL_EVIDENCE_UNOBSERVED.args, 'string');
  assert.equal(typeof TOOL_EVIDENCE_UNOBSERVED.result, 'string');
  assert.match(TOOL_EVIDENCE_UNOBSERVED.args, /^tool_args_unobserved:/);
  assert.match(TOOL_EVIDENCE_UNOBSERVED.result, /^tool_result_unobserved:/);
});

// ── every adapter fills the same fields ──────────────────────────────────────────────────────────

test('#299 omp: the start row carries the redacted arguments, the end row what the worker was told', () => {
  const { adapter, events } = receiver(OmpRpcCli);
  adapter._observeTransportLiveness = () => {};
  const session = { worker: 'w1', observedSessionId: null };
  adapter._onFrame(session, {
    type: 'tool_execution_start', toolCallId: 'tc-1', toolName: 'bash',
    args: { command: `deploy ghp_abcdefghijklmnopqrstuvwxyz123456` },
  });
  adapter._onFrame(session, {
    type: 'tool_execution_end', toolCallId: 'tc-1', toolName: 'bash', isError: true,
    result: { details: { output: 'first failure line\nboom' } },
  });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.phase, 'requested');
  assert.ok(requested.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.ok(!/ghp_/.test(JSON.stringify(requested.payload)), 'the raw arguments never reach the omp row');
  assert.equal(terminal.payload.phase, 'failed');
  assert.ok(terminal.payload.ok === false);
  assert.match(terminal.payload.resultDigest, /^exit=error bytes=/);
  assert.ok(terminal.payload.resultDigest.includes('first failure line'));
});

test('#299 omp: frames that name no arguments or result record the typed marker', () => {
  const { adapter, events } = receiver(OmpRpcCli);
  adapter._observeTransportLiveness = () => {};
  const session = { worker: 'w1', observedSessionId: null };
  adapter._onFrame(session, { type: 'tool_execution_start', toolCallId: 'tc-2', toolName: 'read' });
  adapter._onFrame(session, { type: 'tool_execution_end', toolCallId: 'tc-2', toolName: 'read', isError: false });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.argsUnobserved, TOOL_EVIDENCE_UNOBSERVED.args);
  assert.equal(requested.payload.argsDigest, undefined);
  assert.equal(terminal.payload.resultUnobserved, TOOL_EVIDENCE_UNOBSERVED.result);
  assert.equal(terminal.payload.resultDigest, undefined);
});

test('#299 claude: the requested row carries the redacted input and the tool_result frame completes the call', () => {
  const { adapter, events } = receiver(ClaudeSessionCli);
  const session = { worker: 'w1', providerCallSeq: 0, pendingDecisionRequestId: null, toolCallNames: new Map() };
  adapter._handleWireObject(session, {
    type: 'assistant',
    message: { id: 'msg_1', content: [
      { type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'publish ghp_abcdefghijklmnopqrstuvwxyz123456' } },
    ] },
  });
  adapter._handleWireObject(session, {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', is_error: true, content: 'refused: nothing recorded\nexit 1' }] },
  });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.phase, 'requested');
  assert.equal(requested.payload.name, 'Bash');
  assert.ok(requested.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.equal(requested.payload.input, undefined, 'the raw provider input never reaches the claude row');
  assert.ok(!/ghp_/.test(JSON.stringify(events)), 'no event carries the token');
  assert.equal(terminal.payload.callId, 'toolu_1');
  assert.equal(terminal.payload.phase, 'failed');
  assert.equal(terminal.payload.tool, 'Bash', 'the completed row remembers the tool name');
  assert.match(terminal.payload.resultDigest, /^exit=error bytes=/);
  assert.ok(terminal.payload.resultDigest.includes('refused: nothing recorded'));
});

test('#299 claude: a tool_use block with no input records the typed marker', () => {
  const { adapter, events } = receiver(ClaudeSessionCli);
  const session = { worker: 'w1', providerCallSeq: 0, pendingDecisionRequestId: null, toolCallNames: new Map() };
  adapter._handleWireObject(session, {
    type: 'assistant',
    message: { id: 'msg_2', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read' }] },
  });
  const [requested] = toolRows(events);
  assert.equal(requested.payload.argsUnobserved, TOOL_EVIDENCE_UNOBSERVED.args);
});

test('#299 codex: the approval row redacts the command line and the completed row bounds the output', () => {
  const { adapter, events } = receiver(CodexAppServerCli);
  adapter._isTerminalTurn = () => false;
  const session = { worker: 'w1', threadId: 'th', reqIdSeq: 0, waits: new Map() };
  adapter._onServerRequest(session, {
    id: 7, method: 'item/commandExecution/requestApproval',
    params: { threadId: 'th', turnId: 't1', itemId: 'item-9', command: 'curl -H "Authorization: bearer ghp_abcdefghijklmnopqrstuvwxyz123456"' },
  });
  adapter._onNotification(session, 'item/completed', { threadId: 'th', turnId: 't1', item: {
    id: 'item-9', type: 'commandExecution', command: 'npm test', exitCode: 1, status: 'failed',
    aggregatedOutput: 'first red line\nsecond red line',
  } });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.phase, 'requested');
  assert.ok(requested.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.equal(requested.payload.command, undefined, 'the raw command line never reaches the codex row');
  assert.equal(terminal.payload.phase, 'completed');
  assert.equal(terminal.payload.exitCode, 1);
  assert.ok(terminal.payload.resultDigest.startsWith('exit=1 bytes='), 'the completed row names the exit status');
  assert.ok(terminal.payload.resultDigest.includes('first red line'));
  assert.equal(terminal.payload.item, undefined, 'the raw item (whole aggregated output) never reaches the ledger');
});

test('#299 grok: tool_call rows carry redacted digests instead of the raw update', () => {
  const { adapter, events } = receiver(GrokAcpCli);
  const session = { worker: 'w1', sessionId: 's1', activeTurn: { turnId: 't1', toolCallPhases: new Map() } };
  adapter._onNotification(session, 'session/update', { update: {
    sessionUpdate: 'tool_call', toolCallId: 'g1', title: 'Run tests', kind: 'execute',
    rawInput: { command: 'publish TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456' },
  } });
  adapter._onNotification(session, 'session/update', { update: {
    sessionUpdate: 'tool_call_update', toolCallId: 'g1', status: 'failed',
    rawOutput: { exit_code: 2, output: 'nothing was recorded: refused\nfirst line' },
  } });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.phase, 'requested');
  assert.ok(requested.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.equal(requested.payload.rawInput, undefined, 'the raw update never reaches the grok row');
  assert.equal(terminal.payload.phase, 'failed');
  assert.match(terminal.payload.resultDigest, /^exit=2 bytes=/);
  assert.ok(terminal.payload.resultDigest.includes('nothing was recorded: refused'));
  assert.equal(terminal.payload.rawOutput, undefined);
});

test('#299 kimi: tool_call rows carry redacted digests instead of the raw update', () => {
  const { adapter, events } = receiver(KimiAcpCli);
  const session = { worker: 'w1', sessionId: 's1', activeTurn: { turnId: 't1', toolCalls: new Map() } };
  adapter._onNotification(session, 'session/update', { update: {
    sessionUpdate: 'tool_call', toolCallId: 'k1',
    rawInput: { command: 'ship ghp_abcdefghijklmnopqrstuvwxyz123456' },
  } });
  adapter._onNotification(session, 'session/update', { update: {
    sessionUpdate: 'tool_call_update', toolCallId: 'k1', status: 'completed',
    rawOutput: { exit_code: 0, output: 'done' },
  } });
  const [requested, terminal] = toolRows(events);
  assert.equal(requested.payload.phase, 'requested');
  assert.ok(requested.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.equal(requested.payload.update, undefined, 'the raw update copy never reaches the kimi row');
  assert.ok(!/ghp_/.test(JSON.stringify(events)), 'no kimi event carries the token');
  assert.equal(terminal.payload.phase, 'completed');
  assert.match(terminal.payload.resultDigest, /^exit=0 bytes=/);
});

// ── a participant's bridge calls are tool rows like any other ────────────────────────────────────

test('#299: a refused bridge publish is visible as a failed tool row with the redacted command line', () => {
  const { adapter, events } = receiver(ClaudeSessionCli);
  const session = { worker: 'w1', providerCallSeq: 0, pendingDecisionRequestId: null, toolCallNames: new Map() };
  const publishBody = JSON.stringify({ swarmId: 'swarm-x', participantId: 'p1', event: 'swarm.work_updated' });
  adapter._handleWireObject(session, {
    type: 'assistant',
    message: { id: 'msg_3', content: [{ type: 'tool_use', id: 'toolu_pub', name: 'Bash', input: {
      command: `node swarm-native-bridge.mjs swarm.update '${publishBody}'`,
    } }] },
  });
  adapter._handleWireObject(session, {
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_pub', is_error: true,
      content: 'Nothing was recorded: remove runId\nswarm.update request is invalid: unknown field runId' }] },
  });
  const [requested, refused] = toolRows(events);
  assert.ok(requested.payload.argsDigest.includes('swarm.update'), 'the publish command line is on the row');
  assert.ok(requested.payload.argsDigest.includes('swarm-x'), 'the publish body is readable where the work is');
  assert.equal(refused.payload.phase, 'failed');
  assert.ok(refused.payload.resultDigest.includes('Nothing was recorded'), 'the refusal text rides the row');
  assert.equal(JSON.stringify(events).includes(publishBody.split(',')[0].split('{')[1] + ','), false);
});

// ── the coordinator: rows land in the ledger redacted, views project the ledger ──────────────────

const dirs = [];
function tmpDir() {
  const d = mkdtempSync(join(tmpdir(), 'baton-299-'));
  dirs.push(d);
  return d;
}
test.after(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function makeBrief() {
  return {
    goal: 'publish the work', constraints: [], pathScope: ['.'], definitionOfDone: 'done',
    verification: { command: 'true', expectExit: 0 },
    budget: { tokens: 100000, usd: 5, wallMin: 30 },
  };
}

class EmittingAdapter {
  constructor() {
    this._card = { harness: 'mock', version: '1', authPosture: 'api_key', concurrencyCeiling: null, maxContext: 1000,
      verbs: { spawn: 'native', interrupt: 'native' } };
    this._onEvent = null;
  }
  card() { return this._card; }
  onEvent(cb) { this._onEvent = cb; }
  emit(event) { if (this._onEvent) this._onEvent(event); }
  async spawn(worker, brief) {
    this._onEvent({ worker, harness: 'mock@1', turnEpoch: 0, kind: 'lifecycle.spawned', actor: 'worker', payload: {} });
    this._onEvent({ worker, harness: 'mock@1', turnEpoch: 0, kind: 'lifecycle.turn_started', actor: 'worker', payload: {} });
    return { ok: true };
  }
}

function setup() {
  const dir = tmpDir();
  const log = new Log(join(dir, 'log'));
  const adapters = { mock: new EmittingAdapter() };
  const coordinator = new Coordinator({
    log,
    coordination: coordinationForLog(log),
    fences: new FenceTable(),
    adapters,
    worktrees: {
      calls: { create: [], remove: [] },
      async create() { return { path: join(dir, 'wt') }; },
      async remove() { this.calls.remove.push({}); },
      async removeVerifyWorktree() {},
      async reconcile() {},
      worktreeAvailable() { return { available: true }; },
    },
    referee: async () => ({ reverified: true, observedExit: 0, matchesClaim: true, locus: 'fresh_sandbox', note: 'ok' }),
    route: () => 'mock',
    now: (() => { let t = 0; return () => { t += 1; return t; }; })(),
    approvalTimeoutMs: 60000,
    stopDeadlineMs: 15000,
  });
  return { log, adapters, coordinator };
}

test('#299: adapter evidence lands redacted in the durable ledger row, and the token never does', async () => {
  const { log, adapters, coordinator } = setup();
  const handle = await coordinator.spawn('mock', makeBrief());
  adapters.mock.emit({
    worker: handle.id, harness: 'mock@1', turnEpoch: 0, kind: 'content.tool_call', actor: 'worker',
    payload: { phase: 'requested', toolCallId: 't-1', tool: 'Bash',
      argsDigest: toolCallArgumentDigest({ command: 'export GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz123456' }) },
  });
  const durable = log.read(handle.id).find((event) => event.kind === 'content.tool_call');
  assert.ok(durable.payload.argsDigest.includes('[credential-shaped content redacted]'));
  assert.equal(JSON.stringify(durable).includes('ghp_'), false, 'the token never reaches the durable row');
});

test('#299: run.member.view activity projects the last N tool rows, N from the frame bound, from the ledger only', async () => {
  const { log, adapters, coordinator } = setup();
  const frameBound = FRAME_LIMITS['view.attention_push.items'].value;
  const handle = await coordinator.spawn('mock', makeBrief());
  for (let i = 0; i < frameBound + 3; i += 1) {
    adapters.mock.emit({
      worker: handle.id, harness: 'mock@1', turnEpoch: 0, kind: 'content.tool_call', actor: 'worker',
      payload: { phase: i === frameBound + 2 ? 'failed' : 'requested', toolCallId: `t-${i}`, tool: 'Bash',
        argsDigest: `{"command":"call-${i}"}` },
    });
  }
  const activity = coordinator.workerActivity(handle.id);
  assert.equal(activity.lastToolRows.length, frameBound, 'the slice is the frame bound, never unbounded');
  assert.deepEqual(activity.lastToolRows.map((row) => row.toolCallId),
    Array.from({ length: frameBound }, (_v, i) => `t-${i + 3}`), 'the LAST rows, in ledger order');
  const refused = activity.lastToolRows.at(-1);
  assert.equal(refused.phase, 'failed');
  assert.equal(refused.argsDigest, '{"command":"call-' + (frameBound + 2) + '"}');
  // A projection of the ledger, never a second store: the rows name the ledger's own seq values.
  const ledgerRows = log.read(handle.id).filter((event) => event.kind === 'content.tool_call');
  assert.deepEqual(activity.lastToolRows.map((row) => row.seq),
    ledgerRows.slice(-frameBound).map((event) => event.seq));
  // A legacy row that predates the digests (raw input) projects neither digest nor raw text.
  adapters.mock.emit({
    worker: handle.id, harness: 'mock@1', turnEpoch: 0, kind: 'content.tool_call', actor: 'worker',
    payload: { phase: 'requested', toolCallId: 'legacy', tool: 'Bash',
      input: { command: 'legacy ghp_abcdefghijklmnopqrstuvwxyz123456' } },
  });
  const legacy = coordinator.lastToolRows(handle.id).find((row) => row.toolCallId === 'legacy');
  assert.equal(legacy.argsDigest, undefined);
  assert.equal(legacy.argsUnobserved, undefined);
  assert.equal(JSON.stringify(coordinator.lastToolRows(handle.id)).includes('ghp_'), false,
    'a legacy raw row contributes no token to the view either');
});

// ── the swarm participant projection ─────────────────────────────────────────────────────────────

test('#299: the swarm participant row carries the seat\u2019s last tool rows, and absence says nothing was observed', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-299-swarm-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const owner = { actor: 'owner', principalId: 'owner', sessionId: 'owner-session' };
  const store = new CoordinationStore(directory);
  const workers = [];
  const workerRow = { id: 'w-1', taskId: 't-1', runId: null, status: 'working', paused: false };
  const toolRowsByWorker = new Map();
  const coordinator = {
    list: () => workers,
    pausedTurns: () => [],
    guideParticipant: async () => ({ ok: true }),
    captureContribution: async () => ({ contributionId: 'c', workerId: 'w', sha: 'a'.repeat(40), ref: 'refs/x' }),
    checkContribution: async () => ({ passed: true }),
    lastToolRows: (workerId) => toolRowsByWorker.get(workerId) ?? [],
  };
  const runtime = new SwarmRuntime({
    store, coordinator, authorize: async () => {},
    prepareRun: async () => {},
    startRun: async (request) => {
      if (workers.some((row) => row.runId === request.runId)) return;
      workerRow.runId = request.runId;
      workers.push(workerRow);
    },
    stopRun: async () => ({ state: 'closed' }),
  });
  const call = (command, args = {}, caller = owner) => runtime.command(`swarm.${command}`,
    { swarmId: 'baton', ...(['list', 'view', 'watch', 'capture', 'check'].includes(command) ? {} : { idempotencyKey: `k-${call.index += 1}` }), ...args }, caller);
  call.index = 0;
  await call('create', { purpose: 'tool rows on the participant row' });
  await call('recruit', { participantId: 'builder', objective: 'work' });

  // An unbound seat has observed nothing: no worker, no rows — the array is empty, never a claim.
  await call('view');
  workers.length = 0;

  // A bound seat passes the coordinator's ledger projection through unaltered — the refused
  // publish rides the row where the work is.
  const rows = [{ seq: 12, ts: '2026-09-14T00:00:00.000Z', tool: 'Bash', toolCallId: 'toolu_pub',
    phase: 'failed', argsDigest: '{"command":"node swarm-native-bridge.mjs swarm.update"}',
    resultDigest: 'exit=error bytes=64' }];
  workers.push(workerRow);
  toolRowsByWorker.set('w-1', rows);
  const bound = await call('view');
  assert.deepEqual(bound.participants[0].lastToolRows, rows,
    'the participant row carries the ledger projection verbatim');
  assert.ok(bound.participants[0].lastToolRows[0].resultDigest.includes('exit=error'));
});
