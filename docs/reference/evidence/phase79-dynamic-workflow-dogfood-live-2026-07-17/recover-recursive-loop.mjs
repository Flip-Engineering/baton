import { resolve } from 'node:path';

import { openBaton } from '../../../../impl/src/index.mjs';

const snapshot = resolve(process.argv[2] ?? '');
const runId = process.argv[3];
if (!snapshot || !runId) throw new Error('usage: node recover-recursive-loop.mjs SNAPSHOT RUN_ID');

const low = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'low' });
const medium = Object.freeze({ harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' });
const baton = await openBaton({
  repo: snapshot,
  advanced: {
    routes: [low, medium],
    verification: {
      command: 'node',
      arguments: ['--test',
        'impl/test/phase80-workflow-revision.test.mjs',
        'impl/test/phase80-plan-revision-store.test.mjs'],
    },
    capacity: {
      estimate: () => ({ bytes: 64 * 1024 * 1024, inodes: 10_000 }),
      observe: () => ({ freeBytes: Number.MAX_SAFE_INTEGER, freeInodes: Number.MAX_SAFE_INTEGER }),
    },
  },
});

let stop;
try {
  stop = await baton.open(runId).stop('Recover interrupted recursive dogfood and reap exact ownership.');
} finally {
  const close = await baton.close();
  process.stdout.write(`${JSON.stringify({ snapshot, runId, stop: stop?.outline?.ownership ?? null,
    close: close.ownership })}\n`);
}
