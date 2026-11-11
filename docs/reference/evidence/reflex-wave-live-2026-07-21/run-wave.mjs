import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Parallel reflex waves — FIRST production dogfood of the baton.waves surface (doc 31):
// one implementer (AX-1 blocked_interaction) + one design red-team (docs/32), monitored and
// steered through wave.progress()/send/settle/close with a file steering lane.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/reflex-wave-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence.json');
const steerDir = '/tmp/reflex-wave-steer';
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const baton = await openBaton({
  repo,
  advanced: {
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[reflex ${new Date().toISOString()}] ${line}`);
mkdirSync(steerDir, { recursive: true });
rmSync(evidencePath, { force: true });
let failure = null;
let wave = null;
const startedAt = Date.now();
const steering = [];
try {
  const readiness = await baton.doctor();
  for (const exact of [
    { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
    { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
  ]) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${exact.model} unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }

  wave = await baton.waves.start({
    repoRoot: repo,
    members: [
      {
        role: 'ax1-implementer',
        exact: { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
        scope: [
          'impl/src/application.mjs',
          'impl/src/application-cli.mjs',
          'impl/test/issue10-blocked-interaction-red.test.mjs',
          'docs/PROGRESS.md',
        ],
        report: null,
        objective: [
          'Implement AX-1 (blocked_interaction classification + required-action projection) per',
          'docs/reference/evidence/reflex-wave-live-2026-07-21/ax1-decisions.md — read it FIRST,',
          'it is your binding contract. Red tests first (impl/test/issue10-blocked-interaction-red.test.mjs),',
          'then the implementation in impl/src/application.mjs (one projection helper consumed by',
          'status/wait outline, runs.list, and the CLI outline identically), then focused green,',
          'then the full suite green from the worktree root. No git commits, no scratch/log writes',
          'anywhere (including /tmp), no settlement-path changes, no new ledger event kinds.',
        ].join(' '),
      },
      {
        role: 'reflex-redteam',
        exact: { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
        scope: [`${relativeRoot}/reflex-redteam.md`],
        report: `${relativeRoot}/reflex-redteam.md`,
        objective: [
          'Act as the adversarial red team for docs/32-reflexive-orchestration.md. Read it, then',
          'the current-truth files it cites (impl/src/messages.mjs, impl/src/coordinator.mjs',
          'respond/_handleEvent paths, impl/src/coordination-store.mjs scratch family,',
          'impl/src/context-program.mjs, impl/src/application.mjs attention/context gating).',
          'Attack the four designs: decision-request settlement races and malformed-answer',
          'robustness; task-board fencing/claim races and per-worker filtering cost; ContextPackage',
          'admission/attach revalidation cost and lineage games; application.context_eval identity',
          'vs the Workflow path; gating deadlocks (worker blocked on decision vs orchestrator',
          'blocked on the same run); and whether each projection stays sanitized. Cite file:line',
          'for every claim; construct counterexamples where possible (in memory, never write',
          'scratch files, including /tmp).',
          `Write only ${relativeRoot}/reflex-redteam.md with EXACTLY these headings:`,
          '## Verdict',
          '## P0-P1 findings',
          '## Required corrections',
          'READ-ONLY otherwise. Do not invoke nested Baton. One shell command per call. Do not',
          'mutate credentials, harness installations, global configuration, or the main checkout.',
        ].join(' '),
      },
    ],
  });
  log('wave started through baton.waves');

  const terminalRoles = new Set();
  while (terminalRoles.size < 2) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    for (const role of ['ax1-implementer', 'reflex-redteam']) {
      const steerFile = join(steerDir, `${role}.txt`);
      if (existsSync(steerFile)) {
        const message = readFileSync(steerFile, 'utf8').trim();
        rmSync(steerFile, { force: true });
        if (message.length > 0) {
          try {
            await wave.send(role, message, { delivery: 'now' });
            steering.push({ role, at: new Date().toISOString(), state: 'sent', message: message.slice(0, 400) });
            log(`steered ${role}: ${message.slice(0, 100)}`);
          } catch (error) {
            steering.push({ role, at: new Date().toISOString(), state: 'failed', code: error.code ?? null });
            log(`steer ${role} failed: ${error.code ?? error.message}`);
          }
        }
      }
    }
    const progress = await wave.progress();
    const line = progress.members.map((entry) => {
      const tag = entry.attention ? `${entry.phase}[${entry.attention}]` : entry.phase;
      return `${entry.role}=${tag}`;
    }).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 75 * 60 * 1000) { log('watchdog'); break; }
  }

  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'reflex waves settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, steering, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown, waveEvidence: wave.evidence() }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'reflex driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  if (!existsSync(evidencePath)) {
    writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, failure: failure ? { name: failure.name, code: failure.code ?? null, message: failure.message } : null, steering }, null, 2)}\n`);
  }
}
process.exitCode = failure ? 1 : 0;
