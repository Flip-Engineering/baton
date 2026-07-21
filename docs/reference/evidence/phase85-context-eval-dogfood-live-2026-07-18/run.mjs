import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton, SignalLifecycleOwner } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidenceRepoPath = 'docs/reference/evidence/phase85-context-eval-dogfood-live-2026-07-18';
const reportPath = `${evidenceRepoPath}/review.md`;
const evidencePath = join(evidenceDir, 'evidence.json');
const deploymentRoot = mkdtempSync(join(tmpdir(), 'baton-phase85-context-eval-'));
const glm = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const opus = Object.freeze({
  harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh',
});
const team = Object.freeze([
  { role: 'context-eval-adversary', exact: glm },
  { role: 'context-eval-synthesizer', exact: opus },
]);
const git = (args) => execFileSync('/usr/bin/git', args, { cwd: repo });
const outsideEvidenceStatus = () => git([
  'status', '--porcelain=v1', '-z', '--untracked-files=all', '--', '.',
  `:(exclude)${evidenceRepoPath}`,
]);

mkdirSync(evidenceDir, { recursive: true });
rmSync(evidencePath, { force: true });
rmSync(resolve(repo, reportPath), { force: true });
const callerBefore = Object.freeze({ status: outsideEvidenceStatus(), indexTree: git(['write-tree']) });

let baton = null;
let workflow = null;
let record = null;
let failure = null;
let cleanup = { stopped: null, closed: null };
let lifecycleResult = null;
const lifecycle = new SignalLifecycleOwner({
  signalEmitter: process,
  shutdown: async () => {
    let stopped = null; let closed = null;
    if (workflow) {
      try {
        await workflow.stop('Retain Context-eval evidence and reap every exact descendant.');
        const status = await workflow.status();
        stopped = { stop: status.stop, ownership: status.ownership };
      } catch (error) {
        stopped = { error: { code: error.code ?? null, message: error.message } };
      }
    }
    if (baton) {
      try { closed = (await baton.close()).ownership; }
      catch (error) { closed = { error: { code: error.code ?? null, message: error.message } }; }
    }
    cleanup = { stopped, closed };
    return cleanup;
  },
});

try {
  lifecycleResult = await lifecycle.run(async ({ signal }) => {
    baton = await openBaton({
      repo,
      advanced: {
        deploymentRoot, routes: [glm, opus],
        verification: {
          command: 'node', arguments: [
            '--test', '--test-name-pattern=CA83-2b|CM85-E1',
            'impl/test/phase83-context-application-red.test.mjs',
            'impl/test/phase84-context-map-wave-red.test.mjs',
          ],
        },
      },
    });
    const readiness = await baton.doctor();
    for (const exact of [glm, opus]) {
      const route = readiness.routes.find((candidate) => (
        candidate.harness === exact.harness && candidate.model === exact.model
          && candidate.effort === exact.effort
      ));
      if (route?.state !== 'ready') {
        throw Object.assign(new Error(`${exact.harness}/${exact.model}@${exact.effort} is ${route?.state ?? 'missing'}: ${route?.code ?? 'unavailable'}`), {
          code: route?.code ?? 'route_unavailable',
        });
      }
    }
    workflow = await baton.workflow([
      'Use Baton itself to adversarially evaluate Batons new unified pure Context surface.',
      'The attached immutable source is the complete task input. Do not inspect repository files,',
      'prior Run artifacts, receipts, ledgers, or nested Baton state. Review expression immutability,',
      'closed pure-AST serialization, one context_eval action, helper lowering, role selection,',
      'pre-effect refusal, durable cell identity, replay, progressive inspection, and stop/reap.',
      `Write only a concise technical review at ${reportPath}.`,
    ].join(' '), { scope: [reportPath], team });
    await workflow.approve();

    const context = workflow.context();
    const sourceExpression = context.source('repository')
      .search('context_eval', { mode: 'literal' })
      .slice({ kind: 'indices', values: [0, 1] })
      .project(['path', 'chunk', 'text'])
      .sort(['path', 'chunk']);
    const source = await context.evaluate(sourceExpression, { role: 'context-eval-adversary' });
    const sourceOutput = await source.output();
    if (!Array.isArray(sourceOutput?.items) || sourceOutput.items.length !== 2) {
      throw new Error(`Context eval expected two exact source items, observed ${sourceOutput?.items?.length ?? 0}`);
    }
    for (const role of team.map((member) => member.role)) {
      try {
        await workflow.stopMember(role, 'Immutable Context captured; reap predecessor Attempt.');
      } catch (error) {
        if (error?.code !== 'application_action_unavailable') throw error;
      }
    }

    const mapped = await context.map(source, {
      role: 'context-eval-adversary',
      instruction: [
        'Adversarially review only the attached source and task. Check the unified Context expression',
        'compiler and context_eval semantics for concrete correctness, AX, authority, and replay gaps.',
        `Write findings only to ${reportPath}. Do not inspect the repository or invoke Baton.`,
      ].join(' '),
    });
    await workflow.approve();
    await mapped.complete({ signal });
    if ((await mapped.outline()).item.state !== 'completed') {
      throw new Error('Context-eval map did not complete');
    }

    const reduced = await context.reduce(mapped, {
      role: 'context-eval-synthesizer',
      instruction: [
        'Synthesize the attached grounded review into one concise verdict. Retain concrete defects,',
        'dismiss unsupported concerns, and state the next highest-value correction.',
        `Write only ${reportPath}. Do not inspect the repository or invoke Baton.`,
      ].join(' '),
    });
    await workflow.approve();
    await reduced.complete({ signal });
    const reducedOutline = await reduced.outline();
    if (reducedOutline.item.state !== 'completed') {
      throw new Error(`Context-eval reduce ended ${reducedOutline.item.state}`);
    }
    const content = await reduced.content();
    const chunks = content.items.filter((item) => item.path === reportPath)
      .sort((left, right) => left.byteStart - right.byteStart);
    let expectedByteStart = 0;
    if (content.resultCount !== 1 || chunks.length === 0 || chunks.some((item, index) => (
      item.resultIndex !== 0 || item.sourceIndex !== index
        || item.byteStart !== expectedByteStart
        || (expectedByteStart = item.byteEnd) < item.byteStart
    ))) {
      throw new Error('Context-eval reduce did not expose one contiguous verified report');
    }
    writeFileSync(resolve(repo, reportPath), chunks.map((item) => item.text).join(''));
    const status = await workflow.status();
    record = {
      schemaVersion: 1, deploymentRoot, runId: workflow.id,
      selectedTeam: team,
      readiness: readiness.routes.map(({ harness, model, effort, state, code = null }) => ({
        harness, model, effort, state, code,
      })),
      source: { cellId: source.id, itemCount: sourceOutput.items.length },
      map: { callId: mapped.id, state: (await mapped.outline()).item.state },
      reduce: {
        callId: reduced.id, state: reducedOutline.item.state,
        resultCount: content.resultCount, reportItems: chunks.length,
      },
      phase: status.phase,
    };
  });
} catch (error) {
  failure = error;
  record = {
    schemaVersion: 1, deploymentRoot, runId: workflow?.id ?? null,
    error: { name: error.name, code: error.code ?? null, message: error.message },
  };
}

const callerAfter = { status: outsideEvidenceStatus(), indexTree: git(['write-tree']) };
cleanup = {
  ...cleanup,
  callerStatusUnchanged: callerBefore.status.equals(callerAfter.status),
  callerIndexUnchanged: callerBefore.indexTree.equals(callerAfter.indexTree),
};
writeFileSync(evidencePath,
  `${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup }, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ record, lifecycle: lifecycleResult, cleanup })}\n`);
const stop = cleanup.stopped?.stop;
if (workflow && (stop?.state !== 'stopped' || stop?.receipt?.remainingCount !== 0
  || stop?.receipt?.counts?.processesObserved !== stop?.receipt?.counts?.processesClosed
  || cleanup.stopped?.ownership?.workers !== 0)) {
  failure ??= new Error('Context-eval Run stop/reap proof is incomplete');
}
if (cleanup.closed?.closed === true && cleanup.closed?.workers === 0) {
  rmSync(deploymentRoot, { recursive: true, force: true });
}
if (!cleanup.callerStatusUnchanged || !cleanup.callerIndexUnchanged) {
  failure ??= new Error('Context-eval caller isolation changed outside the evidence directory');
}

if (failure) throw failure;
