// Phase 92 RED contract for evidence-result objectives. The mock transcript and process lifecycle
// are fixtures; they are not live-provider output or PID-reap proof.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { APPLICATION_SEMANTIC_REGISTRY, MockAdapter, openBaton } from '../src/index.mjs';

const ROUTE = Object.freeze({ harness: 'mock', model: 'phase92-review', effort: 'high' });

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase92-read-only-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase92@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 92'], { cwd: root });
  writeFileSync(join(root, 'README.md'), '# review target\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function adapter() {
  const value = new MockAdapter({
    harness: ROUTE.harness,
    scenario: {
      outcome: 'completed', delayMs: 1,
      summary: 'Evidence-backed review: the target is coherent and no repository edit is needed.',
      files: {},
    },
  });
  const card = value.card.bind(value);
  value.card = () => ({
    ...card(), version: 'mock 1.0.0', authPosture: 'fixture',
    providerCompatibility: { credentialState: 'available' },
    modelSelection: {
      mode: 'exact', configuredDefault: ROUTE.model, available: [ROUTE.model],
      family: 'mock', acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [ROUTE.effort], serviceTier: null,
      provenance: 'phase92-fixture', refreshedAt: null,
    },
    permissions: { mode: 'unattended-full', boundary: 'same-UID test process' },
    workerPolicy: {
      schemaVersion: 1,
      autonomy: {
        supported: ['unattended'], default: 'unattended', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      access: {
        supported: ['full'], default: 'full', perTask: false,
        observation: 'unavailable', mechanisms: [],
      },
      containment: {
        hostProcess: 'same_uid', guarantees: ['private_runtime'],
        configuredPreferences: [], observation: 'unavailable',
      },
    },
  });
  return value;
}

async function terminal(run) {
  const deadline = Date.now() + 10_000;
  let last = null;
  while (Date.now() < deadline) {
    const view = await run.status(); last = view;
    if (['completed', 'failed', 'cancelled', 'stopped'].includes(view.phase)) return view;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Run did not settle: ${JSON.stringify({
    phase: last?.phase, terminalCause: last?.terminalCause, nodes: last?.nodes,
    objectiveResultPolicy: last?.objectiveResultPolicy,
  })}`);
}

test('P92-OR1: declared read-only review accepts a verified textual capsule, while a change objective still requires an edit', async (t) => {
  const repo = repository(t);
  const deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot: join(repo, '.deployment'), adapters: { mock: adapter() }, routes: [ROUTE],
      verification: { command: 'node', arguments: ['--version'] },
    },
  });
  t.after(async () => { try { await deployment.close(); } catch {} });

  const review = await deployment.run(
    'Read-only review and research report: assess the target and return evidence; make no repository changes.',
    { exact: ROUTE },
  );
  await review.approve();
  const reviewed = await terminal(review);
  assert.equal(reviewed.phase, 'completed');
  assert.equal(reviewed.terminalCause, null);
  assert.equal(reviewed.result?.state, 'accepted');
  assert.deepEqual(reviewed.planPreview.node.requiredEffects ?? [], []);
  assert.equal(reviewed.planPreview.node.effects.includes('repository_edit'), false);
  assert.equal(reviewed.objectiveResultPolicy.mode, 'read_only_evidence');

  const helpTopics = new Set([
    'application', 'advanced', 'worker-policy', 'workflow', 'run.inspect.context',
    ...Object.keys(APPLICATION_SEMANTIC_REGISTRY.cli.helpTopics),
    ...Object.values(APPLICATION_SEMANTIC_REGISTRY.operations).map((value) => value.helpTopic),
    ...Object.values(APPLICATION_SEMANTIC_REGISTRY.actions).map((value) => value.helpTopic),
  ]);
  for (const topic of helpTopics) {
    const outline = await review.help(topic);
    assert.equal(outline.topic, topic, topic);
    assert.equal(outline.depth, 'outline', topic);
    assert.equal(typeof outline.summary, 'string', topic);
    assert.deepEqual(outline.continuation, {
      operation: 'application.help',
      arguments: { topic, depth: 'content', runId: review.id },
    }, topic);
    const content = await review.help(
      outline.continuation.arguments.topic,
      outline.continuation.arguments.depth,
    );
    assert.equal(content.content?.kind, 'baton.help.content', topic);
    assert.equal(content.content?.topic, topic, topic);
    assert.equal(Array.isArray(content.content?.paragraphs), true, topic);
    assert.equal(content.continuation, null, topic);
  }
  await assert.rejects(
    review.help('run.inspect.selector-archaeology'),
    (error) => error?.code === 'application_help_topic_unknown',
  );

  const change = await deployment.run('Change the repository implementation and verify it.', {
    exact: ROUTE,
  });
  await change.approve();
  const unchanged = await terminal(change);
  assert.equal(unchanged.phase, 'failed');
  assert.deepEqual(unchanged.terminalCause, {
    kind: 'policy_failure', code: 'required_effect_absent',
  });
});
