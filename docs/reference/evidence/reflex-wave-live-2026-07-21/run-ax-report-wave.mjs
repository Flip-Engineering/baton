import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// AX-report wave: three heterogeneous lenses on baton's agentic experience —
// operator/driver AX (opus), worker-side AX (kimi), orchestration/composition AX (sonnet) —
// each producing a gaps+frictions report for synthesis into issues.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/reflex-wave-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-ax-report.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'ax-operator',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    report: `${relativeRoot}/ax-operator.md`,
    lens: [
      'the ORCHESTRATOR/driver agentic experience of baton: what it is like to compose, monitor,',
      'and steer multi-worker waves through the direct client surface. Ground every claim in',
      'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20/README.md (the 16',
      'receipted AX findings), docs/31-wave-driver-ax.md and its acceptance review (same repo,',
      'docs/reference/evidence/wave-driver-ax-live-2026-07-21/), docs/32-reflexive-orchestration.md,',
      'and impl/src/application-client.mjs. Identify gaps (missing capabilities the operator needs)',
      'and frictions (present-but-rough surfaces) with file:line or evidence citations.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'ax-worker',
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    report: `${relativeRoot}/ax-worker.md`,
    lens: [
      'the WORKER-side agentic experience: what it is like to BE a baton worker — briefs, scopes,',
      'containment, messaging channels (or their absence: no typed decision channel, no board, no',
      'package), steering received mid-turn, trust-gate verification of your own work, and result',
      'capture. Ground claims in impl/src/messages.mjs, impl/src/coordinator.mjs (send/interrupt/',
      'respond paths), impl/src/path-scope.mjs, docs/32-reflexive-orchestration.md §2-3, and the',
      'wave evidence dirs. Identify gaps and frictions with citations.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'ax-composition',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    report: `${relativeRoot}/ax-composition.md`,
    lens: [
      'the ORCHESTRATION/COMPOSITION agentic experience: waves (doc 31), workflows and joins,',
      'the REPL layer (Context Bench), knowledge sharing (scratch/Cairn/artifacts), dynamic',
      'workflow shaping mid-flight, and the MCP surface as the agent-facing channel. Ground claims',
      'in docs/31, docs/32, impl/src/wave.mjs, impl/src/context-program.mjs, impl/src/',
      'mcp-northbound.mjs, and the phase93a3 evidence dir. Identify gaps and frictions with',
      'citations, including what is missing for long-horizon collaborative dynamic workflows.',
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: MEMBERS.map(({ exact }) => exact),
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[axreport ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  for (const { exact } of MEMBERS) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${exact.model} unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: MEMBERS.map(({ role, exact, report, lens }) => ({
      role,
      exact,
      scope: [report],
      report,
      objective: [
        `Write an agentic-experience report on baton from the lens of ${lens}`,
        'Be concrete and critical; no cheerleading. READ-ONLY otherwise: never modify any file',
        'except your report; never write scratch files (including /tmp). Do not invoke nested',
        'Baton. One shell command per call. Do not mutate credentials, harness installations,',
        'global configuration, or the main checkout.',
        `Write only ${report} with EXACTLY these headings:`,
        '## Agentic experience',
        '## Gaps',
        '## Frictions',
        '## Recommendations',
      ].join(' '),
    })),
  });
  log(`AX-report wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 60 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'AX-report wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log('evidence written');
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'AX-report driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
