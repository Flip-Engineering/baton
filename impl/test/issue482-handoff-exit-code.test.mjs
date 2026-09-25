// Issue #482 — after a COMPLETED reincarnation handoff the OLD incarnation's `baton serve` ends
// with a settled top-level await: exit 0, and no "Detected unsettled top-level await" on stderr.
//
// THE FACT: #461 made the old incarnation end BY ITSELF — once the handoff is done it lets go of
// every handle it still holds (the successor's process with its stdio pipes included) and its own
// event loop drains. Nothing ever RESOLVES the top-level `await serveDeployment(...)` it stands on,
// though: the signal lifecycle it awaits is ended by a signal or by the declared parent's exit, and
// a handoff is neither. Node therefore ended the process under an unsettled top-level await — exit
// code 13 and the warning on stderr — which every supervisor (launchd, the #471 fixture helper's
// parent watch, an operator's script) reads as a failure.
//
// RED before the fix, measured on a clean worktree at the same base (fed18071): row 482-a ends with
//   `=== OLD EXIT 13` and `Warning: Detected unsettled top-level await at …/impl/scripts/baton.mjs`
//   `await serveDeployment(configured, openSignals.pendingTrigger());`
// while rows 482-b/482-c pass either way — they are the guards that the repair takes nothing from
// the successor and nothing from the signal path.
//
// What each row pins, on a REAL `baton serve` child (spawned through the #471 helper, so a killed
// runner leaves no resident behind) whose successor is a REAL second process:
//   482-a — the old process exits 0 by itself, its stderr carries no unsettled-top-level-await
//           warning, its stop tail names the `incarnation_exit` stage (#461's own vocabulary, so
//           the exit is the handoff's and never a signal's), and the resident's closing line — the
//           one written only after the serve loop settles — is on it;
//   482-b — the successor is unaffected: still running after the old is gone, and the publication
//           it wrote still names it (the old's withdrawal removed only the old's own bytes);
//   482-c — an ordinary SIGTERM stop still exits 0 with no warning, and its ledger names why.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { HOST_CAPACITY_BYPASS } from '../src/host-capacity.mjs';

import { endFixtureResident, spawnFixtureResident } from './fixtures/fixture-resident.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/baton.mjs', import.meta.url));
const INDEX_URL = new URL('../src/index.mjs', import.meta.url).href;
const ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
// The warning Node prints when the loop drains under a top-level await it never settled.
const UNSETTLED = /unsettled top-level await/u;
// The successor-start wait is event-driven (the successor's ready marker or its exit event ends
// it), and the remaining handoff windows keep their frame bound (host.reincarnation.wait_ms, in
// minutes); a fixture handoff on an idle machine is seconds, so this wait is generous.
const STOP_BOUND_MS = 60_000;
// Comfortably past the successor's own predecessor watch poll: a successor that the old's exit had
// touched would show it by now.
const SETTLE_MS = 1_500;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(probe, label, timeoutMs = STOP_BOUND_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(25);
  }
}

const roots = [];
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

/** A fixture world: the repository the resident serves (TWO commits, so a reincarnation has
 * somewhere to go), the HOME/XDG roots its connection is published under, and the deployment root
 * its state directory lives in. The verification is declared (an unnamed one is ambiguous and the
 * resident refuses to open over it) and the git identity is a fixture's, never the operator's. */
function world(label) {
  const root = mkdtempSync(join(tmpdir(), `bt482-${label}-`));
  roots.push(root);
  const repo = join(root, 'repo');
  const home = join(root, 'home');
  const configRoot = join(root, 'config');
  const deploymentRoot = join(root, 'deployment');
  for (const directory of [repo, home, configRoot, deploymentRoot]) mkdirSync(directory, { recursive: true });
  const git = (args) => spawnSync('git', args, { cwd: repo, encoding: 'utf8' }).stdout.trim();
  git(['init', '-q']);
  git(['config', 'user.email', 'issue482@example.invalid']);
  git(['config', 'user.name', 'Issue482']);
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(repo, 'test'), { recursive: true });
  writeFileSync(join(repo, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(['add', '.']);
  git(['commit', '-qm', 'base']);
  const base = git(['rev-parse', 'HEAD']);
  writeFileSync(join(repo, 'landing.txt'), 'landing\n');
  git(['add', '.']);
  git(['commit', '-qm', 'landing']);
  const landing = git(['rev-parse', 'HEAD']);
  return {
    root, repo, home, configRoot, deploymentRoot, base, landing,
    selectorPath: join(repo, '.git', 'baton', 'connection.json'),
    ledgerPath: join(deploymentRoot, 'state', 'coordination', 'events.jsonl'),
    plainLedgerPath: join(repo, '.git', 'baton', 'application-v3', 'state', 'coordination', 'events.jsonl'),
  };
}

const selectorOf = (f) => (existsSync(f.selectorPath) ? JSON.parse(readFileSync(f.selectorPath, 'utf8')) : null);

function ledgerRows(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter((line) => line.length > 0).map((line) => JSON.parse(line));
}
const hostRows = (file) => ledgerRows(file).filter((row) => row.kind === 'driver.recorded'
  && typeof row.payload?.kind === 'string' && row.payload.kind.startsWith('host.'));
const hostRow = (file, kind) => hostRows(file).find((row) => row.payload.kind === kind) ?? null;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch { return false; }
}

/** The successor the fixture spawns: a REAL process (a real OS handle for the old to let go of)
 * that behaves like the handoff's second half — readiness marker, then the release of the writer
 * lease it waits on, then its own publication — and then stays alive the way a resident does. */
const SUCCESSOR_SOURCE = `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const spec = JSON.parse(process.env.B482_SPEC);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marker = (state) => writeFileSync(spec.markerPath, JSON.stringify({
  schemaVersion: 1, incarnation: spec.incarnation, pid: process.pid, state, at: new Date().toISOString(),
}) + '\\n');
marker('waiting');
process.stderr.write('482 successor online ' + spec.incarnation + '\\n');
while (existsSync(spec.leasePath)) await sleep(10);
const current = JSON.parse(readFileSync(spec.selectorPath, 'utf8'));
marker('opened');
writeFileSync(spec.selectorPath, JSON.stringify({ ...current, incarnation: spec.incarnation, startedAt: new Date().toISOString() }) + '\\n');
writeFileSync(spec.profilePath, JSON.stringify({
  schemaVersion: 2, transport: 'local', socketPath: spec.socketPath, url: 'https://baton.local',
  origin: 'https://baton.local', tokenFile: spec.tokenPath.split('/').at(-1), deploymentId: current.deploymentId,
  incarnation: spec.incarnation, registryDigest: current.registryDigest, startedAt: new Date().toISOString(),
  ownerPid: process.pid, ownerPidStart: 'successor',
}) + '\\n');
writeFileSync(spec.tokenPath, 'a'.repeat(48) + '\\n');
setInterval(() => {}, 1000);
`;

/** The serve config the resident is started with: a real fixture deployment (real state directory,
 * real coordination store, real owner socket) whose successor spawner hands back the real child
 * process above. `baton serve <config>` is the ONE path in which the top-level await under test
 * exists, and the injected spawner is what makes a handoff complete without a second checkout. */
function deploymentModule(fixture) {
  const successorPath = join(fixture.root, 'successor.mjs');
  writeFileSync(successorPath, SUCCESSOR_SOURCE);
  const modulePath = join(fixture.root, 'deployment.mjs');
  writeFileSync(modulePath, `
import { spawn } from 'node:child_process';
import { MockAdapter, openBaton } from ${JSON.stringify(INDEX_URL)};
const ROUTE = Object.freeze(${JSON.stringify(ROUTE)});
function adapter() {
  const value = new MockAdapter({ harness: ROUTE.harness, scenario: { outcome: 'completed', delayMs: 1, summary: 'issue482 fixture' } });
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
      provenance: 'issue482-handoff-exit-code', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' } });
  return value;
}
export const createBatonDeployment = () => openBaton({
  repo: process.cwd(),
  advanced: {
    deploymentRoot: ${JSON.stringify(fixture.deploymentRoot)},
    adapters: { codex: adapter() },
    routes: [ROUTE],
    verification: { command: 'node', arguments: ['--test'] },
    resident: {
      env: { XDG_CONFIG_HOME: ${JSON.stringify(fixture.configRoot)}, HOME: ${JSON.stringify(fixture.home)} },
      home: ${JSON.stringify(fixture.home)}, webDrainMs: 2_000, sessionTtlMs: 60_000,
      spawnSuccessor: (spec) => spawn(process.execPath, [${JSON.stringify(successorPath)}], {
        stdio: ['ignore', 'ignore', 'pipe'],
        env: { ...process.env, B482_SPEC: JSON.stringify({
          markerPath: spec.markerPath, selectorPath: spec.selectorPath, profilePath: spec.profilePath,
          tokenPath: spec.tokenPath, leasePath: spec.leasePath,
          socketPath: ${JSON.stringify(join(fixture.deploymentRoot, 'successor.sock'))},
          incarnation: spec.env.BATON_INCARNATION,
        }) },
      }),
    },
  },
});
`);
  return { modulePath, successorPath };
}

/** A real `baton serve` child over the fixture deployment, spawned through the #471 helper (so a
 * runner killed outright leaves no resident behind) and waited for by its own publication. */
function startResident(t, { fixture, argv = [] }) {
  const [bypassName, bypassValue] = HOST_CAPACITY_BYPASS.split('=');
  const env = {
    ...process.env, HOME: fixture.home, XDG_CONFIG_HOME: fixture.configRoot, [bypassName]: bypassValue,
  };
  const child = spawnFixtureResident(t, { args: [SCRIPT, 'serve', ...argv], cwd: fixture.repo, env });
  const state = { stderr: '', exited: null };
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk) => { state.stderr += chunk; });
  child.on('exit', (code, signal) => { state.exited = { code, signal }; });
  return {
    child, state, env,
    async untilReady() {
      await until(() => state.exited !== null
        || (existsSync(fixture.selectorPath) && state.stderr.includes('"state":"published"')),
      'the resident to publish');
      assert.equal(state.exited, null, `the resident exited before it published: ${state.stderr.slice(-2_000)}`);
    },
    async untilExited() {
      await until(() => state.exited !== null, 'the resident to end');
      return state.exited;
    },
    /** One CLI invocation against the served resident, exactly as an operator runs it: the real
     * entry script, from the served checkout, in the environment the connection was published in. */
    cli(argv) {
      return spawnSync(process.execPath, [SCRIPT, ...argv], {
        cwd: fixture.repo, env, encoding: 'utf8', timeout: 60_000,
      });
    },
  };
}

test('482-a: the old incarnation exits 0 by itself after the handoff, with no unsettled top-level await', async (t) => {
  const f = world('handoff');
  const { modulePath } = deploymentModule(f);
  const resident = startResident(t, { fixture: f, argv: [modulePath] });
  await resident.untilReady();
  const before = selectorOf(f);
  assert.equal(resident.state.exited, null, 'the old incarnation is the live one');

  // The operator's own reincarnation verb, from a second process, over the published connection:
  // the receipt answers before the old stops answering.
  const request = resident.cli(['deployment', 'reincarnate', f.base]);
  assert.equal(request.status, 0, `the request is admitted: ${request.stderr}`);
  assert.match(request.stdout, /"state": "reincarnating"/u, request.stdout);

  // THE FACT: the old incarnation ends by itself — no signal, no operator, exit 0 — and the top
  // level await it was standing on settled, so Node never printed its unsettled-await warning.
  const exited = await resident.untilExited();
  assert.deepEqual(exited, { code: 0, signal: null },
    `the old incarnation exits 0 by itself (stderr tail: ${resident.state.stderr.slice(-2_000)})`);
  assert.doesNotMatch(resident.state.stderr, UNSETTLED,
    `no unsettled-top-level-await warning: ${resident.state.stderr.slice(-2_000)}`);
  // …and the exit is the HANDOFF's, not a signal's: only a committed handoff marks this stage, and
  // the resident's closing line — written past the serve loop's own wait — is on the same stderr.
  assert.match(resident.state.stderr, /host\.stopped tail .*incarnation_exit \d+ms/u,
    `the tail names the incarnation exit: ${resident.state.stderr.slice(-2_000)}`);
  assert.match(resident.state.stderr, /"state":"closed"/u,
    `the resident announced its close, which only a settled serve loop writes: ${resident.state.stderr.slice(-2_000)}`);

  // The durable half: the handoff ran to its end on this ledger, and the publication moved.
  const stopped = hostRow(f.ledgerPath, 'host.stopped');
  assert.ok(stopped, `the stop's outcome is durable: ${JSON.stringify(hostRows(f.ledgerPath).map((row) => row.payload.kind))}`);
  assert.ok(hostRow(f.ledgerPath, 'host.successor_started'), 'the successor the old minted is named');
  assert.notEqual(selectorOf(f)?.incarnation, before.incarnation,
    'the successor serves the publication the old withdrew');
});

test('482-b: the successor is unaffected by the old incarnation\'s exit', async (t) => {
  const f = world('successor');
  const { modulePath } = deploymentModule(f);
  const resident = startResident(t, { fixture: f, argv: [modulePath] });
  await resident.untilReady();

  const request = resident.cli(['deployment', 'reincarnate', f.base]);
  assert.equal(request.status, 0, `the request is admitted: ${request.stderr}`);
  await resident.untilExited();

  // The successor the old SPAWNED is a real process: the old's exit must leave it untouched — the
  // old let go of the handle (#461) rather than ending the child, and nothing reaps it when the
  // parent's loop drains.
  const started = hostRow(f.ledgerPath, 'host.successor_started');
  assert.ok(Number.isSafeInteger(started?.payload?.pid), `the successor pid is durable: ${JSON.stringify(started?.payload)}`);
  const successorPid = started.payload.pid;
  await sleep(SETTLE_MS);
  assert.equal(alive(successorPid), true, 'the successor process is still running after the old is gone');
  // …and the publication it wrote still stands: the old withdrew exactly its own bytes.
  assert.equal(selectorOf(f)?.incarnation, started.payload.incarnation,
    'the publication still names the successor incarnation');
});

test('482-c: an ordinary SIGTERM stop still exits 0 and carries no warning', async (t) => {
  const f = world('sigterm');
  const resident = startResident(t, { fixture: f });
  await resident.untilReady();

  resident.child.kill('SIGTERM');
  const exited = await resident.untilExited();
  assert.deepEqual(exited, { code: 0, signal: null },
    `a signal stop takes the ordinary path, exit 0 (stderr tail: ${resident.state.stderr.slice(-2_000)})`);
  assert.doesNotMatch(resident.state.stderr, UNSETTLED,
    `no unsettled-top-level-await warning: ${resident.state.stderr.slice(-2_000)}`);
  // The signal path is the one it always was: it NARRATED the stop (the operator's line is written
  // before any drain), and its ledger names the request and the outcome — a handoff marks neither
  // of the stages 482-a pins, and this stop marks no `incarnation_exit`.
  assert.match(resident.state.stderr, /signal received/u, resident.state.stderr.slice(-2_000));
  assert.ok(hostRow(f.plainLedgerPath, 'host.stop_requested'), 'the ledger names the stop request');
  assert.ok(hostRow(f.plainLedgerPath, 'host.stopped'), 'the ledger names the stop outcome');
  assert.doesNotMatch(resident.state.stderr, /incarnation_exit/u,
    'an ordinary stop marks no incarnation-exit stage');
});
