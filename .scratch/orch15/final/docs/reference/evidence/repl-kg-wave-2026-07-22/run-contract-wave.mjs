import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// REPL/KG contract-drafting wave: four spec-drafter seats through baton.waves.
// Binding inputs: docs/33-shared-objects-repl-layer.md (v2) + docs/34-knowledge-horizons.md
// (v2), issues #21-27. Output: implementation-grade decisions contracts in the style of
// docs/reference/evidence/reflex-wave-live-2026-07-21/reflex2-boards-decisions.md
// (numbered rules, red-test lists, boundaries, validation, file:line grounding).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/repl-kg-wave-2026-07-22';
const evidencePath = resolve(evidenceDir, 'evidence-contracts.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-red.test.mjs'],
});

const COMMON = [
  'Draft an implementation-grade decisions contract in the style of',
  'docs/reference/evidence/reflex-wave-live-2026-07-21/reflex2-boards-decisions.md (numbered',
  'rules with file:line grounding, a red-test list, boundaries, validation). Ground every rule',
  'in the actual code — verify each file:line you cite. The binding design docs are v2 and',
  'already red-team-corrected; do NOT re-litigate their settled decisions (ReplManifest as a',
  'second manifest shape with its own digest basis; per-scope binding fences; cell: refs',
  'resolved at manifest admission; recallPreview non-evented; providerBrief injection seam;',
  'Source-node citation bridging; union fences; auto-link restricted to Supports/Refines/Cites).',
  'Your job is the implementation contract: exact shapes, event payloads, admission/validation',
  'order, error codes, bounds, replay semantics, the _apply/snapshot/checkpoint fold surface,',
  'and the red-test list. READ-ONLY except your output file; never write scratch files',
  '(including /tmp). Do not invoke nested Baton. One shell command per call. Do not mutate',
  'credentials, harness installations, global configuration, or the main checkout.',
].join(' ');

const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'repl1-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/repl1-decisions.md`]),
    report: `${relativeRoot}/repl1-decisions.md`,
    objective: [
      `Write ${relativeRoot}/repl1-decisions.md — the REPL-1 contract (issue #21): ReplManifest`,
      'shape + normalization discipline + baton.repl_manifest digest basis;',
      'repl.manifest_admitted as the authority record (orchestrator-lease for shared,',
      'wrapper-forced worker identity); the new openSession path and admitContextCell principal',
      'pinning; the full fold surface (docs/33 §4) incl. the event-kind inventory test.',
      'Read docs/33-shared-objects-repl-layer.md (v2) §3.1/§4 FIRST, then',
      'context-program.mjs:183-275 (manifest mold), application.mjs:8323-8363 (the REFLEX-4',
      'authority note this answers), coordination-store.mjs:9017-9020 (principal pinning),',
      ':7158/:89-110/:9937/:7196-7218 (fold surface).', COMMON,
    ].join(' '),
  }),
  Object.freeze({
    role: 'repl23-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/repl23-decisions.md`]),
    report: `${relativeRoot}/repl23-decisions.md`,
    objective: [
      `Write ${relativeRoot}/repl23-decisions.md — the REPL-2 + REPL-3 contracts (issues #22,`,
      '#23): binding shapes + repl.binding_set/_dropped events + per-scope fence (EVERY write',
      'advances its own scope fence — the board-fence divergence) + cached non-evented',
      'projections + citation grammar repl:<scope>:<name>@<version> + bounds; ReplManifest cell:',
      'branch refs resolved at admission with evented coordinates, settled-only rule,',
      '§93.5/attention read semantics. Read docs/33 (v2) §3.2/§3.3 FIRST, then the REFLEX-2',
      'contract (reflex2-boards-decisions.md Part B/C for fence/projection precedent),',
      'context-program.mjs:989-1001 (outputRef), :1259-1271 (attention semantics), and the',
      'landed boards code in coordination-store.mjs (board fence + claim CAS, grep _boardFences).',
      COMMON,
    ].join(' '),
  }),
  Object.freeze({
    role: 'kg12-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/kg12-decisions.md`]),
    report: `${relativeRoot}/kg12-decisions.md`,
    objective: [
      `Write ${relativeRoot}/kg12-decisions.md — the KG-1 + KG-2 contracts (issues #24, #25):`,
      'three horizon projections with union-fence caching and non-evented task/workflow reads;',
      'board-close → workflow Finding (grounding observed, coordinationSeq evidence, extras',
      'triple); Source-node idempotent minting + DerivedFrom citation bridging for packages;',
      'settle-time orchestrator-admit gate (wrapper-bound actor). Read docs/34 (v2) §3 KG-1/KG-2',
      'FIRST, then coordination-store.mjs:11994-12100 (node/edge admission), :12231-12291',
      '(evidence refs + Contradicts/Supersedes rules), :119-123 (policy block), and',
      'coordinator.mjs:5558-5572 (existing auto-promotion) + :9141-9171 (actor binding).', COMMON,
    ].join(' '),
  }),
  Object.freeze({
    role: 'kg34-contract-drafter',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/kg34-decisions.md`]),
    report: `${relativeRoot}/kg34-decisions.md`,
    objective: [
      `Write ${relativeRoot}/kg34-decisions.md — the KG-3 + KG-4 contracts (issues #26, #27):`,
      'recallPreview (non-evented, cached to project-horizon fence, fail-open with',
      'briefingUnavailable, never feeds recall assessment); the _providerBrief/spawn injection',
      'seam (briefDigest untouched — coordinator.mjs:4506/:4512/:4622/:4784); decision-time',
      'related-nodes; contradiction-first ranking; composite scoring policy; auto-link',
      'restricted to Supports/Refines/Cites with per-type thresholds at grounding asserted;',
      'MAD confidence projection; staleness surfacing. Read docs/34 (v2) §3 KG-3/KG-4 FIRST,',
      'then coordination-store.mjs:12398-12560 (recall machinery to mirror read-only),',
      ':12276-12291 (edge endpoint/type rules), application.mjs:196-221 (sanitization), and',
      '/tmp/pm-kg-reference/confidence.rs + v6-cognitive-augmentation-scope.md:81-143 (the PM',
      'patterns being borrowed — read-only reference copies).', COMMON,
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

const log = (line) => console.log(`[replkg ${new Date().toISOString()}] ${line}`);
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
  log(`REPL/KG contract wave started through baton.waves (${MEMBERS.length} members)`);

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
  const stop = await wave.close({ reason: 'REPL/KG contract wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'REPL/KG contract driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
