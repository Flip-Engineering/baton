import {
  existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton, SignalLifecycleOwner } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
mkdirSync(evidenceDir, { recursive: true });
const recoveryPath = join(evidenceDir, 'recovery.json');
const evidencePath = join(evidenceDir, 'evidence.json');
const reportPath = 'docs/reference/evidence/phase85-generic-settlement-dogfood-live-2026-07-18/review.md';
const recoveryOnly = process.argv.slice(2).includes('--recover');
const recoveryDescriptor = recoveryOnly && existsSync(recoveryPath)
  ? JSON.parse(readFileSync(recoveryPath, 'utf8')) : null;
if (recoveryOnly && !recoveryDescriptor?.deploymentRoot) {
  throw new Error('No exact Phase 85 dogfood recovery descriptor is available.');
}
const deploymentRoot = recoveryDescriptor?.deploymentRoot
  ?? mkdtempSync(join(tmpdir(), 'baton-phase85-generic-settlement-'));
const priorEvidence = recoveryOnly && existsSync(evidencePath)
  ? JSON.parse(readFileSync(evidencePath, 'utf8')) : null;
if (!recoveryOnly) {
  // Keep prior Run control artifacts out of the dirty-tree snapshot received by recipients.
  // New progress begins only after openBaton has pinned the source tree.
  rmSync(evidencePath, { force: true });
  rmSync(resolve(repo, reportPath), { force: true });
  rmSync(recoveryPath, { force: true });
}

const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const kimiCode = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' });
const grok = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const grokComposer = Object.freeze({
  harness: 'grok', model: 'grok-composer-2.5-fast', effort: 'high',
});
const forceCodex = process.env.BATON_DOGFOOD_FORCE_CODEX === '1';

let baton = null;
let workflow = null;
let failure = null;
let record = null;
let progress = null;
let cleanup = { stopped: null, closed: null };
const persistProgress = () => writeFileSync(evidencePath, `${JSON.stringify({
  record: {
    schemaVersion: 1, state: 'running', deploymentRoot,
    runId: workflow?.id ?? recoveryDescriptor?.runId ?? null, progress,
  },
  cleanup,
}, null, 2)}\n`);
const persistRecovery = (runId = null) => writeFileSync(recoveryPath, `${JSON.stringify({
  schemaVersion: 1, deploymentRoot, repo, runId,
}, null, 2)}\n`, { mode: 0o600 });
const interrupted = (signal) => {
  if (!signal.aborted) return;
  throw Object.assign(new Error(`dogfood interrupted by ${signal.reason?.kind ?? 'abort'}`), {
    code: 'baton_dogfood_interrupted',
  });
};
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
      deploymentRoot, routes: [codex, glm, kimiCode, grok, grokComposer],
      verification: {
        command: 'node', arguments: [
          '--test', '--test-name-pattern=CRL85',
          'impl/test/phase85-context-result-lineage-red.test.mjs',
        ],
      },
    },
      });
      persistRecovery(recoveryDescriptor?.runId ?? null);
      interrupted(signal);
      const readiness = await baton.doctor();
      interrupted(signal);
      if (recoveryOnly) {
        if (recoveryDescriptor.runId) {
          workflow = baton.open(recoveryDescriptor.runId);
          const stopped = await workflow.stop(
            'Recover interrupted dogfood and reap every exact descendant.',
          );
          record = {
            schemaVersion: 1, deploymentRoot, runId: recoveryDescriptor.runId,
            recovered: 'run', phase: stopped.outline.phase,
            ownership: stopped.outline.resources,
            interrupted: priorEvidence?.record ?? null,
          };
          return record;
        }
        record = {
          schemaVersion: 1, deploymentRoot, runId: null,
          recovered: 'deployment_only', phase: 'closing',
          interrupted: priorEvidence?.record ?? null,
        };
        return record;
      }
  const glmReady = readiness.routes.some((route) => (
    route.harness === glm.harness && route.model === glm.model
      && route.effort === glm.effort && route.state === 'ready'
  ));
  const kimiReady = readiness.routes.some((route) => (
    route.harness === kimiCode.harness && route.model === kimiCode.model
      && route.effort === kimiCode.effort && route.state === 'ready'
  ));
  const grokReady = readiness.routes.some((route) => (
    route.harness === grok.harness && route.model === grok.model
      && route.effort === grok.effort && route.state === 'ready'
  ));
  const grokComposerReady = readiness.routes.some((route) => (
    route.harness === grokComposer.harness && route.model === grokComposer.model
      && route.effort === grokComposer.effort && route.state === 'ready'
  ));
  const readinessSummary = readiness.routes.map(({
    harness, model, effort, state, code = null, summary = null,
  }) => ({ harness, model, effort, state, code, summary }));
  // Keep the Context fan-out genuinely parallel. GLM's live adapter intentionally owns one
  // in-flight seat, so exercise it as an independent exact xhigh peer while Codex (or Kimi when
  // refreshed) owns the mapped fan-out and selective retry.
  const mapRoute = !forceCodex && kimiReady ? kimiCode
    : (!forceCodex && grokReady ? grok : codex);
  const team = [
    { role: 'settlement-adversary', exact: mapRoute },
    ...(!forceCodex && glmReady ? [{ role: 'glm-adversary', exact: glm }] : []),
    ...(!forceCodex && grokReady && mapRoute !== grok
      ? [{ role: 'grok-adversary', exact: grok }] : []),
    ...(!forceCodex && grokComposerReady
      ? [{ role: 'grok-composer-adversary', exact: grokComposer }] : []),
    { role: 'settlement-synthesizer', exact: codex },
  ];
  progress = {
    stage: 'ready', selectedTeam: team,
    readiness: readinessSummary,
  };
  persistProgress();
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
      const sourceExpression = context.source('repository')
        .search('contextEffectSettlementChildren', { mode: 'literal' })
        .project(['path', 'chunk', 'text'])
        .sort(['path', 'chunk']);
      const source = await context.evaluate(sourceExpression, {
    role: 'settlement-adversary',
      });
      interrupted(signal);
      const sourceOutput = await source.output();
  progress = {
    stage: 'source', sourceItems: sourceOutput?.items?.length ?? 0,
    selectedTeam: team, readiness: readinessSummary,
  };
  persistProgress();
  if (!Array.isArray(sourceOutput?.items) || sourceOutput.items.length < 2) {
    throw new Error(`expected at least two grounded settlement slices, observed ${sourceOutput?.items?.length ?? 0}`);
  }
      for (const role of team.map((member) => member.role)) {
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
      progress = {
        stage: 'map_approved', sourceItems: sourceOutput.items.length,
        selectedTeam: team, readiness: readinessSummary, callId: mapped.id,
      };
      persistProgress();
      await workflow.approve();
      interrupted(signal);
      await workflow.stopMember(
        'settlement-adversary:0001',
        'Induce one retryable map cancellation to prove selective generation retry.',
      );
      interrupted(signal);
      await mapped.complete({ signal });
      interrupted(signal);
  let completedMap = await mapped.outline();
  const firstMapOutline = completedMap.item;
  const firstMapEvidence = completedMap.item.state === 'failed'
    ? await mapped.evidence() : null;
  let finalMap = mapped;
  let retry = null;
  progress = {
    stage: 'map', sourceItems: sourceOutput.items.length,
    selectedTeam: team, readiness: readinessSummary,
    generations: [{
      callId: mapped.id, generation: 1, outline: firstMapOutline,
      evidence: firstMapEvidence,
    }],
  };
      persistProgress();
      if (completedMap.item.state === 'failed') {
        retry = await mapped.retry();
        interrupted(signal);
        progress = {
          ...progress, stage: 'retry_approved',
          retry: { callId: retry.id, generation: 2, state: 'awaiting_plan_approval' },
        };
        persistProgress();
        await workflow.approve();
        interrupted(signal);
        await retry.complete({ signal });
        interrupted(signal);
        finalMap = retry;
        completedMap = await retry.outline();
        progress = {
          ...progress, stage: 'retry',
          retry: { callId: retry.id, generation: 2, outline: completedMap.item },
          generations: [...progress.generations, {
            callId: retry.id, generation: 2, outline: completedMap.item,
            evidence: await retry.evidence(),
          }],
        };
        persistProgress();
      }
      if (completedMap.item.state !== 'completed') {
    throw new Error(`Context map did not settle: ${completedMap.item.state}`);
  }

      const reduced = await context.reduce(finalMap, {
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
      progress = {
        ...progress, stage: 'reduce_approved',
        reduce: { callId: reduced.id, outline: proposedReduce.item },
      };
      persistProgress();
      await workflow.approve();
      interrupted(signal);
      await reduced.complete({ signal });
      interrupted(signal);
  const completedReduce = await reduced.outline();
  if (completedReduce.item.state !== 'completed') {
    throw new Error(`Context reduce did not settle: ${completedReduce.item.state}`);
  }
  const reducedContent = await reduced.content();
  const reportChunks = reducedContent.items.filter((item) => item.path === reportPath)
    .sort((left, right) => left.byteStart - right.byteStart);
  let expectedByteStart = 0;
  if (reducedContent.resultCount !== 1 || reportChunks.length === 0
    || reportChunks.some((item, index) => (
      item.resultIndex !== 0 || item.sourceIndex !== index
        || item.byteStart !== expectedByteStart
        || (expectedByteStart = item.byteEnd) < item.byteStart
    ))) {
    throw new Error('Context reduce content did not expose one contiguous verified report');
  }
  writeFileSync(resolve(repo, reportPath), reportChunks.map((item) => item.text).join(''));
  progress = {
    ...progress, stage: 'reduce',
    reduce: {
      callId: reduced.id, outline: completedReduce.item,
      evidence: await reduced.evidence(),
      content: {
        resultCount: reducedContent.resultCount,
        totalItems: reducedContent.totalItems,
        reportItems: reportChunks.length,
      },
    },
  };
  persistProgress();
  const status = await workflow.status();
      record = {
    schemaVersion: 1, deploymentRoot, runId: workflow.id,
    readiness: readinessSummary,
    selectedTeam: team,
    sourceItems: sourceOutput.items.length,
    generations: progress.generations,
    map: {
      callId: finalMap.id, predecessorCallId: retry ? mapped.id : null,
      generation: retry ? 2 : 1, state: completedMap.item.state,
      outputItems: completedMap.item.value?.output?.items?.length ?? 0,
    },
    reduce: {
      callId: reduced.id, state: completedReduce.item.state,
      outputItems: completedReduce.item.value?.output?.items?.length ?? 0,
      reportItems: reportChunks.length,
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
const runStopRequired = Boolean(workflow || recoveryDescriptor?.runId);
const deploymentCloseRequired = baton !== null;
if ((runStopRequired && (cleanup.stopped?.stop?.receipt?.remainingCount !== 0
  || cleanup.stopped?.ownership?.workers !== 0))
  || (deploymentCloseRequired
    && (cleanup.closed?.closed !== true || cleanup.closed?.workers !== 0))) {
  failure ??= new Error('Generic settlement dogfood stop proof is incomplete');
}
writeFileSync(evidencePath,
  `${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup })}\n`);
if (!failure && cleanup.closed?.closed === true && cleanup.closed?.workers === 0) {
  rmSync(deploymentRoot, { recursive: true, force: true });
  rmSync(recoveryPath, { force: true });
}
if (failure && !deploymentCloseRequired) {
  rmSync(deploymentRoot, { recursive: true, force: true });
  rmSync(recoveryPath, { force: true });
}
if (signalKind === 'SIGINT') process.exitCode = 130;
else if (signalKind === 'SIGTERM') process.exitCode = 143;
else if (signalKind === 'SIGHUP') process.exitCode = 129;
else if (failure) throw failure;
