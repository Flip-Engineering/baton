import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// REPL implementation wave A: two seats through baton.waves —
// repl1-implementer (ReplManifest + session authority, opus) and
// repl23-implementer (bindings + cell: branch refs, sonnet).
// Binding contracts (v2 FINAL, 7dd5bb6):
//   docs/reference/evidence/repl-kg-wave-2026-07-22/repl1-decisions.md
//   docs/reference/evidence/repl-kg-wave-2026-07-22/repl23-decisions.md
// Overlap note: both scopes share coordination-store.mjs / coordinator.mjs /
// application.mjs — extraction is sequential with 3-way apply if hunks collide.
// The shared kind-inventory test is owned by repl1; repl23 names its new event
// kinds in a closing comment of its own test file for integration to fold in.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const contractsRoot = 'docs/reference/evidence/repl-kg-wave-2026-07-22';
const evidencePath = resolve(evidenceDir, 'evidence-impl-a.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize killed both previous seats): a single stream-json',
  'frame over 1MiB terminates your run instantly (issue #28). NEVER Read a whole file over',
  '~1500 lines (coordination-store.mjs/coordinator.mjs/application.mjs/context-program.mjs are',
  '5-13k lines) — Grep to locate, then Read targeted line ranges. NEVER run a suite or command',
  'whose full output could be large without bounding it: pipe through tail/grep (e.g.',
  '`node scripts/run-suite.mjs 2>&1 | tail -60`). Write large files in chunks (Write then',
  'append) rather than one giant call.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'repl1-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/context-authority.mjs', 'impl/src/context-program.mjs', 'impl/src/context-runtime.mjs',
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/src/run-lineage.mjs',
      'impl/test/repl1-manifest-red.test.mjs', 'impl/test/repl1-kind-inventory-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement REPL-1 per ${contractsRoot}/repl1-decisions.md — read it FIRST; it is your`,
      'binding contract (v2 FINAL): ReplManifest with baton.repl_manifest digest basis;',
      'repl.manifest_admitted authority record (orchestrator-lease for shared with',
      'lease.parent.runId === payload.runId; wrapper-threaded auth for worker scopes,',
      'store-side replRole comparison); the ONE coherent authority-layer change across the 5',
      'coupled sites (kind-dispatching normalizeManifestAny at admission AND fold, repl branch',
      'in _validateContextSessionPayload and _assertContextSessionCurrent, DurableContextSession',
      'admission injection, kind guards in the existing session scans); re-admission conflict',
      'rule; the full fold surface + closed event-kind inventory test. Red tests first',
      '(impl/test/repl1-manifest-red.test.mjs AND impl/test/repl1-kind-inventory-red.test.mjs),',
      'then implementation, then focused green, then the full suite green from the worktree',
      'root. No git commits, no scratch/log writes anywhere (including /tmp), no evaluator',
      'changes (StatelessContextBench and the 14+4 op whitelist are untouched — authority',
      'layer only).',
      OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'repl23-implementer',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([
      'impl/src/coordination-store.mjs', 'impl/src/coordinator.mjs', 'impl/src/application.mjs',
      'impl/src/messages.mjs', 'impl/test/repl23-bindings-red.test.mjs',
    ]),
    report: null,
    objective: [
      `Implement REPL-2 + REPL-3 per ${contractsRoot}/repl23-decisions.md — read it FIRST; it`,
      'is your binding contract (v2 FINAL): bindings keyed (runId, scope, name) with',
      'manifestDigest in every payload; repl.binding_set/_dropped with per-scope fences (every',
      'write advances its own scope fence); cached non-evented projections; closed citation',
      'grammar repl:<scope>:<name>@<version> (colon excluded from names); divergent-replay',
      'payload comparison; ReplManifest cell: branch refs resolved at admission with evented',
      'coordinates (ctx:sha256: scheme), settled-only rule, §93.5/attention read semantics.',
      'DEPENDENCY: repl.manifest_admitted machinery may be landing concurrently — code against',
      'the contract shapes, and if the repl1 symbols are absent from your base, define the',
      'minimal integration seams you need behind clearly named functions with a',
      'REPL1-INTEGRATION comment. Red tests first (impl/test/repl23-bindings-red.test.mjs),',
      'then green, then full suite from the worktree root. End your test file with a comment',
      'listing every new event kind you introduced (for the kind-inventory fold). No git',
      'commits, no scratch/log writes anywhere (including /tmp).',
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

const log = (line) => console.log(`[implA ${new Date().toISOString()}] ${line}`);
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
  log(`REPL implementation wave A started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'REPL implementation wave A settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'implementation wave A driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
