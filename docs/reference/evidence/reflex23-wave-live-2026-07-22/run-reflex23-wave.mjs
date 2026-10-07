import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// REFLEX-2/3 implementation wave: two concurrent seats through baton.waves —
// reflex2-boards-implementer (orchestrator-controlled task boards) and
// reflex3-packages-implementer (knowledge/context hand-off packages).
// Binding contracts: docs/reference/evidence/reflex-wave-live-2026-07-21/
//   reflex2-boards-decisions.md + reflex3-packages-decisions.md (committed b0d4976).
// Overlap note: both scopes share coordination-store.mjs / application.mjs /
// messages.mjs — extraction is sequential with 3-way apply if hunks collide.
// docs/PROGRESS.md deliberately out of scope for both; integration writes it.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/reflex-wave-live-2026-07-21';
const evidencePath = resolve(evidenceDir, 'evidence-reflex23.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'reflex2-boards-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/fence.mjs',
      'impl/src/application.mjs', 'impl/src/application-cli.mjs', 'impl/src/messages.mjs',
      'impl/src/mcp-northbound.mjs', 'impl/src/mcp-web-bridge.mjs',
      'impl/test/reflex2-boards-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement REFLEX-2 orchestrator-controlled task boards per ${contractsRoot}/`,
      'reflex2-boards-decisions.md — read it FIRST; it is your binding contract (F8/F9/F10',
      'resolved): immutable items + successor versions with claim migration keyed to itemId;',
      'claim expiry on worker death via _expireBoardClaims mirroring _expireScratchClaims on the',
      'same terminal hooks; a NEW board-scoped replay-derivable fence counter (NEVER FenceTable,',
      'NEVER the worker fence — the claimScratch trap); claim CAS at expectedBoardFence;',
      'non-evented reads ONLY (no board.read event kind) with cached per-worker projections keyed',
      'by (board, workerId, boardFence), MAX_BOARD_VIEW_BYTES/MAX_BOARD_ITEMS bounds, poll budget;',
      'boundedAttentionText/SECRET_SHAPED_TEXT sanitization with untrusted-prose provenance.',
      'Red tests first (impl/test/reflex2-boards-red.test.mjs), then implementation, then focused',
      'green, then the full suite green from the worktree root. No git commits, no scratch/log',
      'writes anywhere (including /tmp), no FenceTable changes, no new event kinds beyond the',
      'named board.* family. Do NOT touch docs/PROGRESS.md.',
    ].join(' '),
  }),
  Object.freeze({
    role: 'reflex3-packages-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/application.mjs', 'impl/src/messages.mjs',
      'impl/src/application-cli.mjs', 'impl/src/mcp-northbound.mjs', 'impl/src/mcp-web-bridge.mjs',
      'impl/test/reflex3-packages-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement REFLEX-3 knowledge/context hand-off packages per ${contractsRoot}/`,
      'reflex3-packages-decisions.md — read it FIRST; it is your binding contract (F11 resolved):',
      'provenance packageEvent is hub-derived from the admission ledger event (reserved_package_field',
      'refusal if submitted), bound after admission, re-derived on replay, loud',
      'package_provenance_integrity on mismatch (scratchFactOracleTarget pattern);',
      'normalizeContextPackage in the normalizeContextManifest mold (exact() fields,',
      'delete-and-recompute packageDigest WITHOUT packageEvent, reject unknown fields); unique',
      'branch names (package_branch_name_conflict); every branch requires >=1 of',
      'source/artifact/valueRef (package_branch_empty); validate once at admission; attach is a',
      'fenced O(1) pointer binding with NO byte re-read; resolve-time revalidation per §93.5 via',
      'withContextArtifactVerification settling artifact_unavailable; projection sanitization with',
      'provenance marking. Red tests first (impl/test/reflex3-packages-red.test.mjs), then green,',
      'then full suite from the worktree root. No git commits, no scratch/log writes anywhere',
      '(including /tmp), do NOT modify context-program.mjs or §93.5 read semantics, no new event',
      'kinds beyond package.admitted/package.attached. Do NOT touch docs/PROGRESS.md.',
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    routes: [
      { harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' },
      { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[r23 ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
try {
  const readiness = await baton.doctor();
  for (const member of MEMBERS) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === member.exact.harness && candidate.model === member.exact.model && candidate.effort === member.exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${member.role} route unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }
  wave = await baton.waves.start({
    repoRoot: repo,
    members: MEMBERS.map(({ role, exact, scope, report, objective }) => ({ role, exact, scope: [...scope], report, objective })),
  });
  log(`REFLEX-2/3 wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 100 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'REFLEX-2/3 wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'REFLEX-2/3 driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
