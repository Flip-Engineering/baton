import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const controller = new AbortController();
const interrupt = () => controller.abort();
process.once('SIGINT', interrupt);
process.once('SIGTERM', interrupt);

const baton = await openBaton({
  repo,
  advanced: {
    verification: {
      command: 'node',
      arguments: [
        '--test',
        'impl/test/codex-appserver.test.mjs',
        'impl/test/phase57-adapter-wire-bounds.test.mjs',
      ],
    },
  },
});
let run = null;
try {
  run = await baton.run(
    'Live-test Baton Codex telemetry recovery. Produce one deterministic shell command with more than 1 MiB of stdout, then write only reviews/dogfood/phase78-codex-wire-recovery.md with a concise assessment of whether the session remained usable.',
    { exact: { harness: 'codex', model: 'gpt-5.6-sol', effort: 'medium' }, scope: ['reviews/dogfood/phase78-codex-wire-recovery.md'] },
  );
  const completed = await run.complete({ signal: controller.signal });
  const sections = Object.fromEntries(await Promise.all(
    ['execution', 'route', 'result', 'cleanup'].map(async (section) => {
      const projection = await run.inspect({ depth: 'section', section });
      return [section, projection.section];
    }),
  ));
  process.stdout.write(`${JSON.stringify({
    runId: run.id,
    phase: completed?.outline?.phase ?? null,
    terminalCause: completed?.outline?.terminalCause ?? null,
    sections,
  })}\n`);
} finally {
  if (controller.signal.aborted && run) {
    await run.stop('Signal received; stop and reap the Codex recovery Run.').catch(() => {});
  }
  process.removeListener('SIGINT', interrupt);
  process.removeListener('SIGTERM', interrupt);
  process.stdout.write(`${JSON.stringify({ close: (await baton.close()).ownership })}\n`);
}
