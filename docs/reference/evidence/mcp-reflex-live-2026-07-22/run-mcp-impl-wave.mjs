import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// MCP reflex surface implementation wave: two seats through baton.waves per the
// v2 contract's slice plan (mcp-reflex-surface-decisions.md, de68345):
//   slice 1 (mcp-core-implementer): registration machinery (Parts A/F) +
//     baton_context_eval (B) + decision tools (C) + inventory/error tests.
//   slice 2 (mcp-board-package-implementer): board tools (D) + package tools (E)
//     bound to the landed hub methods.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/mcp-reflex-live-2026-07-22';
const evidencePath = resolve(evidenceDir, 'evidence-mcp-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines',
  '(mcp-northbound.mjs/application.mjs/coordination-store.mjs are 1-13k lines) — Grep to',
  'locate, then Read targeted line ranges. Bound every large command output: pipe through',
  'tail/grep. Write large files in chunks.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'mcp-core-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/mcp-northbound.mjs', 'impl/src/application.mjs',
      'impl/test/mcp-reflex-surface-red.test.mjs', 'impl/test/phase16-mcp-northbound.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement MCP reflex surface SLICE 1 per ${contractsRoot}/mcp-reflex-surface-decisions.md`,
      '(v2 FINAL, de68345) — read it FIRST; it is your binding contract: REFLEX_TOOL_DEFINITIONS',
      'fourth table (frozen, taskSupport forbidden, _meta registryDigest); explicit dispatch',
      'branches, NEVER APPLICATION_COMMAND_DEFINITIONS keys; per-tool CAPABILITY/STATEFUL/',
      'RECONCILABLE registration pinned in the table (R1/R2); baton_context_eval (strip',
      'repoId/idempotencyKey before application.contextEval, STATEFUL); baton_decision_list',
      '(projectDecisionAttention, no deadlineMs) + baton_decision_answer (STATEFUL, generic',
      'run.answer branch with lease passthrough, pre-dispatch answer-key guard optionId|text',
      'ONLY — {decision} refused invalid_arguments); stateFailureCode extension + the :851',
      'read-only gate (Part F); inventory tests extended in the SAME commit (phase16 closed',
      'counts 47+N with names verbatim, _meta on reflex tools); NO reflex tools on the Web',
      'bridge or in kimiBatonMcpEntry.enabledTools (Part G — bridge assertions unchanged).',
      'Red tests first (impl/test/mcp-reflex-surface-red.test.mjs), then implementation, then',
      'focused green, then the full suite green from the worktree root. No git commits, no',
      'scratch/log writes anywhere (including /tmp).',
      OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'mcp-board-package-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/mcp-northbound.mjs', 'impl/src/coordination-store.mjs',
      'impl/test/mcp-reflex-board-package-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement MCP reflex surface SLICE 2 per ${contractsRoot}/mcp-reflex-surface-decisions.md`,
      '(v2 FINAL, de68345) — read it FIRST; it is your binding contract: baton_board_{post,',
      'reorder,retitle,close,read} bound to the LANDED hub methods (postBoardItem',
      'coordination-store.mjs:12061, reorderBoardItem :12121, retitleBoardItem :12113,',
      'closeBoardItem :12128, boardSnapshot :12203) with orchestrator-lease authority +',
      'expectedBoardFence CAS; NO claim/report tools — refuse with the typed Part D code',
      '(operator claims wedge F8); baton_package_{admit,attach,read} bound to',
      'admitContextPackage :8796, attachContextPackage :8830, resolveContextPackageBranch',
      ':8779 + contextPackage/Attachments reads; attach is fenced O(1) (no re-read); read',
      'surfaces artifact_unavailable typed. Same registration discipline as slice 1 (per-tool',
      'CAPABILITY/STATEFUL/RECONCILABLE; read-only tools on the observe path). DEPENDENCY:',
      'slice 1 may be landing the fourth table concurrently — if REFLEX_TOOL_DEFINITIONS is',
      'absent from your base, add your tools behind a clearly-named MCP-SLICE1-INTEGRATION',
      'seam. Red tests first (impl/test/mcp-reflex-board-package-red.test.mjs), then green,',
      'then full suite from the worktree root. No git commits, no scratch/log writes anywhere',
      '(including /tmp).',
      OVERSIZE,
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

const log = (line) => console.log(`[mcp ${new Date().toISOString()}] ${line}`);
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
  log(`MCP reflex surface wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'MCP reflex surface wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'MCP reflex surface driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
