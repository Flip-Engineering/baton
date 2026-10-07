import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// REFLEX-4 slice A wave: application.context_eval implementation (Bench without a Workflow),
// running concurrently with the AX-1/docs-32 wave through the baton.waves surface.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const evidencePath = resolve(evidenceDir, 'evidence-reflex4.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});
const exact = { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' };

const baton = await openBaton({ repo, advanced: { routes: [exact], verification: VERIFY } });
const log = (line) => console.log(`[reflex4 ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  const ready = readiness.routes.find((candidate) => (
    candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
  ));
  if (ready?.state !== 'ready') {
    throw Object.assign(new Error(ready?.summary ?? 'route unavailable'), { code: ready?.code ?? 'route_unavailable' });
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: [
      {
        role: 'reflex4-implementer',
        exact,
        scope: [
          'impl/src/application.mjs',
          'impl/src/application-semantics.mjs',
          'impl/src/application-cli.mjs',
          'impl/src/mcp-northbound.mjs',
          'impl/src/mcp-web-bridge.mjs',
          'impl/test/reflex4-context-eval-red.test.mjs',
          'docs/PROGRESS.md',
        ],
        report: null,
        objective: [
          'Implement application.context_eval per docs/reference/evidence/reflex-wave-live-2026-07-21/',
          'reflex4-decisions.md — read it FIRST; it is your binding contract. Pure-only Bench',
          'evaluation without a Workflow, same DurableContextSession admission path, same cell',
          'identity and projections as the Workflow surface, transport parity (direct/Web/MCP',
          'baton_context_eval/CLI baton context eval). Red tests first',
          '(impl/test/reflex4-context-eval-red.test.mjs), then implementation, then focused green,',
          'then the full suite green from the worktree root. No git commits, no scratch/log',
          'writes anywhere (including /tmp), no evaluator changes, no new event kinds.',
        ].join(' '),
      },
    ],
  });
  log('reflex4 wave started through baton.waves');
  const terminalRoles = new Set();
  while (terminalRoles.size < 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    for (const entry of progress.members) {
      log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`);
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 60 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'reflex4 wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log('evidence written');
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'reflex4 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
