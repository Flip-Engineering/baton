import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton, SignalLifecycleOwner } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-generic-settlement-'));
mkdirSync(evidenceDir, { recursive: true });
const recoveryPath = join(evidenceDir, 'recovery.json');

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const forceCodex = process.env.BATON_DOGFOOD_FORCE_CODEX === '1';
const reportPath = 'docs/reference/evidence/phase85-generic-settlement-dogfood-live-2026-07-18/review.md';

let baton = null;
let workflow = null;
let failure = null;
let record = null;
let progress = null;
let cleanup = { stopped: null, closed: null };
const persistRecovery = (runId = null) => writeFileSync(recoveryPath, `${JSON.stringify({
  schemaVersion: 1, deploymentRoot, repo, runId,
}, null, 2)}\n`, { mode: 0o600 });
const interrupted = (signal) => {
  if (!signal.aborted) return;
  throw Object.assign(new Error(`dogfood interrupted by ${signal.reason?.kind ?? 'abort'}`), {
    code: 'baton_dogfood_interrupted',
  });
};
persistRecovery();

const lifecycle = new SignalLifecycleOwner({
  signalEmitter: process,
  shutdown: async () => {
    let stopped = null; let closed = null;
    let stopError = null; let closeError = null;
    if (workflow) {
      try {
        await workflow.stop('Retain Context evidence and reap every exact descendant.');
        const status = await workflow.status();
        stopped = { stop: status.stop, ownership: status.ownership };
      } catch (error) {
        stopError = { name: error.name, code: error.code ?? null, message: error.message };
      }
    }
    if (baton) {
      try { closed = (await baton.close()).ownership; }
      catch (error) {
        closeError = { name: error.name, code: error.code ?? null, message: error.message };
      }
    }
    cleanup = {
      stopped, closed,
      ...(stopError ? { stopError } : {}),
      ...(closeError ? { closeError } : {}),
    };
    return cleanup;
  },
});

let lifecycleResult = null;
try {
  lifecycleResult = await lifecycle.run(async ({ signal }) => {
    try {
      baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes: [codex, glm],
      verification: {
        command: 'node', arguments: [
          '--test', '--test-name-pattern=CRL85',
          'impl/test/phase85-context-result-lineage-red.test.mjs',
        ],
      },
    },
      });
      interrupted(signal);
      const readiness = await baton.doctor();
      interrupted(signal);
  const glmReady = readiness.routes.some((route) => (
    route.harness === glm.harness && route.model === glm.model
      && route.effort === glm.effort && route.state === 'ready'
  ));
  const mapRoute = !forceCodex && glmReady ? glm : codex;
  const team = [
    { role: 'settlement-adversary', exact: mapRoute },
    { role: 'settlement-synthesizer', exact: codex },
  ];
      workflow = await baton.workflow([
    'Use Baton Context to review Baton generic effect-call settlement reflexively.',
    'Ground findings in the attached current implementation slices. Concentrate on schema-v2',
    'context.call_settled replay, schema-v4 generic evidence, exact unit/node/task/route/capsule',
    'and resource-release binding, map compatibility, provider-failure terminality, and recovery',
    'after cleanup without provider re-execution. Do not edit production code. Write only the',
    `concise review at ${reportPath}.`,
      ].join(' '), { scope: [reportPath], team });
      persistRecovery(workflow.id);
      interrupted(signal);
      await workflow.approve();
      interrupted(signal);

      const context = workflow.context();
      const source = await context.search('contextEffectSettlementChildren', {
    branch: 'repository', mode: 'literal', role: 'settlement-adversary',
      });
      interrupted(signal);
      const sourceOutput = await source.output();
  progress = { stage: 'source', sourceItems: sourceOutput?.items?.length ?? 0 };
  if (!Array.isArray(sourceOutput?.items) || sourceOutput.items.length < 2) {
    throw new Error(`expected at least two grounded settlement slices, observed ${sourceOutput?.items?.length ?? 0}`);
  }
      for (const role of ['settlement-adversary', 'settlement-synthesizer']) {
        await workflow.stopMember(role, 'Immutable Context captured; reap predecessor Attempts.');
        interrupted(signal);
      }

      const mapped = await context.map(source, {
    role: 'settlement-adversary',
    instruction: [
      'Adversarially review only this attached immutable source slice for a concrete generic',
      'settlement, lineage, replay, cleanup, or compatibility defect. Write a concise grounded',
      `finding to ${reportPath}; do not edit production code.`,
    ].join(' '),
      });
      interrupted(signal);
      const proposedMap = await mapped.outline();
  if (proposedMap.item.state !== 'awaiting_plan_approval') {
    throw new Error(`Context map did not pause for approval: ${proposedMap.item.state}`);
  }
      await workflow.approve();
      interrupted(signal);
      await mapped.complete({ signal });
      interrupted(signal);
  const completedMap = await mapped.outline();
  progress = {
    stage: 'map', sourceItems: sourceOutput.items.length,
    map: { callId: mapped.id, outline: completedMap.item },
    mapEvidence: completedMap.item.state === 'failed' ? await mapped.evidence() : null,
  };
      if (completedMap.item.state !== 'completed') {
    throw new Error(`Context map did not settle: ${completedMap.item.state}`);
  }

      const reduced = await context.reduce(mapped, {
    role: 'settlement-synthesizer',
    instruction: [
      'Synthesize every attached verified finding into one concise technical verdict. Resolve',
      'contradictions, distinguish defects from intentional Phase 85 closure, and write only',
      `${reportPath}. Do not edit production code.`,
    ].join(' '),
      });
      interrupted(signal);
      const proposedReduce = await reduced.outline();
  if (proposedReduce.item.state !== 'awaiting_plan_approval') {
    throw new Error(`Context reduce did not pause for approval: ${proposedReduce.item.state}`);
  }
      await workflow.approve();
      interrupted(signal);
      await reduced.complete({ signal });
      interrupted(signal);
  const completedReduce = await reduced.outline();
      if (completedReduce.item.state !== 'completed') {
    throw new Error(`Context reduce did not settle: ${completedReduce.item.state}`);
  }
  const status = await workflow.status();
      record = {
    schemaVersion: 1, deploymentRoot, runId: workflow.id,
    readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
      harness, model, effort, state, code,
    })),
    selectedTeam: team,
    sourceItems: sourceOutput.items.length,
    map: {
      callId: mapped.id, state: completedMap.item.state,
      outputItems: completedMap.item.value?.output?.items?.length ?? 0,
    },
    reduce: {
      callId: reduced.id, state: completedReduce.item.state,
      outputItems: completedReduce.item.value?.output?.items?.length ?? 0,
    },
    phase: status.phase,
    ownership: status.ownership,
      };
      return record;
    } catch (error) {
      failure = error;
      throw error;
    }
  });
} catch (error) {
  failure ??= error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null,
    progress,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
}
const signalKind = lifecycleResult?.trigger?.kind ?? null;
if (cleanup.stopped?.stop?.receipt?.remainingCount !== 0
  || cleanup.stopped?.ownership?.workers !== 0
  || cleanup.closed?.closed !== true || cleanup.closed?.workers !== 0) {
  failure ??= new Error('Generic settlement dogfood stop proof is incomplete');
}
writeFileSync(join(evidenceDir, 'evidence.json'),
  `${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup })}\n`);
if (cleanup.closed?.closed === true && cleanup.closed?.workers === 0) {
  rmSync(deploymentRoot, { recursive: true, force: true });
  rmSync(recoveryPath, { force: true });
}
if (signalKind === 'SIGINT') process.exitCode = 130;
else if (signalKind === 'SIGTERM') process.exitCode = 143;
else if (signalKind === 'SIGHUP') process.exitCode = 129;
else if (failure) throw failure;
