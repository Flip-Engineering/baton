import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  CoordinationStore, McpFleetServer, MockAdapter, WebNorthbound, createBrief, createDriver,
} from '../src/index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const IMPL = resolve(HERE, '..');
const RUN_EVIDENCE = join(IMPL, 'scripts', 'run-evidence.mjs');
const NOW = Date.parse('2026-07-13T12:00:00.000Z');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const root = (label) => mkdtempSync(join(tmpdir(), `baton-phase56-${label}-`));

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
}

function repo(label) {
  const world = root(label); const directory = join(world, 'repo'); mkdirSync(directory);
  git(['init', '-q'], directory); git(['config', 'user.name', 'Baton Phase 56'], directory); git(['config', 'user.email', 'phase56@example.invalid'], directory);
  writeFileSync(join(directory, 'README.md'), '# fixture\n'); git(['add', 'README.md'], directory); git(['commit', '-qm', 'fixture'], directory);
  return { world, directory, logDir: join(world, 'log') };
}

function brief(goal = 'hold') {
  return createBrief({
    goal, constraints: [], pathScope: ['README.md'], definitionOfDone: 'stopped by drain',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 10_000, usd: 1, wallMin: 5 },
  });
}

async function until(fn, label, timeoutMs = 3_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await fn(); if (value) return value; await sleep(5); }
  throw new Error(`timeout waiting for ${label}`);
}

function drainReceipt(overrides = {}) {
  const core = {
    schemaVersion: 1, state: 'drained', scope: 'local-controller', repoId: 'repo-a',
    targetCount: 0, remainingCount: 0, targetDigest: digest([]),
    counts: { pendingCancelled: 0, killConfirmed: 0, alreadyTerminal: 0, processesObserved: 0, processesClosed: 0 },
    checks: { admissionClosed: true, authorityOpsDrained: true, stopWaitersDrained: true, cleanupDrained: true, localWorkerAuthorityReleased: true },
    effects: { coordinatorClosed: false, writerReleased: false, transportsClosed: false },
    ...overrides,
  };
  return Object.freeze({ ...core, receiptDigest: digest(core) });
}

test('DC1: drain policy is closed and bounded before writer admission', (t) => {
  const valid = repo('policy-valid'); let driver; t.after(() => { try { driver?.close(); } catch {} rmSync(valid.world, { recursive: true, force: true }); });
  driver = createDriver({ repoRoot: valid.directory, logDir: valid.logDir, repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  assert.equal(typeof driver.drainAndClose, 'function');
  assert.throws(() => createDriver({ repoRoot: valid.directory, logDir: join(valid.world, 'unknown'), repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5, path: '/tmp/forged' } }), /drain policy/i);
  assert.throws(() => createDriver({ repoRoot: valid.directory, logDir: join(valid.world, 'max'), repoId: 'repo-a', adapters: {}, drainPolicy: { maxWorkers: 100_001, timeoutMs: 1_000, pollMs: 5 } }), /drain policy/i);
  assert.equal(driver.close(), true);
});

test('DC2-DC7: one drain cancels pending work, kill-confirms active work, fences effects, and exactly closes the writer', async (t) => {
  const f = repo('driver'); let driver; t.after(async () => {
    try { for (const row of driver?.coordinator.list?.() ?? []) await driver.coordinator.kill(row.id); } catch {}
    try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true });
  });
  const adapter = new MockAdapter({ concurrencyCeiling: 1, scenario: { outcome: 'completed', delayMs: 60_000, result: { summary: 'late' } } });
  let nativeKills = 0; const kill = adapter.kill.bind(adapter); adapter.kill = async (...args) => { nativeKills += 1; return kill(...args); };
  driver = createDriver({
    repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter },
    drainPolicy: { maxWorkers: 2, timeoutMs: 5_000, pollMs: 5 }, watchdog: { stallMs: 0 },
  });
  const active = await driver.coordinator.spawn('mock', brief('active'), { taskId: 'active' });
  const pending = await driver.coordinator.spawn('mock', brief('pending'), { taskId: 'pending' });
  await until(() => driver.coordinator.list().find((row) => row.id === active.id)?.status === 'working', 'active worker');
  assert.equal(driver.coordinator.list().find((row) => row.id === pending.id)?.status, 'pending');

  const first = driver.drainAndClose(); const second = driver.drainAndClose();
  assert.equal(first, second, 'concurrent close callers share the exact Promise');
  await assert.rejects(driver.coordinator.spawn('mock', brief('late'), { taskId: 'late' }), (error) => error.code === 'coordinator_draining');
  const receipt = await first;
  assert.equal(nativeKills, 1, 'pending work never reaches the adapter kill path');
  assert.equal(receipt.state, 'closed'); assert.equal(receipt.fleet.state, 'drained');
  assert.equal(receipt.fleet.targetCount, 2); assert.equal(receipt.fleet.counts.pendingCancelled, 1); assert.equal(receipt.fleet.counts.killConfirmed, 1);
  assert.deepEqual(receipt.authority, { coordinatorClosed: true, writerReleased: true });
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'active')), false);
  assert.equal(existsSync(join(f.directory, '.baton', 'wt', 'pending')), false);
  assert.equal(git(['branch', '--list', 'baton/active'], f.directory), '');
  assert.equal(git(['branch', '--list', 'baton/pending'], f.directory), '');
  assert.equal(driver.drainAndClose(), first, 'a completed close returns its memoized Promise');
  assert.deepEqual(await driver.drainAndClose(), receipt);
  assert.equal(JSON.stringify(receipt).includes(f.world), false);
});

test('DC1/DC5: max+1 refuses before fencing and an exact retry can still close', async (t) => {
  const f = repo('max-plus-one'); let driver; t.after(async () => { try { await driver?.closeAsync(); } catch {} rmSync(f.world, { recursive: true, force: true }); });
  const adapter = new MockAdapter({ concurrencyCeiling: 0, scenario: { outcome: 'completed' } });
  driver = createDriver({ repoRoot: f.directory, logDir: f.logDir, repoId: 'repo-a', adapters: { mock: adapter }, drainPolicy: { maxWorkers: 1, timeoutMs: 1_000, pollMs: 5 } });
  await driver.coordinator.spawn('mock', brief('one'), { taskId: 'one' }); await driver.coordinator.spawn('mock', brief('two'), { taskId: 'two' });
  await assert.rejects(driver.drainAndClose(), (error) => error.code === 'coordinator_drain_capacity');
  assert.equal(driver.coordinator.list().length, 2, 'capacity refusal occurs before admission closes');
  assert.equal(existsSync(join(f.logDir, 'coordination', 'writer.lease')), true);
  driver.coordinator._drainPolicy = Object.freeze({ maxWorkers: 2, timeoutMs: 1_000, pollMs: 5 });
  const receipt = await driver.drainAndClose(); assert.equal(receipt.state, 'closed');
});

test('DC6: nested drain admission/completion is replay-validated and constant-shape', (t) => {
  const directory = root('durable'); t.after(() => rmSync(directory, { recursive: true, force: true })); const store = new CoordinationStore(directory, { clock: () => new Date(NOW).toISOString() });
  const targetWorkerIds = ['w-1', 'w-2']; const targetDigest = digest(targetWorkerIds); const requestDigest = digest({ repoId: 'repo-a', idempotencyKey: 'direct-1' });
  const fields = { schemaVersion: 1, drainId: `fleet-drain:${requestDigest}`, repoId: 'repo-a', requestDigest, targetWorkerIds, targetDigest };
  const auth = { actor: 'orchestrator', key: 'fleet.drain:direct-1' };
  assert.equal(store.admitFleetDrain(fields, auth).result, 'admitted');
  const receipt = drainReceipt({ targetCount: 2, targetDigest });
  assert.equal(store.completeFleetDrain(fields.drainId, receipt, { actor: 'orchestrator', key: 'fleet.drain.complete:direct-1' }).result, 'completed');
  assert.deepEqual(store.fleetDrain(fields.drainId).receipt, receipt);
  store.releaseWriterLease({ requireOwned: true });
  const replay = new CoordinationStore(directory); assert.deepEqual(replay.fleetDrain(fields.drainId).receipt, receipt); replay.releaseWriterLease({ requireOwned: true });
});

test('DC5/DC7: strict writer release never deletes or blesses a replacement lease', (t) => {
  const directory = root('writer'); t.after(() => rmSync(directory, { recursive: true, force: true })); const store = new CoordinationStore(directory); const owned = store.claimWriterLease();
  writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: process.pid, token: 'replacement', acquiredAt: new Date().toISOString() })}\n`);
  assert.throws(() => store.releaseWriterLease({ requireOwned: true }), (error) => error.code === 'coordination_writer_lost');
  assert.equal(JSON.parse(readFileSync(owned.path, 'utf8')).token, 'replacement');
  writeFileSync(owned.path, `${JSON.stringify({ schemaVersion: 1, pid: owned.pid, token: owned.token, acquiredAt: new Date().toISOString() })}\n`);
  assert.equal(store.releaseWriterLease({ requireOwned: true }), true); assert.equal(existsSync(owned.path), false);
});

const webPrincipal = (capabilities = ['observe', 'emergency_stop']) => ({
  userId: 'user-1', sessionId: 'session-1', credentialId: 'credential-1', authMethod: 'cookie', csrfToken: 'csrf-1',
  capabilities, repoIds: ['repo-a'], expiresAt: '2099-01-01T00:00:00.000Z', revoked: false,
});
const webContext = (principal = webPrincipal()) => ({ principal, origin: 'https://control.example.test', csrfToken: 'csrf-1', remoteAddress: '127.0.0.1', transport: 'https' });
const webDrain = (overrides = {}) => ({
  schemaVersion: 1, commandId: 'drain-command-1', idempotencyKey: 'drain-idem-1', command: 'drain', args: {}, repoId: 'repo-a', origin: 'https://control.example.test', ...overrides,
});

test('DC8/DC10: authenticated web drain is closed, joins admitted replay, and never closes transport/writer authority', async (t) => {
  const directory = root('web'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt();
  let calls = 0; let release; const gate = new Promise((resolveGate) => { release = resolveGate; });
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { async drain(ctx) { calls += 1; assert.deepEqual(ctx, { actor: 'web:user-1:session-1', repoId: 'repo-a', idempotencyKey: 'web.command:drain-command-1' }); await gate; return receipt; } };
  const web = new WebNorthbound({ coordinator, coordination, repoIds: ['repo-a'], allowedOrigins: ['https://control.example.test'], now: () => NOW });
  const first = web.execute(webContext(), webDrain()); await until(() => coordination.events().some((event) => event.kind === 'web.command_admitted'), 'web drain admission');
  const second = web.execute(webContext(), webDrain({ commandId: 'drain-command-retry' }));
  await sleep(20); release();
  const [one, two] = await Promise.all([first, second]); assert.equal(one.status, 200); assert.equal(two.status, 200); assert.equal(calls, 1);
  assert.deepEqual(one.body.result, receipt); assert.deepEqual(two.body.result, receipt); assert.equal(two.body.replayed, true);
  const forbidden = await web.execute(webContext(webPrincipal(['observe'])), webDrain({ commandId: 'drain-forbidden', idempotencyKey: 'drain-forbidden' })); assert.equal(forbidden.status, 403);
  const unknown = await web.execute(webContext(), webDrain({ commandId: 'drain-unknown', idempotencyKey: 'drain-unknown', args: { timeoutMs: 99 } })); assert.equal(unknown.status, 400);
  assert.equal(coordination.releaseWriterLease({ requireOwned: true }), true, 'web drain retained writer authority');
});

const mcpPrincipal = (capabilities = ['observe', 'emergency_stop']) => ({ userId: 'operator', sessionId: 'stdio', capabilities, repoIds: ['repo-a'], expiresAt: new Date(NOW + 60_000).toISOString(), revoked: false });
async function initialized(server) {
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'phase56', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

test('DC9/DC10: MCP fleet_drain has emergency authority, exact schema, admitted replay, and transport parity', async (t) => {
  const directory = root('mcp'); const coordination = new CoordinationStore(directory); const receipt = drainReceipt(); let calls = 0; let release;
  const gate = new Promise((resolveGate) => { release = resolveGate; });
  t.after(() => { release(); try { coordination.releaseWriterLease(); } catch {} rmSync(directory, { recursive: true, force: true }); });
  const coordinator = { async drain(ctx) { calls += 1; assert.match(ctx.idempotencyKey, /^mcp\.call:/); assert.equal(ctx.actor, 'mcp:operator:stdio'); assert.equal(ctx.repoId, 'repo-a'); await gate; return receipt; } };
  const server = new McpFleetServer({ coordinator, coordination, principal: mcpPrincipal(), repoIds: ['repo-a'], now: () => NOW, maxWaitMs: 1_000, maxMessageBytes: 64 * 1024, takeToolQuota: () => ({ ok: true }) }); await initialized(server);
  const tools = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/list' }); const drainTool = tools.result.tools.find((tool) => tool.name === 'fleet_drain');
  assert.deepEqual(drainTool.inputSchema.required, ['repoId', 'idempotencyKey']); assert.equal(drainTool.execution.taskSupport, 'forbidden'); assert.equal(drainTool.annotations.destructiveHint, true);
  const args = { repoId: 'repo-a', idempotencyKey: 'drain-mcp-1' };
  const first = server.handle({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await until(() => coordination.events().some((event) => event.kind === 'mcp.call_admitted'), 'MCP drain admission');
  const second = server.handle({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fleet_drain', arguments: args } });
  await sleep(20); release(); const [one, two] = await Promise.all([first, second]);
  assert.equal(one.result.isError, false); assert.equal(two.result.isError, false); assert.equal(calls, 1); assert.deepEqual(one.result.structuredContent, two.result.structuredContent);
  const ping = await server.handle({ jsonrpc: '2.0', id: 5, method: 'ping' }); assert.deepEqual(ping.result, {});
  const extra = await server.handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'fleet_drain', arguments: { ...args, idempotencyKey: 'extra', expectedFence: 1 } } }); assert.equal(extra.result.isError, true);
  coordination.releaseWriterLease({ requireOwned: true });
});

test('DC11: canonical evidence wrapper owns root, process-group exit truth, and sibling safety on semantic red', (t) => {
  const world = root('evidence-wrapper'); const fixture = join(world, 'fixture.mjs'); const observed = join(world, 'observed.txt'); const sibling = join(world, 'sibling'); mkdirSync(sibling);
  t.after(() => rmSync(world, { recursive: true, force: true }));
  writeFileSync(fixture, `import { mkdtempSync, writeFileSync } from 'node:fs'; import { join } from 'node:path';\nconst nested = mkdtempSync(join(process.env.TMPDIR, 'child-')); writeFileSync(process.argv[2], process.env.TMPDIR + '\\n' + nested + '\\n'); process.exitCode = 7;\n`);
  const outcome = spawnSync(process.execPath, [RUN_EVIDENCE, fixture, observed], { encoding: 'utf8' });
  assert.equal(outcome.status, 7, outcome.stderr); const [owned, nested] = readFileSync(observed, 'utf8').trim().split('\n');
  assert.equal(existsSync(owned), false); assert.equal(existsSync(nested), false); assert.equal(existsSync(sibling), true);
});
