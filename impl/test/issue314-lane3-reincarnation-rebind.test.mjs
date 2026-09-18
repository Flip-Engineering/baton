// Issue #314 lane 3 — a bridge session survives a resident reincarnation (docs/49 §6).
//
// THE FACT this file is written against: a bridge session is bound to ONE incarnation — the
// connection (socket path + token, docs/48 §1) is discovered once, the old incarnation withdraws
// its socket when its handoff ends, and every dispatch and every wake attachment then talks to a
// dead address. The landed pieces the rebind composes already exist: discovery
// (`openBatonWebConnection`), the per-dispatch attestation, the retryable stale-incarnation
// refusal, the typed attachment end (#316 b), the `incarnation_changed` wake class, and the
// handoff's own rows (#306/#306r/#461).
//
// The fixture: a REAL resident (`openBatonDeployment` over a temporary repository — the issue306a
// idiom, with the injected successor spawner) publishes its connection; the bridge opens through
// the ORDINARY path (discovery, doctor, session over the owner-only socket); a staged handoff then
// replaces the publication with a successor's, written exactly as the resident writes it (the
// repository selector beside the private profile and token the discovery reads). Only the
// successor's ENDPOINT is a double: it speaks the resident's published routes (`/readyz`,
// `/v1/application-card`, `/v1/session`, `/v1/wakes`, `/v1/commands`) and keeps an idempotent
// ledger per idempotency key, which is what "the shared coordination ledger replays the first
// attempt" reduces to at this boundary. The handoff rows themselves are the real deployment's.
//
// Rows:
//   314e-l3-a  a served session across a staged handoff answers the next call from the successor,
//              and the client received exactly ONE `baton.resident_reincarnated {from, to, at,
//              cursor}` naming both incarnations;
//   314e-l3-b  an in-flight mutation at the boundary is applied ONCE: the replay carries the SAME
//              derived idempotency key (the repeat of the same call replays the row instead of
//              minting a second one);
//   314e-l3-c  a wake subscription opened BEFORE the handoff still delivers after it — the same
//              subscription id, and the resumed attachment names the cursor the session reached;
//   314e-l3-d  a handoff that FAILS (the #306r arm: the successor dies before publishing) produces
//              no rebind and no notification — the session keeps talking to the incarnation that
//              re-took its authority;
//   314e-l3-e  the session's own lifecycle frame is routed to
//              `notifications/baton/resident_reincarnated` by the server that owns the method,
//              beside the wake method (docs/49 §10's owner row).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { APPLICATION_COMMAND_DEFINITIONS } from '../src/application.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';
import { McpFleetServer } from '../src/mcp-northbound.mjs';
import * as bridgeModule from '../src/mcp-web-bridge.mjs';

const { BatonWebApplicationFacade, connectBatonWebApplication } = bridgeModule;
/** docs/49 §6.1's rebind authority, read as data so this file is an honest red-before skeleton: at
 * HEAD the derivation does not exist and the row that needs it fails naming the law — never on an
 * import that would take the whole file down with it (docs/44 rule 5). */
const openBatonWebConnection = bridgeModule.openBatonWebConnection
  ?? (() => { throw new Error('LAW (docs/49 §6.1): the bridge exposes no rebind open path (openBatonWebConnection)'); });

const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const WAIT_MS = 4_000;
const OWNER_UID = typeof process.getuid === 'function' ? process.getuid() : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bounded wait (docs/42 §8): every await in this file is either bounded here or is an operation
 * the deployment itself bounds. */
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
  const root = mkdtempSync(join(tmpdir(), `bt314l3-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args, cwd = repo) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue314l3@example.invalid']);
  git(['config', 'user.name', 'Issue314l3']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'second commit\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  return {
    root, repo, home, configRoot, deploymentRoot, base,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
  };
}
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** The exact adapter card the ordinary resident self-check requires (the issue306a fixture card). */
function adapter() {
  const value = new MockAdapter({ harness: 'codex', scenario: { outcome: 'completed', delayMs: 1, summary: 'issue314 lane 3 fixture' } });
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
      provenance: 'issue314-lane3', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}

/** One open deployment over the fixture world, with the successor spawner injected and the handoff
 * bound shrunk to the test's own scale (the issue306a `resident` helper). */
async function resident(t, f, { onSpawn } = {}) {
  let driver = null;
  const deployment = await openBatonDeployment({
    repo: f.repo,
    advanced: {
      deploymentRoot: f.deploymentRoot,
      adapters: { codex: adapter() },
      routes: [ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: {
        env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
        home: f.home,
        webDrainMs: 500,
        sessionTtlMs: 60_000,
        reincarnationWaitMs: WAIT_MS,
        ...(onSpawn ? { spawnSuccessor: onSpawn } : {}),
      },
    },
  }, (options) => { driver = createDriver(options); return driver; });
  t.after(async () => { try { await deployment.close(); } catch { /* the handoff already closed it */ } });
  return { deployment, driver };
}

const selectorOf = (f) => (existsSync(f.selectorPath) ? JSON.parse(readFileSync(f.selectorPath, 'utf8')) : null);

/** The bridge's discovery inputs for this fixture: the resident published its connection under
 * THIS config root, so the ordinary discovery path reaches it. */
const discoveryOptions = (f, extra = {}) => Object.freeze({
  cwd: f.repo,
  env: { XDG_CONFIG_HOME: f.configRoot, HOME: f.home },
  home: f.home,
  ownerUid: OWNER_UID,
  pollMs: 25,
  commandTimeoutMs: 15_000,
  ...extra,
});

/** The successor's publication, written exactly as the resident writes it: the repository selector
 * beside the private profile (and token file) the discovery reads. */
function publishSuccessor(f, { incarnation, socketPath, token }) {
  const current = selectorOf(f);
  const startedAt = new Date().toISOString();
  const registryDigest = current.registryDigest ?? APPLICATION_SEMANTIC_REGISTRY.digest;
  writeFileSync(f.selectorPath, `${JSON.stringify({
    schemaVersion: 2, profile: current.profile, repoId: current.repoId,
    deploymentId: current.deploymentId, incarnation, transport: 'local', registryDigest, startedAt,
  })}\n`);
  const connections = join(f.configRoot, 'baton', 'connections');
  mkdirSync(connections, { recursive: true, mode: 0o700 });
  const tokenPath = join(connections, `${current.profile}.token`);
  writeFileSync(tokenPath, `${token}\n`, { mode: 0o600 });
  writeFileSync(join(connections, `${current.profile}.json`), `${JSON.stringify({
    schemaVersion: 2, transport: 'local', socketPath, url: 'https://baton.local',
    origin: 'https://baton.local', tokenFile: tokenPath,
    deploymentId: current.deploymentId, incarnation, registryDigest, startedAt,
    ownerPid: process.pid, ownerPidStart: 'issue314-lane3',
  })}\n`, { mode: 0o600 });
  return Object.freeze({ incarnation, socketPath, registryDigest, startedAt });
}

/**
 * The successor ENDPOINT double: the routes a Baton client opens through, plus the idempotent
 * command ledger a shared coordination ledger reduces to here — a key already applied answers the
 * row it applied, never a second one.
 */
async function startSuccessorResident({ token, session, card }) {
  if (typeof token !== 'string' || token.length === 0) throw new TypeError('the double needs a resident token');
  const directory = mkdtempSync(join('/tmp', 'bt-314l3-double-'));
  const socketPath = join(directory, 'resident.sock');
  const ledger = new Map();
  const keys = [];
  const requests = [];
  const frames = [];
  const attachments = new Set();
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const json = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    if (url.pathname === '/readyz') return json(200, { ok: true, ready: true, schemaVersion: 1 });
    requests.push(Object.freeze({
      path: url.pathname,
      since: url.searchParams.get('since'),
      lastEventId: request.headers['last-event-id'] ?? null,
      kinds: url.searchParams.get('kinds'),
    }));
    if (url.pathname === '/v1/application-card') return json(200, { ok: true, application: card });
    if (url.pathname === '/v1/session') {
      return json(200, { ok: true, identity: session.identity, expiresAt: session.expiresAt });
    }
    if (url.pathname === '/v1/commands') {
      const chunks = [];
      request.on('data', (chunk) => chunks.push(chunk));
      request.on('end', () => {
        let envelope = null;
        try { envelope = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { envelope = null; }
        const key = typeof envelope?.idempotencyKey === 'string' ? envelope.idempotencyKey : null;
        keys.push(key);
        if (key !== null && ledger.has(key)) {
          return json(200, { status: 'completed', result: { ...ledger.get(key), replayed: true } });
        }
        const row = Object.freeze({
          schemaVersion: 1, command: envelope?.command ?? null,
          runId: envelope?.runId ?? null, via: 'successor',
        });
        if (key !== null) ledger.set(key, row);
        return json(200, { status: 'completed', result: row });
      });
      return;
    }
    // The stream's cursor rule, exactly as the resident applies it: no cursor means FROM NOW.
    const head = frames.reduce((high, frame) => Math.max(high, frame.seq), 0);
    const declared = request.headers['last-event-id'] ?? url.searchParams.get('since') ?? null;
    const declaredSince = declared === null ? Number.NaN : Number(declared);
    const from = Number.isSafeInteger(declaredSince) ? declaredSince : head;
    const matching = () => frames.filter((frame) => frame.seq > from);
    if (`${request.headers.accept ?? ''}`.includes('application/json')) {
      return json(200, {
        ok: true,
        wakes: { schemaVersion: 1, kind: 'baton.wake_page', cursor: Math.max(head, from), swarms: [], frames: matching(), lagged: null },
      });
    }
    response.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store' });
    response.write(': wake attachment open\n\n');
    const attachment = { response, closed: false };
    attachments.add(attachment);
    const close = () => {
      if (attachment.closed) return;
      attachment.closed = true;
      attachments.delete(attachment);
    };
    const write = (type, id, value) => {
      if (attachment.closed) return;
      try { response.write(`id: ${id}\nevent: ${type}\ndata: ${JSON.stringify(value)}\n\n`); }
      catch { /* the consumer went away */ }
    };
    for (const frame of matching()) write('wake', frame.seq, frame);
    response.on('close', close);
    response.on('error', close);
    attachment.write = write;
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(socketPath, () => resolveListen());
  });
  chmodSync(directory, 0o700);
  chmodSync(socketPath, 0o700);
  return Object.freeze({
    socketPath,
    requests,
    keys,
    rows: () => Object.freeze([...ledger.values()]),
    attachmentCount: () => attachments.size,
    /** Append one wake row to the deployment's ledger and fan it out to every open attachment. */
    push: (frame) => {
      frames.push(frame);
      for (const attachment of [...attachments]) attachment.write('wake', frame.seq, frame);
    },
    close: async () => {
      for (const attachment of [...attachments]) {
        attachment.closed = true;
        attachment.response.destroy();
      }
      attachments.clear();
      await new Promise((resolveClose) => server.close(resolveClose));
      rmSync(directory, { recursive: true, force: true });
    },
  });
}

/**
 * The successor the injected spawner hands back (the issue306a StubSuccessor, with the publication
 * pointed at this file's endpoint double): it is readiness, it waits for the writer lease the old
 * holds, it publishes, and it can die instead.
 */
class StubSuccessor extends EventEmitter {
  static nextPid = 42_000;
  constructor(spec, { publish, token }) {
    super();
    this.spec = spec;
    this.publish = publish;
    this.token = token;
    this.pid = StubSuccessor.nextPid++;
    this.stderr = new EventEmitter();
    this.exitCode = null;
    this.signalCode = null;
    this.journal = { spawnedAt: Date.now() };
  }
  writeMarker(state) {
    writeFileSync(this.spec.markerPath, `${JSON.stringify({
      schemaVersion: 1, incarnation: this.spec.env.BATON_INCARNATION, pid: this.pid, state,
      at: new Date().toISOString(),
    })}\n`);
  }
  becomeReady() { this.writeMarker('waiting'); this.journal.readyAt = Date.now(); }
  /** The successor's own open+publish, in the order production has it: lease free → take → publish. */
  async openAndPublish() {
    await until(() => !existsSync(this.spec.leasePath), { label: 'the writer lease release' });
    this.writeMarker('opened');
    this.published = this.publish(this.spec.env.BATON_INCARNATION, this.token);
    this.journal.publishedAt = Date.now();
  }
  crash({ code = 7, tail = 'boom: the successor refused to start\n' } = {}) {
    this.stderr.emit('data', Buffer.from(tail));
    this.exitCode = code;
    this.emit('exit', code, null);
  }
  kill() { this.exitCode = null; this.signalCode = 'SIGKILL'; this.emit('exit', null, 'SIGKILL'); return true; }
}

const PRINCIPAL_OF = (principal) => Object.freeze({
  actor: `mcp:${principal.userId}:${principal.sessionId}`,
  principalId: principal.userId,
  sessionId: principal.sessionId,
});
const CONTEXT = Object.freeze({ transport: 'mcp', requestId: 'l3-1', idempotencyKey: 'mcp.call:l3-1' });

/** The session-bound principal every dispatch of this file uses: the bridge's own bound authority,
 * exactly as the northbound passes it. */
const callerOf = async (facade) => PRINCIPAL_OF(await facade.principal());

/** ONE staged handoff: the successor becomes ready, the old drains and hands its publication over,
 * and the successor's endpoint is the double. `successorOf` reads the stub the injected spawner
 * minted (it does not exist until the deployment spawns it), and the receipt is awaited here so a
 * handoff that fails is a test failure, never an unhandled rejection. */
async function stageHandoff(f, deployment, successorOf) {
  const pending = deployment.reincarnate({ target: f.base });
  await until(() => successorOf() !== null, { label: 'the successor spawn' });
  successorOf().becomeReady();
  // The request completes on its OWN rows (the successor is up and waiting); only then does the
  // operator's stop run the drain that hands the publication over (the #306 sequence).
  const receipt = await pending;
  const closing = deployment.close();
  await until(() => successorOf().journal.publishedAt !== undefined, { label: 'the successor publication' });
  const closed = await closing;
  return { receipt, closed, incarnation: selectorOf(f).incarnation };
}

// ── 314e-l3-a ───────────────────────────────────────────────────────────────────────────────────

test('314e-l3-a: a served bridge session answers from the successor after a staged handoff, with ONE typed notification', async (t) => {
  const f = world('a');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => {
      stub = new StubSuccessor(spec, { token: 'successor-token-l3a', publish: (incarnation, token) => publishSuccessor(f, {
        incarnation, socketPath: successorSocket.socketPath, token,
      }) });
      stub.openAndPublish().catch(() => {});
      return stub;
    },
  });
  await deployment.host();
  const oldSelector = selectorOf(f);
  const oldIncarnation = oldSelector.incarnation;

  // The successor's endpoint double: a card that still carries the ordinary floor, and a session
  // the resident would mint for its own successor incarnation (the same user, the same grant).
  const opened = await openBatonWebConnection(discoveryOptions(f));
  const bound = await opened.client.session();
  const successorSessionId = `session-incarnation-${oldIncarnation}-successor`;
  const successorSocket = await startSuccessorResident({
    token: 'successor-token-l3a',
    session: {
      schemaVersion: 1,
      identity: { ...bound.identity, sessionId: successorSessionId },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    card: { ...opened.card, commands: [...opened.card.commands] },
  });
  t.after(() => successorSocket.close());

  let rediscoveries = 0;
  const facade = new BatonWebApplicationFacade(opened.client, opened.card, opened.session, {
    incarnation: opened.incarnation,
    rediscover: () => { rediscoveries += 1; return openBatonWebConnection(discoveryOptions(f)); },
  });
  t.after(() => facade.closeWakes());

  const deliveries = [];
  const receipt = await facade.wakeSubscribe({ kinds: ['contribution_recorded'] },
    (frame, subscription) => { deliveries.push({ frame, subscription }); });
  assert.equal(typeof receipt.subscriptionId, 'string', 'the subscription receipt is the landed shape');

  const { incarnation: successorIncarnation } = await stageHandoff(f, deployment, () => stub);

  const reincarnated = await until(
    () => deliveries.filter((delivery) => delivery.frame?.kind === 'baton.resident_reincarnated'),
    { label: 'the session\'s reincarnation notification' },
  );
  assert.equal(reincarnated.length, 1,
    'LAW (docs/49 §6.5): ONE typed notification per handoff — the session re-bound exactly once');
  const notification = reincarnated[0].frame;
  assert.equal(notification.from.incarnation, oldIncarnation, 'the notification names the incarnation it left');
  assert.equal(notification.to.incarnation, successorIncarnation, 'and the successor that publishes now');
  assert.equal(notification.from.sessionId, bound.identity.sessionId, 'from the session the old resident minted');
  assert.equal(notification.to.sessionId, successorSessionId, 'to the session the successor minted');
  assert.ok(Number.isFinite(Date.parse(notification.at)), `the notification carries its instant: ${notification.at}`);
  assert.ok(notification.cursor === null || Number.isSafeInteger(notification.cursor),
    'the notification names the cursor the resumed attachment starts from');

  // The session now talks to the successor: the same call answers from ITS endpoint.
  const answer = await facade.command('run.review', { runId: 'run:l3a' }, await callerOf(facade), CONTEXT);
  assert.equal(answer.via, 'successor', `the next call is answered by the successor: ${JSON.stringify(answer)}`);
  assert.equal(successorSocket.requests.filter((request) => request.path === '/v1/application-card').length, 1,
    'the successor was discovered once — one publication read, one adoption');
  assert.ok(rediscoveries >= 1, 'the rediscovery the rebind authority owns was actually used');
});

// ── 314e-l3-b ───────────────────────────────────────────────────────────────────────────────────

test('314e-l3-b: an in-flight mutation at the boundary is applied once — the replay carries the same key', async (t) => {
  const f = world('b');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => {
      stub = new StubSuccessor(spec, { token: 'successor-token-l3b', publish: (incarnation, token) => publishSuccessor(f, {
        incarnation, socketPath: successorSocket.socketPath, token,
      }) });
      stub.openAndPublish().catch(() => {});
      return stub;
    },
  });
  await deployment.host();

  const opened = await openBatonWebConnection(discoveryOptions(f));
  const bound = await opened.client.session();
  const successorSocket = await startSuccessorResident({
    token: 'successor-token-l3b',
    session: {
      schemaVersion: 1,
      identity: { ...bound.identity, sessionId: `session-incarnation-${selectorOf(f).incarnation}-successor` },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    card: { ...opened.card, commands: [...opened.card.commands] },
  });
  t.after(() => successorSocket.close());

  // NO wake subscription: the only fact that can carry this session across the boundary is the
  // dispatch the caller made — the transport failure the mutation meets is what triggers the rebind.
  const facade = new BatonWebApplicationFacade(opened.client, opened.card, opened.session, {
    incarnation: opened.incarnation,
    rediscover: () => openBatonWebConnection(discoveryOptions(f)),
  });
  t.after(() => facade.closeWakes());

  await stageHandoff(f, deployment, () => stub);

  const principal = await callerOf(facade);
  const first = await facade.command('run.review', { runId: 'run:l3b' }, principal, CONTEXT);
  assert.equal(first.via, 'successor', 'the in-flight mutation is retried against the successor');
  assert.equal(successorSocket.rows().length, 1, 'the shared ledger holds ONE row for it');
  assert.equal(successorSocket.keys.length, 1,
    'exactly one attempt reached the successor: the first — refused by the dead transport — never did');

  // The SAME call again: the derived idempotency key is what makes it a replay, never a second row.
  const second = await facade.command('run.review', { runId: 'run:l3b' }, principal, CONTEXT);
  assert.equal(second.replayed, true, `the repeat replays the row it already holds: ${JSON.stringify(second)}`);
  assert.deepEqual(second, { ...first, replayed: true }, 'a replay answers the SAME row');
  assert.equal(successorSocket.keys.length, 2, 'both attempts reached the successor');
  assert.equal(new Set(successorSocket.keys).size, 1,
    'the key is derived once and carried across the rebind — never re-minted for the retry');
  assert.equal(successorSocket.rows().length, 1, 'the ledger still holds one row under that key');
});

// ── 314e-l3-c ───────────────────────────────────────────────────────────────────────────────────

test('314e-l3-c: a wake subscription opened before the handoff still delivers after it, from its cursor', async (t) => {
  const f = world('c');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => {
      stub = new StubSuccessor(spec, { token: 'successor-token-l3c', publish: (incarnation, token) => publishSuccessor(f, {
        incarnation, socketPath: successorSocket.socketPath, token,
      }) });
      stub.openAndPublish().catch(() => {});
      return stub;
    },
  });
  await deployment.host();

  const opened = await openBatonWebConnection(discoveryOptions(f));
  const bound = await opened.client.session();
  const successorSocket = await startSuccessorResident({
    token: 'successor-token-l3c',
    session: {
      schemaVersion: 1,
      identity: { ...bound.identity, sessionId: `session-incarnation-${selectorOf(f).incarnation}-successor` },
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    },
    card: { ...opened.card, commands: [...opened.card.commands] },
  });
  t.after(() => successorSocket.close());

  // The bridge the ENTRY points a harness at: the ordinary open path wires its own rebind authority.
  const facade = await connectBatonWebApplication(discoveryOptions(f));
  t.after(() => facade.closeWakes());

  const deliveries = [];
  const receipt = await facade.wakeSubscribe({},
    (frame, subscription) => { deliveries.push({ frame, subscription }); });

  // One real frame from the OLD resident, so the session has a cursor to resume from.
  const created = await facade.command('swarm.create',
    { purpose: 'issue314 lane 3 wake-resume fixture', idempotencyKey: 'l3c-swarm-create' },
    await callerOf(facade), { ...CONTEXT, requestId: 'l3c-1', idempotencyKey: 'mcp.call:l3c-1' });
  assert.ok(created && typeof created === 'object', 'the old resident served the pre-handoff call');
  const firstFrame = await until(
    () => deliveries.find((delivery) => delivery.frame?.kind === 'baton.wake'),
    { label: 'a wake row from the old resident' },
  );
  const cursor = firstFrame.frame.seq;
  assert.ok(Number.isSafeInteger(cursor) && cursor > 0, `the old resident delivered a seq: ${cursor}`);

  const { incarnation: successorIncarnation } = await stageHandoff(f, deployment, () => stub);

  await until(() => deliveries.some((delivery) => delivery.frame?.kind === 'baton.resident_reincarnated'),
    { label: 'the handoff notification' });

  // The subscription outlives the incarnation it was opened against: the SAME id, the SAME filter,
  // and the resumed attachment names the cursor the session reached.
  const resumed = await until(
    () => successorSocket.requests.find((request) => request.path === '/v1/wakes' && request.lastEventId !== null),
    { label: 'the resumed attachment at the successor' },
  );
  assert.equal(resumed.lastEventId, String(cursor),
    'the resumed attachment reads the SAME ledger from the cursor this session had reached');

  const posted = { schemaVersion: 1, kind: 'baton.wake', seq: cursor + 1, wakeClass: 'contribution_recorded',
    ts: new Date().toISOString(), swarmId: 'swarm-after-handoff', participantId: null, subject: null, next: null, row: null };
  successorSocket.push(posted);
  const delivered = await until(
    () => deliveries.find((delivery) => delivery.frame?.seq === posted.seq),
    { label: 'the post-handoff frame at the subscription opened before it' },
  );
  assert.equal(delivered.subscription.subscriptionId, receipt.subscriptionId,
    'the subscription id never changed across the reincarnation');
  assert.equal(successorSocket.attachmentCount() >= 1, true, 'the session holds one attachment at the successor');
  assert.equal(successorIncarnation, selectorOf(f).incarnation, 'the successor is the published incarnation');
});

// ── 314e-l3-d ───────────────────────────────────────────────────────────────────────────────────

test('314e-l3-d: a handoff that fails produces no rebind and no notification — the #306r re-publish arm is respected', async (t) => {
  const f = world('d');
  let stub = null;
  const { deployment } = await resident(t, f, {
    onSpawn: (spec) => {
      stub = new StubSuccessor(spec, { token: 'unused-l3d', publish: () => { throw new Error('the failed handoff never publishes'); } });
      stub.becomeReady();   // readiness first: this is the #306r window (marker → publication)
      return stub;
    },
  });
  await deployment.host();
  const oldIncarnation = selectorOf(f).incarnation;

  const opened = await openBatonWebConnection(discoveryOptions(f));
  let rediscoveries = 0;
  const facade = new BatonWebApplicationFacade(opened.client, opened.card, opened.session, {
    incarnation: opened.incarnation,
    rediscover: () => { rediscoveries += 1; return openBatonWebConnection(discoveryOptions(f)); },
  });
  t.after(() => facade.closeWakes());

  const deliveries = [];
  await facade.wakeSubscribe({ kinds: ['incarnation_changed'] },
    (frame, subscription) => { deliveries.push({ frame, subscription }); });

  // The #306r staging: the request completes on the successor's readiness, then the successor dies
  // at the publication handoff — the old re-takes its authority and goes on serving.
  const receipt = await deployment.reincarnate({ target: f.base });
  await until(() => stub !== null, { label: 'the successor spawn' });
  assert.equal(receipt.state, 'reincarnating', 'the handoff was requested');
  stub.crash({ code: 9, tail: 'the successor died between its marker and its publication\n' });
  const failedRow = await until(
    () => (existsSync(f.ledgerPath) ? readFileSync(f.ledgerPath, 'utf8') : '').includes('host.reincarnation_failed'),
    { label: 'the window\'s failure row' },
  );
  assert.ok(failedRow, 'the failed handoff is durable — a follower never sees silence');

  // The class's other end reaches the session as a wake row (the old incarnation's own stream).
  const failed = await until(
    () => deliveries.find((delivery) => delivery.frame?.row?.payloadKind === 'host.reincarnation_failed'),
    { label: 'the failed handoff row' },
  );
  assert.equal(failed.frame.wakeClass, 'incarnation_changed', 'the failure rides the closed class');

  // It is not a handoff at all: the predecessor re-took its authority and the publication still
  // names it, so there is no successor to bind to — and nothing to tell the client about.
  await sleep(150);
  assert.equal(rediscoveries, 0, 'a failed handoff never triggers a rediscovery');
  assert.deepEqual(deliveries.filter((delivery) => delivery.frame?.kind === 'baton.resident_reincarnated'), [],
    'and never a notification');
  assert.equal(selectorOf(f).incarnation, oldIncarnation, 'the publication still names the incarnation that serves');
  const doctor = await facade.doctor();
  assert.equal(doctor.ready, true, 'the session still talks to the incarnation that re-took its authority');
});

// ── 314e-l3-e ───────────────────────────────────────────────────────────────────────────────────

test('314e-l3-e: the session lifecycle frame is routed to its own MCP method, beside the wake method (docs/49 §10)', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'baton-314l3-mcp-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const REPO_ID = 'repo-issue314-l3';
  let subscribes = 0;
  let deliver = null;
  const application = {
    repoId: REPO_ID,
    card: () => ({ schemaVersion: 1, repoId: REPO_ID, commands: Object.keys(APPLICATION_COMMAND_DEFINITIONS) }),
    async authorizeReplay() { return true; },
    async actionAuthority() { return { schemaVersion: 1 }; },
    async command(name) { return { schemaVersion: 1, command: name }; },
    async contextEval() { throw new Error('unused'); },
    async decisionList() { return { decisions: [] }; },
    async wakeSubscribe(_params, sink) {
      subscribes += 1;
      deliver = sink;
      return { subscriptionId: 'wake-sub:l3e', since: 7, cursor: 7, attachments: 1 };
    },
    wakeUnsubscribe() { return { subscriptionId: 'wake-sub:l3e', open: false }; },
  };
  const server = new McpFleetServer({
    coordinator: {},
    coordination: new CoordinationStore(join(directory, 'coordination')),
    application, surface: 'application',
    shutdownPrincipal: { actor: 'mcp-host:test', principalId: 'mcp-host', sessionId: 'mcp-host-session' },
    principal: {
      userId: 'operator-a', sessionId: 'stdio-a', capabilities: ['control', 'observe'],
      repoIds: [REPO_ID], expiresAt: new Date(Date.now() + 60_000).toISOString(), revoked: false,
    },
    repoIds: [REPO_ID], now: () => Date.now(), maxWaitMs: 5_000, maxMessageBytes: 64 * 1024,
    takeToolQuota: () => ({ ok: true }),
  });
  const notified = [];
  server.attachNotificationSink((frame) => { notified.push(frame); });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  await server.handle({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
  const subscribed = await server.handle({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'baton_wakes_subscribe', arguments: { repoId: REPO_ID } } });
  assert.equal(subscribed.result?.isError ?? false, false,
    `the subscription answered: ${JSON.stringify(subscribed).slice(0, 600)}`);
  assert.equal(subscribes, 1, 'the session\'s one wake plane was opened');

  deliver({ schemaVersion: 1, kind: 'baton.wake', seq: 9, wakeClass: 'contribution_recorded' });
  deliver({ schemaVersion: 1, kind: 'baton.resident_reincarnated', from: { incarnation: 'inc-1' }, to: { incarnation: 'inc-2' }, cursor: 9, at: new Date().toISOString() });
  assert.deepEqual(notified.map((frame) => frame.method),
    ['notifications/baton/wake', 'notifications/baton/resident_reincarnated'],
    'a wake row rides the wake method; the session\'s own reincarnation fact rides its own');
  assert.deepEqual(notified[1].params.to, { incarnation: 'inc-2' },
    'the notification carries the successor\'s identity verbatim — the server restates no field of it');
});
