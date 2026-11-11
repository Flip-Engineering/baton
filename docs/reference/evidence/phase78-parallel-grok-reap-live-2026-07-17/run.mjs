import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const exact = Object.freeze({ harness: 'grok', model: 'grok-4.5', effort: 'high' });
const requests = [
  {
    objective: 'Review Baton parallel admission and selective stop authority. Write only reviews/dogfood/phase78-grok-stop-target.md with concise source-grounded findings.',
    exact,
    scope: ['reviews/dogfood/phase78-grok-stop-target.md'],
  },
  {
    objective: 'Review Baton close and exact ownership reaping. Write only reviews/dogfood/phase78-grok-survivor.md with concise source-grounded findings.',
    exact,
    scope: ['reviews/dogfood/phase78-grok-survivor.md'],
  },
];

const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
let group = null;
const baton = await openBaton({
  repo,
  advanced: {
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/grok-acp.test.mjs',
        'impl/test/phase78-bound-run-group-red.test.mjs',
      ],
    },
  },
});
try {
  group = await baton.startMany(requests);
  const admitted = await Promise.all(group.runs.map((run) => run.drive({ signal: controller.signal })));
  const stopped = await group.runs[0].stop('Live proof: selectively stop and reap one Grok sibling.');
  const survivor = await group.runs[1].complete({ signal: controller.signal });
  process.stdout.write(`${JSON.stringify({
    runIds: group.ids,
    admitted: admitted.map((view) => view?.outline?.phase ?? null),
    stopped: stopped?.outline?.phase ?? null,
    survivor: survivor?.outline?.phase ?? null,
  })}\n`);
} finally {
  if (controller.signal.aborted && group) {
    await group.stop('Signal received; stop and reap the whole Grok group.').catch(() => {});
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership })}\n`);
}
