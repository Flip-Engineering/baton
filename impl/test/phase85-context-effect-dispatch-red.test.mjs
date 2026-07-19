import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { MockAdapter, createDriver } from '../src/index.mjs';
import { openBatonDeployment } from '../src/application-deployment.mjs';
import { APPLICATION_SEMANTIC_REGISTRY } from '../src/application-semantics.mjs';

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
    const ordinal = tracker.calls.length + 1;
    tracker.calls.push({
      harness: route.harness, model: args[2]?.model, effort: args[2]?.reasoningEffort,
      brief: structuredClone(args[1]),
    });
    args[2] = {
      ...args[2],
      scenario: {
        outcome: 'completed',
        edits: [{
          path: `reviews/effect-dispatch-${ordinal}.md`,
          content: `private provider result ${ordinal}\n`,
          delayMs: args[1]?.contextCall?.operator === 'reduce' ? 60_000 : 20,
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

test('CC85-D1: context_reduce proposes inertly, dispatches one exact routed Attempt, and stop reaps it', async (t) => {
  const repo = repository();
  const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-effect-dispatch-'));
  const tracker = { calls: [] };
  const deploymentOptions = options(repo, deploymentRoot, tracker);
  let deployment; let driver;
  const open = async () => openBatonDeployment(deploymentOptions, (driverOptions) => {
    driver = createDriver(driverOptions);
    return driver;
  });
  t.after(async () => {
    try { await deployment?.close(); } catch {}
    rmSync(repo, { recursive: true, force: true });
    rmSync(deploymentRoot, { recursive: true, force: true });
  });

  const reduceDefinition = APPLICATION_SEMANTIC_REGISTRY.actions.context_reduce;
  assert.ok(reduceDefinition);
  assert.deepEqual(Object.keys(reduceDefinition.inputSchema.properties).sort(),
    ['callId', 'instruction', 'role']);
  assert.deepEqual(reduceDefinition.inputSchema.required, ['callId', 'instruction']);
  assert.equal(reduceDefinition.effect, 'plan_proposal');

  deployment = await open();
  const workflow = await deployment.workflow('Dispatch one bounded generic Context reduce.', {
    team: [
      { role: 'critic', exact: routeA },
      { role: 'builder', exact: routeB },
    ],
  });
  await workflow.approve();
  const parts = await workflow.context().chunk({
    branch: 'repository', by: 'path', role: 'critic',
  });
  const mapped = await workflow.context().map(parts, {
    role: 'critic', instruction: 'Produce one retained result unique to this partition.',
  });
  await workflow.approve();
  assert.equal((await workflow.complete()).outline.phase, 'selection_required');
  assert.equal((await mapped.outline()).item.state, 'completed');

  const source = driver.coordination.contextCompletedCallSource(mapped.id);
  const sourceArtifacts = driver.coordination.contextCallArtifacts(mapped.id);
  assert.equal(sourceArtifacts.evidence.schemaVersion, 3);
  const callsBeforeReduce = tracker.calls.length;
  const eventsBeforeReduce = eventsAt(deploymentRoot);
  const plansBeforeReduce = eventsBeforeReduce.filter((event) => (
    event.kind === 'plan.version_proposed'
  )).length;

  const reduced = await mapped.reduce({
    role: 'builder', instruction: 'Synthesize only the immutable verified child reports.',
  });
  assert.equal(tracker.calls.length, callsBeforeReduce,
    'context_reduce admission and Plan proposal must perform zero provider effects');
  const proposed = await reduced.outline();
  assert.equal(proposed.item.state, 'awaiting_plan_approval');
  assert.equal(proposed.item.value.operation, 'reduce');
  assert.equal(proposed.item.value.logicalRole, 'builder');
  assert.equal(proposed.item.value.unitCount, 1);

  let events = eventsAt(deploymentRoot);
  const genericAdmissions = events.filter((event) => (
    event.kind === 'context.call_admitted' && event.payload.schemaVersion === 2
  ));
  assert.equal(genericAdmissions.length, 1);
  const admission = genericAdmissions[0];
  assert.equal(admission.payload.call.callId, reduced.id);
  assert.equal(admission.payload.call.kind, 'baton.context_effect_call');
  assert.equal(admission.payload.call.operator, 'reduce');
  assert.equal(admission.payload.call.source.id, mapped.id);
  assert.deepEqual(admission.payload.call.source, source);
  assert.equal(admission.payload.call.units.length, 1);
  assert.deepEqual(
    admission.payload.call.units[0].inputs.map(({ index, itemDigest, lineageDigest }) => ({
      index, itemDigest, lineageDigest,
    })),
    sourceArtifacts.evidence.outputLineages.map(({ index, itemDigest, lineageDigest }) => ({
      index, itemDigest, lineageDigest,
    })),
  );
  const plans = events.filter((event) => event.kind === 'plan.version_proposed');
  assert.equal(plans.length, plansBeforeReduce + 1);
  const reducePlan = plans.at(-1).payload.plan;
  assert.ok(admission.seq < plans.at(-1).seq);
  assert.equal(reducePlan.nodes.length, 1);
  assert.equal(reducePlan.nodes[0].contextCall.kind, 'context_effect_child');
  assert.equal(reducePlan.nodes[0].contextCall.operator, 'reduce');
  assert.equal(reducePlan.nodes[0].contextCall.unit.unitId,
    admission.payload.call.units[0].unitId);
  assert.deepEqual({
    harness: reducePlan.nodes[0].routes.harnesses[0],
    model: reducePlan.nodes[0].routes.models[0],
    effort: reducePlan.nodes[0].routes.efforts[0],
  }, routeB);
  const definitions = events.filter((event) => (
    event.kind === 'driver.recorded'
      && event.payload?.kind === 'application.workflow_definition_bound'
  ));
  assert.equal(definitions.at(-1).payload.schemaVersion, 3);
  assert.equal(definitions.at(-1).payload.roleCatalog.catalogDigest,
    definitions.at(-2).payload.roleCatalog.catalogDigest);
  assert.equal(definitions.at(-1).payload.attempts[0].logicalRole, 'builder');
  assert.deepEqual(definitions.at(-1).payload.attempts[0].route, routeB);

  await deployment.close();
  deployment = await open();
  assert.equal(tracker.calls.length, callsBeforeReduce,
    'restart before approval must not dispatch the generic Attempt');
  assert.equal(eventsAt(deploymentRoot).filter((event) => (
    event.kind === 'plan.version_proposed'
  )).length, plans.length);
  assert.equal(driver.coordination.contextCall(reduced.id).state, 'awaiting_plan_approval');

  const replay = deployment.open(workflow.id);
  await replay.approve();
  assert.equal(tracker.calls.length, callsBeforeReduce + 1);
  const provider = tracker.calls.at(-1);
  assert.deepEqual({
    harness: provider.harness, model: provider.model, effort: provider.effort,
  }, routeB);
  assert.equal(provider.brief.contextCall.kind, 'context_effect_child');
  assert.equal(provider.brief.contextCall.operator, 'reduce');
  assert.equal(Object.hasOwn(provider.brief.contextCall, 'partition'), false);
  assert.equal(provider.brief.contextInput.kind, 'baton.context_reduce_input');
  assert.equal(provider.brief.contextInput.callId, reduced.id);
  assert.equal(provider.brief.contextInput.unitId,
    admission.payload.call.units[0].unitId);
  assert.equal(provider.brief.contextInput.inputs.length, source.itemCount);
  assert.equal(provider.brief.contextInput.inputs.every((input, index) => (
    input.index === index
      && input.providerResult.kind === 'baton.context_provider_result_ref'
      && input.capsuleRef.kind === 'context_provider_result'
      && input.sourceRef.kind === 'context_source'
      && input.lineage.lineageDigest === input.lineageDigest
      && input.value !== undefined
      && !Object.hasOwn(input, 'partitionId')
  )), true);
  assert.equal(JSON.stringify(provider.brief.contextInput).includes('phase85-owner'), false);
  assert.equal(Object.hasOwn(provider.brief.contextInput, 'authority'), false);
  assert.equal(Object.hasOwn(provider.brief.contextInput, 'instruction'), false);
  assert.deepEqual(
    provider.brief.contextInput.inputs.map((input) => input.providerResult),
    sourceArtifacts.output.items,
  );
  const running = driver.coordination.contextCall(reduced.id);
  assert.equal(running.state, 'running');
  assert.equal(running.children.length, 1);
  assert.equal(running.children[0].state, 'working');
  assert.deepEqual(running.children[0].route, routeB);

  const stopped = await replay.stop('Stop and reap the generic reduce Attempt.');
  assert.equal(stopped.outline.phase, 'stopped');
  assert.equal(stopped.outline.resources.ownedCount, 0);
  assert.equal(driver.coordination.contextCall(reduced.id).state, 'stopped');
  assert.equal(driver.coordination.task(running.children[0].taskId).status, 'cancelled');
  assert.equal(driver.coordinator.list().filter((handle) => (
    handle.runId === workflow.id && !['dead', 'exited'].includes(handle.status)
  )).length, 0);
  events = eventsAt(deploymentRoot);
  const stop = events.filter((event) => event.kind === 'run.stop_admitted').at(-1);
  assert.ok(stop.payload.targetContextCallIds.includes(reduced.id));
  assert.equal(tracker.calls.length, callsBeforeReduce + 1,
    'stop/reap must not create another generic provider Attempt');
});
