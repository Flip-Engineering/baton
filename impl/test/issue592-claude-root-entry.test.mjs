// Issue #592 — the Claude root entry at its PROCESS boundary.
//
// The stage's own tests drive `McpFleetServer.handle` inside the test process. Nothing yet
// started the real entry `impl/scripts/mcp-claude-root.mjs` as a child process against a real
// published resident, which is the boundary the operator's native root actually crosses:
// the entry discovers the resident connection from its environment, opens
// `POST /v1/root-attention/claude-code`, and renders each delivered obligation as
// `notifications/claude/channel`.
//
// OBSERVED (2026-09-26, the primary deployment): its coordination ledger holds 120
// `attention.undelivered {code: root_unattached}` rows and no delivery row at all — the
// dispatcher's debt record is the only fact anyone has until an entry process attaches. This
// file exercises that attach path end to end, and the reconnect path that must offer the same
// source obligation again (an `offered_unknown` write advances no cursor).
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { randomUUID } from 'node:crypto';

import { CoordinationStore } from '../src/coordination-store.mjs';
import { MockAdapter, openBaton } from '../src/index.mjs';

const ENTRY = new URL('../scripts/mcp-claude-root.mjs', import.meta.url).pathname;
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const DELIVERY_WAIT_MS = 45_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded wait: every await here is bounded or is an operation the deployment itself bounds. */
async function until(probe, { timeoutMs = 20_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(10);
  }
}

const roots = [];
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt592entry-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue592entry@example.invalid']);
  git(['config', 'user.name', 'Issue592Entry']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  return {
    root, repo, home, configRoot, deploymentRoot,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue306a fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue592 entry fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue592-entry', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

/** The obligation SOURCE, written before anyone opens the store: a committed contribution whose
 * typed need addresses the root. The dispatcher derives the notice from this row exactly as it
 * derives one from a live seat's contribution — the test driver injects work through the normal
 * coordination mutation, never through a direct adapter call. */
function seedObligation(f, marker) {
  const directory = join(f.deploymentRoot, 'state', 'coordination');
  mkdirSync(directory, { recursive: true });
  const store = new CoordinationStore(directory);
  store.claimWriterLease();
  try {
    const record = (kind, payload, key) => store.recordSwarm(kind, payload, { actor: 'issue592-entry', key });
    record('swarm.created', { swarmId: 'sw-root-entry', purpose: 'the root owes an answer' }, 'seed:1');
    record('swarm.participant_joined', { swarmId: 'sw-root-entry', participantId: 'author' }, 'seed:2');
    record('swarm.contribution_recorded', {
      swarmId: 'sw-root-entry', participantId: 'author', contributionId: 'c-root-entry',
      body: {
        subject: 'Native root ingress acceptance',
        base: { observedHead: '0'.repeat(40), rebasedOnto: '0'.repeat(40) },
        commit: null,
        items: [{ id: 'ingress-acceptance', status: 'delivered', change: 'Deliver one obligation',
          files: [], test: 'node --test', evidence: 'acceptance fixture' }],
        verification: { targeted: true, gates: [], fullSuite: false, environmentRed: [] },
        carriedForward: [],
        needsFromOthers: [{ to: 'root', ask: marker }],
      },
    }, 'seed:3');
  } finally {
    store.releaseWriterLease({ requireOwned: true });
  }
}

/** The bridge's discovery inputs for this fixture: the resident published its connection under
 * THIS config root, so the ordinary discovery path reaches it — the same environment a native
 * root's MCP entry is launched with. */
const discoveryEnv = (f) => ({
  PATH: process.env.PATH, HOME: f.home, XDG_CONFIG_HOME: f.configRoot,
  ...(process.env.NODE_OPTIONS === undefined ? {} : { NODE_OPTIONS: process.env.NODE_OPTIONS }),
});

/** One real entry process, spoken to over its stdio MCP transport. */
function entryProcess(f) {
  const child = spawn(process.execPath, [ENTRY], {
    cwd: f.repo, env: discoveryEnv(f), stdio: ['pipe', 'pipe', 'pipe'],
  });
  const waiters = new Set();
  let stderr = '';
  let exited = null;
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.on('exit', (code, signal) => { exited = { code, signal }; });
  createInterface({ input: child.stdout, crlfDelay: Infinity }).on('line', (line) => {
    if (!line.trim()) return;
    let frame;
    try { frame = JSON.parse(line); } catch { return; }
    for (const waiter of [...waiters]) {
      if (!waiter.match(frame)) continue;
      waiters.delete(waiter);
      waiter.resolve(frame);
    }
  });
  return {
    send: (message) => child.stdin.write(`${JSON.stringify(message)}\n`),
    /** Await the first frame this predicate accepts; a process that ends first reports the exit. */
    await: (match, { timeoutMs = DELIVERY_WAIT_MS, label = 'frame' } = {}) => new Promise((resolve, reject) => {
      let poll = null;
      const stop = () => { clearInterval(poll); clearTimeout(timer); waiters.delete(waiter); };
      const waiter = { match, resolve: (frame) => { stop(); resolve(frame); } };
      const fail = (message) => { stop(); reject(new Error(message)); };
      waiters.add(waiter);
      poll = setInterval(() => {
        if (exited !== null) fail(`the entry exited (${JSON.stringify(exited)}) before ${label}; stderr: ${stderr.slice(-800)}`);
      }, 50);
      const timer = setTimeout(() => fail(`timed out waiting for ${label}; stderr: ${stderr.slice(-800)}`), timeoutMs);
    }),
    close: async () => {
      child.stdin.end();
      const deadline = Date.now() + 10_000;
      while (exited === null && Date.now() < deadline) await sleep(20);
      if (exited === null) child.kill('SIGKILL');
    },
  };
}

/** The handshake the native client performs: `initialize` (declaring the channel capability),
 * then `notifications/initialized`, which is what opens the root attachment. */
async function handshake(entry, { id = 1 } = {}) {
  entry.send({ jsonrpc: '2.0', id, method: 'initialize', params: {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude Code', version: '2.1.283' },
  } });
  const greeting = await entry.await((frame) => frame.id === id && frame.result !== undefined, { label: 'the MCP greeting' });
  assert.deepEqual(greeting.result.capabilities.experimental, { 'claude/channel': {} },
    'the entry advertises the channel capability the native client registers its listener from');
  assert.match(greeting.result.instructions, /root attachment/i);
  entry.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
}

const ledgerRows = (f) => (existsSync(f.ledgerPath)
  ? readFileSync(f.ledgerPath, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
  : []);
const driverRows = (f, kind) => ledgerRows(f).filter((row) => row.kind === 'driver.recorded' && row.payload?.kind === kind);

test('the real Claude root entry attaches to a published resident and re-offers its debt on reconnect', { timeout: 120_000 }, async (t) => {
  const f = world('attach');
  const marker = `WAKE-ACCEPT-${randomUUID()}`;
  seedObligation(f, marker);

  const owner = await openBaton({ repo: f.repo, advanced: {
    deploymentRoot: f.deploymentRoot,
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: { env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home }, home: f.home,
      webDrainMs: 2_000, sessionTtlMs: 60_000 },
  } });
  t.after(async () => { try { await owner.close(); } catch { /* the close already settled */ } });
  const published = await owner.host();
  assert.equal(published.state, 'published');
  assert.equal(published.transport, 'local');

  // The publication is the discovery input: a selector inside the repository and the private
  // profile (with its token file) under the config root the entry is launched with.
  const selector = JSON.parse(readFileSync(f.selectorPath, 'utf8'));
  assert.equal(selector.schemaVersion, 2);
  assert.equal(selector.transport, 'local');
  const profilePath = join(f.configRoot, 'baton', 'connections', `${selector.profile}.json`);
  await until(() => existsSync(profilePath), { label: 'the private connection profile' });

  // (1) The unattached state is a recorded fact, not an assumption.
  await until(() => driverRows(f, 'attention.undelivered').length > 0,
    { label: 'the unattached undelivered row' });
  const before = driverRows(f, 'attention.undelivered');
  assert.ok(before.every((row) => row.payload.code === 'root_unattached'),
    `every pre-attachment row names the cause: ${JSON.stringify(before.map((row) => row.payload.code))}`);
  assert.equal(driverRows(f, 'attention.delivery_observed').length, 0,
    'nothing was ever observed as delivered before an entry attached');

  // (2) The real entry process attaches and renders the committed obligation.
  const first = entryProcess(f);
  t.after(async () => { await first.close(); });
  await handshake(first);
  const delivered = await first.await((frame) => frame.method === 'notifications/claude/channel',
    { label: 'the channel notification' });
  assert.match(delivered.params.content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')),
    'the native frame carries the source ask verbatim');
  assert.deepEqual(delivered.params.meta, { recipient: 'root' });
  const observation = await until(() => driverRows(f, 'attention.delivery_observed').at(-1),
    { label: 'the delivery observation row' });
  const firstBatch = driverRows(f, 'attention.delivery_observed');
  assert.ok(firstBatch.length >= 1);
  for (const row of firstBatch) {
    assert.equal(row.payload.harness, 'claude-code');
    assert.equal(row.payload.result.state, 'offered_unknown',
      'a channel stream write is offered, never acknowledged');
    assert.equal(row.payload.result.transport, 'resident_channel_stream');
  }
  assert.equal(observation.payload.result.transport, 'resident_channel_stream');
  const firstOffered = new Set(firstBatch.map((row) => row.payload.obligationId));

  // (3) The connection closes; the debt stays owed and the next attachment is offered it again.
  await first.close();
  const second = entryProcess(f);
  t.after(async () => { await second.close(); });
  await handshake(second, { id: 2 });
  const again = await second.await((frame) => frame.method === 'notifications/claude/channel',
    { label: 'the channel notification after reconnect' });
  assert.match(again.params.content, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')));
  await until(() => driverRows(f, 'attention.delivery_observed').length === firstBatch.length * 2,
    { label: 'the second delivery observation for every notice' });
  const secondBatch = driverRows(f, 'attention.delivery_observed').slice(firstBatch.length);
  assert.deepEqual(new Set(secondBatch.map((row) => row.payload.obligationId)), firstOffered,
    'the reconnect is offered the same source obligations — an offered_unknown write advanced no cursor');
});
