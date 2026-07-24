import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Issue #46 implementation wave (docs/37 v2, fbb9bbd): ONE glm-5.2@xhigh seat builds the
// shipped wave driver red-first (wave-driver-policy-red D1-D10, then canonical suite green).
// GLM's first implementation seat this campaign — bounded scope (one new module + one new
// test file + one export line), with the checkpoint-pin safety net. Deployment isolated under
// .baton/issue46-2026-07-24. Driver: 31-c steering loop + requestId dedup + cursor-STRIPPED
// status-hash stall marker (R46R-2 — the global cursor flaps on any deployment event) +
// the L6 unproductive-checkpoint budget applied to this bespoke loop (digest unchanged across
// a nudge cycle => stop nudging that member; the treadmill lesson from the grammar reviser).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/wave-driver-2026-07-24';
const evidencePath = resolve(evidenceDir, 'evidence-impl.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/wave-driver-policy-red.test.mjs'],
});

const OVERSIZE = [
  'HARD CONSTRAINT (wire_frame_oversize kills runs, issue #28): a single stream-json frame',
  'over 8MiB terminates your run instantly. NEVER Read a whole file over ~1500 lines — Grep',
  'to locate, then Read targeted line ranges. Bound every large command output with',
  'tail/grep. Write large files in chunks.',
].join(' ');

const CLOCK = [
  'FIXED-CLOCK RULE: any test that needs wall-clock control uses the suite fixed-clock',
  'fixture pattern (never real Date.now plus a hardcoded expiry — that time-bombs the suite).',
].join(' ');

const TASK = [
  'Implement issue #46 per docs/37-wave-driver.md v2 (the controlling contract — READ the',
  'laws L1-L7 and §2 surface in full). State of play: the red-suite HARNESS ALREADY EXISTS',
  'on master at impl/test/wave-driver-policy-red.test.mjs (242 lines of fixtures written by',
  'a prior glm seat — verify it, do not rewrite it). Your job, in this order:',
  '(1) EXTEND that file with the D1-D10 test blocks per §3 of the doc (requestId dedup;',
  'cursor-stripped liveness + sibling-cursor immunity; true stall; hard cap with',
  'stall-before-cap precedence; salt semantics; the L6 termination law; envelope shape;',
  'nudge-failure tolerance; claim fan-out; unavailable semantics), every test failing for',
  'the right reason before implementation (the file currently has fixtures and zero tests).',
  '(2) Implement until the focused suite is green: impl/src/wave-driver.mjs shipping',
  'createWaveDriver(baton, policy).run(waveStartOptions) per §2 (closed policy field set with',
  'defaults, the receipt envelope + additive fields, admission-time objective byte-check,',
  'salt=attempt-uuid+role with internal-retry re-attach, L5 cursor-stripped wave-level stall',
  'clock, L6 unproductivity budget + claim fan-out), plus the additive re-export beside',
  'createWave at impl/src/index.mjs:185. Do NOT touch wave.mjs or the client facade (L2/L3).',
  '(3) Then run the canonical suite as `node impl/scripts/run-suite.mjs` FROM THE REPO ROOT',
  '(never cd impl first) and keep it fully green — wave-driver-red W1-W10 and',
  'turn-checkpoints-31b5 must stay green byte-identically.',
  'Work ONLY in your scoped files. One shell command per call. Do not call gh. Do not invoke',
  'nested Baton. When the focused suite AND the canonical suite are both green, end your turn',
  'with work_completed — do not idle waiting for further instruction.',
].join(' ');

// Attempt salt: runs.start is idempotent by objective digest, so every relaunch
// must change the objective or members attach to stopped prior runs.
const ATTEMPT = new Date().toISOString();
const MEMBERS = Object.freeze([
  Object.freeze({
    role: 'wave-driver-implementer-glm',
    exact: Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }),
    scope: Object.freeze([
      'impl/src/wave-driver.mjs',
      'impl/test/wave-driver-policy-red.test.mjs',
      'impl/src/index.mjs',
    ]),
    report: 'impl/test/wave-driver-policy-red.test.mjs',
    objective: [
      `[attempt: ${ATTEMPT}]`,
      TASK, CLOCK, OVERSIZE,
    ].join(' '),
  }),
]);

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', 'issue46-2026-07-24'),
    routes: [{ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' }],
    verification: VERIFY,
  },
});

const log = (line) => console.log(`[i46 ${new Date().toISOString()}] ${line}`);
let failure = null;
let wave = null;
const startedAt = Date.now();
let lastProgressAt = Date.now();
let lastMarker = '';
const digestByRole = new Map(); // L6 bespoke budget: role -> { digest, nudgedCycle }
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
  log(`issue46 implementation wave started through baton.waves (${MEMBERS.length} members, objectiveBytes=${Buffer.byteLength(MEMBERS[0].objective)})`);

  const terminalRoles = new Set();
  const nudged = new Set();
  const exhaustedNudge = new Set();
  while (terminalRoles.size < MEMBERS.length) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const progress = await wave.progress();
    const line = progress.members.map((entry) => `${entry.role}=${entry.phase}${entry.attention ? `[${JSON.stringify(entry.attention)}]` : ''}`).join(' ');
    log(`progress ${Math.round((Date.now() - startedAt) / 1000)}s ${line}`);
    const markerParts = [];
    for (const entry of progress.members) {
      if (entry.terminal) { markerParts.push([entry.role, 'terminal']); continue; }
      const run = wave.runs.get(entry.role);
      let digest = 'unavailable';
      try {
        const status = run ? await run.status() : null;
        const view = { ...(status?.view ?? status ?? {}) };
        delete view.cursor; // R46R-2: the global cursor flaps on any deployment event
        digest = createHash('sha256').update(JSON.stringify(view)).digest('hex').slice(0, 16);
      } catch { /* transient status failure is not a stall signal */ }
      markerParts.push([entry.role, entry.phase, digest]);
    }
    const marker = JSON.stringify(markerParts);
    if (marker !== lastMarker) { lastMarker = marker; lastProgressAt = Date.now(); }
    for (const entry of progress.members) {
      if (entry.phase !== 'paused' || exhaustedNudge.has(entry.role)) continue;
      const run = wave.runs.get(entry.role);
      if (!run) continue;
      try {
        const status = await run.status();
        const view = status?.view ?? status ?? {};
        const checkpoint = (Array.isArray(view.attention) ? view.attention : [])
          .find((item) => item?.kind === 'turn_checkpoint' && typeof item?.requestId === 'string');
        if (!checkpoint || nudged.has(checkpoint.requestId)) continue;
        // L6 bespoke budget: a re-park with an unchanged changedPathsDigest after a nudge
        // means the member is done — stop nudging it (the treadmill lesson).
        const prior = digestByRole.get(entry.role);
        if (prior && prior.digest === checkpoint.changedPathsDigest && prior.nudgedCycle) {
          exhaustedNudge.add(entry.role);
          log(`unproductive checkpoint for ${entry.role} (digest unchanged across a nudge cycle) — nudge budget exhausted, member parked`);
          continue;
        }
        await run.act('nudge_turn', { message: 'Continue: red-first D1-D10 suite, then createWaveDriver, then the canonical suite — end with work_completed when both are green.' });
        nudged.add(checkpoint.requestId);
        digestByRole.set(entry.role, { digest: checkpoint.changedPathsDigest, nudgedCycle: true });
        log(`steered nudge_turn on ${checkpoint.requestId} for ${entry.role}`);
      } catch (error) {
        log(`nudge for ${entry.role} returned ${error?.code ?? 'unknown'} (recorded)`);
      }
    }
    for (const entry of progress.members) {
      if (entry.terminal || entry.phase === 'work_completed') terminalRoles.add(entry.role);
    }
    if (Date.now() - lastProgressAt > 20 * 60 * 1000) { log('stalled: no cursor-stripped status-view change in 20min'); break; }
    if (Date.now() - startedAt > 3 * 60 * 60 * 1000) { log('watchdog (3h hard cap)'); break; }
  }
  const outcomes = await wave.settle({ timeoutMs: 5_000 });
  for (const outcome of outcomes) log(`outcome ${outcome.role}: phase=${outcome.phase} sha=${outcome.resultSha ?? 'none'}`);
  const stop = await wave.close({ reason: 'issue46 implementation wave settled.' });
  log(`close remaining=${stop.remainingCount} residueUnknown=${stop.residueUnknown}`);
  writeFileSync(evidencePath, `${JSON.stringify({ schemaVersion: 1, outcomes, stops: stop.stops, remainingCount: stop.remainingCount, residueUnknown: stop.residueUnknown }, null, 2)}\n`);
  log(`evidence written; pumpQuiescent=${wave.pumpQuiescent}`);
} catch (error) {
  failure = error;
  console.error(failure);
} finally {
  if (wave) {
    try { await wave.close({ reason: 'issue46 implementation driver shutdown.' }); } catch { /* best effort */ }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
}
process.exitCode = failure ? 1 : 0;
