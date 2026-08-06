// #114 FOLD WAVE — one deepseek folder: folds the red-team's B1-B6 into the workflow-as-data
// contract (v1.0 → v1.1), THEN folds the red-first suite to the v1.1 semantics (same run —
// the suite fold depends on the folded contract). Facade-only launcher.
// Usage: node run-fold-114-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/workflow-as-data-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `f4${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[f114 ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'fold-114-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

// NOTE: the first attempt's 4228-byte objective exceeded the 4096-byte rendered cap and the wave
// came back with zero runs and NO typed error (a real AX hole — oversize must refuse by name at
// waves.start). The fold brief now rides by reference; the objective stays well under the cap.
const OBJECTIVE = [
  `[attempt: f4-${ATTEMPT}] You are FOLDING the workflow-as-data red-team into the contract (v1.0 → v1.1) and then its red-first suite. First read docs/reference/evidence/workflow-as-data-2026-08-06/fold-114-brief.md IN FULL — it is your complete brief (read-order, Phase 1 contract folds for blockers B1-B6 + the open-question-2 verb decision + citation corrections, Phase 2 suite fold, laws, deliverables). Then execute both phases exactly.`,
  'Deliverables (edit ONLY these): docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md (header to v1.1 with the fold note) · impl/test/workflow-as-data-red.test.mjs (folded to v1.1 semantics, every row still RED at a named stage — run it from the repo root twice and record the stable split) · docs/reference/evidence/workflow-as-data-2026-08-06/suite-draft-notes.md · docs/reference/evidence/workflow-as-data-2026-08-06/contract-fold.md (the blocker → change map for both phases).',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `fold114-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: [{
      role: 'fold-114',
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['impl/test/**', 'docs/reference/evidence/workflow-as-data-2026-08-06/**'],
      objective: OBJECTIVE,
    }],
  });
  step('waves.start', { runs: [wave.runs.get('fold-114')?.id ?? null] });
  const deadline = Date.now() + 120 * 60_000;
  const pending = new Set(['fold-114']);
  let approved = false;
  const nudged = new Set();
  const claimed = new Set();
  while (Date.now() < deadline && pending.size > 0) {
    await sleep(15_000);
    for (const role of [...pending]) {
      const handle = wave.runs.get(role);
      if (!handle?.id) { pending.delete(role); continue; }
      const view = await handle.status().catch(() => null);
      const outline = view?.view ?? view ?? {};
      const phase = outline.phase ?? outline.outline?.phase ?? null;
      const actions = view?.actions ?? outline?.actions ?? [];
      const approveAction = Array.isArray(actions) ? actions.find((a) => a?.kind === 'approve_plan') : null;
      if (approveAction && !approved) {
        approved = true;
        const result = await handle._command('run.approve', { runId: handle.id, planDigest: approveAction.planDigest }).catch((error) => ({ error: String(error?.message ?? error) }));
        step(`approve:${role}`, { result: result?.result ?? result?.error ?? 'ok' });
      }
      const attention = view?.attention ?? outline?.attention ?? [];
      const checkpoint = Array.isArray(attention) ? attention.find((entry) => entry?.kind === 'turn_checkpoint' && typeof entry?.requestId === 'string') : null;
      if (checkpoint) {
        if (checkpoint.claim != null && !claimed.has(checkpoint.requestId)) {
          claimed.add(checkpoint.requestId);
          await handle.act('claim_turn', {}).catch(() => {});
        } else if (!nudged.has(checkpoint.requestId)) {
          nudged.add(checkpoint.requestId);
          await handle.act('nudge_turn', { message: 'Continue: complete the deliverable file(s) per the brief — Phase 1 contract v1.1, then Phase 2 the suite fold, then the fold summary.' }).catch(() => {});
        }
      }
      const terminalStatus = view?.terminalOutcome?.status ?? outline?.terminalOutcome?.status ?? null;
      if (['work_completed', 'completed', 'result_ready'].includes(phase) || terminalStatus === 'completed') {
        pending.delete(role);
        step(`terminal:${role}`, { phase: phase ?? terminalStatus });
      } else if (['cancelled', 'failed'].includes(phase) || ['cancelled', 'failed'].includes(terminalStatus)) {
        pending.delete(role);
        step(`dead:${role}`, { phase: phase ?? terminalStatus });
      }
    }
  }
  step('loop-drained', { pending: [...pending] });
  await sleep(10_000);
  const pins = [
    ...execFileSync('git', ['for-each-ref', 'refs/baton/results', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
    ...execFileSync('git', ['for-each-ref', 'refs/baton/checkpoints', '--sort=-creatordate', '--format=%(objectname)'], { cwd: repo, encoding: 'utf8' }).trim().split('\n').filter(Boolean),
  ];
  const targets = {
    'fold-114': [
      'docs/reference/evidence/workflow-as-data-2026-08-06/workflow-as-data-contract.md',
      'docs/reference/evidence/workflow-as-data-2026-08-06/contract-fold.md',
      'impl/test/workflow-as-data-red.test.mjs',
      'docs/reference/evidence/workflow-as-data-2026-08-06/suite-draft-notes.md',
    ],
  };
  const harvested = {};
  for (const pin of pins.slice(0, 20)) {
    for (const [role, paths] of Object.entries(targets)) {
      if (harvested[role]) continue;
      try {
        const contents = paths.map((path) => {
          try { return { path, content: execFileSync('git', ['show', `${pin}:${path}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }) }; } catch { return null; }
        }).filter(Boolean);
        if (contents.length === 0 || contents.some((entry) => entry.content.length < 200)) continue;
        harvested[role] = { pin, paths: contents.map((entry) => entry.path) };
        for (const entry of contents) writeFileSync(resolve(repo, entry.path), entry.content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 1 ? 'FOLD-114-OK' : 'FOLD-114-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'fold-114 wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
