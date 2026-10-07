import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Grammar red-team wave (issue #43, docs/35 v1 → v2): TWO decorrelated seats through
// baton.waves — opus and kimi k3 each adversarially attack docs/35-unified-control-grammar.md
// and write an independent findings report. Per methodology the doc is not implementable
// authority until this wave's findings are folded. Driver copies the scratchpad/31-b pattern
// including the 31-c nudge steering loop (w-169 lesson). Deployment state is isolated under
// .baton/grammar-2026-07-24 (phase92-dogfood precedent) because a concurrent controller
// (the scratchpad contract wave) is live on the default root; worktree capacity stays
// correctly repo-shared.

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/grammar-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-redteam3.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/surface-audit-smoke.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks.',
].join(' ');

const ATTACK = [
  'Adversarially red-team docs/35-unified-control-grammar.md (in your checkout; read it FIRST',
  'and in full — it is ~360 lines). You are hunting for design errors that would break',
  'implementation or violate existing executable contracts, NOT critiquing goals. Attack',
  'mechanics, hardest first:',
  '(1) §6 canonical-table completeness: diff it against APPLICATION_COMMAND_DEFINITIONS',
  '(impl/src/application.mjs, grep for the table) and APPLICATION_SEMANTIC_REGISTRY',
  '(impl/src/application-semantics.mjs) — name ANY operation, argument, or behavior the 41-op',
  'set loses (run.wait/run.follow semantics, run.result, episode chapter taxonomy,',
  'run.workstream addressing, context ops).',
  '(2) The episode→view fold (§4.1 note ‡): run.episode chapters carry evidence guarantees',
  '(impl/src/application.mjs episode projections) — does folding them into run.view sections',
  'weaken any pinned contract in impl/test/phase92-episode*.test.mjs?',
  '(3) §7 phase mapping: approved→working, closed→stopped, work_completed→completed,',
  'start_failed→failed — check wave.mjs, story.mjs, application-cli.mjs TERMINAL_RUN_PHASES,',
  'and the issue-31 paused semantics (coordination-store.mjs paused mappings) for any state',
  'distinction a driver or test depends on that the mapping erases.',
  '(4) L2 advertised-do round-trip: check capability filtering of view actions and the MCP',
  'authority-digest plumbing (impl/src/mcp-web-bridge.mjs actionAuthority/authorizeReplay) —',
  'is a byte-identical do-block executable across all four surfaces actually achievable, and',
  'what exact shape must the do block have to survive the digest checks?',
  '(5) Member unification vs recipient resolution: run-level send resolves the CURRENT',
  'semantic recipient inside Baton (no caller-supplied worker id); does role[+generation]',
  'addressing cover every case --to RECIPIENT covers today (impl/src/application.mjs',
  'recipient resolution)? Name collisions between role addressing and workstream generations.',
  '(6) L5 presets-as-sugar: waves.start auto-approves — can that become a RECORDED explicit',
  'approve without changing durability semantics (goal/plan approval events, wave.mjs)?',
  '(7) M1 registry merge (D1/D3): does merging APPLICATION_COMMAND_DEFINITIONS into the',
  'semantic registry risk the Web bus envelope byte-compatibility (web-northbound.mjs',
  'WEB_APPLICATION_ENTRIES derivation, command admission)?',
  '(8) H10 field-order pin: is the current view serialization order already deterministic',
  '(application.mjs view assembly), and where would a pin break replay or digest identity?',
  '(9) Laws L1-L10 generally: name any law that is unimplementable, untestable as stated, or',
  'contradicts a currently-passing test file (name the file).',
  'Also: sanity-check the migration order M0-M5 for a dependency inversion, and the alias',
  'ledger for a hole that lets a new divergence in silently.',
].join(' ');

const REPORT_FORMAT = [
  'Report format: numbered findings, id R<seat>-N, each with: severity P0 (blocks',
  'implementation) / P1 (must fold before M1) / P2 (improvement); the exact docs/35 section',
  'attacked; file:line grounding in impl/; the failure it causes; the MINIMAL concrete change',
  'to docs/35 that repairs it. End with a verdict block: SOUND / SOUND-WITH-FOLDS / UNSOUND',
  'plus the three findings you would fold first. Honest disagreement over politeness; if a',
  'section survives your attack, say so in one line, do not pad.',
].join(' ');

const CONSTRAINTS = [
  'READ-ONLY except your single report file. Never write scratch files (including /tmp). Do',
  'not call gh (no auth in your runtime). Do not invoke nested Baton. One shell command per',
  'call. Do not mutate credentials, harness installations, global configuration, or the main',
  'checkout.',
].join(' ');

// Attempt salt: runs.start is idempotent by objective digest, so every relaunch
// must change the objective or members attach to stopped prior runs.
const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'grammar-redteam-opus',
    exact: Object.freeze({ harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/redteam-opus.md`]),
    report: `${relativeRoot}/redteam-opus.md`,
    objective: [
      `[attempt: ${ATTEMPT}]`,
      `Write ${relativeRoot}/redteam-opus.md — your independent adversarial red-team report`,
      'on the unified control grammar. Prefix your finding ids R-OP-N.',
      ATTACK, REPORT_FORMAT, CONSTRAINTS, OVERSIZE,
    ].join(' '),
  }),
  Object.freeze({
    role: 'grammar-redteam-kimi',
    exact: Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' }),
    scope: Object.freeze([`${relativeRoot}/redteam-kimi.md`]),
    report: `${relativeRoot}/redteam-kimi.md`,
    objective: [
      `[attempt: ${ATTEMPT}]`,
      `Write ${relativeRoot}/redteam-kimi.md — your independent adversarial red-team report`,
      'on the unified control grammar. Prefix your finding ids R-K3-N.',
      ATTACK, REPORT_FORMAT, CONSTRAINTS, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'grammar-2026-07-24-c'),
    routes: [
      { harness: 'claude-code', model: 'claude-opus-4-8', effort: 'high' },
      { harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' },
    ],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[grt3 ${new Date().toISOString()}] ${line}`);
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
  log(`grammar red-team wave started through baton.waves (${MEMBERS.length} members)`);

  const terminalRoles = new Set();
  const nudged = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${entry.attention}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    for (const entry of progress.members) {
      if (entry.phase !== 'paused') continue;
      const run = wave.runs.get(entry.role);
      if (!run) continue;
      try {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const checkpoint = (Array.isArray(view.attention) ? view.attention : [])
          .find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
        if (checkpoint && !nudged.has(checkpoint.requestId)) {
          await run.act('nudge_turn', { message: 'Continue your red-team review and finish your report file.' });
          nudged.add(checkpoint.requestId);
          log(`steered nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
        }
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
      }
    }
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - startedAt > 75 * 60 * 1000) { log('watchdog'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'grammar red-team wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'grammar red-team driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
