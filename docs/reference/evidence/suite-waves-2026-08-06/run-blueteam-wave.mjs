// BLUE-TEAM WAVE — four deepseek reviewers, one per Ring 4 suite (the kimi-quota pivot:
// review work rides the fleet too). Each writes its blue-team report as the deliverable.
// Facade-only launcher. Usage: node run-blueteam-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/suite-waves-2026-08-06');
const ATTEMPT = new Date().toISOString();
const SALT = `bt${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[bt ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'blueteam-wave-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const BLUE_LAW = [
  'You are the BLUE TEAM verifying a red-first suite before its implementation wave. Read the contract, then the suite, then run it from the repo root (node --test impl/test/<file>.test.mjs) and record the exact split. Your checks: (1) every red row fails AT its named stage/aspect, not earlier (fixture bug) or later; (2) a coverage map — every contract decision/refusal code/pin requirement → the test(s) enforcing it, and every contract requirement with NO test; (3) a FALSE-GREEN hunt on every passing pin (could it pass for the wrong reason — vacuous assertion, staged setup that cannot fail, asserting on the fixture rather than the system): verdict per pin SOUND / WEAK / VACUOUS / STAGED-WRONG with evidence; (4) a teeth check on red rows (would a plausible WRONG implementation actually fail it — shortcut, leak, clock-based, unbounded, silent-skip?). Report shape: run record (exact counts) → coverage map → per-pin verdicts → teeth flags → drift findings (suite header vs contract surface names) → final verdict GATE-READY or NOT-READY with a numbered blocker list (each blocker: what + why + the concrete fix). You write ONLY your report file — never the suite, never the contract.',
  'NUL discipline: ONLY impl/src/application.mjs and impl/src/coordination-store.mjs contain NUL bytes (grep -an + sed -n there); coordinator.mjs and claude-session.mjs are plain text. Verify citations you rely on with grep -an/sed -n.',
].join(' ');

const REVIEWS = [
  {
    role: 'waiting-blue',
    report: 'docs/reference/evidence/waiting-vocabulary-2026-08-06/suite-blueteam.md',
    brief: 'Blue-team impl/test/issue10-waiting-vocabulary-red.test.mjs (38 rows, 35 red / 3 pins) against docs/reference/evidence/waiting-vocabulary-2026-08-06/waiting-vocabulary-contract.md (v1.1) + contract-fold.md. Special attention: the five kinds\' mint/exit honesty (can waitingOn get STUCK set — the exit never firing?), the oscillation attack on the stall-marker strip, the #88 preflight interaction rows, and whether the honest-null law rows actually distinguish waiting from working.',
  },
  {
    role: 'cell-blue',
    report: 'docs/reference/evidence/tight-cell-2026-08-06/suite-blueteam.md',
    brief: 'Blue-team impl/test/tight-cell-red.test.mjs (33 rows, 24 red / 9 pins) against docs/reference/evidence/tight-cell-2026-08-06/tight-cell-contract.md (v1.1 + the v1.2 context-depth amendment appended at its end). Special attention: does the quorum row set actually fail the first-node-settles-the-cell shallow behavior? Does the collector-law row fail a first-completer capture? Are the v1.2 depth rows (D1-D4) covered? Do the 9 pins pass for legitimate reasons (the loose-form byte-identical pin especially)?',
  },
  {
    role: 'nested-blue',
    report: 'docs/reference/evidence/nested-orchestration-2026-08-03/suite-blueteam.md',
    brief: 'Blue-team impl/test/nested-orchestration-red.test.mjs (15 rows, 8 red / 7 pins) against docs/reference/evidence/nested-orchestration-2026-08-03/nested-orchestration-contract.md (v1.1) + contract-fold.md + contract-redteam.md. Special attention: 7 of 15 pins is a high pin ratio — hunt every pin for false-green. Does the minted-not-copied row actually prove content independence? Does the scope-binding row distinguish sibling-in-subtree from foreign? Does the terminal-revoke row prove the session is invalid, not just the event minted?',
  },
  {
    role: 'harvest-blue',
    report: 'docs/reference/evidence/harvest-accessor-2026-08-06/suite-blueteam.md',
    brief: 'Blue-team impl/test/harvest-accessor-red.test.mjs (39 rows, 34 red / 5 pins) against docs/reference/evidence/harvest-accessor-2026-08-06/harvest-accessor-contract.md (v1.1) + contract-fold.md. Special attention: the stale-base trap row (does it fail a HEAD-diff implementation?), the ancestry precondition row (harvest_base_diverged), the conflict-list row (harvest_conflict with named conflicts, never silent), and whether the pin rows stage REAL git pins in tmp repos (not facsimiles).',
  },
];

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `blueteam-wave-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: REVIEWS.map((review) => ({
      role: review.role,
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['docs/reference/evidence/**'],
      objective: `[attempt: bt-${ATTEMPT}] ${review.brief}\n\n${BLUE_LAW}\n\nDeliverable: ${review.report} (final turns only).`,
    })),
  });
  step('waves.start', { runs: REVIEWS.map((r) => wave.runs.get(r.role)?.id ?? null) });
  const deadline = Date.now() + 90 * 60_000;
  const pending = new Set(REVIEWS.map((r) => r.role));
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
          await handle.act('nudge_turn', { message: 'Continue: run the suite, complete the coverage map and per-pin verdicts, then write the report.' }).catch(() => {});
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
    for (const review of REVIEWS) {
      if (harvested[review.role]) continue;
      try {
        const content = execFileSync('git', ['show', `${pin}:${review.report}`], { cwd: repo, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
        if (content.length < 400) continue;
        harvested[review.role] = { pin, bytes: content.length };
        writeFileSync(resolve(repo, review.report), content);
      } catch { /* not in this pin */ }
    }
  }
  receipts.harvest = harvested;
  receipts.verdict = Object.keys(harvested).length === 4 ? 'BLUE-WAVE-OK' : 'BLUE-WAVE-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'blue-team wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
