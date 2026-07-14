import { createHash } from 'node:crypto';

import { CoordinationStore } from '../../src/index.mjs';

const [mode, directory] = process.argv.slice(2);
if (mode !== undefined || directory !== undefined) {
  if (!['create', 'replay'].includes(mode) || !directory) throw new Error('usage: phase62-locale-plan.js create|replay directory');

const policy = Object.freeze({
  schemaVersion: 1, repoId: 'repo-phase62-locale', mandatory: true, approvalTtlMs: 60 * 60 * 1000,
  riskClasses: ['low', 'medium', 'high', 'critical'], effectClasses: ['repository_edit'], capabilityClasses: ['code'],
  limits: Object.freeze({
    maxGoalVersions: 4, maxPlanVersions: 4, maxNodes: 4, maxDepsPerNode: 4,
    maxTextBytes: 4096, maxItems: 16, maxScopePaths: 16, maxRouteValues: 8,
    maxGoalBytes: 64 * 1024, maxPlanBytes: 128 * 1024, maxStatusBytes: 128 * 1024,
    maxTokens: 100_000, maxUsd: 10, maxWallMin: 60, maxProviderTurns: 100,
  }),
});
const auth = (principalId, key) => ({
  actor: `direct:${principalId}`, principalId,
  sessionDigest: createHash('sha256').update(`session:${principalId}`).digest('hex'),
  repoId: policy.repoId, runId: null, key,
});
const ref = (kind, value) => ({ [`${kind}Id`]: value[`${kind}Id`], version: value.version, digest: value.digest });
const verification = { command: 'node', arguments: ['--test'], cwd: '.', envAllowlist: ['PATH'], expectExit: 0, expectResult: 'exit_code', timeoutMs: 60_000, maxOutputBytes: 1_000_000, requiredPredecessorEvidence: [] };
const store = new CoordinationStore(directory, { goalPlanPolicy: policy });

if (mode === 'create') {
  const goal = store.defineGoal({
    objective: 'Canonicalize across locales', definitionOfDone: ['upper', 'lower'], constraints: [], risk: 'high',
    budget: { tokens: 20_000, usd: 2, wallMin: 10, providerTurns: 8 }, predecessor: null,
  }, auth('owner', 'goal:locale')).goal;
  const node = (key, done) => ({
    key, objective: `Implement ${key}`, definitionOfDone: [done], deps: [], pathScope: ['impl/**'], risk: 'high',
    budget: { tokens: 10_000, usd: 1, wallMin: 5, providerTurns: 4 }, verification,
    routes: { harnesses: ['mock'], models: ['model-a'], efforts: ['low'] }, capabilities: ['code'], effects: ['repository_edit'],
  });
  store.proposePlan({ goal: ref('goal', goal), predecessor: null, nodes: [node('i', 'lower'), node('I', 'upper')] }, auth('planner', 'plan:locale'));
}

const plan = store.snapshot().goalPlan.plans[0];
process.stdout.write(`${JSON.stringify({ digest: plan.digest, keys: plan.nodes.map((node) => node.key) })}\n`);
store.releaseWriterLease();
}
