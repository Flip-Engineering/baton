import { rmSync } from 'node:fs';
import { resolve } from 'node:path';

import { openBaton } from '../../../../impl/src/index.mjs';

const [deploymentRoot, runId] = process.argv.slice(2);
if (!deploymentRoot || !runId) {
  throw new Error('usage: node recover.mjs DEPLOYMENT_ROOT RUN_ID');
}
const repo = resolve(new URL('../../../..', import.meta.url).pathname);
const routes = [
  { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
  { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh' },
];
let baton = null;
try {
  baton = await openBaton({
    repo,
    advanced: {
      deploymentRoot, routes,
      verification: {
        command: 'node', arguments: [
          '--test', '--test-name-pattern=CA83-2b|CM85-E1',
          'impl/test/phase83-context-application-red.test.mjs',
          'impl/test/phase84-context-map-wave-red.test.mjs',
        ],
      },
    },
  });
  const workflow = baton.open(runId);
  await workflow.stop('Recover interrupted Context-eval dogfood and reap every descendant.');
  const status = await workflow.status();
  const closed = (await baton.close()).ownership;
  baton = null;
  const result = { stop: status.stop, ownership: status.ownership, closed };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (status.stop?.receipt?.remainingCount !== 0 || status.ownership?.workers !== 0
    || closed?.workers !== 0 || closed?.closed !== true) {
    throw new Error('Context-eval recovery did not reap every descendant');
  }
  rmSync(deploymentRoot, { recursive: true, force: true });
} finally {
  if (baton) await baton.close();
}
