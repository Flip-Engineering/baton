import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';

const routeA = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const routeB = Object.freeze({ harness: 'kimi-code', model: 'k3', effort: 'high' });

function repository() {
  const root = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-dispatch-repo-'));
  execFileSync('git', ['init', '-q'], { cwd: root });
  execFileSync('git', ['config', 'user.email', 'phase85@example.invalid'], { cwd: root });
  execFileSync('git', ['config', 'user.name', 'Phase 85'], { cwd: root });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ private: true }));
  writeFileSync(join(root, 'alpha.mjs'), 'export const alpha = 1;\n');
  writeFileSync(join(root, 'beta.mjs'), 'export const beta = 2;\n');
  execFileSync('git', ['add', '.'], { cwd: root });
  execFileSync('git', ['commit', '-qm', 'base'], { cwd: root });
  return root;
}

function adapter(route, tracker) {
  const value = new MockAdapter({ harness: route.harness });
  const baseCard = value.card.bind(value);
  value.card = () => ({
    ...baseCard(), authPosture: 'subscription',
    modelSelection: {
      mode: 'exact', configuredDefault: route.model, available: [route.model],
      family: route.harness, acceptedPrefixes: [], acceptedAliases: [],
      reasoningEffort: [route.effort], serviceTier: null,
      provenance: 'phase85-effect-dispatch-test', refreshedAt: null,
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
  value.spawn = (...args) => {
    const brief = structuredClone(args[1]);
    const reduce = brief?.contextCall?.kind === 'context_effect_child'
      && brief.contextCall.operator === 'reduce';
    tracker.calls.push({
      harness: route.harness, model: args[2]?.model,
      effort: args[2]?.reasoningEffort, brief,
    });
    args[2] = {
      ...args[2],
      scenario: {
        outcome: 'completed',
        edits: [{
          path: `reviews/effect-dispatch-${tracker.calls.length}.md`,
          content: 'provider result\n', delayMs: reduce ? 60_000 : 20,
        }],
      },
    };
    return nativeSpawn(...args);
  };
  return value;
}

function options(repo, deploymentRoot, tracker) {
  return {
    repo,
    advanced: {
      deploymentRoot, routes: [routeA, routeB],
      adapters: {
        codex: adapter(routeA, tracker),
        'kimi-code': adapter(routeB, tracker),
      },
      verification: { command: 'true', arguments: [] },
      capacity: {
        estimate: () => ({ bytes: 60, inodes: 5 }),
        observe: () => ({
          freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER,
        }),
      },
    },
  };
}

function eventsAt(deploymentRoot) {
  return readFileSync(join(deploymentRoot, 'state', 'coordination', 'events.jsonl'), 'utf8')
    .trim().split('\n').map((line) => JSON.parse(line));
}

test('CC85-D1: context_reduce proposes inertly, restarts, and dispatches one exact Attempt', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-dispatch-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment; let driver; let workflow;
  const open = async () => openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  deployment = await open();
  workflow = await deployment.workflow('Dispatch one generic Context reduce exactly.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const chunks = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const mapped = await workflow.context().map(chunks, {
    role: 'critic', instruction: 'Produce one retained result for each exact partition.',
  });
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  assert.equal((await mapped.outline()).item.state, 'completed');

  const sourceArtifacts = driver.coordination.contextCallArtifacts(mapped.id);
  assert.equal(sourceArtifacts.evidence.schemaVersion, 3);
  const callsBeforeReduce = tracker.calls.length;
  const eventsBeforeReduce = eventsAt(deploymentRoot);
  const plansBeforeReduce = eventsBeforeReduce.filter((event) => (
    event.kind === 'plan.version_proposed'
  )).length;
  const reduced = await workflow.context().reduce(mapped, {
    role: 'critic', instruction: 'Synthesize the immutable verified result references.',
  });
  const reducedView = await reduced.outline();
  assert.equal(reducedView.item.state, 'awaiting_plan_approval');
  assert.equal(reducedView.item.value.operation, 'reduce');
  assert.equal(reducedView.item.value.unitCount, 1);
  assert.equal(tracker.calls.length, callsBeforeReduce,
    'admission and Plan proposal must perform zero provider effects');

  const admittedEvents = eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
      && event.payload.call.operator === 'reduce'
  ));
  assert.equal(admittedEvents.length, 1);
  const admitted = admittedEvents[0].payload.call;
  assert.equal(admitted.source.id, mapped.id);
  assert.equal(admitted.units.length, 1);
  assert.equal(admitted.units[0].inputs.length, sourceArtifacts.output.items.length);
  assert.deepEqual(admitted.units[0].inputs.map((input) => input.lineageDigest),
    sourceArtifacts.evidence.outputLineages.map((lineage) => lineage.lineageDigest));
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'plan.version_proposed'
  )).length, plansBeforeReduce + 1);

  const runId = workflow.id;
  await deployment.close();
  deployment = await open();
  workflow = deployment.open(runId);
  assert.equal(tracker.calls.length, callsBeforeReduce,
    'restart before approval must remain provider-inert');
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
      && event.payload.call.operator === 'reduce'
  )).length, 1);
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'plan.version_proposed'
  )).length, plansBeforeReduce + 1);

  await workflow.approve();
  assert.equal(tracker.calls.length, callsBeforeReduce + 1,
    'one separate Plan approval must dispatch exactly one provider Attempt');
  const dispatched = tracker.calls.at(-1);
  assert.deepEqual({
    harness: dispatched.harness, model: dispatched.model, effort: dispatched.effort,
  }, routeA);
  const contextInput = dispatched.brief.contextInput;
  assert.equal(contextInput.kind, 'baton.context_reduce_input');
  assert.equal(contextInput.callId, admitted.callId);
  assert.equal(contextInput.source.id, mapped.id);
  assert.equal(Object.hasOwn(contextInput, 'value'), false);
  assert.equal(Object.hasOwn(contextInput, 'partition'), false);
  assert.equal(Object.hasOwn(contextInput, 'partitions'), false);
  assert.deepEqual(contextInput.inputs.map((input) => input.resultRef),
    sourceArtifacts.output.items);
  assert.deepEqual(contextInput.inputs.map((input) => input.lineage),
    sourceArtifacts.evidence.outputLineages);
  assert.equal(JSON.stringify(contextInput).includes('callerData'), false);

  await workflow.stop('Stop and reap the one generic Context reduce Attempt.');
  const status = await workflow.status();
  assert.equal(status.stop.receipt.remainingCount, 0);
  assert.equal(status.ownership.workers, 0);
  assert.equal(driver.coordination.contextCall(admitted.callId).state, 'stopped');
});
