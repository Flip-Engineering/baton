import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, openBaton } from '../src/index.mjs';
import { normalizeWorkflowRevision } from '../src/workflow-revision.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'medium' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase80-application-revision-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase80@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 80'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, path, tracker) {
  const value = new MockAdapter({
    harness: route.harness,
    scenario: { outcome: 'completed', edits: [{ path, content: `${route.harness}\n`, delayMs: 20 }] },
  });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase80-application-revision-test', refreshedAt: null,
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
  const nativeSpawn = value.spawn.bind(value);
  let spawnCount = 0;
  value.spawn = (...args) => {
    spawnCount += 1;
    tracker.calls.push({ harness: route.harness, model: args[2]?.model, effort: args[2]?.reasoningEffort });
    if (spawnCount > 1) {
      args[2] = {
        ...args[2],
        scenario: {
          outcome: 'completed',
          edits: [{ path, content: `${route.harness}-revision-${spawnCount}\n`, delayMs: 20 }],
        },
      };
    }
    return nativeSpawn(...args);
  };
  return value;
}

test('AR80-1: selected Candidate feedback proposes one successor Plan pre-effect and replays both rounds', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase80-application-revision-deployment-'));
  const tracker = { calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  const options = {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  };
  deployment = await openBaton(options);
  const workflow = await deployment.workflow('Produce and correct an attributable Candidate.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'Correct the selected Candidate without losing its immutable basis.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Revise this exact changed path.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const selected = await workflow.select('builder', 'Use builder as the correction basis.');
  assert.equal(selected.outline.actions.some((action) => action.kind === 'revise_candidate'), true);
  assert.equal((await workflow.rounds()).section.itemCount, 1);
  const providerCallsBeforeRevision = tracker.calls.length;

  const proposed = await workflow.revise('Address the recorded defect in one bounded correction round.');
  assert.equal(proposed.outline.phase, 'awaiting_plan_approval');
  assert.equal(tracker.calls.length, providerCallsBeforeRevision,
    'successor Plan proposal must precede every revision provider effect');
  const rounds = await workflow.rounds();
  assert.equal(rounds.section.itemCount, 2);
  assert.deepEqual(rounds.section.items.map((item) => item.value.kind), [
    'parallel_attempts', 'revision',
  ]);
  assert.equal(rounds.section.items[1].value.plan.predecessor.digest,
    rounds.section.items[0].value.plan.digest);
  assert.equal(rounds.section.items[1].value.revision.parentCandidateId,
    rounds.section.items[0].value.selection.candidate.id);

  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const plans = events.filter((event) => event.kind === 'plan.version_proposed')
    .map((event) => event.payload.plan);
  assert.equal(plans.length, 2);
  assert.equal(plans[1].nodes.length, 1);
  assert.equal(plans[1].nodes[0].key, 'revision:2:builder');
  const revision = normalizeWorkflowRevision(plans[1].nodes[0].revision);
  assert.equal(revision.parent.resultSha,
    rounds.section.items[0].value.candidates.find((candidate) => candidate.role === 'builder').resultSha);
  assert.equal(events.filter((event) => event.payload?.kind === 'application.workflow_definition_bound').length, 2,
    'every Workflow Plan has one durable semantic prebinding');
  const definitions = events.filter((event) => (
    event.payload?.kind === 'application.workflow_definition_bound'
  )).map((event) => event.payload);
  assert.deepEqual(definitions[0].lineage, {
    generation: 1, rootDefinitionDigest: null, parentDefinitionDigest: null,
  });
  assert.deepEqual(definitions[1].lineage, {
    generation: 2,
    rootDefinitionDigest: definitions[0].definitionDigest,
    parentDefinitionDigest: definitions[0].definitionDigest,
  });
  assert.deepEqual(definitions[1].roleCatalog, definitions[0].roleCatalog);
  assert.deepEqual(definitions[1].attempts[0], {
    role: 'builder', logicalRole: 'builder', nodeKey: 'revision:2:builder',
    nodeTemplateDigest: definitions[0].roleCatalog.roles.find((role) => (
      role.role === 'builder'
    )).nodeTemplateDigest,
    route: routeA,
  });

  await deployment.close();
  deployment = await openBaton(options);
  const replay = deployment.open(workflow.id);
  assert.equal((await replay.status()).phase, 'awaiting_plan_approval');
  const replayRounds = await replay.rounds();
  assert.equal(replayRounds.section.itemCount, 2);
  assert.equal(replayRounds.section.items[0].value.feedback.length, 1);
  assert.equal(replayRounds.section.items[0].value.selection.candidate.role, 'builder');
  await replay.approve();
  assert.equal((await replay.complete()).outline.phase, 'selection_required');
  assert.equal(tracker.calls.length, providerCallsBeforeRevision + 1);
  const completedRounds = await replay.rounds();
  assert.equal(completedRounds.section.items[1].value.candidates.length, 1);
  assert.notEqual(completedRounds.section.items[1].value.candidates[0].resultSha,
    revision.parent.resultSha);
  await replay.stop('Close the revision proposal fixture.');
});

test('AR80-2: a second feedback round appends Plan v3 and replays from its durable definition', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase80-application-v3-deployment-'));
  const tracker = { calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  const options = {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  };
  deployment = await openBaton(options);
  const workflow = await deployment.workflow('Iteratively correct one attributable Candidate.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'Correct the first retained Candidate.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Make the first bounded correction.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  await workflow.select('builder', 'Use builder as the first correction basis.');
  await workflow.revise('Apply the first bounded correction.');
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');

  await workflow.sendFeedback('builder', {
    summary: 'Correct the newly verified revision Candidate.',
    findings: [{
      kind: 'risk', severity: 'medium', message: 'Make a distinct second bounded correction.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const selected = await workflow.select('builder', 'Use the revision Candidate as the next basis.');
  assert.equal(selected.outline.workflow.revisionEligibility.state, 'eligible');
  assert.equal(selected.outline.workflow.revisionEligibility.nextRound, 3);
  const providerCallsBeforeV3 = tracker.calls.length;
  const proposed = await workflow.revise('Apply the second bounded correction.');
  assert.equal(proposed.outline.phase, 'awaiting_plan_approval');
  assert.equal(tracker.calls.length, providerCallsBeforeV3);
  assert.equal((await workflow.rounds()).section.itemCount, 3);

  const events = readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
  const plans = events.filter((event) => event.kind === 'plan.version_proposed')
    .map((event) => event.payload.plan);
  assert.equal(plans.length, 3);
  assert.equal(plans[2].predecessor.digest, plans[1].digest);
  assert.equal(plans[2].nodes[0].key, 'revision:3:builder');
  assert.equal(normalizeWorkflowRevision(plans[2].nodes[0].revision).round, 3);
  assert.equal(events.filter((event) => (
    event.payload?.kind === 'application.workflow_definition_bound'
  )).length, 3);
  const definitions = events.filter((event) => (
    event.payload?.kind === 'application.workflow_definition_bound'
  )).map((event) => event.payload);
  assert.deepEqual(definitions.map((definition) => definition.lineage.generation), [1, 2, 3]);
  assert.equal(definitions[1].lineage.parentDefinitionDigest, definitions[0].definitionDigest);
  assert.equal(definitions[2].lineage.parentDefinitionDigest, definitions[1].definitionDigest);
  assert.equal(definitions[2].lineage.rootDefinitionDigest, definitions[0].definitionDigest);
  assert.equal(definitions.every((definition) => (
    definition.roleCatalog.catalogDigest === definitions[0].roleCatalog.catalogDigest
  )), true);
  assert.deepEqual(definitions.slice(1).map((definition) => definition.attempts[0].logicalRole), [
    'builder', 'builder',
  ]);
  assert.deepEqual(definitions.slice(1).map((definition) => definition.attempts[0].route), [
    routeA, routeA,
  ]);

  await deployment.close();
  deployment = await openBaton(options);
  const replay = deployment.open(workflow.id);
  assert.equal((await replay.status()).phase, 'awaiting_plan_approval');
  const replayRounds = await replay.rounds();
  assert.equal(replayRounds.section.itemCount, 3);
  assert.equal(replayRounds.section.items[2].value.revision.parentCandidateId,
    replayRounds.section.items[1].value.selection.candidate.id);
  await replay.approve();
  assert.equal((await replay.complete()).outline.phase, 'selection_required');
  assert.equal(tracker.calls.length, providerCallsBeforeV3 + 1);
  await replay.stop('Close the Plan v3 replay fixture.');
});

test('AR80-3: repeated feedback and explicit contradiction pause recursion without a Plan effect', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase80-loop-stop-deployment-'));
  const tracker = { calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
    },
  });
  const workflow = await deployment.workflow('Pause recursive correction on deterministic loop evidence.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  const repeated = {
    summary: 'Correct this exact Candidate defect.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Correct the exact changed line.',
      path: 'candidate-a.txt', line: 1,
    }],
  };
  await workflow.sendFeedback('builder', repeated);
  await workflow.select('builder', 'Use builder as the first revision basis.');
  await workflow.revise('Apply the first bounded correction.');
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');

  await workflow.sendFeedback('builder', repeated);
  const selected = await workflow.select('builder', 'Evaluate the repeated correction request.');
  assert.equal(selected.outline.workflow.revisionEligibility.state, 'blocked');
  assert.equal(selected.outline.workflow.revisionEligibility.reason, 'repeated_feedback');
  assert.equal(selected.outline.actions.some((action) => action.kind === 'revise_candidate'), false);
  const plansBefore = (await workflow.rounds()).section.itemCount;
  await assert.rejects(() => workflow.revise('Do not disguise repeated feedback as progress.'),
    (error) => error?.code === 'application_action_unavailable'
      && /revise_candidate is unavailable/u.test(error.message));
  assert.equal((await workflow.rounds()).section.itemCount, plansBefore);

  await workflow.sendFeedback('builder', {
    summary: 'The active correction direction contains an unresolved explicit conflict.',
    findings: [{
      kind: 'contradiction', severity: 'high', message: 'Resolve this conflict before another provider effect.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const contradicted = await workflow.outline();
  assert.equal(contradicted.outline.workflow.revisionEligibility.state, 'blocked');
  assert.equal(contradicted.outline.workflow.revisionEligibility.reason, 'unresolved_contradiction');
  assert.equal((await workflow.rounds()).section.itemCount, plansBefore);
  await workflow.stop('Close the deterministic loop-stop fixture.');
});

test('AR80-4: the bound deployment round ceiling pauses without exposing a caller loop knob', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase80-round-ceiling-deployment-'));
  const tracker = { calls: [] };
  let deployment;
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });
  deployment = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, 'candidate-a.txt', tracker),
        grok: adapter(routeB, 'candidate-b.txt', tracker),
      },
      verification: { command: 'node', arguments: ['--test'] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
      },
      workflowPolicy: {
        schemaVersion: 1, maxRounds: 2, maxRevisionAttemptsPerRound: 1,
        maxFeedbackPacketsPerRound: 64, maxFeedbackPacketsTotal: 256,
        budgetMode: 'authorized_plan_totals_within_goal', allocation: 'equal_round_share',
        stopConditions: [
          'identical_candidate', 'identical_feedback', 'no_verified_progress',
          'unresolved_contradiction', 'verification_failure',
        ],
      },
    },
  });
  const workflow = await deployment.workflow('Respect one deployment-bound correction round.', {
    team: [
      { role: 'builder', exact: routeA },
      { role: 'challenger', exact: routeB },
    ],
  });
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'Apply the one authorized correction.',
    findings: [{
      kind: 'defect', severity: 'high', message: 'Correct this first issue.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  await workflow.select('builder', 'Use builder as the authorized correction basis.');
  await workflow.revise('Apply the authorized correction.');
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  await workflow.sendFeedback('builder', {
    summary: 'A distinct concern remains after the authorized round.',
    findings: [{
      kind: 'risk', severity: 'medium', message: 'Record but do not auto-expand authority.',
      path: 'candidate-a.txt', line: 1,
    }],
  });
  const selected = await workflow.select('builder', 'Inspect the bound round ceiling.');
  assert.deepEqual(selected.outline.workflow.revisionEligibility, {
    state: 'blocked', reason: 'round_limit', nextRound: 3, maxRounds: 2,
    policyDigest: selected.outline.workflow.revisionEligibility.policyDigest,
    budget: {
      state: 'exhausted', mode: 'authorized_plan_totals_within_goal',
    },
  });
  assert.equal(selected.outline.actions.some((action) => action.kind === 'revise_candidate'), false);
  assert.equal((await workflow.rounds()).section.itemCount, 2);
  await workflow.stop('Close the bound round-ceiling fixture.');
});
