// Issue #572: deployment open continues successors recorded by older residents.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { CoordinationStore } from '../src/coordination-store.mjs';

const SWARM_ID = 'startup-continuation';
const RESIDENT_ROUTE = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const OWNER = Object.freeze({ actor: 'owner', principalId: 'owner', sessionId: 'owner-session' });

const roots = [];
const temp = (label) => {
  const root = mkdtempSync(join(tmpdir(), `baton-issue572-startup-${label}-`));
  roots.push(root);
  return root;
};
test.after(() => { for (const root of roots) rmSync(root, { recursive: true, force: true }); });

const git = (cwd, args) => execFileSync('git', args, {
  cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
}).trim();

function repository(label) {
  const root = temp(label);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'issue572@example.invalid']);
  git(root, ['config', 'user.name', 'issue572']);
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true, scripts: { test: 'node --test' } }));
  mkdirSync(join(root, 'test'), { recursive: true });
  writeFileSync(join(root, 'test', 'smoke.test.mjs'),
    "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('smoke', () => assert.equal(1, 1));\n");
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return { root, baseSha: git(root, ['rev-parse', 'HEAD']) };
}

/** The exact adapter card a served deployment open requires (the phase89/issue384 idiom). */
function adapter() {
  const value = new MockAdapter({
    harness: RESIDENT_ROUTE.harness,
    scenario: { outcome: 'completed', delayMs: 1, summary: 'issue572 startup fixture' },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(),
    authPosture: 'subscription',
    providerCompatibility: { credentialState: 'available' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: { supported: ['unattended'], default: 'unattended', perTask: false, observation: 'unavailable', mechanisms: ['fixture-unattended'] },
      access: { supported: ['full'], default: 'full', perTask: false, observation: 'unavailable', mechanisms: ['fixture-full'] },
      containment: { hostProcess: 'same_uid', guarantees: ['private_runtime'], observation: 'unavailable', configuredPreferences: [] },
    },
    modelSelection: { mode: 'exact', configuredDefault: 'gpt-5.6-sol', available: ['gpt-5.6-sol'], family: 'codex',
      acceptedPrefixes: [], acceptedAliases: [], reasoningEffort: ['high'], serviceTier: null,
      provenance: 'issue572-startup-continuation', refreshedAt: null },
    permissions: { mode: 'unattended-full', boundary: 'fixture same-UID host access' },
  });
  return value;
}

function configuredFor(f, label) {
  const deploymentRoot = join(temp(`${label}-deployment`), 'deployment');
  mkdirSync(deploymentRoot, { recursive: true });
  const home = join(temp(`${label}-home`), 'home');
  mkdirSync(home, { recursive: true });
  const configRoot = join(temp(`${label}-cfg`), 'config');
  mkdirSync(configRoot, { recursive: true });
  return {
    root: f.root,
    deploymentRoot,
    advanced: {
      deploymentRoot,
      adapters: { codex: adapter() },
      routes: [RESIDENT_ROUTE],
      verification: { command: 'node', arguments: ['--test'] },
      resident: { env: { XDG_CONFIG_HOME: configRoot, HOME: home }, home, webDrainMs: 1_000, sessionTtlMs: 60_000 },
    },
  };
}

const coordinationRoot = (deploymentRoot) => join(deploymentRoot, 'state', 'coordination');
const ledgerRows = (deploymentRoot) => {
  const path = join(coordinationRoot(deploymentRoot), 'events.jsonl');
  if (!existsSync(path)) return [];
  return readFileSync(path, 'utf8').split('\n').filter((line) => line !== '').map((line) => JSON.parse(line));
};
/** Swarm rows may be recorded directly or wrapped by the driver's own recorder. */
const rowsOfKind = (deploymentRoot, kind) => ledgerRows(deploymentRoot)
  .filter((row) => row.kind === kind || (row.kind === 'driver.recorded' && row.payload?.kind === kind))
  .map((row) => (row.kind === kind ? row : row.payload));

/** The durable state an older resident leaves behind: rows written, nothing driven. */
function seedLegacyPendingSuccessor(deploymentRoot) {
  const store = new CoordinationStore(coordinationRoot(deploymentRoot));
  const auth = (key) => ({ actor: OWNER.actor, key });
  store.recordSwarm('swarm.created', { swarmId: SWARM_ID, purpose: 'Continue a seat at open' }, auth('legacy-swarm'));
  store.recordSwarm('swarm.participant_joined', {
    swarmId: SWARM_ID, participantId: 'lead', role: 'Lead the recovered work',
    permissions: ['read', 'communicate', 'contribute', 'review', 'organize'],
  }, auth('legacy-lead-join'));
  store.recordSwarm('swarm.participant_joined', {
    swarmId: SWARM_ID, participantId: 'bravo', runId: 'run-legacy-bravo',
    role: 'Continue the lead', resumeFrom: 'lead', parentId: 'lead',
    permissions: ['read', 'communicate', 'contribute', 'review', 'organize'],
  }, auth('legacy-bravo-join'));
  store.recordSwarm('swarm.resume_decision_requested', {
    swarmId: SWARM_ID, participantId: 'bravo', predecessor: 'lead',
    carry: { how: 'bound', workspaceId: null, snapshotSha: null }, plan: { options: {} },
  }, auth('legacy-bravo-request'));
  // A legacy resident exited, so the lease is free: the seeding store must let go, or the
  // deployment open refuses `coordination_writer_busy` on a lease nobody holds in production.
  store.releaseWriterLease({ requireOwned: true });
}

test('572-startup: a legacy pending successor starts at deployment open, with no command and no view', async (t) => {
  const f = repository('open');
  const configured = configuredFor(f, 'open');
  seedLegacyPendingSuccessor(configured.deploymentRoot);
  assert.equal(rowsOfKind(configured.deploymentRoot, 'swarm.resume_decision_answered').length, 0,
    'the legacy state starts unanswered - nothing has driven it');

  // Opening the deployment must drive the seeded continuation.
  const deployment = await openBatonDeployment({ repo: configured.root, advanced: configured.advanced },
    (options) => createDriver({ ...options }));
  t.after(async () => { try { await deployment.close(); } catch { /* best effort */ } });

  const answered = rowsOfKind(configured.deploymentRoot, 'swarm.resume_decision_answered');
  assert.equal(answered.length, 1,
    'opening the deployment drives the pending successor exactly once, with no command issued');
  assert.equal(answered[0].payload?.participantId, 'bravo',
    'the answer names the successor the legacy state left pending');
  assert.equal(answered[0].payload?.predecessor, 'lead',
    'and the seat it continues');
  assert.equal(answered[0].payload?.guidance?.automatic, true,
    'the continuation is the automatic answer, not an operator decision');
  assert.equal(answered[0].idempotencyKey, `resume-continuation:${SWARM_ID}:bravo`,
    'the drive is keyed, so the same decision can never be answered twice');
  assert.equal(answered[0].actor, 'baton-runtime',
    'the deployment itself drove it - no caller, no command row, no view');
});
