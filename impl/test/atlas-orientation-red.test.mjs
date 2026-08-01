import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
  BatonApplication, CapabilityRegistry, MockAdapter, createDriver,
} from '../src/index.mjs';

const roots = [];
const temp = (name) => {
  const root = mkdtempSync(join(tmpdir(), `baton-atlas-orientation-${name}-`));
  roots.push(root);
  return root;
};
const write = (root, path, value) => {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), value);
};
const git = (root, args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const repo = (name, files) => {
  const root = temp(name);
  git(root, ['init', '-q']);
  git(root, ['config', 'user.email', 'atlas@example.invalid']);
  git(root, ['config', 'user.name', 'Atlas Contract']);
  for (const [path, value] of Object.entries(files)) write(root, path, value);
  git(root, ['add', '.']);
  git(root, ['commit', '-qm', 'base']);
  return root;
};
const atlas = (root) => ({
  artifactRoot: join(root, 'atlas-artifacts'),
  maxArtifactBytes: 256 * 1024,
  maxSourceBytes: 64 * 1024,
  maxFiles: 64,
  maxResults: 256,
});
const driver = (root, overrides = {}) => createDriver({
  repoRoot: root,
  repoId: 'atlas-contract-repo',
  logDir: temp('log'),
  adapters: {},
  atlas: atlas(root),
  maxCapabilityBudgetTokens: 20_000,
  maxCapabilityEnvelopeBytes: 512 * 1024,
  ...overrides,
});

test.after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('AT-1: registry per-call worktreeRoot and symbol-focused orientation use the worker overlay', async () => {
  const calls = [];
  const capability = {
    card: () => ({ name: 'probe', version: 1, ops: { read: { latency_class: 'interactive', deterministic: true } } }),
    async invoke(op, _args, ctx) {
      calls.push(ctx);
      return { op, status: 'ok', summary: 'probe', payload: [], refs: [], cost: { tokens_out: 0, wall_ms: 0, usd: 0, underlying: 'probe' }, provenance: { deterministic: true } };
    },
  };
  const registry = new CapabilityRegistry({
    capabilities: { probe: capability }, maxBudgetTokens: 100, maxEnvelopeBytes: 16 * 1024,
    root: '/deployment/repository', record: () => {},
  });
  await registry.invoke('probe', 'read', {}, { budgetTokens: 10, worktreeRoot: '/workers/w-1' });
  assert.equal(calls[0].worktreeRoot, '/workers/w-1');

  const base = repo('symbol-base', {
    'src/focus.js': `export function target(value) { return value + 1 }\nexport const use = () => target(1)\n`,
    'src/unrelated.js': `export const unrelated = 1\n`,
  });
  const composed = driver(base);
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 10_000 });
  const args = {
    indexEpoch: built.provenance.index_epoch,
    focus: 'target', shape: 'brief',
    symbolFocus: { symbols: ['target'], paths: ['src/focus.js'], references: true },
  };
  const overlay = temp('worker-overlay');
  execFileSync('cp', ['-R', `${base}/.`, overlay]);
  const first = await composed.coordinator.invokeCapability('cartographer', 'orientation.slice', args, { budgetTokens: 5_000, worktreeRoot: overlay });
  write(overlay, 'src/unrelated.js', `export const unrelated = 2\n`);
  const unrelated = await composed.coordinator.invokeCapability('cartographer', 'orientation.slice', args, { budgetTokens: 5_000, worktreeRoot: overlay });
  assert.equal(unrelated.refs[0].digest, first.refs[0].digest, 'an unrelated overlay edit does not perturb a focused slice');
  write(overlay, 'src/focus.js', `export function target(value) { return value + 2 }\nexport const use = () => target(2)\n`);
  const focused = await composed.coordinator.invokeCapability('cartographer', 'orientation.slice', args, { budgetTokens: 5_000, worktreeRoot: overlay });
  assert.notEqual(focused.refs[0].digest, first.refs[0].digest, 'a focused-file edit refreshes the overlay slice');
  assert.equal(focused.payload.some((item) => item.kind === 'symbol.references'), true);
  composed.close();
});

test('AT-2: createDriver composes the full opted-in Atlas set with budgets, ceilings, and a pre-gate structural card', () => {
  const root = repo('composition', { 'src/value.js': `export const value = 1\n` });
  const composed = driver(root);
  const cards = composed.coordinator.capabilityCards();
  assert.deepEqual(cards.map((card) => card.name), ['atlas-index', 'atlas-structural', 'cartographer']);
  assert.ok(cards.every((card) => Object.keys(card.ops).length > 0));
  assert.ok(cards.every((card) => card.ceilings && Number.isSafeInteger(card.ceilings.maxArtifactBytes)));
  const structural = cards.find((card) => card.name === 'atlas-structural');
  assert.equal(structural.ops['diff.structural'].reverifiable, true);
  assert.equal(structural.languageCeiling.family, 'javascript-typescript');
  composed.close();
});

const principal = (id) => ({ actor: `direct:${id}`, principalId: id, sessionId: `${id}-session` });
const goalPlanPolicy = Object.freeze({
  schemaVersion: 1, repoId: 'atlas-contract-repo', mandatory: true, approvalTtlMs: 60_000,
  riskClasses: ['low', 'medium', 'high'], effectClasses: ['repository_edit'], capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 8, maxPlanVersions: 8, maxNodes: 8, maxDepsPerNode: 4,
    maxTextBytes: 4_096, maxItems: 32, maxScopePaths: 16, maxRouteValues: 8,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 128 * 1024, maxStatusBytes: 128 * 1024,
    maxTokens: 100_000, maxUsd: 10, maxWallMin: 60, maxProviderTurns: 32,
  }),
});
const profile = Object.freeze({
  schemaVersion: 1, repoId: 'atlas-contract-repo', definitionOfDone: ['verification passes'],
  constraints: ['Keep changes in scope'], risk: 'medium',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**'],
  verification: {
    command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
    expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024, requiredPredecessorEvidence: [],
  },
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'], effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});
const configuredAdapter = () => {
  const adapter = new MockAdapter({ harness: 'mock', scenario: {
    outcome: 'completed', delayMs: 10, summary: 'signature changed',
    edits: [{ path: 'impl/value.mjs', content: `export function value(input, options = {}) { return input + (options.delta ?? 1) }\n`, atMs: 1 }],
  } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: { mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock', acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'], serviceTier: null, provenance: 'test', refreshedAt: null },
  });
  return adapter;
};

test('AT-3: gate verification writes bounded structural CAS + ledger evidence and run.evidence cites it on read without changing the verdict', async () => {
  const root = repo('structural-gate', { 'impl/value.mjs': `export function value(input) { return input + 1 }\n` });
  const adapter = configuredAdapter();
  const composed = driver(root, {
    adapters: { mock: adapter }, goalPlanAuthority: { policy: goalPlanPolicy, authorize: async () => true },
    stopDeadlineMs: 2_000,
  });
  const application = new BatonApplication({
    driver: composed, repoId: 'atlas-contract-repo', profiles: { atlas: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true,
  });
  const runId = 'run-atlas-structural';
  const proposed = await application.start({
    runId, objective: 'Change the value signature', profile: 'atlas',
    route: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'],
  }, principal('owner'));
  await application.approve(runId, proposed.plan.digest, principal('approver'));
  const finished = await application.wait(runId, principal('owner'), { timeoutMs: 5_000 });
  assert.equal(finished.phase, 'work_completed');
  const structuralEvent = composed.log.read('hub-atlas').find((event) => event.kind === 'atlas.structural_classified');
  assert.ok(structuralEvent);
  assert.equal(structuralEvent.payload.changeClass, 'signature_changed');
  assert.match(structuralEvent.payload.digest, /^[a-f0-9]{64}$/);
  assert.ok(structuralEvent.payload.bytes <= atlas(root).maxArtifactBytes);
  assert.equal(existsSync(structuralEvent.payload.path), true);
  const artifact = JSON.parse(readFileSync(structuralEvent.payload.path, 'utf8'));
  assert.equal(artifact.ceiling.maxArtifactBytes, atlas(root).maxArtifactBytes);
  assert.ok(artifact.files.some((file) => file.path === 'impl/value.mjs'));
  const verdictEvent = composed.log.read(structuralEvent.payload.worker).find((event) => event.kind === 'verify.reverified');
  assert.equal(verdictEvent.payload.accept, true, 'structural class informs but never adjudicates');

  const beforeRead = composed.coordination.events().length;
  const evidence = await application.command('run.evidence', { runId }, principal('owner'));
  const cited = evidence.artifacts.find((item) => item.kind === 'structural-class');
  assert.equal(cited.digest, structuralEvent.payload.digest);
  assert.equal(composed.coordination.events().length, beforeRead, 'run.evidence remains a read-only projection');
  await application.shutdown(principal('shutdown'));
});

test('AT-4: a non-JS/TS repository gets an explicit honest-empty ceiling and never a fabricated map', async () => {
  const root = repo('honest-empty', { 'README.md': '# prose only\n', 'src/value.py': 'value = 1\n' });
  const composed = driver(root);
  const cards = composed.coordinator.capabilityCards();
  for (const name of ['atlas-index', 'atlas-structural', 'cartographer']) {
    const card = cards.find((candidate) => candidate.name === name);
    assert.equal(card.availability.status, 'empty');
    assert.equal(card.availability.reason, 'language_ceiling');
  }
  const built = await composed.coordinator.invokeCapability('atlas-index', 'index.build', {}, { budgetTokens: 5_000 });
  assert.deepEqual(built.payload, []);
  assert.equal(built.provenance.language_ceiling, 'honest_empty');
  const slice = await composed.coordinator.invokeCapability('cartographer', 'orientation.slice', {
    indexEpoch: built.provenance.index_epoch, focus: 'value', shape: 'brief',
  }, { budgetTokens: 2_000, worktreeRoot: root });
  assert.deepEqual(slice.payload, []);
  assert.equal(slice.provenance.language_ceiling, 'honest_empty');
  assert.match(slice.summary, /no JavaScript\/TypeScript/i);
  composed.close();
});
