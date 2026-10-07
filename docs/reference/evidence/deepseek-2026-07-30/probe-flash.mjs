// W1.4 DeepSeek baton-route probe: doctor readiness + one bounded live run on
// deepseek-v4-flash. Isolated deployment root; the main tree and main state are untouched
// (the run works in its own worktree). Usage: node docs/reference/evidence/deepseek-2026-07-30/probe-flash.mjs
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const log = (line) => console.log(`[probe ${new Date().toISOString()}] ${line}`);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'deepseek-probe-2026-07-31'),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'low' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

try {
  const doctor = await baton.doctor();
  const deepseekRoutes = doctor.routes.filter((route) => route.harness === 'deepseek');
  log(`doctor: ${deepseekRoutes.length} deepseek route(s)`);
  for (const route of deepseekRoutes) {
    log(`  ${route.model}@${route.effort}: ${route.state ?? '?'} (${route.code ?? 'no-code'}) ${route.summary ?? ''}`);
  }
  const target = deepseekRoutes.find((route) => route.model === 'deepseek-v4-flash' && route.effort === 'low');
  if (!target) throw new Error('deepseek-v4-flash@low route missing from doctor');
  if (target.state !== 'ready') throw new Error(`flash route not ready: ${JSON.stringify(target)}`);

  log('starting bounded live run on deepseek-v4-flash@low …');
  const startedAt = Date.now();
  const run = await baton.runs.start(
    'Create the file deepseek-probe/hello.md in the repository containing exactly one line: '
    + 'deepseek-flash probe ok. Nothing else. Work in ONE continuous turn. '
    + '[probe 2026-07-31]',
    { exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'low' }, scope: ['deepseek-probe/**'] },
  );
  await run.approve();
  const final = await run.complete({ signal: AbortSignal.timeout(300_000) });
  const outline = final?.view ?? final ?? {};
  log(`run finished: phase=${outline.phase ?? '?'} terminal=${final?.terminal ?? outline.terminal ?? '?'} elapsed=${Date.now() - startedAt}ms`);
  const result = await run.inspect({ depth: 'section', section: 'result' });
  log(`result section: ${JSON.stringify(result?.section?.items?.[0]?.value ?? null)}`);
  await run.stop('W1.4 probe complete.');
  log('PROBE-OK');
} finally {
  await baton.shutdown?.().catch(() => {});
}
