import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { openBaton } from '../../../../impl/src/index.mjs';

// Wave 5 — dynamic responsive workflow composition:
// Leg 1 (scripted pattern): baton.review reviewer/challenger preset workflow
//   (glm-5.2 reviewer, kimi-k3 challenger) over the corrected 93a.2 slice.
// Leg 2 (responsive): typed feedback + revise_candidate successor round,
//   then operator selection.
// Leg 3 (nested task set): a claude-sonnet-5 worker instructed to start ONE
//   bounded child run through the resident CLI from inside its worktree and
//   report the child run's identity/status (honest gap recording if the
//   private runtime cannot reach the resident profile).

const evidenceDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(evidenceDir, '../../../..');
const relativeRoot = 'docs/reference/evidence/phase93a2-control-grammar-review-live-2026-07-20';
const evidencePath = resolve(evidenceDir, 'evidence-wave5.json');
const VERIFY = Object.freeze({
  command: 'node',
  arguments: ['--test', 'impl/test/phase93a-control-grammar-red.test.mjs'],
});
const GLM = Object.freeze({ harness: 'glm', model: 'glm-5.2', effort: 'xhigh' });
const KIMI = Object.freeze({ harness: 'kimi-code', model: 'kimi-code/k3', effort: 'high' });
const SONNET = Object.freeze({ harness: 'claude-code', model: 'claude-sonnet-5', effort: 'high' });

const baton = await openBaton({ repo, advanced: { routes: [GLM, KIMI, SONNET], verification: VERIFY } });
const log = (line) => console.log(`[wave5 ${new Date().toISOString()}] ${line}`);
const evidence = {
  schemaVersion: 1, legs: {}, stops: [], progress: [], failure: null,
};
const startedAt = Date.now();
let failure = null;
const startedRuns = [];

async function pumpUntil(run, label, timeoutMs) {
  const pumpArm = { active: false };
  const armPump = () => {
    if (pumpArm.active) return;
    pumpArm.active = true;
    run.complete().then(
      () => { pumpArm.active = false; },
      () => { pumpArm.active = false; },
    );
  };
  armPump();
  const begin = Date.now();
  for (;;) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20000));
    const view = await run.status();
    const outline = view?.view ?? view;
    const phase = outline?.phase ?? '?';
    log(`${label}: ${phase} (${Math.round((Date.now() - begin) / 1000)}s)`);
    evidence.progress.push({ at: new Date().toISOString(), label, phase });
    if (outline?.terminal === true || ['stopped', 'failed', 'cancelled', 'completed', 'work_completed', 'selection_required'].includes(phase)) {
      return { phase, outline };
    }
    if (Date.now() - begin > timeoutMs) return { phase: 'watchdog', outline };
    armPump();
  }
}

try {
  const readiness = await baton.doctor();
  for (const exact of [GLM, KIMI, SONNET]) {
    const ready = readiness.routes.find((candidate) => (
      candidate.harness === exact.harness && candidate.model === exact.model && candidate.effort === exact.effort
    ));
    if (ready?.state !== 'ready') {
      throw Object.assign(new Error(ready?.summary ?? `${exact.harness} unavailable`), { code: ready?.code ?? 'route_unavailable' });
    }
  }

  // ---- Leg 1: scripted reviewer/challenger pattern.
  const review = await baton.review([
    'Review the corrected Phase 93a.2 Program-IR slice at HEAD: spec/phase93-closed-program-ir.md',
    '§93.9 two read relations and impl/src/program-ir/normalize-program.mjs. Reviewer: confirm',
    'conformance claim by claim. Challenger: attack the collect-laundering fix and the per-position',
    'settlement-domain keying with concrete Programs. READ-ONLY; never write scratch files',
    '(including /tmp). Do not invoke nested Baton. Run the pinned verification.',
  ].join(' '), { routes: [GLM, KIMI], scope: [`${relativeRoot}/wave5-*`] });
  log(`leg1 review workflow started as ${review.id}`);
  startedRuns.push(['leg1-review', review]);
  await review.approve();
  const leg1 = await pumpUntil(review, 'leg1', 40 * 60 * 1000);
  evidence.legs.scriptedPattern = { runId: review.id, phase: leg1.phase };

  // ---- Leg 2: responsive typed feedback + revision round.
  const candidates = await review.candidates();
  const items = candidates?.view?.section?.items ?? [];
  const selected = items.find((item) => ['verified', 'accepted'].includes(item.state));
  if (selected) {
    const role = selected.value?.role ?? selected.value?.attempt;
    await review.select(role, 'Orchestrator selects the verified review candidate.');
    evidence.legs.selection = { role, at: new Date().toISOString() };
    log(`leg2 selected ${role}`);
    try {
      await review.sendFeedback(role, {
        kind: 'operator_note',
        text: 'Responsive feedback: before acceptance, require the revision to re-run the three laundered exploit Programs and quote the exact refusal strings.',
      });
      await review.revise('Orchestrator-issued revision round over typed feedback.');
      evidence.legs.revision = { state: 'admitted', at: new Date().toISOString() };
      log('leg2 typed feedback + revision admitted');
      const leg2 = await pumpUntil(review, 'leg2-revision', 30 * 60 * 1000);
      evidence.legs.revision.phase = leg2.phase;
    } catch (error) {
      evidence.legs.revision = { state: 'failed', code: error.code ?? null, message: error.message };
      log(`leg2 feedback/revision failed: ${error.code ?? error.message}`);
    }
  } else {
    evidence.legs.selection = { state: 'no_verified_candidate' };
    log('leg2: no verified candidate to select/revise');
  }

  // ---- Leg 3: nested task set — worker spawns a bounded child run.
  const nested = await baton.runs.start([
    'You are testing bounded nested orchestration. Inside your worktree, use the baton CLI to',
    'start exactly ONE bounded child run:',
    '`node impl/scripts/baton.mjs run start --objective "nested child: list the program-ir module',
    ' names into the scoped file" --exact kimi-code/kimi-code/k3/high --scope nested-child.md`',
    '(adjust flags to the CLI help if the exact form differs; read `node impl/scripts/baton.mjs',
    'help` first). Watch the child run to a terminal state with `run status`, then record the',
    'child run id, its phase, and the exact command you used. If the CLI cannot reach the',
    'resident (discovery/profile/auth), report the EXACT error text verbatim instead.',
    `Write only ${relativeRoot}/wave5-nested.md with headings: ## Outcome, ## Child run,`,
    '## Errors. READ-ONLY otherwise; never write scratch files (including /tmp). Do not mutate',
    'credentials, harness installations, global configuration, or the main checkout. Run the',
    'pinned verification before finishing.',
  ].join(' '), { exact: SONNET, scope: [`${relativeRoot}/wave5-nested.md`, 'nested-child.md'] });
  log(`leg3 nested-orchestration worker started as ${nested.id}`);
  startedRuns.push(['leg3-nested', nested]);
  await nested.approve();
  const leg3 = await pumpUntil(nested, 'leg3', 30 * 60 * 1000);
  evidence.legs.nested = { runId: nested.id, phase: leg3.phase, narrative: leg3.outline?.narrative ?? null };
} catch (error) {
  failure = error;
  evidence.failure = { name: error.name, code: error.code ?? null, message: error.message };
} finally {
  for (const [label, run] of startedRuns) {
    try {
      const stopped = await run.stop(`wave-5 ${label} settled.`);
      evidence.stops.push({ label, runId: run.id, stop: stopped.stop ?? null, ownership: stopped.ownership ?? null });
    } catch (error) {
      evidence.stops.push({ label, runId: run.id, error: { code: error.code ?? null, message: error.message } });
    }
  }
  try {
    if (typeof baton.close === 'function') await baton.close();
  } catch { /* best effort */ }
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  log(`evidence written; failure=${failure ? (failure.code ?? failure.message) : 'none'}`);
}
if (failure) {
  console.error(failure);
  process.exitCode = 1;
}
