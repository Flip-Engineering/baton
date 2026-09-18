// Issue #468 — every stream the resident holds is guarded, and a successor owns its log.
//
// The live evidence (primary `178289`, fourth successor of 2026-09-18 13:36:01Z): an EPIPE nobody
// caught reached `process` seven seconds after two omp workers were recruited, and the #383
// last-resort handler's narration — the ONE line that would have named the failing stream — was
// lost, because #461 tees a successor's stderr into its PREDECESSOR's serve log and the predecessor
// exits after the handoff (by design). Four handoffs that day; no successor had a log.
//
// The four rows below pin the fix, each observable on its own:
//   (a) a worker child whose stdin is gone does NOT stop the resident: the adapter owns the pipe
//       failure and the seat's own durable log names the stream (`lifecycle.pipe_error`);
//   (b) an EPIPE on the SSE leg (the client vanishes mid-write) is recorded as
//       `host.stream_error {stream: 'sse', code, at}` on the resident's driver lane, and the
//       resident keeps serving the very next attachment;
//   (c) on the issue306a fixture, the successor's `host.successor_started {log}` names a PATH —
//       a file the successor itself opens at open, which receives its `answering` line — and the
//       successor's own `host.reincarnated {log}` names the same file; the successor outlives the
//       predecessor whose pipe used to carry (and then lose) its narration;
//   (d) the last-resort trigger row carries `code` AND the stack head durably, and the narration it
//       writes is in the incarnation's own log even when stderr is a pipe with no reader.
//
// Hermetic: temp repositories, temp deployment roots, an injected successor spawner (the fixture
// repo is not Baton's own checkout) and an injected crash trigger; no provider process, no network.
// `git stash` is never used.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { incarnationServeLogPath } from '../src/application-deployment.mjs';
// macOS names the temp root both as /var/… and /private/var/…; the successor derives its log
// path from its real cwd, the fixture from the symlinked tmpdir — one file, one spelling.
const realpathOf = (p) => String(p).replace(/^\/private\//u, '/');
import { CoordinationStore } from '../src/coordination-store.mjs';
import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';
import { Log } from '../src/log.mjs';
import { OmpRpcCli } from '../src/omp-rpc.mjs';
import { WakeStream } from '../src/wake-stream.mjs';
import { WebSessionStore } from '../src/web-auth.mjs';
import { WebNorthbound } from '../src/web-northbound.mjs';

const SCRIPT = new URL('../scripts/baton.mjs', import.meta.url).pathname;
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const ORIGIN = 'https://baton.local';
const REPO_ID = 'repo-issue-468';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });
function scratch(prefix) {
  const root = mkdtempSync(join(tmpdir(), `${prefix}-`));
  roots.push(root);
  return root;
}

/** A real temporary repository with two commits (the issue306a world): the resident serves the
 * second and reincarnates onto the first, so the handoff has a target that is not the served one. */
function world(label) {
  const root = scratch(`bt468-${label}`);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-q']);
  git(['config', 'user.email', 'issue468@example.invalid']);
  git(['config', 'user.name', 'Issue468']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']).stdout.trim();
  writeFileSync(join(repo, 'landing.txt'), 'landing\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const landing = git(['rev-parse', 'HEAD']).stdout.trim();
  return {
    root, repo, home, configRoot, deploymentRoot, base, landing,
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
  };
}

const ledgerRows = (file) => (existsSync(file)
  ? readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line))
  : []);
const hostRows = (file) => ledgerRows(file).filter((row) => row.kind === 'driver.recorded'
  && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
const hostRow = (file, kind) => hostRows(file).find((row) => row.payload.kind === kind) ?? null;

// ── (a) the worker child's pipe ─────────────────────────────────────────────────────────────────

/** A child-shaped fixture whose stdin is a Socket like the real one: `write` answers, and the
 * ASYNCHRONOUS failure a closed pipe raises is emittable — the exact event #383's guard owns. The
 * child comes up ready (a real ready frame), so the adapter's spawn completes and the pipe failure
 * is the only thing this row measures. */
class FakeChild extends EventEmitter {
  constructor({ pid = 468_001 } = {}) {
    super();
    this.pid = pid;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new EventEmitter();
    this.stdin.destroyed = false;
    this.stdin.writableEnded = false;
    this.stdin.write = () => true;
    this.stdin.end = () => { this.stdin.writableEnded = true; };
    this.stdin.destroy = () => { this.stdin.destroyed = true; };
    setImmediate(() => this.stdout.write(`${JSON.stringify({ type: 'ready', protocolVersion: 1 })}\n`));
  }
  kill() { return true; }
  unref() { return this; }
}

test('468a: a worker child whose stdin is gone does not stop the resident, and the seat gets the row', async () => {
  const seat = 'w-468a';
  const MODEL = 'deepseek/deepseek-v4-flash';
  const logDir = scratch('bt468-a-log');
  // The resident's own operational log for a seat, in the format the coordinator writes it:
  // `adapter.onEvent` -> `Log.append`. The row this file asserts on is the one the ADAPTER emits;
  // the store half is the coordinator's existing one-line wiring, mirrored here.
  const log = new Log(logDir);
  // One child per spawn: the second seat spawned below needs a child of its own (and a ready frame
  // of its own) to prove the adapter is still serving after the first seat's pipe died.
  const children = [];
  const adapter = new OmpRpcCli({
    requestTimeoutMs: 1_000, model: MODEL, modelCatalog: { [MODEL]: ['high'] },
    versionProbe: () => 'omp test',
    spawnFn: () => {
      const next = new FakeChild({ pid: 468_000 + children.length + 1 });
      children.push(next);
      return next;
    },
  });
  const emitted = [];
  adapter.onEvent((event) => {
    emitted.push(event);
    if (event?.actor === 'worker') log.append({ ...event, harness: 'omp' });
  });

  let uncaught = null;
  const onUncaught = (error) => { uncaught = error; };
  process.once('uncaughtException', onUncaught);
  let ack;
  let second;
  try {
    ack = await adapter.spawn(seat, { goal: 'issue468a' }, {
      model: MODEL, reasoningEffort: 'high', worktree: '/tmp',
    });
    // The seam #383 named as the fifth EPIPE of 2026-09-18: the child closed its stdin and the
    // adapter's frame raises on that Socket, ASYNCHRONOUSLY (outside every try/catch).
    children[0].stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' }));
    await sleep(50);
    // The resident did not stop: the same adapter keeps serving a second seat.
    second = await adapter.spawn('w-468a-2', { goal: 'issue468a-2' }, {
      model: MODEL, reasoningEffort: 'high', worktree: '/tmp',
    });
  } finally { process.off('uncaughtException', onUncaught); }

  assert.equal(ack?.ok, true, `the seat spawned: ${JSON.stringify(ack)}`);
  assert.equal(uncaught, null, 'an unowned pipe error would have been an uncaught exception');
  assert.equal(second?.ok, true, `the adapter goes on serving: ${JSON.stringify(second)}`);

  // The row names the stream AND the seat, durably — on the seat's own log, the file the resident
  // writes for it. The 13:36Z EPIPE left no row at all; this is that row.
  const rows = log.read(seat);
  const pipeError = rows.find((row) => row.kind === 'lifecycle.pipe_error') ?? null;
  assert.ok(pipeError, `the seat's log carries the pipe failure: ${JSON.stringify(rows.map((r) => r.kind))}`);
  assert.equal(pipeError.worker, seat, 'the row names the seat it happened to');
  assert.equal(pipeError.payload.stream, 'stdin', 'the row names the stream that failed');
  assert.equal(pipeError.payload.code, 'EPIPE', 'the row names the failure the kernel raised');
  const onDisk = readFileSync(join(logDir, `${seat}.jsonl`), 'utf8')
    .split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
  assert.ok(onDisk.some((row) => row.kind === 'lifecycle.pipe_error' && row.payload?.stream === 'stdin'),
    'the row is on the seat\'s log file, not only in memory');
  // The ordinary transport-stall notice the runner already reads is unchanged beside it: the same
  // `content.message` phase/stream/code pair the adapter emitted before this issue.
  assert.ok(emitted.some((event) => event.kind === 'content.message' && event.payload?.phase === 'pipe_error'
    && event.payload?.stream === 'stdin' && event.payload?.code === 'EPIPE'),
  `the stall notice still rides: ${JSON.stringify(emitted.filter((e) => e.kind === 'content.message'))}`);
  await adapter.kill(seat);
  await adapter.kill('w-468a-2');
});

// ── (b) the SSE leg ─────────────────────────────────────────────────────────────────────────────

/** A response stand-in for one SSE attachment: headers, a write that accepts, and the ONE event a
 * vanished client raises on the real stream. */
class SseResponse extends EventEmitter {
  constructor() {
    super();
    this.headersSent = false;
    this.writableEnded = false;
    this.destroyed = false;
    this.written = [];
  }
  writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; return this; }
  write(chunk) { this.written.push(String(chunk)); return true; }
  end() { this.writableEnded = true; return this; }
}

test('468b: an EPIPE on the SSE leg records host.stream_error and the resident keeps serving', async () => {
  const directory = scratch('bt468-b');
  const coordination = new CoordinationStore(join(directory, 'coordination'));
  const sessions = new WebSessionStore(join(directory, 'sessions'));
  const issued = sessions.issue({
    userId: 'local-owner', authMethod: 'bearer',
    capabilities: ['observe', 'control'], repoIds: [REPO_ID], ttlMs: 600_000,
  }, { actor: 'deployment:resident' });
  // The REAL northbound over a real coordination ledger and the real wake stream; only the
  // application facade is absent (this leg never dispatches a command).
  const web = new WebNorthbound({
    coordinator: {}, coordination, sessions, repoIds: [REPO_ID], allowedOrigins: [ORIGIN],
    wakes: new WakeStream({ coordination, pollMs: 25 }),
    wakeHeartbeatMs: 25,
  });
  // The request the owner-only Unix socket hands the leg: a bearer session over the transport the
  // resident's own server marks (`https`, the local socket's identity), which is what admits the
  // attachment at all — a plaintext request is refused before this leg ever serves.
  const request = {
    headers: { authorization: `Bearer ${issued.token}` },
    socket: { remoteAddress: '127.0.0.1', encrypted: true },
    edgeAddressDigest: null, edgeIdentity: null,
  };
  const url = new URL(`${ORIGIN}/v1/wakes`);

  const res = new SseResponse();
  const attachment = web._handleWakes(request, res, url, ORIGIN);
  await until(() => res.written.some((chunk) => chunk.includes('wake attachment open')),
    'the attachment to open');
  // The client vanishes mid-write: Node raises the write failure on THAT response stream.
  res.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE', syscall: 'write' }));
  await attachment;

  const recorded = coordination.eventsView(0)
    .filter((event) => event.kind === 'driver.recorded' && event.payload?.kind === 'host.stream_error')
    .at(-1) ?? null;
  assert.ok(recorded, 'the SSE leg\'s failure is a durable row, never only a closed socket');
  assert.equal(recorded.payload.stream, 'sse', 'the row names the stream the attachment rides');
  assert.equal(recorded.payload.code, 'EPIPE', 'the row names the code the client\'s departure raised');
  assert.ok(typeof recorded.payload.at === 'string' && Number.isFinite(Date.parse(recorded.payload.at)),
    'the row carries when it happened');

  // The resident keeps serving: the very next attachment opens on the same northbound.
  const next = new SseResponse();
  const second = web._handleWakes(request, next, url, ORIGIN);
  await until(() => next.written.some((chunk) => chunk.includes('wake attachment open')),
    'the next attachment to open');
  next.emit('close');
  await second;
});

// ── (c)/(d) the served resident: a real successor, and a real uncaught EPIPE ─────────────────────

/** The fixture deployment module the served resident opens, exactly the issue306w recipe: a fixture
 * adapter card and a REAL deployment (real state directory, real coordination ledger, real owner
 * socket). `extra` is the row's own fault injection, never production code. */
function deploymentModule(fixture, extra = {}) {
  const advanced = `
    deploymentRoot: ${JSON.stringify(fixture.deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: {
      env: { XDG_CONFIG_HOME: ${JSON.stringify(fixture.configRoot)}, HOME: ${JSON.stringify(fixture.home)} },
      home: ${JSON.stringify(fixture.home)}, webDrainMs: 2_000, sessionTtlMs: 120_000,
      reincarnationWaitMs: 60_000,
      ${extra.resident ?? ''}
    },
  `;
  const path = join(fixture.root, `deployment-${extra.label ?? 'fixture'}.mjs`);
  writeFileSync(path, `
import { spawn as nodeSpawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${JSON.stringify(ROUTE)});
${extra.preamble ?? ''}
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue468 fixture' } });
  const rawCard = value.card.bind(value);
  value.card = () => ({ ...rawCard(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: { schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] } },
    modelSelection: { mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model], family: ROUTE.harness,
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'issue468-stream-errors', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
export const createBatonDeployment = () => {
${extra.body ?? ''}
  return openBaton({ repo: process.cwd(), advanced: {${advanced}} });
};
`);
  return path;
}

const residents = [];
test.after(() => { for (const child of residents) if (child.exitCode === null) child.kill('SIGKILL'); });

/** The served resident: a real `baton serve` child over the fixture deployment, waited for by its
 * own publication (the `"state":"published"` line it writes at the flip). */
function serveResident(label, modulePath) {
  const fixture = world(label);
  const path = modulePath === undefined ? deploymentModule(fixture) : modulePath(fixture);
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const env = {
    ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot,
    [bypassName]: bypassValue,
  };
  const child = spawn(process.execPath, [SCRIPT, 'serve', path], {
    cwd: fixture.repo, env, stdio: ['ignore', 'ignore', 'pipe'],
  });
  const state = { stderr: '' };
  child.stderr.on('data', (chunk) => { state.stderr += chunk.toString('utf8'); });
  residents.push(child);
  return Object.freeze({
    ...fixture, child, state, env, modulePath: path,
    async untilReady(timeoutMs = 90_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (existsSync(fixture.selectorPath) && state.stderr.includes('"state":"published"')) {
          return JSON.parse(readFileSync(fixture.selectorPath, 'utf8'));
        }
        await sleep(25);
      }
      throw new Error(`the fixture resident never published (exit=${child.exitCode}): ${state.stderr.slice(-2_000)}`);
    },
    /** One CLI invocation against the served resident, exactly as an operator runs it. */
    cli(argv) {
      return spawnSync(process.execPath, [SCRIPT, ...argv], {
        cwd: fixture.repo, env, encoding: 'utf8', timeout: 90_000,
      });
    },
  });
}

test('468c: the successor opens its OWN log — the file the predecessor names, carrying its answering line',
  { timeout: 180_000 }, async () => {
    // The fixture repository is not Baton's own checkout, so the successor's script path — the ONE
    // thing production computes from the checkout it serves — is rewritten to the real entry
    // script. Everything else is the spec production minted: argv tail, cwd, env (the handoff
    // declaration), stdio.
    const spawnSuccessor = `
const REAL_SCRIPT = ${JSON.stringify(SCRIPT)};
function spawnSuccessor(spec) {
  const args = [REAL_SCRIPT, ...spec.args.slice(1)];
  return nodeSpawn(spec.command, args, {
    cwd: spec.cwd, env: spec.env, detached: spec.detached, stdio: [...spec.stdio],
  });
}
`;
    const resident = serveResident('c', (fixture) => deploymentModule(fixture, {
      label: 'reincarnate', resident: 'spawnSuccessor,', preamble: spawnSuccessor,
    }));
    await resident.untilReady();

    const receipt = resident.cli(['deployment', 'reincarnate', resident.base]);
    assert.equal(receipt.status, 0, `the reincarnation was admitted: ${receipt.stdout}${receipt.stderr}`);

    const started = await until(() => hostRow(resident.ledgerPath, 'host.successor_started'),
      'the host.successor_started row');
    const logPath = started.payload.log;
    assert.equal(typeof logPath, 'string', 'the row names the successor\'s log');
    assert.notEqual(logPath, 'stderr', '#461\'s stream name is replaced by a path');
    // macOS /private/var vs /var: one file, compared by realpath (the §2.4 rule).
    assert.equal(realpathOf(logPath), realpathOf(incarnationServeLogPath(resident.deploymentRoot, started.payload.incarnation)),
      'the path is the successor\'s own derivation — one name for both halves of the handoff');

    // The successor's OWN narration: the flip line it writes at open, written by the successor
    // process itself into the file the predecessor named.
    const answering = await until(() => {
      if (!existsSync(logPath)) return null;
      const text = readFileSync(logPath, 'utf8');
      return text.includes('answering') ? text : null;
    }, 'the successor\'s log to receive its answering line');
    assert.match(answering, /baton serve: answering \(/u,
      `the successor narrated into its own log: ${answering.slice(-500)}`);

    // The handoff completes: the predecessor exits by itself (#461), and the successor records the
    // rows the old could not — naming the same log on its own half of the record.
    const reincarnated = await until(() => hostRow(resident.ledgerPath, 'host.reincarnated'),
      'the successor\'s host.reincarnated row');
    assert.equal(reincarnated.payload.log, logPath,
      'the successor\'s own row names the log it opened at open');
    await until(() => resident.child.exitCode !== null, 'the predecessor\'s own exit');
    // #461: the old incarnation ENDS BY ITSELF after the handoff — nothing it still held keeps its
    // loop alive, and no signal ends it. (The measured exit code for the real entry script here is
    // 13, Node's "unsettled top-level await": `serveDeployment`'s signal wait is still pending when
    // the loop drains. That is the stop path's own fact, reported by this lane rather than pinned
    // here — this row's contract is the log the successor writes, and the successor's own
    // `host.reincarnated` row is what observes this exit.)
    assert.equal(resident.child.signalCode, null, `the old ends by itself, never by a signal: ${resident.state.stderr.slice(-800)}`);
    // The failure mode of #468: the pipe that used to carry this narration has no reader left.
    // The successor is still alive and its log still answers.
    assert.doesNotThrow(() => process.kill(started.payload.pid, 0),
      'the successor outlives the predecessor whose pipe carried (and then lost) its lines');
    assert.ok(readFileSync(logPath, 'utf8').includes('answering'),
      'the log is still there once the predecessor is gone');
  });

test('468d: the last-resort trigger row names the code and the stack head, and the line survives a dead stderr',
  { timeout: 180_000 }, async () => {
    const resident = serveResident('d', (fixture) => {
      const triggerPath = join(fixture.root, 'crash.trigger');
      return deploymentModule(fixture, {
        label: 'crash',
        preamble: `
const TRIGGER_PATH = ${JSON.stringify(triggerPath)};
function armUncaught() {
  const poll = setInterval(() => {
    if (!existsSync(TRIGGER_PATH)) return;
    clearInterval(poll);
    setTimeout(() => {
      throw Object.assign(new Error('write EPIPE (injected: issue #468 last-resort row)'), { code: 'EPIPE' });
    }, 0);
  }, 25);
  if (typeof poll.unref === 'function') poll.unref();
}
`,
        body: 'armUncaught();',
      });
    });
    const published = await resident.untilReady();
    const incarnation = published.incarnation;

    // The incident's own shape: this incarnation's stderr has NO reader (the predecessor that teed
    // it is gone). Every line the resident narrates from here fails on that pipe.
    resident.child.stderr.destroy();
    // The uncaught exception the guard does not cover (nobody owns its frame): the #383 last-resort
    // handler narrates it — onto the broken pipe — records WHAT reached `process` durably, and
    // routes the stop through the drain.
    writeFileSync(join(resident.root, 'crash.trigger'), 'go\n');

    const requested = await until(() => hostRow(resident.ledgerPath, 'host.stop_requested'),
      'the stop request row');
    assert.equal(requested.payload.trigger, 'uncaught_exception:EPIPE',
      `the trigger names the uncaught code: ${JSON.stringify(requested.payload.trigger)}`);
    assert.equal(requested.payload.code, 'EPIPE', 'the row carries the code, not only the trigger string');
    assert.match(`${requested.payload.stackHead}`, /write EPIPE \(injected: issue #468 last-resort row\)/u,
      `the row carries the stack head: ${requested.payload.stackHead}`);

    // The stream that had no reader is a fact of its own — recorded, never a crash, never a stop.
    const streamError = await until(() => hostRow(resident.ledgerPath, 'host.stream_error'),
      'the stderr stream_error row');
    assert.equal(streamError.payload.stream, 'stderr', 'the row names the stream that has no reader');
    assert.equal(streamError.payload.code, 'EPIPE', 'the row names the failure the write raised');

    await until(() => resident.child.exitCode !== null, 'the resident to stop');
    assert.equal(resident.child.exitCode, 1, 'the resident stops through its own drain, not Node\'s bare exit');

    // The narration the last-resort handler wrote is on the incarnation's OWN log — the pipe that
    // would have carried it is the very stream that died.
    const logPath = incarnationServeLogPath(resident.deploymentRoot, incarnation);
    assert.ok(existsSync(logPath), `the incarnation opened its own log: ${logPath}`);
    const text = readFileSync(logPath, 'utf8');
    assert.match(text, /baton serve: uncaught_exception \(EPIPE\)/u,
      `the last-resort narration survives the pipe it reports on: ${text.slice(-800)}`);
    assert.match(text, /host\.stream_error stderr \(EPIPE\)/u,
      'and the stream failure that preceded it is narrated in the same file');
  });
