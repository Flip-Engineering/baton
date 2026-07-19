import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const runs = [
  {
    objective: 'Review the integrated Baton deployment and bound Run AX. Write concise, source-grounded P0/P1 findings to reviews/dogfood/phase78-kimi-deployment-review.md and change no other path.',
    exact: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'max' },
    scope: ['reviews/dogfood/phase78-kimi-deployment-review.md'],
  },
  {
    objective: 'Review the integrated Baton deployment for route, lifecycle, and cleanup defects. Write concise, source-grounded P0/P1 findings to reviews/dogfood/phase78-codex-deployment-review.md and change no other path.',
    exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' },
    scope: ['reviews/dogfood/phase78-codex-deployment-review.md'],
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/phase78-concise-deployment-factory.test.mjs',
        'impl/test/phase78-bound-run-group-red.test.mjs',
      ],
    },
  },
});
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);
try {
  const group = await baton.startMany(runs);
  const completed = await Promise.all(group.runs.map((run) => (
    run.complete({ signal: controller.signal })
  )));
  const results = await Promise.all(group.runs.map((run) => (
    run.inspect({ depth: 'section', section: 'result' })
  )));
  process.stdout.write(`${JSON.stringify({
    runs: group.ids.map((runId, index) => ({
      runId,
      phase: completed[index]?.outline?.phase ?? null,
      result: results[index]?.section?.items?.[0]?.value ?? null,
    })),
  })}\n`);
} finally {
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership })}\n`);
}
