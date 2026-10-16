// #103 FOLD WAVE — a deepseek folder for the briefing-pack contract against its red-team.
// Facade-only launcher. Rewritten cleanly after a python patch mangled the prior revision
// (orchestrator law: never python-patch a driver — Write the whole file, node --check it).
// Usage: node run-fold-103-wave.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBaton } from '../../../../impl/src/index.mjs';

const repo = resolve(process.cwd());
const EVIDENCE = resolve(repo, 'docs/reference/evidence/briefing-pack-2026-08-06');
mkdirSync(EVIDENCE, { recursive: true });
const ATTEMPT = new Date().toISOString();
const SALT = `f3${ATTEMPT.replace(/[-:T.Z]/g, '').slice(0, 14)}`;
const log = (line) => console.log(`[f103 ${new Date().toISOString()}] ${line}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const receipts = { attempt: ATTEMPT, salt: SALT, steps: [] };
const persist = () => writeFileSync(resolve(EVIDENCE, 'fold-103-receipt.json'), `${JSON.stringify(receipts, null, 2)}\n`);
const step = (name, receipt) => { receipts.steps.push({ step: name, receipt: receipt ?? null }); persist(); log(`${name}: ${JSON.stringify(receipt)?.slice(0, 140) ?? 'done'}`); };

const OBJECTIVE = [
  `[attempt: f3-${ATTEMPT}] You are FOLDING an adversarial red-team report into the briefing-pack contract. Read fully, in order: (1) the red-team report docs/reference/evidence/briefing-pack-2026-08-06/contract-redteam.md (5 blockers B1-B5 + 5 non-blocking N1-N5); (2) the contract docs/reference/evidence/briefing-pack-2026-08-06/briefing-pack-contract.md (your edit target).`,
  'Fold every blocker: B1 (the ledger-only composition law is unsatisfiable for the promised schema — waves/rings/lanes/parked/blocked-on are NOT store projections; the store snapshot has tasks/runs/boards/knowledge but no campaign rings) — EITHER re-scope the schema to what the durable ledger actually carries (name each field store source) OR add the campaign-state record to the settlement ritual as part of the rung (the ring/lane state minted INTO the ledger at wave close — a small new durable record; if you choose this, name the record shape + mint site + the honesty rule). B3 (staleness misreadable: the epoch-age measures ledger-head movement, frozen on idle deployments) — fix the staleness semantics (name what the age MEASURES vs what an operator reads it as; add the "no events since" disclosure). B5 (the CLI doctor render is mis-specified — byte-stability vs one-line render in tension) — pick one (recommend: the briefing rides the doctor JSON as a named additive field, never a text render; fix D6). N1 (header verification-HEAD drift — re-run the application-deployment anchors against the current HEAD). N2 (D4 ordering vs auth-key replay — the short-circuit before the key check or per-settlement-unique keys). N3 (the resolve-lane naming — the orchestrator-facing surface, not the MCP surface that cannot resolve it). N4 (the OQ2 config exception stated in D8). N5 (the A7 failure-forcing gap — an injected overflow path for the suite).',
  'Campaign law: no clocks; every new citation verified with grep -an/sed -n (NUL files: application.mjs + coordination-store.mjs only). Bump the header to v1.1 with the fold note. Write the fold summary (blocker → change map) to docs/reference/evidence/briefing-pack-2026-08-06/contract-fold.md. Edit ONLY the contract + the fold summary.',
].join(' ');

const baton = await openBaton({
  repo,
  advanced: {
    deploymentRoot: resolve(repo, '.baton', `fold103-${SALT}`),
    routes: [{ harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' }],
    verification: Object.freeze({ command: 'true', arguments: [] }),
  },
});

let wave = null;
try {
  wave = await baton.waves.start({
    members: [{
      role: 'fold-103',
      exact: { harness: 'deepseek', model: 'deepseek-v4-flash', effort: 'high' },
      scope: ['docs/reference/evidence/briefing-pack-2026-08-06/**'],
      objective: OBJECTIVE,
    }],
  });
  step('waves.start', { runs: [wave.runs.get('fold-103')?.id ?? null] });
  const deadline = Date.now() + 90 * 60_000;
  const pending = new Set(['fold-103']);
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
          await handle.act('nudge_turn', { message: 'Continue: complete the deliverable file(s) per the brief.' }).catch(() => {});
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
    'fold-103': [
      'docs/reference/evidence/briefing-pack-2026-08-06/briefing-pack-contract.md',
      'docs/reference/evidence/briefing-pack-2026-08-06/contract-fold.md',
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
  receipts.verdict = Object.keys(harvested).length === 1 ? 'FOLD-103-OK' : 'FOLD-103-INCOMPLETE';
  persist();
  log(`verdict: ${receipts.verdict} — harvested: ${Object.keys(harvested).join(', ') || 'none'}`);
} finally {
  persist();
  if (wave) await wave.close({ reason: 'fold-103 wave complete' }).catch(() => {});
  await baton.close().catch(() => {});
}
