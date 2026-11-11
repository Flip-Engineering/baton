import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const runIds = Object.freeze([
  'run-b5ed81890ce645cb5a6cd3773cccf98a',
  'run-24d140e00afc230d7e8c40e54499133c',
]);
const routes = Object.freeze([
  { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
  { harness: 'glm', model: 'glm-5.2', effort: 'xhigh' },
  { harness: 'claude-code', model: 'claude-opus-4-6', effort: 'xhigh' },
]);

let baton = null;
try {
  baton = await openBaton({
    repo,
    advanced: {
      routes,
      verification: {
        command: 'node', arguments: [
          '--test',
          'impl/test/phase12-web-operator.test.mjs',
          'impl/test/phase67-change-aware-inspect.test.mjs',
          'impl/test/phase67-progressive-agent-experience.test.mjs',
          'impl/test/phase67-self-describing-continuation.test.mjs',
          'impl/test/phase67-run-terminality.test.mjs',
          'impl/test/phase78-concise-deployment-factory.test.mjs',
        ],
      },
    },
  });
  const runs = [];
  for (const runId of runIds) {
    const run = baton.open(runId);
    await run.stop('Recover interrupted AX dogfood and reap the exact Run.');
    const status = await run.status();
    runs.push({ runId, phase: status.phase, stop: status.stop, ownership: status.ownership });
  }
  const closed = (await baton.close()).ownership;
  baton = null;
  const result = { schemaVersion: 1, runs, closed };
  writeFileSync(resolve(evidenceDir, 'recovery.json'), `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (runs.some(({ stop, ownership }) => (
    stop?.receipt?.remainingCount !== 0
      || stop?.receipt?.counts?.processesObserved !== stop?.receipt?.counts?.processesClosed
      || ownership?.workers !== 0
  )) || closed?.workers !== 0 || closed?.closed !== true) {
    throw new Error('AX dogfood recovery did not reap every exact process');
  }
} finally {
  if (baton) await baton.close();
}
