// Issue #309 — the brief carries the Baton surface. The 2026-09-14 incident: seven of seven
// lanes finished and left their contribution unpublished because their briefs advertised no
// Baton surface, though the participant bridge sat in their environment the whole time. The
// repair: every swarm recruit's brief renders a `## Swarm` section derived ONCE from
// SWARM_NATIVE_GUIDANCE plus the bridge's own guidance, and brief.tools lists the bridge with
// its verbs — while a non-swarm run's brief stays byte-for-byte what it was.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { BatonApplication, MockAdapter, bindBaton, createDriver } from '../src/index.mjs';
import { renderBrief } from '../src/adapter.mjs';
import { createBrief } from '../src/messages.mjs';
import { SWARM_PERMISSIONS } from '../src/swarm-runtime.mjs';
import { SWARM_NATIVE_GUIDANCE, SWARM_BRIEF_SECTION, SWARM_BRIDGE_TOOL } from '../src/swarm-native-access.mjs';
import { SWARM_BRIDGE_ENV_KEYS, SWARM_BRIDGE_GUIDANCE, SWARM_BRIDGE_NOTHING_RECORDED } from '../src/swarm-native-bridge.mjs';
import { SWARM_COMMAND_NAMES, SWARM_EVENT_KINDS } from '../src/swarm-contract.mjs';
// #425: the brief may also name a kind the RUNTIME records into the swarm fold (never
// caller-submittable), so the registered vocabulary the pin checks against is the fold's own set too.
import { SWARM_EVENT_KINDS as SWARM_FOLD_EVENT_KINDS } from '../src/swarm-state.mjs';

const policy = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-swarm-brief-surface',
  mandatory: true,
  approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'],
  effectClasses: ['repository_edit', 'provider_call'],
  capabilityClasses: ['code', 'test'],
  limits: Object.freeze({
    maxGoalVersions: 16, maxPlanVersions: 16, maxNodes: 32, maxDepsPerNode: 16,
    maxTextBytes: 4096, maxItems: 64, maxScopePaths: 64, maxRouteValues: 32,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 256 * 1024, maxStatusBytes: 256 * 1024,
    maxTokens: 1_000_000, maxUsd: 100, maxWallMin: 24 * 60, maxProviderTurns: 10_000,
  }),
});

const verification = Object.freeze({
  command: 'true', arguments: [], cwd: '.', envAllowlist: ['PATH'], expectExit: 0,
  expectResult: 'exit_code', timeoutMs: 10_000, maxOutputBytes: 64 * 1024,
  requiredPredecessorEvidence: [],
});

const profile = Object.freeze({
  schemaVersion: 1,
  repoId: 'repo-swarm-brief-surface',
  definitionOfDone: ['deployment verification passes'],
  constraints: ['Keep the change inside the approved repository scope'],
  risk: 'high',
  goalBudget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 },
  nodeBudget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 },
  pathScope: ['impl/**', 'spec/**'],
  verification,
  routes: [{ harness: 'mock', model: 'model-a', effort: 'low' }],
  capabilities: ['code', 'test'],
  effects: ['repository_edit'],
  resultPolicy: { mode: 'manual', maxAdoptedResults: 1, locator: 'git_ref' },
});

const principal = (principalId) => ({
  actor: `direct:${principalId}`,
  principalId,
  sessionId: `${principalId}-session`,
});

const selection = { exact: { harness: 'mock', model: 'model-a', effort: 'low' }, scope: ['impl/**'] };

async function waitFor(predicate, what) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'baton-swarm-brief-'));
  const repo = join(directory, 'repo');
  execFileSync('git', ['init', '-q', repo]);
  Object.assign(process.env, { GIT_AUTHOR_NAME: 'Swarm brief test', GIT_COMMITTER_NAME: 'Swarm brief test' });
  Object.assign(process.env, { GIT_AUTHOR_EMAIL: 'swarm-brief@example.invalid', GIT_COMMITTER_EMAIL: 'swarm-brief@example.invalid' });
  writeFileSync(join(repo, 'base.txt'), 'base\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: repo });
  const adapter = new MockAdapter({ harness: 'mock', scenario: { outcome: 'completed', delayMs: 5, summary: 'Contribution ready', files: {} } });
  const card = adapter.card.bind(adapter);
  adapter.card = () => ({
    ...card(),
    modelSelection: {
      mode: 'exact', configuredDefault: 'model-a', available: ['model-a'], family: 'mock',
      acceptedPrefixes: ['model-'], acceptedAliases: [], reasoningEffort: ['low'],
      serviceTier: null, provenance: 'test', refreshedAt: null,
    },
  });
  // Capture every brief the coordinator hands the adapter at the provider edge — the same
  // value renderBrief renders for every dialect.
  const briefs = [];
  const spawn = adapter.spawn.bind(adapter);
  adapter.spawn = (workerId, brief, opts) => { briefs.push(brief); return spawn(workerId, brief, opts); };
  const driver = createDriver({ repoRoot: repo, repoId: policy.repoId, logDir: join(directory, 'log'),
    adapters: { mock: adapter }, goalPlanAuthority: { policy, authorize: async () => true }, stopDeadlineMs: 2000 });
  const app = new BatonApplication({ driver, repoId: policy.repoId, profiles: { standard: profile },
    principals: { planner: principal('planner'), dispatcher: principal('dispatcher'), observer: principal('observer') },
    authorize: async () => true });
  t.after(async () => {
    await app.shutdown(principal('cleanup'));
    rmSync(directory, { force: true, recursive: true });
  });
  await app.ready;
  return { app, driver, adapter, briefs, baton: bindBaton(app, principal('orchestrator')) };
}

const swarmSectionOf = (text) => {
  const start = text.indexOf('## Swarm');
  if (start < 0) return null;
  const rest = text.slice(start + '## Swarm'.length);
  const next = rest.indexOf('\n## ');
  return (next < 0 ? rest : rest.slice(0, next)).trim();
};

test('a swarm recruit through SwarmRuntime gets a brief that carries the Baton surface', async (t) => {
  const { baton, briefs } = await fixture(t);
  const swarm = await baton.swarms.create('Publish every contribution', { swarmId: 'surface' });
  await swarm.recruit('lead', 'Coordinate implementation', { ...selection, permissions: SWARM_PERMISSIONS });
  const brief = await waitFor(() => briefs.find((candidate) => String(candidate.goal ?? '').includes('continuing participant')),
    'the recruit brief to reach the adapter');
  const text = renderBrief(brief, 'omp-rpc');

  const section = swarmSectionOf(text);
  assert.ok(section, 'the rendered brief carries a ## Swarm section');
  // One derivation: the rendered section is exactly the shared derivation, so the brief text
  // and SWARM_NATIVE_GUIDANCE cannot drift apart.
  assert.equal(section, SWARM_BRIEF_SECTION);
  assert.ok(section.startsWith(SWARM_NATIVE_GUIDANCE), 'the section is derived from SWARM_NATIVE_GUIDANCE');
  assert.ok(section.includes(SWARM_BRIDGE_GUIDANCE), 'the section carries the bridge guidance');

  // The environment variable NAMES that locate the bridge — never their values.
  for (const name of Object.values(SWARM_BRIDGE_ENV_KEYS)) {
    assert.ok(section.includes(name), `the section names ${name}`);
  }
  assert.doesNotMatch(section, /TOKEN\s*[=:]\s*\S/u, 'the section names the token variable without spelling a value');
  assert.doesNotMatch(section, /Bearer\s+\S/u, 'no bearer credential appears in the brief');

  // The body rule: the whole report goes inside the payload's body field.
  assert.ok(section.includes('"body"'), 'the section shows the body field as the report envelope');

  // The answer and the refusal: the recorded seq, and the Nothing-was-recorded refusal shape.
  assert.ok(section.includes('seq'), 'the section says the answer carries the recorded seq');
  assert.ok(section.includes(SWARM_BRIDGE_NOTHING_RECORDED), 'the section says what a refusal looks like');

  // Ending a turn without publishing leaves the work unreachable for the root.
  assert.match(section, /ending a turn without publishing/u);

  // brief.tools lists the bridge with its verbs, so Tools is never empty for a recruit.
  assert.doesNotMatch(text, /No tools are advertised/u);
  const toolsSection = text.slice(text.indexOf('## Tools'), text.indexOf('## Write authority'));
  assert.ok(toolsSection.includes(SWARM_BRIDGE_TOOL), `brief.tools lists the bridge with its verbs: ${toolsSection}`);
});

test('a non-swarm run brief is unchanged: no Swarm section and the empty-tools sentence stays', async (t) => {
  const { baton, briefs } = await fixture(t);
  await (await baton.runs.start('Plain non-swarm objective', selection)).approve();
  const brief = await waitFor(() => briefs.find((candidate) => candidate.goal === 'Plain non-swarm objective'),
    'the plain run brief to reach the adapter');
  const text = renderBrief(brief, 'omp-rpc');
  assert.ok(!text.includes('## Swarm'), 'a non-swarm brief carries no Swarm section');
  assert.match(text, /No tools are advertised/u, 'the non-swarm tools section is unchanged');
});

test('the Swarm section, SWARM_NATIVE_GUIDANCE, and the bridge guidance are one derivation', () => {
  assert.equal(SWARM_BRIEF_SECTION, `${SWARM_NATIVE_GUIDANCE}\n\n${SWARM_BRIDGE_GUIDANCE}`,
    'the brief section is derived from the guidance plus the bridge guidance, never re-spelled');
  for (const name of Object.values(SWARM_BRIDGE_ENV_KEYS)) {
    assert.ok(SWARM_BRIEF_SECTION.includes(name), `the derivation names ${name}`);
  }
  assert.ok(SWARM_BRIEF_SECTION.includes(SWARM_BRIDGE_NOTHING_RECORDED),
    'the derivation carries the bridge refusal prefix');
  assert.ok(SWARM_BRIDGE_TOOL.includes('$BATON_SWARM_CLIENT') && SWARM_BRIDGE_TOOL.includes('swarm.view')
    && SWARM_BRIDGE_TOOL.includes('swarm.update'), 'the bridge tool entry names the client and its verbs');
  assert.ok(SWARM_BRIDGE_TOOL.includes('swarm.stop'),
    'the bridge tool entry teaches the stop a seat holds over the seats it leads (#584)');
  // Every swarm verb the section names is a registered command or event kind, and the guidance
  // keeps the retry truth it is already pinned to (issue292 pins, now over the whole section).
  const known = new Set([...SWARM_COMMAND_NAMES, ...SWARM_EVENT_KINDS, ...SWARM_FOLD_EVENT_KINDS]);
  for (const name of SWARM_BRIEF_SECTION.match(/\bswarm\.[a-z_]+/gu) ?? []) {
    assert.ok(known.has(name), `${name} is a registered command or event kind`);
  }
  assert.doesNotMatch(SWARM_BRIEF_SECTION, /\binspect\b/u, 'the section never points at an unregistered verb');
  assert.match(SWARM_NATIVE_GUIDANCE, /shown by swarm\.view/u);
  assert.match(SWARM_NATIVE_GUIDANCE, /a NEW attempt needs a NEW key/u);
});

test('renderBrief pins: a brief without the surface renders exactly as before', () => {
  const plain = createBrief({
    goal: 'Do the thing', constraints: [], pathScope: [], definitionOfDone: 'It is done',
    verification: { command: 'true', expectExit: 0 }, budget: { tokens: 1000, usd: 1, wallMin: 10 },
  });
  const text = renderBrief(plain, 'omp-rpc');
  assert.ok(!text.includes('## Swarm'));
  assert.match(text, /No tools are advertised/u);
});
