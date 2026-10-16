// FOLD WAVE — four deepseek folders, one per Ring 4 suite, folding the blue-team blockers
// (the kimi-quota pivot: folds ride the fleet). Each edits its suite + writes the fold summary.
// Facade-only launcher. Usage: node run-fold-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/suite-waves-2026-08-06');
const ATTEMPT = new Date().toISOString();
const SALT = `fd${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[fold ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'fold-wave-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const FOLD_LAW = [
  'You are FOLDING a blue-team report into a red-first suite. The report is your authority. Laws: never weaken a red row to make it pass (folds add teeth, fix staging, or add missing oracles); pins stay green only for legitimate reasons; new rows must fail at their OWN named stages; re-run the suite from the repo root until the split is exact and stable; update the suite header (inventory, split); write the fold summary (blocker → change map, before/after splits, rejected/deferred items with reasons).',
  'NUL discipline: ONLY impl/src/application.mjs and impl/src/coordination-store.mjs contain NUL bytes (grep -an + sed -n there).',
  'If a blocker requires a CONTRACT edit (drift, a wrong code, a missing law), make it and bump the contract header with the fold note; if a blue-team claim is wrong on the code, reject it with the evidence (verify first with grep -an/sed -n).',
].join(' ');

const FOLDS = [
  {
    role: 'waiting-fold',
    suite: 'impl/test/issue10-waiting-vocabulary-red.test.mjs',
    report: 'docs/reference/evidence/waiting-vocabulary-2026-08-06/suite-blueteam.md',
    contract: 'docs/reference/evidence/waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md',
    summary: 'docs/reference/evidence/waiting-vocabulary-2026-08-06/suite-fold.md',
  },
  {
    role: 'cell-fold',
    suite: 'impl/test/tight-cell-red.test.mjs',
    report: 'docs/reference/evidence/tight-cell-2026-08-06/suite-blueteam.md',
    contract: 'docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md',
    summary: 'docs/reference/evidence/tight-cell-2026-08-06/suite-fold.md',
  },
  {
    role: 'nested-fold',
    suite: 'impl/test/nested-orchestration-red.test.mjs',
    report: 'docs/reference/evidence/nested-orchestration-2026-08-03/suite-blueteam.md',
    contract: 'docs/reference/evidence/nested-orchestration-2026-08-03/nested-orchestration-contract.md',
    summary: 'docs/reference/evidence/nested-orchestration-2026-08-03/suite-fold.md',
  },
  {
    role: 'harvest-fold',
    suite: 'impl/test/harvest-accessor-red.test.mjs',
    report: 'docs/reference/evidence/harvest-accessor-2026-08-06/suite-blueteam.md',
    contract: 'docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md',
    summary: 'docs/reference/evidence/harvest-accessor-2026-08-06/suite-fold.md',
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `fold-wave-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: FOLDS.map((fold) => ({
      role: fold.role,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['impl/test/**', 'docs/reference/evidence/**'],
      objective: `[attempt: fold-${ATTEMPT}] Fold the blue-team report into the suite. Read fully, in order: (1) the report ${fold.report}; (2) the suite ${fold.suite} (your edit target); (3) the contract ${fold.contract} (edit only if a blocker demands contract text — bump its header if so).\n\n${FOLD_LAW}\n\nWrite the fold summary to ${fold.summary}. Deliverables: the folded suite + the summary (final turns).`,
    })),
  });
  step('waves.start', { runs: FOLDS.map((f) => wave.runs.get(f.role)?.id ?? null) });
  const deadline = Date.now() + 90 * 60_000;
  const pending = new Set(FOLDS.map((f) => f.role));
  const approved = new Set();
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
      if (approveAction && !approved.has(role)) {
        approved.add(role);
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
          await handle.act('nudge_turn', { message: 'Continue: fold every blocker, re-run the suite until the split is exact, write the fold summary.' }).catch(() => {});
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
  const harvested = {};
  for (const pin of pins.slice(0, 20)) {
    for (const fold of FOLDS) {
      if (harvested[fold.role]) continue;
      try {
        const suiteContent = execFileSync('git', ['show', `${pin}:${fold.suite}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (suiteContent.length < 1000) continue;
        let summaryContent = '';
        try { summaryContent = execFileSync('git', ['show', `${pin}:${fold.summary}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }); } catch { /* no summary in this pin */ }
        harvested[fold.role] = { pin, suiteBytes: suiteContent.length, summaryBytes: summaryContent.length };
        writeFileSync(resolve(repo, fold.suite), suiteContent);
        if (summaryContent) writeFileSync(resolve(repo, fold.summary), summaryContent);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 4 ? 'FOLD-WAVE-OK' : 'FOLD-WAVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'fold wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
