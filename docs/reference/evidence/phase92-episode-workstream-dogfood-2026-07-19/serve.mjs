import { resolve } from 'node:path';

import { openBaton, SignalLifecycleOwner } from '../../../../impl/src/index.mjs';

const deployment = await openBaton({
  repo: process.cwd(),
  advanced: {
    deploymentRoot: resolve(process.cwd(), '.baton', 'application-phase92-dogfood'),
  },
});

const lifecycle = new SignalLifecycleOwner({
  signalEmitter: process,
  shutdown: () => deployment.close(),
});

const outcome = await lifecycle.run(async ({ signal }) => {
  const hosted = await deployment.host();
  process.stderr.write(`phase92 dogfood resident: ${JSON.stringify(hosted)}\n`);
  await new Promise((resolveSignal) => {
    if (signal.aborted) resolveSignal();
    else signal.addEventListener('abort', resolveSignal, { once: true });
  });
  return hosted;
});

process.stderr.write(`phase92 dogfood resident: ${JSON.stringify(outcome.closed)}\n`);
