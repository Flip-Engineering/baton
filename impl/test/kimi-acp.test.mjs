import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertIsAdapter } from '../src/adapter.mjs';
import { buildKimiAcpArgs, KimiAcpCli } from '../src/kimi-acp.mjs';
import { DEFAULT_WORKER_POLICY_REQUEST, resolveWorkerPolicy } from '../src/worker-policy.mjs';

const fixture = fileURLToPath(new URL('./fixtures/fake-kimi-acp.mjs', import.meta.url));
const brief = {
  goal: 'tiny task', constraints: [], pathScope: ['impl/**'], definitionOfDone: 'done',
  verification: { command: 'node --test', expectExit: 0 },
  budget: { tokens: 1, usd: 0, wallMin: 1 },
};

const waitFor = async (events, predicate, timeoutMs = 2000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for Kimi event');
};

function setup(mode = 'normal', extra = {}) {
  const root = mkdtempSync(join(tmpdir(), 'baton-kimi-acp-'));
  const log = join(root, 'frames.ndjson');
  const envLog = join(root, 'env.json');
  const events = [];
  const { env: extraEnv = {}, ...adapterOptions } = extra;
  const adapter = new KimiAcpCli({
    cmd: process.execPath, args: [fixture, '--serve'], requestTimeoutMs: 1000,
    versionProbe: () => '0.27.0',
    env: { FAKE_KIMI_MODE: mode, FAKE_KIMI_LOG: log, FAKE_KIMI_ENV_LOG: envLog, ...extraEnv },
    ...adapterOptions,
  });
  adapter.onEvent((event) => events.push(event));
  const spawn = (worker = 'w', options = {}) => adapter.spawn(worker, brief, {
    worktree: root, model: 'kimi-code/k3', reasoningEffort: 'max',
    processGeneration: 1, processReapTimeoutMs: 500,
    env: { KIMI_CODE_HOME: join(root, 'private') }, replaceEnv: true,
    ...options,
  });
  return { root, log, envLog, events, adapter, spawn };
}

test('native Kimi default argv puts global full-permission mode before the ACP command', () => {
  assert.deepEqual(buildKimiAcpArgs(), ['--yolo', 'acp']);
  assert.deepEqual(buildKimiAcpArgs('yolo'), ['--yolo', 'acp']);
  assert.deepEqual(buildKimiAcpArgs('auto'), ['--auto', 'acp']);
  assert.deepEqual(buildKimiAcpArgs('default'), ['acp']);
  assert.throws(() => buildKimiAcpArgs('unknown'), /permissionMode must be default, auto, or yolo/u);

  const custom = new KimiAcpCli({
    cmd: process.execPath, args: [fixture, '--serve'], requestTimeoutMs: 1000,
    permissionMode: 'yolo', versionProbe: () => 'fixture',
  });
  assert.deepEqual(custom._args, [fixture, '--serve'], 'explicit adapter args remain caller-owned');
});

test('native Kimi card is exact, effort-required, and distinct from Claude Code Kimi', () => {
  const { adapter } = setup();
  assertIsAdapter(adapter);
  const card = adapter.card();
  assert.equal(card.harness, 'kimi-code');
  assert.equal(card.modelSelection.family, 'kimi');
  assert.deepEqual(card.modelSelection.available, ['kimi-code/k3']);
  assert.deepEqual(card.modelSelection.reasoningEffort, ['low', 'high', 'max']);
  assert.equal(card.modelSelection.effortRequired, true);
  assert.equal(card.modelSelection.effortObservation, 'unavailable');
  assert.equal(card.sessions.close, 'unsupported');
  assert.deepEqual(card.permissions, {
    mode: 'yolo',
    boundary: 'Full same-UID host access by default; filesystem and network containment are unverified',
  });
  assert.deepEqual(card.governance.contentStream, { mode: 'bounded-coalescing', flushBytes: 4096 });
  const interactive = setup('normal', { permissionMode: 'default' }).adapter.card();
  assert.deepEqual(interactive.workerPolicy.autonomy.supported, ['interactive']);
  assert.deepEqual(interactive.workerPolicy.autonomy.mechanisms, ['acp-mode-default']);
});

test('native Kimi confirms yolo through ACP before readiness and the first provider prompt', async () => {
  const { adapter, spawn, events, log } = setup();
  const resolution = resolveWorkerPolicy(DEFAULT_WORKER_POLICY_REQUEST, adapter.card().workerPolicy);
  try {
    assert.deepEqual(await spawn('w', { workerPolicy: resolution }), { ok: true });
    const observed = await waitFor(events, (event) => event.kind === 'worker_policy.observed');
    const spawned = await waitFor(events, (event) => event.kind === 'lifecycle.spawned');
    const turnStarted = await waitFor(events, (event) => event.kind === 'lifecycle.turn_started');
    await waitFor(events, (event) => event.kind === 'lifecycle.turn_completed');
    assert.equal(events.indexOf(observed) < events.indexOf(spawned), true);
    assert.equal(events.indexOf(spawned) < events.indexOf(turnStarted), true);
    assert.equal(observed.payload.workerPolicyObserved.resolutionDigest, resolution.resolutionDigest);
    assert.deepEqual(observed.payload.workerPolicyObserved.autonomy, {
      source: 'provider', observed: 'unattended',
    });
    assert.deepEqual(observed.payload.workerPolicyObserved.access, {
      source: 'unavailable', observed: null,
    });
    assert.equal(observed.payload.processGroupId, observed.payload.pid);

    const frames = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const modeIndex = frames.findIndex((frame) => frame.method === 'session/set_config_option'
      && frame.params?.configId === 'mode' && frame.params?.value === 'yolo');
    const promptIndex = frames.findIndex((frame) => frame.method === 'session/prompt');
    assert.notEqual(modeIndex, -1, 'the provider must confirm the full-permission mode');
    assert.equal(modeIndex < promptIndex, true, 'no provider prompt may precede yolo attestation');
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('native Kimi performs exact initialize, login auth, new session, and prompt order', async () => {
  const { adapter, spawn, events, log, envLog } = setup();
  try {
    assert.deepEqual(await spawn(), { ok: true });
    await waitFor(events, (event) => event.kind === 'lifecycle.turn_completed');
    const frames = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(frames.slice(0, 5).map((frame) => frame.method), ['initialize', 'authenticate', 'session/new', 'session/set_config_option', 'session/prompt']);
    assert.deepEqual(frames[1].params, { methodId: 'login' });
    assert.deepEqual(frames[2].params.mcpServers, []);
    assert.deepEqual(frames[3].params, { sessionId: 'kimi-session-1', configId: 'mode', value: 'yolo' });
    assert.equal(frames[4].params.prompt[0].text.includes('[baton brief:kimi-acp]'), true);
    assert.deepEqual(JSON.parse(readFileSync(envLog, 'utf8')), { effort: 'max', home: 'private' });
    const spawned = events.find((event) => event.kind === 'lifecycle.spawned');
    assert.equal(spawned.payload.modelObserved, 'kimi-code/k3');
    assert.equal(spawned.payload.effortObserved, null);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('model and exact effort admission refuse before a child exists', async () => {
  for (const options of [
    { model: 'kimi-code/unknown', reasoningEffort: 'max' },
    { model: 'kimi-code/k3', reasoningEffort: undefined },
    { model: 'kimi-code/k3', reasoningEffort: 'xhigh' },
  ]) {
    const { spawn, log } = setup();
    const result = await spawn('w', options);
    assert.equal(result.ok, false);
    assert.equal(existsSync(log), false);
  }
});

for (const [mode, code] of [
  ['wrong-agent', 'agent_identity_mismatch'], ['no-auth', 'auth_unavailable'],
  ['auth-fail', -32000], ['model-absent', 'model_unavailable'],
]) {
  test(`native Kimi fails closed during ${mode}`, async () => {
    const { spawn, events } = setup(mode);
    const result = await spawn();
    assert.equal(result.ok, false);
    assert.equal(result.code, code);
    const closed = await waitFor(events, (event) => event.kind === 'lifecycle.process_closed');
    assert.equal(closed.payload.ready, false);
    assert.equal(events.some((event) => event.kind === 'lifecycle.spawned'), false);
  });
}

test('native Kimi accepts only end_turn as provider completion', async () => {
  const { adapter, spawn, events } = setup('max-steps');
  try {
    assert.equal((await spawn()).ok, true);
    const crashed = await waitFor(events, (event) => event.kind === 'lifecycle.crashed');
    assert.equal(crashed.payload.code, 'provider_turn_failed');
    assert.equal(events.some((event) => event.kind === 'lifecycle.turn_completed'), false);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('native Kimi interrupt and process-group kill have distinct confirmed terminals', async () => {
  const interrupted = setup('prompt-hang');
  assert.equal((await interrupted.spawn()).ok, true);
  await waitFor(interrupted.events, (event) => event.kind === 'lifecycle.turn_started');
  assert.equal((await interrupted.adapter.interrupt('w')).ok, true);
  const interruptConfirmed = await waitFor(
    interrupted.events, (event) => event.kind === 'control.interrupt_confirmed',
  );
  assert.equal(typeof interruptConfirmed.payload.sessionId, 'string');
  assert.equal(interruptConfirmed.payload.transportOpen, true);
  await interrupted.adapter.kill('w');
  await waitFor(interrupted.events, (event) => event.kind === 'kill.confirmed');

  const killed = setup('prompt-hang');
  assert.equal((await killed.spawn()).ok, true);
  assert.deepEqual(await killed.adapter.kill('w'), { ok: true });
  await waitFor(killed.events, (event) => event.kind === 'kill.confirmed');
  const closeIndex = killed.events.findIndex((event) => event.kind === 'lifecycle.process_closed');
  const killIndex = killed.events.findIndex((event) => event.kind === 'kill.confirmed');
  assert.ok(closeIndex >= 0 && closeIndex < killIndex);
});

// #163 law: the wall-time fate clock is retired. The old pin proved a self-firing timeout
// wins the close race; the new pin proves the INVERSE — a prompt-hanging member with
// timeoutMs set is HELD ALIVE, and only an explicit kill terminalizes with the exact
// ownership release the old pin defended.
test('native Kimi holds a timeoutMs-bearing prompt-hang member alive; explicit kill releases exact ownership', async () => {
  const worker = 'wall-timeout';
  const { adapter, spawn, events } = setup('prompt-hang');
  assert.equal((await spawn(worker, { timeoutMs: 250 })).ok, true);
  const started = await waitFor(events, (event) => event.kind === 'lifecycle.process_started');
  // Well past the old 250ms window: no timeout crash, no close — patience is not evidence.
  await new Promise((resolve) => setTimeout(resolve, 1500));
  assert.equal(events.some((event) => event.kind === 'lifecycle.crashed' && event.payload?.code === 'provider_timeout'), false,
    'no wall-time crash exists');
  assert.equal(events.some((event) => event.kind === 'lifecycle.process_closed'), false,
    'the member is held open past the timeout window');
  await adapter.kill(worker);
  await waitFor(events, (event) => event.kind === 'lifecycle.process_closed');
  // Full terminal settle before the next test spawns (isolation: no reap residue race):
  await waitFor(events, (event) => event.kind === 'kill.confirmed');
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));

  const terminals = events.filter((event) => [
    'lifecycle.crashed', 'lifecycle.process_closed', 'kill.confirmed',
    'lifecycle.process_reap_unconfirmed',
  ].includes(event.kind));
  assert.equal(terminals.some((event) => event.payload?.code === 'provider_protocol_error'), false);
  assert.equal(terminals.some((event) => event.kind === 'kill.confirmed'), true);
  assert.throws(
    () => process.kill(started.payload.pid, 0),
    (error) => error?.code === 'ESRCH',
    'confirmed close must leave no live owned Kimi process',
  );
  assert.equal(adapter._sessions.has(worker), false, 'confirmed close must release adapter ownership');
  assert.deepEqual(await adapter.kill(worker), { ok: true, terminal: true });
});

test('native Kimi permission request stays correlated through approve', async () => {
  const { adapter, spawn, events } = setup('permission');
  try {
    assert.equal((await spawn()).ok, true);
    const request = await waitFor(events, (event) => event.kind === 'approval.requested');
    assert.deepEqual(await adapter.approve('w', request.payload.requestId, 'allow'), { ok: true });
    await waitFor(events, (event) => event.kind === 'lifecycle.turn_completed');
    assert.equal(events.filter((event) => event.kind === 'approval.resolved').length, 1);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('native Kimi recovery loads the exact session and can attach without provider work', async () => {
  const { adapter, spawn, log, events } = setup();
  try {
    assert.deepEqual(await spawn('w', { session: { mode: 'resume', id: 'prior-session' }, attachOnly: true }), { ok: true, attached: true });
    const frames = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(frames.some((frame) => frame.method === 'session/load' && frame.params.sessionId === 'prior-session'), true);
    assert.equal(frames.some((frame) => frame.method === 'session/prompt'), false);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('native Kimi provider frames are sanitized before events', async () => {
  const secret = 'native-secret-value';
  const { adapter, spawn, events } = setup('secret-output', { env: { FAKE_SECRET: secret } });
  try {
    assert.equal((await spawn('w', { redactProviderFrame: (frame) => JSON.parse(JSON.stringify(frame).replaceAll(secret, '[REDACTED]')) })).ok, true);
    const content = await waitFor(events, (event) => event.kind === 'content.message');
    assert.equal(content.payload.text, '[REDACTED]');
    assert.equal(JSON.stringify(events).includes(secret), false);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});

test('native Kimi coalesces stream deltas and repeated tool progress without losing milestones', async () => {
  const { adapter, spawn, events } = setup('stream-flood', { streamChunkBytes: 1024 });
  try {
    assert.equal((await spawn()).ok, true);
    await waitFor(events, (event) => event.kind === 'lifecycle.turn_completed');
    const thoughts = events.filter((event) => event.kind === 'content.thought');
    const messages = events.filter((event) => event.kind === 'content.message');
    const tools = events.filter((event) => event.kind === 'content.tool_call');
    assert.equal(thoughts.length, 2);
    assert.equal(thoughts.reduce((count, event) => count + event.payload.chunkCount, 0), 100);
    assert.equal(messages.length, 2);
    assert.equal(messages.reduce((count, event) => count + event.payload.chunkCount, 0), 51);
    assert.deepEqual(tools.map((event) => event.payload.phase), ['requested', 'progress', 'completed']);
  } finally { await adapter.kill('w'); await waitFor(events, (event) => event.kind === 'kill.confirmed'); }
});
