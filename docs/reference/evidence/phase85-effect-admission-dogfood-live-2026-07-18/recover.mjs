import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const [deploymentRoot, runId] = process.argv.slice(2);
if (!deploymentRoot || !runId) {
  throw new Error('usage: recover.mjs <exact-deployment-root> <exact-run-id>');
}

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const git = (args, options = {}) => execFileSync('/usr/bin/git', args, { cwd: repo, ...options });
const high = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'high' });
const xhigh = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'xhigh' });
const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot,
    routes: [high, xhigh],
    verification: {
      command: 'node',
      arguments: [
        '--test', 'impl/test/phase85-context-effect-admission-red.test.mjs',
        'impl/test/phase85-context-call-envelope-red.test.mjs',
      ],
    },
  },
});

let stopped = null;
let closed = null;
let candidates = [];
let runStatus = null;
try {
  const workflow = baton.open(runId);
  const before = await workflow.status();
  runStatus = {
    phase: before.phase,
    attempts: before.attempts,
    nodes: before.nodes,
    verification: before.verification,
    attention: before.attention,
    progress: before.progress,
  };
  const candidateSection = await workflow.candidates();
  candidates = candidateSection.section.items.map(({ value }) => {
    const body = git([
      'diff-tree', '--no-commit-id', '--binary', '-p', `${value.resultSha}^`, value.resultSha,
    ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const name = `candidate-${value.role}.patch`;
    writeFileSync(join(evidenceDir, name), body);
    return {
      role: value.role,
      candidateId: value.candidateId,
      resultSha: value.resultSha,
      retainedResultRef: value.retainedResultRef,
      changedPaths: value.changedPaths,
      patch: {
        name,
        digest: createHash('sha256').update(body).digest('hex'),
        bytes: Buffer.byteLength(body),
      },
    };
  });
  await workflow.stop('Recover the interrupted Phase 85 effect-admission Run and reap exact ownership.');
  const after = await workflow.status();
  stopped = {
    beforePhase: before.phase,
    afterPhase: after.phase,
    stop: after.stop,
    ownership: after.ownership,
  };
} finally {
  closed = (await baton.close()).ownership;
}

const evidence = {
  schemaVersion: 1,
  deploymentRoot,
  runId,
  outcome: 'interrupted_then_recovered',
  runStatus,
  candidates,
  stopped,
  closed,
};
writeFileSync(join(evidenceDir, 'evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(evidence)}\n`);
if (![1, 3].includes(stopped?.stop?.receipt?.schemaVersion)
  || stopped.stop.receipt.remainingCount !== 0
  || stopped.stop.receipt.counts.processesObserved !== stopped.stop.receipt.counts.processesClosed
  || stopped.ownership?.workers !== 0
  || !closed?.closed || closed.workers !== 0) {
  throw new Error('recovered Phase 85 effect-admission deployment did not prove zero ownership');
}
