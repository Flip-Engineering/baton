import { resolve } from 'node:path';

import { openBaton } from '../../../../impl/src/index.mjs';

const [deploymentRoot, runId] = process.argv.slice(2);
if (!deploymentRoot || !runId) {
  throw new Error('usage: recover.mjs <exact-deployment-root> <exact-run-id>');
}

const repo = resolve(new URL('../../../..', import.meta.url).pathname);
const codex = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const kimi = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });
const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot,
    routes: [codex, kimi],
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/phase80-workflow-revision.test.mjs',
        'impl/test/phase81-context-program-red.test.mjs',
      ],
    },
  },
});

let stopped = null;
let close = null;
try {
  const workflow = baton.open(runId);
  const before = await workflow.status();
  await workflow.stop('Recover the admitted interrupt and join exact descendant reap.');
  const after = await workflow.status();
  stopped = {
    beforePhase: before.phase,
    afterPhase: after.phase,
    stop: after.stop,
    ownership: after.ownership,
  };
} finally {
  close = (await baton.close()).ownership;
}

process.stdout.write(`${JSON.stringify({ stopped, close })}\n`);
if (!close?.closed || close.workers !== 0) throw new Error('recovered deployment did not reach zero ownership');

